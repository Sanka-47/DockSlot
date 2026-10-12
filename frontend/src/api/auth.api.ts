import apiClient from './client';

export const authApi = {
  login: async (credentials: any) => apiClient.post('/auth/login', credentials),
  register: async (data: any) => apiClient.post('/auth/register', data),
};
