import { Router } from 'express';
import {
  getWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
} from '../controllers/warehouse.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';

const router = Router();

// Read operations can be accessed by authenticated users
router.get('/', authenticate, getWarehouses);
router.get('/:id', authenticate, getWarehouseById);

// Sensitive warehouse management actions require verified email
router.post('/', authenticate, requireVerifiedEmail, createWarehouse);
router.put('/:id', authenticate, requireVerifiedEmail, updateWarehouse);

export default router;
