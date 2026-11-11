import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import redis from '../src/config/redis';
import { securityConfig } from '../src/config/security.config';
import { signAccessToken, verifyRefreshToken } from '../src/utils/jwt.utils';
import { OrganizationType, UserRole } from '@prisma/client';

const COOKIE_NAME = securityConfig.refreshCookieName;

/** Extract the refresh-token Set-Cookie header from a response, if present. */
const getRefreshSetCookie = (res: request.Response): string | undefined => {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
};

/** Turn a Set-Cookie header into a Cookie header value that can be replayed. */
const toCookieHeader = (res: request.Response): string => {
  const setCookie = getRefreshSetCookie(res);
  if (!setCookie) throw new Error('Refresh cookie was not set');
  return setCookie.split(';')[0];
};

const cookieToken = (cookieHeader: string): string =>
  cookieHeader.slice(COOKIE_NAME.length + 1);

const cookieJti = (cookieHeader: string): string =>
  (verifyRefreshToken(cookieToken(cookieHeader)) as { jti?: string }).jti!;

describe('JWT Refresh Token Flow (HttpOnly cookie)', () => {
  const ts = Date.now();

  let orgId: number;
  let userId: number;
  const email = `refresh_admin_${ts}@swiftrefresh.com`;
  const password = 'Password123!';

  const agent = request.agent(app);
  let loginSessionJti: string;

  const createLogin = async () => {
    const loginAgent = request.agent(app);
    const res = await loginAgent.post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return {
      agent: loginAgent,
      accessToken: res.body.token as string,
      cookieHeader: toCookieHeader(res),
    };
  };

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

    const loginCookieHeader = toCookieHeader(res);

    const session = await prisma.refreshSession.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(session).toBeDefined();
    expect(session!.jti).toBe(cookieJti(loginCookieHeader));
    loginSessionJti = session!.jti;
  });

  it('rotates the refresh session and accepts the new access token', async () => {
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

    const oldSession = await prisma.refreshSession.findUnique({
      where: { jti: loginSessionJti },
    });
    const newSession = await prisma.refreshSession.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    expect(oldSession?.revokedReason).toBe('ROTATED');
    expect(oldSession?.replacedByJti).toBe(newSession!.jti);
    expect(newSession?.jti).not.toBe(loginSessionJti);
    expect(newSession?.familyId).toBe(oldSession!.familyId);
  });

  it('revokes the current refresh session on logout', async () => {
    const cookieHeader = toCookieHeader(
      await agent.post('/api/auth/refresh').send({})
    );
    const jti = cookieJti(cookieHeader);

    const res = await agent.post('/api/auth/logout');

    expect(res.status).toBe(200);
    const setCookie = getRefreshSetCookie(res);
    expect(setCookie).toBeDefined();
    // Express clears a cookie by setting an empty value with an expiry in the past.
    expect(setCookie).toMatch(new RegExp(`${COOKIE_NAME}=;`));

    const session = await prisma.refreshSession.findUnique({ where: { jti } });
    expect(session?.revokedReason).toBe('LOGOUT');

    const retry = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader)
      .send({});
    expect(retry.status).toBe(401);
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
    const access = signAccessToken({
      userId,
      organizationId: orgId,
      role: UserRole.CARRIER_ADMIN,
      email,
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${COOKIE_NAME}=${access}`)
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid .*refresh token/i);
  });

  it('revokes every refresh session after logout-all', async () => {
    const deviceA = await createLogin();
    const deviceB = await createLogin();

    const res = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${deviceA.accessToken}`);

    expect(res.status).toBe(200);

    for (const device of [deviceA, deviceB]) {
      const retry = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', device.cookieHeader)
        .send({});
      expect(retry.status).toBe(401);
      expect(retry.body.success).toBe(false);
    }

    const activeSessions = await prisma.refreshSession.count({
      where: { userId, revokedAt: null },
    });
    expect(activeSessions).toBe(0);
  });

  it('detects refresh-token reuse and revokes the whole token family', async () => {
    const device = await createLogin();
    const oldJti = cookieJti(device.cookieHeader);
    const oldSession = await prisma.refreshSession.findUnique({ where: { jti: oldJti } });

    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', device.cookieHeader)
      .send({});
    expect(rotated.status).toBe(200);

    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', device.cookieHeader)
      .send({});
    // Inside the grace window this is a concurrent-tab retry, not replay.
    expect(replay.status).toBe(200);

    // Age the rotated session past the grace window, then replay it.
    await prisma.refreshSession.update({
      where: { jti: oldJti },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const reuse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', device.cookieHeader)
      .send({});
    expect(reuse.status).toBe(401);
    expect(reuse.body.message).toMatch(/reuse/i);

    const family = await prisma.refreshSession.findMany({
      where: { familyId: oldSession!.familyId },
    });
    expect(family.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('allows two simultaneous refreshes from the same cookie', async () => {
    const device = await createLogin();

    const [first, second] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', device.cookieHeader).send({}),
      request(app).post('/api/auth/refresh').set('Cookie', device.cookieHeader).send({}),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstJti = cookieJti(toCookieHeader(first));
    const secondJti = cookieJti(toCookieHeader(second));
    expect(firstJti).toBe(secondJti);

    const followUp = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', toCookieHeader(first))
      .send({});
    expect(followUp.status).toBe(200);
  });

  it('rejects refresh cookies for a deactivated account with 403', async () => {
    const device = await createLogin();

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', device.cookieHeader)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });
});
