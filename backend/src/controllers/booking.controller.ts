import { Request, Response } from 'express';
import { bookingService } from '../services/booking.service';

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

    const booking = await bookingService.createBooking(organizationId, {
      dockId: parsedDockId,
      slotStartTime,
      slotEndTime,
      truckPlate,
      driverName,
      driverPhone,
      cargoNote,
    });

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: booking,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred while creating booking.',
    });
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
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred while fetching bookings.',
    });
  }
};
