import React, { createContext, useState, useEffect, type ReactNode } from 'react';
import type { User } from '../types/user.types';
import { storage } from '../utils/storage';
import { authApi } from '../api/auth.api';
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
  const [token, setToken] = useState<string | null>(() => storage.getToken());
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const initializeAuth = async () => {
      const savedToken = storage.getToken();
      if (savedToken) {
        setToken(savedToken);
        try {
          const res = await authApi.getMe();
          if (res?.data) {
            setUser(res.data);
          }
        } catch {
          // Token expired or invalid
          storage.removeToken();
          setToken(null);
          setUser(null);
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
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
      storage.removeToken();
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
    storage.setToken(newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    // Best-effort: clear the server-side HttpOnly refresh cookie.
    authApi.logout().catch(() => {});
    storage.removeToken();
    setToken(null);
    setUser(null);
  };

  const logoutAll = async () => {
    try {
      await authApi.logoutAll();
    } catch {
      // Continue client cleanup even if network fails
    } finally {
      storage.removeToken();
      setToken(null);
      setUser(null);
    }
  };

  const refreshUser = async () => {
    const savedToken = storage.getToken();
    if (!savedToken) return;
    try {
      const res = await authApi.getMe();
      if (res?.data) {
        setUser(res.data);
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
