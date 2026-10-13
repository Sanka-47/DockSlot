import { Router } from 'express';
import { getBookings, createBooking } from '../controllers/booking.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { requireCarrierDispatcher } from '../middleware/rbac.middleware';

const router = Router();

router.get('/', authMiddleware, getBookings);
// Sensitive action: creating a booking requires email verification and Carrier Dispatcher role
router.post('/', authMiddleware, requireVerifiedEmail, requireCarrierDispatcher, createBooking);

export default router;
