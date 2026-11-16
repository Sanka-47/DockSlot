import type { BookingStatus } from '../types/booking.types';

export type BookingStatusFilter = 'ALL' | BookingStatus;

export type BookingStatusIcon = 'clock' | 'truck' | 'check' | 'alert' | 'x';

export interface BookingStatusMeta {
  label: string;
  badgeClassName: string;
  icon?: BookingStatusIcon;
}

export interface BookingStatusFilterOption {
  value: BookingStatusFilter;
  shortLabel: string;
  label: string;
}

export const BOOKING_STATUS_META: Record<BookingStatus, BookingStatusMeta> = {
  BOOKED: {
    label: 'BOOKED',
    badgeClassName: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: 'clock',
  },
  ARRIVED: {
    label: 'ARRIVED',
    badgeClassName: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: 'truck',
  },
  COMPLETED: {
    label: 'COMPLETED',
    badgeClassName: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: 'check',
  },
  CANCELLED: {
    label: 'CANCELLED',
    badgeClassName: 'bg-gray-100 text-gray-600 border-gray-300',
    icon: 'x',
  },
  NO_SHOW: {
    label: 'NO-SHOW',
    badgeClassName: 'bg-rose-50 text-rose-700 border-rose-200',
    icon: 'alert',
  },
};

export const BOOKING_STATUS_FILTERS: readonly BookingStatusFilterOption[] = [
  { value: 'ALL', shortLabel: 'ALL', label: 'All Statuses' },
  { value: 'BOOKED', shortLabel: 'BOOKED', label: 'BOOKED (Incoming)' },
  { value: 'ARRIVED', shortLabel: 'ARRIVED', label: 'ARRIVED (In Yard)' },
  { value: 'COMPLETED', shortLabel: 'COMPLETED', label: 'COMPLETED' },
  { value: 'CANCELLED', shortLabel: 'CANCELLED', label: 'CANCELLED' },
  { value: 'NO_SHOW', shortLabel: 'NO_SHOW', label: 'NO_SHOW' },
];

/** Returns display metadata for a status, preserving unknown API values. */
export function getBookingStatusMeta(status: BookingStatus | string): BookingStatusMeta {
  return (
    BOOKING_STATUS_META[status as BookingStatus] ?? {
      label: status,
      badgeClassName: 'bg-gray-100 text-gray-700 border-gray-300',
    }
  );
}

/** Statuses that still occupy a dock slot for conflict detection. */
export function isActiveBookingStatus(status: BookingStatus): boolean {
  return status === 'BOOKED' || status === 'ARRIVED';
}
