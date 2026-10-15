import apiClient from './client';
import type { User } from '../types/user.types';

export interface InviteUserRequest {
  email: string;
}

export interface InviteUserResponse {
  success: boolean;
  message: string;
  data?: any;
}

export const userApi = {
  getUsers: async (): Promise<{ success: boolean; data: User[] }> => {
    const response = await apiClient.get<{ success: boolean; data: User[] }>('/users');
    return response.data;
  },

  deactivateUser: async (userId: number): Promise<{ success: boolean; message: string; data?: User }> => {
    const response = await apiClient.patch<{ success: boolean; message: string; data?: User }>(`/users/${userId}/deactivate`);
    return response.data;
  },

  reactivateUser: async (userId: number): Promise<{ success: boolean; message: string; data?: User }> => {
    const response = await apiClient.patch<{ success: boolean; message: string; data?: User }>(`/users/${userId}/reactivate`);
    return response.data;
  },

  inviteUser: async (data: InviteUserRequest): Promise<InviteUserResponse> => {
    const response = await apiClient.post<InviteUserResponse>('/users/invite', data);
    return response.data;
  },
};

export default userApi;
