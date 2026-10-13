import { Router } from 'express';
import {
  getWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  updateWarehouseSettings,
  createDock,
  getDocks,
  updateDockStatus,
  getAvailableSlots,
  createDockClosure,
  getDockClosures,
} from '../controllers/warehouse.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();

// 1. Warehouse collection routes
router.get('/', authMiddleware, authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']), getWarehouses);
router.post('/', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), createWarehouse);

// 2. Direct dock routes (placed before /:warehouseId to avoid param collision)
router.patch(
  '/docks/:dockId/status',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  updateDockStatus
);
router.post(
  '/docks/:dockId/closures',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  createDockClosure
);
router.get(
  '/docks/:dockId/closures',
  authMiddleware,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  getDockClosures
);

// 3. Single warehouse routes
router.get('/:warehouseId', authMiddleware, authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']), getWarehouseById);
router.put('/:warehouseId', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), updateWarehouse);
router.patch('/:warehouseId', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), updateWarehouseSettings);
router.patch('/:warehouseId/settings', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), updateWarehouseSettings);

// 4. Warehouse dock routes
router.post(
  '/:warehouseId/docks',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  createDock
);
router.get('/:warehouseId/docks', authMiddleware, authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']), getDocks);
router.patch(
  '/:warehouseId/docks/:dockId/status',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  updateDockStatus
);

// 5. Slot Search API (Carrier Dispatchers & Warehouse Operators)
router.get(
  '/:warehouseId/slots',
  authMiddleware,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER', 'CARRIER_ADMIN', 'DISPATCHER']),
  getAvailableSlots
);

export default router;
