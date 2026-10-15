import { Router } from 'express';
import { inviteUser, getUsers, deactivateUser } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();

/**
 * @openapi
 * /users/invite:
 *   post:
 *     summary: Invite a team member with auto-assigned role and organization
 *     description: |
 *       Restricted strictly to CARRIER_ADMIN or WAREHOUSE_ADMIN.
 *       - CARRIER_ADMIN invites automatically assign the DISPATCHER role in the carrier organization.
 *       - WAREHOUSE_ADMIN invites automatically assign the DOCK_MANAGER role in the warehouse organization.
 *       Generates a secure 32-byte hex token valid for 48 hours and dispatches an invitation email.
 *     tags:
 *       - Users & Invitations
 *     security:
 *       - bearerAuth: []
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
 *                 description: Email address of the team member to invite
 *                 example: dispatcher@swiftlogistics.com
 *     responses:
 *       201:
 *         description: Invitation created and email dispatched successfully
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
 *                   example: Invitation successfully created for dispatcher@swiftlogistics.com as DISPATCHER.
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     email:
 *                       type: string
 *                     organizationId:
 *                       type: integer
 *                     role:
 *                       type: string
 *                       example: DISPATCHER
 *                     token:
 *                       type: string
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                     status:
 *                       type: string
 *                       example: PENDING
 *       400:
 *         description: Invalid email format or missing email
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden. Requester is not CARRIER_ADMIN or WAREHOUSE_ADMIN
 *       409:
 *         description: User already registered with this email
 */
router.post(
  '/invite',
  authenticate,
  authorize(['CARRIER_ADMIN', 'WAREHOUSE_ADMIN']),
  inviteUser
);

/**
 * @openapi
 * /users:
 *   get:
 *     summary: List all users in the authenticated admin's organization
 *     description: Restricted strictly to CARRIER_ADMIN or WAREHOUSE_ADMIN.
 *     tags:
 *       - Users & Invitations
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of organization users
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden
 */
router.get(
  '/',
  authenticate,
  authorize(['CARRIER_ADMIN', 'WAREHOUSE_ADMIN']),
  getUsers
);

/**
 * @openapi
 * /users/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a user and sever active sessions
 *     description: |
 *       Restricted strictly to CARRIER_ADMIN or WAREHOUSE_ADMIN managing users within their organization.
 *       Sets isActive = false in MySQL and increments the user's tokenVersion in Redis to immediately sever access.
 *     tags:
 *       - Users & Invitations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Target user ID to deactivate
 *     responses:
 *       200:
 *         description: User deactivated successfully
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
 *                   example: User deactivated successfully.
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid target user ID
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden. Requester is not an admin or target belongs to another organization
 *       404:
 *         description: Target user not found
 */
router.patch(
  '/:id/deactivate',
  authenticate,
  authorize(['CARRIER_ADMIN', 'WAREHOUSE_ADMIN']),
  deactivateUser
);

export default router;
