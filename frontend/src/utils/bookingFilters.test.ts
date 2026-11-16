import { describe, expect, it } from 'vitest';
import type { Booking } from '../types/booking.types';
import { filterBookings, matchesBookingSearch, matchesBookingWarehouse } from './bookingFilters';

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 42,
    dockId: 3,
    carrierOrgId: 9,
    slotStartTime: '2026-01-15T04:00:00.000Z',
    slotEndTime: '2026-01-15T05:00:00.000Z',
    truckPlate: 'WP-1234',
    driverName: 'Nimal Perera',
    driverPhone: '+94 77 123 4567',
    cargoNote: 'Palletized freight',
    status: 'BOOKED',
    createdAt: '2026-01-01T00:00:00.000Z',
    dock: {
      id: 3,
      warehouseId: 7,
      name: 'Dock A',
      status: 'ACTIVE',
      warehouse: {
        id: 7,
        name: 'Colombo Hub',
        timezone: 'Asia/Colombo',
      },
    },
    carrierOrg: {
      id: 9,
      name: 'Lanka Freight',
      type: 'CARRIER',
    },
    ...overrides,
  };
}

describe('filterBookings', () => {
  const bookings = [
    makeBooking(),
    makeBooking({
      id: 43,
      status: 'ARRIVED',
      truckPlate: 'WP-9999',
      dock: { ...makeBooking().dock, warehouseId: 8, id: 4, name: 'Dock B' },
      carrierOrg: { id: 10, name: 'Other Carrier', type: 'CARRIER' },
    }),
    makeBooking({ id: 44, status: 'CANCELLED', truckPlate: 'CP-1111' }),
  ];

  it('filters by status while treating ALL as no filter', () => {
    expect(filterBookings(bookings, { status: 'ALL' })).toHaveLength(3);
    expect(filterBookings(bookings, { status: 'BOOKED' })).toEqual([bookings[0]]);
    expect(filterBookings(bookings, { status: 'CANCELLED' })).toEqual([bookings[2]]);
  });

  it('filters by warehouse and keeps bookings without warehouse metadata', () => {
    expect(filterBookings(bookings, { warehouseId: '7' })).toEqual([bookings[0], bookings[2]]);
    expect(filterBookings(bookings, { warehouseId: '8' })).toEqual([bookings[1]]);
    expect(filterBookings(bookings, { warehouseId: 'ALL' })).toHaveLength(3);

    const bookingWithoutWarehouse = makeBooking({
      dock: { id: 5, warehouseId: 0, name: 'Dock C', status: 'ACTIVE' },
    });
    expect(matchesBookingWarehouse(bookingWithoutWarehouse, '7')).toBe(true);
  });

  it('searches all shared fields case-insensitively', () => {
    expect(matchesBookingSearch(bookings[0], 'lanka freight')).toBe(true);
    expect(matchesBookingSearch(bookings[0], 'wp-1234')).toBe(true);
    expect(matchesBookingSearch(bookings[0], 'dock a')).toBe(true);
    expect(matchesBookingSearch(bookings[0], 'palletized')).toBe(true);
    expect(matchesBookingSearch(bookings[0], 'missing')).toBe(false);
  });

  it('includes warehouse name and timezone only when requested', () => {
    const options = {
      includeWarehouseName: true,
      getWarehouseTimezone: (booking: Booking) => booking.dock?.warehouse?.timezone,
    };

    expect(matchesBookingSearch(bookings[0], 'colombo')).toBe(false);
    expect(matchesBookingSearch(bookings[0], 'colombo', options)).toBe(true);
    expect(matchesBookingSearch(bookings[0], 'asia/colombo', options)).toBe(true);
  });

  it('combines warehouse, status, and search filters', () => {
    expect(
      filterBookings(bookings, {
        warehouseId: '7',
        status: 'BOOKED',
        searchQuery: 'nimal',
      }),
    ).toEqual([bookings[0]]);
  });
});
