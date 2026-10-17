import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import redis from '../src/config/redis';
import { securityConfig } from '../src/config/security.config';
import { signAccessToken, signRefreshToken } from '../src/utils/jwt.utils';
import { OrganizationType, UserRole } from '@prisma/client';

const COOKIE_NAME = securityConfig.refreshCookieName;

/** Extract the refresh-token Set-Cookie header from a response, if present. */
const getRefreshSetCookie = (res: request.Response): string | undefined => {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
};

describe('JWT Refresh Token Flow (HttpOnly cookie)', () => {
  const ts = Date.now();

  let orgId: number;
  let userId: number;
  const email = `refresh_admin_${ts}@swiftrefresh.com`;
  const password = 'Password123!';

  const agent = request.agent(app);
  let accessToken: string;

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

  it('sets an HttpOnly refresh cookie on login and never returns the token in the body', async () => {
    const res = await agent.post('/api/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');

    // Refresh token must NOT leak into the JSON payload.
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.data?.refreshToken).toBeUndefined();

    // ...it must arrive as an HttpOnly cookie instead.
    const setCookie = getRefreshSetCookie(res);
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);

    accessToken = res.body.token;
  });

  it('exchanges the cookie for a new access token that the API accepts', async () => {
    const res = await agent.post('/api/auth/refresh').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.refreshToken).toBeUndefined();

    // The rotated cookie is re-issued.
    expect(getRefreshSetCookie(res)).toBeDefined();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.token}`);

    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(userId);
  });

  it('clears the refresh cookie on logout', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    const setCookie = getRefreshSetCookie(res);
    expect(setCookie).toBeDefined();
    // Express clears a cookie by setting an empty value with an expiry in the past.
    expect(setCookie).toMatch(new RegExp(`${COOKIE_NAME}=;`));
  });

  it('rejects a request with no refresh cookie with 400', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a malformed refresh cookie with 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${COOKIE_NAME}=not-a-jwt`)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects an access token presented as a refresh token (wrong type) with 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${COOKIE_NAME}=${accessToken}`)
      .send({});

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

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${COOKIE_NAME}=${revoked}`)
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('revoked');
  });

  it('rejects refresh cookies for a deactivated account with 403', async () => {
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

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${COOKIE_NAME}=${token}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });
});
