import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';

describe('Warehouse Settings Update & Slot Length Safeguarding Integration Tests', () => {
  let warehouseOrgAId: number;
  let warehouseAdminAToken: string;
  let dockManagerAToken: string;

  let warehouseOrgBId: number;
  let warehouseAdminBToken: string;

  let testWarehouseId: number;
  let testDockId: number;

  let carrierOrgId: number;
  let dispatcherToken: string;

  const targetDate = '2026-11-20';
  // 60-minute slot: 04:30 to 05:30 UTC (10:00 to 11:00 Asia/Colombo)
  const slot60Start = '2026-11-20T04:30:00.000Z';
  const slot60End = '2026-11-20T05:30:00.000Z';

  beforeAll(async () => {
    // 1. Warehouse Operator Org A & Warehouse Admin A
    const warehouseOrgA = await prisma.organization.create({
      data: {
        name: `Warehouse Org A Settings ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgAId = warehouseOrgA.id;

    const warehouseAdminA = await prisma.user.create({
      data: {
        organizationId: warehouseOrgAId,
        email: `wh_admin_a_${Date.now()}@settings-a.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminAToken = jwt.sign(
      {
        userId: warehouseAdminA.id,
        organizationId: warehouseOrgAId,
        role: warehouseAdminA.role,
        email: warehouseAdminA.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    const dockManagerA = await prisma.user.create({
      data: {
        organizationId: warehouseOrgAId,
        email: `dock_mgr_a_${Date.now()}@settings-a.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dockManagerAToken = jwt.sign(
      {
        userId: dockManagerA.id,
        organizationId: warehouseOrgAId,
        role: dockManagerA.role,
        email: dockManagerA.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 2. Warehouse Operator Org B & Warehouse Admin B (tenant isolation)
    const warehouseOrgB = await prisma.organization.create({
      data: {
        name: `Warehouse Org B Settings ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgBId = warehouseOrgB.id;

    const warehouseAdminB = await prisma.user.create({
      data: {
        organizationId: warehouseOrgBId,
        email: `wh_admin_b_${Date.now()}@settings-b.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminBToken = jwt.sign(
      {
        userId: warehouseAdminB.id,
        organizationId: warehouseOrgBId,
        role: warehouseAdminB.role,
        email: warehouseAdminB.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Create Warehouse initially configured with 60-minute slots
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgAId,
        name: 'Settings Test Facility',
        address: '500 Grid Ave, Colombo',
        timezone: 'Asia/Colombo',
        slotLengthMinutes: 60,
        operatingHours: {
          create: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
            dayOfWeek,
            openTime: '00:00',
            closeTime: '24:00',
            slotLengthMinutes: 60,
          })),
        },
        docks: {
          create: [{ name: 'Dock Settings 1', status: DockStatus.ACTIVE }],
        },
      },
      include: { docks: true },
    });
    testWarehouseId = warehouse.id;
    testDockId = warehouse.docks[0].id;

    // 4. Create Carrier Org & Dispatcher
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Carrier Org Settings ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const dispatcher = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `dispatcher_s_${Date.now()}@carrier.com`,
        passwordHash: 'hashed_pw',
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
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { booking: { dockId: testDockId } } });
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: 'BOOKING',
          payload: { path: ['warehouseId'], equals: testWarehouseId },
        },
      });
      await prisma.booking.deleteMany({ where: { dockId: testDockId } });
      await prisma.dock.deleteMany({ where: { id: testDockId } });
      await prisma.operatingHour.deleteMany({ where: { warehouseId: testWarehouseId } });
      await prisma.warehouse.deleteMany({ where: { id: testWarehouseId } });
      await prisma.user.deleteMany({
        where: { organizationId: { in: [warehouseOrgAId, warehouseOrgBId, carrierOrgId] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [warehouseOrgAId, warehouseOrgBId, carrierOrgId] } },
      });
    } catch {
      // Ignore cleanup error
    } finally {
      await prisma.$disconnect();
    }
  });

  let original60MinBookingId: number;

  it('creates an initial 60-minute booking under 60-minute slot configuration', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        dockId: testDockId,
        slotStartTime: slot60Start,
        slotEndTime: slot60End,
        truckPlate: 'TRK-60MIN-01',
        driverName: 'Initial 60 Min Driver',
        driverPhone: '+94770001122',
        cargoNote: 'Original 60-minute booking',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    original60MinBookingId = res.body.data.id;
  });

  it('rejects slotLengthMinutes update from unauthorized organization (strict tenant isolation)', async () => {
    const res = await request(app)
      .patch(`/api/warehouses/${testWarehouseId}/settings`)
      .set('Authorization', `Bearer ${warehouseAdminBToken}`)
      .send({ slotLengthMinutes: 30 });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Forbidden');
  });

  it('rejects slotLengthMinutes update by non-admin roles (strict RBAC)', async () => {
    // Dock Manager attempts to change warehouse slot length
    const resDockManager = await request(app)
      .patch(`/api/warehouses/${testWarehouseId}/settings`)
      .set('Authorization', `Bearer ${dockManagerAToken}`)
      .send({ slotLengthMinutes: 30 });

    expect(resDockManager.status).toBe(403);

    // Carrier Dispatcher attempts to change warehouse slot length
    const resDispatcher = await request(app)
      .patch(`/api/warehouses/${testWarehouseId}/settings`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ slotLengthMinutes: 30 });

    expect(resDispatcher.status).toBe(403);
  });

  it('rejects invalid slotLengthMinutes increments', async () => {
    const res = await request(app)
      .patch(`/api/warehouses/${testWarehouseId}/settings`)
      .set('Authorization', `Bearer ${warehouseAdminAToken}`)
      .send({ slotLengthMinutes: 17 }); // 17 is not an allowed increment

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Invalid slotLengthMinutes');
  });

  it('allows Warehouse Admin to update default slot length to 30 minutes via PATCH /api/warehouses/:id', async () => {
    const res = await request(app)
      .patch(`/api/warehouses/${testWarehouseId}`)
      .set('Authorization', `Bearer ${warehouseAdminAToken}`)
      .send({ slotLengthMinutes: 30 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.slotLengthMinutes).toBe(30);

    // Verify operating hours were updated to 30 minutes
    const opHours = await prisma.operatingHour.findMany({
      where: { warehouseId: testWarehouseId },
    });
    for (const oh of opHours) {
      expect(oh.slotLengthMinutes).toBe(30);
    }
  });

  it('safeguards existing bookings: original 60-minute booking remains completely unaltered', async () => {
    // Fetch original booking directly from database
    const booking = await prisma.booking.findUnique({
      where: { id: original60MinBookingId },
    });

    expect(booking).not.toBeNull();
    // Start and end timestamps must NOT have shifted or changed
    expect(booking?.slotStartTime.toISOString()).toBe(slot60Start);
    expect(booking?.slotEndTime.toISOString()).toBe(slot60End);
    expect(booking?.status).toBe('BOOKED');
    expect(booking?.truckPlate).toBe('TRK-60MIN-01');
  });

  it('future slot generation engine uses new 30-minute intervals while respecting the existing 60-minute booking', async () => {
    const res = await request(app)
      .get(`/api/warehouses/${testWarehouseId}/slots?date=${targetDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dockSlots = res.body.data[0].slots;
    expect(dockSlots.length).toBeGreaterThan(0);

    // Check slot duration of returned free slots: each must be 30 minutes!
    const firstSlot = dockSlots[0];
    const durationMin =
      (new Date(firstSlot.slotEndTime).getTime() - new Date(firstSlot.slotStartTime).getTime()) /
      (60 * 1000);
    expect(durationMin).toBe(30);

    // The existing 60-minute booking covers 04:30 to 05:30 UTC
    // In the new 30-min grid, this spans TWO 30-min slots:
    // Slot A: 04:30 - 05:00
    // Slot B: 05:00 - 05:30
    // BOTH of these slots MUST be filtered out / unavailable!
    const slotA = dockSlots.find((s: any) => s.slotStartTime === '2026-11-20T04:30:00.000Z');
    expect(slotA).toBeUndefined();

    const slotB = dockSlots.find((s: any) => s.slotStartTime === '2026-11-20T05:00:00.000Z');
    expect(slotB).toBeUndefined();

    // The adjacent slot right after the booking (05:30 - 06:00 UTC) MUST be available!
    const slotAfter = dockSlots.find(
      (s: any) => s.slotStartTime === '2026-11-20T05:30:00.000Z'
    );
    expect(slotAfter).toBeDefined();
    expect(slotAfter.slotEndTime).toBe('2026-11-20T06:00:00.000Z');
  });

  it('allows creating a new 30-minute booking matching the updated slot length', async () => {
    // Book the slot directly following the original 60-min booking (05:30 - 06:00 UTC)
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        dockId: testDockId,
        slotStartTime: '2026-11-20T05:30:00.000Z',
        slotEndTime: '2026-11-20T06:00:00.000Z',
        truckPlate: 'TRK-30MIN-02',
        driverName: 'New 30 Min Driver',
        driverPhone: '+94773332211',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
  });

  it('rejects warehouse name, address, or timezone update when active BOOKED bookings exist', async () => {
    // testWarehouseId has active BOOKED bookings from previous tests
    const res = await request(app)
      .put(`/api/warehouses/${testWarehouseId}`)
      .set('Authorization', `Bearer ${warehouseAdminAToken}`)
      .send({
        name: 'Relocated Facility Name',
        address: '999 New Road, Colombo',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/active bookings with status 'BOOKED'/i);
  });

  it('allows warehouse name, address, or timezone update once there are no active BOOKED bookings', async () => {
    // Delete all bookings on this warehouse to simulate zero BOOKED bookings
    await prisma.booking.deleteMany({
      where: { dock: { warehouseId: testWarehouseId } },
    });

    const res = await request(app)
      .put(`/api/warehouses/${testWarehouseId}`)
      .set('Authorization', `Bearer ${warehouseAdminAToken}`)
      .send({
        name: 'Renamed Hub',
        address: '999 New Road, Colombo',
        timezone: 'Asia/Colombo',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Renamed Hub');
    expect(res.body.data.address).toBe('999 New Road, Colombo');
  });
});
