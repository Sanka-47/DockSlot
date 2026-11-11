import { authApi } from '../api/auth.api';
import { authToken, isSessionLoggedOut } from '../utils/authToken';
import type { User } from '../types/user.types';

/** A session restored from the HttpOnly refresh cookie. */
export interface RestoredSession {
  token: string;
  user: User;
}

/**
 * Single-flight guard: React StrictMode (and rapid remounts) can invoke the
 * restore effect more than once. Sharing the in-flight request avoids rotating
 * the refresh cookie concurrently.
 */
let restorePromise: Promise<RestoredSession | null> | null = null;

async function fetchRestoredSession(): Promise<RestoredSession | null> {
  // Respect an explicit logout even if the server call could not reach the API.
  if (isSessionLoggedOut()) {
    return null;
  }

  try {
    const response = await authApi.refresh();
    const token = response.token ?? response.data?.token;
    const user = response.user ?? response.data?.user;

    if (!token || !user) {
      authToken.clear();
      return null;
    }

    authToken.setToken(token);
    return { token, user };
  } catch {
    // No valid refresh cookie, or it was revoked/expired. The backend also
    // clears the stale cookie, so the browser simply remains signed out.
    authToken.clear();
    return null;
  }
}

/** Session/data operations used by the auth context provider. */
export const authContextService = {
  /**
   * Restores the access token from the HttpOnly refresh cookie. Returns null
   * when there is no active session.
   */
  restoreSession(): Promise<RestoredSession | null> {
    if (!restorePromise) {
      restorePromise = fetchRestoredSession().finally(() => {
        restorePromise = null;
      });
    }
    return restorePromise;
  },

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
