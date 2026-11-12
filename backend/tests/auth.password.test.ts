import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import redis from '../src/config/redis';
import { securityConfig } from '../src/config/security.config';
import { hashOpaqueToken } from '../src/utils/tokenHash';
import { OrganizationType, UserRole } from '@prisma/client';

const COOKIE_NAME = securityConfig.refreshCookieName;

const refreshCookieHeader = (res: request.Response): string => {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const setCookie = cookies.find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
  if (!setCookie) throw new Error('Refresh cookie was not set');
  return setCookie.split(';')[0];
};

describe('Password changes revoke existing credentials', () => {
  const ts = Date.now();
  let orgId: number;
  const createdUserIds: number[] = [];
  const cacheKeys: string[] = [];

  const createUser = async (
    label: string,
    password: string,
    role: UserRole = UserRole.CARRIER_ADMIN
  ) => {
    const email = `password_${label}_${ts}@swiftrefresh.com`;
    const passwordHash = await bcrypt.hash(password, securityConfig.saltRounds);
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email,
        passwordHash,
        role,
        isActive: true,
        isEmailVerified: true,
      },
    });

    createdUserIds.push(user.id);
    cacheKeys.push(`user:${user.id}:tokenVersion`, `user:${user.id}:isActive`);
    return { id: user.id, email };
  };

  const login = (email: string, password: string) =>
    request(app).post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Password Test Carrier ${ts}`, type: OrganizationType.CARRIER },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await redis.del(...cacheKeys).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  });

  it('revokes access and refresh tokens after an authenticated password change', async () => {
    const oldPassword = 'Password123!';
    const newPassword = 'NewPassword123!';
    const user = await createUser('change', oldPassword);

    const loginRes = await login(user.email, oldPassword);
    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.token as string;
    const cookieHeader = refreshCookieHeader(loginRes);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword, newPassword });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sign in again/i);

    // MySQL is authoritative and the Redis cache must be dropped immediately.
    const userInDb = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(userInDb?.tokenVersion).toBeGreaterThanOrEqual(1);
    expect(await redis.get(`user:${user.id}:tokenVersion`)).toBeNull();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader)
      .send({});
    expect(refresh.status).toBe(401);

    expect((await login(user.email, oldPassword)).status).toBe(401);
    expect((await login(user.email, newPassword)).status).toBe(200);
  });

  it('revokes access and refresh tokens after a password reset', async () => {
    const oldPassword = 'Password123!';
    const newPassword = 'ResetPassword123!';
    const user = await createUser('reset', oldPassword);

    const loginRes = await login(user.email, oldPassword);
    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.token as string;
    const cookieHeader = refreshCookieHeader(loginRes);

    const resetToken = `reset-token-${ts}`;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Reset tokens are bearer credentials and must be stored hashed.
        resetPasswordToken: hashOpaqueToken(resetToken),
        resetPasswordExpires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const storedToken = await prisma.user.findUnique({
      where: { id: user.id },
      select: { resetPasswordToken: true },
    });
    expect(storedToken?.resetPasswordToken).toBe(hashOpaqueToken(resetToken));
    expect(storedToken?.resetPasswordToken).not.toBe(resetToken);

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword });

    expect(res.status).toBe(200);

    const userInDb = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(userInDb?.tokenVersion).toBeGreaterThanOrEqual(1);
    expect(await redis.get(`user:${user.id}:tokenVersion`)).toBeNull();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader)
      .send({});
    expect(refresh.status).toBe(401);

    expect((await login(user.email, oldPassword)).status).toBe(401);
    expect((await login(user.email, newPassword)).status).toBe(200);
  });

  it('revokes sessions on deactivation and does not restore them on reactivation', async () => {
    const adminPassword = 'AdminPassword123!';
    const targetPassword = 'TargetPassword123!';
    const admin = await createUser('deact_admin', adminPassword);
    const target = await createUser(
      'deact_target',
      targetPassword,
      UserRole.DISPATCHER
    );

    const adminLogin = await login(admin.email, adminPassword);
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.token as string;

    const targetLogin = await login(target.email, targetPassword);
    expect(targetLogin.status).toBe(200);
    const targetToken = targetLogin.body.token as string;
    const targetCookie = refreshCookieHeader(targetLogin);

    const deactivate = await request(app)
      .patch(`/api/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivate.status).toBe(200);

    const activeSessions = await prisma.refreshSession.count({
      where: { userId: target.id, revokedAt: null },
    });
    expect(activeSessions).toBe(0);

    const reactivate = await request(app)
      .patch(`/api/users/${target.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivate.status).toBe(200);

    // Reactivation must not resurrect either the access token or the refresh
    // session that existed before deactivation.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${targetToken}`);
    expect(me.status).toBe(401);

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', targetCookie)
      .send({});
    expect(refresh.status).toBe(401);

    expect((await login(target.email, targetPassword)).status).toBe(200);
  });
});
