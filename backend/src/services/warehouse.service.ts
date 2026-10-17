import { DockStatus, BookingStatus } from '@prisma/client';
import { prisma } from '../config/db.config';
import { dockService } from './dock.service';
import {
  isValidIanaTimeZone,
  isValidDateString,
  getDayOfWeekInTimeZone,
  generateTimeIntervals,
  zonedDateAndTimeToUtc,
  getZonedDayBounds,
  normalizeTimeOfDay,
  formatInTimeZone,
  timeStringToMinutes,
  resolveOperatingWindowMinutes,
} from '../utils/time.utils';

export interface CreateWarehouseInput {
  name: string;
  address: string;
  timezone: string;
  slotLengthMinutes?: number;
}

export interface UpdateWarehouseInput {
  name?: string;
  address?: string;
  timezone?: string;
  slotLengthMinutes?: number;
}

export interface UpdateWarehouseSettingsInput {
  slotLengthMinutes?: number;
  name?: string;
  address?: string;
  timezone?: string;
}

export interface UpdateWarehousePolicyInput {
  maxConcurrentBookings?: number;
  maxAdvanceDays?: number;
  bookingLockWindowHours?: number;
}

export interface UpdateOperatingHourInput {
  dayOfWeek: number;
  isOpen?: boolean;
  openTime?: string;
  closeTime?: string;
  slotLengthMinutes?: number;
}

export interface UpdateWarehouseHoursInput {
  hours: UpdateOperatingHourInput[];
}

export interface CreateDockInput {
  name: string;
  status?: DockStatus;
}

export interface UpdateDockInput {
  name?: string;
  status?: DockStatus;
}

export interface CreateDockClosureInput {
  startTime: string;
  endTime: string;
  reason: string;
}

export interface AvailableSlot {
  slotStartTime: string;
  slotEndTime: string;
  localStartTime: string;
  localEndTime: string;
}

export interface AvailableDockSlots {
  dockId: number;
  dockName: string;
  slots: AvailableSlot[];
}

export { isValidIanaTimeZone };

const OPERATING_HOURS_BOOKING_CONFLICT_MESSAGE =
  'Cannot update starting/end time: bookings available in related time.';

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validates an operating-hours time boundary. "24:00" is only accepted as a
 * closing boundary; an opening boundary must be a real time of day.
 */
function isValidTimeOfDay(value: unknown, allowEndOfDay: boolean = false): value is string {
  if (typeof value !== 'string') return false;
  if (value === '24:00') return allowEndOfDay;
  return TIME_OF_DAY_PATTERN.test(value);
}

/**
 * Normalizes the legacy Sunday conventions (0 and 7) to the 1 (Monday) - 7 (Sunday)
 * convention used by the schedule template.
 */
function normalizeDayOfWeek(dayOfWeek: number): number {
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

interface OperatingWindowMinutes {
  openMin: number;
  closeMin: number;
}

/**
 * Resolves a booking instant into the local calendar date and minute-of-day in the
 * warehouse timezone, so it can be matched against a weekday schedule.
 */
function getZonedBookingPosition(
  bookingStart: Date,
  timeZone: string
): { localDate: string; localMinutes: number } {
  return {
    localDate: formatInTimeZone(bookingStart, timeZone, 'yyyy-MM-dd'),
    localMinutes: timeStringToMinutes(formatInTimeZone(bookingStart, timeZone, 'HH:mm')),
  };
}


export class WarehouseService {
  /**
   * Creates a new warehouse for the specified organization.
   * Validates that the provided timezone is a valid IANA time zone string.
   */
  async createWarehouse(organizationId: number, data: CreateWarehouseInput) {
    if (!organizationId) {
      throw { status: 400, message: 'Organization ID is required.' };
    }

    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      throw { status: 400, message: 'Warehouse name is required.' };
    }

    if (!data.address || typeof data.address !== 'string' || !data.address.trim()) {
      throw { status: 400, message: 'Warehouse address is required.' };
    }

    if (!data.timezone || typeof data.timezone !== 'string' || !data.timezone.trim()) {
      throw { status: 400, message: 'Timezone is required.' };
    }

    const trimmedTimezone = data.timezone.trim();
    if (!isValidIanaTimeZone(trimmedTimezone)) {
      throw { status: 400, message: `Invalid IANA timezone string: '${trimmedTimezone}'.` };
    }

    // Verify organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw { status: 404, message: 'Organization not found.' };
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId,
        name: data.name.trim(),
        address: data.address.trim(),
        timezone: trimmedTimezone,
        slotLengthMinutes: data.slotLengthMinutes || 30,
        policy: {
          create: {
            maxConcurrentBookings: 3,
            maxAdvanceDays: 14,
            bookingLockWindowHours: 24,
          },
        },
      },
      include: {
        docks: true,
        policy: true,
      },
    });

    return warehouse;
  }

  /**
   * Retrieves all warehouses belonging to the specified organization (or all warehouses if caller is a carrier).
   */
  async getWarehouses(organizationId: number, isCarrier: boolean = false) {
    if (!organizationId) {
      throw { status: 400, message: 'Organization ID is required.' };
    }

    const whereClause = isCarrier ? {} : { organizationId };
    const now = new Date();

    const warehouses = await prisma.warehouse.findMany({
      where: whereClause,
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

    return warehouses.map((wh) => ({
      ...wh,
      docks: wh.docks.map((dock) => {
        const isUnderClosure = dock.closures && dock.closures.length > 0;
        const effectiveStatus: 'ACTIVE' | 'MAINTENANCE' = isUnderClosure
          ? 'MAINTENANCE'
          : (dock.status as 'ACTIVE' | 'MAINTENANCE');
        return {
          ...dock,
          effectiveStatus,
        };
      }),
    }));
  }

  /**
   * Retrieves a specific warehouse by ID, enforcing strict tenant isolation for warehouse operators.
   */
  async getWarehouseById(warehouseId: number, organizationId: number, isCarrier: boolean = false) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const now = new Date();
    const warehouse = await prisma.warehouse.findUnique({
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

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (!isCarrier && warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have access to this warehouse.' };
    }

    return {
      ...warehouse,
      docks: warehouse.docks.map((dock) => {
        const isUnderClosure = dock.closures && dock.closures.length > 0;
        const effectiveStatus: 'ACTIVE' | 'MAINTENANCE' = isUnderClosure
          ? 'MAINTENANCE'
          : (dock.status as 'ACTIVE' | 'MAINTENANCE');
        return {
          ...dock,
          effectiveStatus,
        };
      }),
    };
  }

  /**
   * Updates warehouse settings (e.g., default slotLengthMinutes) with strict tenant isolation.
   * Validates that slotLengthMinutes is a valid increment (e.g., 30, 45, 60 minutes) that divides evenly
   * into operating schedules, and updates both the warehouse and its operating hours records.
   * Existing confirmed bookings retain their original time ranges and remain unaffected.
   */
  async updateWarehouseSettings(
    warehouseId: number,
    organizationId: number,
    data: UpdateWarehouseSettingsInput
  ) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: {
        operatingHours: true,
        docks: true,
      },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw {
        status: 403,
        message: 'Forbidden. You do not have permission to manage settings for this warehouse.',
      };
    }

    if (data.slotLengthMinutes !== undefined) {
      const slotLength = data.slotLengthMinutes;
      const allowedIncrements = [15, 30, 45, 60, 90, 120];

      if (
        typeof slotLength !== 'number' ||
        !Number.isInteger(slotLength) ||
        slotLength <= 0 ||
        (!allowedIncrements.includes(slotLength) && 1440 % slotLength !== 0)
      ) {
        throw {
          status: 400,
          message: `Invalid slotLengthMinutes: ${slotLength}. Allowed increments must divide evenly into operating schedules (e.g., 30, 45, 60 minutes).`,
        };
      }
    }

    if (data.timezone) {
      const trimmedTz = data.timezone.trim();
      if (!isValidIanaTimeZone(trimmedTz)) {
        throw { status: 400, message: `Invalid IANA timezone string: '${trimmedTz}'.` };
      }
    }

    const isNameChanging = data.name !== undefined && data.name.trim() !== warehouse.name;
    const isAddressChanging = data.address !== undefined && data.address.trim() !== warehouse.address;
    const isTimezoneChanging = data.timezone !== undefined && data.timezone.trim() !== warehouse.timezone;
    const isCoreInfoChanging = isNameChanging || isAddressChanging || isTimezoneChanging;

    if (isCoreInfoChanging) {
      const activeBookedCount = await prisma.booking.count({
        where: {
          dock: {
            warehouseId,
          },
          status: BookingStatus.BOOKED,
        },
      });

      if (activeBookedCount > 0) {
        throw {
          status: 400,
          message: `Cannot update warehouse name, address, or timezone while there are active bookings with status 'BOOKED'.`,
        };
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.warehouse.update({
        where: { id: warehouseId },
        data: {
          ...(data.name && { name: data.name.trim() }),
          ...(data.address && { address: data.address.trim() }),
          ...(data.timezone && { timezone: data.timezone.trim() }),
          ...(data.slotLengthMinutes !== undefined && { slotLengthMinutes: data.slotLengthMinutes }),
        },
        include: {
          docks: true,
          operatingHours: true,
        },
      });

      if (data.slotLengthMinutes !== undefined) {
        await tx.operatingHour.updateMany({
          where: { warehouseId },
          data: {
            slotLengthMinutes: data.slotLengthMinutes,
          },
        });
      }

      return updated;
    });

    return result;
  }

  /**
   * Updates an existing warehouse with tenant isolation check.
   */
  async updateWarehouse(warehouseId: number, organizationId: number, data: UpdateWarehouseInput) {
    if (data.slotLengthMinutes !== undefined) {
      return this.updateWarehouseSettings(warehouseId, organizationId, data);
    }

    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const existing = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });

    if (!existing) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (existing.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to update this warehouse.' };
    }

    if (data.timezone) {
      const trimmedTz = data.timezone.trim();
      if (!isValidIanaTimeZone(trimmedTz)) {
        throw { status: 400, message: `Invalid IANA timezone string: '${trimmedTz}'.` };
      }
    }

    // Determine if core identification fields (name, address, timezone) are changing
    const isNameChanging = data.name !== undefined && data.name.trim() !== existing.name;
    const isAddressChanging = data.address !== undefined && data.address.trim() !== existing.address;
    const isTimezoneChanging = data.timezone !== undefined && data.timezone.trim() !== existing.timezone;
    const isCoreInfoChanging = isNameChanging || isAddressChanging || isTimezoneChanging;

    if (isCoreInfoChanging) {
      const activeBookedCount = await prisma.booking.count({
        where: {
          dock: {
            warehouseId,
          },
          status: BookingStatus.BOOKED,
        },
      });

      if (activeBookedCount > 0) {
        throw {
          status: 400,
          message: `Cannot update warehouse name, address, or timezone while there are active bookings with status 'BOOKED'.`,
        };
      }
    }

    const updated = await prisma.warehouse.update({
      where: { id: warehouseId },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.address && { address: data.address.trim() }),
        ...(data.timezone && { timezone: data.timezone.trim() }),
      },
      include: {
        docks: true,
      },
    });

    return updated;
  }

  /**
   * Retrieves the weekly operational schedule for a warehouse, enforcing tenant isolation.
   */
  async getWarehouseHours(warehouseId: number, organizationId: number) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const warehouse = await prisma.warehouse.findUnique({
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

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw {
        status: 403,
        message: 'Forbidden. You do not have permission to view operating hours for this warehouse.',
      };
    }

    return {
      warehouseId: warehouse.id,
      timezone: warehouse.timezone,
      slotLengthMinutes: warehouse.slotLengthMinutes,
      operatingHours: warehouse.operatingHours,
    };
  }

  /**
   * Updates the weekly operational schedule for a warehouse.
   *
   * Days are addressed 1 (Monday) - 7 (Sunday); `isOpen: false` removes that day's
   * operating hours entirely. When an update prunes part of an existing operating
   * window (opening later, closing earlier, or closing the day), any active
   * BOOKED/ARRIVED booking that falls inside the removed range blocks the change
   * with a deterministic validation error.
   */
  async updateWarehouseHours(
    warehouseId: number,
    organizationId: number,
    data: UpdateWarehouseHoursInput
  ) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    if (!data || !Array.isArray(data.hours) || data.hours.length === 0) {
      throw {
        status: 400,
        message: 'Missing operating hours. Provide a non-empty days array.',
      };
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: { operatingHours: true },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw {
        status: 403,
        message: 'Forbidden. You do not have permission to update operating hours for this warehouse.',
      };
    }

    const allowedIncrements = [15, 30, 45, 60, 90, 120];
    const existingByDay = new Map<number, (typeof warehouse.operatingHours)[number]>();
    for (const hour of warehouse.operatingHours) {
      const day = normalizeDayOfWeek(hour.dayOfWeek);
      // Prefer an exact 7 (Sunday) record over the legacy 0 form.
      if (!existingByDay.has(day) || hour.dayOfWeek === day) {
        existingByDay.set(day, hour);
      }
    }

    interface NormalizedHour {
      dayOfWeek: number;
      isOpen: boolean;
      openTime?: string;
      closeTime?: string;
      slotLengthMinutes: number;
      existingId?: number;
    }

    const normalized: NormalizedHour[] = [];
    const seenDays = new Set<number>();

    for (const raw of data.hours) {
      if (!raw || typeof raw !== 'object') {
        throw { status: 400, message: 'Invalid operating hour entry.' };
      }

      const dayOfWeek = normalizeDayOfWeek(Number(raw.dayOfWeek));
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
        throw {
          status: 400,
          message: `Invalid dayOfWeek: ${raw.dayOfWeek}. Must be an integer between 1 (Monday) and 7 (Sunday).`,
        };
      }

      if (seenDays.has(dayOfWeek)) {
        throw {
          status: 400,
          message: `Duplicate operating hours entry for dayOfWeek ${dayOfWeek}.`,
        };
      }
      seenDays.add(dayOfWeek);

      const existing = existingByDay.get(dayOfWeek);
      const isOpen = raw.isOpen === undefined ? true : raw.isOpen;

      if (typeof isOpen !== 'boolean') {
        throw {
          status: 400,
          message: `Invalid isOpen value for dayOfWeek ${dayOfWeek}. Must be a boolean.`,
        };
      }

      const slotLengthMinutes =
        raw.slotLengthMinutes ?? existing?.slotLengthMinutes ?? warehouse.slotLengthMinutes;

      if (
        typeof slotLengthMinutes !== 'number' ||
        !Number.isInteger(slotLengthMinutes) ||
        slotLengthMinutes <= 0 ||
        (!allowedIncrements.includes(slotLengthMinutes) && 1440 % slotLengthMinutes !== 0)
      ) {
        throw {
          status: 400,
          message: `Invalid slotLengthMinutes: ${slotLengthMinutes}. Allowed increments must divide evenly into operating schedules (e.g., 30, 45, 60 minutes).`,
        };
      }

      if (!isOpen) {
        normalized.push({
          dayOfWeek,
          isOpen,
          slotLengthMinutes,
          existingId: existing?.id,
        });
        continue;
      }

      const openTime = raw.openTime ?? existing?.openTime;
      const closeTime = raw.closeTime ?? existing?.closeTime;

      if (!isValidTimeOfDay(openTime)) {
        throw {
          status: 400,
          message: `Invalid openTime for dayOfWeek ${dayOfWeek}. Expected HH:mm between 00:00 and 23:59.`,
        };
      }

      if (!isValidTimeOfDay(closeTime, true)) {
        throw {
          status: 400,
          message: `Invalid closeTime for dayOfWeek ${dayOfWeek}. Expected HH:mm between 00:00 and 24:00.`,
        };
      }

      const { openMin, closeMin } = resolveOperatingWindowMinutes(openTime, closeTime);
      if (closeMin - openMin < slotLengthMinutes) {
        throw {
          status: 400,
          message: `Operating window for dayOfWeek ${dayOfWeek} must be at least one slot (${slotLengthMinutes} minutes) long.`,
        };
      }

      normalized.push({
        dayOfWeek,
        isOpen,
        openTime,
        closeTime,
        slotLengthMinutes,
        existingId: existing?.id,
      });
    }

    // Detect days whose operating window shrinks. Only these can orphan a booking.
    const oldWindows = new Map<number, OperatingWindowMinutes>();
    for (const hour of warehouse.operatingHours) {
      const day = normalizeDayOfWeek(hour.dayOfWeek);
      if (!oldWindows.has(day)) {
        oldWindows.set(day, resolveOperatingWindowMinutes(hour.openTime, hour.closeTime));
      }
    }

    const newWindows = new Map<number, OperatingWindowMinutes | null>();
    for (const entry of normalized) {
      newWindows.set(
        entry.dayOfWeek,
        entry.isOpen
          ? resolveOperatingWindowMinutes(entry.openTime as string, entry.closeTime as string)
          : null
      );
    }

    const pruningDays = normalized.filter((entry) => {
      const oldWindow = oldWindows.get(entry.dayOfWeek);
      if (!oldWindow) return false;

      const newWindow = newWindows.get(entry.dayOfWeek);
      if (!newWindow) return true;

      return newWindow.openMin > oldWindow.openMin || newWindow.closeMin < oldWindow.closeMin;
    });

    if (pruningDays.length > 0) {
      const activeBookings = await prisma.booking.findMany({
        where: {
          dock: { warehouseId },
          status: { in: [BookingStatus.BOOKED, BookingStatus.ARRIVED] },
          slotEndTime: { gt: new Date() },
        },
        select: {
          id: true,
          slotStartTime: true,
          slotEndTime: true,
        },
      });

      for (const entry of pruningDays) {
        const oldWindow = oldWindows.get(entry.dayOfWeek) as OperatingWindowMinutes;
        const newWindow = newWindows.get(entry.dayOfWeek) ?? null;

        const hasBookingInPrunedRange = activeBookings.some((booking) => {
          const { localDate, localMinutes } = getZonedBookingPosition(
            booking.slotStartTime,
            warehouse.timezone
          );
          const durationMinutes = Math.max(
            0,
            Math.round(
              (booking.slotEndTime.getTime() - booking.slotStartTime.getTime()) / 60000
            )
          );
          const localDay = getDayOfWeekInTimeZone(localDate, warehouse.timezone);
          const previousDay = localDay === 1 ? 7 : localDay - 1;

          const candidateRanges: Array<{ start: number; end: number }> = [];
          if (localDay === entry.dayOfWeek) {
            candidateRanges.push({
              start: localMinutes,
              end: localMinutes + durationMinutes,
            });
          }
          // An overnight window belongs to the previous day's schedule, so the
          // boundary is shifted into the extended minute space (past 24:00).
          if (previousDay === entry.dayOfWeek) {
            candidateRanges.push({
              start: localMinutes + 1440,
              end: localMinutes + 1440 + durationMinutes,
            });
          }

          return candidateRanges.some(({ start, end }) => {
            const overlapsOldWindow =
              start < oldWindow.closeMin && end > oldWindow.openMin;
            const fullyWithinNewWindow =
              !!newWindow && start >= newWindow.openMin && end <= newWindow.closeMin;

            return overlapsOldWindow && !fullyWithinNewWindow;
          });
        });

        if (hasBookingInPrunedRange) {
          throw { status: 400, message: OPERATING_HOURS_BOOKING_CONFLICT_MESSAGE };
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const entry of normalized) {
        if (!entry.isOpen) {
          if (entry.existingId) {
            await tx.operatingHour.delete({ where: { id: entry.existingId } });
          }
          continue;
        }

        if (entry.existingId) {
          await tx.operatingHour.update({
            where: { id: entry.existingId },
            data: {
              openTime: entry.openTime as string,
              closeTime: entry.closeTime as string,
              slotLengthMinutes: entry.slotLengthMinutes,
            },
          });
        } else {
          await tx.operatingHour.create({
            data: {
              warehouseId,
              dayOfWeek: entry.dayOfWeek,
              openTime: entry.openTime as string,
              closeTime: entry.closeTime as string,
              slotLengthMinutes: entry.slotLengthMinutes,
            },
          });
        }
      }
    });

    return this.getWarehouseHours(warehouseId, organizationId);
  }

  /**
   * Creates a dock for a warehouse, strictly verifying warehouse ownership.
   */
  async createDock(warehouseId: number, organizationId: number, data: CreateDockInput) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      throw { status: 400, message: 'Dock name is required.' };
    }

    if (data.status && !Object.values(DockStatus).includes(data.status)) {
      throw { status: 400, message: `Invalid dock status: '${data.status}'. Must be ACTIVE or MAINTENANCE.` };
    }

    // Verify warehouse exists and belongs to the caller's organization
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to manage this warehouse.' };
    }

    const dock = await prisma.dock.create({
      data: {
        warehouseId,
        name: data.name.trim(),
        status: data.status || DockStatus.ACTIVE,
      },
    });

    return {
      ...dock,
      effectiveStatus: dock.status as 'ACTIVE' | 'MAINTENANCE',
    };
  }

  /**
   * Lists docks for a warehouse, enforcing strict tenant isolation for warehouse operators,
   * using an optimized single-query with Prisma include to evaluate dynamic real-time effectiveStatus.
   */
  async getDocks(warehouseId: number, organizationId: number, isCarrier: boolean = false) {
    return dockService.getDocksByWarehouse(warehouseId, organizationId, isCarrier);
  }

  /**
   * Updates dock status (e.g. toggling between ACTIVE and MAINTENANCE),
   * enforcing strict tenant isolation through the parent warehouse.
   */
  async updateDockStatus(dockId: number, organizationId: number, status: DockStatus) {
    if (!dockId || isNaN(dockId)) {
      throw { status: 400, message: 'Invalid dock ID.' };
    }

    if (!status || !Object.values(DockStatus).includes(status)) {
      throw { status: 400, message: `Invalid dock status: '${status}'. Must be ACTIVE or MAINTENANCE.` };
    }

    const dock = await prisma.dock.findUnique({
      where: { id: dockId },
      include: { warehouse: true },
    });

    if (!dock) {
      throw { status: 404, message: 'Dock not found.' };
    }

    if (dock.warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to modify this dock.' };
    }

    const now = new Date();
    const updatedDock = await prisma.dock.update({
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

    const isUnderClosure = updatedDock.closures && updatedDock.closures.length > 0;
    const effectiveStatus: 'ACTIVE' | 'MAINTENANCE' = isUnderClosure
      ? 'MAINTENANCE'
      : (updatedDock.status as 'ACTIVE' | 'MAINTENANCE');

    return {
      ...updatedDock,
      effectiveStatus,
    };
  }

  /**
   * Updates a dock's name (and optional status), strictly verifying organization ownership.
   * To prevent driver and carrier confusion, the dock name can only be updated if there are
   * no active bookings with status 'BOOKED' for this dock.
   */
  async updateDock(dockId: number, organizationId: number, data: UpdateDockInput, warehouseId?: number) {
    if (!dockId || isNaN(dockId)) {
      throw { status: 400, message: 'Invalid dock ID.' };
    }

    if (data.name !== undefined && (!data.name || typeof data.name !== 'string' || !data.name.trim())) {
      throw { status: 400, message: 'Dock name cannot be empty.' };
    }

    if (data.status && !Object.values(DockStatus).includes(data.status)) {
      throw { status: 400, message: `Invalid dock status: '${data.status}'. Must be ACTIVE or MAINTENANCE.` };
    }

    const dock = await prisma.dock.findUnique({
      where: { id: dockId },
      include: { warehouse: true },
    });

    if (!dock) {
      throw { status: 404, message: 'Dock not found.' };
    }

    if (warehouseId && dock.warehouseId !== warehouseId) {
      throw { status: 400, message: 'Dock does not belong to the specified warehouse.' };
    }

    if (dock.warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to modify this dock.' };
    }

    const isNameChanging = data.name !== undefined && data.name.trim() !== dock.name;

    if (isNameChanging) {
      const activeBookedCount = await prisma.booking.count({
        where: {
          dockId,
          status: BookingStatus.BOOKED,
        },
      });

      if (activeBookedCount > 0) {
        throw {
          status: 400,
          message: `Cannot update dock name while there are active bookings with status 'BOOKED'.`,
        };
      }
    }

    const now = new Date();
    const updatedDock = await prisma.dock.update({
      where: { id: dockId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.status !== undefined && { status: data.status }),
      },
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

    const isUnderClosure = updatedDock.closures && updatedDock.closures.length > 0;
    const effectiveStatus: 'ACTIVE' | 'MAINTENANCE' = isUnderClosure
      ? 'MAINTENANCE'
      : (updatedDock.status as 'ACTIVE' | 'MAINTENANCE');

    return {
      ...updatedDock,
      effectiveStatus,
    };
  }

  /**
   * Creates a scheduled maintenance closure for a dock.
   * Verifies tenant ownership and ensures closure does not overlap with active bookings.
   */
  async createDockClosure(dockId: number, warehouseAdminOrgId: number, data: CreateDockClosureInput) {
    if (!dockId || isNaN(dockId)) {
      throw { status: 400, message: 'Invalid dock ID.' };
    }

    if (!data.startTime || !data.endTime) {
      throw { status: 400, message: 'startTime and endTime are required.' };
    }

    if (!data.reason || typeof data.reason !== 'string' || !data.reason.trim()) {
      throw { status: 400, message: 'Reason is required and cannot be blank.' };
    }

    const closureStart = new Date(data.startTime);
    const closureEnd = new Date(data.endTime);

    if (isNaN(closureStart.getTime()) || isNaN(closureEnd.getTime())) {
      throw { status: 400, message: 'Invalid startTime or endTime format.' };
    }

    if (closureStart < new Date()) {
      throw { status: 400, message: 'Invalid startTime: Closure start time cannot be in the past.' };
    }

    if (closureEnd <= closureStart) {
      throw { status: 400, message: 'endTime must be greater than startTime.' };
    }

    // Verify dock exists and belongs to the caller's warehouse operator organization
    const dock = await prisma.dock.findUnique({
      where: { id: dockId },
      include: { warehouse: true },
    });

    if (!dock) {
      throw { status: 404, message: 'Dock not found.' };
    }

    if (dock.warehouse.organizationId !== warehouseAdminOrgId) {
      throw {
        status: 403,
        message: 'Forbidden. You do not have permission to manage this dock.',
      };
    }

    // Validate that the closure does not fall on days with active bookings
    const timeZone = dock.warehouse.timezone || 'UTC';
    const startDateStr = formatInTimeZone(closureStart, timeZone, 'yyyy-MM-dd');
    const effectiveEnd = new Date(closureEnd.getTime() - 1);
    const endDateStr = formatInTimeZone(effectiveEnd, timeZone, 'yyyy-MM-dd');

    const { startOfDayUtc } = getZonedDayBounds(startDateStr, timeZone);
    const { endOfDayUtc } = getZonedDayBounds(endDateStr, timeZone);

    const bookingOnDay = await prisma.booking.findFirst({
      where: {
        dockId,
        status: { in: [BookingStatus.BOOKED, BookingStatus.ARRIVED] },
        slotStartTime: { lt: endOfDayUtc },
        slotEndTime: { gt: startOfDayUtc },
      },
    });

    if (bookingOnDay) {
      throw {
        status: 409,
        message: 'Cannot schedule maintenance closure: an active booking exists on this dock for that day.',
      };
    }

    const closure = await prisma.dockClosure.create({
      data: {
        dockId,
        startTime: closureStart,
        endTime: closureEnd,
        reason: data.reason ? data.reason.trim() : null,
      },
      include: {
        dock: true,
      },
    });

    return closure;
  }

  /**
   * Retrieves all scheduled maintenance closures for a dock.
   */
  async getDockClosures(dockId: number, warehouseAdminOrgId: number) {
    if (!dockId || isNaN(dockId)) {
      throw { status: 400, message: 'Invalid dock ID.' };
    }

    const dock = await prisma.dock.findUnique({
      where: { id: dockId },
      include: { warehouse: true },
    });

    if (!dock) {
      throw { status: 404, message: 'Dock not found.' };
    }

    if (dock.warehouse.organizationId !== warehouseAdminOrgId) {
      throw {
        status: 403,
        message: 'Forbidden. You do not have access to closures for this dock.',
      };
    }

    const closures = await prisma.dockClosure.findMany({
      where: { dockId },
      orderBy: { startTime: 'asc' },
    });

    return closures;
  }

  /**
   * Generates and returns available time slots for all active docks of a warehouse on targetDate,
   * strictly adhering to the warehouse's IANA timezone and operating hours,
   * and filtering out existing active bookings (BOOKED or ARRIVED) as well as scheduled maintenance closures.
   */
  async getAvailableSlots(warehouseId: number, targetDate: string, dockId?: number): Promise<AvailableDockSlots[]> {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    if (!targetDate || typeof targetDate !== 'string') {
      throw { status: 400, message: 'Missing targetDate parameter.' };
    }

    if (dockId !== undefined && (isNaN(dockId) || dockId <= 0)) {
      throw { status: 400, message: 'Invalid dockId parameter.' };
    }

    const trimmedDate = targetDate.trim();
    if (!isValidDateString(trimmedDate)) {
      throw { status: 400, message: 'Invalid date format. Expected a valid calendar date in YYYY-MM-DD format.' };
    }

    // a. Fetch the warehouse record to obtain its timezone and context
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: {
        id: true,
        name: true,
        timezone: true,
        organizationId: true,
      },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    // b. Fetch docks for this warehouse with active closures at now() to dynamically evaluate effectiveStatus
    const now = new Date();
    const docks = await prisma.dock.findMany({
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

    // Exclude docks currently undergoing maintenance or whose base status is MAINTENANCE
    const activeDocks = docks.filter((dock) => {
      const isUnderClosure = dock.closures && dock.closures.length > 0;
      const effectiveStatus = isUnderClosure || dock.status === DockStatus.MAINTENANCE
        ? DockStatus.MAINTENANCE
        : dock.status;
      return effectiveStatus === DockStatus.ACTIVE;
    });

    if (activeDocks.length === 0) {
      return [];
    }

    // c. Determine the day of the week for targetDate in the warehouse's timezone (1 = Monday ... 7 = Sunday)
    const dayOfWeek = getDayOfWeekInTimeZone(trimmedDate, warehouse.timezone);

    // Query operating_hours for this day of week (supporting 1-7 and fallback to 0 for Sunday)
    const operatingHour = await prisma.operatingHour.findFirst({
      where: {
        warehouseId,
        OR: [
          { dayOfWeek },
          ...(dayOfWeek === 7 ? [{ dayOfWeek: 0 }] : []),
        ],
      },
    });

    // If closed or no operating hours exist, return an empty array
    if (!operatingHour) {
      return [];
    }

    // d. Generate all possible time slot intervals between openTime and closeTime
    const intervals = generateTimeIntervals(
      operatingHour.openTime,
      operatingHour.closeTime,
      operatingHour.slotLengthMinutes
    );

    if (intervals.length === 0) {
      return [];
    }

    // e. Query existing bookings for all active docks on targetDate (localized to warehouse timezone).
    // Overnight windows can end on the following calendar day, so the lookup window is widened to
    // cover the last generated interval as well.
    const { startOfDayUtc, endOfDayUtc } = getZonedDayBounds(trimmedDate, warehouse.timezone);
    const lastIntervalEndUtc = zonedDateAndTimeToUtc(
      trimmedDate,
      intervals[intervals.length - 1].end,
      warehouse.timezone
    );
    const lookupEndUtc = lastIntervalEndUtc > endOfDayUtc ? lastIntervalEndUtc : endOfDayUtc;

    const bookings = await prisma.booking.findMany({
      where: {
        dockId: { in: activeDocks.map((d) => d.id) },
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

    // Query scheduled maintenance closures overlapping target date
    const closures = await prisma.dockClosure.findMany({
      where: {
        dockId: { in: activeDocks.map((d) => d.id) },
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

    // f. Filter out any slots in the past, already booked, or under scheduled maintenance closure
    // Note: slotStartTime is converted from warehouse's IANA timezone to UTC via zonedDateAndTimeToUtc,
    // and compared against now.getTime() (UTC epoch ms) to prevent any server/warehouse/browser timezone conflicts.
    const nowMs = now.getTime();

    const dockSlotMappings: AvailableDockSlots[] = activeDocks.map((dock) => {
      const freeSlots: AvailableSlot[] = [];

      for (const interval of intervals) {
        const slotStartTime = zonedDateAndTimeToUtc(trimmedDate, interval.start, warehouse.timezone);
        const slotEndTime = zonedDateAndTimeToUtc(trimmedDate, interval.end, warehouse.timezone);
        const slotStartMs = slotStartTime.getTime();
        const slotEndMs = slotEndTime.getTime();

        // Do not return slots that have already started or passed
        if (slotStartMs <= nowMs) {
          continue;
        }

        const isBooked = bookings.some((b) => {
          if (b.dockId !== dock.id) return false;
          const bStart = b.slotStartTime.getTime();
          const bEnd = b.slotEndTime.getTime();
          return bStart === slotStartMs || (bStart < slotEndMs && bEnd > slotStartMs);
        });

        const isUnderMaintenance = closures.some((c) => {
          if (c.dockId !== dock.id) return false;
          const cStart = c.startTime.getTime();
          const cEnd = c.endTime.getTime();
          return cStart < slotEndMs && cEnd > slotStartMs;
        });

        if (!isBooked && !isUnderMaintenance) {
          freeSlots.push({
            slotStartTime: slotStartTime.toISOString(),
            slotEndTime: slotEndTime.toISOString(),
            localStartTime: normalizeTimeOfDay(interval.start),
            localEndTime: normalizeTimeOfDay(interval.end),
          });
        }
      }

      return {
        dockId: dock.id,
        dockName: dock.name,
        slots: freeSlots,
      };
    });

    return dockSlotMappings;
  }

  /**
   * Retrieves the booking policy for a warehouse.
   * If no policy exists yet, creates one with default values.
   */
  async getWarehousePolicy(warehouseId: number, organizationId: number) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: { policy: true },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have access to this warehouse.' };
    }

    if (!warehouse.policy) {
      const policy = await prisma.warehousePolicy.create({
        data: {
          warehouseId,
          maxConcurrentBookings: 3,
          maxAdvanceDays: 14,
          bookingLockWindowHours: 24,
        },
      });
      return policy;
    }

    return warehouse.policy;
  }

  /**
   * Updates the configurable booking policy for a warehouse.
   * Restricted to WAREHOUSE_ADMIN of the owning organization.
   */
  async updateWarehousePolicy(
    warehouseId: number,
    organizationId: number,
    data: UpdateWarehousePolicyInput
  ) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: { policy: true },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have access to this warehouse.' };
    }

    if (
      data.maxConcurrentBookings === undefined &&
      data.maxAdvanceDays === undefined &&
      data.bookingLockWindowHours === undefined
    ) {
      throw {
        status: 400,
        message: 'At least one policy field (maxConcurrentBookings, maxAdvanceDays, bookingLockWindowHours) must be provided.',
      };
    }

    if (data.maxConcurrentBookings !== undefined) {
      if (
        typeof data.maxConcurrentBookings !== 'number' ||
        !Number.isInteger(data.maxConcurrentBookings) ||
        data.maxConcurrentBookings < 1
      ) {
        throw { status: 400, message: 'maxConcurrentBookings must be a positive integer.' };
      }
    }

    if (data.maxAdvanceDays !== undefined) {
      if (
        typeof data.maxAdvanceDays !== 'number' ||
        !Number.isInteger(data.maxAdvanceDays) ||
        data.maxAdvanceDays < 1
      ) {
        throw { status: 400, message: 'maxAdvanceDays must be a positive integer.' };
      }
    }

    if (data.bookingLockWindowHours !== undefined) {
      if (
        typeof data.bookingLockWindowHours !== 'number' ||
        !Number.isInteger(data.bookingLockWindowHours) ||
        data.bookingLockWindowHours < 0
      ) {
        throw { status: 400, message: 'bookingLockWindowHours must be a non-negative integer.' };
      }
    }

    const updatedPolicy = await prisma.warehousePolicy.upsert({
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

    return updatedPolicy;
  }
}

export const warehouseService = new WarehouseService();
