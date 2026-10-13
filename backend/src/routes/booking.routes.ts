import { Router } from 'express';
import {
  getBookings,
  createBooking,
  rescheduleBooking,
  cancelBooking,
  getBookingAuditLogs,
} from '../controllers/booking.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { requireCarrierDispatcher, requireCarrierRole } from '../middleware/rbac.middleware';
import { idempotencyMiddleware } from '../middleware/idempotency.middleware';

const router = Router();

router.get('/', authMiddleware, getBookings);

// Sensitive action: creating a booking requires email verification, Carrier Dispatcher role, and idempotency protection
router.post(
  '/',
  authMiddleware,
  requireVerifiedEmail,
  requireCarrierDispatcher,
  idempotencyMiddleware,
  createBooking
);

// Reschedule booking: Carrier Dispatcher or Carrier Admin with verified email
router.patch(
  '/:id/reschedule',
  authMiddleware,
  requireVerifiedEmail,
  requireCarrierRole,
  rescheduleBooking
);

// Cancel booking: Carrier Dispatcher or Carrier Admin with verified email
router.patch(
  '/:id/cancel',
  authMiddleware,
  requireVerifiedEmail,
  requireCarrierRole,
  cancelBooking
);

// DELETE alias for cancellation
router.delete(
  '/:id',
  authMiddleware,
  requireVerifiedEmail,
  requireCarrierRole,
  cancelBooking
);

// Audit logs: dual-sided visibility (Carrier Organization or Warehouse Operator Organization)
router.get('/:id/audit-logs', authMiddleware, getBookingAuditLogs);

export default router;
