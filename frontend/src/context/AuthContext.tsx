import React, { createContext, useState, useEffect, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import type { User } from '../types/user.types';
import {
  authToken,
  clearSessionLoggedOut,
  markSessionLoggedOut,
  subscribeToSessionLogout,
} from '../utils/authToken';
import { authContextService } from '../services/authContext.service';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_TOKEN_REFRESHED_EVENT,
} from '../api/client';

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  /** Re-reads the current user from the server (e.g. after a 2FA change). */
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Access token lives in memory only (see utils/authToken.ts). On reload it is
  // restored from the HttpOnly refresh cookie by the effect below.
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const session = await authContextService.restoreSession();
        if (mounted && session) {
          setToken(session.token);
          setUser(session.user);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void initializeAuth();

    return () => {
      mounted = false;
    };
  }, []);

  // Keep React state in sync with session changes driven by the axios
  // interceptor: a successful silent refresh, or a hard session expiry.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTokenRefreshed = () => {
      const nextToken = authToken.getToken();
      if (nextToken) {
        setToken(nextToken);
      }
    };

    const handleSessionExpired = () => {
      authToken.clear();
      setToken(null);
      setUser(null);
    };

    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  // A logout in another tab must not leave this tab holding a live in-memory
  // access token. The storage event covers browsers without BroadcastChannel;
  // the channel covers private-mode/storage-blocked contexts.
  useEffect(
    () =>
      subscribeToSessionLogout(() => {
        authToken.clear();
        setToken(null);
        setUser(null);
      }),
    []
  );

  const login = (newToken: string, newUser: User) => {
    clearSessionLoggedOut();
    authToken.setToken(newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = async () => {
    // Clear the local session immediately; the marker prevents a reload from
    // silently restoring the session if the server cannot be reached.
    markSessionLoggedOut();
    authToken.clear();
    setToken(null);
    setUser(null);

    try {
      await authContextService.logout();
    } catch {
      toast.error(
        'Signed out on this device, but the server could not be reached. The refresh cookie will expire automatically.'
      );
    }
  };

  const logoutAll = async () => {
    try {
      // Keep the access token available while this authenticated request runs,
      // so an expired token can still be refreshed and the server-side
      // revocation can complete.
      await authContextService.logoutAll();
    } catch {
      toast.error(
        'Your local session was cleared, but the server could not be reached. Other devices may still be signed in.'
      );
    } finally {
      markSessionLoggedOut();
      authToken.clear();
      setToken(null);
      setUser(null);
    }
  };

  const refreshUser = async () => {
    if (!authToken.getToken()) return;
    try {
      const currentUser = await authContextService.getCurrentUser();
      if (currentUser) {
        setUser(currentUser);
      }
    } catch {
      // Leave existing state untouched; an expired session is handled by the 401 interceptor.
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        logoutAll,
        refreshUser,
        isAuthenticated: !!token,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
