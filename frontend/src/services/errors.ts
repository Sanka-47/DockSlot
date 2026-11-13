/**
 * Shared API error helpers for the UI service layer.
 *
 * Keeps the "which message should the user see?" decision out of components so
 * every screen reports failures consistently.
 */

interface ApiErrorLike {
  response?: {
    status?: number;
    data?: {
      message?: unknown;
    };
  };
  message?: unknown;
}

const NETWORK_OR_AXIOS_MESSAGE =
  /network error|failed to fetch|load failed|timeout|^request failed with status code \d+$/i;

/**
 * Extracts the most useful message from an Axios/API failure, falling back to
 * the caller-provided text when the server did not send one.
 *
 * Only deliberate 4xx messages are surfaced. Unexpected 5xx bodies and raw
 * Axios/network errors are replaced by the caller's safe fallback so internal
 * details and infrastructure messages never reach the UI.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const err = error as ApiErrorLike | null | undefined;
  const status = err?.response?.status;

  if (typeof status === 'number' && status >= 500) {
    return fallback;
  }

  const serverMessage = err?.response?.data?.message;
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage;
  }

  if (typeof err?.message === 'string' && err.message.trim()) {
    const message = err.message.trim();
    if (!NETWORK_OR_AXIOS_MESSAGE.test(message)) {
      return message;
    }
  }

  return fallback;
}

/**
 * True when the backend rejected the request because the slot/dock is already
 * taken (HTTP 409 or an equivalent message from an older endpoint).
 */
export function isSlotConflictError(error: unknown): boolean {
  const err = error as ApiErrorLike | null | undefined;
  if (err?.response?.status === 409) return true;

  return /conflict|already booked|already taken|unavailable/i.test(
    getApiErrorMessage(error, '')
  );
}
