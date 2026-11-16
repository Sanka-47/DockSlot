import { bookingApi } from '../api/booking.api';
import { warehouseApi } from '../api/warehouse.api';
import type { Booking, BookingStatus } from '../types/booking.types';
import type { Dock, DockClosure, Warehouse } from '../types/warehouse.types';
import { formatDateKey, formatDateTime } from '../utils/formatters';
import { getApiErrorMessage } from './errors';
import { fromZonedTime } from 'date-fns-tz';

export type DockWithWarehouse = Dock & {
  warehouseName: string;
  warehouseTimezone: string;
};

export interface DockManagerData {
  bookings: Booking[];
  warehouses: Warehouse[];
  closures: DockClosure[];
  warningMessage: string | null;
}

export interface BookingFilters {
  warehouseId: string;
  status: string;
  searchQuery: string;
}

export interface UpcomingDay {
  dateStr: string;
  dayOfWeekShort: string;
  dayOfMonth: number;
  monthShort: string;
}

export interface ClosureDateSuggestion {
  date: string;
  bookedDates: Set<string>;
}

/** Local `YYYY-MM-DD` key, used only as a last-resort fallback. */
export function toLocalDateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Calendar key in the warehouse's time zone, falling back to browser-local. */
export function toDateKeyInTimeZone(date: Date, timeZone?: string): string {
  if (Number.isNaN(date.getTime())) return '';
  return formatDateKey(date, timeZone, toLocalDateKey(date));
}

/** Adds calendar days to an ISO date key without depending on the host zone. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return '';

  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function zonedNoon(dateKey: string, timeZone?: string): Date {
  if (!timeZone) return new Date(`${dateKey}T12:00:00`);

  try {
    return fromZonedTime(`${dateKey}T12:00:00`, timeZone);
  } catch {
    return new Date(`${dateKey}T12:00:00`);
  }
}

export function aggregateDocks(warehouses: Warehouse[]): DockWithWarehouse[] {
  const docks: DockWithWarehouse[] = [];

  warehouses.forEach((warehouse) => {
    warehouse.docks?.forEach((dock) => {
      docks.push({
        ...dock,
        warehouseName: warehouse.name,
        warehouseTimezone: warehouse.timezone || 'UTC',
      });
    });
  });

  return docks;
}

/** Map of warehouse-local date -> number of active bookings on the dock. */
export function getBookedDatesForDock(
  bookings: Booking[],
  dockId: number,
  timeZone?: string,
): Map<string, number> {
  const datesMap = new Map<string, number>();
  if (!dockId) return datesMap;

  bookings.forEach((booking) => {
    const bookingDockId = booking.dockId ?? booking.dock?.id;
    const isActive = booking.status === 'BOOKED' || booking.status === 'ARRIVED';

    if (bookingDockId !== dockId || !isActive) return;

    const bookingTimezone = timeZone || booking.dock?.warehouse?.timezone || 'UTC';
    const dateStr = toDateKeyInTimeZone(new Date(booking.slotStartTime), bookingTimezone);
    if (!dateStr) return;

    datesMap.set(dateStr, (datesMap.get(dateStr) || 0) + 1);
  });

  return datesMap;
}

/** Next `days` calendar days in the warehouse's time zone. */
export function getUpcomingDays(days: number = 14, timeZone?: string): UpcomingDay[] {
  const result: UpcomingDay[] = [];
  const todayKey = toDateKeyInTimeZone(new Date(), timeZone);
  if (!todayKey) return result;

  for (let index = 0; index < days; index += 1) {
    const dateStr = shiftDateKey(todayKey, index);
    const noon = zonedNoon(dateStr, timeZone);
    const dayOfMonth = Number(formatDateTime(noon, 'd', timeZone, '0'));

    result.push({
      dateStr,
      dayOfWeekShort: formatDateTime(noon, 'EEE', timeZone, ''),
      dayOfMonth: Number.isFinite(dayOfMonth) ? dayOfMonth : 0,
      monthShort: formatDateTime(noon, 'MMM', timeZone, ''),
    });
  }

  return result;
}

/** True when any warehouse-local day touched by the closure has a booking. */
export function hasBookingConflict(
  startTime: string,
  endTime: string,
  bookedDates: Map<string, number>,
  timeZone?: string,
): boolean {
  if (!startTime || !endTime) return false;

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return false;
  }

  const startKey = toDateKeyInTimeZone(startDate, timeZone);
  const endKey = toDateKeyInTimeZone(endDate, timeZone);
  if (!startKey || !endKey || startKey > endKey) return false;

  for (let key = startKey; key <= endKey; key = shiftDateKey(key, 1)) {
    if (bookedDates.has(key)) return true;
    if (!key) break;
  }

  return false;
}

/** Picks the first day in the next two weeks without an active booking. */
export function findFirstAvailableClosureDate(
  bookings: Booking[],
  dockId: number,
  timeZone?: string,
): ClosureDateSuggestion {
  const bookedDates = new Set(getBookedDatesForDock(bookings, dockId, timeZone).keys());

  const todayKey = toDateKeyInTimeZone(new Date(), timeZone);
  if (!todayKey) return { date: '', bookedDates };

  for (let index = 0; index < 14; index += 1) {
    const dateStr = shiftDateKey(todayKey, index);
    if (!bookedDates.has(dateStr)) {
      return { date: dateStr, bookedDates };
    }
  }

  return { date: todayKey, bookedDates };
}

/** A status may only be changed once the booked slot has started. */
export function canUpdateBookingStatus(booking: Booking | undefined): boolean {
  if (!booking?.slotStartTime) return true;
  return Date.now() >= new Date(booking.slotStartTime).getTime();
}

export interface ClosureFormInput {
  dockId: number | '';
  hasBookingConflict: boolean;
  reason: string;
  startTime: string;
  endTime: string;
}

/** Returns a user-facing validation message, or null when the closure is valid. */
export function validateClosureInput(input: ClosureFormInput): string | null {
  if (!input.dockId) {
    return 'Please select a dock to schedule maintenance.';
  }

  if (input.hasBookingConflict) {
    return 'Cannot schedule maintenance closure: an active booking exists on this dock for that day.';
  }

  if (!input.reason.trim()) {
    return 'Maintenance reason is required and cannot be blank.';
  }

  if (!input.startTime || !input.endTime) {
    return 'Both start time and end time are required.';
  }

  const startDate = new Date(input.startTime);
  const endDate = new Date(input.endTime);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Please enter valid start and end dates.';
  }

  if (startDate.getTime() < Date.now()) {
    return 'Closure start time cannot be in the past. Please select a current or future time.';
  }

  if (endDate <= startDate) {
    return 'End time must be after the start time.';
  }

  return null;
}

/** API orchestration and derived data for the dock manager dashboard. */
export const dockManagerDashboardService = {
  async loadDashboardData(signal?: AbortSignal): Promise<DockManagerData> {
    const [bookingsResponse, warehousesResponse] = await Promise.all([
      bookingApi.getAll(signal),
      warehouseApi.getAll(signal),
    ]);

    const bookings = bookingsResponse?.data || [];
    const warehouses = warehousesResponse?.data || [];
    const allDocks = aggregateDocks(warehouses);

    let closures: DockClosure[] = [];
    let warningMessage: string | null = null;

    if (allDocks.length > 0) {
      const closureResults = await Promise.allSettled(
        allDocks.map((dock) => warehouseApi.getDockClosures(dock.id, signal)),
      );

      closureResults.forEach((response, index) => {
        if (response.status === 'rejected') {
          warningMessage ??= getApiErrorMessage(
            response.reason,
            'Some dock closures could not be loaded.',
          );
          return;
        }

        const dock = allDocks[index];
        if (!dock || !response.value?.data) return;

        response.value.data.forEach((closure) => {
          closures.push({ ...closure, dock });
        });
      });
    }

    return { bookings, warehouses, closures, warningMessage };
  },

  async updateBookingStatus(
    bookingId: number,
    status: Extract<BookingStatus, 'ARRIVED' | 'NO_SHOW' | 'COMPLETED'>,
  ): Promise<Booking> {
    const response = await bookingApi.updateStatus(bookingId, status);
    return response.data;
  },

  async createDockClosure(
    dockId: number,
    startTime: string,
    endTime: string,
    reason: string,
  ): Promise<DockClosure> {
    const response = await warehouseApi.createDockClosure(dockId, {
      startTime,
      endTime,
      reason,
    });

    return response.data;
  },

  filterBookings(bookings: Booking[], filters: BookingFilters): Booking[] {
    return bookings.filter((booking) => {
      if (filters.warehouseId !== 'ALL') {
        const warehouseId = booking.dock?.warehouseId || booking.dock?.warehouse?.id;

        if (warehouseId !== undefined && warehouseId !== Number(filters.warehouseId)) {
          return false;
        }
      }

      if (filters.status !== 'ALL' && booking.status !== filters.status) {
        return false;
      }

      const query = filters.searchQuery.trim().toLowerCase();
      if (!query) return true;

      const searchable = [
        String(booking.id),
        booking.carrierOrg?.name || '',
        booking.truckPlate || '',
        booking.driverName || '',
        booking.driverPhone || '',
        booking.dock?.name || '',
        booking.cargoNote || '',
      ];

      return searchable.some((value) => value.toLowerCase().includes(query));
    });
  },
};
