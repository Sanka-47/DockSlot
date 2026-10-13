import { Request, Response } from 'express';
import { warehouseService } from '../services/warehouse.service';
import { isValidDateString } from '../utils/time.utils';

/**
 * Safely parses numeric route parameters.
 */
function parseParamId(val: string | string[] | undefined): number {
  if (!val) return NaN;
  const str = Array.isArray(val) ? val[0] : val;
  return parseInt(str, 10);
}

/**
 * Creates a new warehouse for the authenticated user's organization.
 * POST /api/warehouses
 */
export const createWarehouse = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const { name, address, timezone } = req.body;
    const warehouse = await warehouseService.createWarehouse(organizationId, {
      name,
      address,
      timezone,
    });

    res.status(201).json({
      success: true,
      message: 'Warehouse created successfully',
      data: warehouse,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while creating warehouse.',
    });
  }
};

/**
 * Retrieves all warehouses belonging to the authenticated user's organization.
 * GET /api/warehouses
 */
export const getWarehouses = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const warehouses = await warehouseService.getWarehouses(organizationId);
    res.status(200).json({
      success: true,
      data: warehouses,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while fetching warehouses.',
    });
  }
};

/**
 * Retrieves a single warehouse by ID for the authenticated user's organization.
 * GET /api/warehouses/:warehouseId or /api/warehouses/:id
 */
export const getWarehouseById = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const warehouseId = parseParamId(req.params.warehouseId || req.params.id);
    if (isNaN(warehouseId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid warehouse ID.',
      });
      return;
    }

    const warehouse = await warehouseService.getWarehouseById(warehouseId, organizationId);
    res.status(200).json({
      success: true,
      data: warehouse,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while fetching warehouse.',
    });
  }
};

/**
 * Updates a warehouse for the authenticated user's organization.
 * PUT /api/warehouses/:warehouseId or /api/warehouses/:id
 */
export const updateWarehouse = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const warehouseId = parseParamId(req.params.warehouseId || req.params.id);
    if (isNaN(warehouseId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid warehouse ID.',
      });
      return;
    }

    const updated = await warehouseService.updateWarehouse(warehouseId, organizationId, req.body);
    res.status(200).json({
      success: true,
      message: 'Warehouse updated successfully',
      data: updated,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while updating warehouse.',
    });
  }
};

/**
 * Updates warehouse settings (e.g., slotLengthMinutes).
 * PATCH /api/warehouses/:warehouseId
 * PATCH /api/warehouses/:warehouseId/settings
 */
export const updateWarehouseSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const warehouseId = parseParamId(req.params.warehouseId || req.params.id);
    if (isNaN(warehouseId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid warehouse ID.',
      });
      return;
    }

    const { slotLengthMinutes, name, address, timezone } = req.body;
    const updated = await warehouseService.updateWarehouseSettings(
      warehouseId,
      organizationId,
      {
        slotLengthMinutes,
        name,
        address,
        timezone,
      }
    );

    res.status(200).json({
      success: true,
      message: 'Warehouse settings updated successfully',
      data: updated,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while updating warehouse settings.',
    });
  }
};

/**
 * Creates a physical dock for a specific warehouse.
 * POST /api/warehouses/:warehouseId/docks
 */
export const createDock = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const warehouseId = parseParamId(req.params.warehouseId);
    if (isNaN(warehouseId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid warehouse ID.',
      });
      return;
    }

    const { name, status } = req.body;
    const dock = await warehouseService.createDock(warehouseId, organizationId, {
      name,
      status,
    });

    res.status(201).json({
      success: true,
      message: 'Dock created successfully',
      data: dock,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while creating dock.',
    });
  }
};

/**
 * Retrieves all docks for a specific warehouse.
 * GET /api/warehouses/:warehouseId/docks
 */
export const getDocks = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const warehouseId = parseParamId(req.params.warehouseId);
    if (isNaN(warehouseId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid warehouse ID.',
      });
      return;
    }

    const docks = await warehouseService.getDocks(warehouseId, organizationId);
    res.status(200).json({
      success: true,
      data: docks,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while fetching docks.',
    });
  }
};

/**
 * Updates dock status (ACTIVE / MAINTENANCE).
 * PATCH /api/warehouses/docks/:dockId/status
 * (also supports PATCH /api/warehouses/:warehouseId/docks/:dockId/status)
 */
export const updateDockStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const dockId = parseParamId(req.params.dockId);
    if (isNaN(dockId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid dock ID.',
      });
      return;
    }

    const { status } = req.body;
    const updatedDock = await warehouseService.updateDockStatus(dockId, organizationId, status);

    res.status(200).json({
      success: true,
      message: 'Dock status updated successfully',
      data: updatedDock,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while updating dock status.',
    });
  }
};

/**
 * Retrieves available time slots for a warehouse on a given date.
 * GET /api/warehouses/:warehouseId/slots?date=YYYY-MM-DD
 */
export const getAvailableSlots = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawId = req.params.warehouseId;
    const warehouseId = parseParamId(rawId);
    if (isNaN(warehouseId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid warehouse ID.',
      });
      return;
    }

    const dateQuery = (req.query.date || req.query.targetDate) as string;
    if (!dateQuery || typeof dateQuery !== 'string' || !dateQuery.trim()) {
      res.status(400).json({
        success: false,
        message: 'Missing required query parameter: date (expected format: YYYY-MM-DD).',
      });
      return;
    }

    const trimmedDate = dateQuery.trim();
    if (!isValidDateString(trimmedDate)) {
      res.status(400).json({
        success: false,
        message: 'Invalid date format. Expected a valid calendar date in YYYY-MM-DD format.',
      });
      return;
    }

    const slots = await warehouseService.getAvailableSlots(warehouseId, trimmedDate);
    res.status(200).json({
      success: true,
      data: slots,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while fetching available slots.',
    });
  }
};

/**
 * Creates a scheduled maintenance closure for a dock.
 * POST /api/docks/:dockId/closures
 */
export const createDockClosure = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const dockId = parseParamId(req.params.dockId);
    if (isNaN(dockId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid dock ID.',
      });
      return;
    }

    const { startTime, endTime, reason } = req.body;
    if (!startTime || !endTime) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: startTime and endTime are required.',
      });
      return;
    }

    const closure = await warehouseService.createDockClosure(dockId, organizationId, {
      startTime,
      endTime,
      reason,
    });

    res.status(201).json({
      success: true,
      message: 'Dock maintenance closure scheduled successfully',
      data: closure,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while scheduling dock maintenance closure.',
    });
  }
};

/**
 * Retrieves all scheduled maintenance closures for a dock.
 * GET /api/docks/:dockId/closures
 */
export const getDockClosures = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Organization context required.',
      });
      return;
    }

    const dockId = parseParamId(req.params.dockId);
    if (isNaN(dockId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid dock ID.',
      });
      return;
    }

    const closures = await warehouseService.getDockClosures(dockId, organizationId);

    res.status(200).json({
      success: true,
      data: closures,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Internal server error while fetching dock maintenance closures.',
    });
  }
};

