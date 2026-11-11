import React, { createContext, useState, useEffect, type ReactNode } from 'react';
import type { User } from '../types/user.types';
import {
  authToken,
  clearSessionLoggedOut,
  markSessionLoggedOut,
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
  logout: () => void;
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

    const handleTokenRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<{ token?: string }>).detail;
      if (detail?.token) {
        setToken(detail.token);
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

  const login = (newToken: string, newUser: User) => {
    clearSessionLoggedOut();
    authToken.setToken(newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    // Best-effort: clear the server-side HttpOnly refresh cookie. The marker
    // ensures a reload does not silently restore the session if this fails.
    markSessionLoggedOut();
    void authContextService.logout();
    authToken.clear();
    setToken(null);
    setUser(null);
  };

  const logoutAll = async () => {
    try {
      // Keep the access token available while this authenticated request runs,
      // so an expired token can still be refreshed and the server-side
      // revocation can complete.
      await authContextService.logoutAll();
    } catch {
      // Continue client cleanup even if network fails
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
