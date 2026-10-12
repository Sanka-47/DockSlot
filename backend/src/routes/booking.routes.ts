import { Router } from 'express';
import { getBookings, createBooking } from '../controllers/booking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';

const router = Router();

router.get('/', authenticate, getBookings);
// Sensitive action: creating a booking requires email verification guard
router.post('/', authenticate, requireVerifiedEmail, createBooking);

export default router;
