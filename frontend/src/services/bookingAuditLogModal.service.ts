import { bookingApi } from '../api/booking.api';
import type { BookingAuditLog } from '../types/booking.types';

/** API orchestration for the booking audit-log modal. */
export const bookingAuditLogModalService = {
  async fetchAuditLogs(bookingId: number): Promise<BookingAuditLog[]> {
    const response = await bookingApi.getAuditLog(bookingId);
    return response.data || [];
  },
};
