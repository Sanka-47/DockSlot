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
 * Monotonic session generation. Every explicit logout or hard expiry bumps it,
 * which lets an in-flight refresh detect that it must not restore a token into
 * a session the user already ended.
 */
let sessionEpoch = 0;

/**
 * Non-sensitive marker recording that the user explicitly ended the session.
 * It prevents a silent refresh on the next page load if the server-side logout
 * request failed (e.g. offline) and the HttpOnly refresh cookie was not cleared.
 */
export const LOGGED_OUT_STORAGE_KEY = 'dockslot_logged_out';

const AUTH_CHANNEL_NAME = 'dockslot-auth';
type AuthChannelMessage = { type: 'logout' };

let authChannel: BroadcastChannel | null = null;

function getAuthChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }

  if (!authChannel) {
    try {
      authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    } catch {
      // Some sandboxed/private contexts disallow BroadcastChannel; the storage
      // event (or the local marker) remains the fallback.
      return null;
    }
  }

  return authChannel;
}

function broadcastLogout(): void {
  try {
    getAuthChannel()?.postMessage({ type: 'logout' } satisfies AuthChannelMessage);
  } catch {
    // Cross-tab notification is best-effort; the storage marker remains the
    // source of truth for the next page load.
  }
}

export function markSessionLoggedOut(): void {
  accessToken = null;
  sessionEpoch += 1;

  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(LOGGED_OUT_STORAGE_KEY, '1');
  } catch {
    // Storage may be unavailable; the in-memory session is still cleared.
  }

  broadcastLogout();
}

export function clearSessionLoggedOut(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LOGGED_OUT_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

export function isSessionLoggedOut(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOGGED_OUT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Subscribes to logouts initiated by another tab. Returns an unsubscribe
 * function suitable for a React effect cleanup.
 */
export function subscribeToSessionLogout(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === LOGGED_OUT_STORAGE_KEY && event.newValue === '1') {
      listener();
    }
  };

  const channel = getAuthChannel();
  const handleMessage = (event: MessageEvent<AuthChannelMessage>) => {
    if (event.data?.type === 'logout') {
      listener();
    }
  };

  window.addEventListener('storage', handleStorage);
  channel?.addEventListener('message', handleMessage);

  return () => {
    window.removeEventListener('storage', handleStorage);
    channel?.removeEventListener('message', handleMessage);
  };
}

export const authToken = {
  getToken: (): string | null => accessToken,

  setToken: (token: string): void => {
    accessToken = token;
  },

  /** Increments on every logout/hard-expiry so stale refreshes can be ignored. */
  getEpoch: (): number => sessionEpoch,

  clear: (): void => {
    accessToken = null;
    sessionEpoch += 1;
  },
};

export default authToken;
