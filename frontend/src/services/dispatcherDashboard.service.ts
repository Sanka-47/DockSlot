import { bookingApi } from "../api/booking.api";
import { warehouseApi } from "../api/warehouse.api";
import type {
  AvailableDockSlots,
  AvailableSlot,
  Warehouse,
} from "../types/warehouse.types";
import type {
  Booking,
  CreateBookingRequest,
} from "../types/booking.types";
import { formatDateTime } from "../utils/formatters";
import { getApiErrorMessage } from "./errors";

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

export interface BookingFilters {
  status: string;
  searchQuery: string;
}

/**
 * Formats a date as `YYYY-MM-DD` in the warehouse's time zone. Falls back to the
 * browser's local date when the identifier is missing or invalid.
 */
export function formatDateInTimezone(
  dateInput: Date | string | number,
  timeZone?: string
): string {
  const dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput);

  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(dateObj);
    } catch {
      // Fall through to the browser-local fallback for invalid identifiers.
    }
  }

  const local = new Date(
    dateObj.getTime() - dateObj.getTimezoneOffset() * 60000
  );
  return local.toISOString().slice(0, 10);
}

export function getTodayDateString(timeZone?: string): string {
  return formatDateInTimezone(new Date(), timeZone);
}

export function getMaxAdvanceDateString(
  days: number = 14,
  timeZone?: string
): string {
  const futureInstant = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return formatDateInTimezone(futureInstant, timeZone);
}

/** Checks that a slot's UTC start instant is still in the future. */
export function isFutureSlot(slot: AvailableSlot): boolean {
  if (!slot?.slotStartTime) return false;

  const slotStartMs = new Date(slot.slotStartTime).getTime();
  if (Number.isNaN(slotStartMs)) return false;

  return slotStartMs > Date.now();
}

/**
 * Renders a warehouse-local `HH:mm` boundary as a 12-hour clock label.
 * Overnight windows roll past midnight ("25:30"), so the value is wrapped back
 * into the same day before formatting.
 */
export function formatSlotClock(timeStr?: string): string | null {
  if (!timeStr) return null;

  const [hoursStr, minutesStr = "0"] = timeStr.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const totalMinutes = (((hours * 60 + minutes) % 1440) + 1440) % 1440;
  const normalizedHours = Math.floor(totalMinutes / 60);
  const normalizedMinutes = totalMinutes % 60;
  const period = normalizedHours >= 12 ? "PM" : "AM";
  const twelveHour = normalizedHours % 12 === 0 ? 12 : normalizedHours % 12;

  return `${twelveHour}:${String(normalizedMinutes).padStart(2, "0")} ${period}`;
}

/**
 * Slots are generated in the warehouse's own time zone. Prefer the local
 * start/end returned by the API so a dispatcher abroad sees the dock's clock;
 * the browser's clock is only a fallback for older API responses.
 */
export function formatSlotWindow(slot: {
  slotStartTime: string;
  slotEndTime: string;
  localStartTime?: string;
  localEndTime?: string;
}): string {
  const localStart = formatSlotClock(slot.localStartTime);
  const localEnd = formatSlotClock(slot.localEndTime);
  if (localStart && localEnd) {
    return `${localStart} - ${localEnd}`;
  }

  return `${formatDateTime(slot.slotStartTime, "h:mm a")} - ${formatDateTime(
    slot.slotEndTime,
    "h:mm a"
  )}`;
}

/** True while a booking is inside the warehouse's cancellation lock window. */
export function isInsideLockWindow(booking: Booking | null): boolean {
  if (!booking || !booking.slotStartTime) return false;

  const slotTime = new Date(booking.slotStartTime).getTime();
  const hoursUntil = (slotTime - Date.now()) / (1000 * 60 * 60);
  const lockHours =
    booking.dock?.warehouse?.policy?.bookingLockWindowHours ?? 24;

  return hoursUntil >= 0 && hoursUntil < lockHours;
}

/**
 * Normalizes both API slot shapes (grouped or flat) into grouped dock slots,
 * dropping past slots and optionally narrowing to a single dock.
 */
export function normalizeSlotResponse(
  rawData: unknown,
  dockIdFilter?: number
): AvailableDockSlots[] {
  if (!Array.isArray(rawData) || rawData.length === 0) {
    return [];
  }

  if ("slots" in rawData[0]) {
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

  if ("slotStartTime" in rawData[0]) {
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
  slotStartTime: string
): AvailableDockSlots[] | null {
  if (!groups) return groups;

  return groups.map((dockGroup) => {
    if (dockGroup.dockId !== dockId) return dockGroup;

    return {
      ...dockGroup,
      slots: dockGroup.slots.filter(
        (slot) => slot.slotStartTime !== slotStartTime
      ),
    };
  });
}

export function getBookingWarehouseTimezone(
  booking: Booking,
  warehouses: Warehouse[]
): string {
  if (booking.dock?.warehouse?.timezone) {
    return booking.dock.warehouse.timezone;
  }

  const whId = booking.dock?.warehouseId || booking.dock?.warehouse?.id;
  if (whId) {
    const matched = warehouses.find((warehouse) => warehouse.id === whId);
    if (matched?.timezone) return matched.timezone;
  }

  return "UTC";
}

export function filterBookings(
  bookings: Booking[],
  filters: BookingFilters,
  warehouses: Warehouse[]
): Booking[] {  return bookings.filter((booking) => {
    if (filters.status !== "ALL" && booking.status !== filters.status) {
      return false;
    }

    const query = filters.searchQuery.toLowerCase().trim();
    if (!query) return true;

    const searchable = [
      String(booking.id),
      booking.truckPlate || "",
      booking.driverName || "",
      booking.driverPhone || "",
      booking.dock?.name || "",
      booking.dock?.warehouse?.name || "",
      getBookingWarehouseTimezone(booking, warehouses),
      booking.cargoNote || "",
    ];

    return searchable.some((value) => value.toLowerCase().includes(query));
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
    return "Truck license plate is required.";
  }

  if (!input.driverName.trim()) {
    return "Driver name is required.";
  }

  if (!input.driverPhone.trim()) {
    return "Driver phone number is required.";
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
      address: warehouse.address || "",
      timezone: warehouse.timezone || "UTC",
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
  async fetchBookings(): Promise<Booking[]> {
    const response = await bookingApi.getAll();
    return response.data || [];
  },

  /**
   * Loads warehouses and bookings independently so one failed request does not
   * hide the other. Warehouses are reconstructed from bookings when necessary.
   */
  async loadDashboardData(): Promise<DispatcherDashboardData> {
    const [warehousesResult, bookingsResult] = await Promise.allSettled([
      warehouseApi.getAll(),
      bookingApi.getAll(),
    ]);

    let bookings: Booking[] = [];
    let errorMessage: string | null = null;

    if (bookingsResult.status === "fulfilled") {
      bookings = bookingsResult.value?.data || [];
    } else {
      errorMessage = getApiErrorMessage(
        bookingsResult.reason,
        "Failed to load bookings."
      );
    }

    if (warehousesResult.status === "fulfilled") {
      return {
        warehouses: warehousesResult.value?.data || [],
        bookings,
        errorMessage,
      };
    }

    const fallbackWarehouses = extractFallbackWarehouses(bookings);
    if (fallbackWarehouses.length > 0) {
      return { warehouses: fallbackWarehouses, bookings, errorMessage };
    }

    return {
      warehouses: [],
      bookings,
      errorMessage: getApiErrorMessage(
        warehousesResult.reason,
        errorMessage || "Failed to load warehouses."
      ),
    };
  },

  async searchAvailableSlots(
    warehouseId: number,
    targetDate: string,
    dockId?: number
  ): Promise<AvailableDockSlots[]> {
    const response = await warehouseApi.getAvailableSlots(
      warehouseId,
      targetDate,
      dockId
    );

    return normalizeSlotResponse(response.data, dockId);
  },

  async fetchRescheduleSlots(
    warehouseId: number,
    date: string
  ): Promise<AvailableDockSlots[]> {
    const response = await warehouseApi.getAvailableSlots(warehouseId, date);
    return normalizeSlotResponse(response.data);
  },

  async createBooking(payload: CreateBookingRequest): Promise<Booking> {
    const response = await bookingApi.create(payload);
    return response.data;
  },

  async rescheduleBooking(
    bookingId: number,
    slot: RescheduleSlot,
    reason?: string
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
