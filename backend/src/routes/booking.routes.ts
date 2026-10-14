import { Router } from 'express';
import {
  getBookings,
  createBooking,
  rescheduleBooking,
  cancelBooking,
  getBookingAuditLogs,
  updateBookingStatus,
} from '../controllers/booking.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireVerifiedEmail } from '../middleware/verification.middleware';
import {
  requireCarrierDispatcher,
  requireCarrierRole,
  requireDockManager,
} from '../middleware/rbac.middleware';
import { idempotencyMiddleware } from '../middleware/idempotency.middleware';

const router = Router();

/**
 * @openapi
 * /bookings:
 *   get:
 *     summary: List bookings for the authenticated user's organization
 *     description: Returns bookings filtered by carrier organization or warehouse operator organization.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of bookings
 *       401:
 *         description: Authentication required
 */
router.get('/', authMiddleware, getBookings);

/**
 * @openapi
 * /bookings:
 *   post:
 *     summary: Create a confirmed dock booking
 *     description: |
 *       Atomically reserves a dock time slot and schedules an asynchronous outbox event.
 *       Protected against concurrent double-booking and mobile network retries via Idempotency-Key.
 *       Restricted to users with DISPATCHER role in a CARRIER organization.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *         description: Unique key to ensure idempotent booking requests across retries
 *         example: 7f8a1b2c-3d4e-5f6a-7b8c-9d0e1f2a3b4c
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dockId
 *               - slotStartTime
 *               - slotEndTime
 *               - truckPlate
 *               - driverName
 *               - driverPhone
 *             properties:
 *               dockId:
 *                 type: integer
 *                 example: 1
 *               slotStartTime:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-11-15T04:00:00.000Z'
 *               slotEndTime:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-11-15T04:30:00.000Z'
 *               truckPlate:
 *                 type: string
 *                 example: WP-CA-4029
 *               driverName:
 *                 type: string
 *                 example: Nuwan Perera
 *               driverPhone:
 *                 type: string
 *                 example: '+94771234567'
 *               cargoNote:
 *                 type: string
 *                 example: 20ft Container electronics
 *     responses:
 *       201:
 *         description: Booking confirmed and outbox event created
 *       400:
 *         description: Slot out of operating hours, past date, or invalid payload
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Only carrier dispatchers with verified emails can create bookings
 *       409:
 *         description: Slot already booked or maintenance closure active (Concurrency conflict)
 */
router.post(
  '/',
  authMiddleware,
  requireVerifiedEmail,
  requireCarrierDispatcher,
  idempotencyMiddleware,
  createBooking
);

/**
 * @openapi
 * /bookings/{id}/reschedule:
 *   patch:
 *     summary: Reschedule a confirmed booking
 *     description: |
 *       Moves an existing confirmed booking to a new time slot (and optionally a new dock).
 *       Releases the old slot atomically and logs an audit log entry.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Booking ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - slotStartTime
 *               - slotEndTime
 *             properties:
 *               slotStartTime:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-11-15T05:00:00.000Z'
 *               slotEndTime:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-11-15T05:30:00.000Z'
 *               newDockId:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       200:
 *         description: Booking successfully rescheduled
 *       400:
 *         description: Invalid slot times or booking cannot be rescheduled
 *       403:
 *         description: Forbidden. Tenant boundary violation
 *       404:
 *         description: Booking not found
 *       409:
 *         description: Target slot already occupied
 */
router.patch(
  '/:id/reschedule',
  authMiddleware,
  requireVerifiedEmail,
  requireCarrierRole,
  rescheduleBooking
);

/**
 * @openapi
 * /bookings/{id}/cancel:
 *   patch:
 *     summary: Cancel a confirmed booking
 *     description: Cancels the booking, releases the time slot for other carriers, and creates an audit log.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Booking ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: Truck mechanical breakdown
 *     responses:
 *       200:
 *         description: Booking cancelled and slot released
 *       400:
 *         description: Booking already cancelled or completed
 *       403:
 *         description: Forbidden. Not the owning carrier
 *       404:
 *         description: Booking not found
 */
router.patch(
  '/:id/cancel',
  authMiddleware,
  requireVerifiedEmail,
  requireCarrierRole,
  cancelBooking
);

// /**
//  * @openapi
//  * /bookings/{id}:
//  *   delete:
//  *     summary: Cancel a confirmed booking (DELETE method alias)
//  *     tags:
//  *       - Bookings
//  *     security:
//  *       - bearerAuth: []
//  *     parameters:
//  *       - in: path
//  *         name: id
//  *         required: true
//  *         schema:
//  *           type: integer
//  *     responses:
//  *       200:
//  *         description: Booking cancelled successfully
//  */
// router.delete(
//   '/:id',
//   authMiddleware,
//   requireVerifiedEmail,
//   requireCarrierRole,
//   cancelBooking
// );

/**
 * @openapi
 * /bookings/{id}/audit-logs:
 *   get:
 *     summary: View lifecycle audit logs for a booking
 *     description: Dual-sided audit trail visible to both the carrier and the operating warehouse.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Array of lifecycle audit log entries (CREATED, RESCHEDULED, CANCELLED, etc.)
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Booking not found
 */
router.get('/:id/audit-logs', authMiddleware, getBookingAuditLogs);

/**
 * @openapi
 * /bookings/{id}/status:
 *   patch:
 *     summary: Update operational status of a booking (Yard check-in / check-out)
 *     description: Restricted strictly to DOCK_MANAGER in the warehouse operator organization. Status can only be changed after the scheduled slot start time has passed.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *                 enum: [ARRIVED, NO_SHOW, COMPLETED]
 *                 example: ARRIVED
 *     responses:
 *       200:
 *         description: Booking status updated successfully
 *       400:
 *         description: Invalid status transition
 *       403:
 *         description: Forbidden. Only Dock Managers can update operational status
 *       404:
 *         description: Booking not found
 */
router.patch(
  '/:id/status',
  authMiddleware,
  requireVerifiedEmail,
  requireDockManager,
  updateBookingStatus
);

export default router;
