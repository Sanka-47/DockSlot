import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { storage } from '../utils/storage';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const apiClient = axios.create({
  baseURL,
  // Required so the browser stores and sends the backend's HttpOnly refresh cookie.
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = storage.getToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Events dispatched on `window` so the React auth layer can react to session
 * changes driven by the interceptor (which lives outside React).
 */
export const AUTH_TOKEN_REFRESHED_EVENT = 'auth:token-refreshed';
export const AUTH_SESSION_EXPIRED_EVENT = 'auth:session-expired';

/** Single-flight guard so concurrent 401s trigger only one refresh request. */
let refreshPromise: Promise<string> | null = null;

/**
 * Asks the backend to exchange the HttpOnly refresh cookie for a fresh access
 * token. Uses a bare axios instance (not `apiClient`) so the call cannot
 * re-enter this interceptor. `withCredentials` makes the browser attach the
 * refresh cookie automatically; the response rotates that cookie.
 */
const refreshAccessToken = async (): Promise<string> => {
  const { data } = await axios.post(
    `${baseURL}/auth/refresh`,
    {},
    { withCredentials: true, headers: { 'Content-Type': 'application/json' } }
  );

  const token = data?.token ?? data?.data?.token;
  if (!token) {
    throw new Error('Refresh response did not include an access token.');
  }

  storage.setToken(token);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: { token } }));
  }
  return token;
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const url = original?.url || '';

    // Never try to refresh the auth handshake endpoints themselves.
    const isAuthEndpoint =
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/2fa/login-verify');

    if (status === 401 && original && !original._retry && !isAuthEndpoint) {
      original._retry = true;

      try {
        // Reuse an in-flight refresh if one is already running.
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(() => {
            refreshPromise = null;
          });
        }
        const newToken = await refreshPromise;

        if (original.headers) {
          original.headers.Authorization = `Bearer ${newToken}`;
        }
        return apiClient(original);
      } catch (refreshError) {
        // Refresh failed (expired/revoked/missing cookie): end the session and
        // make a best-effort attempt to clear the server-side cookie.
        storage.removeToken();
        axios.post(`${baseURL}/auth/logout`, {}, { withCredentials: true }).catch(() => {});
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
