import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus, BookingStatus } from '@prisma/client';

describe('Warehouse Admin Dock Name Update & Driver Confusion Prevention Tests', () => {
  let warehouseOrgAId: number;
  let warehouseAdminAToken: string;
  let dockManagerAToken: string;

  let warehouseOrgBId: number;
  let warehouseAdminBToken: string;

  let carrierOrgId: number;
  let carrierDispatcherToken: string;

  let testWarehouseAId: number;
  let testDock1Id: number;
  let testDock2Id: number;

  const testTimestamp = Date.now();

  beforeAll(async () => {
    // 1. Warehouse Organization A
    const orgA = await prisma.organization.create({
      data: {
        name: `Wh Org A Docks ${testTimestamp}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgAId = orgA.id;

    // Admin A
    const adminA = await prisma.user.create({
      data: {
        organizationId: warehouseOrgAId,
        email: `wh_admin_a_${testTimestamp}@docktest.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminAToken = jwt.sign(
      {
        userId: adminA.id,
        organizationId: warehouseOrgAId,
        role: adminA.role,
        email: adminA.email,
        tokenVersion: 0,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // Dock Manager A
    const managerA = await prisma.user.create({
      data: {
        organizationId: warehouseOrgAId,
        email: `dock_mgr_a_${testTimestamp}@docktest.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dockManagerAToken = jwt.sign(
      {
        userId: managerA.id,
        organizationId: warehouseOrgAId,
        role: managerA.role,
        email: managerA.email,
        tokenVersion: 0,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // Warehouse A
    const warehouseA = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgAId,
        name: `Colombo Port Terminal ${testTimestamp}`,
        address: '100 Port Rd, Colombo',
        timezone: 'Asia/Colombo',
        slotLengthMinutes: 60,
      },
    });
    testWarehouseAId = warehouseA.id;

    // Docks on Warehouse A
    const dock1 = await prisma.dock.create({
      data: {
        warehouseId: testWarehouseAId,
        name: 'Bay 01 - General Cargo',
        status: DockStatus.ACTIVE,
      },
    });
    testDock1Id = dock1.id;

    const dock2 = await prisma.dock.create({
      data: {
        warehouseId: testWarehouseAId,
        name: 'Bay 02 - Cold Storage',
        status: DockStatus.ACTIVE,
      },
    });
    testDock2Id = dock2.id;

    // 2. Warehouse Organization B (for tenant isolation tests)
    const orgB = await prisma.organization.create({
      data: {
        name: `Wh Org B Docks ${testTimestamp}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgBId = orgB.id;

    const adminB = await prisma.user.create({
      data: {
        organizationId: warehouseOrgBId,
        email: `wh_admin_b_${testTimestamp}@docktest.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminBToken = jwt.sign(
      {
        userId: adminB.id,
        organizationId: warehouseOrgBId,
        role: adminB.role,
        email: adminB.email,
        tokenVersion: 0,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Carrier Organization & Dispatcher
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Fast Freight Logistics ${testTimestamp}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const dispatcher = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `dispatcher_${testTimestamp}@fastfreight.com`,
        passwordHash: 'dummy_hash',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    carrierDispatcherToken = jwt.sign(
      {
        userId: dispatcher.id,
        organizationId: carrierOrgId,
        role: dispatcher.role,
        email: dispatcher.email,
        tokenVersion: 0,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    // Cleanup bookings, docks, warehouses, users, orgs
    await prisma.booking.deleteMany({
      where: {
        dockId: { in: [testDock1Id, testDock2Id] },
      },
    }).catch(() => {});

    await prisma.dock.deleteMany({
      where: { id: { in: [testDock1Id, testDock2Id] } },
    }).catch(() => {});

    await prisma.warehouse.deleteMany({
      where: { id: testWarehouseAId },
    }).catch(() => {});

    await prisma.user.deleteMany({
      where: {
        organizationId: { in: [warehouseOrgAId, warehouseOrgBId, carrierOrgId] },
      },
    }).catch(() => {});

    await prisma.organization.deleteMany({
      where: {
        id: { in: [warehouseOrgAId, warehouseOrgBId, carrierOrgId] },
      },
    }).catch(() => {});
  });

  describe('Part 1: Successful Dock Name Update when no bookings exist', () => {
    it('should allow WAREHOUSE_ADMIN to update dock name via /warehouses/:warehouseId/docks/:dockId', async () => {
      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/${testDock1Id}`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({ name: 'Bay 01 - Heavy Equipment Loading' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Dock updated successfully');
      expect(res.body.data.name).toBe('Bay 01 - Heavy Equipment Loading');

      const inDb = await prisma.dock.findUnique({ where: { id: testDock1Id } });
      expect(inDb?.name).toBe('Bay 01 - Heavy Equipment Loading');
    });

    it('should allow WAREHOUSE_ADMIN to update dock name via /warehouses/docks/:dockId', async () => {
      const res = await request(app)
        .patch(`/api/warehouses/docks/${testDock2Id}`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({ name: 'Bay 02 - Deep Freeze Chamber' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Bay 02 - Deep Freeze Chamber');

      const inDb = await prisma.dock.findUnique({ where: { id: testDock2Id } });
      expect(inDb?.name).toBe('Bay 02 - Deep Freeze Chamber');
    });
  });

  describe('Part 2: Driver Confusion Prevention - Block update when BOOKED bookings exist', () => {
    it('should reject dock name update with 400 when an active booking with status BOOKED exists', async () => {
      // Create a confirmed booking with status BOOKED on dock1
      const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 60 * 60 * 1000);

      const booking = await prisma.booking.create({
        data: {
          dockId: testDock1Id,
          carrierOrgId: carrierOrgId,
          truckPlate: 'WP-CAB-1234',
          driverName: 'Saman Silva',
          driverPhone: '+94771234567',
          cargoNote: 'High value electronics',
          slotStartTime: futureStart,
          slotEndTime: futureEnd,
          status: BookingStatus.BOOKED,
        },
      });

      // Attempt to update dock name
      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/${testDock1Id}`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({ name: 'Bay 01 - Completely New Name' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/active bookings with status 'BOOKED'/i);

      // Clean up this booking
      await prisma.booking.delete({ where: { id: booking.id } });
    });

    it('should allow dock name update if existing bookings are COMPLETED or CANCELLED (not BOOKED)', async () => {
      const pastStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const pastEnd = new Date(pastStart.getTime() + 60 * 60 * 1000);

      // Create a COMPLETED booking
      const completedBooking = await prisma.booking.create({
        data: {
          dockId: testDock1Id,
          carrierOrgId: carrierOrgId,
          truckPlate: 'WP-CAB-1234',
          driverName: 'Saman Silva',
          driverPhone: '+94771234567',
          cargoNote: 'Past cargo',
          slotStartTime: pastStart,
          slotEndTime: pastEnd,
          status: BookingStatus.COMPLETED,
        },
      });

      // Create a CANCELLED booking
      const cancelledBooking = await prisma.booking.create({
        data: {
          dockId: testDock1Id,
          carrierOrgId: carrierOrgId,
          truckPlate: 'WP-CAB-5678',
          driverName: 'Kamal Perera',
          driverPhone: '+94771234568',
          cargoNote: 'Cancelled cargo',
          slotStartTime: new Date(Date.now() + 10 * 60 * 60 * 1000),
          slotEndTime: new Date(Date.now() + 11 * 60 * 60 * 1000),
          status: BookingStatus.CANCELLED,
        },
      });

      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/${testDock1Id}`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({ name: 'Bay 01 - Dry Storage Express' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Bay 01 - Dry Storage Express');

      // Cleanup
      await prisma.booking.deleteMany({
        where: { id: { in: [completedBooking.id, cancelledBooking.id] } },
      });
    });
  });

  describe('Part 3: RBAC & Tenant Isolation Enforcement', () => {
    it('should reject dock name update by DOCK_MANAGER (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/${testDock1Id}`)
        .set('Authorization', `Bearer ${dockManagerAToken}`)
        .send({ name: 'Unauthorized Dock Name Change' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject dock name update by CARRIER DISPATCHER (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/${testDock1Id}`)
        .set('Authorization', `Bearer ${carrierDispatcherToken}`)
        .send({ name: 'Carrier Unauthorized Change' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject dock name update without authentication (401 Unauthorized)', async () => {
      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/${testDock1Id}`)
        .send({ name: 'Unauthenticated Change' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject dock name update by WAREHOUSE_ADMIN from another organization (403 Tenant Isolation)', async () => {
      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/${testDock1Id}`)
        .set('Authorization', `Bearer ${warehouseAdminBToken}`)
        .send({ name: 'Cross-Tenant Hijack' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/permission/i);
    });

    it('should return 404 if dock does not exist', async () => {
      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/9999999`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({ name: 'Ghost Dock' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 if name is empty or blank', async () => {
      const res = await request(app)
        .patch(`/api/warehouses/${testWarehouseAId}/docks/${testDock1Id}`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({ name: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
