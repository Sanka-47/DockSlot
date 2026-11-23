import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { BookingStatus, PaymentStatus, Prisma } from '@prisma/client';
import { paymentsConfig } from '../config/payments.config';
import { paymentRepository, BookingWithPayments } from '../repositories/payment.repository';
import { auditLogService } from './audit.service';
import { outboxService, OUTBOX_EVENT_TYPE } from './outbox.service';
import { getRequestId } from '../utils/requestContext';
import { childLogger } from '../utils/logger';

const log = childLogger({ component: 'payments' });

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!paymentsConfig.enabled) {
    throw { status: 503, message: 'Payments are disabled in this environment.' };
  }
  if (!paymentsConfig.secretKey) {
    throw {
      status: 503,
      message: 'Stripe is not configured. Set STRIPE_SECRET_KEY to accept payments.',
    };
  }
  if (!stripeClient) {
    stripeClient = new Stripe(paymentsConfig.secretKey);
  }
  return stripeClient;
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function assertCurrency(value: string): string {
  const currency = normalizeCurrency(value);
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw { status: 400, message: 'Warehouse currency must be a 3-letter ISO 4217 code.' };
  }
  return currency;
}

function assertAmount(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw { status: 400, message: 'Warehouse slot price must be a positive amount in minor units.' };
  }
  return value;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function paymentExpiryForSlot(slotStart: Date): Date {
  const now = Date.now();
  // Stripe rejects an expires_at less than 30 minutes in the future. Keep a
  // small cushion for network latency between this calculation and the
  // Checkout Session request, while still expiring before the slot starts when
  // the lead time allows it.
  const minimumExpiry = now + 30 * 60 * 1000 + 5_000;
  const beforeSlot = slotStart.getTime() - 60 * 1000;
  const desired = Math.min(now + paymentsConfig.holdMinutes * 60 * 1000, beforeSlot);
  return new Date(Math.max(desired, minimumExpiry));
}

function sessionPaymentIntentId(session: Stripe.Checkout.Session): string | null {
  if (!session.payment_intent) return null;
  return typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent.id;
}

function paymentSummary(payment: {
  id: number;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  checkoutUrl: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
}) {
  return {
    id: payment.id,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    checkoutUrl: payment.checkoutUrl,
    expiresAt: payment.expiresAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
    refundedAt: payment.refundedAt?.toISOString() ?? null,
  };
}

function buildSuccessUrl(): string {
  const configured = paymentsConfig.successUrl;
  if (configured.includes('{CHECKOUT_SESSION_ID}')) return configured;
  const url = new URL(configured);
  url.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  return url.toString();
}

function buildCancelUrl(bookingId: number): string {
  const url = new URL(paymentsConfig.cancelUrl);
  if (!url.searchParams.has('booking_id')) {
    url.searchParams.set('booking_id', String(bookingId));
  }
  return url.toString();
}

export class PaymentService {
  get enabled(): boolean {
    return paymentsConfig.enabled;
  }

  /**
   * Creates the PENDING payment attempt inside the booking transaction. The
   * booking row is the slot lock; the payment row records the amount snapshot
   * so later warehouse price edits never change an existing charge.
   */
  async createPendingPayment(tx: Prisma.TransactionClient, booking: BookingWithPayments | any) {
    const warehouse = booking.dock?.warehouse;
    if (!warehouse) {
      throw { status: 500, message: 'Warehouse is missing from the booking.' };
    }

    const amountCents = assertAmount(warehouse.slotPriceCents);
    const currency = assertCurrency(warehouse.currency);
    const expiresAt = paymentExpiryForSlot(new Date(booking.slotStartTime));

    const payment = await paymentRepository.createPayment(
      {
        bookingId: booking.id,
        status: PaymentStatus.PENDING,
        amountCents,
        currency,
        provider: 'STRIPE',
        idempotencyKey: randomUUID(),
        expiresAt,
      },
      tx
    );
    await paymentRepository.updateBookingPaymentExpiry(booking.id, expiresAt, tx);
    return payment;
  }

  /**
   * Creates (or reuses) a Stripe-hosted Checkout Session for a pending booking.
   * The browser is redirected to Stripe; no card data touches this application.
   */
  async createCheckoutForBooking(
    bookingId: number,
    carrierOrgId: number,
    customerEmail?: string
  ) {
    const stripe = getStripe();
    const booking = await paymentRepository.findBookingForPayment(bookingId);

    if (!booking) throw { status: 404, message: 'Booking not found.' };
    if (booking.carrierOrgId !== carrierOrgId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to pay for this booking.' };
    }
    if (booking.status === BookingStatus.BOOKED) {
      throw { status: 400, message: 'Booking is already paid.' };
    }
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw { status: 400, message: 'Only bookings awaiting payment can be paid.' };
    }
    if (booking.slotStartTime.getTime() <= Date.now()) {
      await this.expireUnpaidBooking(booking.id, 'The booking slot has already started.', PaymentStatus.EXPIRED);
      throw { status: 400, message: 'The booking slot has already started.' };
    }

    const existing = await paymentRepository.findLatestPendingPayment(booking.id);
    if (existing && existing.checkoutUrl && existing.expiresAt.getTime() > Date.now() + 60_000) {
      return {
        url: existing.checkoutUrl,
        sessionId: existing.stripeSessionId,
        expiresAt: existing.expiresAt.toISOString(),
      };
    }

    if (existing) {
      await paymentRepository.markPendingPayments(
        booking.id,
        PaymentStatus.EXPIRED,
        'Checkout Session expired before payment.'
      );
    }

    const payment = await paymentRepository.createPayment({
      bookingId: booking.id,
      status: PaymentStatus.PENDING,
      amountCents: assertAmount(booking.dock.warehouse.slotPriceCents),
      currency: assertCurrency(booking.dock.warehouse.currency),
      provider: 'STRIPE',
      idempotencyKey: randomUUID(),
      expiresAt: paymentExpiryForSlot(booking.slotStartTime),
    });

    const metadata: Stripe.MetadataParam = {
      bookingId: String(booking.id),
      carrierOrgId: String(booking.carrierOrgId),
      warehouseId: String(booking.dock.warehouseId),
      dockId: String(booking.dockId),
    };

    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: payment.currency.toLowerCase(),
                unit_amount: payment.amountCents,
                product_data: {
                  name: `Dock slot at ${booking.dock.warehouse.name}`.slice(0, 127),
                  description: `${booking.dock.name} • ${booking.slotStartTime.toISOString()}`,
                },
              },
            },
          ],
          client_reference_id: String(booking.id),
          metadata,
          payment_intent_data: { metadata },
          customer_email: customerEmail || undefined,
          success_url: buildSuccessUrl(),
          cancel_url: buildCancelUrl(booking.id),
          expires_at: Math.floor(payment.expiresAt.getTime() / 1000),
        },
        { idempotencyKey: `checkout-${payment.id}-${payment.idempotencyKey}` }
      );

      if (!session.url) {
        throw new Error('Stripe Checkout Session did not return a redirect URL.');
      }

      const expiresAt = session.expires_at
        ? new Date(session.expires_at * 1000)
        : payment.expiresAt;

      const updated = await paymentRepository.updatePayment(payment.id, {
        stripeSessionId: session.id,
        checkoutUrl: session.url,
        expiresAt,
      });
      await paymentRepository.updateBookingPaymentExpiry(booking.id, expiresAt);

      return {
        url: updated.checkoutUrl,
        sessionId: updated.stripeSessionId,
        expiresAt: updated.expiresAt.toISOString(),
      };
    } catch (error: any) {
      const message = error?.message || 'Stripe Checkout Session creation failed.';
      await paymentRepository.updatePayment(payment.id, {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        failureReason: message,
      });
      log.error({ err: error, bookingId: booking.id, paymentId: payment.id }, 'checkout session failed');
      throw { status: 502, message: 'Could not start the payment. Please try again.' };
    }
  }

  /**
   * Webhook entry point. Signature verification happens before any database
   * write; the event id is then recorded so Stripe retries are idempotent.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!paymentsConfig.enabled) {
      throw { status: 503, message: 'Payments are disabled in this environment.' };
    }
    if (!signature) {
      throw { status: 400, message: 'Missing Stripe signature.' };
    }
    if (!paymentsConfig.webhookSecret) {
      throw { status: 503, message: 'Stripe webhook secret is not configured.' };
    }

    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, paymentsConfig.webhookSecret);
    } catch (error: any) {
      log.warn({ err: error }, 'invalid Stripe webhook signature');
      throw { status: 400, message: 'Invalid Stripe webhook signature.' };
    }

    const existing = await paymentRepository.findWebhookEvent(event.id);
    if (existing?.status === 'PROCESSED') {
      return { duplicate: true };
    }

    if (existing) {
      await paymentRepository.updateWebhookEvent(event.id, {
        status: 'PROCESSING',
        error: null,
      });
    } else {
      await paymentRepository.createWebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        status: 'PROCESSING',
        payload: event as unknown as Prisma.InputJsonValue,
      });
    }

    try {
      await this.processWebhookEvent(event);
      await paymentRepository.updateWebhookEvent(event.id, {
        status: 'PROCESSED',
        processedAt: new Date(),
        error: null,
      });
      return { processed: true };
    } catch (error: any) {
      await paymentRepository.updateWebhookEvent(event.id, {
        status: 'FAILED',
        error: error?.message || String(error),
      });
      log.error({ err: error, eventId: event.id, eventType: event.type }, 'Stripe webhook failed');
      throw error;
    }
  }

  private async processWebhookEvent(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
          await this.fulfillCheckoutSession(session);
        }
        return;
      }
      case 'checkout.session.async_payment_succeeded': {
        await this.fulfillCheckoutSession(event.data.object as Stripe.Checkout.Session);
        return;
      }
      case 'checkout.session.async_payment_failed': {
        await this.failCheckoutSession(
          event.data.object as Stripe.Checkout.Session,
          'The asynchronous payment failed.'
        );
        return;
      }
      case 'checkout.session.expired': {
        await this.expireCheckoutSession(event.data.object as Stripe.Checkout.Session);
        return;
      }
      case 'charge.refunded': {
        await this.handleChargeRefunded(event.data.object as Stripe.Charge);
        return;
      }
      default:
        return;
    }
  }

  async fulfillCheckoutSession(session: Stripe.Checkout.Session) {
    const payment = await paymentRepository.findPaymentBySessionId(session.id);
    if (!payment) {
      log.warn({ sessionId: session.id }, 'paid Checkout Session has no local payment row');
      return;
    }

    if (
      payment.status === PaymentStatus.REFUNDED ||
      payment.status === PaymentStatus.PARTIALLY_REFUNDED
    ) {
      return;
    }

    if (session.amount_total !== null && session.amount_total !== payment.amountCents) {
      throw new Error(
        `Stripe amount mismatch for booking ${payment.bookingId}: expected ${payment.amountCents}, got ${session.amount_total}.`
      );
    }
    if (session.currency && normalizeCurrency(session.currency) !== payment.currency) {
      throw new Error(
        `Stripe currency mismatch for booking ${payment.bookingId}: expected ${payment.currency}, got ${session.currency}.`
      );
    }

    const intentId = sessionPaymentIntentId(session);

    // The customer paid, but the slot was already released (expired or
    // cancelled). Record the charge so it can be refunded, then refund it.
    if (payment.booking.status === BookingStatus.CANCELLED) {
      if (payment.status !== PaymentStatus.PAID) {
        await paymentRepository.updatePayment(payment.id, {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          stripePaymentIntentId: intentId,
          failureReason: null,
        });
      }
      await this.refundBookingIfPaid(payment.bookingId);
      log.warn(
        { bookingId: payment.bookingId, paymentId: payment.id },
        'payment succeeded after the booking was cancelled; refunded'
      );
      return;
    }

    if (payment.status === PaymentStatus.PAID) return;

    const result = await paymentRepository.transaction(async (tx) => {
      const paid = await paymentRepository.markPaymentPaid(payment.id, intentId, tx);
      if (paid.count === 0) {
        return { alreadyPaid: true, needsRefund: false };
      }

      await paymentRepository.markPendingPayments(
        payment.bookingId,
        PaymentStatus.EXPIRED,
        'Another payment attempt succeeded.',
        payment.id,
        tx
      );

      const bookingUpdated = await paymentRepository.markBookingPaid(payment.bookingId, tx);
      const booking = await paymentRepository.findBookingForPayment(payment.bookingId, tx);
      if (!booking) return { alreadyPaid: false, needsRefund: true };

      // The slot may have been released between the snapshot above and this
      // transaction, or another payment may have confirmed the booking first.
      // Keep the charge recorded, then refund it after the transaction commits.
      if (bookingUpdated.count === 0) {
        return { alreadyPaid: false, needsRefund: true };
      }

      if (booking.createdByUserId) {
        await auditLogService.recordLog({
          bookingId: booking.id,
          userId: booking.createdByUserId,
          action: 'PAYMENT_SUCCEEDED',
          details: {
            paymentId: payment.id,
            amountCents: payment.amountCents,
            currency: payment.currency,
            stripeSessionId: session.id,
            summary: 'Payment received and booking confirmed',
          },
          tx,
        });
      }

      const summary = outboxService.toBookingSummary(booking);
      await outboxService.enqueue(tx, {
        aggregateType: 'BOOKING',
        aggregateId: booking.id,
        eventType: OUTBOX_EVENT_TYPE.BOOKING_CREATED,
        requestId: getRequestId(),
        carrierOrg: { id: booking.carrierOrg.id, name: booking.carrierOrg.name },
        booking: summary,
        message:
          `New booking #${booking.id} confirmed for truck ${summary.truckPlate} ` +
          `at ${summary.dockName} (${summary.warehouseName}) on ${outboxService.describeSlot(summary)}.`,
      });

      return { alreadyPaid: false, needsRefund: false };
    });

    if (result.needsRefund) {
      // The customer paid but the slot was no longer available. Keep the
      // payment row for reconciliation and refund the charge.
      await this.refundBookingIfPaid(payment.bookingId);
      log.warn(
        { bookingId: payment.bookingId, paymentId: payment.id },
        'payment succeeded after the slot was no longer pending; refunded'
      );
      return;
    }

    if (!result.alreadyPaid) {
      log.info({ bookingId: payment.bookingId, paymentId: payment.id }, 'booking paid and confirmed');
    }
  }

  private async failCheckoutSession(session: Stripe.Checkout.Session, reason: string) {
    const payment = await paymentRepository.findPaymentBySessionId(session.id);
    if (!payment) return;

    await paymentRepository.transaction(async (tx) => {
      await paymentRepository.markPendingPayments(
        payment.bookingId,
        PaymentStatus.FAILED,
        reason,
        undefined,
        tx
      );
      await paymentRepository.cancelUnpaidBooking(payment.bookingId, tx);
      await this.auditPaymentFailure(payment.bookingId, 'PAYMENT_FAILED', reason, tx);
    });
  }

  private async expireCheckoutSession(session: Stripe.Checkout.Session) {
    const payment = await paymentRepository.findPaymentBySessionId(session.id);
    if (!payment) return;
    await this.expireUnpaidBooking(
      payment.bookingId,
      'Checkout Session expired before payment.',
      PaymentStatus.EXPIRED
    );
  }

  /**
   * Releases a slot held by an unpaid booking. Used by expiry webhooks, the
   * background sweeper, and compensating actions when Checkout creation fails.
   */
  async expireUnpaidBooking(
    bookingId: number,
    reason: string,
    status: PaymentStatus = PaymentStatus.EXPIRED
  ) {
    return paymentRepository.transaction(async (tx) => {
      const booking = await paymentRepository.findBookingForPayment(bookingId, tx);
      if (!booking || booking.status !== BookingStatus.PENDING_PAYMENT) return false;

      await paymentRepository.cancelUnpaidBooking(bookingId, tx);
      await paymentRepository.markPendingPayments(bookingId, status, reason, undefined, tx);
      await this.auditPaymentFailure(bookingId, 'PAYMENT_EXPIRED', reason, tx);
      return true;
    });
  }

  private async auditPaymentFailure(
    bookingId: number,
    action: string,
    reason: string,
    tx: Prisma.TransactionClient
  ) {
    const booking = await paymentRepository.findBookingForPayment(bookingId, tx);
    if (!booking?.createdByUserId) return;
    await auditLogService.recordLog({
      bookingId,
      userId: booking.createdByUserId,
      action,
      details: { reason, summary: `Payment failed: ${reason}` },
      tx,
    });
  }

  async expirePendingBookings(): Promise<number> {
    if (!paymentsConfig.enabled) return 0;
    const expired = await paymentRepository.findExpiredPendingBookings(new Date(), 100);
    let count = 0;
    for (const booking of expired) {
      const didExpire = await this.expireUnpaidBooking(
        booking.id,
        'Payment was not completed before the hold expired.',
        PaymentStatus.EXPIRED
      );
      if (didExpire) count += 1;
    }
    return count;
  }

  /**
   * Refunds a paid booking before cancellation. Stripe's idempotency key makes
   * a retried cancellation safe. Pending payments need no refund.
   */
  async refundBookingIfPaid(bookingId: number): Promise<boolean> {
    if (!paymentsConfig.enabled) return false;
    const booking = await paymentRepository.findBookingForPayment(bookingId);
    if (!booking) return false;

    const paid = booking.payments.find(
      (payment) => payment.status === PaymentStatus.PAID && payment.stripePaymentIntentId
    );
    if (!paid?.stripePaymentIntentId) return false;

    const stripe = getStripe();
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: paid.stripePaymentIntentId,
          reason: 'requested_by_customer',
          metadata: { bookingId: String(bookingId) },
        },
        { idempotencyKey: `refund-booking-${bookingId}` }
      );

      await paymentRepository.updatePayment(paid.id, {
        status:
          refund.amount >= paid.amountCents
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED,
        refundedAt: new Date(),
      });
      return true;
    } catch (error: any) {
      log.error({ err: error, bookingId, paymentId: paid.id }, 'Stripe refund failed');
      throw {
        status: 502,
        message: 'Payment refund failed. The booking was not cancelled; please try again.',
      };
    }
  }

  private async handleChargeRefunded(charge: Stripe.Charge) {
    const intentId =
      typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!intentId) return;

    const payment = await paymentRepository.findPaymentByIntentId(intentId);
    if (!payment) return;

    const fullyRefunded = charge.refunded || charge.amount_refunded >= payment.amountCents;
    await paymentRepository.updatePayment(payment.id, {
      status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
      refundedAt: new Date(),
    });
  }

  /**
   * Tenant-safe status lookup used by the checkout return page and dashboards.
   * If a webhook is delayed, this reconciles directly with Stripe.
   */
  async getPaymentStatusForBooking(bookingId: number, organizationId: number) {
    let booking = await paymentRepository.findBookingForPayment(bookingId);
    if (!booking) throw { status: 404, message: 'Booking not found.' };
    this.assertTenant(booking, organizationId);

    await this.reconcilePendingPayment(booking);
    booking = await paymentRepository.findBookingForPayment(bookingId);
    if (!booking) throw { status: 404, message: 'Booking not found.' };
    return this.toStatusResponse(booking);
  }

  async getPaymentStatusForSession(sessionId: string, organizationId: number) {
    let booking = await paymentRepository.findBookingForPaymentBySession(sessionId);
    if (!booking) throw { status: 404, message: 'Payment session not found.' };
    this.assertTenant(booking, organizationId);

    await this.reconcilePendingPayment(booking);
    booking = await paymentRepository.findBookingForPaymentBySession(sessionId);
    if (!booking) throw { status: 404, message: 'Payment session not found.' };
    return this.toStatusResponse(booking);
  }

  private assertTenant(booking: BookingWithPayments, organizationId: number) {
    const isCarrier = booking.carrierOrgId === organizationId;
    const isWarehouse = booking.dock.warehouse.organizationId === organizationId;
    if (!isCarrier && !isWarehouse) {
      throw { status: 403, message: 'Forbidden. You do not have access to this payment.' };
    }
  }

  private async reconcilePendingPayment(booking: BookingWithPayments) {
    if (!paymentsConfig.enabled) return;
    const pending = booking.payments.find(
      (payment) => payment.status === PaymentStatus.PENDING && payment.stripeSessionId
    );
    if (!pending?.stripeSessionId) return;

    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(pending.stripeSessionId);
      if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
        await this.fulfillCheckoutSession(session);
      } else if (session.status === 'expired') {
        await this.expireUnpaidBooking(
          booking.id,
          'Checkout Session expired before payment.',
          PaymentStatus.EXPIRED
        );
      }
    } catch (error: any) {
      // The webhook remains the source of truth; a transient Stripe lookup
      // failure must not make the status page fail.
      log.warn({ err: error, bookingId: booking.id }, 'payment reconciliation failed');
    }
  }

  private toStatusResponse(booking: BookingWithPayments) {
    const latest = booking.payments[0];
    return {
      bookingId: booking.id,
      bookingStatus: booking.status,
      paymentExpiresAt: booking.paymentExpiresAt?.toISOString() ?? null,
      payment: latest ? paymentSummary(latest) : null,
    };
  }
}

export const paymentService = new PaymentService();
