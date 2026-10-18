import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  getMe,
  verifyEmail,
  resendVerification,
  acceptInvite,
  getInvitationDetails,
  logoutAll,
  setup2FA,
  verifyAndEnable2FA,
  disable2FA,
  loginVerify2FA,
  get2FAStatus,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { twoFactorRateLimiter } from '../middleware/rateLimit.middleware';

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
 *       429:
 *         description: Too many API requests (rate limit exceeded)
 */
router.post('/register', register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate user and issue JWT token
 *     description: |
 *       Authenticates a user by email and password and issues signed JWT tokens (JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN).
 *       Tracks consecutive failed login attempts and locks the account for LOGIN_LOCKOUT_DURATION_MINUTES after MAX_FAILED_LOGIN_ATTEMPTS failures.
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
 *         description: Invalid credentials (with remaining attempts before lockout)
 *       403:
 *         description: Account deactivated
 *       423:
 *         description: Account temporarily locked due to consecutive failed login attempts
 *       429:
 *         description: Too many API requests (rate limit exceeded)
 */
router.post('/login', login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new access token
 *     description: |
 *       Redeems the refresh JWT stored in the `refreshToken` HttpOnly cookie for a fresh access
 *       token (JWT_EXPIRES_IN) and a rotated refresh cookie (JWT_REFRESH_EXPIRES_IN). A raw
 *       `refreshToken` may also be supplied in the body for non-browser clients. The token must be
 *       of type `refresh` and will be rejected if the user is deactivated or has logged out of all
 *       devices (token version revoked).
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Optional fallback for non-browser clients; browsers use the cookie.
 *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: New access token issued; refresh cookie rotated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 token:
 *                   type: string
 *                   description: New access JWT
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Refresh token missing
 *       401:
 *         description: Refresh token invalid, expired, wrong type, or revoked
 *       403:
 *         description: Account deactivated
 *       429:
 *         description: Too many API requests (rate limit exceeded)
 */
router.post('/refresh', refresh);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Log out the current browser session
 *     description: Clears the `refreshToken` HttpOnly cookie. Already-issued access tokens remain valid until they expire; use /auth/logout-all to revoke those too.
 *     tags:
 *       - Authentication
 *     security: []
 *     responses:
 *       200:
 *         description: Refresh cookie cleared
 */
router.post('/logout', logout);

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
 * /auth/invitation:
 *   get:
 *     summary: Retrieve invitation details by token to verify before registering
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
 *         description: Invitation details retrieved successfully
 *       400:
 *         description: Invalid or expired token
 *       404:
 *         description: Invitation not found
 */
router.get('/invitation', getInvitationDetails);

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
router.post('/forgot-password', forgotPassword);

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
router.post('/reset-password', resetPassword);

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

/**
 * @openapi
 * /auth/logout-all:
 *   post:
 *     summary: Log out of all devices by invalidating all active sessions
 *     description: Increments the user's token version in Redis, instantly invalidating all active JWTs across every device.
 *     tags:
 *       - Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully logged out of all devices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Successfully logged out of all devices.
 *       401:
 *         description: Unauthorized. Missing or invalid token.
 */
router.post('/logout-all', authenticate, logoutAll);

/**
 * @openapi
 * /auth/2fa/status:
 *   get:
 *     summary: Retrieve the two-factor authentication status of the current user
 *     tags:
 *       - Two-Factor Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 2FA status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     isTwoFactorEnabled:
 *                       type: boolean
 *                       example: false
 *                     isSetupPending:
 *                       type: boolean
 *                       description: True when a TOTP secret exists but 2FA has not been confirmed yet.
 *                       example: false
 *       401:
 *         description: Unauthorized. Missing or invalid token.
 */
router.get('/2fa/status', authenticate, get2FAStatus);

/**
 * @openapi
 * /auth/2fa/setup:
 *   post:
 *     summary: Generate a new TOTP secret and QR code for authenticator apps
 *     description: |
 *       Generates a base32 TOTP secret for the authenticated user and returns a QR code data URL,
 *       the base32 secret string, and the otpauth:// provisioning URI. The secret is persisted on the
 *       user record but 2FA stays disabled until POST /auth/2fa/verify-and-enable confirms a valid code.
 *       Re-invoking this endpoint rotates the secret (any previously scanned QR code becomes invalid).
 *     tags:
 *       - Two-Factor Authentication
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Secret and QR code generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: TOTP 2FA secret and QR code generated successfully.
 *                 data:
 *                   type: object
 *                   properties:
 *                     secret:
 *                       type: string
 *                       description: Base32-encoded TOTP secret for manual entry
 *                       example: JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
 *                     qrCode:
 *                       type: string
 *                       description: PNG data URL (data:image/png;base64,...) to render in an <img> tag
 *                       example: data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...
 *                     otpauthUrl:
 *                       type: string
 *                       example: otpauth://totp/DockSlot%20(admin%40swiftlogistics.com)?secret=JBSWY3DPEHPK3PXP&issuer=DockSlot
 *                 secret:
 *                   type: string
 *                 qrCode:
 *                   type: string
 *                 otpauthUrl:
 *                   type: string
 *       401:
 *         description: Unauthorized. Missing or invalid token.
 *       404:
 *         description: User not found
 */
router.post('/2fa/setup', authenticate, setup2FA);

/**
 * @openapi
 * /auth/2fa/verify-and-enable:
 *   post:
 *     summary: Confirm a 6-digit TOTP code and enable 2FA for the account
 *     description: Verifies the provided code against the stored TOTP secret and sets isTwoFactorEnabled to true. A ±1 step (30 second) window is allowed for clock drift.
 *     tags:
 *       - Two-Factor Authentication
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: The 6-digit code shown in the authenticator app
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: 2FA enabled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Two-factor authentication has been enabled successfully.
 *                 isTwoFactorEnabled:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Missing/invalid code format, setup not initiated, or the code did not verify
 *       401:
 *         description: Unauthorized. Missing or invalid token.
 *       404:
 *         description: User not found
 */
router.post('/2fa/verify-and-enable', authenticate, twoFactorRateLimiter, verifyAndEnable2FA);

/**
 * @openapi
 * /auth/2fa/disable:
 *   post:
 *     summary: Disable 2FA for the account
 *     description: Requires either the current account password or a valid 6-digit TOTP code as proof of possession. On success the stored TOTP secret is cleared.
 *     tags:
 *       - Two-Factor Authentication
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Current account password (provide this or `token`)
 *                 example: SecurePass123!
 *               token:
 *                 type: string
 *                 description: Valid 6-digit TOTP code (provide this or `password`)
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: 2FA disabled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Two-factor authentication has been disabled successfully.
 *                 isTwoFactorEnabled:
 *                   type: boolean
 *                   example: false
 *       400:
 *         description: 2FA is not enabled, or neither password nor a valid code was supplied
 *       401:
 *         description: Unauthorized, incorrect password, or invalid TOTP code
 *       404:
 *         description: User not found
 */
router.post('/2fa/disable', authenticate, twoFactorRateLimiter, disable2FA);

/**
 * @openapi
 * /auth/2fa/login-verify:
 *   post:
 *     summary: Complete a two-step login by verifying the 6-digit TOTP code
 *     description: |
 *       Second step of the 2FA login flow. Supply the `tempToken` returned by POST /auth/login (mode A),
 *       or supply `email` + `password` together with the code (mode B). On success the final access and
 *       refresh JWTs are issued and any failed-login counters are reset.
 *     tags:
 *       - Two-Factor Authentication
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: The 6-digit code shown in the authenticator app
 *                 example: "123456"
 *               tempToken:
 *                 type: string
 *                 description: Short-lived (5 minute) token returned by POST /auth/login when requires2FA is true
 *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Alternative to tempToken — the account email
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Alternative to tempToken — the account password
 *     responses:
 *       200:
 *         description: 2FA verified, final JWT issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Two-factor authentication verified successfully. Logged in.
 *                 token:
 *                   type: string
 *                   description: Final access JWT
 *                 refreshToken:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Missing/malformed code, no tempToken or credentials supplied, or 2FA is not enabled for the account
 *       401:
 *         description: Invalid/expired temp token, invalid credentials, or invalid TOTP code
 *       403:
 *         description: Account deactivated
 *       404:
 *         description: User not found
 *       429:
 *         description: Too many API requests (rate limit exceeded)
 */
router.post('/2fa/login-verify', twoFactorRateLimiter, loginVerify2FA);

export default router;
