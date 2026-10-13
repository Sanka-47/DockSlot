import { Router } from 'express';
import { createDockClosure, getDockClosures } from '../controllers/warehouse.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { requireWarehouseStaff } from '../middleware/rbac.middleware';

const router = Router();

// Scheduled maintenance closures for a dock (WAREHOUSE_ADMIN / DOCK_MANAGER)
router.post(
  '/:dockId/closures',
  authMiddleware,
  requireVerifiedEmail,
  requireWarehouseStaff,
  createDockClosure
);

router.get(
  '/:dockId/closures',
  authMiddleware,
  requireWarehouseStaff,
  getDockClosures
);

export default router;
