import { Prisma } from '@prisma/client';
import { DbClient, db, transaction } from './base.repository';

const PENDING = 'PENDING';
const PROCESSING = 'PROCESSING';

export interface PersistedOutboxEvent {
  id: number;
  eventId: string;
  aggregateType: string;
  aggregateId: number;
  payload: any;
  retryCount: number;
  maxRetries: number;
}

export const outboxRepository = {
  createEvent(
    data: {
      eventId: string;
      aggregateType: string;
      aggregateId: number;
      payload: Record<string, unknown>;
      maxRetries: number;
    },
    client: DbClient = db
  ) {
    return client.outboxEvent.create({
      data: {
        eventId: data.eventId,
        aggregateType: data.aggregateType,
        aggregateId: data.aggregateId,
        payload: data.payload as Prisma.InputJsonValue,
        status: PENDING,
        retryCount: 0,
        maxRetries: data.maxRetries,
        nextRetryAt: new Date(),
      },
      select: { id: true, eventId: true, status: true, nextRetryAt: true },
    });
  },

  /**
   * Atomically claims up to `size` due events and flips them to PROCESSING in a
   * single transaction. `SELECT ... FOR UPDATE` plus the guarded status
   * predicate make this safe across concurrent workers.
   */
  async claimDueEvents(size: number, now: Date): Promise<PersistedOutboxEvent[]> {
    const claimed = await transaction(
      async (tx) => {
        // LIMIT cannot be bound as a prepared-statement parameter; `size` is a
        // validated integer so this is injection-safe.
        const due = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT id
            FROM outbox_events
           WHERE status = ${PENDING}
             AND nextRetryAt <= ${now}
           ORDER BY nextRetryAt ASC, id ASC
           LIMIT ${Prisma.raw(String(size))}
           FOR UPDATE
        `);

        if (due.length === 0) return [];

        const ids = due.map((row) => row.id);

        await tx.outboxEvent.updateMany({
          where: { id: { in: ids }, status: PENDING },
          data: { status: PROCESSING },
        });

        const rows = await tx.outboxEvent.findMany({
          where: { id: { in: ids }, status: PROCESSING },
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

        return rows.map((row) => ({
          ...row,
          payload: row.payload as unknown,
        }));
      },
      { timeout: 15000, maxWait: 10000 }
    );

    return claimed as PersistedOutboxEvent[];
  },

  updateMany(where: Prisma.OutboxEventWhereInput, data: Prisma.OutboxEventUpdateManyMutationInput) {
    return db.outboxEvent.updateMany({ where, data });
  },

  groupByStatus() {
    return db.outboxEvent.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
  },
};
