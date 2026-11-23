import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  createSession: vi.fn(),
  retrieveSession: vi.fn(),
  createRefund: vi.fn(),
  findWebhookEvent: vi.fn(),
  createWebhookEvent: vi.fn(),
  updateWebhookEvent: vi.fn(),
  findPaymentBySessionId: vi.fn(),
  findPaymentByIntentId: vi.fn(),
  findLatestPendingPayment: vi.fn(),
  findBookingForPayment: vi.fn(),
  findBookingForPaymentBySession: vi.fn(),
  createPayment: vi.fn(),
  updatePayment: vi.fn(),
  markPaymentPaid: vi.fn(),
  markPendingPayments: vi.fn(),
  markBookingPaid: vi.fn(),
  cancelUnpaidBooking: vi.fn(),
  updateBookingPaymentExpiry: vi.fn(),
  findExpiredPendingBookings: vi.fn(),
  transaction: vi.fn(),
  recordLog: vi.fn(),
  enqueue: vi.fn(),
  toBookingSummary: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mocks.constructEvent };
    checkout = { sessions: { create: mocks.createSession, retrieve: mocks.retrieveSession } };
    refunds = { create: mocks.createRefund };
  },
}));

vi.mock('../src/config/payments.config', () => ({
  paymentsConfig: {
    mode: 'stripe',
    enabled: true,
    secretKey: 'sk_test_mock',
    webhookSecret: 'whsec_mock',
    holdMinutes: 30,
    minLeadMinutes: 30,
    expirySweepIntervalMs: 60_000,
    frontendUrl: 'http://localhost:5173',
    successUrl: 'http://localhost:5173/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'http://localhost:5173/?checkout=cancelled',
  },
}));

vi.mock('../src/repositories/payment.repository', () => ({
  paymentRepository: {
    transaction: mocks.transaction,
    findWebhookEvent: mocks.findWebhookEvent,
    createWebhookEvent: mocks.createWebhookEvent,
    updateWebhookEvent: mocks.updateWebhookEvent,
    findPaymentBySessionId: mocks.findPaymentBySessionId,
    findPaymentByIntentId: mocks.findPaymentByIntentId,
    findLatestPendingPayment: mocks.findLatestPendingPayment,
    findBookingForPayment: mocks.findBookingForPayment,
    findBookingForPaymentBySession: mocks.findBookingForPaymentBySession,
    createPayment: mocks.createPayment,
    updatePayment: mocks.updatePayment,
    markPaymentPaid: mocks.markPaymentPaid,
    markPendingPayments: mocks.markPendingPayments,
    markBookingPaid: mocks.markBookingPaid,
    cancelUnpaidBooking: mocks.cancelUnpaidBooking,
    updateBookingPaymentExpiry: mocks.updateBookingPaymentExpiry,
    findExpiredPendingBookings: mocks.findExpiredPendingBookings,
  },
}));

vi.mock('../src/services/audit.service', () => ({
  auditLogService: { recordLog: mocks.recordLog },
}));

vi.mock('../src/services/outbox.service', () => ({
  OUTBOX_EVENT_TYPE: { BOOKING_CREATED: 'BOOKING_CREATED' },
  outboxService: {
    enqueue: mocks.enqueue,
    toBookingSummary: mocks.toBookingSummary,
    describeSlot: () => '2026-12-01 10:00',
  },
}));

import { paymentService } from '../src/services/payment.service';

const booking = {
  id: 5,
  dockId: 3,
  carrierOrgId: 7,
  slotStartTime: new Date('2026-12-01T10:00:00.000Z'),
  slotEndTime: new Date('2026-12-01T11:00:00.000Z'),
  truckPlate: 'CAB-1234',
  driverName: 'Driver',
  driverPhone: '0770000000',
  cargoNote: null,
  status: 'PENDING_PAYMENT',
  activeLock: 'ACTIVE',
  paymentExpiresAt: new Date('2026-12-01T09:00:00.000Z'),
  createdByUserId: 9,
  createdAt: new Date(),
  updatedAt: new Date(),
  dock: {
    id: 3,
    warehouseId: 2,
    name: 'Dock A',
    status: 'ACTIVE',
    warehouse: {
      id: 2,
      name: 'Colombo Terminal',
      organizationId: 1,
      slotPriceCents: 250000,
      currency: 'LKR',
    },
  },
  carrierOrg: { id: 7, name: 'Carrier Co', type: 'CARRIER' },
  payments: [],
};

const session = {
  id: 'cs_test_123',
  payment_status: 'paid',
  status: 'complete',
  amount_total: 250000,
  currency: 'lkr',
  payment_intent: 'pi_test_123',
};

const event = {
  id: 'evt_test_123',
  type: 'checkout.session.completed',
  data: { object: session },
};

describe('Stripe payment webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
    mocks.findWebhookEvent.mockResolvedValue(null);
    mocks.createWebhookEvent.mockResolvedValue({});
    mocks.updateWebhookEvent.mockResolvedValue({});
    mocks.findPaymentBySessionId.mockResolvedValue({
      id: 10,
      bookingId: 5,
      status: 'PENDING',
      amountCents: 250000,
      currency: 'LKR',
      stripePaymentIntentId: null,
      booking,
    });
    mocks.markPaymentPaid.mockResolvedValue({ count: 1 });
    mocks.markPendingPayments.mockResolvedValue({ count: 0 });
    mocks.markBookingPaid.mockResolvedValue({ count: 1 });
    mocks.findBookingForPayment.mockResolvedValue(booking);
    mocks.recordLog.mockResolvedValue({});
    mocks.enqueue.mockResolvedValue({});
    mocks.toBookingSummary.mockReturnValue({
      id: 5,
      truckPlate: 'CAB-1234',
      dockId: 3,
      dockName: 'Dock A',
      warehouseName: 'Colombo Terminal',
      slotStartTime: '2026-12-01T10:00:00.000Z',
      slotEndTime: '2026-12-01T11:00:00.000Z',
    });
  });

  it('rejects a missing Stripe signature before touching the database', async () => {
    await expect(paymentService.handleWebhook(Buffer.from('{}'), undefined)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.findWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects an invalid Stripe signature', async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    await expect(
      paymentService.handleWebhook(Buffer.from('{}'), 't=1,v1=bad')
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.findWebhookEvent).not.toHaveBeenCalled();
  });

  it('acknowledges an already-processed event without re-running fulfillment', async () => {
    mocks.constructEvent.mockReturnValue(event);
    mocks.findWebhookEvent.mockResolvedValue({ status: 'PROCESSED' });

    await expect(
      paymentService.handleWebhook(Buffer.from('{}'), 't=1,v1=valid')
    ).resolves.toEqual({ duplicate: true });

    expect(mocks.markPaymentPaid).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('marks the booking paid and enqueues the notification exactly once', async () => {
    mocks.constructEvent.mockReturnValue(event);

    await expect(
      paymentService.handleWebhook(Buffer.from('{}'), 't=1,v1=valid')
    ).resolves.toEqual({ processed: true });

    expect(mocks.markPaymentPaid).toHaveBeenCalledWith(10, 'pi_test_123', {});
    expect(mocks.markBookingPaid).toHaveBeenCalledWith(5, {});
    expect(mocks.recordLog).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 5, userId: 9, action: 'PAYMENT_SUCCEEDED' })
    );
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.updateWebhookEvent).toHaveBeenCalledWith(
      'evt_test_123',
      expect.objectContaining({ status: 'PROCESSED' })
    );
  });

  it('refunds a late payment when the booking was released before fulfillment', async () => {
    mocks.constructEvent.mockReturnValue(event);
    mocks.markBookingPaid.mockResolvedValue({ count: 0 });
    mocks.findBookingForPayment
      .mockResolvedValueOnce({ ...booking, status: 'CANCELLED' })
      .mockResolvedValueOnce({
        ...booking,
        status: 'CANCELLED',
        payments: [
          {
            id: 10,
            status: 'PAID',
            amountCents: 250000,
            currency: 'LKR',
            stripePaymentIntentId: 'pi_test_123',
          },
        ],
      });
    mocks.createRefund.mockResolvedValue({ amount: 250000 });

    await expect(
      paymentService.handleWebhook(Buffer.from('{}'), 't=1,v1=valid')
    ).resolves.toEqual({ processed: true });

    expect(mocks.markPaymentPaid).toHaveBeenCalledWith(10, 'pi_test_123', {});
    expect(mocks.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test_123' }),
      { idempotencyKey: 'refund-booking-5' }
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('does not fulfill an unpaid checkout.session.completed event', async () => {
    mocks.constructEvent.mockReturnValue({
      ...event,
      data: { object: { ...session, payment_status: 'unpaid' } },
    });

    await expect(
      paymentService.handleWebhook(Buffer.from('{}'), 't=1,v1=valid')
    ).resolves.toEqual({ processed: true });

    expect(mocks.markPaymentPaid).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('creates a server-side Checkout Session using the warehouse price snapshot', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const payment = {
      id: 10,
      bookingId: 5,
      status: 'PENDING',
      amountCents: 250000,
      currency: 'LKR',
      expiresAt,
      idempotencyKey: 'idem_123',
      checkoutUrl: null,
      stripeSessionId: null,
    };

    mocks.findBookingForPayment.mockResolvedValue(booking);
    mocks.findLatestPendingPayment.mockResolvedValue(null);
    mocks.createPayment.mockResolvedValue(payment);
    mocks.createSession.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    });
    mocks.updatePayment.mockResolvedValue({
      ...payment,
      stripeSessionId: 'cs_test_123',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
    });
    mocks.updateBookingPaymentExpiry.mockResolvedValue(booking);

    const result = await paymentService.createCheckoutForBooking(
      5,
      7,
      'dispatcher@ceylonfreight.com'
    );

    expect(result).toMatchObject({
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      sessionId: 'cs_test_123',
    });
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        client_reference_id: '5',
        customer_email: 'dispatcher@ceylonfreight.com',
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              currency: 'lkr',
              unit_amount: 250000,
            }),
          }),
        ],
        metadata: expect.objectContaining({
          bookingId: '5',
          carrierOrgId: '7',
          warehouseId: '2',
        }),
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('checkout-10-') })
    );
    expect(mocks.updateBookingPaymentExpiry).toHaveBeenCalledWith(5, expect.any(Date));
  });

  it('rejects Checkout creation for another carrier tenant', async () => {
    mocks.findBookingForPayment.mockResolvedValue(booking);

    await expect(paymentService.createCheckoutForBooking(5, 999)).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('rejects a paid session whose amount does not match the booking snapshot', async () => {
    mocks.constructEvent.mockReturnValue({
      ...event,
      data: { object: { ...session, amount_total: 1 } },
    });

    await expect(
      paymentService.handleWebhook(Buffer.from('{}'), 't=1,v1=valid')
    ).rejects.toThrow(/amount mismatch/i);
    expect(mocks.markPaymentPaid).not.toHaveBeenCalled();
    expect(mocks.updateWebhookEvent).toHaveBeenCalledWith(
      'evt_test_123',
      expect.objectContaining({ status: 'FAILED' })
    );
  });
});
