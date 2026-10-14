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

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register a new organization and admin user
 *     description: Creates an Organization (CARRIER or WAREHOUSE_OPERATOR) and assigns CARRIER_ADMIN or WAREHOUSE_ADMIN.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - organizationType
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@swiftlogistics.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: SecurePass123!
 *               organizationName:
 *                 type: string
 *                 example: Swift Logistics Corp
 *               orgName:
 *                 type: string
 *                 example: Swift Logistics Corp
 *               organizationType:
 *                 type: string
 *                 enum: [CARRIER, WAREHOUSE_OPERATOR]
 *                 example: CARRIER
 *               orgType:
 *                 type: string
 *                 enum: [CARRIER, WAREHOUSE_OPERATOR]
 *                 example: CARRIER
 *     responses:
 *       201:
 *         description: Registration successful, returns user details and JWT token
 *       400:
 *         description: Validation error or missing required fields
 *       409:
 *         description: Email already registered
 */
router.post('/register', register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate user and issue JWT token
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@swiftlogistics.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: SecurePass123!
 *     responses:
 *       200:
 *         description: Login successful, returns JWT token
 *       401:
 *         description: Invalid credentials or account locked
 */
router.post('/login', authRateLimiter, login);

/**
 * @openapi
 * /auth/accept-invite:
 *   post:
 *     summary: Accept a team member invitation and set account password
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *                 description: Secure invitation token sent via email
 *                 example: 3b1f4869c97b830e2f5b6140adbb8f0174ca29dfa98e15099fbc
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: Password123!
 *     responses:
 *       201:
 *         description: Account created successfully and user logged in
 *       400:
 *         description: Expired token or validation error
 *       404:
 *         description: Invitation token not found
 *       409:
 *         description: User email already registered
 */
router.post('/accept-invite', acceptInvite);

/**
 * @openapi
 * /auth/verify:
 *   get:
 *     summary: Verify user email address with email token
 *     tags:
 *       - Authentication
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired verification token
 */
router.get('/verify', verifyEmail);

/**
 * @openapi
 * /auth/resend-verification:
 *   post:
 *     summary: Resend verification email
 *     tags:
 *       - Authentication
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Verification email resent
 */
router.post('/resend-verification', resendVerification);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password reset link
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Reset email sent if account exists
 */
router.post('/forgot-password', authRateLimiter, forgotPassword);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     summary: Reset account password with reset token
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password', authRateLimiter, resetPassword);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Retrieve currently authenticated user profile and tenant context
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authenticate, getMe);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     summary: Change password for currently authenticated user
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - oldPassword
 *               - newPassword
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       401:
 *         description: Unauthorized or invalid old password
 */
router.post('/change-password', authenticate, changePassword);

export default router;
