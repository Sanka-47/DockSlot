import { authApi } from '../api/auth.api';
import type { User } from '../types/user.types';

/** Session/data operations used by the auth context provider. */
export const authContextService = {
  async getCurrentUser(): Promise<User | null> {
    const response = await authApi.getMe();
    return response.data ?? null;
  },

  /** Best-effort server logout; local cleanup is the caller's responsibility. */
  async logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch {
      // The local session is cleared regardless of network/server failures.
    }
  },

  async logoutAll(): Promise<void> {
    await authApi.logoutAll();
  },
};
