import apiClient from './client';
import type {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  User,
  TwoFactorStatus,
  TwoFactorSetupResponse,
  TwoFactorVerifyRequest,
  TwoFactorDisableRequest,
  TwoFactorLoginVerifyRequest,
} from '../types/user.types';

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

  forgotPassword: async (email: string): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post<{ success: boolean; message: string }>('/auth/forgot-password', { email });
    return response.data;
  },

  resetPassword: async (token: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post<{ success: boolean; message: string }>('/auth/reset-password', { token, newPassword });
    return response.data;
  },

  logoutAll: async (): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post<{ success: boolean; message: string }>('/auth/logout-all');
    return response.data;
  },

  acceptInvite: async (
    token: string,
    password: string
  ): Promise<{ success: boolean; message: string; data?: any; token?: string; user?: User }> => {
    const response = await apiClient.post('/auth/accept-invite', { token, password });
    return response.data;
  },

  getInvitationDetails: async (
    token: string
  ): Promise<{ success: boolean; data: { email: string; role: string; organizationName?: string } }> => {
    const response = await apiClient.get('/auth/invitation', { params: { token } });
    return response.data;
  },

  /* ---------------- Two-Factor Authentication (TOTP) ---------------- */

  get2FAStatus: async (): Promise<{ success: boolean; data: TwoFactorStatus }> => {
    const response = await apiClient.get<{ success: boolean; data: TwoFactorStatus }>('/auth/2fa/status');
    return response.data;
  },

  setup2FA: async (): Promise<{
    success: boolean;
    message: string;
    data: TwoFactorSetupResponse;
    secret?: string;
    qrCode?: string;
    otpauthUrl?: string;
  }> => {
    const response = await apiClient.post('/auth/2fa/setup');
    return response.data;
  },

  verifyAndEnable2FA: async (
    payload: TwoFactorVerifyRequest
  ): Promise<{ success: boolean; message: string; isTwoFactorEnabled: boolean }> => {
    const response = await apiClient.post('/auth/2fa/verify-and-enable', payload);
    return response.data;
  },

  disable2FA: async (
    payload: TwoFactorDisableRequest
  ): Promise<{ success: boolean; message: string; isTwoFactorEnabled: boolean }> => {
    const response = await apiClient.post('/auth/2fa/disable', payload);
    return response.data;
  },

  verify2FALogin: async (payload: TwoFactorLoginVerifyRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/2fa/login-verify', payload);
    return response.data;
  },
};

export default authApi;
