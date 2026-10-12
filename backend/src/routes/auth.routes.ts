import { Router } from 'express';
import { register, login, resetPassword, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public auth endpoints
router.post('/register', register);
router.post('/login', login);
router.post('/reset-password', resetPassword);

// Authenticated user endpoints
router.get('/me', authenticate, getMe);
router.post('/change-password', authenticate, resetPassword);

export default router;
