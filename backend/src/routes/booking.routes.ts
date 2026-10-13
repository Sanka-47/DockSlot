import { Router } from 'express';
import { getBookings, createBooking } from '../controllers/booking.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { requireCarrierDispatcher } from '../middleware/rbac.middleware';
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

export default router;
