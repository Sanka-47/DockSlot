import { Request, Response } from 'express';
import { bookingService } from '../services/booking.service';
import { sendError } from '../utils/httpError';

/**
 * Creates a new booking for a carrier dispatcher.
 * POST /api/bookings
 */
export const createBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const { dockId, slotStartTime, slotEndTime, truckPlate, driverName, driverPhone, cargoNote } = req.body;

    if (
      dockId === undefined ||
      dockId === null ||
      !slotStartTime ||
      !slotEndTime ||
      !truckPlate ||
      !driverName ||
      !driverPhone
    ) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: dockId, slotStartTime, slotEndTime, truckPlate, driverName, and driverPhone are required.',
      });
      return;
    }

    const parsedDockId = typeof dockId === 'string' ? parseInt(dockId, 10) : dockId;
    if (isNaN(parsedDockId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid dockId parameter.',
      });
      return;
    }

    const booking = await bookingService.createBooking(
      organizationId,
      {
        dockId: parsedDockId,
        slotStartTime,
        slotEndTime,
        truckPlate,
        driverName,
        driverPhone,
        cargoNote,
      },
      req.user?.userId
    );

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: booking,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while creating booking.');
  }
};

/**
 * Reschedules a booking to a new time slot or dock.
 * PATCH /api/bookings/:id/reschedule
 */
export const rescheduleBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.userId;
    if (!organizationId || !userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication context required.',
      });
      return;
    }

    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const bookingId = parseInt(rawId, 10);
    if (isNaN(bookingId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid booking ID.',
      });
      return;
    }

    const { dockId, slotStartTime, slotEndTime, reason } = req.body;
    if (!slotStartTime || !slotEndTime) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: slotStartTime and slotEndTime are required.',
      });
      return;
    }

    const parsedDockId =
      dockId !== undefined && dockId !== null
        ? typeof dockId === 'string'
          ? parseInt(dockId, 10)
          : dockId
        : undefined;

    if (parsedDockId !== undefined && isNaN(parsedDockId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid dockId parameter.',
      });
      return;
    }

    const updatedBooking = await bookingService.rescheduleBooking(
      bookingId,
      organizationId,
      userId,
      {
        dockId: parsedDockId,
        slotStartTime,
        slotEndTime,
        reason,
      }
    );

    res.status(200).json({
      success: true,
      message: 'Booking rescheduled successfully',
      data: updatedBooking,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while rescheduling booking.');
  }
};

/**
 * Cancels an active booking, releasing its slot and generating an audit log.
 * PATCH /api/bookings/:id/cancel
 * DELETE /api/bookings/:id
 */
export const cancelBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.userId;
    if (!organizationId || !userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication context required.',
      });
      return;
    }

    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const bookingId = parseInt(rawId, 10);
    if (isNaN(bookingId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid booking ID.',
      });
      return;
    }

    const { reason } = req.body || {};

    const cancelledBooking = await bookingService.cancelBooking(
      bookingId,
      organizationId,
      userId,
      reason
    );

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: cancelledBooking,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while cancelling booking.');
  }
};

/**
 * Updates general booking details (truck plate, driver info, cargo note).
 * PATCH /api/bookings/:id
 */
export const updateBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.userId;
    if (!organizationId || !userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication context required.',
      });
      return;
    }

    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const bookingId = parseInt(rawId, 10);
    if (isNaN(bookingId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid booking ID.',
      });
      return;
    }

    const { truckPlate, driverName, driverPhone, cargoNote } = req.body;

    const updatedBooking = await bookingService.updateBooking(
      bookingId,
      organizationId,
      userId,
      { truckPlate, driverName, driverPhone, cargoNote }
    );

    res.status(200).json({
      success: true,
      message: 'Booking updated successfully',
      data: updatedBooking,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while updating booking.');
  }
};

/**
 * Retrieves audit logs for a booking with dual-sided tenant visibility.
 * GET /api/bookings/:id/audit-log
 * GET /api/bookings/:id/audit-logs
 */
export const getBookingAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const bookingId = parseInt(rawId, 10);
    if (isNaN(bookingId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid booking ID.',
      });
      return;
    }

    const auditLogs = await bookingService.getBookingAuditLogs(bookingId, organizationId);

    res.status(200).json({
      success: true,
      data: auditLogs,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while retrieving audit logs.');
  }
};

/**
 * Retrieves bookings for the authenticated user's organization.
 * GET /api/bookings
 */
export const getBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const bookings = await bookingService.getBookings(organizationId, req.user!.role);
    res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while fetching bookings.');
  }
};

/**
 * Updates booking operational status (ARRIVED, NO_SHOW, COMPLETED).
 * Status can only be changed after the booking's scheduled slot start time has passed.
 * PATCH /api/bookings/:id/status
 */
export const updateBookingStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.userId;
    if (!organizationId || !userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication context required.',
      });
      return;
    }

    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const bookingId = parseInt(rawId, 10);
    if (isNaN(bookingId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid booking ID.',
      });
      return;
    }

    const { status } = req.body;
    if (!status) {
      res.status(400).json({
        success: false,
        message: 'Status is required.',
      });
      return;
    }

    const updatedBooking = await bookingService.updateBookingStatus(
      bookingId,
      organizationId,
      userId,
      status
    );

    res.status(200).json({
      success: true,
      message: 'Booking status updated successfully',
      data: updatedBooking,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while updating booking status.');
  }
};
