import pino, { Logger, LoggerOptions } from 'pino';

/**
 * Structured application logger (Pino).
 *
 * Every log line is a JSON document with the fields needed to trace a request
 * end-to-end: `requestId`, `eventId` and `bookingId` are attached by the callers
 * that know them (the HTTP middleware and the outbox worker) via `childLogger`.
 *
 * In development the stream is piped through `pino-pretty` for readability. In
 * production (and in tests) raw NDJSON is emitted, because that is what log
 * aggregators ingest - and because the pretty transport spawns a worker thread
 * that would keep the test runner alive.
 */

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/** Extra bindings present on every line, so log sources are distinguishable. */
const base: LoggerOptions['base'] = {
  service: 'dockslot-backend',
  env: process.env.NODE_ENV || 'development',
};

/**
 * Values that must never reach the log stream verbatim. Credentials arrive on
 * request headers and in webhook dispatch options, both of which are logged.
 */
const redact: LoggerOptions['redact'] = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    'headers.authorization',
    'headers.Authorization',
    'headers["idempotency-key"]',
    '*.password',
    '*.passwordHash',
    '*.token',
    '*.refreshToken',
    '*.totpSecret',
  ],
  censor: '[REDACTED]',
};

/**
 * `pino-pretty` is a devDependency, so it is absent from a production install.
 * Resolving it defensively means a misconfigured `NODE_ENV` degrades to plain
 * JSON instead of crashing the process at boot.
 */
function resolveTransport(): LoggerOptions['transport'] {
  if (isProduction || isTest) return undefined;
  if (process.env.LOG_PRETTY === 'false') return undefined;

  try {
    require.resolve('pino-pretty');
  } catch {
    return undefined;
  }

  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname,service,env',
      messageFormat: '{if requestId}[{requestId}] {end}{msg}',
    },
  };
}

export const logger: Logger = pino({
  level:
    process.env.LOG_LEVEL ||
    // Silent by default under vitest so assertion output stays readable.
    (isTest ? 'silent' : 'info'),
  base,
  redact,
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: resolveTransport(),
});

/**
 * Creates a child logger with additional context bound to every line it emits.
 *
 * Keys whose value is `undefined` are dropped rather than serialised, so logs
 * for requests without a correlation id (or events written before tracing
 * existed) stay clean instead of carrying null fields.
 */
export function childLogger(bindings: Record<string, unknown>): Logger {
  const defined = Object.entries(bindings).filter(([, value]) => value !== undefined);

  if (defined.length === 0) return logger;

  return logger.child(Object.fromEntries(defined));
}

export default logger;
