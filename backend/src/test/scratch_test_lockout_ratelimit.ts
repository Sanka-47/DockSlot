import http from 'http';
import app from '../index';
import { prisma } from '../config/db.config';

async function runLockoutAndRateLimitTests() {
  console.log('🧪 Starting Account Lockout & Rate Limiting Integration Tests...');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5098, () => resolve()));
  const baseUrl = 'http://localhost:5098/api/auth';

  try {
    // ---------------------------------------------------------
    // TEST 1: Account Lockout after 5 Failed Password Attempts
    // ---------------------------------------------------------
    console.log('\n--- TEST 1: Account Lockout Mechanism ---');
    const lockoutEmail = `lockout_test_${Date.now()}@example.com`;
    const originalPassword = 'SecurePassword123!';

    // Register a fresh test user
    console.log(`1. Registering user: ${lockoutEmail}`);
    const regRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: lockoutEmail,
        password: originalPassword,
        organizationName: 'Lockout Test Org',
        organizationType: 'CARRIER',
      }),
    });
    const regData = (await regRes.json()) as any;
    if (!regData.success) {
      throw new Error(`Failed to register test user: ${JSON.stringify(regData)}`);
    }

    // Attempt 1 to 4: Wrong passwords (should return 401)
    for (let attempt = 1; attempt <= 4; attempt++) {
      console.log(`2.${attempt} Attempting login with wrong password (Attempt ${attempt}/5)...`);
      const failRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: lockoutEmail,
          password: 'WrongPassword!',
        }),
      });
      const failData = (await failRes.json()) as any;
      console.log(`   Status: ${failRes.status}, Message: "${failData.message}"`);

      if (failRes.status !== 401) {
        throw new Error(`Expected HTTP 401 on attempt ${attempt}, got ${failRes.status}`);
      }

      // Check failed attempts count in DB
      const userState = await prisma.user.findUnique({ where: { email: lockoutEmail } });
      if (userState?.failedLoginAttempts !== attempt) {
        throw new Error(`Expected failedLoginAttempts=${attempt}, got ${userState?.failedLoginAttempts}`);
      }
    }

    // Attempt 5: 5th wrong password (should trigger account lockout and return 423)
    console.log('2.5 Attempting 5th wrong password attempt (Threshold reached)...');
    const lockRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: lockoutEmail,
        password: 'WrongPassword!',
      }),
    });
    const lockData = (await lockRes.json()) as any;
    console.log(`   Status: ${lockRes.status}, Message: "${lockData.message}"`);

    if (lockRes.status !== 423) {
      throw new Error(`Expected HTTP 423 on 5th failed attempt, got ${lockRes.status}`);
    }

    // Verify lockUntil is set in DB
    const lockedUser = await prisma.user.findUnique({ where: { email: lockoutEmail } });
    if (!lockedUser?.lockUntil || lockedUser.lockUntil <= new Date()) {
      throw new Error(`Expected user.lockUntil to be in the future, got: ${lockedUser?.lockUntil}`);
    }
    console.log(`   Verified DB lockUntil: ${lockedUser.lockUntil.toISOString()}`);

    // Attempt 6: Even with CORRECT password, login should be blocked with 423 while locked
    console.log('2.6 Attempting login with CORRECT password while account is locked...');
    const blockedRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: lockoutEmail,
        password: originalPassword,
      }),
    });
    const blockedData = (await blockedRes.json()) as any;
    console.log(`   Status: ${blockedRes.status}, Message: "${blockedData.message}"`);

    if (blockedRes.status !== 423) {
      throw new Error(`Expected HTTP 423 when logging in with correct password while locked, got ${blockedRes.status}`);
    }

    // Simulate lockout expiry by clearing lockUntil in DB
    console.log('2.7 Simulating lock expiry in database...');
    await prisma.user.update({
      where: { email: lockoutEmail },
      data: { lockUntil: new Date(Date.now() - 1000) }, // Expired 1 second ago
    });

    // Attempt 7: Login with correct password after lockout expired
    console.log('2.8 Attempting login with correct password after lock expiry...');
    const unlockRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: lockoutEmail,
        password: originalPassword,
      }),
    });
    const unlockData = (await unlockRes.json()) as any;
    console.log(`   Status: ${unlockRes.status}, Success: ${unlockData.success}`);

    if (unlockRes.status !== 200 || !unlockData.success) {
      throw new Error(`Login after lock expiry failed: ${JSON.stringify(unlockData)}`);
    }

    // Verify failedLoginAttempts is reset to 0 and lockUntil is cleared
    const unlockedUser = await prisma.user.findUnique({ where: { email: lockoutEmail } });
    if (unlockedUser?.failedLoginAttempts !== 0 || unlockedUser?.lockUntil !== null) {
      throw new Error(
        `Expected reset failedLoginAttempts=0 & lockUntil=null, got attempts=${unlockedUser?.failedLoginAttempts}, lockUntil=${unlockedUser?.lockUntil}`
      );
    }
    console.log('   Verified failedLoginAttempts was reset to 0 and lockUntil cleared.');

    // ---------------------------------------------------------
    // TEST 2: IP-Based Rate Limiting (Express Rate Limit)
    // ---------------------------------------------------------
    console.log('\n--- TEST 2: IP Rate Limiting ---');
    process.env.ENABLE_TEST_RATE_LIMIT = 'true';

    console.log('Sending requests up to rate limit threshold (10 max)...');
    let hitRateLimit = false;

    // Send requests to /login until limit exceeded (11 requests)
    for (let reqNum = 1; reqNum <= 12; reqNum++) {
      const rlRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'somepassword',
        }),
      });

      if (rlRes.status === 429) {
        const rlData = (await rlRes.json()) as any;
        console.log(`   Request ${reqNum}: Rate limit hit! Status: 429, Message: "${rlData.message}"`);
        hitRateLimit = true;
        break;
      }
    }

    if (!hitRateLimit) {
      throw new Error('Expected HTTP 429 Rate Limit exceeded, but limit was not hit!');
    }

    console.log('\n🎉 ALL LOCKOUT AND RATE LIMITING TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }
}

runLockoutAndRateLimitTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
