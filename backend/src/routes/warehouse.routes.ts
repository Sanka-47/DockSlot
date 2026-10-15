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
  updateDock,
  updateDockName,
  getAvailableSlots,
  createDockClosure,
  getDockClosures,
  getWarehousePolicy,
  updateWarehousePolicy,
} from '../controllers/warehouse.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();

/**
 * @openapi
 * /warehouses:
 *   get:
 *     summary: List all warehouses for the authenticated warehouse operator
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of warehouses
 *       403:
 *         description: Forbidden
 */
router.get(
  '/',
  authMiddleware,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER', 'CARRIER_ADMIN', 'DISPATCHER']),
  getWarehouses
);

/**
 * @openapi
 * /warehouses:
 *   post:
 *     summary: Create a new warehouse facility
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - address
 *               - timezone
 *             properties:
 *               name:
 *                 type: string
 *                 example: Colombo Central Logistics Hub
 *               address:
 *                 type: string
 *                 example: 100 Port Access Road, Colombo
 *               timezone:
 *                 type: string
 *                 example: Asia/Colombo
 *               slotLengthMinutes:
 *                 type: integer
 *                 enum: [30, 45, 60]
 *                 example: 30
 *     responses:
 *       201:
 *         description: Warehouse created successfully
 */
router.post('/', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), createWarehouse);

/**
 * @openapi
 * /warehouses/docks/{dockId}/status:
 *   patch:
 *     summary: Update dock status (ACTIVE or MAINTENANCE)
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dockId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, MAINTENANCE]
 *     responses:
 *       200:
 *         description: Dock status updated
 */
router.patch(
  '/docks/:dockId/status',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  updateDockStatus
);

/**
 * @openapi
 * /warehouses/docks/{dockId}/closures:
 *   post:
 *     summary: Schedule a maintenance closure window for a dock
 *     description: Blocks out a specific time range from slot generation for maintenance or repairs.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dockId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - startTime
 *               - endTime
 *               - reason
 *             properties:
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-11-15T04:45:00.000Z'
 *               endTime:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-11-15T05:45:00.000Z'
 *               reason:
 *                 type: string
 *                 example: Hydraulic lift sensor calibration
 *     responses:
 *       201:
 *         description: Maintenance closure scheduled
 *       400:
 *         description: Invalid time range or conflicts with confirmed bookings
 */
router.post(
  '/docks/:dockId/closures',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  createDockClosure
);

/**
 * @openapi
 * /warehouses/docks/{dockId}/closures:
 *   get:
 *     summary: List maintenance closures for a dock
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dockId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of scheduled dock closures
 */
router.get(
  '/docks/:dockId/closures',
  authMiddleware,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  getDockClosures
);

/**
 * @openapi
 * /warehouses/{warehouseId}:
 *   get:
 *     summary: Get warehouse details by ID
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Warehouse details
 *       404:
 *         description: Warehouse not found
 */
router.get(
  '/:warehouseId',
  authMiddleware,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER', 'CARRIER_ADMIN', 'DISPATCHER']),
  getWarehouseById
);

/**
 * @openapi
 * /warehouses/{warehouseId}:
 *   put:
 *     summary: Update warehouse general info
 *     description: |
 *       Updates warehouse name, address, or timezone.
 *       Cannot be updated when active bookings with status BOOKED exist.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Warehouse updated
 *       400:
 *         description: Cannot update warehouse core details when active BOOKED bookings exist
 */
router.put('/:warehouseId', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), updateWarehouse);

/**
 * @openapi
 * /warehouses/{warehouseId}/settings:
 *   patch:
 *     summary: Update warehouse default slot length
 *     description: |
 *       Restricted to WAREHOUSE_ADMIN. Supported increments: 30, 45, 60 minutes.
 *       Existing confirmed bookings remain completely unaffected.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - slotLengthMinutes
 *             properties:
 *               slotLengthMinutes:
 *                 type: integer
 *                 enum: [30, 45, 60]
 *                 example: 45
 *     responses:
 *       200:
 *         description: Warehouse slot length settings updated
 *       400:
 *         description: Invalid slot length (must be 30, 45, or 60)
 *       403:
 *         description: Forbidden. Tenant boundary violation
 */
router.patch('/:warehouseId', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), updateWarehouseSettings);
router.patch('/:warehouseId/settings', authMiddleware, requireVerifiedEmail, authorize(['WAREHOUSE_ADMIN']), updateWarehouseSettings);

/**
 * @openapi
 * /warehouses/{warehouseId}/policy:
 *   get:
 *     summary: Get warehouse booking and anti-hogging policy
 *     description: Restricted to WAREHOUSE_ADMIN of the owning organization.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Warehouse policy configuration
 *       403:
 *         description: Forbidden. Tenant boundary violation
 *       404:
 *         description: Warehouse not found
 */
router.get(
  '/:warehouseId/policy',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN']),
  getWarehousePolicy
);

/**
 * @openapi
 * /warehouses/{warehouseId}/policy:
 *   put:
 *     summary: Update warehouse booking and anti-hogging policy
 *     description: |
 *       Configures maximum concurrent active bookings per carrier, maximum advance reservation days,
 *       and hard-lock window hours before slot start. Restricted to WAREHOUSE_ADMIN.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               maxConcurrentBookings:
 *                 type: integer
 *                 example: 3
 *                 description: Max active uncompleted bookings a single carrier can hold simultaneously
 *               maxAdvanceDays:
 *                 type: integer
 *                 example: 14
 *                 description: Max advance days into the future carriers can reserve slots
 *               bookingLockWindowHours:
 *                 type: integer
 *                 example: 24
 *                 description: Hard-lock window hours before slot start preventing standard cancellations
 *     responses:
 *       200:
 *         description: Warehouse policy updated successfully
 *       400:
 *         description: Invalid policy configuration parameters
 *       403:
 *         description: Forbidden. Tenant boundary violation
 *       404:
 *         description: Warehouse not found
 */
router.put(
  '/:warehouseId/policy',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN']),
  updateWarehousePolicy
);

/**
 * @openapi
 * /warehouses/{warehouseId}/docks:
 *   post:
 *     summary: Add a new dock to a warehouse
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: Dock A1 (Refrigerated)
 *     responses:
 *       201:
 *         description: Dock created
 */
router.post(
  '/:warehouseId/docks',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  createDock
);

/**
 * @openapi
 * /warehouses/{warehouseId}/docks:
 *   get:
 *     summary: List all docks for a warehouse
 *     description: Retrieves docks for a warehouse with real-time dynamic effectiveStatus evaluation based on active dock maintenance closures and base database status.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of docks with dynamic effectiveStatus
 */
router.get(
  '/:warehouseId/docks',
  authMiddleware,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER', 'CARRIER_ADMIN', 'DISPATCHER']),
  getDocks
);

router.patch(
  '/:warehouseId/docks/:dockId/status',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER']),
  updateDockStatus
);

/**
 * @openapi
 * /warehouses/{warehouseId}/docks/{dockId}:
 *   patch:
 *     summary: Update dock name or details
 *     description: |
 *       Restricted to WAREHOUSE_ADMIN.
 *       To avoid driver confusion, the dock name can only be updated if there are no active bookings with status 'BOOKED'.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: false
 *         schema:
 *           type: integer
 *       - in: path
 *         name: dockId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Dock A1 (Refrigerated Express)
 *     responses:
 *       200:
 *         description: Dock updated successfully
 *       400:
 *         description: Cannot update dock name while active BOOKED bookings exist, or invalid name
 *       403:
 *         description: Forbidden. Tenant boundary violation or insufficient role
 *       404:
 *         description: Dock not found
 */
router.patch(
  '/:warehouseId/docks/:dockId',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN']),
  updateDock
);

router.put(
  '/:warehouseId/docks/:dockId',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN']),
  updateDock
);

router.patch(
  '/docks/:dockId',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN']),
  updateDock
);

router.put(
  '/docks/:dockId',
  authMiddleware,
  requireVerifiedEmail,
  authorize(['WAREHOUSE_ADMIN']),
  updateDock
);

/**
 * @openapi
 * /warehouses/{warehouseId}/slots:
 *   get:
 *     summary: Slot Availability Search Engine
 *     description: |
 *       Computes and returns available time slots for active docks on a target date.
 *       Correctly evaluates IANA timezone conversions, 24/7 schedules, confirmed bookings, and dock maintenance closures.
 *     tags:
 *       - Warehouses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Warehouse ID
 *       - in: query
 *         name: targetDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Target date in YYYY-MM-DD format
 *         example: '2026-11-15'
 *       - in: query
 *         name: dockId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Filter slots by a specific dock ID
 *     responses:
 *       200:
 *         description: List of available time slots
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       dockId:
 *                         type: integer
 *                       dockName:
 *                         type: string
 *                       slotStartTime:
 *                         type: string
 *                         format: date-time
 *                       slotEndTime:
 *                         type: string
 *                         format: date-time
 *                       isAvailable:
 *                         type: boolean
 *       400:
 *         description: Missing or invalid targetDate
 *       404:
 *         description: Warehouse not found
 */
router.get(
  '/:warehouseId/slots',
  authMiddleware,
  authorize(['WAREHOUSE_ADMIN', 'DOCK_MANAGER', 'CARRIER_ADMIN', 'DISPATCHER']),
  getAvailableSlots
);

export default router;
