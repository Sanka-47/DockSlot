import { Router } from 'express';
import { inviteUser } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();

/**
 * POST /api/users/invite
 * Restricted strictly to CARRIER_ADMIN and WAREHOUSE_ADMIN.
 * Invites a new team member and auto-assigns role/organization.
 */
router.post(
  '/invite',
  authenticate,
  authorize(['CARRIER_ADMIN', 'WAREHOUSE_ADMIN']),
  inviteUser
);

export default router;
