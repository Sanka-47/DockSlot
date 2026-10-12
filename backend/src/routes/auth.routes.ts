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
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public auth endpoints
router.post('/register', register);
router.post('/login', login);
router.get('/verify', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Authenticated user endpoints
router.get('/me', authenticate, getMe);
router.post('/change-password', authenticate, changePassword);

export default router;
