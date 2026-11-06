import { BookingStatus, Prisma } from '@prisma/client';
import { DbClient, db, transaction } from './base.repository';

export const bookingRepository = {
  transaction,

  findDockWithWarehouseAndActiveClosures(dockId: number, now: Date) {
    return db.dock.findUnique({
      where: { id: dockId },
      include: {
        warehouse: {
          include: {
            operatingHours: true,
            policy: true,
          },
        },
        closures: {
          where: {
            startTime: { lte: now },
            endTime: { gte: now },
          },
        },
      },
    });
  },

  countActiveCarrierBookingsAtWarehouse(
    carrierOrgId: number,
    warehouseId: number,
    statuses: BookingStatus[]
  ) {
    return db.booking.count({
      where: {
        carrierOrgId,
        status: { in: statuses },
        dock: { warehouseId },
      },
    });
  },

  findOverlappingClosure(dockId: number, slotStart: Date, slotEnd: Date) {
    return db.dockClosure.findFirst({
      where: {
        dockId,
        startTime: { lt: slotEnd },
        endTime: { gt: slotStart },
      },
    });
  },

  findActiveBookingAtDockSlot(
    dockId: number,
    slotStart: Date,
    statuses: BookingStatus[],
    excludeBookingId?: number,
    client: DbClient = db
  ) {
    return client.booking.findFirst({
      where: {
        dockId,
        slotStartTime: slotStart,
        status: { in: statuses },
        ...(excludeBookingId !== undefined ? { id: { not: excludeBookingId } } : {}),
      },
    });
  },

  createBooking(data: Prisma.BookingUncheckedCreateInput, client: DbClient = db) {
    return client.booking.create({
      data,
      include: {
        dock: {
          include: {
            warehouse: true,
          },
        },
        carrierOrg: true,
      },
    });
  },

  /**
   * Booking plus its dock, warehouse policy and carrier, for reschedule and
   * cancel flows.
   */
  findManagedBookingById(bookingId: number) {
    return db.booking.findUnique({
      where: { id: bookingId },
      include: {
        dock: {
          include: {
            warehouse: {
              include: {
                operatingHours: true,
                policy: true,
              },
            },
          },
        },
        carrierOrg: true,
      },
    });
  },

  findActiveClosureAtDock(dockId: number, at: Date) {
    return db.dockClosure.findFirst({
      where: {
        dockId,
        startTime: { lte: at },
        endTime: { gte: at },
      },
    });
  },

  updateBookingReschedule(
    bookingId: number,
    data: {
      dockId: number;
      slotStartTime: Date;
      slotEndTime: Date;
      activeLock: string;
    },
    client: DbClient = db
  ) {
    return client.booking.update({
      where: { id: bookingId },
      data,
      include: {
        dock: {
          include: {
            warehouse: true,
          },
        },
        carrierOrg: true,
      },
    });
  },

  cancelBooking(bookingId: number, client: DbClient = db) {
    return client.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        activeLock: null,
      },
      include: {
        dock: {
          include: {
            warehouse: true,
          },
        },
        carrierOrg: true,
      },
    });
  },

  /**
   * Booking plus its dock, warehouse and carrier. Used by audit-log access,
   * status changes and detail updates.
   */
  findBookingWithDockWarehouseAndCarrier(bookingId: number) {
    return db.booking.findUnique({
      where: { id: bookingId },
      include: {
        dock: {
          include: {
            warehouse: true,
          },
        },
        carrierOrg: true,
      },
    });
  },

  findAuditLogs(bookingId: number) {
    return db.auditLog.findMany({
      where: { bookingId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            organizationId: true,
            organization: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  findBookingsByCarrierOrg(carrierOrgId: number) {
    return db.booking.findMany({
      where: { carrierOrgId },
      include: {
        dock: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: { slotStartTime: 'desc' },
    });
  },

  findBookingsByWarehouseOrg(organizationId: number) {
    return db.booking.findMany({
      where: {
        dock: {
          warehouse: {
            organizationId,
          },
        },
      },
      include: {
        dock: {
          include: {
            warehouse: true,
          },
        },
        carrierOrg: true,
      },
      orderBy: { slotStartTime: 'desc' },
    });
  },

  updateBookingStatus(bookingId: number, status: BookingStatus, client: DbClient = db) {
    return client.booking.update({
      where: { id: bookingId },
      data: { status },
      include: {
        dock: {
          include: {
            warehouse: true,
          },
        },
        carrierOrg: true,
      },
    });
  },

  updateBookingDetails(
    bookingId: number,
    data: Prisma.BookingUncheckedUpdateInput,
    client: DbClient = db
  ) {
    return client.booking.update({
      where: { id: bookingId },
      data,
      include: {
        dock: {
          include: {
            warehouse: true,
          },
        },
        carrierOrg: true,
      },
    });
  },
};
