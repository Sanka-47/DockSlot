import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole } from '@prisma/client';

describe('Secure Token-Based Invitation & Account Creation Workflow Tests', () => {
  let carrierAdminToken: string;
  let carrierAdminId: number;
  let carrierOrgId: number;

  let warehouseAdminToken: string;
  let warehouseAdminId: number;
  let warehouseOrgId: number;

  let dispatcherToken: string;
  let dockManagerToken: string;

  const testTimestamp = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  beforeAll(async () => {
    // 1. Create a Carrier Admin with Organization
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Swift Logistics Corp ${testTimestamp}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const carrierAdmin = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `carrier_admin_${testTimestamp}@swiftlogistics.com`,
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
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 2. Create a Warehouse Admin with Organization
    const warehouseOrg = await prisma.organization.create({
      data: {
        name: `Apex Storage Facility ${testTimestamp}`,
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
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Create regular DISPATCHER and DOCK_MANAGER tokens for negative authorization tests
    const dispatcher = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `dispatcher_test_${testTimestamp}@swiftlogistics.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherToken = jwt.sign(
      {
        userId: dispatcher.id,
        organizationId: carrierOrgId,
        role: dispatcher.role,
        email: dispatcher.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    const dockManager = await prisma.user.create({
      data: {
        organizationId: warehouseOrgId,
        email: `manager_test_${testTimestamp}@apexstorage.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dockManagerToken = jwt.sign(
      {
        userId: dockManager.id,
        organizationId: warehouseOrgId,
        role: dockManager.role,
        email: dockManager.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    // Clean up created test organizations and cascade delete test users/invitations
    await prisma.organization.deleteMany({
      where: {
        id: { in: [carrierOrgId, warehouseOrgId] },
      },
    });
  });

  describe('Part 1: Registration with Automatic Organization Creation (POST /api/auth/register)', () => {
    it('should register a new Carrier and assign CARRIER_ADMIN role', async () => {
      const email = `reg_carrier_${Date.now()}@carrier-freight.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'securePassword123!',
          organizationName: 'Global Freight Carriers',
          organizationType: 'CARRIER',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();

      const user = res.body.data?.user || res.body.user;
      expect(user).toBeDefined();
      expect(user.email).toBe(email);
      expect(user.role).toBe(UserRole.CARRIER_ADMIN);
      expect(user.organizationId).toBeDefined();
      expect(user.organization?.name).toBe('Global Freight Carriers');
      expect(user.organization?.type).toBe(OrganizationType.CARRIER);

      // Clean up newly created org
      await prisma.organization.delete({
        where: { id: user.organizationId },
      });
    });

    it('should register a new Warehouse Operator with orgName/orgType aliases and assign WAREHOUSE_ADMIN role', async () => {
      const email = `reg_wh_${Date.now()}@colombo-yard.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'securePassword123!',
          orgName: 'Colombo Metro Yard',
          orgType: 'WAREHOUSE_OPERATOR',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();

      const user = res.body.data?.user || res.body.user;
      expect(user).toBeDefined();
      expect(user.email).toBe(email);
      expect(user.role).toBe(UserRole.WAREHOUSE_ADMIN);
      expect(user.organizationId).toBeDefined();
      expect(user.organization?.name).toBe('Colombo Metro Yard');
      expect(user.organization?.type).toBe(OrganizationType.WAREHOUSE_OPERATOR);

      // Clean up newly created org
      await prisma.organization.delete({
        where: { id: user.organizationId },
      });
    });

    it('should reject registration if email is already taken', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `carrier_admin_${testTimestamp}@swiftlogistics.com`,
          password: 'anotherPassword123',
          organizationName: 'Duplicate Carrier',
          organizationType: 'CARRIER',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should reject registration with invalid organization type', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `invalid_type_${Date.now()}@example.com`,
          password: 'password123',
          organizationName: 'Unknown Org',
          organizationType: 'INVALID_TYPE',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Part 2: Admin Invite Endpoint (POST /api/users/invite)', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/users/invite')
        .send({ email: 'unauth@test.com' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-admin roles (DISPATCHER) with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/users/invite')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ email: 'new_subordinate@test.com' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not authorized|forbidden/i);
    });

    it('should reject non-admin roles (DOCK_MANAGER) with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/users/invite')
        .set('Authorization', `Bearer ${dockManagerToken}`)
        .send({ email: 'new_subordinate@test.com' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not authorized|forbidden/i);
    });

    it('should reject invalid or missing email with 400 Bad Request', async () => {
      const res1 = await request(app)
        .post('/api/users/invite')
        .set('Authorization', `Bearer ${carrierAdminToken}`)
        .send({});

      expect(res1.status).toBe(400);
      expect(res1.body.success).toBe(false);

      const res2 = await request(app)
        .post('/api/users/invite')
        .set('Authorization', `Bearer ${carrierAdminToken}`)
        .send({ email: 'not-an-email' });

      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
    });

    it('should allow CARRIER_ADMIN to invite a user, automatically saving an Invitation with DISPATCHER role and carrier org', async () => {
      const inviteeEmail = `new_dispatcher_${Date.now()}@swiftlogistics.com`;

      const res = await request(app)
        .post('/api/users/invite')
        .set('Authorization', `Bearer ${carrierAdminToken}`)
        .send({
          email: inviteeEmail,
          // Attacker attempts to escalate role or change tenant
          role: 'CARRIER_ADMIN',
          organizationId: 999999,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const invitation = res.body.data || res.body.invitation;
      expect(invitation).toBeDefined();
      expect(invitation.email).toBe(inviteeEmail);
      expect(invitation.role).toBe('DISPATCHER');
      expect(invitation.organizationId).toBe(carrierOrgId);
      expect(invitation.status).toBe('PENDING');
      expect(invitation.token).toBeDefined();
      expect(invitation.expiresAt).toBeDefined();

      // Verify expiration is roughly 48 hours in the future
      const expiresAt = new Date(invitation.expiresAt).getTime();
      const now = Date.now();
      const diffHours = (expiresAt - now) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(47);
      expect(diffHours).toBeLessThanOrEqual(48.1);

      // Verify record directly in database
      const dbInvitation = await prisma.invitation.findUnique({
        where: { email: inviteeEmail },
      });
      expect(dbInvitation).not.toBeNull();
      expect(dbInvitation!.role).toBe('DISPATCHER');
      expect(dbInvitation!.organizationId).toBe(carrierOrgId);
      expect(dbInvitation!.status).toBe('PENDING');

      // User account should NOT exist yet in users table
      const dbUser = await prisma.user.findUnique({
        where: { email: inviteeEmail },
      });
      expect(dbUser).toBeNull();
    });

    it('should allow WAREHOUSE_ADMIN to invite a user, automatically saving an Invitation with DOCK_MANAGER role and warehouse org', async () => {
      const inviteeEmail = `new_manager_${Date.now()}@apexstorage.com`;

      const res = await request(app)
        .post('/api/users/invite')
        .set('Authorization', `Bearer ${warehouseAdminToken}`)
        .send({
          email: inviteeEmail,
          // Attacker attempts to change role
          role: 'WAREHOUSE_ADMIN',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const invitation = res.body.data || res.body.invitation;
      expect(invitation).toBeDefined();
      expect(invitation.email).toBe(inviteeEmail);
      expect(invitation.role).toBe('DOCK_MANAGER');
      expect(invitation.organizationId).toBe(warehouseOrgId);
      expect(invitation.status).toBe('PENDING');
      expect(invitation.token).toBeDefined();

      // Verify record directly in database
      const dbInvitation = await prisma.invitation.findUnique({
        where: { email: inviteeEmail },
      });
      expect(dbInvitation).not.toBeNull();
      expect(dbInvitation!.role).toBe('DOCK_MANAGER');
      expect(dbInvitation!.organizationId).toBe(warehouseOrgId);
      expect(dbInvitation!.status).toBe('PENDING');
    });

    it('should reject invitation if the email is already registered in the system (409 Conflict)', async () => {
      const res = await request(app)
        .post('/api/users/invite')
        .set('Authorization', `Bearer ${carrierAdminToken}`)
        .send({ email: `carrier_admin_${testTimestamp}@swiftlogistics.com` });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });
  });

  describe('Part 3: Accept Invitation / Account Creation Endpoint (POST /api/auth/accept-invite)', () => {
    let pendingToken: string;
    let inviteEmail: string;

    beforeAll(async () => {
      inviteEmail = `accept_test_${Date.now()}@swiftlogistics.com`;
      const inviteRes = await request(app)
        .post('/api/users/invite')
        .set('Authorization', `Bearer ${carrierAdminToken}`)
        .send({ email: inviteEmail });

      pendingToken = inviteRes.body.data?.token || inviteRes.body.invitation?.token;
    });

    it('should reject accept-invite with missing or invalid token', async () => {
      const res = await request(app)
        .post('/api/auth/accept-invite')
        .send({ token: 'non_existent_token_123', password: 'password123' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject accept-invite with too short password (< 6 chars)', async () => {
      const res = await request(app)
        .post('/api/auth/accept-invite')
        .send({ token: pendingToken, password: '123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/at least 6 characters/i);
    });

    it('should reject accept-invite if the token has expired', async () => {
      // Create an expired invitation
      const expiredToken = `expired_token_${Date.now()}`;
      const expiredEmail = `expired_${Date.now()}@swiftlogistics.com`;
      await prisma.invitation.create({
        data: {
          email: expiredEmail,
          organizationId: carrierOrgId,
          role: 'DISPATCHER',
          token: expiredToken,
          expiresAt: new Date(Date.now() - 1000 * 60), // 1 minute in the past
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post('/api/auth/accept-invite')
        .send({ token: expiredToken, password: 'validPassword123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('should successfully accept invitation, create user, update status to ACCEPTED, and return JWT token', async () => {
      const res = await request(app)
        .post('/api/auth/accept-invite')
        .send({
          token: pendingToken,
          password: 'newSecurePassword123!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();

      const user = res.body.data?.user || res.body.user;
      expect(user).toBeDefined();
      expect(user.email).toBe(inviteEmail);
      expect(user.role).toBe(UserRole.DISPATCHER);
      expect(user.organizationId).toBe(carrierOrgId);
      expect(user.isEmailVerified).toBe(true);

      // Verify invitation status changed to ACCEPTED in database
      const dbInvitation = await prisma.invitation.findUnique({
        where: { token: pendingToken },
      });
      expect(dbInvitation).not.toBeNull();
      expect(dbInvitation!.status).toBe('ACCEPTED');

      // Verify user created in database
      const dbUser = await prisma.user.findUnique({
        where: { email: inviteEmail },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser!.role).toBe(UserRole.DISPATCHER);
      expect(dbUser!.organizationId).toBe(carrierOrgId);
      expect(dbUser!.isEmailVerified).toBe(true);

      // Verify the returned JWT token allows access to protected endpoints (e.g. GET /api/auth/me)
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${res.body.token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.email).toBe(inviteEmail);
      expect(meRes.body.data.role).toBe(UserRole.DISPATCHER);
    });

    it('should reject reuse of an already-accepted invitation', async () => {
      const res = await request(app)
        .post('/api/auth/accept-invite')
        .send({
          token: pendingToken,
          password: 'anotherPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already been accepted|cannot be accepted/i);
    });
  });
});
