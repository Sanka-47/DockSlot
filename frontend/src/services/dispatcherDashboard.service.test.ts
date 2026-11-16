import { describe, expect, it } from 'vitest';
import type { Booking } from '../types/booking.types';
import type { AvailableDockSlots, Warehouse } from '../types/warehouse.types';
import {
  filterBookings,
  formatDateInTimezone,
  formatSlotWindow,
  getBookingWarehouseTimezone,
  normalizeSlotResponse,
  removeSlotFromGroups,
  validateBookingInput,
} from './dispatcherDashboard.service';

const warehouse: Warehouse = {
  id: 7,
  organizationId: 1,
  name: 'Colombo Hub',
  address: 'Port Road',
  timezone: 'Asia/Colombo',
  slotLengthMinutes: 60,
};

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

describe('formatDateInTimezone', () => {
  it.each([
    ['Asia/Colombo', '2026-01-16'],
    ['America/New_York', '2026-01-15'],
    ['Asia/Tokyo', '2026-01-16'],
    ['UTC', '2026-01-15'],
  ])('returns the calendar day in %s', (timeZone, expected) => {
    expect(formatDateInTimezone('2026-01-15T23:30:00.000Z', timeZone)).toBe(expected);
  });

  it('falls back to the browser-local day for invalid zone identifiers', () => {
    expect(formatDateInTimezone('2026-01-15T12:00:00.000Z', 'Not/AZone')).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('returns an empty string for invalid dates', () => {
    expect(formatDateInTimezone('not-a-date', 'UTC')).toBe('');
  });
});

describe('formatSlotWindow', () => {
  it('prefers API-provided local times', () => {
    expect(
      formatSlotWindow({
        slotStartTime: '2026-01-15T04:00:00.000Z',
        slotEndTime: '2026-01-15T05:00:00.000Z',
        localStartTime: '09:30',
        localEndTime: '10:30',
      }),
    ).toBe('9:30 AM - 10:30 AM');
  });

  it('formats UTC instants in the warehouse time zone when local times are absent', () => {
    expect(
      formatSlotWindow(
        {
          slotStartTime: '2026-01-15T04:00:00.000Z',
          slotEndTime: '2026-01-15T05:00:00.000Z',
        },
        'Asia/Colombo',
      ),
    ).toBe('9:30 AM - 10:30 AM');
  });

  it('does not throw for malformed slot times', () => {
    expect(
      formatSlotWindow({ slotStartTime: 'bad', slotEndTime: 'also-bad' }, 'Asia/Colombo'),
    ).toBe('— - —');
  });
});

describe('normalizeSlotResponse', () => {
  const futureStart = '2099-01-01T10:00:00.000Z';
  const futureEnd = '2099-01-01T11:00:00.000Z';

  it('filters grouped slots by dock and removes past slots', () => {
    const grouped: AvailableDockSlots[] = [
      {
        dockId: 3,
        dockName: 'Dock A',
        slots: [
          { slotStartTime: futureStart, slotEndTime: futureEnd },
          { slotStartTime: '2000-01-01T10:00:00.000Z', slotEndTime: '2000-01-01T11:00:00.000Z' },
        ],
      },
      {
        dockId: 4,
        dockName: 'Dock B',
        slots: [{ slotStartTime: futureStart, slotEndTime: futureEnd }],
      },
    ];

    const result = normalizeSlotResponse(grouped, 3);
    expect(result).toHaveLength(2);
    expect(result[0].slots).toHaveLength(1);
    expect(result[1].slots).toHaveLength(0);
  });

  it('groups the flat API shape by dock', () => {
    const result = normalizeSlotResponse([
      {
        dockId: 3,
        dockName: 'Dock A',
        slotStartTime: futureStart,
        slotEndTime: futureEnd,
      },
      {
        dockId: 4,
        dockName: 'Dock B',
        slotStartTime: futureStart,
        slotEndTime: futureEnd,
      },
    ]);

    expect(result.map((group) => group.dockId)).toEqual([3, 4]);
  });

  it('returns an empty list for unexpected payloads', () => {
    expect(normalizeSlotResponse(null)).toEqual([]);
    expect(normalizeSlotResponse({ slots: [] })).toEqual([]);
  });
});

describe('removeSlotFromGroups', () => {
  it('removes only the matching slot from the matching dock', () => {
    const groups: AvailableDockSlots[] = [
      {
        dockId: 3,
        dockName: 'Dock A',
        slots: [
          { slotStartTime: '2099-01-01T10:00:00.000Z', slotEndTime: '2099-01-01T11:00:00.000Z' },
          { slotStartTime: '2099-01-01T11:00:00.000Z', slotEndTime: '2099-01-01T12:00:00.000Z' },
        ],
      },
    ];

    const result = removeSlotFromGroups(groups, 3, '2099-01-01T10:00:00.000Z');
    expect(result?.[0].slots).toHaveLength(1);
    expect(result?.[0].slots[0].slotStartTime).toBe('2099-01-01T11:00:00.000Z');
  });
});

describe('filterBookings', () => {
  it('matches carrier, truck, driver, dock, and warehouse timezone', () => {
    const bookings = [makeBooking()];

    expect(
      filterBookings(bookings, { status: 'ALL', searchQuery: 'lanka' }, [warehouse]),
    ).toHaveLength(1);
    expect(
      filterBookings(bookings, { status: 'ALL', searchQuery: 'colombo' }, [warehouse]),
    ).toHaveLength(1);
    expect(
      filterBookings(bookings, { status: 'ALL', searchQuery: 'WP-1234' }, [warehouse]),
    ).toHaveLength(1);
    expect(
      filterBookings(bookings, { status: 'ALL', searchQuery: 'missing' }, [warehouse]),
    ).toHaveLength(0);
  });

  it('filters by status', () => {
    const bookings = [makeBooking(), makeBooking({ id: 43, status: 'COMPLETED' })];

    expect(
      filterBookings(bookings, { status: 'BOOKED', searchQuery: '' }, [warehouse]),
    ).toHaveLength(1);
  });
});

describe('getBookingWarehouseTimezone', () => {
  it('uses the nested dock warehouse timezone first', () => {
    expect(getBookingWarehouseTimezone(makeBooking(), [])).toBe('Asia/Colombo');
  });

  it('falls back to a matching warehouse and then UTC', () => {
    const booking = makeBooking({
      dock: {
        id: 3,
        warehouseId: 7,
        name: 'Dock A',
        status: 'ACTIVE',
      },
    });

    expect(getBookingWarehouseTimezone(booking, [warehouse])).toBe('Asia/Colombo');
    expect(getBookingWarehouseTimezone(booking, [])).toBe('UTC');
  });
});

describe('validateBookingInput', () => {
  it('requires plate, driver, and phone', () => {
    expect(validateBookingInput({ truckPlate: '', driverName: 'A', driverPhone: '1' })).toBe(
      'Truck license plate is required.',
    );
    expect(validateBookingInput({ truckPlate: 'X', driverName: '', driverPhone: '1' })).toBe(
      'Driver name is required.',
    );
    expect(validateBookingInput({ truckPlate: 'X', driverName: 'A', driverPhone: '' })).toBe(
      'Driver phone number is required.',
    );
    expect(validateBookingInput({ truckPlate: 'X', driverName: 'A', driverPhone: '1' })).toBeNull();
  });
});
