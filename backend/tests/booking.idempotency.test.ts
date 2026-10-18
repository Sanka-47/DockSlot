import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';
import { cleanupExpiredIdempotencyRecords } from '../src/middleware/idempotency.middleware';

describe('Booking Idempotency & Mobile Retry Safety Tests', () => {
  let warehouseOrgId: number;
  let carrierOrgId: number;
  let testWarehouseId: number;
  let testDockId: number;
  let dispatcherId: number;
  let dispatcherToken: string;

  const testIdempotencyKey = `mobile-retry-test-${Date.now()}`;

  // Time slots in UTC (within 24/7 Colombo timezone)
  const slot1Start = '2026-11-01T04:00:00.000Z';
  const slot1End = '2026-11-01T04:30:00.000Z';

  const slot2Start = '2026-11-01T05:00:00.000Z';
  const slot2End = '2026-11-01T05:30:00.000Z';

  beforeAll(async () => {
    // 1. Create Warehouse Operator Organization
    const warehouseOrg = await prisma.organization.create({
      data: {
        name: `Warehouse Org Idemp ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgId = warehouseOrg.id;

    // 2. Create Warehouse with 24/7 operating hours and 30-min slots
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgId,
        name: 'Idempotency Test Distribution Center',
        address: '50 Harbor Way, Colombo, Sri Lanka',
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
          create: [{ name: 'Idempotency Dock 1', status: DockStatus.ACTIVE }],
        },
      },
      include: {
        docks: true,
      },
    });
    testWarehouseId = warehouse.id;
    testDockId = warehouse.docks[0].id;

    // 3. Create Carrier Organization
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Carrier Org Idemp ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    // 4. Create Dispatcher User
    const dispatcherUser = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `dispatcher_idemp_${Date.now()}@carrier.com`,
        passwordHash: 'hashed_password_test',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherId = dispatcherUser.id;

    dispatcherToken = jwt.sign(
      {
        userId: dispatcherUser.id,
        organizationId: carrierOrgId,
        role: dispatcherUser.role,
        email: dispatcherUser.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    try {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          key: {
            startsWith: 'mobile-retry-test-',
          },
        },
      });
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
      await prisma.user.deleteMany({ where: { id: dispatcherId } });
      await prisma.organization.deleteMany({ where: { id: { in: [warehouseOrgId, carrierOrgId] } } });
    } catch {
      // Ignore cleanup error if already removed
    } finally {
      await prisma.$disconnect();
    }
  });

  it('safely handles mobile network retries with Idempotency-Key without creating duplicate bookings or duplicate outbox events', async () => {
    const bookingPayload = {
      dockId: testDockId,
      slotStartTime: slot1Start,
      slotEndTime: slot1End,
      truckPlate: 'WP-CAD-1029',
      driverName: 'Kamal Perera',
      driverPhone: '+94771234567',
      cargoNote: 'Initial mobile booking attempt',
    };

    // First request with Idempotency-Key
    const firstResponse = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .set('Idempotency-Key', testIdempotencyKey)
      .send(bookingPayload);

    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body.success).toBe(true);
    expect(firstResponse.body.data.id).toBeDefined();
    const createdBookingId = firstResponse.body.data.id;

    // Verify idempotency record was stored in the database
    const storedRecord = await prisma.idempotencyRecord.findUnique({
      where: { key: testIdempotencyKey },
    });
    expect(storedRecord).not.toBeNull();
    expect(storedRecord?.responseCode).toBe(201);

    // Simulated mobile network retry: resending the EXACT same request with same Idempotency-Key
    const retryResponse = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .set('Idempotency-Key', testIdempotencyKey)
      .send(bookingPayload);

    // Verify:
    // 1. HTTP status is 201
    expect(retryResponse.status).toBe(201);
    // 2. Cache header indicates HIT
    expect(retryResponse.headers['x-cache-lookup']).toBe('HIT');
    // 3. Response body is identical to original response
    expect(retryResponse.body).toEqual(firstResponse.body);
    expect(retryResponse.body.data.id).toBe(createdBookingId);

    // 4. Verify only ONE booking record exists in the database
    const dbBookings = await prisma.booking.findMany({
      where: {
        dockId: testDockId,
        slotStartTime: new Date(slot1Start),
      },
    });
    expect(dbBookings.length).toBe(1);
    expect(dbBookings[0].id).toBe(createdBookingId);

    // 5. Verify Outbox events are NOT duplicated
    const outboxEvents = await prisma.outboxEvent.findMany({
      where: {
        aggregateType: 'BOOKING',
        aggregateId: createdBookingId,
      },
    });
    expect(outboxEvents.length).toBe(1);
    expect(outboxEvents[0].status).toBe('PENDING');
  });

  it('allows normal booking creation when Idempotency-Key header is absent', async () => {
    const bookingPayload = {
      dockId: testDockId,
      slotStartTime: slot2Start,
      slotEndTime: slot2End,
      truckPlate: 'WP-CAD-8844',
      driverName: 'Sunil Silva',
      driverPhone: '+94779876543',
      cargoNote: 'Normal booking without idempotency header',
    };

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send(bookingPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.headers['x-cache-lookup']).toBeUndefined();
  });

  it('prunes expired idempotency records using cleanupExpiredIdempotencyRecords', async () => {
    const expiredKey = `mobile-retry-test-expired-${Date.now()}`;
    const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago

    await prisma.idempotencyRecord.create({
      data: {
        key: expiredKey,
        responseCode: 201,
        responseBody: { success: true },
        createdAt: pastDate,
      },
    });

    // Cleanup records older than 24 hours
    const deletedCount = await cleanupExpiredIdempotencyRecords(24);
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    const checkRecord = await prisma.idempotencyRecord.findUnique({
      where: { key: expiredKey },
    });
    expect(checkRecord).toBeNull();
  });
});
