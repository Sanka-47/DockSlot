import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import redis from '../src/config/redis';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole } from '@prisma/client';

const RATE_LIMIT_ENV_KEYS = [
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_API_MAX',
  'RATE_LIMIT_AUTH_MAX',
  'RATE_LIMIT_REFRESH_MAX',
  'RATE_LIMIT_LOGIN_WINDOW_MS',
  'RATE_LIMIT_LOGIN_MAX',
] as const;

describe('auth and refresh rate limiting', () => {
  const originalEnv = Object.fromEntries(
    RATE_LIMIT_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof RATE_LIMIT_ENV_KEYS)[number], string | undefined>;

  const ts = Date.now();
  const password = 'Password123!';
  let orgId: number;
  const users: Array<{ id: number; email: string }> = [];

  const createUser = async (label: string) => {
    const email = `auth_limit_${label}_${ts}@dockslot.test`;
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
    users.push({ id: user.id, email });
    return user;
  };

  const restoreEnv = () => {
    for (const key of RATE_LIMIT_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Auth Limit Org ${ts}`, type: OrganizationType.CARRIER },
    });
    orgId = org.id;
  });

  afterEach(restoreEnv);

  afterAll(async () => {
    restoreEnv();
    const cacheKeys = users.flatMap((user) => [
      `user:${user.id}:tokenVersion`,
      `user:${user.id}:isActive`,
    ]);
    if (cacheKeys.length > 0) {
      await redis.del(...cacheKeys).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  });

  it('allows logins under RATE_LIMIT_AUTH_MAX and returns 429 after it', async () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_API_MAX = '100';
    process.env.RATE_LIMIT_AUTH_MAX = '3';
    process.env.RATE_LIMIT_LOGIN_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_LOGIN_MAX = '100';

    const user = await createUser('login');

    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'WrongPassword123!' });
    expect(second.status).toBe(401);

    const third = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'WrongPassword123!' });
    expect(third.status).toBe(401);

    const limited = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password });
    expect(limited.status).toBe(429);
    expect(limited.body.success).toBe(false);
    expect(limited.body.message).toMatch(/too many authentication attempts/i);
    expect(limited.headers['ratelimit-limit']).toBe('3');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('limits refresh requests per token family', async () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_API_MAX = '100';
    process.env.RATE_LIMIT_AUTH_MAX = '100';
    process.env.RATE_LIMIT_LOGIN_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_LOGIN_MAX = '100';
    process.env.RATE_LIMIT_REFRESH_MAX = '2';

    const user = await createUser('refresh');
    const agent = request.agent(app);

    const login = await agent.post('/api/auth/login').send({ email: user.email, password });
    expect(login.status).toBe(200);

    const firstRefresh = await agent.post('/api/auth/refresh').send({});
    expect(firstRefresh.status).toBe(200);

    const secondRefresh = await agent.post('/api/auth/refresh').send({});
    expect(secondRefresh.status).toBe(200);

    const limited = await agent.post('/api/auth/refresh').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.success).toBe(false);
    expect(limited.body.message).toMatch(/too many refresh attempts/i);
    expect(limited.headers['ratelimit-limit']).toBe('2');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
