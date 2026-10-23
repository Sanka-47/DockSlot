import { bookingApi } from "../api/booking.api";
import { warehouseApi } from "../api/warehouse.api";
import type { Booking, BookingStatus } from "../types/booking.types";
import type { Dock, DockClosure, Warehouse } from "../types/warehouse.types";

export type DockWithWarehouse = Dock & { warehouseName: string };

export interface DockManagerData {
  bookings: Booking[];
  warehouses: Warehouse[];
  closures: DockClosure[];
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

/** Local `YYYY-MM-DD` key used by the closure calendar. */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function aggregateDocks(warehouses: Warehouse[]): DockWithWarehouse[] {
  const docks: DockWithWarehouse[] = [];

  warehouses.forEach((warehouse) => {
    warehouse.docks?.forEach((dock) => {
      docks.push({ ...dock, warehouseName: warehouse.name });
    });
  });

  return docks;
}

/** Map of local date -> number of active bookings on the selected dock. */
export function getBookedDatesForDock(
  bookings: Booking[],
  dockId: number
): Map<string, number> {
  const datesMap = new Map<string, number>();
  if (!dockId) return datesMap;

  bookings.forEach((booking) => {
    const bookingDockId = booking.dockId ?? booking.dock?.id;
    const isActive =
      booking.status === "BOOKED" || booking.status === "ARRIVED";

    if (bookingDockId !== dockId || !isActive) return;

    const dateStr = toLocalDateKey(new Date(booking.slotStartTime));
    datesMap.set(dateStr, (datesMap.get(dateStr) || 0) + 1);
  });

  return datesMap;
}

/** Next `days` calendar days, starting today, for the closure quick-picker. */
export function getUpcomingDays(days: number = 14): UpcomingDay[] {
  const result: UpcomingDay[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let index = 0; index < days; index += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + index);

    result.push({
      dateStr: toLocalDateKey(date),
      dayOfWeekShort: date.toLocaleDateString("en-US", { weekday: "short" }),
      dayOfMonth: date.getDate(),
      monthShort: date.toLocaleDateString("en-US", { month: "short" }),
    });
  }

  return result;
}

/** True when any day touched by the closure window already has a booking. */
export function hasBookingConflict(
  startTime: string,
  endTime: string,
  bookedDates: Map<string, number>
): boolean {
  if (!startTime || !endTime) return false;

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return false;
  }

  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (cursor <= end) {
    if (bookedDates.has(toLocalDateKey(cursor))) return true;
    cursor.setDate(cursor.getDate() + 1);
  }

  return false;
}

/** Picks the first day in the next two weeks without an active booking. */
export function findFirstAvailableClosureDate(
  bookings: Booking[],
  dockId: number
): ClosureDateSuggestion {
  const bookedDates = new Set(
    getBookedDatesForDock(bookings, dockId).keys()
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let index = 0; index < 14; index += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const dateStr = toLocalDateKey(date);

    if (!bookedDates.has(dateStr)) {
      return { date: dateStr, bookedDates };
    }
  }

  return { date: toLocalDateKey(today), bookedDates };
}

/** A status may only be changed once the booked slot has started. */
export function canUpdateBookingStatus(booking: Booking | undefined): boolean {
  if (!booking?.slotStartTime) return true;
  return new Date() >= new Date(booking.slotStartTime);
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

  if (startDate < new Date()) {
    return 'Closure start time cannot be in the past. Please select a current or future time.';
  }

  if (endDate <= startDate) {
    return 'End time must be after the start time.';
  }

  return null;
}

/** API orchestration and derived data for the dock manager dashboard. */
export const dockManagerDashboardService = {
  async loadDashboardData(): Promise<DockManagerData> {
    const [bookingsResponse, warehousesResponse] = await Promise.all([
      bookingApi.getAll(),
      warehouseApi.getAll(),
    ]);

    const bookings = bookingsResponse?.data || [];
    const warehouses = warehousesResponse?.data || [];
    const allDocks = aggregateDocks(warehouses);

    let closures: DockClosure[] = [];
    if (allDocks.length > 0) {
      const closureResults = await Promise.all(
        allDocks.map((dock) =>
          warehouseApi.getDockClosures(dock.id).catch(() => null)
        )
      );

      closureResults.forEach((response, index) => {
        if (!response?.data) return;

        const dock = allDocks[index];
        response.data.forEach((closure) => {
          closures.push({ ...closure, dock });
        });
      });
    }

    return { bookings, warehouses, closures };
  },

  async updateBookingStatus(
    bookingId: number,
    status: Extract<BookingStatus, "ARRIVED" | "NO_SHOW" | "COMPLETED">
  ): Promise<Booking> {
    const response = await bookingApi.updateStatus(bookingId, status);
    return response.data;
  },

  async createDockClosure(
    dockId: number,
    startTime: string,
    endTime: string,
    reason: string
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
      if (filters.warehouseId !== "ALL") {
        const warehouseId =
          booking.dock?.warehouseId || booking.dock?.warehouse?.id;

        if (
          warehouseId !== undefined &&
          warehouseId !== Number(filters.warehouseId)
        ) {
          return false;
        }
      }

      if (filters.status !== "ALL" && booking.status !== filters.status) {
        return false;
      }

      const query = filters.searchQuery.trim().toLowerCase();
      if (!query) return true;

      const searchable = [
        String(booking.id),
        booking.carrierOrg?.name || "",
        booking.truckPlate || "",
        booking.driverName || "",
        booking.driverPhone || "",
        booking.dock?.name || "",
        booking.cargoNote || "",
      ];

      return searchable.some((value) => value.toLowerCase().includes(query));
    });
  },
};
