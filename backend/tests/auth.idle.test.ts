import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import redis from '../src/config/redis';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole } from '@prisma/client';

const COOKIE_NAME = securityConfig.refreshCookieName;

const toCookieHeader = (res: request.Response): string => {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const setCookie = cookies.find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
  if (!setCookie) throw new Error('Refresh cookie was not set');
  return setCookie.split(';')[0];
};

describe('refresh-session idle timeout', () => {
  const ORIGINAL_IDLE_TTL = process.env.REFRESH_SESSION_IDLE_TTL;
  const ts = Date.now();
  const email = `idle_admin_${ts}@dockslot.test`;
  const password = 'Password123!';

  let orgId: number;
  let userId: number;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Idle Test Org ${ts}`, type: OrganizationType.CARRIER },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email,
        passwordHash: await bcrypt.hash(password, securityConfig.saltRounds),
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;
  });

  const restoreIdleTtl = () => {
    if (ORIGINAL_IDLE_TTL === undefined) delete process.env.REFRESH_SESSION_IDLE_TTL;
    else process.env.REFRESH_SESSION_IDLE_TTL = ORIGINAL_IDLE_TTL;
  };

  afterEach(restoreIdleTtl);

  afterAll(async () => {
    restoreIdleTtl();
    await redis.del(`user:${userId}:tokenVersion`, `user:${userId}:isActive`).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  });

  it('revokes the token family when the idle window is exceeded', async () => {
    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const cookieHeader = toCookieHeader(login);

    const session = await prisma.refreshSession.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(session).not.toBeNull();

    await prisma.refreshSession.update({
      where: { jti: session!.jti },
      data: { lastUsedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    });

    process.env.REFRESH_SESSION_IDLE_TTL = '1d';
    expect(securityConfig.refreshSessionIdleTtlMs).toBe(24 * 60 * 60 * 1000);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/inactivity/i);

    const family = await prisma.refreshSession.findMany({
      where: { familyId: session!.familyId },
    });
    expect(family.length).toBeGreaterThan(0);
    expect(family.every((entry) => entry.revokedReason === 'IDLE_TIMEOUT')).toBe(true);
  });
});
