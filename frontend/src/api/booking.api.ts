import apiClient from './client';
import type { Booking, UpdateBookingStatusRequest, CreateBookingRequest } from '../types/booking.types';

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
    data: { slotStartTime: string; slotEndTime: string; dockId?: number; reason?: string }
  ): Promise<{ success: boolean; message: string; data: Booking }> => {
    const response = await apiClient.patch<{ success: boolean; message: string; data: Booking }>(
      `/bookings/${id}/reschedule`,
      data
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
};

export default bookingApi;
