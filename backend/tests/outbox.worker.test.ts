import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import http from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import { securityConfig } from '../src/config/security.config';
import { outboxService, OUTBOX_STATUS } from '../src/services/outbox.service';
import { OutboxWorker } from '../src/workers/outbox.worker';
import { createMockCarrierApp } from '../src/mock-carrier/server';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';

/**
 * Automated coverage for the transactional outbox dispatcher - the background
 * worker behind the "booking API never blocks on the carrier webhook" guarantee.
 *
 * These are the highest-risk behaviours in the system: at-least-once delivery,
 * exponential backoff, permanent parking, lease recovery of orphaned events, and
 * - critically - that two workers draining the same table never double-deliver.
 * The carrier is stood up in-process so the whole flow runs without external
 * services.
 */

const AGGREGATE_TYPE = 'OUTBOX_TEST'; // isolates our rows from other suites' cleanup

describe('OutboxWorker (transactional outbox dispatcher)', () => {
  let carrierServer: Server;
  let carrier: ReturnType<typeof createMockCarrierApp>;
  let carrierUrl: string;

  // A second endpoint that always answers 4xx, used to prove non-retryable
  // responses are parked immediately instead of being retried.
  let rejectServer: Server;
  let rejectUrl: string;

  let worker: OutboxWorker;

  // Fixtures for the booking -> outbox end-to-end test.
  const ts = Date.now();
  let warehouseOrgId: number;
  let warehouseId: number;
  let dockId: number;
  let carrierOrgId: number;
  let dispatcherId: number;
  let dispatcherToken: string;
  const createdBookingIds: number[] = [];

  const listen = async (server: Server): Promise<string> => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/notify`;
  };

  const getRow = (id: number) => prisma.outboxEvent.findUnique({ where: { id } });

  let seq = 0;
  const nextAggregateId = () => 900_000_000 + ++seq;

  async function createEvent(opts: {
    status?: string;
    retryCount?: number;
    maxRetries?: number;
    nextRetryAt?: Date;
    eventId?: string;
    backdateMs?: number;
  } = {}) {
    const eventId = opts.eventId ?? randomUUID();
    const payload = outboxService.buildPayload(
      {
        aggregateType: AGGREGATE_TYPE,
        aggregateId: nextAggregateId(),
        eventType: 'BOOKING_CREATED',
        carrierOrg: { id: 1, name: 'Test Carrier' },
        booking: {
          id: 1,
          status: 'BOOKED',
          dockId: 1,
          dockName: 'Test Dock',
          warehouseId: 1,
          warehouseName: 'Test Warehouse',
          warehouseTimezone: 'Asia/Colombo',
          slotStartTime: '2026-11-20T04:30:00.000Z',
          slotEndTime: '2026-11-20T05:00:00.000Z',
          truckPlate: 'TEST-1',
          driverName: 'Tester',
          driverPhone: '+94770000000',
          cargoNote: null,
        },
        message: 'Outbox worker test event',
      },
      eventId
    );

    const row = await prisma.outboxEvent.create({
      data: {
        eventId,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: payload.aggregateId,
        payload: payload as any,
        status: opts.status ?? OUTBOX_STATUS.PENDING,
        retryCount: opts.retryCount ?? 0,
        maxRetries: opts.maxRetries ?? 5,
        nextRetryAt: opts.nextRetryAt ?? new Date(),
      },
    });

    if (opts.backdateMs) {
      await prisma.$executeRaw`UPDATE outbox_events SET updatedAt = ${new Date(
        Date.now() - opts.backdateMs
      )} WHERE id = ${row.id}`;
    }

    return row;
  }

  beforeAll(async () => {
    carrier = createMockCarrierApp({
      isEnabled: true,
      simulateChaos: false,
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    carrierServer = http.createServer(carrier.app);
    carrierUrl = await listen(carrierServer);
    process.env.CARRIER_NOTIFY_URL = carrierUrl;

    rejectServer = http.createServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'bad request' }));
    });
    rejectUrl = await listen(rejectServer);

    worker = new OutboxWorker();
    worker.config.batchSize = 10;
    worker.config.maxConcurrency = 5;
    worker.config.maxBatchesPerTick = 2;

    // --- fixtures for the end-to-end (API -> outbox -> delivery) test ---
    const warehouseOrg = await prisma.organization.create({
      data: { name: `Outbox Worker WH Org ${ts}`, type: OrganizationType.WAREHOUSE_OPERATOR },
    });
    warehouseOrgId = warehouseOrg.id;

    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgId,
        name: `Outbox Worker Hub ${ts}`,
        address: '1 Outbox Way, Colombo',
        timezone: 'Asia/Colombo',
        operatingHours: {
          create: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
            dayOfWeek,
            openTime: '00:00',
            closeTime: '24:00',
            slotLengthMinutes: 30,
          })),
        },
        docks: { create: [{ name: 'Outbox Dock 1', status: DockStatus.ACTIVE }] },
      },
      include: { docks: true },
    });
    warehouseId = warehouse.id;
    dockId = warehouse.docks[0].id;

    const carrierOrg = await prisma.organization.create({
      data: { name: `Outbox Worker Carrier Org ${ts}`, type: OrganizationType.CARRIER },
    });
    carrierOrgId = carrierOrg.id;

    const dispatcher = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `outbox_dispatcher_${ts}@worker.test`,
        passwordHash: 'hashed_password_test',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherId = dispatcher.id;
    dispatcherToken = jwt.sign(
      { userId: dispatcher.id, organizationId: carrierOrgId, role: dispatcher.role, email: dispatcher.email },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterEach(async () => {
    // Reset carrier state and remove this suite's synthetic rows.
    carrier.config.isEnabled = true;
    carrier.config.simulateChaos = false;
    process.env.CARRIER_NOTIFY_URL = carrierUrl;
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: AGGREGATE_TYPE } });
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: AGGREGATE_TYPE } });
    try {
      if (createdBookingIds.length > 0) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: createdBookingIds } } });
        await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
      }
      await prisma.dock.deleteMany({ where: { id: dockId } });
      await prisma.operatingHour.deleteMany({ where: { warehouseId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.user.deleteMany({ where: { id: dispatcherId } });
      await prisma.organization.deleteMany({ where: { id: { in: [warehouseOrgId, carrierOrgId] } } });
    } finally {
      await new Promise<void>((resolve) => carrierServer.close(() => resolve()));
      await new Promise<void>((resolve) => rejectServer.close(() => resolve()));
      await prisma.$disconnect();
    }
  });

  // ---------------------------------------------------------------------------

  it('delivers a due event once, marks it COMPLETED, and sends a stable X-Event-Id', async () => {
    const row = await createEvent();

    await worker.tick();

    expect((await getRow(row.id))?.status).toBe(OUTBOX_STATUS.COMPLETED);

    const deliveries = carrier.getLogs().filter((l) => l.eventId === row.eventId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].deliveryAttempt).toBe(1);
    expect(deliveries[0].isDuplicate).toBe(false);
    expect(deliveries[0].body.eventType).toBe('BOOKING_CREATED');
  }, 30000);

  it('returns a retryable failure to PENDING with exponential backoff, then delivers on retry', async () => {
    carrier.config.isEnabled = false; // every delivery -> HTTP 503 (retryable)
    const row = await createEvent();

    await worker.tick();

    const afterFailure = await getRow(row.id);
    expect(afterFailure?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(afterFailure?.retryCount).toBe(1);
    expect(new Date(afterFailure!.nextRetryAt).getTime()).toBeGreaterThan(Date.now());
    expect(afterFailure?.lastError).toBeTruthy();

    // Bring it due and re-enable the carrier: it must now complete.
    carrier.config.isEnabled = true;
    await prisma.outboxEvent.update({
      where: { id: row.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });

    await worker.tick();

    expect((await getRow(row.id))?.status).toBe(OUTBOX_STATUS.COMPLETED);
  }, 30000);

  it('parks an event as FAILED once maxRetries is exceeded', async () => {
    carrier.config.isEnabled = false;
    const row = await createEvent({ retryCount: 1, maxRetries: 1 });

    await worker.tick();

    const after = await getRow(row.id);
    expect(after?.status).toBe(OUTBOX_STATUS.FAILED);
    expect(after?.lastError).toMatch(/Exhausted/);
  }, 30000);

  it('parks a non-retryable 4xx response as FAILED without consuming retries', async () => {
    process.env.CARRIER_NOTIFY_URL = rejectUrl;
    const row = await createEvent();

    await worker.tick();

    const after = await getRow(row.id);
    expect(after?.status).toBe(OUTBOX_STATUS.FAILED);
    expect(after?.retryCount).toBe(0);
    expect(after?.lastError).toMatch(/Non-retryable/);
  }, 30000);

  it('requeues (and then delivers) an event orphaned in PROCESSING by a dead worker', async () => {
    const row = await createEvent({
      status: OUTBOX_STATUS.PROCESSING,
      backdateMs: 120_000,
      retryCount: 0,
    });

    const originalLease = worker.config.processingLeaseMs;
    worker.config.processingLeaseMs = 3000;
    try {
      await worker.tick();
    } finally {
      worker.config.processingLeaseMs = originalLease;
    }

    const after = await getRow(row.id);
    expect(after?.status).toBe(OUTBOX_STATUS.COMPLETED);
    expect(after?.retryCount).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('claims concurrently without any row being handed to two callers', async () => {
    const rows = await Promise.all([createEvent(), createEvent(), createEvent(), createEvent()]);
    const mine = new Set(rows.map((r) => r.id));

    const [a, b] = await Promise.all([
      outboxService.claimPendingEvents(4),
      outboxService.claimPendingEvents(4),
    ]);

    const claimedIds = [...a.map((r) => r.id), ...b.map((r) => r.id)];

    // No row may appear in both results.
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    // And all four of our rows are claimed exactly once, in total.
    expect(claimedIds.filter((id) => mine.has(id)).sort()).toEqual([...mine].sort());
  }, 30000);

  it('never double-delivers when two workers drain the same table', async () => {
    const rows = await Promise.all([
      createEvent(),
      createEvent(),
      createEvent(),
      createEvent(),
    ]);

    const secondWorker = new OutboxWorker();
    secondWorker.config.batchSize = 4;
    secondWorker.config.maxConcurrency = 4;
    secondWorker.config.maxBatchesPerTick = 1;
    worker.config.batchSize = 4;
    worker.config.maxConcurrency = 4;
    worker.config.maxBatchesPerTick = 1;

    try {
      await Promise.all([worker.tick(), secondWorker.tick()]);
    } finally {
      worker.config.batchSize = 10;
      worker.config.maxConcurrency = 5;
      worker.config.maxBatchesPerTick = 2;
    }

    for (const row of rows) {
      expect((await getRow(row.id))?.status).toBe(OUTBOX_STATUS.COMPLETED);
      const deliveries = carrier.getLogs().filter((l) => l.eventId === row.eventId);
      expect(deliveries).toHaveLength(1);
    }
  }, 30000);

  it('enqueues on booking and delivers it - without blocking the booking response', async () => {
    // Make the webhook slow: a blocking implementation would hold POST /bookings
    // open for this long. Chaos stays on but with a deterministic delay and no
    // failures, so the only effect is latency.
    carrier.config.simulateChaos = true;
    carrier.config.minDelayMs = 1500;
    carrier.config.maxDelayMs = 1500;
    carrier.config.failRate = 0;
    carrier.config.hangRate = 0;

    // A future, 30-minute-aligned slot in a 24/7 warehouse.
    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    start.setUTCMinutes(start.getUTCMinutes() >= 30 ? 30 : 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const t0 = Date.now();
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        dockId,
        slotStartTime: start.toISOString(),
        slotEndTime: end.toISOString(),
        truckPlate: 'OUTBOX-1',
        driverName: 'Outbox Tester',
        driverPhone: '+94770000000',
      });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(201);
    expect(elapsed).toBeLessThan(1200); // must not wait for the 1500ms webhook

    const bookingId = res.body.data.id as number;
    createdBookingIds.push(bookingId);

    const row = await prisma.outboxEvent.findFirst({
      where: { aggregateType: 'BOOKING', aggregateId: bookingId },
    });
    expect(row).not.toBeNull();
    expect(row?.status).toBe(OUTBOX_STATUS.PENDING); // not yet dispatched

    // Now drain the queue: the event is delivered exactly once and completed.
    await worker.tick();

    const after = await prisma.outboxEvent.findUnique({ where: { id: row!.id } });
    expect(after?.status).toBe(OUTBOX_STATUS.COMPLETED);
    const deliveries = carrier.getLogs().filter((l) => l.eventId === row!.eventId);
    expect(deliveries).toHaveLength(1);
  }, 60000);
});
