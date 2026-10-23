import { userApi } from '../api/user.api';
import type { User, UserRole } from '../types/user.types';

export type UserStatusFilter = 'ALL' | 'ACTIVE' | 'DEACTIVATED';
export type UserRoleFilter = 'ALL' | Extract<UserRole, 'CARRIER_ADMIN' | 'DISPATCHER'>;

export interface UserFilters {
  searchTerm: string;
  statusFilter: UserStatusFilter;
  roleFilter: UserRoleFilter;
}

export interface UserStats {
  total: number;
  active: number;
  deactivated: number;
  dispatchers: number;
  admins: number;
}

/** API orchestration and derived data for the carrier admin dashboard. */
export const carrierAdminDashboardService = {
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

  filterUsers(users: User[], filters: UserFilters): User[] {
    const query = filters.searchTerm.toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        user.email.toLowerCase().includes(query) ||
        user.role.toLowerCase().includes(query);

      const isDeactivated = user.isActive === false;
      const matchesStatus =
        filters.statusFilter === 'ALL'
          ? true
          : filters.statusFilter === 'ACTIVE'
            ? !isDeactivated
            : isDeactivated;

      const matchesRole =
        filters.roleFilter === 'ALL' ? true : user.role === filters.roleFilter;

      return matchesSearch && matchesStatus && matchesRole;
    });
  },

  computeStats(users: User[]): UserStats {
    return {
      total: users.length,
      active: users.filter((user) => user.isActive !== false).length,
      deactivated: users.filter((user) => user.isActive === false).length,
      dispatchers: users.filter((user) => user.role === 'DISPATCHER').length,
      admins: users.filter((user) => user.role === 'CARRIER_ADMIN').length,
    };
  },
};
