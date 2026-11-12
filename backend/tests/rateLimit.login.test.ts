import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole } from '@prisma/client';

describe('login rate limiting', () => {
  const originalEnv = { ...process.env };
  const timestamp = Date.now();
  const password = 'ValidPassword123!';
  const email = `login_limit_${timestamp}@dockslot.test`;

  let organizationId: number;
  let userId: number;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `Login Limit Org ${timestamp}`,
        type: OrganizationType.CARRIER,
      },
    });
    organizationId = organization.id;

    const user = await prisma.user.create({
      data: {
        organizationId,
        email,
        passwordHash: await bcrypt.hash(password, securityConfig.saltRounds),
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: organizationId } }).catch(() => {});
  });

  it('throttles failed credential submissions per email and IP', async () => {
    process.env.RATE_LIMIT_LOGIN_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_LOGIN_MAX = '2';
    process.env.RATE_LIMIT_API_MAX = '100';

    const attempt = () =>
      request(app).post('/api/auth/login').send({
        email,
        password: 'WrongPassword123!',
      });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);

    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.success).toBe(false);
    expect(limited.body.message).toMatch(/too many login attempts/i);
    expect(limited.headers['ratelimit-limit']).toBe('2');
  });
});
