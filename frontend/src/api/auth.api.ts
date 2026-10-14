import apiClient from './client';
import type { LoginRequest, RegisterRequest, AuthResponse, User } from '../types/user.types';

export const authApi = {
  login: async (credentials: LoginRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/register', data);
    return response.data;
  },

  getMe: async (): Promise<{ success: boolean; data: User }> => {
    const response = await apiClient.get<{ success: boolean; data: User }>('/auth/me');
    return response.data;
  },
};

export default authApi;
