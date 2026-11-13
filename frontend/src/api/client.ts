import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { apiBaseUrl } from '../config/env';
import { authToken, isSessionLoggedOut } from '../utils/authToken';

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  // Required so the browser stores and sends the backend's HttpOnly refresh cookie.
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Prevents concurrent 401 handlers from clearing/announcing the same expiry. */
let terminalRefreshHandled = false;

apiClient.interceptors.request.use((config) => {
  const token = authToken.getToken();
  if (token) {
    // A live token means any previous terminal-refresh cleanup is stale.
    terminalRefreshHandled = false;
    if (config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

/**
 * Events dispatched on `window` so the React auth layer can react to session
 * changes driven by the interceptor (which lives outside React). The refreshed
 * event intentionally carries no token; listeners read the in-memory store.
 */
export const AUTH_TOKEN_REFRESHED_EVENT = 'auth:token-refreshed';
export const AUTH_SESSION_EXPIRED_EVENT = 'auth:session-expired';

/** Single-flight guard so concurrent 401s trigger only one refresh request. */
let refreshPromise: Promise<string> | null = null;

function getHttpStatus(error: unknown): number | undefined {
  return (error as AxiosError | undefined)?.response?.status;
}

/**
 * A refresh failure is terminal only when the server says the refresh session
 * itself is missing, invalid, revoked, or forbidden. Network errors and 5xx
 * responses are transient and must not destroy a still-valid session.
 */
function isTerminalRefreshFailure(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 400 || status === 401 || status === 403;
}

/**
 * Asks the backend to exchange the HttpOnly refresh cookie for a fresh access
 * token. Uses a bare axios instance (not `apiClient`) so the call cannot
 * re-enter this interceptor. `withCredentials` makes the browser attach the
 * refresh cookie automatically; the response rotates that cookie.
 */
const refreshAccessToken = async (): Promise<string> => {
  // Never resurrect a session after an explicit logout, even if an in-flight
  // request receives a 401 before the UI settles.
  if (isSessionLoggedOut()) {
    throw new Error('Session was explicitly logged out.');
  }

  const epochAtStart = authToken.getEpoch();
  const { data } = await axios.post(
    `${apiBaseUrl}/auth/refresh`,
    {},
    { withCredentials: true, headers: { 'Content-Type': 'application/json' } }
  );

  // Logout (or another tab's logout) may have happened while the request was in
  // flight. Never write a token into a session that was intentionally ended.
  if (isSessionLoggedOut() || authToken.getEpoch() !== epochAtStart) {
    throw new Error('Session changed while refreshing.');
  }

  const token = data?.token ?? data?.data?.token;
  if (!token) {
    throw new Error('Refresh response did not include an access token.');
  }

  authToken.setToken(token);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_TOKEN_REFRESHED_EVENT));
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
        if (isTerminalRefreshFailure(refreshError)) {
          // Expired/revoked/missing cookie: end the session and make a
          // best-effort attempt to clear the server-side cookie. Concurrent
          // 401s share one cleanup.
          authToken.clear();
          if (!terminalRefreshHandled) {
            terminalRefreshHandled = true;
            axios
              .post(`${apiBaseUrl}/auth/logout`, {}, { withCredentials: true })
              .catch(() => {});
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
            }
          }
        }

        // Transient failures keep the session intact; the caller can retry.
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
