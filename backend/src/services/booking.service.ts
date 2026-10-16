import { BookingStatus, DockStatus, OutboxStatus, OrganizationType } from '@prisma/client';
import { prisma } from '../config/db.config';
import {
  formatInTimeZone,
  getDayOfWeekInTimeZone,
  timeStringToMinutes,
} from '../utils/time.utils';
import { auditLogService } from './audit.service';

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

    // a. Validate that target dock exists and evaluate real-time dynamic effectiveStatus against now() and active closures
    const now = new Date();
    const dock = await prisma.dock.findUnique({
      where: { id: data.dockId },
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

    if (!dock) {
      throw { status: 404, message: 'Dock not found.' };
    }

    const hasActiveClosureNow = dock.closures && dock.closures.length > 0;
    const effectiveStatus = hasActiveClosureNow || dock.status === DockStatus.MAINTENANCE
      ? DockStatus.MAINTENANCE
      : dock.status;

    if (effectiveStatus !== DockStatus.ACTIVE) {
      throw { status: 400, message: 'Dock is currently under maintenance and cannot be booked.' };
    }

    if (!dock.warehouse) {
      throw { status: 404, message: 'Warehouse not found for this dock.' };
    }

    // b. Verify that requested slot falls within warehouse operating hours and has not passed
    const slotStart = new Date(data.slotStartTime);
    const slotEnd = new Date(data.slotEndTime);
    this.validateSlotOperatingHours(dock.warehouse, slotStart, slotEnd);

    // Enforce configurable warehouse booking & anti-hogging policies
    const policy = dock.warehouse.policy;
    if (policy) {
      // Max Advance Horizon Check: Reject bookings where slotStartTime > now() + maxAdvanceDays
      const maxAdvanceMs = policy.maxAdvanceDays * 24 * 60 * 60 * 1000;
      if (slotStart.getTime() > Date.now() + maxAdvanceMs) {
        throw {
          status: 400,
          message: `Policy violation: Bookings cannot be made more than ${policy.maxAdvanceDays} days in advance.`,
        };
      }

      // Anti-Hogging Check: Count active carrier bookings (BOOKED, ARRIVED) at this warehouse
      const activeBookingsCount = await prisma.booking.count({
        where: {
          carrierOrgId: dispatcherOrgId,
          status: { in: [BookingStatus.BOOKED, BookingStatus.ARRIVED] },
          dock: {
            warehouseId: dock.warehouseId,
          },
        },
      });

      if (activeBookingsCount >= policy.maxConcurrentBookings) {
        throw {
          status: 400,
          message: `Policy violation: Carrier organization has reached maximum allowed concurrent active bookings (${policy.maxConcurrentBookings}) at this warehouse.`,
        };
      }
    }

    // Verify requested slot is not under scheduled dock maintenance closure
    const overlappingClosure = await prisma.dockClosure.findFirst({
      where: {
        dockId: data.dockId,
        startTime: { lt: slotEnd },
        endTime: { gt: slotStart },
      },
    });
    if (overlappingClosure) {
      throw {
        status: 400,
        message: 'The requested dock slot is unavailable due to scheduled dock maintenance.',
      };
    }

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
          await auditLogService.recordLog({
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
            tx,
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
                policy: true,
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

    const now = new Date();
    if (targetDockId !== booking.dockId) {
      const foundDock = await prisma.dock.findUnique({
        where: { id: targetDockId },
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

      if (!foundDock) {
        throw { status: 404, message: 'Target dock not found.' };
      }

      const hasClosure = foundDock.closures && foundDock.closures.length > 0;
      const targetEffectiveStatus = hasClosure || foundDock.status === DockStatus.MAINTENANCE
        ? DockStatus.MAINTENANCE
        : foundDock.status;

      if (targetEffectiveStatus !== DockStatus.ACTIVE) {
        throw { status: 400, message: 'Target dock is currently under maintenance and cannot be booked.' };
      }

      targetDock = foundDock;
    } else {
      const activeClosure = await prisma.dockClosure.findFirst({
        where: {
          dockId: booking.dockId,
          startTime: { lte: now },
          endTime: { gte: now },
        },
      });

      if (booking.dock.status !== DockStatus.ACTIVE || activeClosure) {
        throw { status: 400, message: 'Dock is currently under maintenance and cannot be booked.' };
      }
    }

    const slotStart = new Date(data.slotStartTime);
    const slotEnd = new Date(data.slotEndTime);
    this.validateSlotOperatingHours(targetDock.warehouse, slotStart, slotEnd);

    // Enforce configurable warehouse booking policy & lock window rules
    const policy = targetDock.warehouse.policy || booking.dock.warehouse.policy;
    if (policy) {
      // 1. Max Advance Horizon Check on target slot
      const maxAdvanceMs = policy.maxAdvanceDays * 24 * 60 * 60 * 1000;
      if (slotStart.getTime() > Date.now() + maxAdvanceMs) {
        throw {
          status: 400,
          message: `Policy violation: Bookings cannot be rescheduled more than ${policy.maxAdvanceDays} days in advance.`,
        };
      }

      // 2. 24-Hour Lock Window & Same-Day Rescheduling Exception
      const hoursUntilCurrentSlot = (booking.slotStartTime.getTime() - Date.now()) / (60 * 60 * 1000);
      if (hoursUntilCurrentSlot < policy.bookingLockWindowHours) {
        const warehouseTz = targetDock.warehouse.timezone;
        const currentSlotDate = formatInTimeZone(booking.slotStartTime, warehouseTz, 'yyyy-MM-dd');
        const targetSlotDate = formatInTimeZone(slotStart, warehouseTz, 'yyyy-MM-dd');

        if (currentSlotDate !== targetSlotDate) {
          throw {
            status: 400,
            message: `Cannot reschedule to a different date within the ${policy.bookingLockWindowHours}-hour lock window. Only same-day emergency rescheduling is permitted.`,
          };
        }
      }
    }

    // Verify target slot is not under scheduled dock maintenance closure
    const overlappingClosure = await prisma.dockClosure.findFirst({
      where: {
        dockId: targetDockId,
        startTime: { lt: slotEnd },
        endTime: { gt: slotStart },
      },
    });
    if (overlappingClosure) {
      throw {
        status: 400,
        message: 'The requested dock slot is unavailable due to scheduled dock maintenance.',
      };
    }

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
        await auditLogService.recordLog({
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
          tx,
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
            warehouse: {
              include: {
                policy: true,
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
      throw { status: 400, message: 'Booking is already cancelled.' };
    }

    if (booking.status === BookingStatus.ARRIVED) {
      throw { status: 400, message: 'Cannot cancel a booking that has already arrived.' };
    }

    // Enforce lock window restriction on cancellations
    const policy = booking.dock.warehouse.policy;
    if (policy) {
      const hoursUntilSlot = (booking.slotStartTime.getTime() - Date.now()) / (60 * 60 * 1000);
      if (hoursUntilSlot < policy.bookingLockWindowHours) {
        throw {
          status: 400,
          message: `Cannot cancel booking within the ${policy.bookingLockWindowHours}-hour lock window prior to scheduled slot.`,
        };
      }
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
      await auditLogService.recordLog({
        bookingId,
        userId,
        action: 'CANCELLED',
        details: {
          reason: reason ? reason.trim() : 'Cancelled by carrier dispatcher',
          dockId: booking.dockId,
          slotStartTime: booking.slotStartTime.toISOString(),
          cancelledAt: new Date().toISOString(),
        },
        tx,
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

    return logs.map((log) => auditLogService.formatLogEntry(log));
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

  /**
   * Updates booking status (ARRIVED, NO_SHOW, COMPLETED).
   * Verifies that the warehouse belongs to the requesting warehouse operator organization.
   * Records an audit log entry tracking the status change.
   */
  async updateBookingStatus(
    bookingId: number,
    warehouseAdminOrgId: number,
    userId: number,
    status: 'ARRIVED' | 'NO_SHOW' | 'COMPLETED'
  ) {
    if (!bookingId || isNaN(bookingId)) {
      throw { status: 400, message: 'Invalid booking ID.' };
    }

    const validStatuses = ['ARRIVED', 'NO_SHOW', 'COMPLETED'];
    if (!status || !validStatuses.includes(status)) {
      throw {
        status: 400,
        message: `Invalid status '${status}'. Allowed statuses are: ${validStatuses.join(', ')}.`,
      };
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

    if (booking.dock.warehouse.organizationId !== warehouseAdminOrgId) {
      throw {
        status: 403,
        message: 'Forbidden. You do not have permission to manage bookings for this warehouse.',
      };
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw {
        status: 400,
        message: 'Cannot update status of a cancelled booking.',
      };
    }

    // Validation: Booking status can only be changed after the scheduled slot start time has passed
    const now = new Date();
    if (now < new Date(booking.slotStartTime)) {
      throw {
        status: 400,
        message: 'Booking status can only be changed after the scheduled slot start time has passed.',
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: status as BookingStatus,
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

      // Record AuditLog entry tracking the status change
      await auditLogService.recordLog({
        bookingId,
        userId,
        action: 'STATUS_CHANGED',
        details: {
          oldStatus: booking.status,
          newStatus: status,
          updatedAt: new Date().toISOString(),
        },
        tx,
      });

      // Simultaneously create OutboxEvent
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'BOOKING',
          aggregateId: String(booking.id),
          payload: {
            action: 'STATUS_CHANGED',
            bookingId: booking.id,
            carrierOrgId: booking.carrierOrgId,
            dockId: booking.dockId,
            oldStatus: booking.status,
            newStatus: status,
            updatedAt: new Date().toISOString(),
          },
          status: OutboxStatus.PENDING,
        },
      });

      return updatedBooking;
    });

    return result;
  }

  /**
   * Updates general booking details (truck plate, driver info, cargo note).
   * Records an UPDATED audit log entry with change summary and actor metadata.
   */
  async updateBooking(
    bookingId: number,
    carrierOrgId: number,
    userId: number,
    data: {
      truckPlate?: string;
      driverName?: string;
      driverPhone?: string;
      cargoNote?: string;
    }
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
      throw { status: 400, message: 'Cannot update a cancelled booking.' };
    }

    const changes: Record<string, { old: any; new: any }> = {};
    if (data.truckPlate !== undefined && data.truckPlate.trim() !== booking.truckPlate) {
      changes.truckPlate = { old: booking.truckPlate, new: data.truckPlate.trim() };
    }
    if (data.driverName !== undefined && data.driverName.trim() !== booking.driverName) {
      changes.driverName = { old: booking.driverName, new: data.driverName.trim() };
    }
    if (data.driverPhone !== undefined && data.driverPhone.trim() !== booking.driverPhone) {
      changes.driverPhone = { old: booking.driverPhone, new: data.driverPhone.trim() };
    }
    if (data.cargoNote !== undefined && data.cargoNote.trim() !== (booking.cargoNote || '')) {
      changes.cargoNote = { old: booking.cargoNote, new: data.cargoNote.trim() };
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          ...(data.truckPlate !== undefined ? { truckPlate: data.truckPlate.trim() } : {}),
          ...(data.driverName !== undefined ? { driverName: data.driverName.trim() } : {}),
          ...(data.driverPhone !== undefined ? { driverPhone: data.driverPhone.trim() } : {}),
          ...(data.cargoNote !== undefined ? { cargoNote: data.cargoNote.trim() } : {}),
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

      const changeKeys = Object.keys(changes);
      const summary =
        changeKeys.length > 0
          ? `Booking updated: modified ${changeKeys.join(', ')}`
          : 'Booking details updated';

      await auditLogService.recordLog({
        bookingId,
        userId,
        action: 'UPDATED',
        details: {
          changes,
        },
        summary,
        tx,
      });

      return updatedBooking;
    });

    return result;
  }
}

export const bookingService = new BookingService();
