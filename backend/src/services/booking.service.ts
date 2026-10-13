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

export class BookingService {
  /**
   * Creates a booking with atomic outbox event insertion and double-booking concurrency protection.
   */
  async createBooking(dispatcherOrgId: number, data: CreateBookingInput) {
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

    // b. Verify that the requested slot falls within warehouse operating hours and has not already passed
    const slotStart = new Date(data.slotStartTime);
    const slotEnd = new Date(data.slotEndTime);

    if (isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) {
      throw { status: 400, message: 'Invalid slotStartTime or slotEndTime format.' };
    }

    if (slotEnd <= slotStart) {
      throw { status: 400, message: 'slotEndTime must be greater than slotStartTime.' };
    }

    if (slotStart.getTime() < Date.now()) {
      throw { status: 400, message: 'Cannot book a slot in the past.' };
    }

    const warehouseTz = dock.warehouse.timezone;
    const dateStr = formatInTimeZone(slotStart, warehouseTz, 'yyyy-MM-dd');
    const startLocal = formatInTimeZone(slotStart, warehouseTz, 'HH:mm');
    const endLocal = formatInTimeZone(slotEnd, warehouseTz, 'HH:mm');
    const dayOfWeek = getDayOfWeekInTimeZone(dateStr, warehouseTz);

    const opHour = dock.warehouse.operatingHours.find(
      (oh) => oh.dayOfWeek === dayOfWeek || (dayOfWeek === 7 && oh.dayOfWeek === 0)
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
      // d. Catch Prisma unique constraint violation (P2002 on @@unique([dockId, slotStartTime]))
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
