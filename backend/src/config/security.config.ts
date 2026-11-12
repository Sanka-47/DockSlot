import dotenv from 'dotenv';
import { validateEnv } from './env.validation';

dotenv.config();

// Fail fast before any route or middleware can use an insecure configuration.
validateEnv(process.env);

const TEST_ACCESS_SECRET = 'dockslot-test-access-secret-not-for-production';
const TEST_REFRESH_SECRET = 'dockslot-test-refresh-secret-not-for-production';
const TEST_TOTP_ENCRYPTION_KEY = Buffer.from(
  '0123456789abcdef0123456789abcdef',
  'utf8'
);

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

function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const cleaned = value.split('#')[0].trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(cleaned)) return true;
  if (['false', '0', 'no', 'off'].includes(cleaned)) return false;
  return fallback;
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

const TOTP_KEY_PLACEHOLDER = 'replace-with-a-32-byte-base64-key';

/**
 * Decodes the TOTP encryption key. Both 64-character hex and base64 encodings
 * are accepted, but the decoded value must be exactly 32 bytes (AES-256).
 */
function parseTotpEncryptionKey(value: string | undefined): Buffer {
  const cleaned = parseEnvString(value, '');
  if (!cleaned || cleaned === TOTP_KEY_PLACEHOLDER) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TOTP_ENCRYPTION_KEY is required for production 2FA.');
    }
    return TEST_TOTP_ENCRYPTION_KEY;
  }

  const key = /^[0-9a-f]{64}$/i.test(cleaned)
    ? Buffer.from(cleaned, 'hex')
    : Buffer.from(cleaned, 'base64');

  if (key.length !== 32) {
    throw new Error('TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }

  return key;
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
  get refreshTokenTtlMs(): number {
    return parseDurationToMs(this.jwtRefreshExpiresIn, 7 * 24 * 60 * 60 * 1000);
  },
  /** Absolute lifetime of a refresh-token family, independent of sliding rotation. */
  get refreshSessionAbsoluteTtlMs(): number {
    return parseDurationToMs(
      process.env.REFRESH_SESSION_ABSOLUTE_TTL,
      30 * 24 * 60 * 60 * 1000
    );
  },
  /**
   * Optional idle timeout for a refresh-token family. Unset/empty disables the
   * idle check; the absolute family lifetime still applies.
   */
  get refreshSessionIdleTtlMs(): number | null {
    const raw = parseEnvString(process.env.REFRESH_SESSION_IDLE_TTL, '');
    if (!raw) return null;
    const parsed = parseDurationToMs(raw, 0);
    return parsed > 0 ? parsed : null;
  },
  /** Short window in which a rotated token can be retried by a concurrent tab. */
  get refreshReuseGraceMs(): number {
    return parseEnvInt(process.env.REFRESH_REUSE_GRACE_SECONDS, 30) * 1000;
  },
  get tokenVersionCacheTtlSeconds(): number {
    return parseEnvInt(process.env.TOKEN_VERSION_CACHE_TTL_SECONDS, 60);
  },
  get saltRounds(): number {
    return parseEnvInt(process.env.BCRYPT_SALT_ROUNDS, 10);
  },
  /** AES-256-GCM key used to encrypt TOTP secrets at rest. */
  get totpEncryptionKey(): Buffer {
    return parseTotpEncryptionKey(process.env.TOTP_ENCRYPTION_KEY);
  },
  /** Optional HaveIBeenPwned k-anonymity check for new passwords. */
  get passwordBreachCheckEnabled(): boolean {
    return parseEnvBoolean(process.env.PASSWORD_BREACH_CHECK_ENABLED, false);
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
  /** Independent, longer window for credential endpoints. */
  get rateLimitLoginWindowMs(): number {
    return parseEnvInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60 * 1000);
  },
  get rateLimitLoginMax(): number {
    return parseEnvInt(process.env.RATE_LIMIT_LOGIN_MAX, 10);
  },
  get rateLimitPasswordResetWindowMs(): number {
    return parseEnvInt(process.env.RATE_LIMIT_PASSWORD_RESET_WINDOW_MS, 60 * 60 * 1000);
  },
  get rateLimitPasswordResetMax(): number {
    return parseEnvInt(process.env.RATE_LIMIT_PASSWORD_RESET_MAX, 5);
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
  get RATE_LIMIT_LOGIN_WINDOW_MS(): number {
    return this.rateLimitLoginWindowMs;
  },
  get RATE_LIMIT_LOGIN_MAX(): number {
    return this.rateLimitLoginMax;
  },
  get RATE_LIMIT_PASSWORD_RESET_WINDOW_MS(): number {
    return this.rateLimitPasswordResetWindowMs;
  },
  get RATE_LIMIT_PASSWORD_RESET_MAX(): number {
    return this.rateLimitPasswordResetMax;
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
export const RATE_LIMIT_LOGIN_WINDOW_MS = securityConfig.rateLimitLoginWindowMs;
export const RATE_LIMIT_LOGIN_MAX = securityConfig.rateLimitLoginMax;
export const RATE_LIMIT_PASSWORD_RESET_WINDOW_MS = securityConfig.rateLimitPasswordResetWindowMs;
export const RATE_LIMIT_PASSWORD_RESET_MAX = securityConfig.rateLimitPasswordResetMax;
export const MAX_FAILED_LOGIN_ATTEMPTS = securityConfig.maxFailedLoginAttempts;
export const LOGIN_LOCKOUT_DURATION_MINUTES = securityConfig.loginLockoutDurationMinutes;

export default securityConfig;
