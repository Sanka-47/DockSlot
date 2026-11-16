import type { Booking } from '../types/booking.types';

export interface BookingFilterCriteria {
  status?: string;
  searchQuery?: string;
  warehouseId?: number | string | null;
}

export interface BookingFilterOptions {
  includeWarehouseName?: boolean;
  getWarehouseTimezone?: (booking: Booking) => string | undefined;
}

function normalizeSearchValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function getBookingWarehouseId(booking: Booking): number | undefined {
  return booking.dock?.warehouseId || booking.dock?.warehouse?.id;
}

/** Text fields used by the booking search across dashboards. */
export function getBookingSearchFields(
  booking: Booking,
  options: BookingFilterOptions = {},
): string[] {
  const fields = [
    String(booking.id),
    booking.carrierOrg?.name ?? '',
    booking.truckPlate ?? '',
    booking.driverName ?? '',
    booking.driverPhone ?? '',
    booking.dock?.name ?? '',
    booking.cargoNote ?? '',
  ];

  if (options.includeWarehouseName) {
    fields.push(booking.dock?.warehouse?.name ?? '');
  }

  const timezone = options.getWarehouseTimezone?.(booking);
  if (timezone) {
    fields.push(timezone);
  }

  return fields;
}

export function matchesBookingSearch(
  booking: Booking,
  searchQuery: string | undefined,
  options: BookingFilterOptions = {},
): boolean {
  const query = normalizeSearchValue(searchQuery);
  if (!query) return true;

  return getBookingSearchFields(booking, options).some((value) =>
    normalizeSearchValue(value).includes(query),
  );
}

export function matchesBookingWarehouse(
  booking: Booking,
  warehouseId: BookingFilterCriteria['warehouseId'],
): boolean {
  if (warehouseId === undefined || warehouseId === null || warehouseId === 'ALL') {
    return true;
  }

  const targetId = typeof warehouseId === 'number' ? warehouseId : Number(warehouseId);
  const bookingWarehouseId = getBookingWarehouseId(booking);

  // Preserve the dashboard behavior: bookings without warehouse metadata are
  // kept rather than hidden by an unavailable filter.
  return bookingWarehouseId === undefined || bookingWarehouseId === targetId;
}

/** Shared status, warehouse, and text search filtering for booking tables. */
export function filterBookings(
  bookings: Booking[],
  filters: BookingFilterCriteria,
  options: BookingFilterOptions = {},
): Booking[] {
  return bookings.filter((booking) => {
    if (filters.status && filters.status !== 'ALL' && booking.status !== filters.status) {
      return false;
    }

    if (!matchesBookingWarehouse(booking, filters.warehouseId)) {
      return false;
    }

    return matchesBookingSearch(booking, filters.searchQuery, options);
  });
}
