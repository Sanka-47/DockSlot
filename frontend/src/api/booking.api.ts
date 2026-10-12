import apiClient from './client';

export const bookingApi = {
  getAll: async () => apiClient.get('/bookings'),
  create: async (data: any) => apiClient.post('/bookings', data),
};
