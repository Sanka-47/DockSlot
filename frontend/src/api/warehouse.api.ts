import apiClient from './client';

export const warehouseApi = {
  getAll: async () => apiClient.get('/warehouses'),
  getById: async (id: number | string) => apiClient.get(`/warehouses/${id}`),
};
