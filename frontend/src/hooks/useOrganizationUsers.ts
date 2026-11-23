import { useCallback, useEffect, useState } from 'react';
import type { User } from '../types/user.types';
import { getApiErrorMessage } from '../services/errors';

/**
 * The user-management API surface shared by carrier and warehouse admins.
 * Both dashboards expose the same invite/deactivate/reactivate workflow, so the
 * state and refresh rules live here instead of being copied into each page.
 */
export interface OrganizationUsersService {
  fetchUsers(): Promise<User[]>;
  inviteUser(email: string): Promise<{ message: string }>;
  deactivateUser(userId: number): Promise<{ message: string }>;
  reactivateUser(userId: number): Promise<{ message: string }>;
}

interface UseOrganizationUsersOptions {
  service: OrganizationUsersService;
  setErrorBanner: (message: string | null) => void;
  initialLoading?: boolean;
}

export function useOrganizationUsers({
  service,
  setErrorBanner,
  initialLoading = true,
}: UseOrganizationUsersOptions) {
  const [organizationUsers, setOrganizationUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(initialLoading);
  const [deactivatingUserId, setDeactivatingUserId] = useState<number | null>(null);
  const [reactivatingUserId, setReactivatingUserId] = useState<number | null>(null);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [isSendingInvite, setIsSendingInvite] = useState<boolean>(false);

  const fetchUsers = useCallback(async (): Promise<User[]> => {
    setIsLoadingUsers(true);
    try {
      const users = await service.fetchUsers();
      setOrganizationUsers(users);
      return users;
    } catch (error: unknown) {
      setErrorBanner(getApiErrorMessage(error, 'Failed to load organization team members.'));
      return [];
    } finally {
      setIsLoadingUsers(false);
    }
  }, [service, setErrorBanner]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const inviteUser = useCallback(
    async (email: string): Promise<{ message: string }> => {
      setIsSendingInvite(true);
      try {
        const result = await service.inviteUser(email);
        setInviteEmail('');
        setIsInviteModalOpen(false);
        await fetchUsers();
        return result;
      } finally {
        setIsSendingInvite(false);
      }
    },
    [service, fetchUsers],
  );

  const deactivateUser = useCallback(
    async (userId: number): Promise<{ message: string }> => {
      setDeactivatingUserId(userId);
      try {
        const result = await service.deactivateUser(userId);
        await fetchUsers();
        return result;
      } finally {
        setDeactivatingUserId(null);
      }
    },
    [service, fetchUsers],
  );

  const reactivateUser = useCallback(
    async (userId: number): Promise<{ message: string }> => {
      setReactivatingUserId(userId);
      try {
        const result = await service.reactivateUser(userId);
        await fetchUsers();
        return result;
      } finally {
        setReactivatingUserId(null);
      }
    },
    [service, fetchUsers],
  );

  return {
    organizationUsers,
    isLoadingUsers,
    deactivatingUserId,
    reactivatingUserId,
    isInviteModalOpen,
    setIsInviteModalOpen,
    inviteEmail,
    setInviteEmail,
    isSendingInvite,
    fetchUsers,
    inviteUser,
    deactivateUser,
    reactivateUser,
  };
}
