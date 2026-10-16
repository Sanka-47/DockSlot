/**
 * Scratch integration test: Transactional Outbox + Background Polling Worker.
 *
 * Run with:
 *   npx ts-node src/test/scratch_test_outbox.ts
 *
 * Requires the Mock Carrier Notify API to be running on port 4001:
 *   npm run start:mock-carrier
 *
 * Verifies:
 *   1. Booking endpoints return immediately (never block on the webhook HTTP call).
 *   2. The outbox row is written atomically with the booking (rollback on conflict).
 *   3. Events are delivered exactly once, carrying a stable X-Event-Id idempotency key.
 *   4. Create / reschedule / cancel / status-change each enqueue the right event type.
 *   5. Failures retry with exponential backoff, then park as FAILED after maxRetries.
 *   6. Two concurrent workers never double-deliver the same event.
 */

// NOTE: env must be set before the modules that read it are required.
process.env.OUTBOX_POLL_INTERVAL_MS = '1500';
process.env.OUTBOX_MAX_CONCURRENCY = '4';
process.env.RATE_LIMIT_BOOKING_MAX = '200';
process.env.RATE_LIMIT_API_MAX = '5000';

import http from 'http';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { formatInTimeZone } from 'date-fns-tz';

const app = require('../app').default;
const { prisma } = require('../config/db.config');
const { outboxWorker, OutboxWorker } = require('../workers/outbox.worker');
const { outboxService } = require('../services/outbox.service');

const APP_PORT = 5097;
const BASE_URL = `http://localhost:${APP_PORT}/api`;
const CARRIER_URL = 'http://localhost:4001';

let passed = 0;
let failed = 0;

/**
 * Picks a warehouse that makes booking setup trivial: 24/7 opening hours with a
 * uniform slot length, at least one ACTIVE dock, and no booking policy.
 */
async function resolveFixture() {
  const candidates = await prisma.warehouse.findMany({
    where: { policy: null },
    include: {
      docks: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } },
      operatingHours: true,
    },
  });

  for (const warehouse of candidates) {
    const hours = warehouse.operatingHours;
    if (warehouse.docks.length === 0 || hours.length < 7) continue;

    const alwaysOpen = hours.every(
      (h: any) => h.openTime === '00:00' && (h.closeTime === '24:00' || h.closeTime === '00:00')
    );
    const uniformLength = hours.every(
      (h: any) => h.slotLengthMinutes === hours[0].slotLengthMinutes
    );
    if (alwaysOpen && uniformLength) {
      return {
        warehouseId: warehouse.id as number,
        warehouseName: warehouse.name as string,
        organizationId: warehouse.organizationId as number,
        slotMinutes: hours[0].slotLengthMinutes as number,
      };
    }
  }

  throw new Error('No 24/7 policy-free warehouse with an ACTIVE dock was found.');
}

/**
 * The status-change endpoint requires a DOCK_MANAGER in the warehouse operator's
 * organization. Existing scratch users have unknown passwords, so create a
 * throwaway one (removed in the teardown) rather than guessing credentials.
 */
async function createTempDockManager(organizationId: number) {
  const email = `outbox-temp-dock-mgr-${Date.now()}@dockslot.test`;
  const user = await prisma.user.create({
    data: {
      organizationId,
      email,
      passwordHash: await bcrypt.hash('12345678', 10),
      role: 'DOCK_MANAGER',
      isActive: true,
      isEmailVerified: true,
    },
    select: { id: true, email: true },
  });
  return user;
}

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`   PASS  ${label}`);
  } else {
    failed++;
    console.error(`   FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  let body: any = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

async function login(email: string) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: '12345678' }),
  });
  const json: any = await res.json();
  if (!json?.data?.token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { token: json.data.token as string, orgId: json.data.user.organizationId as number };
}

async function setCarrierConfig(config: Record<string, unknown>) {
  const res = await fetch(`${CARRIER_URL}/api/carrier/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to configure mock carrier: HTTP ${res.status}`);
  return res.json();
}

async function clearCarrierLogs() {
  await fetch(`${CARRIER_URL}/api/carrier/logs`, { method: 'DELETE' });
}

interface CarrierLog {
  eventId?: string;
  key: string;
  isDuplicate: boolean;
  deliveryAttempt: number;
  body: any;
}

async function getCarrierLogs(): Promise<CarrierLog[]> {
  const res = await fetch(`${CARRIER_URL}/api/carrier/logs`);
  const json: any = await res.json();
  return json.logs || [];
}

function deliveriesFor(logs: CarrierLog[], eventId: string) {
  return logs.filter((log) => log.eventId === eventId || log.key === `event:${eventId}`);
}

async function getOutboxRow(where: Record<string, unknown>) {
  return prisma.outboxEvent.findFirst({ where, orderBy: { id: 'desc' } });
}

/** Polls until `predicate(row)` holds or the timeout elapses. */
async function waitForOutbox(
  where: Record<string, unknown>,
  predicate: (row: any) => boolean,
  timeoutMs: number,
  label: string
) {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    last = await getOutboxRow(where);
    if (last && predicate(last)) return last;
    await sleep(400);
  }
  return last;
}

/** Finds the next bookable slot on the fixture warehouse. */
async function findSlot(token: string, offsetDays: number, dockIndex = 0) {
  const date = formatInTimeZone(
    new Date(Date.now() + offsetDays * 86400000),
    'Asia/Colombo',
    'yyyy-MM-dd'
  );
  const res = await api(
    `/warehouses/${FIXTURE.warehouseId}/slots?date=${date}`,
    token
  );
  const docks = res.body?.data || [];
  const dock = docks[dockIndex % Math.max(docks.length, 1)];
  const slot = dock?.slots?.[0];
  if (!slot) {
    throw new Error(
      `No slots available in warehouse ${FIXTURE.warehouseId} on ${date}: ` +
        JSON.stringify(res.body).slice(0, 300)
    );
  }
  return { dockId: dock.dockId as number, ...slot };
}

let FIXTURE: {
  warehouseId: number;
  warehouseName: string;
  organizationId: number;
  slotMinutes: number;
};

(async () => {
  console.log('=== Transactional Outbox + Background Worker Integration Test ===\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(APP_PORT, () => resolve()));

  const secondWorker = new OutboxWorker();
  let bookingCounter = 0;
  let tempDockManagerId: number | null = null;

  try {
    // ---------------------------------------------------------------- SETUP
    FIXTURE = await resolveFixture();
    const tempDockManager = await createTempDockManager(FIXTURE.organizationId);
    tempDockManagerId = tempDockManager.id;
    const dispatcher = await login('dispatcher@swiftfreight.com');
    const dispatcher2 = await login('dispatcher@falconexpress.com');
    const dockManager = await login(tempDockManager.email);
    console.log(
      `Setup: warehouse=${FIXTURE.warehouseName} (id ${FIXTURE.warehouseId}, ${FIXTURE.slotMinutes}m slots)\n` +
        `       dispatcher=${dispatcher.orgId} dispatcher2=${dispatcher2.orgId} dockManager=${tempDockManager.email}\n`
    );

    await clearCarrierLogs();

    // Only judge events created by this run when checking for stranded rows.
    const baseline = await prisma.outboxEvent.findFirst({ orderBy: { id: 'desc' } });
    const baselineEventId = baseline ? baseline.id : 0;

    // Run the dispatcher inside this process so the test is self-contained and
    // does not depend on a separately running dev server.
    outboxWorker.start();
    console.log(`Worker started in-process (polling every ${outboxWorker.config.pollIntervalMs}ms)\n`);

    const makeBookingBody = (slot: any, plateSuffix: string) => ({
      dockId: slot.dockId,
      slotStartTime: slot.slotStartTime,
      slotEndTime: slot.slotEndTime,
      truckPlate: `OBX-${plateSuffix}`,
      driverName: 'Outbox Tester',
      driverPhone: '+94770000000',
      cargoNote: 'Transactional outbox integration test',
    });

    // ------------------------------------------------- TEST 1: non-blocking
    console.log('--- TEST 1: Booking API must not block on the webhook ---');
    // Force every webhook delivery to take 5s. A blocking implementation would
    // make POST /bookings take >= 5s.
    await setCarrierConfig({
      enabled: true,
      simulateChaos: true,
      minDelayMs: 5000,
      maxDelayMs: 5000,
      failRate: 0,
      hangRate: 0,
    });

    const slotA = await findSlot(dispatcher.token, 3, 0);
    const t0 = Date.now();
    const createA = await api('/bookings', dispatcher.token, {
      method: 'POST',
      body: JSON.stringify(makeBookingBody(slotA, `A${++bookingCounter}`)),
    });
    const createMs = Date.now() - t0;
    console.log(`   POST /bookings responded in ${createMs}ms (webhook takes 5000ms)`);
    check('booking created (HTTP 201)', createA.status === 201, `HTTP ${createA.status}: ${JSON.stringify(createA.body).slice(0, 200)}`);
    check(`response not blocked by 5s webhook (${createMs}ms < 1500ms)`, createMs < 1500, `${createMs}ms`);

    const bookingAId = createA.body?.data?.id as number;
    const rowA = await getOutboxRow({ aggregateId: bookingAId });
    check('outbox row written with the booking', !!rowA, 'no outbox row found');
    check(
      'eventId generated',
      typeof rowA?.eventId === 'string' && rowA.eventId.length === 36,
      `eventId=${rowA?.eventId}`
    );

    // ------------------------------------------------- TEST 2: atomicity
    console.log('\n--- TEST 2: Outbox insert is atomic with the booking ---');
    const beforeConflict = await prisma.outboxEvent.count();
    const conflict = await api('/bookings', dispatcher.token, {
      method: 'POST',
      body: JSON.stringify(makeBookingBody(slotA, `DUP${++bookingCounter}`)),
    });
    const afterConflict = await prisma.outboxEvent.count();
    check('duplicate slot rejected (HTTP 409)', conflict.status === 409, `HTTP ${conflict.status}`);
    check(
      'no outbox row left behind by the rolled-back booking',
      beforeConflict === afterConflict,
      `${beforeConflict} -> ${afterConflict}`
    );

    // ------------------------------------------------- TEST 3: delivery
    console.log('\n--- TEST 3: Delivery with idempotency key ---');
    const doneA = await waitForOutbox({ id: rowA.id }, (row) => row.status === 'COMPLETED', 40000, 'COMPLETED');
    check('event reached COMPLETED', doneA?.status === 'COMPLETED', `status=${doneA?.status} lastError=${doneA?.lastError}`);

    const logsAfterA = await getCarrierLogs();
    const deliveriesA = deliveriesFor(logsAfterA, rowA.eventId);
    check('delivered exactly once', deliveriesA.length === 1, `${deliveriesA.length} deliveries`);
    check('delivered on first attempt (not flagged duplicate)', deliveriesA[0]?.deliveryAttempt === 1 && deliveriesA[0]?.isDuplicate === false, JSON.stringify({ attempt: deliveriesA[0]?.deliveryAttempt, dup: deliveriesA[0]?.isDuplicate }));

    const payloadA = deliveriesA[0]?.body;
    check('payload.eventType = BOOKING_CREATED', payloadA?.eventType === 'BOOKING_CREATED', `eventType=${payloadA?.eventType}`);
    check('payload carries carrierOrg details', !!payloadA?.carrierOrg?.name, JSON.stringify(payloadA?.carrierOrg));
    check('payload carries booking summary', payloadA?.booking?.id === bookingAId && !!payloadA?.booking?.dockName, JSON.stringify(payloadA?.booking)?.slice(0, 200));
    check('payload carries human-readable message', typeof payloadA?.message === 'string' && payloadA.message.includes(`#${bookingAId}`), payloadA?.message);
    check('payload.eventId matches X-Event-Id header', payloadA?.eventId === rowA.eventId, `body=${payloadA?.eventId} header=${deliveriesA[0]?.eventId}`);
    console.log(`   message: ${payloadA?.message}`);

    // --------------------------------- TEST 4: reschedule + cancel events
    console.log('\n--- TEST 4: Reschedule and cancel enqueue their own events ---');
    // Keep the webhook slow so the latency assertions below are meaningful.
    const slotA2 = await findSlot(dispatcher.token, 4, 1);
    const tResched = Date.now();
    const resched = await api(`/bookings/${bookingAId}/reschedule`, dispatcher.token, {
      method: 'PATCH',
      body: JSON.stringify({
        dockId: slotA2.dockId,
        slotStartTime: slotA2.slotStartTime,
        slotEndTime: slotA2.slotEndTime,
        reason: 'Carrier rerouted the load',
      }),
    });
    const reschedMs = Date.now() - tResched;
    check('reschedule accepted (HTTP 200)', resched.status === 200, `HTTP ${resched.status}: ${JSON.stringify(resched.body).slice(0, 200)}`);
    check(`PATCH /reschedule not blocked by the 5s webhook (${reschedMs}ms < 1500ms)`, reschedMs < 1500, `${reschedMs}ms`);

    const rowResched = await waitForOutbox(
      { aggregateId: bookingAId, id: { gt: rowA.id } },
      (row) => row.status === 'COMPLETED',
      40000,
      'reschedule COMPLETED'
    );
    check('BOOKING_RESCHEDULED delivered', rowResched?.payload?.eventType === 'BOOKING_RESCHEDULED' && rowResched.status === 'COMPLETED', `type=${rowResched?.payload?.eventType} status=${rowResched?.status}`);
    check('reschedule payload retains old slot in changes', rowResched?.payload?.changes?.oldSlotStartTime === slotA.slotStartTime, JSON.stringify(rowResched?.payload?.changes).slice(0, 200));

    const tCancel = Date.now();
    const cancel = await api(`/bookings/${bookingAId}/cancel`, dispatcher.token, {
      method: 'PATCH',
      body: JSON.stringify({ reason: 'Customer cancelled the shipment' }),
    });
    const cancelMs = Date.now() - tCancel;
    check('cancel accepted (HTTP 200)', cancel.status === 200, `HTTP ${cancel.status}`);
    check(`PATCH /cancel not blocked by the 5s webhook (${cancelMs}ms < 1500ms)`, cancelMs < 1500, `${cancelMs}ms`);

    const rowCancelled = await waitForOutbox(
      { aggregateId: bookingAId, id: { gt: rowResched.id } },
      (row) => row.status === 'COMPLETED',
      40000,
      'cancel COMPLETED'
    );
    check('BOOKING_CANCELLED delivered', rowCancelled?.payload?.eventType === 'BOOKING_CANCELLED' && rowCancelled.status === 'COMPLETED', `type=${rowCancelled?.payload?.eventType} status=${rowCancelled?.status}`);

    // --------------------------------------- TEST 5: status-change event
    console.log('\n--- TEST 5: Operational status change enqueues an event ---');
    const slotB = await findSlot(dispatcher.token, 5);
    const createB = await api('/bookings', dispatcher.token, {
      method: 'POST',
      body: JSON.stringify(makeBookingBody(slotB, `B${++bookingCounter}`)),
    });
    const bookingBId = createB.body?.data?.id as number;
    check('booking B created', createB.status === 201, `HTTP ${createB.status}`);

    // Status may only change after the slot start has passed, so move it into the past.
    const pastStart = new Date(Date.now() - 3 * 3600 * 1000);
    const pastEnd = new Date(pastStart.getTime() + FIXTURE.slotMinutes * 60 * 1000);
    await prisma.booking.update({
      where: { id: bookingBId },
      data: { slotStartTime: pastStart, slotEndTime: pastEnd },
    });

    const statusChange = await api(`/bookings/${bookingBId}/status`, dockManager.token, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ARRIVED' }),
    });
    check('status change accepted (HTTP 200)', statusChange.status === 200, `HTTP ${statusChange.status}: ${JSON.stringify(statusChange.body).slice(0, 200)}`);

    const rowStatus = await waitForOutbox(
      { aggregateId: bookingBId },
      (row) => row.status === 'COMPLETED' && row.payload?.eventType === 'BOOKING_STATUS_CHANGED',
      40000,
      'status COMPLETED'
    );
    check('BOOKING_STATUS_CHANGED delivered', rowStatus?.status === 'COMPLETED', `status=${rowStatus?.status} type=${rowStatus?.payload?.eventType}`);

    // -------------------------------------------- TEST 6: retry/backoff
    console.log('\n--- TEST 6: Failure retries with exponential backoff ---');
    await setCarrierConfig({ enabled: false }); // every delivery -> HTTP 503
    const slotC = await findSlot(dispatcher.token, 6);
    const createC = await api('/bookings', dispatcher.token, {
      method: 'POST',
      body: JSON.stringify(makeBookingBody(slotC, `C${++bookingCounter}`)),
    });
    const bookingCId = createC.body?.data?.id as number;
    check('booking C created', createC.status === 201, `HTTP ${createC.status}`);

    const rowCStart = await getOutboxRow({ aggregateId: bookingCId });
    const observed: Array<{ retryCount: number; delayMs: number }> = [];
    const seen = new Set<number>();
    const backoffDeadline = Date.now() + 60000;

    while (Date.now() < backoffDeadline && observed.length < 3) {
      const row = await getOutboxRow({ id: rowCStart.id });
      if (row && row.retryCount > 0 && !seen.has(row.retryCount)) {
        seen.add(row.retryCount);
        const delayMs = new Date(row.nextRetryAt).getTime() - new Date(row.updatedAt).getTime();
        observed.push({ retryCount: row.retryCount, delayMs });
        console.log(
          `   attempt ${row.retryCount} failed -> status=${row.status} nextRetryAt in ~${delayMs}ms` +
            ` | lastError="${String(row.lastError).slice(0, 90)}..."`
        );
      }
      if (row && row.status === 'PENDING' && row.retryCount >= 3) break;
      await sleep(300);
    }

    check('at least 3 failed attempts recorded', observed.length >= 3, `observed ${observed.length}`);
    check('status reverted to PENDING between attempts', (await getOutboxRow({ id: rowCStart.id }))?.status === 'PENDING');

    for (const attempt of observed) {
      const expected = 1000 * Math.pow(2, attempt.retryCount);
      const withinJitter = attempt.delayMs >= expected && attempt.delayMs <= expected * 1.25 + 150;
      check(
        `attempt ${attempt.retryCount} backed off ~${expected}ms (2^${attempt.retryCount} * 1000) + jitter`,
        withinJitter,
        `observed ${attempt.delayMs}ms`
      );
    }
    if (observed.length >= 2) {
      const ratio = observed[1].delayMs / observed[0].delayMs;
      check(`backoff grows exponentially (ratio ${ratio.toFixed(2)}x ~= 2x)`, ratio > 1.5 && ratio < 2.5, `ratio=${ratio}`);
    }

    console.log('   Re-enabling the carrier service; the queued event should now deliver...');
    await setCarrierConfig({ enabled: true, simulateChaos: false });
    const rowCDone = await waitForOutbox({ id: rowCStart.id }, (row) => row.status === 'COMPLETED', 60000, 'COMPLETED');
    check('backlogged event recovered and delivered after the outage', rowCDone?.status === 'COMPLETED', `status=${rowCDone?.status} retryCount=${rowCDone?.retryCount}`);
    check('retryCount preserved on the record', (rowCDone?.retryCount || 0) >= 3, `retryCount=${rowCDone?.retryCount}`);

    const logsC = await getCarrierLogs();
    check('delivered exactly once despite retries', deliveriesFor(logsC, rowCStart.eventId).length === 1, `${deliveriesFor(logsC, rowCStart.eventId).length} deliveries`);

    // ------------------------------------------- TEST 7: terminal FAILED
    console.log('\n--- TEST 7: Events park as FAILED once retries are exhausted ---');
    await setCarrierConfig({ enabled: false });
    const slotD = await findSlot(dispatcher.token, 7);
    const createD = await api('/bookings', dispatcher.token, {
      method: 'POST',
      body: JSON.stringify(makeBookingBody(slotD, `D${++bookingCounter}`)),
    });
    const bookingDId = createD.body?.data?.id as number;
    const rowDStart = await getOutboxRow({ aggregateId: bookingDId });
    check('booking D created', createD.status === 201, `HTTP ${createD.status}`);

    // Force the next failure to be the last permitted one.
    await prisma.outboxEvent.update({
      where: { id: rowDStart.id },
      data: { retryCount: 1, maxRetries: 1, nextRetryAt: new Date() },
    });

    const rowDFailed = await waitForOutbox({ id: rowDStart.id }, (row) => row.status === 'FAILED', 45000, 'FAILED');
    check('event parked as FAILED', rowDFailed?.status === 'FAILED', `status=${rowDFailed?.status}`);
    check(
      'retryCount exceeded maxRetries and is recorded',
      rowDFailed?.retryCount === 2 && rowDFailed?.maxRetries === 1,
      `retryCount=${rowDFailed?.retryCount} maxRetries=${rowDFailed?.maxRetries}`
    );
    check('failure reason stored for administrative review', typeof rowDFailed?.lastError === 'string' && rowDFailed.lastError.includes('Exhausted'), String(rowDFailed?.lastError).slice(0, 160));
    console.log(`   lastError: ${String(rowDFailed?.lastError).slice(0, 160)}`);

    // ------------------------------- TEST 8: concurrent workers, exactly once
    console.log('\n--- TEST 8: Two concurrent workers must not double-deliver ---');
    await setCarrierConfig({ enabled: true, simulateChaos: false });
    await clearCarrierLogs();
    secondWorker.start(); // a second poller competing for the same outbox rows
    console.log(
      '   two workers now claim from the same table ' +
        `(singleton + extra instance, both polling every ${secondWorker.config.pollIntervalMs}ms)`
    );

    const burst = [];
    for (let i = 0; i < 5; i++) {
      const token = i % 2 === 0 ? dispatcher.token : dispatcher2.token;
      const slot = await findSlot(token, 8 + i, i);
      burst.push(
        api('/bookings', token, {
          method: 'POST',
          body: JSON.stringify(makeBookingBody(slot, `E${i}${++bookingCounter}`)),
        })
      );
    }
    const burstResults = await Promise.all(burst);
    const burstOk = burstResults.filter((r) => r.status === 201);
    console.log(`   ${burstOk.length}/${burstResults.length} simultaneous bookings accepted`);
    check('all burst bookings accepted', burstOk.length === 5, JSON.stringify(burstResults.map((r) => r.status)));

    const burstIds = burstOk.map((r) => r.body.data.id as number);
    const burstRows = await prisma.outboxEvent.findMany({ where: { aggregateId: { in: burstIds } } });
    const burstDeadline = Date.now() + 60000;
    let settled = false;
    while (Date.now() < burstDeadline) {
      const rows = await prisma.outboxEvent.findMany({ where: { aggregateId: { in: burstIds } } });
      if (rows.length === burstIds.length && rows.every((r: any) => r.status === 'COMPLETED')) {
        settled = true;
        break;
      }
      await sleep(500);
    }
    check('all burst events COMPLETED', settled, `${burstRows.length} rows for ${burstIds.length} bookings`);

    const logsBurst = await getCarrierLogs();
    let allExactlyOnce = true;
    const detail: string[] = [];
    for (const row of burstRows as any[]) {
      const count = deliveriesFor(logsBurst, row.eventId).length;
      detail.push(`${row.eventId.slice(0, 8)}=${count}`);
      if (count !== 1) allExactlyOnce = false;
    }
    check('exactly one delivery per event across concurrent workers', allExactlyOnce, detail.join(' '));
    console.log(`   deliveries per event: ${detail.join(' ')}`);

    // ------------------------------------------- TEST 9: no stranded events
    console.log('\n--- TEST 9: No event left stranded in a non-terminal state ---');
    await sleep(1500);
    const ourEvents = await prisma.outboxEvent.findMany({
      where: { id: { gt: baselineEventId } },
      select: { id: true, status: true, retryCount: true, lastError: true },
    });
    const stranded = ourEvents.filter((row: any) => row.status !== 'COMPLETED' && row.status !== 'FAILED');
    check(
      `all ${ourEvents.length} events produced by this test reached a terminal state`,
      stranded.length === 0,
      `${stranded.length} stranded: ${stranded.map((r: any) => `${r.id}=${r.status}`).join(', ')}`
    );
    const stats = await prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } });
    console.log(
      `   outbox totals: ${stats.map((s: any) => `${s.status}=${s._count._all}`).join(' ')}`
    );

    // ------------------------------- TEST 10: recovery of orphaned PROCESSING
    console.log('\n--- TEST 10: Events orphaned mid-delivery are requeued ---');
    await setCarrierConfig({ enabled: true, simulateChaos: false });
    await clearCarrierLogs();

    // Simulate a worker that died mid-dispatch: a PROCESSING row whose lease has
    // expired and which no live worker owns.
    const orphanEventId = randomUUID();
    const orphanPayload = outboxService.buildPayload(
      {
        aggregateType: 'BOOKING',
        aggregateId: bookingBId,
        eventType: 'BOOKING_CREATED',
        carrierOrg: { id: dispatcher.orgId, name: 'Swift Freight (orphan recovery)' },
        booking: {
          id: bookingBId,
          status: 'BOOKED',
          dockId: slotB.dockId,
          dockName: 'Orphaned delivery simulation',
          warehouseId: FIXTURE.warehouseId,
          warehouseName: FIXTURE.warehouseName,
          warehouseTimezone: 'Asia/Colombo',
          slotStartTime: slotB.slotStartTime,
          slotEndTime: slotB.slotEndTime,
          truckPlate: 'ORPHAN-1',
          driverName: 'Orphan',
          driverPhone: '+94770000001',
          cargoNote: null,
        },
        message: 'Synthetic event used to verify orphaned-claim recovery.',
      },
      orphanEventId
    );

    const orphan = await prisma.outboxEvent.create({
      data: {
        eventId: orphanEventId,
        aggregateType: 'BOOKING',
        aggregateId: bookingBId,
        payload: orphanPayload as any,
        status: 'PROCESSING', // stranded by a dead worker
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: new Date(Date.now() - 60000),
      },
    });
    // Backdate the row so it is past any sane lease.
    await prisma.$executeRaw`UPDATE outbox_events SET updatedAt = ${new Date(Date.now() - 120000)} WHERE id = ${orphan.id}`;

    const originalLease = outboxWorker.config.processingLeaseMs;
    outboxWorker.config.processingLeaseMs = 3000; // shrink the lease for a fast test

    const orphanRecovered = await waitForOutbox(
      { id: orphan.id },
      (row) => row.status === 'COMPLETED',
      45000,
      'orphan COMPLETED'
    );

    check(
      'orphaned PROCESSING event was requeued and delivered',
      orphanRecovered?.status === 'COMPLETED',
      `status=${orphanRecovered?.status} retryCount=${orphanRecovered?.retryCount} lastError=${String(orphanRecovered?.lastError).slice(0, 120)}`
    );
    check(
      'the abandoned attempt consumed a retry and recorded why',
      (orphanRecovered?.retryCount || 0) >= 1,
      `retryCount=${orphanRecovered?.retryCount}`
    );

    const orphanLogs = await getCarrierLogs();
    check(
      'orphaned event delivered exactly once after recovery',
      deliveriesFor(orphanLogs, orphanEventId).length === 1,
      `${deliveriesFor(orphanLogs, orphanEventId).length} deliveries`
    );

    outboxWorker.config.processingLeaseMs = originalLease;
  } catch (error: any) {
    failed++;
    console.error(`\nUNEXPECTED ERROR: ${error?.message || String(error)}`);
    console.error(error?.stack?.split('\n').slice(0, 4).join('\n'));
  } finally {
    await secondWorker.stop();
    await outboxWorker.stop();
    if (tempDockManagerId) {
      await prisma.user
        .delete({ where: { id: tempDockManagerId } })
        .catch((e: any) => console.warn(`   (could not remove temp dock manager: ${e.message})`));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();

    console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
