import React from 'react';
import { AlertCircle, CheckCircle2, Clock, Truck, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BookingStatus } from '../types/booking.types';
import { getBookingStatusMeta, type BookingStatusIcon } from '../utils/bookingStatus';

const STATUS_ICONS: Record<BookingStatusIcon, LucideIcon> = {
  clock: Clock,
  truck: Truck,
  check: CheckCircle2,
  alert: AlertCircle,
  x: XCircle,
};

export interface BookingStatusBadgeProps {
  status: BookingStatus | string;
  className?: string;
}

export const BookingStatusBadge: React.FC<BookingStatusBadgeProps> = ({
  status,
  className = '',
}) => {
  const meta = getBookingStatusMeta(status);
  const Icon = meta.icon ? STATUS_ICONS[meta.icon] : null;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${meta.badgeClassName} ${className}`}
    >
      {Icon ? <Icon className="w-3 h-3 mr-1" aria-hidden="true" /> : null}
      {meta.label}
    </span>
  );
};

export default BookingStatusBadge;
