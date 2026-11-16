import { describe, expect, it } from 'vitest';
import type { Booking } from '../types/booking.types';
import type { Warehouse } from '../types/warehouse.types';
import {
  aggregateDocks,
  canUpdateBookingStatus,
  findFirstAvailableClosureDate,
  getBookedDatesForDock,
  getUpcomingDays,
  hasBookingConflict,
  shiftDateKey,
  toDateKeyInTimeZone,
  validateClosureInput,
} from './dockManagerDashboard.service';

const warehouse: Warehouse = {
  id: 7,
  organizationId: 1,
  name: 'Colombo Hub',
  address: 'Port Road',
  timezone: 'Asia/Colombo',
  slotLengthMinutes: 60,
  docks: [
    { id: 3, warehouseId: 7, name: 'Dock A', status: 'ACTIVE' },
    { id: 4, warehouseId: 7, name: 'Dock B', status: 'MAINTENANCE' },
  ],
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

describe('aggregateDocks', () => {
  it('flattens docks and includes their warehouse timezone', () => {
    const docks = aggregateDocks([warehouse]);

    expect(docks).toHaveLength(2);
    expect(docks[0]).toMatchObject({
      id: 3,
      warehouseName: 'Colombo Hub',
      warehouseTimezone: 'Asia/Colombo',
    });
  });
});

describe('shiftDateKey', () => {
  it('handles month and year boundaries', () => {
    expect(shiftDateKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('returns an empty string for malformed keys', () => {
    expect(shiftDateKey('not-a-date', 1)).toBe('');
  });
});

describe('toDateKeyInTimeZone', () => {
  it.each([
    ['Asia/Colombo', '2026-01-16'],
    ['America/New_York', '2026-01-15'],
    ['Asia/Tokyo', '2026-01-16'],
    ['UTC', '2026-01-15'],
  ])('uses the warehouse calendar day in %s', (timeZone, expected) => {
    expect(toDateKeyInTimeZone(new Date('2026-01-15T23:30:00.000Z'), timeZone)).toBe(expected);
  });
});

describe('getBookedDatesForDock', () => {
  it('buckets bookings by warehouse-local date', () => {
    const booked = getBookedDatesForDock([makeBooking()], 3, 'Asia/Colombo');
    expect(booked.get('2026-01-15')).toBe(1);
  });

  it('ignores other docks and inactive bookings', () => {
    const bookings = [makeBooking({ dockId: 4 }), makeBooking({ id: 43, status: 'COMPLETED' })];

    expect(getBookedDatesForDock(bookings, 3, 'Asia/Colombo').size).toBe(0);
  });
});

describe('hasBookingConflict', () => {
  it('detects a conflict when the closure overlaps the booking day in that zone', () => {
    const booking = makeBooking();
    const colomboBooked = getBookedDatesForDock([booking], 3, 'Asia/Colombo');
    const newYorkBooked = getBookedDatesForDock([booking], 3, 'America/New_York');

    const closureStart = '2026-01-15T05:00:00.000Z';
    const closureEnd = '2026-01-15T06:00:00.000Z';

    expect(hasBookingConflict(closureStart, closureEnd, colomboBooked, 'Asia/Colombo')).toBe(true);
    expect(hasBookingConflict(closureStart, closureEnd, newYorkBooked, 'America/New_York')).toBe(
      false,
    );
  });

  it('returns false for malformed ranges', () => {
    expect(hasBookingConflict('bad', 'worse', new Map(), 'UTC')).toBe(false);
    expect(
      hasBookingConflict('2026-01-16T00:00:00.000Z', '2026-01-15T00:00:00.000Z', new Map(), 'UTC'),
    ).toBe(false);
  });
});

describe('getUpcomingDays', () => {
  it('returns consecutive warehouse-local date keys', () => {
    const days = getUpcomingDays(3, 'Asia/Colombo');

    expect(days).toHaveLength(3);
    expect(days[0].dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(shiftDateKey(days[0].dateStr, 1)).toBe(days[1].dateStr);
    expect(shiftDateKey(days[1].dateStr, 1)).toBe(days[2].dateStr);
    expect(days[0].dayOfWeekShort).not.toBe('');
    expect(days[0].dayOfMonth).toBeGreaterThan(0);
  });
});

describe('findFirstAvailableClosureDate', () => {
  it('returns a date and the booked-date set for the dock', () => {
    const suggestion = findFirstAvailableClosureDate([makeBooking()], 3, 'Asia/Colombo');

    expect(suggestion.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(suggestion.bookedDates.has('2026-01-15')).toBe(true);
  });
});

describe('validateClosureInput', () => {
  const futureStart = '2099-01-01T10:00:00.000Z';
  const futureEnd = '2099-01-01T11:00:00.000Z';

  it('rejects missing dock, conflict, blank reason, and bad ranges', () => {
    expect(
      validateClosureInput({
        dockId: '',
        hasBookingConflict: false,
        reason: 'Maintenance',
        startTime: futureStart,
        endTime: futureEnd,
      }),
    ).toContain('select a dock');

    expect(
      validateClosureInput({
        dockId: 3,
        hasBookingConflict: true,
        reason: 'Maintenance',
        startTime: futureStart,
        endTime: futureEnd,
      }),
    ).toContain('active booking');

    expect(
      validateClosureInput({
        dockId: 3,
        hasBookingConflict: false,
        reason: '   ',
        startTime: futureStart,
        endTime: futureEnd,
      }),
    ).toContain('reason is required');

    expect(
      validateClosureInput({
        dockId: 3,
        hasBookingConflict: false,
        reason: 'Maintenance',
        startTime: futureEnd,
        endTime: futureStart,
      }),
    ).toContain('End time must be after');
  });

  it('accepts a valid future closure', () => {
    expect(
      validateClosureInput({
        dockId: 3,
        hasBookingConflict: false,
        reason: 'Maintenance',
        startTime: futureStart,
        endTime: futureEnd,
      }),
    ).toBeNull();
  });
});

describe('canUpdateBookingStatus', () => {
  it('allows updates once the slot has started', () => {
    expect(canUpdateBookingStatus(makeBooking({ slotStartTime: '2000-01-01T00:00:00.000Z' }))).toBe(
      true,
    );
    expect(canUpdateBookingStatus(makeBooking({ slotStartTime: '2999-01-01T00:00:00.000Z' }))).toBe(
      false,
    );
  });

  it('allows updates when the booking has no slot time', () => {
    expect(canUpdateBookingStatus(undefined)).toBe(true);
  });
});
