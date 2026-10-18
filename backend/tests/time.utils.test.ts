import { describe, it, expect } from 'vitest';
import {
  generateTimeIntervals,
  resolveOperatingWindowMinutes,
  normalizeTimeOfDay,
  zonedDateAndTimeToUtc,
  timeStringToMinutes,
} from '../src/utils/time.utils';

describe('generateTimeIntervals', () => {
  it('generates the full day for a standard weekday window', () => {
    const intervals = generateTimeIntervals('08:00', '18:00', 30);

    expect(intervals).toHaveLength(20);
    expect(intervals[0]).toEqual({ start: '08:00', end: '08:30' });
    expect(intervals[intervals.length - 1]).toEqual({ start: '17:30', end: '18:00' });
  });

  it('generates the short Saturday window', () => {
    expect(generateTimeIntervals('08:00', '13:00', 30)).toHaveLength(10);
  });

  it('generates 45-minute slots across a 12-hour window', () => {
    const intervals = generateTimeIntervals('07:00', '19:00', 45);

    expect(intervals).toHaveLength(16);
    expect(intervals[intervals.length - 1]).toEqual({ start: '18:15', end: '19:00' });
  });

  it('drops a trailing partial interval when the window is not evenly divisible', () => {
    const intervals = generateTimeIntervals('08:00', '18:00', 45);

    expect(intervals).toHaveLength(13);
    expect(intervals[intervals.length - 1]).toEqual({ start: '17:00', end: '17:45' });
  });

  it('generates a full 24 hours for 00:00-24:00', () => {
    const intervals = generateTimeIntervals('00:00', '24:00', 45);

    expect(intervals).toHaveLength(32);
    expect(intervals[intervals.length - 1]).toEqual({ start: '23:15', end: '24:00' });
  });

  it('treats 00:00-00:00 as a 24/7 window', () => {
    expect(generateTimeIntervals('00:00', '00:00', 30)).toHaveLength(48);
  });

  it('treats a midnight close as the end of the day', () => {
    const intervals = generateTimeIntervals('08:00', '00:00', 30);

    expect(intervals).toHaveLength(32);
    expect(intervals[intervals.length - 1]).toEqual({ start: '23:30', end: '24:00' });
  });

  it('supports overnight windows that roll past midnight', () => {
    const intervals = generateTimeIntervals('22:00', '06:00', 60);

    expect(intervals).toHaveLength(8);
    expect(intervals[0]).toEqual({ start: '22:00', end: '23:00' });
    // Boundaries keep counting past midnight so they resolve to the next day's
    // UTC instant; the API normalizes them back to 05:00-06:00 for display.
    expect(intervals[intervals.length - 1]).toEqual({ start: '29:00', end: '30:00' });
    expect(normalizeTimeOfDay(intervals[intervals.length - 1].start)).toBe('05:00');
    expect(normalizeTimeOfDay(intervals[intervals.length - 1].end)).toBe('06:00');
  });

  it('returns no intervals for non-positive slot lengths', () => {
    expect(generateTimeIntervals('08:00', '18:00', 0)).toEqual([]);
    expect(generateTimeIntervals('08:00', '18:00', -30)).toEqual([]);
    expect(generateTimeIntervals('08:00', '18:00', Number.NaN)).toEqual([]);
  });
});

describe('resolveOperatingWindowMinutes', () => {
  it('keeps regular daytime windows unchanged', () => {
    expect(resolveOperatingWindowMinutes('08:00', '18:00')).toEqual({
      openMin: 480,
      closeMin: 1080,
    });
  });

  it('keeps 24:00 as 1440', () => {
    expect(resolveOperatingWindowMinutes('00:00', '24:00')).toEqual({
      openMin: 0,
      closeMin: 1440,
    });
  });

  it('rolls a midnight close to the end of the day', () => {
    expect(resolveOperatingWindowMinutes('08:00', '00:00')).toEqual({
      openMin: 480,
      closeMin: 1440,
    });
  });

  it('rolls overnight closes into the following day', () => {
    expect(resolveOperatingWindowMinutes('22:00', '06:00')).toEqual({
      openMin: 1320,
      closeMin: 1800,
    });
  });
});

describe('normalizeTimeOfDay', () => {
  it('wraps rolled-over boundaries back into 00:00-23:59', () => {
    expect(normalizeTimeOfDay('24:00')).toBe('00:00');
    expect(normalizeTimeOfDay('25:30')).toBe('01:30');
    expect(normalizeTimeOfDay('30:00')).toBe('06:00');
    expect(normalizeTimeOfDay('08:30')).toBe('08:30');
  });
});

describe('zonedDateAndTimeToUtc', () => {
  it('resolves a regular local time to UTC', () => {
    // Asia/Colombo is UTC+5:30 with no daylight saving.
    const utc = zonedDateAndTimeToUtc('2026-10-19', '08:00', 'Asia/Colombo');

    expect(utc.toISOString()).toBe('2026-10-19T02:30:00.000Z');
  });

  it('resolves 24:00 to midnight on the following day', () => {
    const utc = zonedDateAndTimeToUtc('2026-10-19', '24:00', 'Asia/Colombo');

    expect(utc.toISOString()).toBe('2026-10-19T18:30:00.000Z');
  });

  it('resolves boundaries past midnight for overnight windows', () => {
    const utc = zonedDateAndTimeToUtc('2026-10-19', '25:30', 'Asia/Colombo');

    expect(utc.toISOString()).toBe('2026-10-19T20:00:00.000Z');
  });
});

describe('timeStringToMinutes', () => {
  it('parses HH:mm and 24:00', () => {
    expect(timeStringToMinutes('00:00')).toBe(0);
    expect(timeStringToMinutes('08:30')).toBe(510);
    expect(timeStringToMinutes('24:00')).toBe(1440);
  });
});
