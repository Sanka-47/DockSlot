import { Request, Response } from 'express';

export const getWarehouses = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, data: [] });
};

export const getWarehouseById = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, data: null });
};

export const createWarehouse = async (_req: Request, res: Response): Promise<void> => {
  res.status(201).json({ success: true, message: 'Warehouse created successfully' });
};

export const updateWarehouse = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, message: 'Warehouse updated successfully' });
};
