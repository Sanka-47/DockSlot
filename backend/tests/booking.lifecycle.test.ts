import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';

describe('Booking Lifecycle Management Integration Tests', () => {
  let warehouseOrgId: number;
  let warehouseAdminId: number;
  let warehouseAdminToken: string;

  let testWarehouseId: number;
  let dockAId: number;
  let dockBId: number;

  let carrierOrgAId: number;
  let dispatcherAId: number;
  let dispatcherAToken: string;

  let carrierOrgBId: number;
  let dispatcherBId: number;
  let dispatcherBToken: string;

  // Time slots in UTC (within 24/7 Colombo timezone)
  const slot1Start = '2026-11-10T04:00:00.000Z';
  const slot1End = '2026-11-10T04:30:00.000Z';

  const slot2Start = '2026-11-10T05:00:00.000Z';
  const slot2End = '2026-11-10T05:30:00.000Z';

  const slot3Start = '2026-11-10T06:00:00.000Z';
  const slot3End = '2026-11-10T06:30:00.000Z';

  beforeAll(async () => {
    // 1. Create Warehouse Operator Org & Warehouse with 2 docks
    const warehouseOrg = await prisma.organization.create({
      data: {
        name: `Warehouse Org Lifecycle ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgId = warehouseOrg.id;

    const warehouseAdmin = await prisma.user.create({
      data: {
        organizationId: warehouseOrgId,
        email: `wh_admin_lc_${Date.now()}@dockslot.com`,
        passwordHash: 'hashed_pw',
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

    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgId,
        name: 'Lifecycle Logistics DC',
        address: '77 Terminal Rd, Colombo',
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
            { name: 'Dock Alpha', status: DockStatus.ACTIVE },
            { name: 'Dock Beta', status: DockStatus.ACTIVE },
          ],
        },
      },
      include: { docks: true },
    });
    testWarehouseId = warehouse.id;
    dockAId = warehouse.docks[0].id;
    dockBId = warehouse.docks[1].id;

    // 2. Create Carrier Organization A & Dispatcher A
    const carrierOrgA = await prisma.organization.create({
      data: {
        name: `Carrier Org A Lifecycle ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgAId = carrierOrgA.id;

    const userA = await prisma.user.create({
      data: {
        organizationId: carrierOrgAId,
        email: `dispatcher_a_${Date.now()}@carrier-a.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherAId = userA.id;
    dispatcherAToken = jwt.sign(
      {
        userId: userA.id,
        organizationId: carrierOrgAId,
        role: userA.role,
        email: userA.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Create Carrier Organization B & Dispatcher B (for tenant isolation tests)
    const carrierOrgB = await prisma.organization.create({
      data: {
        name: `Carrier Org B Lifecycle ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgBId = carrierOrgB.id;

    const userB = await prisma.user.create({
      data: {
        organizationId: carrierOrgBId,
        email: `dispatcher_b_${Date.now()}@carrier-b.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherBId = userB.id;
    dispatcherBToken = jwt.sign(
      {
        userId: userB.id,
        organizationId: carrierOrgBId,
        role: userB.role,
        email: userB.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({
        where: {
          booking: {
            dockId: { in: [dockAId, dockBId] },
          },
        },
      });
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: 'BOOKING',
          payload: {
            path: ['warehouseId'],
            equals: testWarehouseId,
          },
        },
      });
      await prisma.booking.deleteMany({ where: { dockId: { in: [dockAId, dockBId] } } });
      await prisma.dock.deleteMany({ where: { id: { in: [dockAId, dockBId] } } });
      await prisma.operatingHour.deleteMany({ where: { warehouseId: testWarehouseId } });
      await prisma.warehouse.deleteMany({ where: { id: testWarehouseId } });
      await prisma.user.deleteMany({
        where: { id: { in: [warehouseAdminId, dispatcherAId, dispatcherBId] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [warehouseOrgId, carrierOrgAId, carrierOrgBId] } },
      });
    } catch {
      // Ignore cleanup error
    } finally {
      await prisma.$disconnect();
    }
  });

  let createdBookingId: number;

  it('creates a booking and records the initial CREATED audit log', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherAToken}`)
      .send({
        dockId: dockAId,
        slotStartTime: slot1Start,
        slotEndTime: slot1End,
        truckPlate: 'TRK-LFC-01',
        driverName: 'Ravi Kumar',
        driverPhone: '+94771112233',
        cargoNote: 'Initial shipment',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    createdBookingId = res.body.data.id;

    // Verify AuditLog record was created with action CREATED
    const auditLogs = await prisma.auditLog.findMany({
      where: { bookingId: createdBookingId },
    });
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('CREATED');
    expect(auditLogs[0].userId).toBe(dispatcherAId);
  });

  it('rejects reschedule attempt from unauthorized carrier organization (strict tenant isolation)', async () => {
    // Carrier B dispatcher attempts to reschedule Carrier A's booking
    const res = await request(app)
      .patch(`/api/bookings/${createdBookingId}/reschedule`)
      .set('Authorization', `Bearer ${dispatcherBToken}`)
      .send({
        dockId: dockBId,
        slotStartTime: slot2Start,
        slotEndTime: slot2End,
        reason: 'Malicious reschedule attempt by third party',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Forbidden');
  });

  it('successfully reschedules booking, releases old slot, locks new slot, and records RESCHEDULED audit log', async () => {
    // Dispatcher A reschedules from Dock A (slot 1) to Dock B (slot 2)
    const res = await request(app)
      .patch(`/api/bookings/${createdBookingId}/reschedule`)
      .set('Authorization', `Bearer ${dispatcherAToken}`)
      .send({
        dockId: dockBId,
        slotStartTime: slot2Start,
        slotEndTime: slot2End,
        reason: 'Customer requested later slot at Dock B',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dockId).toBe(dockBId);
    expect(new Date(res.body.data.slotStartTime).toISOString()).toBe(slot2Start);

    // Verify Audit Log has RESCHEDULED entry
    const auditLogs = await prisma.auditLog.findMany({
      where: { bookingId: createdBookingId },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditLogs.length).toBe(2);
    expect(auditLogs[1].action).toBe('RESCHEDULED');
    expect(auditLogs[1].userId).toBe(dispatcherAId);
    expect((auditLogs[1].details as any).oldDockId).toBe(dockAId);
    expect((auditLogs[1].details as any).newDockId).toBe(dockBId);

    // PROOF OF OLD SLOT RELEASE: Another carrier (Dispatcher B) can now book the old slot on Dock A!
    const rebookOldSlotRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherBToken}`)
      .send({
        dockId: dockAId,
        slotStartTime: slot1Start,
        slotEndTime: slot1End,
        truckPlate: 'TRK-LFC-02',
        driverName: 'Sunil Shantha',
        driverPhone: '+94772223344',
      });

    expect(rebookOldSlotRes.status).toBe(201);
    expect(rebookOldSlotRes.body.success).toBe(true);
  });

  it('prevents double-booking conflict when rescheduling to an already booked slot', async () => {
    // Slot 1 on Dock A is now taken by Dispatcher B's booking from previous test.
    // Dispatcher A tries to reschedule back to Slot 1 on Dock A
    const res = await request(app)
      .patch(`/api/bookings/${createdBookingId}/reschedule`)
      .set('Authorization', `Bearer ${dispatcherAToken}`)
      .send({
        dockId: dockAId,
        slotStartTime: slot1Start,
        slotEndTime: slot1End,
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Conflict');
  });

  it('rejects cancellation attempt from unauthorized carrier organization (strict tenant isolation)', async () => {
    // Carrier B dispatcher attempts to cancel Carrier A's booking
    const res = await request(app)
      .patch(`/api/bookings/${createdBookingId}/cancel`)
      .set('Authorization', `Bearer ${dispatcherBToken}`)
      .send({ reason: 'Unauthorized cancellation attempt' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Forbidden');
  });

  it('cancels booking, releases slot, records CANCELLED audit log, and permits rebooking of that slot', async () => {
    // Dispatcher A cancels the booking (currently on Dock B at slot 2)
    const cancelRes = await request(app)
      .patch(`/api/bookings/${createdBookingId}/cancel`)
      .set('Authorization', `Bearer ${dispatcherAToken}`)
      .send({ reason: 'Driver vehicle breakdown' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.success).toBe(true);
    expect(cancelRes.body.data.status).toBe('CANCELLED');

    // Verify CANCELLED audit log
    const auditLogs = await prisma.auditLog.findMany({
      where: { bookingId: createdBookingId },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditLogs.length).toBe(3);
    expect(auditLogs[2].action).toBe('CANCELLED');
    expect(auditLogs[2].userId).toBe(dispatcherAId);
    expect((auditLogs[2].details as any).reason).toBe('Driver vehicle breakdown');

    // PROOF OF PROPER SLOT RELEASE: Rebooking that exact slot (Dock B, slot 2) must succeed without unique constraint error!
    const rebookCancelledSlotRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherBToken}`)
      .send({
        dockId: dockBId,
        slotStartTime: slot2Start,
        slotEndTime: slot2End,
        truckPlate: 'TRK-LFC-03',
        driverName: 'Nimal Siripala',
        driverPhone: '+94773334455',
        cargoNote: 'Booking previously released slot',
      });

    expect(rebookCancelledSlotRes.status).toBe(201);
    expect(rebookCancelledSlotRes.body.success).toBe(true);
    expect(rebookCancelledSlotRes.body.data.id).toBeDefined();

    // Verify that cancelled booking and new booking coexist in DB
    const dbBookings = await prisma.booking.findMany({
      where: { dockId: dockBId, slotStartTime: new Date(slot2Start) },
    });
    expect(dbBookings.length).toBe(2);
    const statuses = dbBookings.map((b) => b.status);
    expect(statuses).toContain('CANCELLED');
    expect(statuses).toContain('BOOKED');
  });

  it('rejects rescheduling or cancelling an already cancelled booking', async () => {
    const rescheduleRes = await request(app)
      .patch(`/api/bookings/${createdBookingId}/reschedule`)
      .set('Authorization', `Bearer ${dispatcherAToken}`)
      .send({
        dockId: dockBId,
        slotStartTime: slot3Start,
        slotEndTime: slot3End,
      });

    expect(rescheduleRes.status).toBe(400);
    expect(rescheduleRes.body.message).toContain('Cannot reschedule a cancelled booking');

    const cancelAgainRes = await request(app)
      .patch(`/api/bookings/${createdBookingId}/cancel`)
      .set('Authorization', `Bearer ${dispatcherAToken}`)
      .send();

    expect(cancelAgainRes.status).toBe(400);
    expect(cancelAgainRes.body.message).toContain('Booking is already cancelled');
  });

  it('enforces strict dual-sided tenant visibility on audit logs endpoint', async () => {
    // 1. Carrier Organization A (owner of the booking) can view audit logs
    const carrierRes = await request(app)
      .get(`/api/bookings/${createdBookingId}/audit-logs`)
      .set('Authorization', `Bearer ${dispatcherAToken}`);

    expect(carrierRes.status).toBe(200);
    expect(carrierRes.body.success).toBe(true);
    expect(carrierRes.body.data.length).toBe(3);
    const actionsCarrier = carrierRes.body.data.map((l: any) => l.action);
    expect(actionsCarrier).toEqual(['CREATED', 'RESCHEDULED', 'CANCELLED']);

    // 2. Warehouse Operator Organization (owner of the warehouse/dock) can ALSO view audit logs
    const warehouseRes = await request(app)
      .get(`/api/bookings/${createdBookingId}/audit-logs`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`);

    expect(warehouseRes.status).toBe(200);
    expect(warehouseRes.body.success).toBe(true);
    expect(warehouseRes.body.data.length).toBe(3);
    expect(warehouseRes.body.data[0].user).toBeDefined();

    // 3. Unrelated Carrier Organization B MUST be forbidden (403)
    const unauthorizedRes = await request(app)
      .get(`/api/bookings/${createdBookingId}/audit-logs`)
      .set('Authorization', `Bearer ${dispatcherBToken}`);

    expect(unauthorizedRes.status).toBe(403);
    expect(unauthorizedRes.body.success).toBe(false);
    expect(unauthorizedRes.body.message).toContain('Forbidden');
  });
});
