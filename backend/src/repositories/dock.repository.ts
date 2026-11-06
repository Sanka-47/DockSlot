import { db } from './base.repository';

export const dockRepository = {
  findWarehouseById(warehouseId: number) {
    return db.warehouse.findUnique({
      where: { id: warehouseId },
    });
  },

  findManyByWarehouseWithActiveClosures(warehouseId: number, now: Date) {
    return db.dock.findMany({
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
  },

  findByIdWithWarehouseAndActiveClosures(dockId: number, atTime: Date) {
    return db.dock.findUnique({
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
  },
};
