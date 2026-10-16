import dotenv from 'dotenv';

dotenv.config();

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

export const securityConfig = {
  get jwtSecret(): string {
    return parseEnvString(process.env.JWT_SECRET, 'default_secret_key');
  },
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

  // Uppercase aliases matching .env variable names
  get JWT_SECRET(): string {
    return this.jwtSecret;
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
export const JWT_EXPIRES_IN = securityConfig.jwtExpiresIn;
export const JWT_REFRESH_EXPIRES_IN = securityConfig.jwtRefreshExpiresIn;
export const RATE_LIMIT_WINDOW_MS = securityConfig.rateLimitWindowMs;
export const RATE_LIMIT_API_MAX = securityConfig.rateLimitApiMax;
export const RATE_LIMIT_BOOKING_MAX = securityConfig.rateLimitBookingMax;
export const RATE_LIMIT_2FA_MAX = securityConfig.rateLimit2faMax;
export const MAX_FAILED_LOGIN_ATTEMPTS = securityConfig.maxFailedLoginAttempts;
export const LOGIN_LOCKOUT_DURATION_MINUTES = securityConfig.loginLockoutDurationMinutes;

export default securityConfig;
