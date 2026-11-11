/**
 * In-memory access-token store.
 *
 * The access token intentionally lives only in a module-scoped variable. It is
 * never written to `localStorage`, `sessionStorage`, or a JavaScript-readable
 * cookie, so an XSS payload cannot exfiltrate a long-lived credential from
 * browser storage.
 *
 * The refresh token is kept in the backend's `HttpOnly` cookie and is never
 * accessible to client-side JavaScript. A page reload starts with no access
 * token; `AuthProvider` restores the session by exchanging that cookie through
 * `POST /auth/refresh`.
 */
let accessToken: string | null = null;

/**
 * Non-sensitive marker recording that the user explicitly ended the session.
 * It prevents a silent refresh on the next page load if the server-side logout
 * request failed (e.g. offline) and the HttpOnly refresh cookie was not cleared.
 */
const LOGGED_OUT_KEY = 'dockslot_logged_out';

export function markSessionLoggedOut(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOGGED_OUT_KEY, '1');
  } catch {
    // Storage may be unavailable; the in-memory session is still cleared.
  }
}

export function clearSessionLoggedOut(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LOGGED_OUT_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

export function isSessionLoggedOut(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOGGED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export const authToken = {
  getToken: (): string | null => accessToken,

  setToken: (token: string): void => {
    accessToken = token;
  },

  clear: (): void => {
    accessToken = null;
  },
};

export default authToken;
