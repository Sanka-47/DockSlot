import { describe, expect, it } from 'vitest';
import { formatDateKey, formatDateTime, localDateTimeToUtc } from './formatters';

describe('formatDateTime', () => {
  const instant = '2026-01-15T15:30:00.000Z';

  it.each([
    ['UTC', 'Jan 15, 2026 15:30'],
    ['Asia/Colombo', 'Jan 15, 2026 21:00'],
    ['America/New_York', 'Jan 15, 2026 10:30'],
    ['Asia/Tokyo', 'Jan 16, 2026 00:30'],
    ['Australia/Adelaide', 'Jan 16, 2026 02:00'],
  ])('formats %s in the warehouse time zone', (timeZone, expected) => {
    expect(formatDateTime(instant, 'MMM dd, yyyy HH:mm', timeZone)).toBe(expected);
  });

  it('returns a fallback instead of throwing for invalid dates', () => {
    expect(formatDateTime('not-a-date', 'yyyy-MM-dd', 'UTC')).toBe('—');
    expect(formatDateTime('not-a-date', 'yyyy-MM-dd', 'UTC', 'N/A')).toBe('N/A');
  });

  it('returns a fallback instead of throwing for invalid time zones', () => {
    expect(formatDateTime(instant, 'yyyy-MM-dd', 'Not/AZone', 'Unavailable')).toBe('Unavailable');
  });

  it('formats in browser-local time when no time zone is supplied', () => {
    expect(formatDateTime(instant, 'yyyy-MM-dd')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatDateKey', () => {
  it.each([
    ['UTC', '2026-01-15'],
    ['Asia/Colombo', '2026-01-16'],
    ['America/New_York', '2026-01-15'],
    ['Asia/Tokyo', '2026-01-16'],
  ])('uses the calendar day in %s', (timeZone, expected) => {
    expect(formatDateKey('2026-01-15T23:30:00.000Z', timeZone)).toBe(expected);
  });

  it('returns the supplied fallback for invalid input', () => {
    expect(formatDateKey('bad-date', 'UTC', 'fallback')).toBe('fallback');
  });
});

describe('localDateTimeToUtc', () => {
  it('converts warehouse wall-clock time to a UTC instant', () => {
    expect(localDateTimeToUtc('2026-01-15T09:30', 'Asia/Colombo')).toBe('2026-01-15T04:00:00.000Z');
  });

  it('respects daylight-saving transitions', () => {
    // 01:30 is still EST (UTC-5); 03:30 is EDT (UTC-4).
    expect(localDateTimeToUtc('2026-03-08T01:30', 'America/New_York')).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(localDateTimeToUtc('2026-03-08T03:30', 'America/New_York')).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('returns null for malformed values and invalid zones', () => {
    expect(localDateTimeToUtc('', 'UTC')).toBeNull();
    expect(localDateTimeToUtc('2026-01-15T09:30', 'Not/AZone')).toBeNull();
  });
});
