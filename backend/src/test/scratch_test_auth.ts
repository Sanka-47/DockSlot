import app from '../index';
import http from 'http';
import { prisma } from '../config/db.config';

async function runTests() {
  console.log('🧪 Starting Auth Endpoints & Middleware Integration Test...');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5099, () => resolve()));
  const baseUrl = 'http://localhost:5099/api/auth';

  try {
    // 1. Test Login with seeded user
    console.log('\n1. Testing Login (POST /login)...');
    const loginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'warehouse_admin@apex.com',
        password: '12345678',
      }),
    });
    const loginData = (await loginRes.json()) as any;
    console.log('Login Status:', loginRes.status);

    if (!loginData.success || !loginData.data?.token) {
      throw new Error('Login failed!');
    }
    const token = loginData.data.token;

    // 2. Test Authenticated Profile & Tenant Context Middleware (GET /me)
    console.log('\n2. Testing Middleware & Tenant Context (GET /me)...');
    const meRes = await fetch(`${baseUrl}/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const meData = (await meRes.json()) as any;
    console.log('Profile Status:', meRes.status);

    if (!meData.success || !meData.data?.tenantContext?.organizationId) {
      throw new Error('Tenant context verification failed!');
    }
    console.log('Tenant context verified:', meData.data.tenantContext);

    // 3. Test Registration & Auto-Admin Assignment (POST /register)
    console.log('\n3. Testing Registration & Auto-Admin Role Assignment (POST /register)...');
    const testEmail = `test_carrier_${Date.now()}@carrier.com`;
    const regRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password123!',
        organizationName: 'New Horizon Logistics',
        organizationType: 'CARRIER',
      }),
    });
    const regData = (await regRes.json()) as any;
    console.log('Register Status:', regRes.status);

    if (!regData.success || !regData.data?.token) {
      throw new Error('Registration failed!');
    }
    if (regData.data.user.role !== 'CARRIER_ADMIN') {
      throw new Error(`Expected CARRIER_ADMIN role but got: ${regData.data.user.role}`);
    }
    const registeredToken = regData.data.token;
    console.log('Verified user became Admin of new organization:', regData.data.user.organization);

    // 4. Test Change Password (POST /change-password) using ONLY oldPassword and newPassword (no email)
    console.log('\n4. Testing Change Password with oldPassword and newPassword (no email)...');
    const changeRes = await fetch(`${baseUrl}/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${registeredToken}`,
      },
      body: JSON.stringify({
        oldPassword: 'Password123!',
        newPassword: 'ChangedPassword456!',
      }),
    });
    const changeData = (await changeRes.json()) as any;
    console.log('Change Password Status:', changeRes.status);
    console.log('Change Password Result:', changeData);

    if (!changeData.success) {
      throw new Error('Change password failed!');
    }

    // 5. Test Login with Changed Password
    console.log('\n5. Testing Login with Changed Password...');
    const loginChangedRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'ChangedPassword456!',
      }),
    });
    const loginChangedData = (await loginChangedRes.json()) as any;
    console.log('Login Changed Status:', loginChangedRes.status);
    if (!loginChangedData.success) {
      throw new Error('Login with changed password failed!');
    }

    // 6. Test Forgot Password (POST /forgot-password)
    console.log('\n6. Testing Forgot Password (POST /forgot-password)...');
    const forgotRes = await fetch(`${baseUrl}/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const forgotData = (await forgotRes.json()) as any;
    console.log('Forgot Password Status:', forgotRes.status);
    console.log('Forgot Password Result:', forgotData);

    if (!forgotData.success) {
      throw new Error('Forgot password failed!');
    }

    // Retrieve token from DB
    const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
    const resetToken = dbUser?.resetPasswordToken;
    if (!resetToken) {
      throw new Error('Reset password token was not stored in database!');
    }

    // 7. Test Reset Password with Token (POST /reset-password)
    console.log('\n7. Testing Reset Password with Token (POST /reset-password)...');
    const resetRes = await fetch(`${baseUrl}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        newPassword: 'FinalResetPassword789!',
      }),
    });
    const resetData = (await resetRes.json()) as any;
    console.log('Reset Password Status:', resetRes.status);
    console.log('Reset Password Result:', resetData);

    if (!resetData.success) {
      throw new Error('Reset password with token failed!');
    }

    // 8. Test Login with Reset Password
    console.log('\n8. Testing Login with Reset Password...');
    const finalLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'FinalResetPassword789!',
      }),
    });
    const finalLoginData = (await finalLoginRes.json()) as any;
    console.log('Final Login Status:', finalLoginRes.status);
    if (!finalLoginData.success) {
      throw new Error('Login with reset password failed!');
    }

    // 9. Test Unauthenticated Request Rejected by Middleware
    console.log('\n9. Testing Middleware Rejection without Token...');
    const unauthRes = await fetch(`${baseUrl}/me`);
    const unauthData = (await unauthRes.json()) as any;
    console.log('Unauth Status:', unauthRes.status, unauthData.message);
    if (unauthRes.status !== 401) {
      throw new Error('Middleware failed to reject unauthenticated request!');
    }

    console.log('\n🎉 ALL AUTH & PASSWORD TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
