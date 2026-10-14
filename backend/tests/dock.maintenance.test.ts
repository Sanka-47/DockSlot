import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus, BookingStatus } from '@prisma/client';

describe('Dock Maintenance Closures & Booking Status Management Tests', () => {
  let warehouseOrgAId: number;
  let warehouseAdminAToken: string;
  let dockManagerAToken: string;
  let dockManagerAId: number;

  let warehouseOrgBId: number;
  let dockManagerBToken: string;

  let testWarehouseId: number;
  let dock1Id: number;
  let dock2Id: number;

  let carrierOrgId: number;
  let dispatcherToken: string;

  // Time slots in UTC (Asia/Colombo UTC+5:30)
  const slotDate = '2026-11-15';
  const slot1Start = '2026-11-15T04:00:00.000Z';
  const slot1End = '2026-11-15T04:30:00.000Z';

  const slot2Start = '2026-11-15T05:00:00.000Z';
  const slot2End = '2026-11-15T05:30:00.000Z';

  const closureStart = '2026-11-15T04:45:00.000Z';
  const closureEnd = '2026-11-15T05:45:00.000Z';

  beforeAll(async () => {
    // 1. Create Warehouse Operator Org A & Warehouse with 2 docks
    const warehouseOrgA = await prisma.organization.create({
      data: {
        name: `Warehouse Org A Maintenance ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgAId = warehouseOrgA.id;

    const warehouseAdminA = await prisma.user.create({
      data: {
        organizationId: warehouseOrgAId,
        email: `wh_admin_${Date.now()}@wh-a.com`,
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
        email: `dock_mgr_${Date.now()}@wh-a.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dockManagerAId = dockManagerA.id;
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

    // 2. Create Warehouse Operator Org B & Dock Manager B (for tenant isolation)
    const warehouseOrgB = await prisma.organization.create({
      data: {
        name: `Warehouse Org B Maintenance ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgBId = warehouseOrgB.id;

    const dockManagerB = await prisma.user.create({
      data: {
        organizationId: warehouseOrgBId,
        email: `dock_mgr_b_${Date.now()}@wh-b.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dockManagerBToken = jwt.sign(
      {
        userId: dockManagerB.id,
        organizationId: warehouseOrgBId,
        role: dockManagerB.role,
        email: dockManagerB.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Create Warehouse
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgAId,
        name: 'Maintenance Testing DC',
        address: '12 Harbor Line, Colombo',
        timezone: 'Asia/Colombo',
        operatingHours: {
          create: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
            dayOfWeek,
            openTime: '00:00',
            closeTime: '24:00',
            slotLengthMinutes: 30,
          })),
        },
        docks: {
          create: [
            { name: 'Dock 1 - Maintenance Target', status: DockStatus.ACTIVE },
            { name: 'Dock 2 - Control Dock', status: DockStatus.ACTIVE },
          ],
        },
      },
      include: { docks: true },
    });
    testWarehouseId = warehouse.id;
    dock1Id = warehouse.docks[0].id;
    dock2Id = warehouse.docks[1].id;

    // 4. Create Carrier Org & Dispatcher
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Carrier Org Maintenance ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const dispatcher = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `dispatcher_m_${Date.now()}@carrier.com`,
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
      await prisma.dockClosure.deleteMany({
        where: { dockId: { in: [dock1Id, dock2Id] } },
      });
      await prisma.auditLog.deleteMany({
        where: { booking: { dockId: { in: [dock1Id, dock2Id] } } },
      });
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: 'BOOKING',
          payload: { path: ['warehouseId'], equals: testWarehouseId },
        },
      });
      await prisma.booking.deleteMany({ where: { dockId: { in: [dock1Id, dock2Id] } } });
      await prisma.dock.deleteMany({ where: { id: { in: [dock1Id, dock2Id] } } });
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

  let testBookingId: number;

  it('allows carrier dispatcher to create a booking', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        dockId: dock1Id,
        slotStartTime: slot1Start,
        slotEndTime: slot1End,
        truckPlate: 'TRK-MNT-01',
        driverName: 'Sarath Fonseka',
        driverPhone: '+94770011223',
        cargoNote: 'Initial load for maintenance tests',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    testBookingId = res.body.data.id;
  });

  it('rejects dock closure scheduling if it overlaps with an active booking (409 Conflict)', async () => {
    // Attempt to schedule closure overlapping slot 1 (04:00 - 04:30)
    const res = await request(app)
      .post(`/api/docks/${dock1Id}/closures`)
      .set('Authorization', `Bearer ${dockManagerAToken}`)
      .send({
        startTime: '2026-11-15T04:15:00.000Z',
        endTime: '2026-11-15T04:45:00.000Z',
        reason: 'Emergency crane inspection',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('active booking exists');
  });

  it('rejects dock closure creation from unauthorized organization (strict tenant isolation)', async () => {
    const res = await request(app)
      .post(`/api/docks/${dock1Id}/closures`)
      .set('Authorization', `Bearer ${dockManagerBToken}`)
      .send({
        startTime: closureStart,
        endTime: closureEnd,
        reason: 'Unauthorized closure attempt by warehouse B',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Forbidden');
  });

  it('successfully creates a scheduled dock maintenance closure (201 Created)', async () => {
    const res = await request(app)
      .post(`/api/docks/${dock1Id}/closures`)
      .set('Authorization', `Bearer ${warehouseAdminAToken}`)
      .send({
        startTime: closureStart,
        endTime: closureEnd,
        reason: 'Scheduled hydraulic lift maintenance',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.reason).toBe('Scheduled hydraulic lift maintenance');

    // Verify GET /api/docks/:dockId/closures
    const getRes = await request(app)
      .get(`/api/docks/${dock1Id}/closures`)
      .set('Authorization', `Bearer ${dockManagerAToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('slot generation engine automatically filters out time slots under maintenance closure', async () => {
    const res = await request(app)
      .get(`/api/warehouses/${testWarehouseId}/slots?date=${slotDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dock1Mapping = res.body.data.find((d: any) => d.dockId === dock1Id);
    expect(dock1Mapping).toBeDefined();

    // slot2Start (05:00 - 05:30) falls strictly inside closure (04:45 - 05:45) -> MUST BE BLOCKED
    const slot2InDock1 = dock1Mapping.slots.find(
      (s: any) => s.slotStartTime === slot2Start
    );
    expect(slot2InDock1).toBeUndefined();

    // Dock 2 (Control dock) does NOT have closure -> slot2Start MUST be available on Dock 2
    const dock2Mapping = res.body.data.find((d: any) => d.dockId === dock2Id);
    expect(dock2Mapping).toBeDefined();
    const slot2InDock2 = dock2Mapping.slots.find(
      (s: any) => s.slotStartTime === slot2Start
    );
    expect(slot2InDock2).toBeDefined();
  });

  it('rejects direct booking creation attempt on a slot during scheduled maintenance', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        dockId: dock1Id,
        slotStartTime: slot2Start,
        slotEndTime: slot2End,
        truckPlate: 'TRK-MNT-99',
        driverName: 'Test Driver',
        driverPhone: '+94770000000',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('scheduled dock maintenance');
  });

  it('rejects status change by non-dock-manager roles (strict RBAC)', async () => {
    // Carrier Dispatcher attempts to mark booking as ARRIVED
    const resCarrier = await request(app)
      .patch(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ status: 'ARRIVED' });

    expect(resCarrier.status).toBe(403);
    expect(resCarrier.body.message).toContain('Forbidden');

    // Warehouse Admin attempts to mark booking as ARRIVED (strictly DOCK_MANAGER required)
    const resAdmin = await request(app)
      .patch(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${warehouseAdminAToken}`)
      .send({ status: 'ARRIVED' });

    expect(resAdmin.status).toBe(403);
    expect(resAdmin.body.message).toContain('Only Dock Managers are permitted');
  });

  it('rejects status change from dock manager of an unrelated warehouse organization (tenant isolation)', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${dockManagerBToken}`)
      .send({ status: 'ARRIVED' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('rejects status change if booking slotStartTime has not passed yet (400 Bad Request)', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${dockManagerAToken}`)
      .send({ status: 'ARRIVED' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/slot start time/i);
  });

  it('allows Dock Manager to update status to ARRIVED and generates STATUS_CHANGED audit log once slotStartTime has passed', async () => {
    // Fast-forward slotStartTime to the past to permit operational status change
    await prisma.booking.update({
      where: { id: testBookingId },
      data: {
        slotStartTime: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes in the past
        slotEndTime: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const res = await request(app)
      .patch(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${dockManagerAToken}`)
      .send({ status: 'ARRIVED' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ARRIVED');

    // Verify Audit Log
    const auditLogs = await prisma.auditLog.findMany({
      where: { bookingId: testBookingId, action: 'STATUS_CHANGED' },
    });
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('STATUS_CHANGED');
    expect(auditLogs[0].userId).toBe(dockManagerAId);
    expect((auditLogs[0].details as any).oldStatus).toBe('BOOKED');
    expect((auditLogs[0].details as any).newStatus).toBe('ARRIVED');
  });

  it('allows Dock Manager to advance status to COMPLETED and records audit log', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${dockManagerAToken}`)
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('COMPLETED');

    const auditLogs = await prisma.auditLog.findMany({
      where: { bookingId: testBookingId, action: 'STATUS_CHANGED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditLogs.length).toBe(2);
    expect((auditLogs[1].details as any).oldStatus).toBe('ARRIVED');
    expect((auditLogs[1].details as any).newStatus).toBe('COMPLETED');
  });
});
