import { BookingStatus, DockStatus, OutboxStatus, OrganizationType } from '@prisma/client';
import { prisma } from '../config/db.config';
import {
  formatInTimeZone,
  getDayOfWeekInTimeZone,
  timeStringToMinutes,
} from '../utils/time.utils';

export interface CreateBookingInput {
  dockId: number;
  slotStartTime: string;
  slotEndTime: string;
  truckPlate: string;
  driverName: string;
  driverPhone: string;
  cargoNote?: string;
}

export interface RescheduleBookingInput {
  dockId?: number;
  slotStartTime: string;
  slotEndTime: string;
  reason?: string;
}

export class BookingService {
  /**
   * Helper to validate that a time slot falls within warehouse operating hours.
   */
  private validateSlotOperatingHours(warehouse: any, slotStart: Date, slotEnd: Date) {
    if (isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) {
      throw { status: 400, message: 'Invalid slotStartTime or slotEndTime format.' };
    }

    if (slotEnd <= slotStart) {
      throw { status: 400, message: 'slotEndTime must be greater than slotStartTime.' };
    }

    if (slotStart.getTime() < Date.now()) {
      throw { status: 400, message: 'Cannot book or reschedule a slot in the past.' };
    }

    const warehouseTz = warehouse.timezone;
    const dateStr = formatInTimeZone(slotStart, warehouseTz, 'yyyy-MM-dd');
    const startLocal = formatInTimeZone(slotStart, warehouseTz, 'HH:mm');
    const endLocal = formatInTimeZone(slotEnd, warehouseTz, 'HH:mm');
    const dayOfWeek = getDayOfWeekInTimeZone(dateStr, warehouseTz);

    const opHour = warehouse.operatingHours.find(
      (oh: any) => oh.dayOfWeek === dayOfWeek || (dayOfWeek === 7 && oh.dayOfWeek === 0)
    );

    if (!opHour) {
      throw { status: 400, message: 'Warehouse is closed on the requested date.' };
    }

    const startMin = timeStringToMinutes(startLocal);
    let endMin = timeStringToMinutes(endLocal);
    if (endLocal === '00:00' && endMin === 0) {
      endMin = 1440;
    }

    const openMin = timeStringToMinutes(opHour.openTime);
    let closeMin = timeStringToMinutes(opHour.closeTime);
    if ((opHour.closeTime === '24:00' || opHour.closeTime === '00:00') && openMin === 0) {
      closeMin = 1440;
    }

    if (startMin < openMin || endMin > closeMin) {
      throw { status: 400, message: 'Requested slot falls outside warehouse operating hours.' };
    }

    const durationMinutes = (slotEnd.getTime() - slotStart.getTime()) / (60 * 1000);
    if (durationMinutes !== opHour.slotLengthMinutes) {
      throw {
        status: 400,
        message: `Slot duration must match warehouse slot length of ${opHour.slotLengthMinutes} minutes.`,
      };
    }
  }

  /**
   * Creates a booking with atomic outbox event insertion, audit logging, and double-booking concurrency protection.
   */
  async createBooking(dispatcherOrgId: number, data: CreateBookingInput, userId?: number) {
    if (!dispatcherOrgId) {
      throw { status: 400, message: 'Dispatcher organization ID is required.' };
    }

    if (!data.dockId || isNaN(data.dockId)) {
      throw { status: 400, message: 'Valid dockId is required.' };
    }

    if (!data.slotStartTime || !data.slotEndTime) {
      throw { status: 400, message: 'slotStartTime and slotEndTime are required.' };
    }

    if (!data.truckPlate || !data.truckPlate.trim()) {
      throw { status: 400, message: 'truckPlate is required.' };
    }

    if (!data.driverName || !data.driverName.trim()) {
      throw { status: 400, message: 'driverName is required.' };
    }

    if (!data.driverPhone || !data.driverPhone.trim()) {
      throw { status: 400, message: 'driverPhone is required.' };
    }

    // a. Validate that the target dock exists and is ACTIVE
    const dock = await prisma.dock.findUnique({
      where: { id: data.dockId },
      include: {
        warehouse: {
          include: {
            operatingHours: true,
          },
        },
      },
    });

    if (!dock) {
      throw { status: 404, message: 'Dock not found.' };
    }

    if (dock.status !== DockStatus.ACTIVE) {
      throw { status: 400, message: 'Dock is currently under maintenance and cannot be booked.' };
    }

    if (!dock.warehouse) {
      throw { status: 404, message: 'Warehouse not found for this dock.' };
    }

    // b. Verify that requested slot falls within warehouse operating hours and has not passed
    const slotStart = new Date(data.slotStartTime);
    const slotEnd = new Date(data.slotEndTime);
    this.validateSlotOperatingHours(dock.warehouse, slotStart, slotEnd);

    // c. Execute the booking inside a Prisma transaction guaranteeing atomicity
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Pre-check active booking for concurrency
        const existing = await tx.booking.findFirst({
          where: {
            dockId: data.dockId,
            slotStartTime: slotStart,
            status: { in: [BookingStatus.BOOKED, BookingStatus.ARRIVED] },
          },
        });

        if (existing) {
          throw { status: 409, message: 'Conflict. The requested dock slot is already booked.' };
        }

        // Insert new Booking record
        const booking = await tx.booking.create({
          data: {
            dockId: data.dockId,
            carrierOrgId: dispatcherOrgId,
            slotStartTime: slotStart,
            slotEndTime: slotEnd,
            truckPlate: data.truckPlate.trim(),
            driverName: data.driverName.trim(),
            driverPhone: data.driverPhone.trim(),
            cargoNote: data.cargoNote ? data.cargoNote.trim() : null,
            status: BookingStatus.BOOKED,
            activeLock: 'ACTIVE',
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

        // If userId is provided, create initial AuditLog
        if (userId) {
          await tx.auditLog.create({
            data: {
              bookingId: booking.id,
              userId,
              action: 'CREATED',
              details: {
                dockId: booking.dockId,
                slotStartTime: booking.slotStartTime.toISOString(),
                slotEndTime: booking.slotEndTime.toISOString(),
                truckPlate: booking.truckPlate,
                driverName: booking.driverName,
              },
            },
          });
        }

        // Simultaneously create an OutboxEvent record in the same transaction
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'BOOKING',
            aggregateId: String(booking.id),
            payload: {
              bookingId: booking.id,
              dockId: booking.dockId,
              dockName: booking.dock.name,
              warehouseId: booking.dock.warehouse.id,
              warehouseName: booking.dock.warehouse.name,
              carrierOrgId: dispatcherOrgId,
              carrierName: booking.carrierOrg.name,
              slotStartTime: booking.slotStartTime.toISOString(),
              slotEndTime: booking.slotEndTime.toISOString(),
              truckPlate: booking.truckPlate,
              driverName: booking.driverName,
              driverPhone: booking.driverPhone,
              cargoNote: booking.cargoNote,
              status: booking.status,
              createdAt: booking.createdAt.toISOString(),
            },
            status: OutboxStatus.PENDING,
          },
        });

        return booking;
      });

      return result;
    } catch (error: any) {
      // d. Catch Prisma unique constraint violation (P2002 on @@unique([dockId, slotStartTime, activeLock]))
      if (error.code === 'P2002' || error.status === 409) {
        throw {
          status: 409,
          message: 'Conflict. The requested dock slot is already booked.',
        };
      }
      throw error;
    }
  }

  /**
   * Reschedules an existing booking to a new time slot or dock.
   * Validates tenant ownership, checks new slot availability within operating hours,
   * releases the old slot, locks the new slot, and logs an audit record.
   */
  async rescheduleBooking(
    bookingId: number,
    carrierOrgId: number,
    userId: number,
    data: RescheduleBookingInput
  ) {
    if (!bookingId || isNaN(bookingId)) {
      throw { status: 400, message: 'Invalid booking ID.' };
    }

    if (!data.slotStartTime || !data.slotEndTime) {
      throw { status: 400, message: 'slotStartTime and slotEndTime are required.' };
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        dock: {
          include: {
            warehouse: {
              include: {
                operatingHours: true,
              },
            },
          },
        },
        carrierOrg: true,
      },
    });

    if (!booking) {
      throw { status: 404, message: 'Booking not found.' };
    }

    if (booking.carrierOrgId !== carrierOrgId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to manage this booking.' };
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw { status: 400, message: 'Cannot reschedule a cancelled booking.' };
    }

    if (booking.status === BookingStatus.ARRIVED) {
      throw { status: 400, message: 'Cannot reschedule a booking that has already arrived.' };
    }

    const targetDockId = data.dockId !== undefined ? data.dockId : booking.dockId;
    let targetDock = booking.dock;

    if (targetDockId !== booking.dockId) {
      const foundDock = await prisma.dock.findUnique({
        where: { id: targetDockId },
        include: {
          warehouse: {
            include: {
              operatingHours: true,
            },
          },
        },
      });

      if (!foundDock) {
        throw { status: 404, message: 'Target dock not found.' };
      }

      if (foundDock.status !== DockStatus.ACTIVE) {
        throw { status: 400, message: 'Target dock is currently under maintenance and cannot be booked.' };
      }

      targetDock = foundDock;
    } else {
      if (booking.dock.status !== DockStatus.ACTIVE) {
        throw { status: 400, message: 'Dock is currently under maintenance and cannot be booked.' };
      }
    }

    const slotStart = new Date(data.slotStartTime);
    const slotEnd = new Date(data.slotEndTime);
    this.validateSlotOperatingHours(targetDock.warehouse, slotStart, slotEnd);

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Pre-check if target dock slot is already booked by another active booking
        const existing = await tx.booking.findFirst({
          where: {
            dockId: targetDockId,
            slotStartTime: slotStart,
            status: { in: [BookingStatus.BOOKED, BookingStatus.ARRIVED] },
            id: { not: bookingId },
          },
        });

        if (existing) {
          throw { status: 409, message: 'Conflict. The requested dock slot is already booked.' };
        }

        // Update the booking record to the new dock and time slot
        const updatedBooking = await tx.booking.update({
          where: { id: bookingId },
          data: {
            dockId: targetDockId,
            slotStartTime: slotStart,
            slotEndTime: slotEnd,
            activeLock: 'ACTIVE',
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

        // Insert AuditLog with action RESCHEDULED
        await tx.auditLog.create({
          data: {
            bookingId,
            userId,
            action: 'RESCHEDULED',
            details: {
              oldDockId: booking.dockId,
              oldSlotStartTime: booking.slotStartTime.toISOString(),
              oldSlotEndTime: booking.slotEndTime.toISOString(),
              newDockId: targetDockId,
              newSlotStartTime: slotStart.toISOString(),
              newSlotEndTime: slotEnd.toISOString(),
              reason: data.reason ? data.reason.trim() : null,
            },
          },
        });

        // Create OutboxEvent record for async notifications
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'BOOKING',
            aggregateId: String(booking.id),
            payload: {
              action: 'RESCHEDULED',
              bookingId: booking.id,
              carrierOrgId,
              oldDockId: booking.dockId,
              newDockId: targetDockId,
              oldSlotStartTime: booking.slotStartTime.toISOString(),
              newSlotStartTime: slotStart.toISOString(),
              newSlotEndTime: slotEnd.toISOString(),
              reason: data.reason ? data.reason.trim() : null,
              rescheduledAt: new Date().toISOString(),
            },
            status: OutboxStatus.PENDING,
          },
        });

        return updatedBooking;
      });

      return result;
    } catch (error: any) {
      if (error.code === 'P2002' || error.status === 409) {
        throw {
          status: 409,
          message: 'Conflict. The requested dock slot is already booked.',
        };
      }
      throw error;
    }
  }

  /**
   * Cancels a booking, releasing the time slot and recording an audit log.
   */
  async cancelBooking(
    bookingId: number,
    carrierOrgId: number,
    userId: number,
    reason?: string
  ) {
    if (!bookingId || isNaN(bookingId)) {
      throw { status: 400, message: 'Invalid booking ID.' };
    }

    const booking = await prisma.booking.findUnique({
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

    if (!booking) {
      throw { status: 404, message: 'Booking not found.' };
    }

    if (booking.carrierOrgId !== carrierOrgId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to manage this booking.' };
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw { status: 400, message: 'Booking is already cancelled.' };
    }

    if (booking.status === BookingStatus.ARRIVED) {
      throw { status: 400, message: 'Cannot cancel a booking that has already arrived.' };
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update booking to CANCELLED and clear activeLock to release slot in unique index
      const updatedBooking = await tx.booking.update({
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

      // Record AuditLog
      await tx.auditLog.create({
        data: {
          bookingId,
          userId,
          action: 'CANCELLED',
          details: {
            reason: reason ? reason.trim() : 'Cancelled by carrier dispatcher',
            dockId: booking.dockId,
            slotStartTime: booking.slotStartTime.toISOString(),
            cancelledAt: new Date().toISOString(),
          },
        },
      });

      // Simultaneously create OutboxEvent
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'BOOKING',
          aggregateId: String(booking.id),
          payload: {
            action: 'CANCELLED',
            bookingId: booking.id,
            carrierOrgId,
            dockId: booking.dockId,
            slotStartTime: booking.slotStartTime.toISOString(),
            reason: reason ? reason.trim() : null,
            cancelledAt: new Date().toISOString(),
          },
          status: OutboxStatus.PENDING,
        },
      });

      return updatedBooking;
    });

    return result;
  }

  /**
   * Retrieves audit logs for a booking enforcing strict dual-sided tenant visibility:
   * Accessible by the Carrier Organization that created the booking OR
   * the Warehouse Operator Organization that owns the dock/warehouse.
   */
  async getBookingAuditLogs(bookingId: number, organizationId: number) {
    if (!bookingId || isNaN(bookingId)) {
      throw { status: 400, message: 'Invalid booking ID.' };
    }

    if (!organizationId) {
      throw { status: 400, message: 'Organization context required.' };
    }

    const booking = await prisma.booking.findUnique({
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

    if (!booking) {
      throw { status: 404, message: 'Booking not found.' };
    }

    const isCarrierTenant = booking.carrierOrgId === organizationId;
    const isWarehouseTenant = booking.dock.warehouse.organizationId === organizationId;

    if (!isCarrierTenant && !isWarehouseTenant) {
      throw {
        status: 403,
        message: 'Forbidden. You do not have access to audit logs for this booking.',
      };
    }

    const logs = await prisma.auditLog.findMany({
      where: { bookingId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            organizationId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return logs;
  }

  /**
   * Retrieves bookings for the user's organization.
   */
  async getBookings(organizationId: number, role: string) {
    if (!organizationId) {
      throw { status: 400, message: 'Organization ID is required.' };
    }

    if (role === 'CARRIER_ADMIN' || role === 'DISPATCHER') {
      return prisma.booking.findMany({
        where: { carrierOrgId: organizationId },
        include: {
          dock: {
            include: {
              warehouse: true,
            },
          },
        },
        orderBy: { slotStartTime: 'desc' },
      });
    }

    // Warehouse Operator
    return prisma.booking.findMany({
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
  }
}

export const bookingService = new BookingService();
