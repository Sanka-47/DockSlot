import { prisma } from '../config/db.config';
import { DockStatus } from '@prisma/client';
import { DockWithEffectiveStatus } from '../models/dock.model';

export class DockService {
  /**
   * Retrieves all docks for a warehouse, fetching active closures in a single query
   * using Prisma's `include` filter to avoid N+1 query bottlenecks, and dynamically
   * evaluating the real-time `effectiveStatus`.
   */
  async getDocksByWarehouse(
    warehouseId: number,
    organizationId?: number,
    isCarrier: boolean = false
  ): Promise<DockWithEffectiveStatus[]> {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    if (organizationId) {
      const warehouse = await prisma.warehouse.findUnique({
        where: { id: warehouseId },
      });

      if (!warehouse) {
        throw { status: 404, message: 'Warehouse not found.' };
      }

      if (!isCarrier && warehouse.organizationId !== organizationId) {
        throw {
          status: 403,
          message: 'Forbidden. You do not have access to docks for this warehouse.',
        };
      }
    }

    const now = new Date();
    const docks = await prisma.dock.findMany({
      where: { warehouseId },
      include: {
        closures: {
          where: {
            startTime: { lte: now },
            endTime: { gte: now },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return docks.map((dock) => {
      const isUnderClosure = dock.closures && dock.closures.length > 0;
      const effectiveStatus = isUnderClosure
        ? 'MAINTENANCE'
        : (dock.status as 'ACTIVE' | 'MAINTENANCE');

      return {
        ...dock,
        effectiveStatus,
      };
    });
  }

  /**
   * Retrieves the real-time dynamic effective status of a specific dock,
   * evaluating active closures at the specified timestamp (defaults to now).
   */
  async getDockEffectiveStatus(
    dockId: number,
    atTime: Date = new Date()
  ): Promise<{
    dock: any;
    effectiveStatus: 'ACTIVE' | 'MAINTENANCE';
    activeClosure?: any;
  }> {
    if (!dockId || isNaN(dockId)) {
      throw { status: 400, message: 'Invalid dock ID.' };
    }

    const dock = await prisma.dock.findUnique({
      where: { id: dockId },
      include: {
        warehouse: true,
        closures: {
          where: {
            startTime: { lte: atTime },
            endTime: { gte: atTime },
          },
        },
      },
    });

    if (!dock) {
      throw { status: 404, message: 'Dock not found.' };
    }

    const activeClosure = dock.closures && dock.closures.length > 0 ? dock.closures[0] : undefined;
    const isUnderMaintenance = !!activeClosure || dock.status === DockStatus.MAINTENANCE;

    return {
      dock,
      effectiveStatus: isUnderMaintenance ? 'MAINTENANCE' : 'ACTIVE',
      activeClosure,
    };
  }
}

export const dockService = new DockService();
export default dockService;
