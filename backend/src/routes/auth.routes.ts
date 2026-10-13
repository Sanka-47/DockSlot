import { Router } from 'express';
import {
  register,
  login,
  forgotPassword,
  resetPassword,
  changePassword,
  getMe,
  verifyEmail,
  resendVerification,
  acceptInvite,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// Public auth endpoints
router.post('/register', register);
router.post('/login', authRateLimiter, login);
router.post('/accept-invite', acceptInvite);
router.get('/verify', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/forgot-password', authRateLimiter, forgotPassword);
router.post('/reset-password', authRateLimiter, resetPassword);

// Authenticated user endpoints
router.get('/me', authenticate, getMe);
router.post('/change-password', authenticate, changePassword);

export default router;
