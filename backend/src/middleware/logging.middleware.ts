/**
 * @deprecated Superseded by `middleware/requestLogger.ts`, which adds
 * correlation ids (`req.requestId`), structured request/response logging, and
 * propagation into the outbox payload. This module is retained as a re-export
 * so existing imports keep working, and so there is only ever one
 * implementation of `requestLogger` in the codebase.
 */
export { requestLogger, resolveRequestId, REQUEST_ID_HEADER } from './requestLogger';
export { default } from './requestLogger';
