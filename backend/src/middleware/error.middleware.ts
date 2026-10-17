import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/httpError';

/**
 * Terminal Express error handler for anything forwarded via `next(error)`
 * (async handler rejections, body-parser failures, middleware errors).
 *
 * Delegates to `sendError`, which logs the real error server-side and only
 * exposes a sanitized message to the client: user-facing text for deliberate
 * 4xx errors, a generic string for any 5xx.
 */
export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (res.headersSent) return;
  sendError(res, err, 'Internal Server Error');
};

export default errorHandler;
