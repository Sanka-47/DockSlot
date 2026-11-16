import { format, isValid, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const INVALID_DATE_FALLBACK = '—';

function toValidDate(date: string | Date): Date | null {
  const parsed = typeof date === 'string' ? parseISO(date) : date;
  return isValid(parsed) ? parsed : null;
}

/**
 * Formats an instant in the requested IANA time zone. Invalid dates, invalid
 * patterns, and invalid time-zone identifiers return a safe fallback instead of
 * throwing during render.
 */
export const formatDateTime = (
  date: string | Date,
  pattern: string = 'PPpp',
  timeZone?: string,
  fallback: string = INVALID_DATE_FALLBACK,
): string => {
  if (!date) return '';
  const parsed = toValidDate(date);
  if (!parsed) return fallback;

  try {
    return timeZone ? formatInTimeZone(parsed, timeZone, pattern) : format(parsed, pattern);
  } catch {
    return fallback;
  }
};

/**
 * Returns a `YYYY-MM-DD` key in the given time zone. Invalid dates and zones
 * return the supplied fallback so callers can decide how to degrade.
 */
export const formatDateKey = (
  date: string | Date,
  timeZone?: string,
  fallback: string = '',
): string => {
  const parsed = toValidDate(date);
  if (!parsed) return fallback;

  try {
    return timeZone
      ? formatInTimeZone(parsed, timeZone, 'yyyy-MM-dd')
      : format(parsed, 'yyyy-MM-dd');
  } catch {
    return fallback;
  }
};

/**
 * Converts a warehouse-local wall-clock value (`YYYY-MM-DDTHH:mm`) into a UTC
 * ISO instant. Returns null for malformed values or invalid zones.
 */
export const localDateTimeToUtc = (dateTimeLocal: string, timeZone: string): string | null => {
  if (!dateTimeLocal || !timeZone) return null;

  try {
    const utc = fromZonedTime(dateTimeLocal, timeZone);
    return isValid(utc) ? utc.toISOString() : null;
  } catch {
    return null;
  }
};

/** Local `YYYY-MM-DD` key, used only as a last-resort fallback. */
export const toLocalDateKey = (date: Date): string => {
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Calendar key in the warehouse's time zone, falling back to browser-local. */
export const toDateKeyInTimeZone = (date: Date, timeZone?: string): string => {
  if (Number.isNaN(date.getTime())) return '';
  return formatDateKey(date, timeZone, toLocalDateKey(date));
};

/** Adds calendar days to an ISO date key without depending on the host zone. */
export const shiftDateKey = (dateKey: string, days: number): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return '';

  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
};

/**
 * Formats a date as `YYYY-MM-DD` in the warehouse's time zone. Falls back to the
 * browser's local date when the identifier is missing or invalid.
 */
export const formatDateInTimezone = (
  dateInput: Date | string | number,
  timeZone?: string,
): string => {
  const dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(dateObj.getTime())) return '';

  const zoned = formatDateKey(dateObj, timeZone);
  if (zoned) return zoned;

  // Keep the UI usable if the API supplies a legacy/invalid zone identifier.
  return formatDateKey(dateObj);
};

export const getTodayDateString = (timeZone?: string): string =>
  formatDateInTimezone(new Date(), timeZone);

export const getMaxAdvanceDateString = (days: number = 14, timeZone?: string): string => {
  const futureInstant = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return formatDateInTimezone(futureInstant, timeZone);
};

/**
 * Renders a warehouse-local `HH:mm` boundary as a 12-hour clock label.
 * Overnight windows roll past midnight ("25:30"), so the value is wrapped back
 * into the same day before formatting.
 */
export const formatSlotClock = (timeStr?: string): string | null => {
  if (!timeStr) return null;

  const [hoursStr, minutesStr = '0'] = timeStr.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const totalMinutes = (((hours * 60 + minutes) % 1440) + 1440) % 1440;
  const normalizedHours = Math.floor(totalMinutes / 60);
  const normalizedMinutes = totalMinutes % 60;
  const period = normalizedHours >= 12 ? 'PM' : 'AM';
  const twelveHour = normalizedHours % 12 === 0 ? 12 : normalizedHours % 12;

  return `${twelveHour}:${String(normalizedMinutes).padStart(2, '0')} ${period}`;
};

export interface SlotWindowInput {
  slotStartTime: string;
  slotEndTime: string;
  localStartTime?: string;
  localEndTime?: string;
}

/**
 * Slots are generated in the warehouse's own time zone. Prefer the local
 * start/end returned by the API so a dispatcher abroad sees the dock's clock;
 * the browser's clock is only a fallback for older API responses.
 */
export const formatSlotWindow = (slot: SlotWindowInput, timeZone?: string): string => {
  const localStart = formatSlotClock(slot.localStartTime);
  const localEnd = formatSlotClock(slot.localEndTime);
  if (localStart && localEnd) {
    return `${localStart} - ${localEnd}`;
  }

  return `${formatDateTime(slot.slotStartTime, 'h:mm a', timeZone)} - ${formatDateTime(
    slot.slotEndTime,
    'h:mm a',
    timeZone,
  )}`;
};

function zonedNoon(dateKey: string, timeZone?: string): Date {
  if (!timeZone) return new Date(`${dateKey}T12:00:00`);

  try {
    return fromZonedTime(`${dateKey}T12:00:00`, timeZone);
  } catch {
    return new Date(`${dateKey}T12:00:00`);
  }
}

export interface UpcomingDay {
  dateStr: string;
  dayOfWeekShort: string;
  dayOfMonth: number;
  monthShort: string;
}

/** Next `days` calendar days in the warehouse's time zone. */
export const getUpcomingDays = (days: number = 14, timeZone?: string): UpcomingDay[] => {
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
};
