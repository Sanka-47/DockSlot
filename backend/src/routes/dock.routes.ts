import { Router } from 'express';
import { createDockClosure, getDockClosures, updateDock } from '../controllers/warehouse.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { requireWarehouseStaff, authorize } from '../middleware/rbac.middleware';

const router = Router();

// Update dock name / details (strictly WAREHOUSE_ADMIN)
router.patch(
  '/:dockId',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN']),
  updateDock
);

router.put(
  '/:dockId',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN']),
  updateDock
);

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
