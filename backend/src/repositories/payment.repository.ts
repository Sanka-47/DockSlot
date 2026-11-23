import { BookingStatus, PaymentStatus, Prisma } from '@prisma/client';
import { DbClient, db, transaction } from './base.repository';

const bookingWithPaymentInclude = Prisma.validator<Prisma.BookingInclude>()({
  dock: {
    include: {
      warehouse: true,
    },
  },
  carrierOrg: true,
  payments: {
    orderBy: { createdAt: 'desc' },
  },
});

export type BookingWithPayments = Prisma.BookingGetPayload<{
  include: typeof bookingWithPaymentInclude;
}>;

export const paymentRepository = {
  transaction,

  findBookingForPayment(bookingId: number, client: DbClient = db) {
    return client.booking.findUnique({
      where: { id: bookingId },
      include: bookingWithPaymentInclude,
    });
  },

  findBookingForPaymentBySession(sessionId: string, client: DbClient = db) {
    return client.booking.findFirst({
      where: {
        payments: {
          some: { stripeSessionId: sessionId },
        },
      },
      include: bookingWithPaymentInclude,
    });
  },

  findPaymentBySessionId(sessionId: string, client: DbClient = db) {
    return client.payment.findFirst({
      where: { stripeSessionId: sessionId },
      include: {
        booking: {
          include: bookingWithPaymentInclude,
        },
      },
    });
  },

  findPaymentByIntentId(paymentIntentId: string, client: DbClient = db) {
    return client.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
      include: {
        booking: {
          include: bookingWithPaymentInclude,
        },
      },
    });
  },

  findLatestPayment(bookingId: number, client: DbClient = db) {
    return client.payment.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
  },

  findLatestPendingPayment(bookingId: number, client: DbClient = db) {
    return client.payment.findFirst({
      where: { bookingId, status: PaymentStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  },

  createPayment(data: Prisma.PaymentUncheckedCreateInput, client: DbClient = db) {
    return client.payment.create({ data });
  },

  updatePayment(
    paymentId: number,
    data: Prisma.PaymentUncheckedUpdateInput,
    client: DbClient = db
  ) {
    return client.payment.update({
      where: { id: paymentId },
      data,
    });
  },

  markPaymentPaid(
    paymentId: number,
    stripePaymentIntentId: string | null,
    client: DbClient = db
  ) {
    return client.payment.updateMany({
      // A late payment can arrive after the sweeper marked the attempt EXPIRED
      // or FAILED. Stripe charged the customer, so still record it as PAID.
      where: {
        id: paymentId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.EXPIRED, PaymentStatus.FAILED] },
      },
      data: {
        status: PaymentStatus.PAID,
        paidAt: new Date(),
        stripePaymentIntentId,
        failureReason: null,
      },
    });
  },

  markPendingPayments(
    bookingId: number,
    status: PaymentStatus,
    failureReason: string,
    exceptPaymentId?: number,
    client: DbClient = db
  ) {
    return client.payment.updateMany({
      where: {
        bookingId,
        status: PaymentStatus.PENDING,
        ...(exceptPaymentId !== undefined ? { id: { not: exceptPaymentId } } : {}),
      },
      data: {
        status,
        failedAt: new Date(),
        failureReason,
      },
    });
  },

  markBookingPaid(bookingId: number, client: DbClient = db) {
    return client.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.PENDING_PAYMENT },
      data: {
        status: BookingStatus.BOOKED,
        paymentExpiresAt: null,
      },
    });
  },

  cancelUnpaidBooking(bookingId: number, client: DbClient = db) {
    return client.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.PENDING_PAYMENT },
      data: {
        status: BookingStatus.CANCELLED,
        activeLock: null,
        paymentExpiresAt: null,
      },
    });
  },

  updateBookingPaymentExpiry(
    bookingId: number,
    paymentExpiresAt: Date | null,
    client: DbClient = db
  ) {
    return client.booking.update({
      where: { id: bookingId },
      data: { paymentExpiresAt },
    });
  },

  findExpiredPendingBookings(now: Date, take: number, client: DbClient = db) {
    // Give Stripe's paid/expired webhooks a short grace period before the
    // sweeper releases a hold. Without it, a payment that lands at the exact
    // expiry boundary can race the cancellation.
    const graceCutoff = new Date(now.getTime() - 2 * 60 * 1000);
    return client.booking.findMany({
      where: {
        status: BookingStatus.PENDING_PAYMENT,
        OR: [{ paymentExpiresAt: { lte: graceCutoff } }, { slotStartTime: { lte: now } }],
      },
      select: { id: true },
      orderBy: { paymentExpiresAt: 'asc' },
      take,
    });
  },

  createWebhookEvent(
    data: Prisma.StripeWebhookEventUncheckedCreateInput,
    client: DbClient = db
  ) {
    return client.stripeWebhookEvent.create({ data });
  },

  findWebhookEvent(stripeEventId: string, client: DbClient = db) {
    return client.stripeWebhookEvent.findUnique({
      where: { stripeEventId },
    });
  },

  updateWebhookEvent(
    stripeEventId: string,
    data: Prisma.StripeWebhookEventUncheckedUpdateInput,
    client: DbClient = db
  ) {
    return client.stripeWebhookEvent.update({
      where: { stripeEventId },
      data,
    });
  },
};
