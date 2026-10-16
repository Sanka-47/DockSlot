import apiClient from './client';
import type {
  Booking,
  UpdateBookingStatusRequest,
  CreateBookingRequest,
  BookingAuditLog,
} from '../types/booking.types';

export const bookingApi = {
  getAll: async (): Promise<{ success: boolean; data: Booking[] }> => {
    const response = await apiClient.get<{ success: boolean; data: Booking[] }>('/bookings');
    return response.data;
  },

  create: async (data: CreateBookingRequest): Promise<{ success: boolean; data: Booking }> => {
    const response = await apiClient.post<{ success: boolean; data: Booking }>('/bookings', data);
    return response.data;
  },

  updateStatus: async (
    id: number,
    status: UpdateBookingStatusRequest['status']
  ): Promise<{ success: boolean; message: string; data: Booking }> => {
    const response = await apiClient.patch<{ success: boolean; message: string; data: Booking }>(
      `/bookings/${id}/status`,
      { status }
    );
    return response.data;
  },

  reschedule: async (
    id: number,
    data: { slotStartTime: string; slotEndTime: string; dockId?: number; newDockId?: number; reason?: string }
  ): Promise<{ success: boolean; message: string; data: Booking }> => {
    const effectiveDockId = data.dockId ?? data.newDockId;
    const payload = {
      ...data,
      ...(effectiveDockId !== undefined ? { dockId: effectiveDockId, newDockId: effectiveDockId } : {}),
    };
    const response = await apiClient.patch<{ success: boolean; message: string; data: Booking }>(
      `/bookings/${id}/reschedule`,
      payload
    );
    return response.data;
  },

  cancel: async (
    id: number,
    reason?: string
  ): Promise<{ success: boolean; message: string; data: Booking }> => {
    const response = await apiClient.patch<{ success: boolean; message: string; data: Booking }>(
      `/bookings/${id}/cancel`,
      { reason }
    );
    return response.data;
  },

  getAuditLog: async (
    id: number
  ): Promise<{ success: boolean; data: BookingAuditLog[] }> => {
    const response = await apiClient.get<{ success: boolean; data: BookingAuditLog[] }>(
      `/bookings/${id}/audit-log`
    );
    return response.data;
  },
};

export default bookingApi;
