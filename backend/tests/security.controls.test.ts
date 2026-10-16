import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import { securityConfig } from '../src/config/security.config';
import { authService } from '../src/services/auth.service';
import redis from '../src/config/redis';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';

describe('Configurable Security Controls Integration Tests', () => {
  let warehouseOrgId: number;
  let carrierOrgId: number;
  let warehouseId: number;
  let dockId: number;
  let dispatcherId: number;
  let dispatcherToken: string;

  const originalEnv = { ...process.env };

  beforeAll(async () => {
    await redis.flushall();

    // Create Warehouse Operator Org, Warehouse, and Dock for booking rate limit tests
    const whOrg = await prisma.organization.create({
      data: {
        name: `Sec Controls WH Org ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgId = whOrg.id;

    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgId,
        name: 'Security Rate Limit Warehouse',
        address: '1 Security Way',
        timezone: 'UTC',
        slotLengthMinutes: 30,
        operatingHours: {
          create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            openTime: '00:00',
            closeTime: '24:00',
            slotLengthMinutes: 30,
          })),
        },
        docks: {
          create: [{ name: 'Sec Dock 1', status: DockStatus.ACTIVE }],
        },
      },
      include: { docks: true },
    });
    warehouseId = warehouse.id;
    dockId = warehouse.docks[0].id;

    // Create Carrier Org and Dispatcher
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Sec Controls Carrier Org ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const dispatcher = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `sec_dispatcher_${Date.now()}@test.com`,
        passwordHash: 'dummy',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherId = dispatcher.id;
    dispatcherToken = authService.generateToken(dispatcher, 0);
  });

  beforeEach(async () => {
    // Restore default security env vars and flush Redis before each test
    process.env.JWT_EXPIRES_IN = originalEnv.JWT_EXPIRES_IN || '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = originalEnv.JWT_REFRESH_EXPIRES_IN || '7d';
    process.env.RATE_LIMIT_WINDOW_MS = originalEnv.RATE_LIMIT_WINDOW_MS || '60000';
    process.env.RATE_LIMIT_API_MAX = originalEnv.RATE_LIMIT_API_MAX || '100';
    process.env.RATE_LIMIT_BOOKING_MAX = originalEnv.RATE_LIMIT_BOOKING_MAX || '10';
    process.env.MAX_FAILED_LOGIN_ATTEMPTS = originalEnv.MAX_FAILED_LOGIN_ATTEMPTS || '5';
    process.env.LOGIN_LOCKOUT_DURATION_MINUTES = originalEnv.LOGIN_LOCKOUT_DURATION_MINUTES || '15';
    await redis.flushall();
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    await redis.flushall();
    try {
      await prisma.booking.deleteMany({ where: { dockId } });
      await prisma.dock.deleteMany({ where: { id: dockId } });
      await prisma.operatingHour.deleteMany({ where: { warehouseId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.user.deleteMany({ where: { organizationId: { in: [warehouseOrgId, carrierOrgId] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [warehouseOrgId, carrierOrgId] } } });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('1. Environment Configuration & Configurable JWT Lifetimes', () => {
    it('loads security configuration defaults and respects dynamic process.env overrides', () => {
      expect(securityConfig.jwtExpiresIn).toBe('15m');
      expect(securityConfig.jwtRefreshExpiresIn).toBe('7d');
      expect(securityConfig.rateLimitWindowMs).toBe(60000);
      expect(securityConfig.rateLimitApiMax).toBe(100);
      expect(securityConfig.rateLimitBookingMax).toBe(10);
      expect(securityConfig.maxFailedLoginAttempts).toBe(5);
      expect(securityConfig.loginLockoutDurationMinutes).toBe(15);

      process.env.JWT_EXPIRES_IN = '30m';
      process.env.JWT_REFRESH_EXPIRES_IN = '14d';
      expect(securityConfig.jwtExpiresIn).toBe('30m');
      expect(securityConfig.jwtRefreshExpiresIn).toBe('14d');
    });

    it('signs access and refresh JWT tokens using JWT_EXPIRES_IN (15m) and JWT_REFRESH_EXPIRES_IN (7d)', () => {
      const mockUser = {
        id: 999,
        organizationId: 1,
        role: UserRole.DISPATCHER,
        email: 'jwt_test@dockslot.com',
      };

      const accessToken = authService.generateToken(mockUser, 0);
      const refreshToken = authService.generateRefreshToken(mockUser, 0);

      const decodedAccess = jwt.decode(accessToken) as { iat: number; exp: number };
      const decodedRefresh = jwt.decode(refreshToken) as { iat: number; exp: number; type: string };

      // 15 minutes = 900 seconds
      expect(decodedAccess.exp - decodedAccess.iat).toBe(15 * 60);
      // 7 days = 604800 seconds
      expect(decodedRefresh.exp - decodedRefresh.iat).toBe(7 * 24 * 60 * 60);
      expect(decodedRefresh.type).toBe('refresh');
    });
  });

  describe('2. Brute-Force Login Protection & Account Lockout', () => {
    it('locks account for LOGIN_LOCKOUT_DURATION_MINUTES after MAX_FAILED_LOGIN_ATTEMPTS consecutive failures and resets on valid login', async () => {
      const testEmail = `lockout_user_${Date.now()}@dockslot.com`;
      const validPassword = 'CorrectPassword123!';

      // Register user
      const regRes = await request(app).post('/api/auth/register').send({
        email: testEmail,
        password: validPassword,
        organizationName: `Lockout Test Carrier ${Date.now()}`,
        organizationType: 'CARRIER',
      });
      expect(regRes.status).toBe(201);

      // Non-consecutive test: 2 wrong attempts followed by 1 valid login should reset counter to 0
      for (let i = 1; i <= 2; i++) {
        const res = await request(app).post('/api/auth/login').send({
          email: testEmail,
          password: 'WrongPassword!',
        });
        expect(res.status).toBe(401);
      }

      const validRes = await request(app).post('/api/auth/login').send({
        email: testEmail,
        password: validPassword,
      });
      expect(validRes.status).toBe(200);

      let userRecord = await prisma.user.findUnique({ where: { email: testEmail } });
      expect(userRecord?.failedLoginAttempts).toBe(0);
      expect(userRecord?.lockUntil).toBeNull();

      // Now 5 consecutive failed attempts -> 5th triggers 423 lockout for 15 minutes
      for (let attempt = 1; attempt <= 4; attempt++) {
        const failRes = await request(app).post('/api/auth/login').send({
          email: testEmail,
          password: 'WrongPassword!',
        });
        expect(failRes.status).toBe(401);
        expect(failRes.body.message).toContain(`${5 - attempt} attempt(s) remaining`);
      }

      const fifthFailRes = await request(app).post('/api/auth/login').send({
        email: testEmail,
        password: 'WrongPassword!',
      });
      expect(fifthFailRes.status).toBe(423);
      expect(fifthFailRes.body.message).toContain('5 consecutive failed login attempts');
      expect(fifthFailRes.body.message).toContain('15 minutes');

      userRecord = await prisma.user.findUnique({ where: { email: testEmail } });
      expect(userRecord?.failedLoginAttempts).toBe(5);
      expect(userRecord?.lockUntil).not.toBeNull();

      // Verify lock duration is ~15 minutes in the future
      const lockDiffMinutes = Math.round(
        ((userRecord!.lockUntil!.getTime() - Date.now()) / (60 * 1000))
      );
      expect(lockDiffMinutes).toBeGreaterThanOrEqual(14);
      expect(lockDiffMinutes).toBeLessThanOrEqual(15);

      // Even with valid password, login is rejected with 423 while locked
      const lockedLoginRes = await request(app).post('/api/auth/login').send({
        email: testEmail,
        password: validPassword,
      });
      expect(lockedLoginRes.status).toBe(423);

      // Clean up test user & org
      if (userRecord) {
        await prisma.user.delete({ where: { id: userRecord.id } });
        await prisma.organization.delete({ where: { id: userRecord.organizationId } });
      }
    });
  });

  describe('3. Redis-Backed Rate Limiting Middleware', () => {
    it('restricts POST /api/bookings to RATE_LIMIT_BOOKING_MAX per user within RATE_LIMIT_WINDOW_MS and returns 429 with rate-limit headers', async () => {
      // Configure booking limit to 3 for fast deterministic testing
      process.env.RATE_LIMIT_BOOKING_MAX = '3';
      process.env.RATE_LIMIT_WINDOW_MS = '60000';

      // Requests 1..3 hit the booking endpoint (they can fail validation with 400 and still count against the rate limit)
      for (let i = 1; i <= 3; i++) {
        const res = await request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({});

        expect(res.status).toBe(400);
        expect(res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit']).toBe('3');
        expect(res.headers['ratelimit-remaining'] || res.headers['x-ratelimit-remaining']).toBe(
          String(3 - i)
        );
      }

      // 4th booking request within window must be blocked with HTTP 429 Too Many Requests
      const exceededRes = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({});

      expect(exceededRes.status).toBe(429);
      expect(exceededRes.body.success).toBe(false);
      expect(exceededRes.headers['ratelimit-limit'] || exceededRes.headers['x-ratelimit-limit']).toBe('3');
      expect(
        exceededRes.headers['ratelimit-remaining'] || exceededRes.headers['x-ratelimit-remaining']
      ).toBe('0');
      expect(exceededRes.headers['retry-after']).toBeDefined();
    });

    it('restricts general /api/* requests to RATE_LIMIT_API_MAX within RATE_LIMIT_WINDOW_MS and returns 429 with rate-limit headers', async () => {
      // Configure general API limit to 4 for fast deterministic testing
      process.env.RATE_LIMIT_API_MAX = '4';
      process.env.RATE_LIMIT_WINDOW_MS = '60000';

      for (let i = 1; i <= 4; i++) {
        const res = await request(app)
          .get('/api/bookings')
          .set('Authorization', `Bearer ${dispatcherToken}`);

        expect(res.status).toBe(200);
        expect(res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit']).toBe('4');
        expect(res.headers['ratelimit-remaining'] || res.headers['x-ratelimit-remaining']).toBe(
          String(4 - i)
        );
      }

      // 5th general API request within window must return 429 Too Many Requests
      const exceededRes = await request(app)
        .get('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherToken}`);

      expect(exceededRes.status).toBe(429);
      expect(exceededRes.body.success).toBe(false);
      expect(exceededRes.headers['ratelimit-limit'] || exceededRes.headers['x-ratelimit-limit']).toBe('4');
      expect(
        exceededRes.headers['ratelimit-remaining'] || exceededRes.headers['x-ratelimit-remaining']
      ).toBe('0');
      expect(exceededRes.headers['retry-after']).toBeDefined();
    });
  });
});
