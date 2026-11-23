import { Request, Response } from 'express';
import { paymentService } from '../services/payment.service';
import { sendError } from '../utils/httpError';
import { childLogger } from '../utils/logger';

const log = childLogger({ component: 'payment-controller' });

function parseId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  return parseInt(raw || '', 10);
}

/**
 * POST /api/payments/bookings/:bookingId/checkout
 * Creates a fresh Stripe-hosted Checkout Session for a pending booking.
 */
export const createCheckoutSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const bookingId = parseId(req.params.bookingId);
    if (isNaN(bookingId)) {
      res.status(400).json({ success: false, message: 'Invalid booking ID.' });
      return;
    }

    const checkout = await paymentService.createCheckoutForBooking(
      bookingId,
      organizationId,
      req.user?.email
    );

    res.status(200).json({
      success: true,
      message: 'Checkout Session created.',
      data: checkout,
    });
  } catch (error: any) {
    sendError(res, error, 'Could not start checkout.');
  }
};

/**
 * GET /api/payments/bookings/:bookingId
 * Tenant-safe payment status for a booking.
 */
export const getBookingPaymentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const bookingId = parseId(req.params.bookingId);
    if (isNaN(bookingId)) {
      res.status(400).json({ success: false, message: 'Invalid booking ID.' });
      return;
    }

    const status = await paymentService.getPaymentStatusForBooking(bookingId, organizationId);
    res.status(200).json({ success: true, data: status });
  } catch (error: any) {
    sendError(res, error, 'Could not load payment status.');
  }
};

/**
 * GET /api/payments/sessions/:sessionId
 * Used by the Stripe return page. Access is still scoped to the caller's tenant.
 */
export const getSessionPaymentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const sessionId = Array.isArray(req.params.sessionId)
      ? req.params.sessionId[0]
      : req.params.sessionId;
    if (!sessionId || !sessionId.startsWith('cs_')) {
      res.status(400).json({ success: false, message: 'Invalid Checkout Session ID.' });
      return;
    }

    const status = await paymentService.getPaymentStatusForSession(sessionId, organizationId);
    res.status(200).json({ success: true, data: status });
  } catch (error: any) {
    sendError(res, error, 'Could not load payment status.');
  }
};

/**
 * POST /api/payments/webhook
 *
 * Mounted with express.raw() in app.ts BEFORE express.json(). Stripe's
 * signature is over the exact raw bytes, so parsing the body first would make
 * every signature invalid.
 */
export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['stripe-signature'];
    await paymentService.handleWebhook(
      req.body as Buffer,
      Array.isArray(signature) ? signature[0] : signature
    );
    res.status(200).json({ received: true });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    log.error({ err: error, status }, 'Stripe webhook delivery failed');
    res.status(status).json({
      received: false,
      message: status === 400 ? 'Invalid Stripe webhook.' : 'Webhook processing failed.',
    });
  }
};
