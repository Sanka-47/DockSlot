import type { Response } from 'express';
import { childLogger } from './logger';
import { getRequestId } from './requestContext';

export const GENERIC_5XX_MESSAGE = 'Internal Server Error';

/**
 * Sends a standardized error response and guarantees internal details never leak.
 *
 * Services signal *expected*, user-facing failures by throwing a plain
 * `{ status, message }` object (typically 4xx) — those messages are safe to
 * return. Anything else (a raw `Error`, a Prisma/MySQL error, a Redis failure,
 * a coding bug) has no `status`, so it is treated as an unexpected 5xx: the real
 * error is logged server-side with the request's correlation id, and the client
 * only receives a generic message (never `error.message`, `stack`, or SQL).
 */
export function sendError(
  res: Response,
  error: unknown,
  fallbackMessage: string = GENERIC_5XX_MESSAGE
): void {
  const err = error as { status?: unknown; statusCode?: unknown; message?: unknown } | null | undefined;

  const rawStatus =
    typeof err?.status === 'number'
      ? err.status
      : typeof err?.statusCode === 'number'
        ? err.statusCode
        : 500;

  const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;

  if (status >= 500) {
    childLogger({ requestId: getRequestId() }).error(
      { err: error, status },
      'Request failed with an internal error'
    );

    res.status(status).json({
      success: false,
      message: fallbackMessage || GENERIC_5XX_MESSAGE,
    });
    return;
  }

  res.status(status).json({
    success: false,
    message:
      typeof err?.message === 'string' && err.message.length > 0
        ? err.message
        : fallbackMessage,
  });
}
