import { userApi } from '../api/user.api';
import type { User } from '../types/user.types';

/** API orchestration for the team management modal. */
export const teamManagementModalService = {
  async fetchUsers(): Promise<User[]> {
    const response = await userApi.getUsers();
    return response.data || [];
  },

  async inviteUser(email: string): Promise<{ message: string }> {
    const response = await userApi.inviteUser({ email: email.trim() });
    return {
      message: response.message || `Invitation successfully sent to ${email.trim()}.`,
    };
  },

  async deactivateUser(userId: number): Promise<{ message: string }> {
    const response = await userApi.deactivateUser(userId);
    return {
      message: response.message || 'User has been deactivated.',
    };
  },

  async reactivateUser(userId: number): Promise<{ message: string }> {
    const response = await userApi.reactivateUser(userId);
    return {
      message: response.message || 'User has been reactivated.',
    };
  },
};
