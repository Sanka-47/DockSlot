import { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import jwt from 'jsonwebtoken';
import redis from '../config/redis';
import { securityConfig } from '../config/security.config';

/**
 * Dynamic RedisStore that always reads the current `RATE_LIMIT_WINDOW_MS`
 * from `securityConfig` on each increment operation.
 */
class ConfigurableRedisStore extends RedisStore {
  override async increment(key: string) {
    this.windowMs = securityConfig.rateLimitWindowMs;
    return super.increment(key);
  }
}

/**
 * Extracts user identifier from authenticated request (`req.user`) or Bearer token,
 * falling back to normalized client IP address (`ipKeyGenerator`).
 */
function resolveRateLimitKey(req: Request): string {
  if (req.user?.userId) {
    return `user:${req.user.userId}`;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.decode(token) as { userId?: number; id?: number } | null;
      const uid = decoded?.userId ?? decoded?.id;
      if (uid) {
        return `user:${uid}`;
      }
    } catch {
      // Ignore malformed token and fall back to IP
    }
  }

  const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  return `ip:${ipKeyGenerator(rawIp)}`;
}

/**
 * Global API Rate Limiter:
 * Restricts general API requests per user/IP to `RATE_LIMIT_API_MAX`
 * within the `RATE_LIMIT_WINDOW_MS` window using RedisStore.
 */
export const apiRateLimiter = rateLimit({
  windowMs: securityConfig.rateLimitWindowMs,
  limit: () => securityConfig.rateLimitApiMax,
  standardHeaders: true,
  legacyHeaders: true,
  statusCode: 429,
  keyGenerator: (req: Request) => resolveRateLimitKey(req),
  store: new ConfigurableRedisStore({
    sendCommand: (...args: string[]) => redis.call(...args),
    prefix: 'rl:api:',
  }),
  validate: false,
  message: {
    success: false,
    message: 'Too many API requests. Please try again later.',
  },
});

export const globalRateLimiter = apiRateLimiter;

/**
 * Booking Rate Limiter:
 * Restricts booking creation (`POST /api/bookings`) to `RATE_LIMIT_BOOKING_MAX`
 * per user within the `RATE_LIMIT_WINDOW_MS` window using RedisStore.
 */
export const bookingRateLimiter = rateLimit({
  windowMs: securityConfig.rateLimitWindowMs,
  limit: () => securityConfig.rateLimitBookingMax,
  standardHeaders: true,
  legacyHeaders: true,
  statusCode: 429,
  keyGenerator: (req: Request) => resolveRateLimitKey(req),
  store: new ConfigurableRedisStore({
    sendCommand: (...args: string[]) => redis.call(...args),
    prefix: 'rl:booking:',
  }),
  validate: false,
  message: {
    success: false,
    message: 'Too many booking requests. Please wait before creating more bookings.',
  },
});

/**
 * Authentication Rate Limiter (backward-compatible export backed by RedisStore and securityConfig).
 */
export const authRateLimiter = rateLimit({
  windowMs: securityConfig.rateLimitWindowMs,
  limit: () => securityConfig.rateLimitApiMax,
  standardHeaders: true,
  legacyHeaders: true,
  statusCode: 429,
  keyGenerator: (req: Request) => {
    const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return `ip:${ipKeyGenerator(rawIp)}`;
  },
  store: new ConfigurableRedisStore({
    sendCommand: (...args: string[]) => redis.call(...args),
    prefix: 'rl:auth:',
  }),
  validate: false,
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP address. Please try again later.',
  },
});

export default apiRateLimiter;
