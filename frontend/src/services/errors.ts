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

/**
 * Extracts the most useful message from an Axios/API failure, falling back to
 * the caller-provided text when the server did not send one.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const err = error as ApiErrorLike | null | undefined;

  const serverMessage = err?.response?.data?.message;
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage;
  }

  if (typeof err?.message === 'string' && err.message.trim()) {
    return err.message;
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
