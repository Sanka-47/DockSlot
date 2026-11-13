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

function getHttpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null | undefined)?.response?.status;
}

function isTerminalRefreshFailure(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 400 || status === 401 || status === 403;
}

async function fetchRestoredSession(): Promise<RestoredSession | null> {
  // Respect an explicit logout even if the server call could not reach the API.
  if (isSessionLoggedOut()) {
    return null;
  }

  const epochAtStart = authToken.getEpoch();

  try {
    const response = await authApi.refresh();
    const token = response.token ?? response.data?.token;
    const user = response.user ?? response.data?.user;

    // Logout (or another tab's logout) may have happened during the request.
    if (isSessionLoggedOut() || authToken.getEpoch() !== epochAtStart) {
      return null;
    }

    if (!token || !user) {
      authToken.clear();
      return null;
    }

    authToken.setToken(token);
    return { token, user };
  } catch (error: unknown) {
    // Only a terminal refresh failure should invalidate the local session. A
    // network outage or 5xx must not destroy a session that may still be valid.
    if (isTerminalRefreshFailure(error)) {
      authToken.clear();
    }
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

  /** Server logout. Local cleanup is the caller's responsibility. */
  async logout(): Promise<void> {
    await authApi.logout();
  },

  async logoutAll(): Promise<void> {
    await authApi.logoutAll();
  },
};
