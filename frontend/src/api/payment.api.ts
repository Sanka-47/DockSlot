import apiClient from './client';
import type { CheckoutSession, PaymentStatusResponse } from '../types/booking.types';

export const paymentApi = {
  createCheckout: async (
    bookingId: number,
  ): Promise<{ success: boolean; message: string; data: CheckoutSession }> => {
    const response = await apiClient.post<{
      success: boolean;
      message: string;
      data: CheckoutSession;
    }>(`/payments/bookings/${bookingId}/checkout`);
    return response.data;
  },

  getBookingStatus: async (
    bookingId: number,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; data: PaymentStatusResponse }> => {
    const response = await apiClient.get<{ success: boolean; data: PaymentStatusResponse }>(
      `/payments/bookings/${bookingId}`,
      { signal },
    );
    return response.data;
  },

  getSessionStatus: async (
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; data: PaymentStatusResponse }> => {
    const response = await apiClient.get<{ success: boolean; data: PaymentStatusResponse }>(
      `/payments/sessions/${encodeURIComponent(sessionId)}`,
      { signal },
    );
    return response.data;
  },
};

export default paymentApi;
