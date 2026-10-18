import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';

describe('Booking Concurrency & Double-Booking Prevention Integration Tests', () => {
  let warehouseOrgId: number;
  let carrierOrgId: number;
  let testWarehouseId: number;
  let testDockId: number;
  const dispatchers: Array<{ id: number; token: string }> = [];

  // A future slot time strictly within operating hours (Asia/Colombo UTC+5:30)
  // Local time: 2026-10-25 10:00:00 to 10:30:00 (30 min) -> UTC: 04:30:00 to 05:00:00
  const slotStartTime = '2026-10-25T04:30:00.000Z';
  const slotEndTime = '2026-10-25T05:00:00.000Z';

  beforeAll(async () => {
    // 1. Create a test Warehouse Operator Organization
    const warehouseOrg = await prisma.organization.create({
      data: {
        name: `Warehouse Org Concurrency ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgId = warehouseOrg.id;

    // 2. Create Warehouse with 24/7 operating hours and 30-min slots
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgId,
        name: 'Concurrency Test Distribution Hub',
        address: '100 Speed Lane, Colombo, Sri Lanka',
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
          create: [{ name: 'High Contention Dock 1', status: DockStatus.ACTIVE }],
        },
      },
      include: {
        docks: true,
      },
    });
    testWarehouseId = warehouse.id;
    testDockId = warehouse.docks[0].id;

    // 3. Create a Carrier Organization
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Carrier Org Concurrency ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    // 4. Create 10 simulated Carrier Dispatchers with valid JWT tokens
    for (let i = 1; i <= 10; i++) {
      const dispatcherUser = await prisma.user.create({
        data: {
          organizationId: carrierOrgId,
          email: `dispatcher_c${i}_${Date.now()}@concurrency.com`,
          passwordHash: 'hashed_password_test',
          role: UserRole.DISPATCHER,
          isActive: true,
          isEmailVerified: true,
        },
      });

      const token = jwt.sign(
        {
          userId: dispatcherUser.id,
          organizationId: carrierOrgId,
          role: dispatcherUser.role,
          email: dispatcherUser.email,
        },
        securityConfig.jwtSecret,
        { expiresIn: '1h' }
      );

      dispatchers.push({ id: dispatcherUser.id, token });
    }
  });

  afterAll(async () => {
    // Clean up created test entities
    try {
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: 'BOOKING',
          payload: {
            path: '$.booking.dockId',
            equals: testDockId,
          },
        },
      });
      await prisma.booking.deleteMany({ where: { dockId: testDockId } });
      await prisma.dock.deleteMany({ where: { id: testDockId } });
      await prisma.operatingHour.deleteMany({ where: { warehouseId: testWarehouseId } });
      await prisma.warehouse.deleteMany({ where: { id: testWarehouseId } });
      await prisma.user.deleteMany({ where: { id: { in: dispatchers.map((d) => d.id) } } });
      await prisma.organization.deleteMany({ where: { id: { in: [warehouseOrgId, carrierOrgId] } } });
    } catch {
      // Ignore cleanup error if already deleted
    } finally {
      await prisma.$disconnect();
    }
  });

  it('proves double-booking is impossible under heavy concurrency: 10 concurrent requests -> exactly 1 succeeds, 9 fail with 409', async () => {
    // Fire 10 concurrent booking requests for the exact same dockId and slotStartTime simultaneously
    const bookingPromises = dispatchers.map((dispatcher, index) =>
      request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${dispatcher.token}`)
        .send({
          dockId: testDockId,
          slotStartTime,
          slotEndTime,
          truckPlate: `TRK-CONC-${index + 1}`,
          driverName: `Driver ${index + 1}`,
          driverPhone: `+9477000000${index}`,
          cargoNote: `High contention concurrent booking attempt ${index + 1}`,
        })
    );

    const responses = await Promise.all(bookingPromises);

    // Group responses by status code
    const successfulResponses = responses.filter((res) => res.status === 201);
    const conflictResponses = responses.filter((res) => res.status === 409);

    console.log(`Concurrent test finished:`);
    console.log(` - 201 Created count: ${successfulResponses.length}`);
    console.log(` - 409 Conflict count: ${conflictResponses.length}`);

    // Assert: Exactly 1 request must succeed with 201
    expect(successfulResponses.length).toBe(1);
    expect(successfulResponses[0].body.success).toBe(true);
    expect(successfulResponses[0].body.data.id).toBeDefined();

    // Assert: Exactly 9 requests must fail with 409 Conflict
    expect(conflictResponses.length).toBe(9);
    for (const res of conflictResponses) {
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Conflict');
    }

    // Verify database state: exactly 1 booking record must exist for this dock and time slot
    const dbBookings = await prisma.booking.findMany({
      where: {
        dockId: testDockId,
        slotStartTime: new Date(slotStartTime),
      },
    });

    expect(dbBookings.length).toBe(1);
    expect(dbBookings[0].status).toBe('BOOKED');

    // Verify transactional Outbox event was created for the winning booking
    const winningBookingId = successfulResponses[0].body.data.id;
    const outboxEvent = await prisma.outboxEvent.findFirst({
      where: {
        aggregateType: 'BOOKING',
        aggregateId: winningBookingId,
      },
    });

    expect(outboxEvent).not.toBeNull();
    expect(outboxEvent?.status).toBe('PENDING');
  });

  it('rejects booking requests missing required fields with HTTP 400', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatchers[0].token}`)
      .send({
        dockId: testDockId,
        // missing slotStartTime, slotEndTime, truckPlate, etc.
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Missing required fields');
  });

  it('rejects booking creation if user is not a Carrier Dispatcher (RBAC guard)', async () => {
    // Generate a token for a CARRIER_ADMIN instead of DISPATCHER
    const carrierAdminToken = jwt.sign(
      {
        userId: dispatchers[0].id,
        organizationId: carrierOrgId,
        role: UserRole.CARRIER_ADMIN,
        email: 'admin@carrier.com',
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${carrierAdminToken}`)
      .send({
        dockId: testDockId,
        slotStartTime: '2026-10-26T04:30:00.000Z',
        slotEndTime: '2026-10-26T05:00:00.000Z',
        truckPlate: 'TRK-TEST',
        driverName: 'Test Driver',
        driverPhone: '+94771234567',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Forbidden');
  });
});
