import { AsyncLocalStorage } from 'async_hooks';

/**
 * RequestContext
 * --------------
 * Ambient per-request storage used to carry the correlation id from the HTTP
 * edge (requestLogger middleware) down into services and, from there, into the
 * persisted outbox payload.
 *
 * A booking is created several call frames below the middleware and the service
 * layer has no access to the Express `req`, so the id cannot be threaded through
 * as an argument without polluting every signature. AsyncLocalStorage keeps the
 * id attached to the async execution chain instead, which also means it survives
 * `await` and Prisma transaction callbacks.
 */

export interface RequestContext {
  /** Correlation id: the inbound `X-Request-ID` or a freshly generated UUID. */
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `context` bound as the ambient request context. Everything
 * `fn` does - including promises it awaits and callbacks it registers - inherits
 * the binding.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The correlation id of the request being served, or `undefined` outside one. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** The full ambient context, or `undefined` outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
