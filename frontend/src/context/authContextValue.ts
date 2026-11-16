import { createContext } from 'react';
import type { User } from '../types/user.types';

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
