import { Request, Response } from 'express';

export const getBookings = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, data: [] });
};

export const createBooking = async (_req: Request, res: Response): Promise<void> => {
  res.status(201).json({ success: true, message: 'Booking created successfully' });
};
