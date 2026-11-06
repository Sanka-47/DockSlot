import { BookingStatus, Prisma } from '@prisma/client';
import { DbClient, db, transaction } from './base.repository';

export const warehouseRepository = {
  transaction,

  findOrganizationById(organizationId: number) {
    return db.organization.findUnique({
      where: { id: organizationId },
    });
  },

  createWarehouse(data: Prisma.WarehouseUncheckedCreateInput) {
    return db.warehouse.create({
      data,
      include: {
        docks: true,
        policy: true,
      },
    });
  },

  findManyForListing(where: Prisma.WarehouseWhereInput, now: Date) {
    return db.warehouse.findMany({
      where,
      include: {
        docks: {
          include: {
            closures: {
              where: {
                startTime: { lte: now },
                endTime: { gte: now },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
        operatingHours: true,
        policy: true,
      },
      orderBy: { id: 'asc' },
    });
  },

  findByIdWithDocksAndClosures(warehouseId: number, now: Date) {
    return db.warehouse.findUnique({
      where: { id: warehouseId },
      include: {
        docks: {
          include: {
            closures: {
              where: {
                startTime: { lte: now },
                endTime: { gte: now },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
        operatingHours: true,
        policy: true,
      },
    });
  },

  findByIdWithHoursAndDocks(warehouseId: number) {
    return db.warehouse.findUnique({
      where: { id: warehouseId },
      include: {
        operatingHours: true,
        docks: true,
      },
    });
  },

  countBookedAtWarehouse(warehouseId: number) {
    return db.booking.count({
      where: {
        dock: { warehouseId },
        status: BookingStatus.BOOKED,
      },
    });
  },

  updateWarehouseSettings(
    warehouseId: number,
    data: Prisma.WarehouseUpdateInput,
    client: DbClient = db
  ) {
    return client.warehouse.update({
      where: { id: warehouseId },
      data,
      include: {
        docks: true,
        operatingHours: true,
      },
    });
  },

  updateOperatingHoursSlotLength(warehouseId: number, slotLengthMinutes: number, client: DbClient = db) {
    return client.operatingHour.updateMany({
      where: { warehouseId },
      data: { slotLengthMinutes },
    });
  },

  findById(warehouseId: number) {
    return db.warehouse.findUnique({
      where: { id: warehouseId },
    });
  },

  updateWarehouseBasic(warehouseId: number, data: Prisma.WarehouseUpdateInput) {
    return db.warehouse.update({
      where: { id: warehouseId },
      data,
      include: {
        docks: true,
      },
    });
  },

  findHoursProjection(warehouseId: number) {
    return db.warehouse.findUnique({
      where: { id: warehouseId },
      select: {
        id: true,
        organizationId: true,
        timezone: true,
        slotLengthMinutes: true,
        operatingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
      },
    });
  },

  findByIdWithHours(warehouseId: number) {
    return db.warehouse.findUnique({
      where: { id: warehouseId },
      include: { operatingHours: true },
    });
  },

  findActiveBookingsForPruning(warehouseId: number, now: Date) {
    return db.booking.findMany({
      where: {
        dock: { warehouseId },
        status: { in: [BookingStatus.BOOKED, BookingStatus.ARRIVED] },
        slotEndTime: { gt: now },
      },
      select: {
        id: true,
        slotStartTime: true,
        slotEndTime: true,
      },
    });
  },

  deleteOperatingHour(operatingHourId: number, client: DbClient = db) {
    return client.operatingHour.delete({ where: { id: operatingHourId } });
  },

  updateOperatingHour(
    operatingHourId: number,
    data: Prisma.OperatingHourUpdateInput,
    client: DbClient = db
  ) {
    return client.operatingHour.update({
      where: { id: operatingHourId },
      data,
    });
  },

  createOperatingHour(data: Prisma.OperatingHourUncheckedCreateInput, client: DbClient = db) {
    return client.operatingHour.create({ data });
  },

  findSlotContext(warehouseId: number) {
    return db.warehouse.findUnique({
      where: { id: warehouseId },
      select: {
        id: true,
        name: true,
        timezone: true,
        organizationId: true,
      },
    });
  },

  findDocksForSlots(warehouseId: number, dockId: number | undefined, now: Date) {
    return db.dock.findMany({
      where: {
        warehouseId,
        ...(dockId !== undefined ? { id: dockId } : {}),
      },
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

  findOperatingHourForDay(warehouseId: number, dayOfWeek: number) {
    return db.operatingHour.findFirst({
      where: {
        warehouseId,
        OR: [
          { dayOfWeek },
          ...(dayOfWeek === 7 ? [{ dayOfWeek: 0 }] : []),
        ],
      },
    });
  },

  findBookingsForSlotGeneration(dockIds: number[], startOfDayUtc: Date, lookupEndUtc: Date) {
    return db.booking.findMany({
      where: {
        dockId: { in: dockIds },
        status: { in: [BookingStatus.BOOKED, BookingStatus.ARRIVED] },
        slotStartTime: {
          gte: startOfDayUtc,
          lt: lookupEndUtc,
        },
      },
      select: {
        id: true,
        dockId: true,
        slotStartTime: true,
        slotEndTime: true,
        status: true,
      },
    });
  },

  findClosuresForSlotGeneration(dockIds: number[], startOfDayUtc: Date, lookupEndUtc: Date) {
    return db.dockClosure.findMany({
      where: {
        dockId: { in: dockIds },
        startTime: { lt: lookupEndUtc },
        endTime: { gt: startOfDayUtc },
      },
      select: {
        id: true,
        dockId: true,
        startTime: true,
        endTime: true,
      },
    });
  },

  findByIdWithPolicy(warehouseId: number) {
    return db.warehouse.findUnique({
      where: { id: warehouseId },
      include: { policy: true },
    });
  },

  createPolicy(warehouseId: number) {
    return db.warehousePolicy.create({
      data: {
        warehouseId,
        maxConcurrentBookings: 3,
        maxAdvanceDays: 14,
        bookingLockWindowHours: 24,
      },
    });
  },

  upsertPolicy(
    warehouseId: number,
    data: {
      maxConcurrentBookings?: number;
      maxAdvanceDays?: number;
      bookingLockWindowHours?: number;
    }
  ) {
    return db.warehousePolicy.upsert({
      where: { warehouseId },
      create: {
        warehouseId,
        maxConcurrentBookings: data.maxConcurrentBookings ?? 3,
        maxAdvanceDays: data.maxAdvanceDays ?? 14,
        bookingLockWindowHours: data.bookingLockWindowHours ?? 24,
      },
      update: {
        ...(data.maxConcurrentBookings !== undefined && {
          maxConcurrentBookings: data.maxConcurrentBookings,
        }),
        ...(data.maxAdvanceDays !== undefined && {
          maxAdvanceDays: data.maxAdvanceDays,
        }),
        ...(data.bookingLockWindowHours !== undefined && {
          bookingLockWindowHours: data.bookingLockWindowHours,
        }),
      },
    });
  },

  findDockWithWarehouse(dockId: number) {
    return db.dock.findUnique({
      where: { id: dockId },
      include: { warehouse: true },
    });
  },

  createDock(data: Prisma.DockUncheckedCreateInput) {
    return db.dock.create({ data });
  },

  updateDockStatus(dockId: number, status: Prisma.DockUncheckedUpdateInput['status'], now: Date) {
    return db.dock.update({
      where: { id: dockId },
      data: { status },
      include: {
        closures: {
          where: {
            startTime: { lte: now },
            endTime: { gte: now },
          },
        },
      },
    });
  },

  updateDock(dockId: number, data: Prisma.DockUncheckedUpdateInput, now: Date) {
    return db.dock.update({
      where: { id: dockId },
      data,
      include: {
        warehouse: true,
        closures: {
          where: {
            startTime: { lte: now },
            endTime: { gte: now },
          },
        },
      },
    });
  },

  countBookedAtDock(dockId: number) {
    return db.booking.count({
      where: {
        dockId,
        status: BookingStatus.BOOKED,
      },
    });
  },

  findBookingOnDockDay(dockId: number, startOfDayUtc: Date, endOfDayUtc: Date) {
    return db.booking.findFirst({
      where: {
        dockId,
        status: { in: [BookingStatus.BOOKED, BookingStatus.ARRIVED] },
        slotStartTime: { lt: endOfDayUtc },
        slotEndTime: { gt: startOfDayUtc },
      },
    });
  },

  createDockClosure(data: Prisma.DockClosureUncheckedCreateInput) {
    return db.dockClosure.create({
      data,
      include: {
        dock: true,
      },
    });
  },

  findClosuresByDock(dockId: number) {
    return db.dockClosure.findMany({
      where: { dockId },
      orderBy: { startTime: 'asc' },
    });
  },
};
