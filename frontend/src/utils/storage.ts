const TOKEN_KEY = 'dockslot_auth_token';
const REFRESH_TOKEN_KEY = 'dockslot_refresh_token';

/**
 * Cookie storage helper for managing JWT tokens.
 * Sets a persistent cookie with SameSite=Lax and 7-day expiration.
 */
export const setAuthCookie = (token: string, days = 7): void => {
  if (typeof document === 'undefined') return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${maxAge}; SameSite=Lax`;
};

export const getAuthCookie = (): string | null => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )\\s*${TOKEN_KEY}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

export const removeAuthCookie = (): void => {
  if (typeof document === 'undefined') return;
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
};

export const storage = {
  getToken: (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY) || getAuthCookie();
  },
  setToken: (token: string): void => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
      setAuthCookie(token);
    }
  },
  getRefreshToken: (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  setRefreshToken: (refreshToken: string): void => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
  },
  removeRefreshToken: (): void => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  },
  /**
   * Persist a fresh access token and (optionally) its rotated refresh token
   * in a single call. Used after login and after an automatic token refresh.
   */
  setTokens: (token: string, refreshToken?: string | null): void => {
    storage.setToken(token);
    if (refreshToken) {
      storage.setRefreshToken(refreshToken);
    }
  },
  removeToken: (): void => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      removeAuthCookie();
    }
  },
  clear: (): void => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
      removeAuthCookie();
    }
  },
};

export default storage;
