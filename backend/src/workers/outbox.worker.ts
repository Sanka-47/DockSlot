import { outboxService, ClaimedOutboxEvent, OUTBOX_STATUS } from '../services/outbox.service';
import { notificationService } from '../services/notification.service';

/**
 * OutboxWorker
 * ------------
 * Background polling loop that drains the transactional outbox and delivers
 * each event to the Carrier Notify API.
 *
 * Guarantees:
 *  - Non-blocking: runs entirely outside the request path, so booking API
 *    responses never wait on a webhook HTTP call.
 *  - At-least-once: an event is only marked COMPLETED after a 2xx response;
 *    any other outcome returns it to PENDING with exponential backoff.
 *  - Duplicate-safe: events are atomically claimed (PROCESSING) so two workers
 *    never dispatch the same row, and every request carries the persisted
 *    eventId as X-Event-Id / Idempotency-Key so a redelivery after a
 *    "delivered but not recorded" crash is de-duplicated by the receiver.
 *  - Bounded: after maxRetries the event is parked as FAILED for review rather
 *    than retried forever.
 */

export interface OutboxWorkerConfig {
  pollIntervalMs: number;
  batchSize: number;
  maxConcurrency: number;
  processingLeaseMs: number;
  maxBatchesPerTick: number;
  enabled: boolean;
}

function readPositiveInt(name: string, fallback: number, allowZero = false): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0 || (parsed === 0 && !allowZero)) return fallback;
  return parsed;
}

export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private currentTick: Promise<void> | null = null;
  private running = false;
  private started = false;

  public readonly config: OutboxWorkerConfig = {
    pollIntervalMs: readPositiveInt('OUTBOX_POLL_INTERVAL_MS', 5000),
    batchSize: readPositiveInt('OUTBOX_BATCH_SIZE', 25),
    maxConcurrency: readPositiveInt('OUTBOX_MAX_CONCURRENCY', 5),
    processingLeaseMs: readPositiveInt('OUTBOX_PROCESSING_LEASE_MS', 60_000),
    maxBatchesPerTick: readPositiveInt('OUTBOX_MAX_BATCHES_PER_TICK', 4),
    enabled: process.env.OUTBOX_WORKER_ENABLED !== 'false',
  };

  /** True while a polling cycle is in flight. */
  public get isBusy(): boolean {
    return this.running;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Starts the polling loop and kicks off an immediate cycle so events created
   * during boot are not delayed by a full interval.
   */
  public start(): void {
    if (this.started) {
      console.warn('[OutboxWorker] start() ignored - worker is already running.');
      return;
    }

    if (!this.config.enabled) {
      console.log('[OutboxWorker] Disabled via OUTBOX_WORKER_ENABLED=false. No events will be dispatched.');
      return;
    }

    this.started = true;

    console.log(
      `[OutboxWorker] Started | interval=${this.config.pollIntervalMs}ms ` +
        `batch=${this.config.batchSize} concurrency=${this.config.maxConcurrency} ` +
        `lease=${this.config.processingLeaseMs}ms target=${process.env.CARRIER_NOTIFY_URL || 'http://localhost:4001/notify'}`
    );

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.pollIntervalMs);

    // Do not hold the event loop open on the worker's account - the HTTP server
    // owns process lifetime, and this keeps test runners from hanging.
    this.timer.unref?.();

    void this.tick();
  }

  /**
   * Stops scheduling new cycles and waits for the in-flight one to finish, so
   * every claimed event reaches a terminal state before the process exits.
   */
  public async stop(): Promise<void> {
    if (!this.started) return;

    this.started = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.currentTick) {
      console.log('[OutboxWorker] Waiting for in-flight delivery cycle to finish...');
      await this.currentTick;
    }

    console.log('[OutboxWorker] Stopped.');
  }

  // ---------------------------------------------------------------------------
  // Poll cycle
  // ---------------------------------------------------------------------------

  /** Single poll cycle. Guarded against re-entrancy so cycles never overlap. */
  public async tick(): Promise<void> {
    if (this.running) {
      // Previous cycle is still working through a slow batch; skip this beat.
      return;
    }

    this.running = true;
    this.currentTick = this.runCycle();

    try {
      await this.currentTick;
    } finally {
      this.running = false;
      this.currentTick = null;
    }
  }

  private async runCycle(): Promise<void> {
    try {
      const recovered = await outboxService.recoverStaleProcessing(
        this.config.processingLeaseMs
      );
      if (recovered > 0) {
        console.warn(
          `[OutboxWorker] Requeued ${recovered} event(s) abandoned in PROCESSING by a previous worker.`
        );
      }

      for (let batch = 0; batch < this.config.maxBatchesPerTick; batch++) {
        const claimed = await outboxService.claimPendingEvents(this.config.batchSize);
        if (claimed.length === 0) return;

        console.log(`[OutboxWorker] Claimed ${claimed.length} event(s) for delivery.`);
        await this.dispatchBatch(claimed);
      }
    } catch (error: any) {
      // A polling cycle must never crash the process - the next tick retries.
      console.error(`[OutboxWorker] Poll cycle failed: ${error?.message || String(error)}`);
    }
  }

  /** Delivers a claimed batch with bounded parallelism. */
  private async dispatchBatch(events: ClaimedOutboxEvent[]): Promise<void> {
    await this.runWithConcurrency(events, this.config.maxConcurrency, (event) =>
      this.dispatchEvent(event)
    );
  }

  /**
   * Delivers one event and commits its outcome. A failure to *record* the
   * outcome is logged but deliberately not rethrown: the event stays
   * PROCESSING and the stale-claim sweep will requeue it.
   */
  private async dispatchEvent(event: ClaimedOutboxEvent): Promise<void> {
    const result = await notificationService.dispatchCarrierNotification(
      event.eventId,
      event.payload
    );

    try {
      if (result.ok) {
        await outboxService.markCompleted(event);
        console.log(
          `[OutboxWorker] Delivered event ${event.eventId} (outbox #${event.id}, ` +
            `${event.payload?.eventType}) -> HTTP ${result.status}`
        );
        return;
      }

      const detail = result.error
        ? result.error
        : `HTTP ${result.status} from carrier notify API: ${this.describeBody(result.body)}`;

      if (!notificationService.isRetryable(result)) {
        await outboxService.markFailed(event, `Non-retryable ${detail}`);
        console.error(
          `[OutboxWorker] Event ${event.eventId} parked as FAILED (non-retryable). ${detail}`
        );
        return;
      }

      const outcome = await outboxService.recordFailure(event, detail);

      if (outcome.status === OUTBOX_STATUS.FAILED) {
        console.error(
          `[OutboxWorker] Event ${event.eventId} FAILED permanently after ` +
            `${outcome.retryCount - 1}/${event.maxRetries} retries. ${detail}`
        );
      } else {
        console.warn(
          `[OutboxWorker] Event ${event.eventId} attempt ${outcome.retryCount}/${event.maxRetries} ` +
            `failed. Retrying in ${outcome.delayMs}ms at ${outcome.nextRetryAt?.toISOString()}. ${detail}`
        );
      }
    } catch (error: any) {
      console.error(
        `[OutboxWorker] Could not record outcome for event ${event.eventId}: ` +
          `${error?.message || String(error)}`
      );
    }
  }

  private describeBody(body: any): string {
    if (body === null || body === undefined) return '(empty response body)';
    if (typeof body === 'string') return body.slice(0, 300);
    try {
      return JSON.stringify(body).slice(0, 300);
    } catch {
      return '(unserializable response body)';
    }
  }

  /** Simple worker-pool: at most `limit` promises in flight at any moment. */
  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<void>
  ): Promise<void> {
    const queue = [...items];
    const lanes = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await task(item);
      }
    });

    await Promise.all(lanes);
  }
}

export const outboxWorker = new OutboxWorker();
