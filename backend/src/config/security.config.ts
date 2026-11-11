import dotenv from 'dotenv';
import { validateEnv } from './env.validation';

dotenv.config();

// Fail fast before any route or middleware can use an insecure configuration.
validateEnv(process.env);

const TEST_ACCESS_SECRET = 'dockslot-test-access-secret-not-for-production';
const TEST_REFRESH_SECRET = 'dockslot-test-refresh-secret-not-for-production';

/**
 * Reads the secret for the requested token type.
 *
 * Production requires dedicated secrets. Development and tests may temporarily
 * fall back to the legacy JWT_SECRET while deployments migrate.
 */
function readJwtSecret(kind: 'access' | 'refresh'): string {
  const key = kind === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET';
  const primary = parseEnvString(process.env[key], '');
  if (primary) return primary;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${key} is required when NODE_ENV=production.`);
  }

  const legacy = parseEnvString(process.env.JWT_SECRET, '');
  if (legacy) return legacy;

  if (process.env.NODE_ENV === 'test') {
    return kind === 'access' ? TEST_ACCESS_SECRET : TEST_REFRESH_SECRET;
  }

  throw new Error(`${key} (or legacy JWT_SECRET) is required.`);
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const cleaned = value.split('#')[0].trim();
  const parsed = parseInt(cleaned, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function parseEnvString(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const cleaned = value.split('#')[0].trim();
  return cleaned || fallback;
}

/**
 * Parses a duration string such as "7d", "60m", "900s" (or a raw number of
 * seconds) into milliseconds. Used to align the refresh cookie's Max-Age with
 * JWT_REFRESH_EXPIRES_IN. Falls back when the value cannot be parsed.
 */
function parseDurationToMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const cleaned = value.split('#')[0].trim();
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(cleaned);
  if (!match) return fallbackMs;

  const amount = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}

const REFRESH_SAME_SITE_VALUES = ['lax', 'strict', 'none'] as const;
type RefreshSameSite = (typeof REFRESH_SAME_SITE_VALUES)[number];

function parseSameSite(value: string | undefined, fallback: RefreshSameSite): RefreshSameSite {
  const cleaned = parseEnvString(value, fallback).toLowerCase();
  return (REFRESH_SAME_SITE_VALUES as readonly string[]).includes(cleaned)
    ? (cleaned as RefreshSameSite)
    : fallback;
}

export const securityConfig = {
  /** @deprecated Use jwtAccessSecret. Kept for backwards-compatible imports. */
  get jwtSecret(): string {
    return this.jwtAccessSecret;
  },
  get jwtAccessSecret(): string {
    return readJwtSecret('access');
  },
  get jwtRefreshSecret(): string {
    return readJwtSecret('refresh');
  },
  get jwtIssuer(): string {
    return parseEnvString(process.env.JWT_ISSUER, 'dockslot-api');
  },
  get jwtAudience(): string {
    return parseEnvString(process.env.JWT_AUDIENCE, 'dockslot-web');
  },
  /** Pinned to prevent algorithm-confusion attacks. */
  jwtAlgorithm: 'HS256' as const,
  get jwtExpiresIn(): string {
    return parseEnvString(process.env.JWT_EXPIRES_IN, '15m');
  },
  get jwtRefreshExpiresIn(): string {
    return parseEnvString(process.env.JWT_REFRESH_EXPIRES_IN, '7d');
  },
  get saltRounds(): number {
    return parseEnvInt(process.env.BCRYPT_SALT_ROUNDS, 10);
  },
  get rateLimitWindowMs(): number {
    return parseEnvInt(process.env.RATE_LIMIT_WINDOW_MS, 60000);
  },
  get rateLimitApiMax(): number {
    return parseEnvInt(process.env.RATE_LIMIT_API_MAX, 100);
  },
  get rateLimitBookingMax(): number {
    return parseEnvInt(process.env.RATE_LIMIT_BOOKING_MAX, 10);
  },
  get rateLimit2faMax(): number {
    return parseEnvInt(process.env.RATE_LIMIT_2FA_MAX, 5);
  },
  get maxFailedLoginAttempts(): number {
    return parseEnvInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS, 5);
  },
  get loginLockoutDurationMinutes(): number {
    return parseEnvInt(process.env.LOGIN_LOCKOUT_DURATION_MINUTES, 15);
  },

  // --- Refresh token HttpOnly cookie -----------------------------------------
  get refreshCookieName(): string {
    return parseEnvString(process.env.REFRESH_COOKIE_NAME, 'refreshToken');
  },
  get refreshCookiePath(): string {
    return parseEnvString(process.env.REFRESH_COOKIE_PATH, '/api/auth');
  },
  get refreshCookieMaxAgeMs(): number {
    return parseDurationToMs(this.jwtRefreshExpiresIn, 7 * 24 * 60 * 60 * 1000);
  },
  get cookieSecure(): boolean {
    const explicit = parseEnvString(process.env.COOKIE_SECURE, '');
    if (explicit) return explicit === 'true' || explicit === '1';
    return process.env.NODE_ENV === 'production';
  },
  get cookieSameSite(): RefreshSameSite {
    return parseSameSite(process.env.COOKIE_SAME_SITE, 'lax');
  },

  // Uppercase aliases matching .env variable names
  get JWT_SECRET(): string {
    return this.jwtSecret;
  },
  get JWT_ACCESS_SECRET(): string {
    return this.jwtAccessSecret;
  },
  get JWT_REFRESH_SECRET(): string {
    return this.jwtRefreshSecret;
  },
  get JWT_ISSUER(): string {
    return this.jwtIssuer;
  },
  get JWT_AUDIENCE(): string {
    return this.jwtAudience;
  },
  get JWT_EXPIRES_IN(): string {
    return this.jwtExpiresIn;
  },
  get JWT_REFRESH_EXPIRES_IN(): string {
    return this.jwtRefreshExpiresIn;
  },
  get RATE_LIMIT_WINDOW_MS(): number {
    return this.rateLimitWindowMs;
  },
  get RATE_LIMIT_API_MAX(): number {
    return this.rateLimitApiMax;
  },
  get RATE_LIMIT_BOOKING_MAX(): number {
    return this.rateLimitBookingMax;
  },
  get RATE_LIMIT_2FA_MAX(): number {
    return this.rateLimit2faMax;
  },
  get MAX_FAILED_LOGIN_ATTEMPTS(): number {
    return this.maxFailedLoginAttempts;
  },
  get LOGIN_LOCKOUT_DURATION_MINUTES(): number {
    return this.loginLockoutDurationMinutes;
  },
};

export const JWT_SECRET = securityConfig.jwtSecret;
export const JWT_ACCESS_SECRET = securityConfig.jwtAccessSecret;
export const JWT_REFRESH_SECRET = securityConfig.jwtRefreshSecret;
export const JWT_ISSUER = securityConfig.jwtIssuer;
export const JWT_AUDIENCE = securityConfig.jwtAudience;
export const JWT_ALGORITHM = securityConfig.jwtAlgorithm;
export const JWT_EXPIRES_IN = securityConfig.jwtExpiresIn;
export const JWT_REFRESH_EXPIRES_IN = securityConfig.jwtRefreshExpiresIn;
export const RATE_LIMIT_WINDOW_MS = securityConfig.rateLimitWindowMs;
export const RATE_LIMIT_API_MAX = securityConfig.rateLimitApiMax;
export const RATE_LIMIT_BOOKING_MAX = securityConfig.rateLimitBookingMax;
export const RATE_LIMIT_2FA_MAX = securityConfig.rateLimit2faMax;
export const MAX_FAILED_LOGIN_ATTEMPTS = securityConfig.maxFailedLoginAttempts;
export const LOGIN_LOCKOUT_DURATION_MINUTES = securityConfig.loginLockoutDurationMinutes;

export default securityConfig;
