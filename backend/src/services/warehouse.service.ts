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
