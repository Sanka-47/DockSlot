import app from '../index';
import http from 'http';

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
    console.log('Login Result:', JSON.stringify(loginData, null, 2));

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
    console.log('Profile Result:', JSON.stringify(meData, null, 2));

    if (!meData.success || !meData.data?.tenantContext?.organizationId) {
      throw new Error('Tenant context verification failed!');
    }
    console.log('Tenant context verified:', meData.data.tenantContext);

    // 3. Test Registration (POST /register)
    console.log('\n3. Testing Registration (POST /register)...');
    const testEmail = `test_carrier_${Date.now()}@carrier.com`;
    const regRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: '12345678',
        role: 'DISPATCHER',
        organizationName: 'New Horizon Logistics',
        organizationType: 'CARRIER',
      }),
    });
    const regData = (await regRes.json()) as any;
    console.log('Register Status:', regRes.status);
    console.log('Register Result:', JSON.stringify(regData, null, 2));

    if (!regData.success || !regData.data?.token) {
      throw new Error('Registration failed!');
    }

    // 4. Test Password Reset (POST /reset-password)
    console.log('\n4. Testing Password Reset (POST /reset-password)...');
    const resetRes = await fetch(`${baseUrl}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        newPassword: '123456789',
      }),
    });
    const resetData = (await resetRes.json()) as any;
    console.log('Reset Status:', resetRes.status);
    console.log('Reset Result:', JSON.stringify(resetData, null, 2));

    // 5. Test Login with new password
    console.log('\n5. Testing Login with New Password...');
    const reLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: '123456789',
      }),
    });
    const reLoginData = (await reLoginRes.json()) as any;
    console.log('Re-login Status:', reLoginRes.status);
    console.log('Re-login Result:', JSON.stringify(reLoginData, null, 2));

    if (!reLoginData.success) {
      throw new Error('Login with new password failed!');
    }

    // 6. Test Unauthenticated Request Rejected by Middleware
    console.log('\n6. Testing Middleware Rejection without Token...');
    const unauthRes = await fetch(`${baseUrl}/me`);
    const unauthData = (await unauthRes.json()) as any;
    console.log('Unauth Status:', unauthRes.status, unauthData.message);
    if (unauthRes.status !== 401) {
      throw new Error('Middleware failed to reject unauthenticated request!');
    }

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
