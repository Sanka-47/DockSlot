import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUS_FILTERS,
  BOOKING_STATUS_META,
  getBookingStatusMeta,
  isActiveBookingStatus,
} from './bookingStatus';

describe('booking status metadata', () => {
  it('exposes one display definition per known status', () => {
    expect(Object.keys(BOOKING_STATUS_META)).toEqual([
      'BOOKED',
      'ARRIVED',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ]);
    expect(getBookingStatusMeta('NO_SHOW')).toMatchObject({
      label: 'NO-SHOW',
      icon: 'alert',
    });
  });

  it('preserves unknown statuses instead of hiding them', () => {
    expect(getBookingStatusMeta('PENDING')).toMatchObject({
      label: 'PENDING',
      badgeClassName: 'bg-gray-100 text-gray-700 border-gray-300',
    });
    expect(getBookingStatusMeta('PENDING').icon).toBeUndefined();
  });

  it('marks only booked and arrived as active', () => {
    expect(isActiveBookingStatus('BOOKED')).toBe(true);
    expect(isActiveBookingStatus('ARRIVED')).toBe(true);
    expect(isActiveBookingStatus('COMPLETED')).toBe(false);
    expect(isActiveBookingStatus('CANCELLED')).toBe(false);
    expect(isActiveBookingStatus('NO_SHOW')).toBe(false);
  });

  it('keeps the filter order and labels stable for both dashboards', () => {
    expect(BOOKING_STATUS_FILTERS.map(({ value }) => value)).toEqual([
      'ALL',
      'BOOKED',
      'ARRIVED',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ]);
    expect(BOOKING_STATUS_FILTERS.find(({ value }) => value === 'BOOKED')?.label).toBe(
      'BOOKED (Incoming)',
    );
  });
});
