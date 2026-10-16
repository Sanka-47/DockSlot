import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.config';
import { formatInTimeZone } from '../utils/time.utils';

/**
 * OutboxService
 * -------------
 * Owns the transactional outbox persistence layer:
 *   - building the canonical carrier webhook payload,
 *   - enqueueing events inside the caller's business transaction,
 *   - atomically claiming due events for a worker,
 *   - and committing the COMPLETED / retry / FAILED outcome of a delivery.
 *
 * No HTTP happens here; that is notificationService's job.
 */

export const OUTBOX_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

/** Event types carried in the webhook `eventType` field. */
export const OUTBOX_EVENT_TYPE = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_STATUS_CHANGED: 'BOOKING_STATUS_CHANGED',
} as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPE)[keyof typeof OUTBOX_EVENT_TYPE];

/** Booking summary carried in the webhook `booking` field. */
export interface OutboxBookingSummary {
  id: number;
  status: string;
  dockId: number;
  dockName: string;
  warehouseId: number;
  warehouseName: string;
  warehouseTimezone: string;
  slotStartTime: string;
  slotEndTime: string;
  truckPlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
  cargoNote: string | null;
}

export interface EnqueueOutboxInput {
  aggregateType: string;
  aggregateId: number;
  eventType: OutboxEventType;
  carrierOrg: { id: number; name: string };
  booking: OutboxBookingSummary;
  /** Human-readable one-line description of what happened. */
  message: string;
  /** Structured before/after detail specific to the event type. */
  changes?: Record<string, unknown>;
  maxRetries?: number;
}

/** The exact JSON document POSTed to the carrier webhook. */
export interface OutboxPayload {
  eventId: string;
  eventType: OutboxEventType;
  aggregateType: string;
  aggregateId: number;
  occurredAt: string;
  carrierOrg: { id: number; name: string };
  booking: OutboxBookingSummary;
  changes?: Record<string, unknown>;
  message: string;
}

export interface ClaimedOutboxEvent {
  id: number;
  eventId: string;
  aggregateType: string;
  aggregateId: number;
  payload: OutboxPayload;
  retryCount: number;
  maxRetries: number;
}

export interface OutboxStats {
  PENDING: number;
  PROCESSING: number;
  COMPLETED: number;
  FAILED: number;
}

const DEFAULT_MAX_RETRIES = 5;

export class OutboxService {
  public readonly defaultMaxRetries: number = (() => {
    const parsed = parseInt(process.env.OUTBOX_MAX_RETRIES || String(DEFAULT_MAX_RETRIES), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_RETRIES;
  })();

  private readonly backoffBaseMs: number = (() => {
    const parsed = parseInt(process.env.OUTBOX_BACKOFF_BASE_MS || '1000', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
  })();

  private readonly maxBackoffMs: number = (() => {
    const parsed = parseInt(process.env.OUTBOX_MAX_BACKOFF_MS || '300000', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
  })();

  // ---------------------------------------------------------------------------
  // Payload construction
  // ---------------------------------------------------------------------------

  /**
   * Formats a slot instant in the warehouse's own timezone so the message is
   * meaningful to the receiving carrier dispatch desk.
   */
  public formatSlotInstant(date: Date, timeZone: string): string {
    try {
      return `${formatInTimeZone(date, timeZone, 'yyyy-MM-dd HH:mm')} (${timeZone})`;
    } catch {
      return date.toISOString();
    }
  }

  /**
   * Builds the canonical webhook document. `eventId` is generated once at
   * enqueue time, persisted, and reused verbatim on every redelivery so the
   * receiver can de-duplicate.
   */
  public buildPayload(input: EnqueueOutboxInput, eventId: string): OutboxPayload {
    return {
      eventId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      occurredAt: new Date().toISOString(),
      carrierOrg: input.carrierOrg,
      booking: input.booking,
      ...(input.changes ? { changes: input.changes } : {}),
      message: input.message,
    };
  }

  /**
   * Maps a Booking (with dock.warehouse and carrierOrg included) to the
   * outbox booking summary. When the booking is being moved to a different
   * dock, pass the destination dock so the summary reflects the new slot.
   */
  public toBookingSummary(booking: any, destinationDock?: any): OutboxBookingSummary {
    const dock = destinationDock || booking.dock;
    const warehouse = dock.warehouse;

    return {
      id: booking.id,
      status: booking.status,
      dockId: dock.id,
      dockName: dock.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      warehouseTimezone: warehouse.timezone,
      slotStartTime: new Date(booking.slotStartTime).toISOString(),
      slotEndTime: new Date(booking.slotEndTime).toISOString(),
      truckPlate: booking.truckPlate ?? null,
      driverName: booking.driverName ?? null,
      driverPhone: booking.driverPhone ?? null,
      cargoNote: booking.cargoNote ?? null,
    };
  }

  /** e.g. "2026-11-15 10:00 (Asia/Colombo)" - uses the summary's own timezone. */
  public describeSlot(booking: OutboxBookingSummary): string {
    return this.formatSlotInstant(
      new Date(booking.slotStartTime),
      booking.warehouseTimezone
    );
  }

  // ---------------------------------------------------------------------------
  // Producer side
  // ---------------------------------------------------------------------------

  /**
   * Persists an outbox event. MUST be called with the `tx` client of the same
   * transaction that mutates the booking so the event and the state change
   * commit or roll back together.
   */
  public async enqueue(tx: Prisma.TransactionClient, input: EnqueueOutboxInput) {
    const eventId = randomUUID();
    const payload = this.buildPayload(input, eventId);

    return tx.outboxEvent.create({
      data: {
        eventId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: payload as unknown as Prisma.InputJsonValue,
        status: OUTBOX_STATUS.PENDING,
        retryCount: 0,
        maxRetries: input.maxRetries ?? this.defaultMaxRetries,
        nextRetryAt: new Date(),
      },
      select: { id: true, eventId: true, status: true, nextRetryAt: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Consumer side - atomic claiming
  // ---------------------------------------------------------------------------

  /**
   * Atomically claims up to `batchSize` due events and flips them to PROCESSING
   * in a single transaction.
   *
   * The `SELECT ... FOR UPDATE` row locks combined with the guarded
   * `status = 'PENDING'` predicate make claiming safe across concurrent worker
   * processes: a second worker blocks on the locked rows, and once the first
   * worker commits it re-evaluates the predicate, finds status = 'PROCESSING',
   * and claims nothing. No event can be claimed twice.
   */
  public async claimPendingEvents(batchSize: number): Promise<ClaimedOutboxEvent[]> {
    const size = Math.max(1, Math.floor(batchSize));
    const now = new Date();

    const claimed = await prisma.$transaction(
      async (tx) => {
        // LIMIT cannot be bound as a prepared-statement parameter; `size` is
        // coerced to a validated integer above so this is injection-safe.
        const due = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT id
            FROM outbox_events
           WHERE status = ${OUTBOX_STATUS.PENDING}
             AND nextRetryAt <= ${now}
           ORDER BY nextRetryAt ASC, id ASC
           LIMIT ${Prisma.raw(String(size))}
           FOR UPDATE
        `);

        if (due.length === 0) return [];

        const ids = due.map((row) => row.id);

        await tx.outboxEvent.updateMany({
          where: { id: { in: ids }, status: OUTBOX_STATUS.PENDING },
          data: { status: OUTBOX_STATUS.PROCESSING },
        });

        const rows = await tx.outboxEvent.findMany({
          where: { id: { in: ids }, status: OUTBOX_STATUS.PROCESSING },
          select: {
            id: true,
            eventId: true,
            aggregateType: true,
            aggregateId: true,
            payload: true,
            retryCount: true,
            maxRetries: true,
          },
          orderBy: { id: 'asc' },
        });

        // The column is opaque JSON; the shape is guaranteed by `enqueue`.
        return rows.map((row) => ({
          ...row,
          payload: row.payload as unknown as OutboxPayload,
        }));
      },
      { timeout: 15000, maxWait: 10000 }
    );

    return claimed;
  }

  /**
   * Requeues events abandoned in PROCESSING by a worker that died mid-flight.
   * A PROCESSING row whose `updatedAt` is older than the lease has no live
   * owner, so it is returned to PENDING. The retry counter is incremented so a
   * permanently crashing event still terminates in FAILED rather than looping.
   */
  public async recoverStaleProcessing(leaseMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - leaseMs);

    const result = await prisma.outboxEvent.updateMany({
      where: {
        status: OUTBOX_STATUS.PROCESSING,
        updatedAt: { lt: cutoff },
      },
      data: {
        status: OUTBOX_STATUS.PENDING,
        nextRetryAt: new Date(),
        retryCount: { increment: 1 },
        lastError: 'Requeued after worker lease expired without a delivery outcome.',
      },
    });

    return result.count;
  }

  // ---------------------------------------------------------------------------
  // Consumer side - outcome
  // ---------------------------------------------------------------------------

  /** Marks a claimed event as successfully delivered. */
  public async markCompleted(event: ClaimedOutboxEvent): Promise<void> {
    await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: OUTBOX_STATUS.PROCESSING },
      data: {
        status: OUTBOX_STATUS.COMPLETED,
        lastError: null,
        nextRetryAt: new Date(),
      },
    });
  }

  /**
   * Records a failed delivery attempt, applying exponential backoff.
   *
   * Delay = min(BACKOFF_BASE_MS * 2^retryCount, MAX_BACKOFF_MS) plus up to 20%
   * jitter so that a batch of events failing together does not retry in
   * lockstep. Once retryCount exceeds maxRetries the event is parked as FAILED
   * for administrative review instead of being rescheduled.
   *
   * Returns the decision taken so the caller can log it.
   */
  public async recordFailure(
    event: ClaimedOutboxEvent,
    errorDetail: string
  ): Promise<{ status: OutboxStatus; retryCount: number; nextRetryAt?: Date; delayMs?: number }> {
    const nextRetryCount = event.retryCount + 1;

    if (nextRetryCount > event.maxRetries) {
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, status: OUTBOX_STATUS.PROCESSING },
        data: {
          status: OUTBOX_STATUS.FAILED,
          retryCount: nextRetryCount,
          lastError: `Exhausted ${event.maxRetries} retries. Last error: ${errorDetail}`.slice(0, 4000),
        },
      });

      return { status: OUTBOX_STATUS.FAILED, retryCount: nextRetryCount };
    }

    const exponential = this.backoffBaseMs * Math.pow(2, nextRetryCount);
    const capped = Math.min(exponential, this.maxBackoffMs);
    const jitter = Math.floor(capped * 0.2 * Math.random());
    const delayMs = capped + jitter;
    const nextRetryAt = new Date(Date.now() + delayMs);

    await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: OUTBOX_STATUS.PROCESSING },
      data: {
        status: OUTBOX_STATUS.PENDING,
        retryCount: nextRetryCount,
        nextRetryAt,
        lastError: errorDetail.slice(0, 4000),
      },
    });

    return {
      status: OUTBOX_STATUS.PENDING,
      retryCount: nextRetryCount,
      nextRetryAt,
      delayMs,
    };
  }

  /**
   * Parks an event as FAILED without consuming retries. Used when a failure is
   * provably permanent (non-retryable 4xx from the receiver).
   */
  public async markFailed(event: ClaimedOutboxEvent, errorDetail: string): Promise<void> {
    await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: OUTBOX_STATUS.PROCESSING },
      data: {
        status: OUTBOX_STATUS.FAILED,
        lastError: errorDetail.slice(0, 4000),
      },
    });
  }

  /** Event counts per status, for operational inspection. */
  public async getStats(): Promise<OutboxStats> {
    const grouped = await prisma.outboxEvent.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const stats: OutboxStats = {
      PENDING: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };

    for (const row of grouped) {
      if (row.status in stats) {
        stats[row.status as keyof OutboxStats] = row._count._all;
      }
    }

    return stats;
  }
}

export const outboxService = new OutboxService();
