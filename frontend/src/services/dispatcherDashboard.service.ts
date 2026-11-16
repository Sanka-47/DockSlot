import { bookingApi } from '../api/booking.api';
import { warehouseApi } from '../api/warehouse.api';
import type { AvailableDockSlots, AvailableSlot, Warehouse } from '../types/warehouse.types';
import type { Booking, CreateBookingRequest } from '../types/booking.types';
import { filterBookings as filterBookingsShared } from '../utils/bookingFilters';
import type { BookingFilterCriteria } from '../utils/bookingFilters';
import { getBookingWarehouseTimezone } from '../utils/timezones';
import { getApiErrorMessage } from './errors';

export {
  formatDateInTimezone,
  formatSlotWindow,
  getMaxAdvanceDateString,
  getTodayDateString,
} from '../utils/formatters';
export { getBookingWarehouseTimezone } from '../utils/timezones';

export interface DispatcherDashboardData {
  warehouses: Warehouse[];
  bookings: Booking[];
  errorMessage: string | null;
}

export interface RescheduleSlot {
  dockId: number;
  dockName: string;
  slotStartTime: string;
  slotEndTime: string;
  localStartTime?: string;
  localEndTime?: string;
}

export type BookingFilters = BookingFilterCriteria;

/** Checks that a slot's UTC start instant is still in the future. */
export function isFutureSlot(slot: AvailableSlot): boolean {
  if (!slot?.slotStartTime) return false;

  const slotStartMs = new Date(slot.slotStartTime).getTime();
  if (Number.isNaN(slotStartMs)) return false;

  return slotStartMs > Date.now();
}

/** True while a booking is inside the warehouse's cancellation lock window. */
export function isInsideLockWindow(booking: Booking | null): boolean {
  if (!booking || !booking.slotStartTime) return false;

  const slotTime = new Date(booking.slotStartTime).getTime();
  const hoursUntil = (slotTime - Date.now()) / (1000 * 60 * 60);
  const lockHours = booking.dock?.warehouse?.policy?.bookingLockWindowHours ?? 24;

  return hoursUntil >= 0 && hoursUntil < lockHours;
}

/**
 * Normalizes both API slot shapes (grouped or flat) into grouped dock slots,
 * dropping past slots and optionally narrowing to a single dock.
 */
export function normalizeSlotResponse(
  rawData: unknown,
  dockIdFilter?: number,
): AvailableDockSlots[] {
  if (!Array.isArray(rawData) || rawData.length === 0) {
    return [];
  }

  if ('slots' in rawData[0]) {
    return (rawData as AvailableDockSlots[]).map((group) => ({
      ...group,
      slots: (dockIdFilter
        ? group.dockId === dockIdFilter
          ? group.slots
          : []
        : group.slots
      ).filter(isFutureSlot),
    }));
  }

  if ('slotStartTime' in rawData[0]) {
    const flatList = rawData as unknown as AvailableSlot[];
    const grouped: Record<number, AvailableDockSlots> = {};

    flatList.forEach((slot) => {
      if (!isFutureSlot(slot)) return;

      const dId = slot.dockId || 0;
      const dName = slot.dockName || `Dock #${dId}`;
      if (!grouped[dId]) {
        grouped[dId] = { dockId: dId, dockName: dName, slots: [] };
      }
      if (!dockIdFilter || dId === dockIdFilter) {
        grouped[dId].slots.push(slot);
      }
    });

    return Object.values(grouped);
  }

  return [];
}

/** Removes a single booked slot from the grouped results for instant feedback. */
export function removeSlotFromGroups(
  groups: AvailableDockSlots[] | null,
  dockId: number,
  slotStartTime: string,
): AvailableDockSlots[] | null {
  if (!groups) return groups;

  return groups.map((dockGroup) => {
    if (dockGroup.dockId !== dockId) return dockGroup;

    return {
      ...dockGroup,
      slots: dockGroup.slots.filter((slot) => slot.slotStartTime !== slotStartTime),
    };
  });
}

export function filterBookings(
  bookings: Booking[],
  filters: BookingFilters,
  warehouses: Warehouse[],
): Booking[] {
  return filterBookingsShared(bookings, filters, {
    includeWarehouseName: true,
    getWarehouseTimezone: (booking) => getBookingWarehouseTimezone(booking, warehouses),
  });
}

export interface BookingFormInput {
  truckPlate: string;
  driverName: string;
  driverPhone: string;
}

/** Returns a user-facing validation message, or null when the form is valid. */
export function validateBookingInput(input: BookingFormInput): string | null {
  if (!input.truckPlate.trim()) {
    return 'Truck license plate is required.';
  }

  if (!input.driverName.trim()) {
    return 'Driver name is required.';
  }

  if (!input.driverPhone.trim()) {
    return 'Driver phone number is required.';
  }

  return null;
}

function extractFallbackWarehouses(bookings: Booking[]): Warehouse[] {
  const fallbackWarehousesMap: Record<number, Warehouse> = {};

  bookings.forEach((booking) => {
    if (!booking.dock?.warehouse) return;

    const warehouse = booking.dock.warehouse;
    if (fallbackWarehousesMap[warehouse.id]) return;

    fallbackWarehousesMap[warehouse.id] = {
      id: warehouse.id,
      organizationId: 0,
      name: warehouse.name,
      address: warehouse.address || '',
      timezone: warehouse.timezone || 'UTC',
      slotLengthMinutes: 30,
      docks: [
        {
          id: booking.dock.id,
          warehouseId: warehouse.id,
          name: booking.dock.name,
          status: booking.dock.status,
        },
      ],
    };
  });

  return Object.values(fallbackWarehousesMap);
}

/** API orchestration and slot/booking business rules for the dispatcher view. */
export const dispatcherDashboardService = {
  async fetchBookings(signal?: AbortSignal): Promise<Booking[]> {
    const response = await bookingApi.getAll(signal);
    return response.data || [];
  },

  /**
   * Loads warehouses and bookings independently so one failed request does not
   * hide the other. Warehouses are reconstructed from bookings when necessary.
   */
  async loadDashboardData(signal?: AbortSignal): Promise<DispatcherDashboardData> {
    const [warehousesResult, bookingsResult] = await Promise.allSettled([
      warehouseApi.getAll(signal),
      bookingApi.getAll(signal),
    ]);

    let bookings: Booking[] = [];
    let errorMessage: string | null = null;

    if (bookingsResult.status === 'fulfilled') {
      bookings = bookingsResult.value?.data || [];
    } else {
      errorMessage = getApiErrorMessage(bookingsResult.reason, 'Failed to load bookings.');
    }

    if (warehousesResult.status === 'fulfilled') {
      return {
        warehouses: warehousesResult.value?.data || [],
        bookings,
        errorMessage,
      };
    }

    const warehouseError = getApiErrorMessage(
      warehousesResult.reason,
      'Failed to load warehouses.',
    );
    const fallbackWarehouses = extractFallbackWarehouses(bookings);
    if (fallbackWarehouses.length > 0) {
      return {
        warehouses: fallbackWarehouses,
        bookings,
        errorMessage:
          errorMessage || `${warehouseError} Showing warehouse details from bookings instead.`,
      };
    }

    return {
      warehouses: [],
      bookings,
      errorMessage: errorMessage || warehouseError,
    };
  },

  async searchAvailableSlots(
    warehouseId: number,
    targetDate: string,
    dockId?: number,
    signal?: AbortSignal,
  ): Promise<AvailableDockSlots[]> {
    const response = await warehouseApi.getAvailableSlots(warehouseId, targetDate, dockId, signal);

    return normalizeSlotResponse(response.data, dockId);
  },

  async fetchRescheduleSlots(
    warehouseId: number,
    date: string,
    signal?: AbortSignal,
  ): Promise<AvailableDockSlots[]> {
    const response = await warehouseApi.getAvailableSlots(warehouseId, date, undefined, signal);
    return normalizeSlotResponse(response.data);
  },

  async createBooking(payload: CreateBookingRequest): Promise<Booking> {
    const response = await bookingApi.create(payload);
    return response.data;
  },

  async rescheduleBooking(
    bookingId: number,
    slot: RescheduleSlot,
    reason?: string,
  ): Promise<Booking> {
    const response = await bookingApi.reschedule(bookingId, {
      slotStartTime: slot.slotStartTime,
      slotEndTime: slot.slotEndTime,
      dockId: slot.dockId,
      newDockId: slot.dockId,
      reason,
    });

    return response.data;
  },

  async cancelBooking(bookingId: number, reason?: string): Promise<Booking> {
    const response = await bookingApi.cancel(bookingId, reason);
    return response.data;
  },
};
