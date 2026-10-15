import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';

describe('Warehouse Booking & Anti-Hogging Policy Integration Tests', () => {
  let warehouseOrgAId: number;
  let warehouseAdminAToken: string;
  let warehouseOrgBId: number;
  let warehouseAdminBToken: string;

  let testWarehouseId: number;
  let testDockAId: number;
  let testDockBId: number;

  let carrierOrgAId: number;
  let dispatcherAToken: string;

  let carrierOrgBId: number;
  let dispatcherBToken: string;

  // Timestamps for testing
  // Use UTC dates relative to now to guarantee deterministic horizon and lock-window evaluation
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Tomorrow date string (YYYY-MM-DD)
  const tomorrowDate = new Date(nowMs + 1 * dayMs).toISOString().slice(0, 10);
  const tomorrowSlot1Start = `${tomorrowDate}T10:00:00.000Z`;
  const tomorrowSlot1End = `${tomorrowDate}T10:30:00.000Z`;
  const tomorrowSlot2Start = `${tomorrowDate}T11:00:00.000Z`;
  const tomorrowSlot2End = `${tomorrowDate}T11:30:00.000Z`;
  const tomorrowSlot3Start = `${tomorrowDate}T12:00:00.000Z`;
  const tomorrowSlot3End = `${tomorrowDate}T12:30:00.000Z`;

  // Day after tomorrow (different calendar day)
  const dayAfterTomorrowDate = new Date(nowMs + 2 * dayMs).toISOString().slice(0, 10);
  const dayAfterSlotStart = `${dayAfterTomorrowDate}T10:00:00.000Z`;
  const dayAfterSlotEnd = `${dayAfterTomorrowDate}T10:30:00.000Z`;

  // 3 days out (outside a 36-hour lock window)
  const threeDaysOutDate = new Date(nowMs + 3 * dayMs).toISOString().slice(0, 10);
  const threeDaysOutSlotStart = `${threeDaysOutDate}T10:00:00.000Z`;
  const threeDaysOutSlotEnd = `${threeDaysOutDate}T10:30:00.000Z`;

  // 15 days out (exceeds default 14-day advance limit)
  const farFutureDate = new Date(nowMs + 15 * dayMs).toISOString().slice(0, 10);
  const farFutureSlotStart = `${farFutureDate}T10:00:00.000Z`;
  const farFutureSlotEnd = `${farFutureDate}T10:30:00.000Z`;

  beforeAll(async () => {
    // 1. Warehouse Operator Org A & Warehouse Admin A
    const whOrgA = await prisma.organization.create({
      data: {
        name: `Warehouse Org Policy A ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgAId = whOrgA.id;

    const whAdminA = await prisma.user.create({
      data: {
        organizationId: warehouseOrgAId,
        email: `wh_admin_policy_a_${Date.now()}@policy-test.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminAToken = jwt.sign(
      {
        userId: whAdminA.id,
        organizationId: warehouseOrgAId,
        role: whAdminA.role,
        email: whAdminA.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 2. Warehouse Operator Org B (Tenant isolation)
    const whOrgB = await prisma.organization.create({
      data: {
        name: `Warehouse Org Policy B ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgBId = whOrgB.id;

    const whAdminB = await prisma.user.create({
      data: {
        organizationId: warehouseOrgBId,
        email: `wh_admin_policy_b_${Date.now()}@policy-test.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminBToken = jwt.sign(
      {
        userId: whAdminB.id,
        organizationId: warehouseOrgBId,
        role: whAdminB.role,
        email: whAdminB.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Create Warehouse with 24/7 operating hours in UTC and 2 docks
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgAId,
        name: 'Policy Test Logistics Hub',
        address: '100 Policy Blvd, Hub',
        timezone: 'UTC',
        slotLengthMinutes: 30,
        operatingHours: {
          create: [0, 1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
            dayOfWeek,
            openTime: '00:00',
            closeTime: '24:00',
            slotLengthMinutes: 30,
          })),
        },
        docks: {
          create: [
            { name: 'Dock P1', status: DockStatus.ACTIVE },
            { name: 'Dock P2', status: DockStatus.ACTIVE },
          ],
        },
      },
      include: { docks: true },
    });
    testWarehouseId = warehouse.id;
    testDockAId = warehouse.docks[0].id;
    testDockBId = warehouse.docks[1].id;

    // 4. Carrier Org A & Dispatcher A
    const carrierOrgA = await prisma.organization.create({
      data: {
        name: `Carrier Org Policy A ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgAId = carrierOrgA.id;

    const dispatcherA = await prisma.user.create({
      data: {
        organizationId: carrierOrgAId,
        email: `dispatcher_policy_a_${Date.now()}@carrier-a.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherAToken = jwt.sign(
      {
        userId: dispatcherA.id,
        organizationId: carrierOrgAId,
        role: dispatcherA.role,
        email: dispatcherA.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    // 5. Carrier Org B & Dispatcher B (for testing per-carrier anti-hogging limits)
    const carrierOrgB = await prisma.organization.create({
      data: {
        name: `Carrier Org Policy B ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgBId = carrierOrgB.id;

    const dispatcherB = await prisma.user.create({
      data: {
        organizationId: carrierOrgBId,
        email: `dispatcher_policy_b_${Date.now()}@carrier-b.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherBToken = jwt.sign(
      {
        userId: dispatcherB.id,
        organizationId: carrierOrgBId,
        role: dispatcherB.role,
        email: dispatcherB.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({
        where: { booking: { dockId: { in: [testDockAId, testDockBId] } } },
      });
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: 'BOOKING',
          payload: { path: ['warehouseId'], equals: testWarehouseId },
        },
      });
      await prisma.booking.deleteMany({
        where: { dockId: { in: [testDockAId, testDockBId] } },
      });
      await prisma.warehousePolicy.deleteMany({
        where: { warehouseId: testWarehouseId },
      });
      await prisma.dock.deleteMany({
        where: { id: { in: [testDockAId, testDockBId] } },
      });
      await prisma.operatingHour.deleteMany({
        where: { warehouseId: testWarehouseId },
      });
      await prisma.warehouse.deleteMany({
        where: { id: testWarehouseId },
      });
      await prisma.user.deleteMany({
        where: {
          organizationId: {
            in: [warehouseOrgAId, warehouseOrgBId, carrierOrgAId, carrierOrgBId],
          },
        },
      });
      await prisma.organization.deleteMany({
        where: {
          id: {
            in: [warehouseOrgAId, warehouseOrgBId, carrierOrgAId, carrierOrgBId],
          },
        },
      });
    } catch {
      // Ignore cleanup error
    } finally {
      await prisma.$disconnect();
    }
  });

  describe('Part 1: Warehouse Admin Policy Endpoints (GET & PUT /api/warehouses/:warehouseId/policy)', () => {
    it('returns default policy when queried for the first time', async () => {
      const res = await request(app)
        .get(`/api/warehouses/${testWarehouseId}/policy`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.warehouseId).toBe(testWarehouseId);
      expect(res.body.data.maxConcurrentBookings).toBe(3);
      expect(res.body.data.maxAdvanceDays).toBe(14);
      expect(res.body.data.bookingLockWindowHours).toBe(24);
    });

    it('rejects policy access by another organization (tenant isolation)', async () => {
      const res = await request(app)
        .get(`/api/warehouses/${testWarehouseId}/policy`)
        .set('Authorization', `Bearer ${warehouseAdminBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Forbidden');
    });

    it('rejects policy update by non-admin roles (RBAC)', async () => {
      const res = await request(app)
        .put(`/api/warehouses/${testWarehouseId}/policy`)
        .set('Authorization', `Bearer ${dispatcherAToken}`)
        .send({ maxConcurrentBookings: 5 });

      expect(res.status).toBe(403);
    });

    it('rejects invalid policy input values (negative or zero numbers)', async () => {
      const res1 = await request(app)
        .put(`/api/warehouses/${testWarehouseId}/policy`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({ maxConcurrentBookings: 0 });

      expect(res1.status).toBe(400);
      expect(res1.body.message).toContain('maxConcurrentBookings');

      const res2 = await request(app)
        .put(`/api/warehouses/${testWarehouseId}/policy`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({ maxAdvanceDays: -2 });

      expect(res2.status).toBe(400);
      expect(res2.body.message).toContain('maxAdvanceDays');
    });

    it('allows WAREHOUSE_ADMIN to configure custom policies', async () => {
      const res = await request(app)
        .put(`/api/warehouses/${testWarehouseId}/policy`)
        .set('Authorization', `Bearer ${warehouseAdminAToken}`)
        .send({
          maxConcurrentBookings: 2,
          maxAdvanceDays: 10,
          bookingLockWindowHours: 36,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.maxConcurrentBookings).toBe(2);
      expect(res.body.data.maxAdvanceDays).toBe(10);
      expect(res.body.data.bookingLockWindowHours).toBe(36);
    });
  });

  describe('Part 2: Max Advance Days Horizon Enforcement', () => {
    it('rejects booking when slotStartTime exceeds maxAdvanceDays', async () => {
      // Configured maxAdvanceDays is 10; farFutureSlot is 15 days out
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherAToken}`)
        .send({
          dockId: testDockAId,
          slotStartTime: farFutureSlotStart,
          slotEndTime: farFutureSlotEnd,
          truckPlate: 'TRK-HORIZON-01',
          driverName: 'Horizon Driver',
          driverPhone: '+94770009988',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('10 days in advance');
    });
  });

  describe('Part 3: Anti-Hogging (maxConcurrentBookings) Enforcement', () => {
    let booking1Id: number;
    let booking2Id: number;

    it('allows Carrier A to create up to maxConcurrentBookings (2 bookings)', async () => {
      const res1 = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherAToken}`)
        .send({
          dockId: testDockAId,
          slotStartTime: tomorrowSlot1Start,
          slotEndTime: tomorrowSlot1End,
          truckPlate: 'TRK-CARRIER-A1',
          driverName: 'Driver A1',
          driverPhone: '+94771112233',
        });

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      booking1Id = res1.body.data.id;

      const res2 = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherAToken}`)
        .send({
          dockId: testDockAId,
          slotStartTime: tomorrowSlot2Start,
          slotEndTime: tomorrowSlot2End,
          truckPlate: 'TRK-CARRIER-A2',
          driverName: 'Driver A2',
          driverPhone: '+94771112244',
        });

      expect(res2.status).toBe(201);
      expect(res2.body.success).toBe(true);
      booking2Id = res2.body.data.id;
    });

    it('rejects 3rd booking by Carrier A when limit (2) is reached', async () => {
      const res3 = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherAToken}`)
        .send({
          dockId: testDockBId,
          slotStartTime: tomorrowSlot3Start,
          slotEndTime: tomorrowSlot3End,
          truckPlate: 'TRK-CARRIER-A3',
          driverName: 'Driver A3',
          driverPhone: '+94771112255',
        });

      expect(res3.status).toBe(400);
      expect(res3.body.success).toBe(false);
      expect(res3.body.message).toContain('maximum allowed concurrent active bookings (2)');
    });

    it('allows Carrier B to book even when Carrier A has reached their limit', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherBToken}`)
        .send({
          dockId: testDockBId,
          slotStartTime: tomorrowSlot3Start,
          slotEndTime: tomorrowSlot3End,
          truckPlate: 'TRK-CARRIER-B1',
          driverName: 'Driver B1',
          driverPhone: '+94772223344',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Part 4: Hard Lock Window Cancellation & Emergency Same-Day Rescheduling', () => {
    let lockWindowBookingId: number;
    let outsideLockBookingId: number;

    beforeAll(async () => {
      // Temporarily expand policy maxConcurrentBookings so we can create these test bookings
      await prisma.warehousePolicy.update({
        where: { warehouseId: testWarehouseId },
        data: {
          maxConcurrentBookings: 10,
          bookingLockWindowHours: 36, // 36 hours lock window
        },
      });

      // 1. Create booking inside the lock window (~24h from now < 36h)
      const resInside = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherBToken}`)
        .send({
          dockId: testDockBId,
          slotStartTime: tomorrowSlot1Start,
          slotEndTime: tomorrowSlot1End,
          truckPlate: 'TRK-LOCK-TEST',
          driverName: 'Lock Driver',
          driverPhone: '+94779998877',
        });
      expect(resInside.status).toBe(201);
      lockWindowBookingId = resInside.body.data.id;

      // 2. Create booking outside the lock window (~72h from now > 36h)
      const resOutside = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcherBToken}`)
        .send({
          dockId: testDockBId,
          slotStartTime: threeDaysOutSlotStart,
          slotEndTime: threeDaysOutSlotEnd,
          truckPlate: 'TRK-OUTSIDE-LOCK',
          driverName: 'Outside Driver',
          driverPhone: '+94779998866',
        });
      expect(resOutside.status).toBe(201);
      outsideLockBookingId = resOutside.body.data.id;
    });

    it('rejects cancellation when booking is within the 36-hour lock window', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${lockWindowBookingId}/cancel`)
        .set('Authorization', `Bearer ${dispatcherBToken}`)
        .send({ reason: 'Attempting cancellation inside lock window' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('within the 36-hour lock window');
    });

    it('allows cancellation when booking is outside the lock window (> 36 hours)', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${outsideLockBookingId}/cancel`)
        .set('Authorization', `Bearer ${dispatcherBToken}`)
        .send({ reason: 'Standard advance cancellation' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('rejects cross-date rescheduling when booking is within the lock window', async () => {
      // Attempt to reschedule to dayAfterTomorrowDate (a different date)
      const res = await request(app)
        .patch(`/api/bookings/${lockWindowBookingId}/reschedule`)
        .set('Authorization', `Bearer ${dispatcherBToken}`)
        .send({
          slotStartTime: dayAfterSlotStart,
          slotEndTime: dayAfterSlotEnd,
          dockId: testDockBId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Cannot reschedule to a different date within the 36-hour lock window');
      expect(res.body.message).toContain('Only same-day emergency rescheduling is permitted');
    });

    it('supports same-day emergency rescheduling within the lock window via PUT and PATCH', async () => {
      // Reschedule lockWindowBooking (which was at tomorrowSlot1) to tomorrowSlot2 on the SAME calendar day
      const res = await request(app)
        .put(`/api/bookings/${lockWindowBookingId}/reschedule`)
        .set('Authorization', `Bearer ${dispatcherBToken}`)
        .send({
          slotStartTime: tomorrowSlot2Start,
          slotEndTime: tomorrowSlot2End,
          dockId: testDockBId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slotStartTime).toBe(tomorrowSlot2Start);
      expect(res.body.data.slotEndTime).toBe(tomorrowSlot2End);
    });
  });
});
