import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole } from '@prisma/client';
import redis from '../src/config/redis';

describe('Redis + JWT Session Control & User Deactivation Tests', () => {
  let carrierAdminToken: string;
  let carrierAdminId: number;
  let carrierOrgId: number;

  let warehouseAdminToken: string;
  let warehouseAdminId: number;
  let warehouseOrgId: number;

  let dispatcherUser: any;
  let dispatcherToken: string;

  let foreignOrgDispatcher: any;
  let foreignOrgDispatcherToken: string;

  const testTimestamp = Date.now();

  beforeAll(async () => {
    // 1. Create Carrier Org & Admin
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Swift Sessions Carrier ${testTimestamp}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const carrierAdmin = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `c_admin_${testTimestamp}@swiftsessions.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    carrierAdminId = carrierAdmin.id;
    carrierAdminToken = jwt.sign(
      {
        userId: carrierAdmin.id,
        organizationId: carrierOrgId,
        role: carrierAdmin.role,
        email: carrierAdmin.email,
        tokenVersion: 0,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 2. Create Warehouse Org & Admin
    const warehouseOrg = await prisma.organization.create({
      data: {
        name: `Apex Storage Sessions ${testTimestamp}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgId = warehouseOrg.id;

    const warehouseAdmin = await prisma.user.create({
      data: {
        organizationId: warehouseOrgId,
        email: `wh_admin_${testTimestamp}@apexstorage.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminId = warehouseAdmin.id;
    warehouseAdminToken = jwt.sign(
      {
        userId: warehouseAdmin.id,
        organizationId: warehouseOrgId,
        role: warehouseAdmin.role,
        email: warehouseAdmin.email,
        tokenVersion: 0,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Create Dispatcher under Carrier Org
    dispatcherUser = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `dispatcher_${testTimestamp}@swiftsessions.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherToken = jwt.sign(
      {
        userId: dispatcherUser.id,
        organizationId: carrierOrgId,
        role: dispatcherUser.role,
        email: dispatcherUser.email,
        tokenVersion: 0,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 4. Create Dispatcher under Foreign Org
    const foreignOrg = await prisma.organization.create({
      data: {
        name: `Foreign Org ${testTimestamp}`,
        type: OrganizationType.CARRIER,
      },
    });

    foreignOrgDispatcher = await prisma.user.create({
      data: {
        organizationId: foreignOrg.id,
        email: `foreign_dispatcher_${testTimestamp}@foreign.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    foreignOrgDispatcherToken = jwt.sign(
      {
        userId: foreignOrgDispatcher.id,
        organizationId: foreignOrg.id,
        role: foreignOrgDispatcher.role,
        email: foreignOrgDispatcher.email,
        tokenVersion: 0,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    // Clean up created entities
    await prisma.user.deleteMany({
      where: {
        id: { in: [carrierAdminId, warehouseAdminId, dispatcherUser?.id, foreignOrgDispatcher?.id] },
      },
    }).catch(() => {});
    await prisma.organization.deleteMany({
      where: {
        id: { in: [carrierOrgId, warehouseOrgId, foreignOrgDispatcher?.organizationId] },
      },
    }).catch(() => {});
  });

  describe('Part 1: Log Out of All Devices (POST /api/auth/logout-all)', () => {
    it('should allow an authenticated user to access protected endpoints before logout-all', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${dispatcherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(dispatcherUser.id);
    });

    it('should successfully log out of all devices by incrementing token version in Redis', async () => {
      const res = await request(app)
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${dispatcherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('logged out of all devices');

      // Verify Redis tokenVersion was incremented
      const newVersion = await redis.get(`user:${dispatcherUser.id}:tokenVersion`);
      expect(Number(newVersion)).toBeGreaterThanOrEqual(1);
    });

    it('should reject previous JWT with 401 Unauthorized after logout-all', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${dispatcherToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Account has been deactivated');
    });

    it('should allow access again when a new token with the updated tokenVersion is issued', async () => {
      const versionStr = await redis.get(`user:${dispatcherUser.id}:tokenVersion`);
      const currentVersion = parseInt(versionStr || '0', 10);

      const freshToken = jwt.sign(
        {
          userId: dispatcherUser.id,
          organizationId: carrierOrgId,
          role: dispatcherUser.role,
          email: dispatcherUser.email,
          tokenVersion: currentVersion,
        },
        securityConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${freshToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Part 2: Admin User Deactivation (PATCH /api/users/:id/deactivate)', () => {
    it('should reject deactivation if requester is not CARRIER_ADMIN or WAREHOUSE_ADMIN (403)', async () => {
      const res = await request(app)
        .patch(`/api/users/${dispatcherUser.id}/deactivate`)
        .set('Authorization', `Bearer ${foreignOrgDispatcherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject deactivation if target user belongs to a different organization (403 Tenant Isolation)', async () => {
      const res = await request(app)
        .patch(`/api/users/${foreignOrgDispatcher.id}/deactivate`)
        .set('Authorization', `Bearer ${carrierAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('another organization');
    });

    it('should return 404 if target user does not exist', async () => {
      const res = await request(app)
        .patch('/api/users/9999999/deactivate')
        .set('Authorization', `Bearer ${carrierAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 if user ID is invalid', async () => {
      const res = await request(app)
        .patch('/api/users/invalid-id/deactivate')
        .set('Authorization', `Bearer ${carrierAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should allow CARRIER_ADMIN to deactivate a user in their organization', async () => {
      const res = await request(app)
        .patch(`/api/users/${dispatcherUser.id}/deactivate`)
        .set('Authorization', `Bearer ${carrierAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('deactivated successfully');
      expect(res.body.data.isActive).toBe(false);

      // Verify in MySQL
      const userInDb = await prisma.user.findUnique({ where: { id: dispatcherUser.id } });
      expect(userInDb?.isActive).toBe(false);

      // Verify in Redis
      const redisActive = await redis.get(`user:${dispatcherUser.id}:isActive`);
      expect(redisActive).toBe('0');
    });

    it('should immediately reject deactivated user requests with 403 Forbidden', async () => {
      const versionStr = await redis.get(`user:${dispatcherUser.id}:tokenVersion`);
      const currentVersion = parseInt(versionStr || '0', 10);

      // Even with updated tokenVersion, deactivated status in Redis/MySQL must return 403
      const tokenWithNewVersion = jwt.sign(
        {
          userId: dispatcherUser.id,
          organizationId: carrierOrgId,
          role: dispatcherUser.role,
          email: dispatcherUser.email,
          tokenVersion: currentVersion,
        },
        securityConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenWithNewVersion}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Account has been deactivated');
    });

    it('should allow organization admin to list users in organization (GET /api/users)', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${carrierAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const foundDispatcher = res.body.data.find((u: any) => u.id === dispatcherUser.id);
      expect(foundDispatcher).toBeDefined();
      expect(foundDispatcher.isActive).toBe(false);
    });

    it('should reject reactivating a user from another organization with 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/users/${foreignOrgDispatcher.id}/reactivate`)
        .set('Authorization', `Bearer ${carrierAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('another organization');
    });

    it('should allow organization admin to reactivate a deactivated user (PATCH /api/users/:id/reactivate)', async () => {
      const res = await request(app)
        .patch(`/api/users/${dispatcherUser.id}/reactivate`)
        .set('Authorization', `Bearer ${carrierAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('reactivated successfully');
      expect(res.body.data.isActive).toBe(true);

      // Verify in MySQL
      const userInDb = await prisma.user.findUnique({ where: { id: dispatcherUser.id } });
      expect(userInDb?.isActive).toBe(true);

      // Verify in Redis
      const redisActive = await redis.get(`user:${dispatcherUser.id}:isActive`);
      expect(redisActive).toBe('1');
    });

    it('should allow reactivated user to authenticate with valid token', async () => {
      const versionStr = await redis.get(`user:${dispatcherUser.id}:tokenVersion`);
      const currentVersion = parseInt(versionStr || '0', 10);

      const validToken = jwt.sign(
        {
          userId: dispatcherUser.id,
          organizationId: carrierOrgId,
          role: dispatcherUser.role,
          email: dispatcherUser.email,
          tokenVersion: currentVersion,
        },
        securityConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(dispatcherUser.id);
    });

    it('should support reactivation via PATCH /api/users/:id/deactivate with { isActive: true }', async () => {
      // First deactivate
      await request(app)
        .patch(`/api/users/${dispatcherUser.id}/deactivate`)
        .set('Authorization', `Bearer ${carrierAdminToken}`);

      let userInDb = await prisma.user.findUnique({ where: { id: dispatcherUser.id } });
      expect(userInDb?.isActive).toBe(false);

      // Now reactivate via deactivate endpoint with body
      const res = await request(app)
        .patch(`/api/users/${dispatcherUser.id}/deactivate`)
        .set('Authorization', `Bearer ${carrierAdminToken}`)
        .send({ isActive: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isActive).toBe(true);

      userInDb = await prisma.user.findUnique({ where: { id: dispatcherUser.id } });
      expect(userInDb?.isActive).toBe(true);

      const redisActive = await redis.get(`user:${dispatcherUser.id}:isActive`);
      expect(redisActive).toBe('1');
    });
  });
});
