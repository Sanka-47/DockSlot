import { Router } from 'express';
import {
  getWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  createDock,
  getDocks,
  updateDockStatus,
  getAvailableSlots,
} from '../controllers/warehouse.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();

// 1. Warehouse collection routes
router.get('/', authMiddleware, authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']), getWarehouses);
router.post('/', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), createWarehouse);

// 2. Direct dock status route (placed before /:warehouseId to avoid param collision)
router.patch(
  '/docks/:dockId/status',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  updateDockStatus
);

// 3. Single warehouse routes
router.get('/:warehouseId', authMiddleware, authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']), getWarehouseById);
router.put('/:warehouseId', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), updateWarehouse);

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
