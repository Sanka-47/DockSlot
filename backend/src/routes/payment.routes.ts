import { Router } from 'express';
import {
  createCheckoutSession,
  getBookingPaymentStatus,
  getSessionPaymentStatus,
} from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { requireCarrierRole } from '../middleware/rbac.middleware';
import { paymentRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

/**
 * The Stripe webhook is deliberately not declared here. It is mounted in
 * `app.ts` before `express.json()` so `express.raw()` preserves the exact bytes
 * Stripe signed. Adding it to this router would parse the body first and break
 * signature verification.
 *
 * POST /api/payments/webhook -> handleStripeWebhook
 */

/**
 * @openapi
 * /payments/bookings/{bookingId}/checkout:
 *   post:
 *     summary: Create or retry a Stripe Checkout Session
 *     tags:
 *       - Payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Stripe Checkout URL
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Booking belongs to another carrier
 *       409:
 *         description: Booking is no longer awaiting payment
 */
router.post(
  '/bookings/:bookingId/checkout',
  authMiddleware,
  requireVerifiedEmail,
  requireCarrierRole,
  paymentRateLimiter,
  createCheckoutSession
);

/**
 * @openapi
 * /payments/bookings/{bookingId}:
 *   get:
 *     summary: Get payment status for a booking
 *     tags:
 *       - Payments
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/bookings/:bookingId',
  authMiddleware,
  requireVerifiedEmail,
  getBookingPaymentStatus
);

/**
 * @openapi
 * /payments/sessions/{sessionId}:
 *   get:
 *     summary: Get payment status for a Stripe Checkout Session
 *     tags:
 *       - Payments
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/sessions/:sessionId',
  authMiddleware,
  requireVerifiedEmail,
  getSessionPaymentStatus
);

export default router;
