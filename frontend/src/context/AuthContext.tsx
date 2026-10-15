import React, { createContext, useState, useEffect, type ReactNode } from 'react';
import type { User } from '../types/user.types';
import { storage } from '../utils/storage';
import { authApi } from '../api/auth.api';

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  logoutAll: () => Promise<void>;
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

  const login = (newToken: string, newUser: User) => {
    storage.setToken(newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
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

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        logoutAll,
        isAuthenticated: !!token,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
