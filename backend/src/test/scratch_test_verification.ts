import app from '../index';
import http from 'http';
import { prisma } from '../config/db.config';

async function runVerificationTests() {
  console.log('🧪 Starting Email Verification & Middleware Guard Integration Tests...');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5098, () => resolve()));
  const baseUrl = 'http://localhost:5098/api';

  try {
    // 1. Register a new user
    console.log('\n1. Registering a new unverified user...');
    const testEmail = `verify_test_${Date.now()}@carrier.com`;
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password123!',
        organizationName: 'Fleet Fast Logistics',
        organizationType: 'carrier',
      }),
    });
    const regData = (await regRes.json()) as any;
    console.log('Register Status:', regRes.status);
    console.log('Register Response:', JSON.stringify(regData, null, 2));

    if (!regData.success || !regData.data?.token) {
      throw new Error('Registration failed!');
    }
    const token = regData.data.token;
    const userId = regData.data.user.id;

    // Check DB for verificationToken and isEmailVerified: false
    const dbUserBefore = await prisma.user.findUnique({ where: { id: userId } });
    console.log('DB User Before Verification:', {
      id: dbUserBefore?.id,
      isEmailVerified: dbUserBefore?.isEmailVerified,
      hasToken: !!dbUserBefore?.verificationToken,
    });

    if (dbUserBefore?.isEmailVerified !== false || !dbUserBefore?.verificationToken) {
      throw new Error('User was not saved with isEmailVerified: false and verificationToken!');
    }
    const verificationToken = dbUserBefore.verificationToken;

    // 2. Attempt sensitive booking creation while unverified
    console.log('\n2. Attempting POST /api/bookings while UNVERIFIED (should fail with 403)...');
    const unverifiedBookingRes = await fetch(`${baseUrl}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dockId: 1 }),
    });
    const unverifiedBookingData = (await unverifiedBookingRes.json()) as any;
    console.log('Booking Creation Status:', unverifiedBookingRes.status);
    console.log('Booking Creation Response:', unverifiedBookingData);

    if (unverifiedBookingRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden but received ${unverifiedBookingRes.status}`);
    }

    // 3. Attempt sensitive warehouse management while unverified
    console.log('\n3. Attempting POST /api/warehouses while UNVERIFIED (should fail with 403)...');
    const unverifiedWarehouseRes = await fetch(`${baseUrl}/warehouses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'Unauthorized Warehouse' }),
    });
    const unverifiedWarehouseData = (await unverifiedWarehouseRes.json()) as any;
    console.log('Warehouse Creation Status:', unverifiedWarehouseRes.status);
    console.log('Warehouse Creation Response:', unverifiedWarehouseData);

    if (unverifiedWarehouseRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden but received ${unverifiedWarehouseRes.status}`);
    }

    // 4. Verify email using token (GET /api/auth/verify?token=XYZ)
    console.log('\n4. Verifying email using verificationToken...');
    const verifyRes = await fetch(`${baseUrl}/auth/verify?token=${verificationToken}`);
    const verifyData = (await verifyRes.json()) as any;
    console.log('Verify Status:', verifyRes.status);
    console.log('Verify Response:', verifyData);

    if (verifyRes.status !== 200 || !verifyData.success) {
      throw new Error('Email verification endpoint failed!');
    }

    // Check DB: isEmailVerified should now be true, verificationToken null
    const dbUserAfter = await prisma.user.findUnique({ where: { id: userId } });
    console.log('DB User After Verification:', {
      id: dbUserAfter?.id,
      isEmailVerified: dbUserAfter?.isEmailVerified,
      verificationToken: dbUserAfter?.verificationToken,
    });

    if (dbUserAfter?.isEmailVerified !== true || dbUserAfter?.verificationToken !== null) {
      throw new Error('Database was not updated properly on email verification!');
    }

    // 5. Attempt sensitive booking creation NOW THAT USER IS VERIFIED
    console.log('\n5. Retrying POST /api/bookings as VERIFIED user (should succeed)...');
    const verifiedBookingRes = await fetch(`${baseUrl}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dockId: 1 }),
    });
    const verifiedBookingData = (await verifiedBookingRes.json()) as any;
    console.log('Verified Booking Status:', verifiedBookingRes.status);
    console.log('Verified Booking Response:', verifiedBookingData);

    if (verifiedBookingRes.status !== 201) {
      throw new Error(`Expected 201 Created but received ${verifiedBookingRes.status}`);
    }

    // 6. Test resend verification for already verified account
    console.log('\n6. Testing resend-verification for already verified account...');
    const resendRes = await fetch(`${baseUrl}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const resendData = (await resendRes.json()) as any;
    console.log('Resend Status:', resendRes.status);
    console.log('Resend Response:', resendData);

    // 7. Test invalid token
    console.log('\n7. Testing invalid token verification...');
    const invalidVerifyRes = await fetch(`${baseUrl}/auth/verify?token=invalid_token_12345`);
    const invalidVerifyData = (await invalidVerifyRes.json()) as any;
    console.log('Invalid Token Status:', invalidVerifyRes.status);
    console.log('Invalid Token Response:', invalidVerifyData);

    if (invalidVerifyRes.status !== 400) {
      throw new Error(`Expected 400 Bad Request but received ${invalidVerifyRes.status}`);
    }

    console.log('\n🎉 ALL EMAIL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }
}

runVerificationTests().catch((err) => {
  console.error('Verification tests failed:', err);
  process.exit(1);
});
