import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import redis from '../src/config/redis';
import { securityConfig } from '../src/config/security.config';
import { signRefreshToken } from '../src/utils/jwt.utils';
import { OrganizationType, UserRole } from '@prisma/client';

describe('JWT Refresh Token Flow (POST /api/auth/refresh)', () => {
  const ts = Date.now();

  let orgId: number;
  let userId: number;
  const email = `refresh_admin_${ts}@swiftrefresh.com`;
  const password = 'Password123!';

  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Refresh Test Carrier ${ts}`, type: OrganizationType.CARRIER },
    });
    orgId = org.id;

    const passwordHash = await bcrypt.hash(password, securityConfig.saltRounds);
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email,
        passwordHash,
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await redis.del(`user:${userId}:tokenVersion`, `user:${userId}:isActive`).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  });

  it('issues both an access and a refresh token on login', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');

    accessToken = res.body.token;
    refreshToken = res.body.refreshToken;
  });

  it('exchanges a valid refresh token for a new access token that the API accepts', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    // A rotated refresh token is returned
    expect(typeof res.body.refreshToken).toBe('string');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.token}`);

    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(userId);
  });

  it('rejects a missing refresh token with 400', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a malformed refresh token with 401', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-jwt' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects an access token presented as a refresh token (wrong type) with 401', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: accessToken });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid refresh token.');
  });

  it('revokes refresh tokens after logout-all', async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    // Mirror what logout-all does: bump the Redis token version.
    await redis.incr(`user:${userId}:tokenVersion`);

    const revoked = signRefreshToken({
      userId: user!.id,
      organizationId: user!.organizationId,
      role: user!.role,
      email: user!.email,
      tokenVersion: 0,
    });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: revoked });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('revoked');
  });

  it('rejects refresh tokens for a deactivated account with 403', async () => {
    const versionStr = await redis.get(`user:${userId}:tokenVersion`);
    const currentVersion = parseInt(versionStr || '0', 10);

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const token = signRefreshToken({
      userId: user!.id,
      organizationId: user!.organizationId,
      role: user!.role,
      email: user!.email,
      tokenVersion: currentVersion,
    });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });
});
