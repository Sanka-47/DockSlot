import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { childLogger } from '../utils/logger';
import { runWithRequestContext } from '../utils/requestContext';

/**
 * requestLogger
 * -------------
 * Assigns an end-to-end correlation id to every HTTP request and logs the
 * request/response pair as structured lines.
 *
 * The id comes from the inbound `X-Request-ID` header when a trusted caller
 * (mobile client, gateway, or the retrying dispatcher app) supplies one, and is
 * otherwise a fresh UUID. It is:
 *   - attached to `req.requestId`,
 *   - echoed back on the `X-Request-ID` response header,
 *   - bound into AsyncLocalStorage so services and the outbox payload can pick
 *     it up without threading it through every function signature,
 *   - and stamped on every log line the request produces.
 *
 * That is what makes a single id follow a booking from `POST /api/bookings`
 * through the MySQL outbox row to the background worker's webhook delivery.
 */

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request. Always set by `requestLogger`. */
      requestId: string;
    }
  }
}

export const REQUEST_ID_HEADER = 'X-Request-ID';

const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Only opaque, log-safe tokens are accepted. Allowing arbitrary client input
 * through would let a caller forge log lines with embedded newlines or inject
 * extra headers via the echoed response header, so anything outside this
 * character set is discarded in favour of a server-generated UUID.
 */
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._:+-]+$/;

/** The inbound correlation id if it is trustworthy, otherwise a new UUID. */
export function resolveRequestId(req: Request): string {
  const header = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const candidate = Array.isArray(header) ? header[0] : header;

  if (
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    candidate.length <= MAX_REQUEST_ID_LENGTH &&
    ACCEPTED_REQUEST_ID.test(candidate)
  ) {
    return candidate;
  }

  return uuidv4();
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = resolveRequestId(req);
  req.requestId = requestId;

  // Echo the id so a client or upstream gateway can quote it when reporting a
  // failure, and so traces can be joined across service boundaries.
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const log = childLogger({ requestId });
  const startedAt = process.hrtime.bigint();

  log.info(
    {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    },
    'HTTP request received'
  );

  // `finish` covers a completed response; `close` also fires when the client
  // hangs up early, so an aborted request still leaves a trace. The guard keeps
  // whichever arrives first from logging twice.
  let settled = false;

  const logOutcome = (event: 'finish' | 'close'): void => {
    if (settled) return;
    settled = true;

    const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;
    const status = res.statusCode;

    const fields = {
      method: req.method,
      url: req.originalUrl,
      status,
      durationMs,
      userId: req.user?.userId,
      organizationId: req.user?.organizationId,
      aborted: event === 'close' && !res.writableFinished,
    };

    const message = `HTTP ${req.method} ${req.originalUrl} -> ${status} in ${durationMs}ms`;

    if (status >= 500) {
      log.error(fields, message);
    } else if (status >= 400) {
      log.warn(fields, message);
    } else {
      log.info(fields, message);
    }
  };

  res.on('finish', () => logOutcome('finish'));
  res.on('close', () => logOutcome('close'));

  // Express invokes downstream middleware synchronously from `next()`, so the
  // whole request - controller, service, Prisma transaction - runs inside this
  // binding and `getRequestId()` resolves for any of them.
  runWithRequestContext({ requestId }, () => next());
};

export default requestLogger;
