import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';

const BOOKING_CONFLICT_MESSAGE =
  'Cannot update starting/end time: bookings available in related time.';

describe('Weekly Operational Schedule Template Integration Tests', () => {
  let warehouseOrgAId: number;
  let warehouseAdminToken: string;
  let dockManagerToken: string;

  let warehouseOrgBId: number;
  let warehouseAdminBToken: string;

  let carrierOrgId: number;
  let dispatcherToken: string;

  let testWarehouseId: number;
  let testDockId: number;

  // 2026-11-20 is a Friday (dayOfWeek 5). Asia/Colombo is UTC+5:30.
  // Local 09:00 - 10:00 -> UTC 03:30 - 04:30.
  const bookingStart = '2026-11-20T03:30:00.000Z';
  const bookingEnd = '2026-11-20T04:30:00.000Z';

  const signToken = (user: { id: number; organizationId: number; role: UserRole; email: string }) =>
    jwt.sign(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
        email: user.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

  beforeAll(async () => {
    // Warehouse operator A with an admin and a dock manager
    const warehouseOrgA = await prisma.organization.create({
      data: {
        name: `Warehouse Org A Hours ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgAId = warehouseOrgA.id;

    const warehouseAdmin = await prisma.user.create({
      data: {
        organizationId: warehouseOrgAId,
        email: `wh_admin_hours_${Date.now()}@hours-a.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminToken = signToken(warehouseAdmin);

    const dockManager = await prisma.user.create({
      data: {
        organizationId: warehouseOrgAId,
        email: `dock_mgr_hours_${Date.now()}@hours-a.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dockManagerToken = signToken(dockManager);

    // A second tenant to prove isolation
    const warehouseOrgB = await prisma.organization.create({
      data: {
        name: `Warehouse Org B Hours ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgBId = warehouseOrgB.id;

    const warehouseAdminB = await prisma.user.create({
      data: {
        organizationId: warehouseOrgBId,
        email: `wh_admin_hours_${Date.now()}@hours-b.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminBToken = signToken(warehouseAdminB);

    // Warehouse has a single Friday 08:00 - 18:00 shift with 60-minute slots.
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgAId,
        name: 'Weekly Hours Test Facility',
        address: '10 Schedule Road, Colombo',
        timezone: 'Asia/Colombo',
        slotLengthMinutes: 60,
        operatingHours: {
          create: [
            {
              dayOfWeek: 5,
              openTime: '08:00',
              closeTime: '18:00',
              slotLengthMinutes: 60,
            },
          ],
        },
        docks: {
          create: [{ name: 'Hours Dock 1', status: DockStatus.ACTIVE }],
        },
      },
      include: { docks: true },
    });
    testWarehouseId = warehouse.id;
    testDockId = warehouse.docks[0].id;

    // Carrier + dispatcher used to create a real booking
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Carrier Org Hours ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const dispatcher = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `dispatcher_hours_${Date.now()}@carrier.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherToken = signToken(dispatcher);
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { booking: { dockId: testDockId } } });
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: 'BOOKING',
          payload: { path: '$.booking.warehouseId', equals: testWarehouseId },
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
      // Ignore cleanup errors
    } finally {
      await prisma.$disconnect();
    }
  });

  it('returns the stored weekly operating schedule for a WAREHOUSE_ADMIN', async () => {
    const res = await request(app)
      .get(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.timezone).toBe('Asia/Colombo');
    expect(res.body.data.slotLengthMinutes).toBe(60);
    expect(res.body.data.operatingHours).toHaveLength(1);
    expect(res.body.data.operatingHours[0]).toMatchObject({
      dayOfWeek: 5,
      openTime: '08:00',
      closeTime: '18:00',
      slotLengthMinutes: 60,
    });
  });

  it('enforces RBAC and tenant isolation on the hours endpoints', async () => {
    const dockManagerRes = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${dockManagerToken}`)
      .send({
        hours: [{ dayOfWeek: 5, isOpen: true, openTime: '08:00', closeTime: '18:00' }],
      });
    expect(dockManagerRes.status).toBe(403);

    const dispatcherRes = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        hours: [{ dayOfWeek: 5, isOpen: true, openTime: '08:00', closeTime: '18:00' }],
      });
    expect(dispatcherRes.status).toBe(403);

    const otherTenantRes = await request(app)
      .get(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminBToken}`);
    expect(otherTenantRes.status).toBe(403);

    const unauthenticatedRes = await request(app).get(
      `/api/warehouses/${testWarehouseId}/hours`
    );
    expect(unauthenticatedRes.status).toBe(401);
  });

  it('rejects malformed schedule payloads with HTTP 400', async () => {
    const missingDays = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({ hours: [] });

    expect(missingDays.status).toBe(400);
    expect(missingDays.body.success).toBe(false);

    const invalidDay = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({
        hours: [{ dayOfWeek: 9, isOpen: true, openTime: '08:00', closeTime: '18:00' }],
      });

    expect(invalidDay.status).toBe(400);
    expect(invalidDay.body.message).toContain('Invalid dayOfWeek');

    const invalidTime = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({
        hours: [{ dayOfWeek: 5, isOpen: true, openTime: '25:99', closeTime: '18:00' }],
      });

    expect(invalidTime.status).toBe(400);
    expect(invalidTime.body.message).toContain('Invalid openTime');
  });

  it('creates a real Friday booking used to guard schedule pruning', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        dockId: testDockId,
        slotStartTime: bookingStart,
        slotEndTime: bookingEnd,
        truckPlate: 'TRK-HOURS-01',
        driverName: 'Schedule Guard Driver',
        driverPhone: '+94770009911',
        cargoNote: 'Guards the 09:00 - 10:00 local window',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('rejects moving the opening time later when an active booking sits in the removed range', async () => {
    const res = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({
        hours: [{ dayOfWeek: 5, isOpen: true, openTime: '10:00', closeTime: '18:00' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(BOOKING_CONFLICT_MESSAGE);

    const stored = await prisma.operatingHour.findFirst({
      where: { warehouseId: testWarehouseId, dayOfWeek: 5 },
    });
    expect(stored?.openTime).toBe('08:00');
  });

  it('rejects moving the closing time earlier when an active booking overlaps the removed range', async () => {
    const res = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({
        hours: [{ dayOfWeek: 5, isOpen: true, openTime: '08:00', closeTime: '09:30' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(BOOKING_CONFLICT_MESSAGE);
  });

  it('rejects closing a whole day that still holds an active booking', async () => {
    const res = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({
        hours: [{ dayOfWeek: 5, isOpen: false }],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(BOOKING_CONFLICT_MESSAGE);

    const stored = await prisma.operatingHour.findFirst({
      where: { warehouseId: testWarehouseId, dayOfWeek: 5 },
    });
    expect(stored).not.toBeNull();
  });

  it('allows widening the operating window even when bookings exist', async () => {
    const res = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({
        hours: [{ dayOfWeek: 5, isOpen: true, openTime: '07:00', closeTime: '19:00' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.operatingHours[0]).toMatchObject({
      dayOfWeek: 5,
      openTime: '07:00',
      closeTime: '19:00',
    });
  });

  it('allows trimming unbooked time and closing a day with no bookings', async () => {
    // Move opening to exactly the booking start: nothing overlapping is removed.
    const trimRes = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({
        hours: [{ dayOfWeek: 5, isOpen: true, openTime: '09:00', closeTime: '19:00' }],
      });

    expect(trimRes.status).toBe(200);
    expect(trimRes.body.data.operatingHours[0]).toMatchObject({
      dayOfWeek: 5,
      openTime: '09:00',
      closeTime: '19:00',
    });

    // Sunday has no operating hours and no bookings, so closing it is a no-op success.
    const closeSundayRes = await request(app)
      .put(`/api/warehouses/${testWarehouseId}/hours`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`)
      .send({
        hours: [{ dayOfWeek: 7, isOpen: false }],
      });

    expect(closeSundayRes.status).toBe(200);
    expect(
      closeSundayRes.body.data.operatingHours.some((hour: any) => hour.dayOfWeek === 7)
    ).toBe(false);
  });
});
