import { userApi } from '../api/user.api';
import type { User } from '../types/user.types';

/**
 * Shared user-management API orchestration for carrier and warehouse admins.
 * The two admin dashboards expose the same invite/deactivate/reactivate
 * operations; only their filtering and statistics differ.
 */
export const organizationUsersService = {
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
