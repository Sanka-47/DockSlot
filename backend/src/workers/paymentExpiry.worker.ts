import { paymentsConfig } from '../config/payments.config';
import { paymentService } from '../services/payment.service';
import { childLogger } from '../utils/logger';

/**
 * Releases slots held by unpaid PENDING_PAYMENT bookings.
 *
 * Stripe's `checkout.session.expired` webhook is the primary trigger, but
 * webhooks can be delayed or misconfigured. This sweeper is the safety net:
 * it cancels anything past its payment deadline or already past its slot start
 * and marks the pending payment attempt EXPIRED.
 */
export class PaymentExpiryWorker {
  private timer: NodeJS.Timeout | null = null;
  private currentTick: Promise<void> | null = null;
  private started = false;
  private readonly log = childLogger({ component: 'PaymentExpiryWorker' });

  start(): void {
    if (!paymentsConfig.enabled) {
      this.log.info('Payments disabled; expiry worker will not start.');
      return;
    }
    if (this.started) return;
    this.started = true;

    this.log.info(
      { intervalMs: paymentsConfig.expirySweepIntervalMs },
      'Payment expiry worker started.'
    );
    this.timer = setInterval(() => void this.tick(), paymentsConfig.expirySweepIntervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    if (this.currentTick) await this.currentTick;
  }

  private async tick(): Promise<void> {
    if (this.currentTick) return;
    this.currentTick = (async () => {
      try {
        const expired = await paymentService.expirePendingBookings();
        if (expired > 0) {
          this.log.info({ expired }, 'Expired unpaid booking holds.');
        }
      } catch (error) {
        this.log.error({ err: error }, 'Payment expiry sweep failed.');
      } finally {
        this.currentTick = null;
      }
    })();
    await this.currentTick;
  }
}

export const paymentExpiryWorker = new PaymentExpiryWorker();
