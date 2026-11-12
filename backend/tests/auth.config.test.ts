import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { validateEnv } from '../src/config/env.validation';
import { securityConfig } from '../src/config/security.config';
import {
  signAccessToken,
  signRefreshToken,
  signTemp2faToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyTemp2faToken,
} from '../src/utils/jwt.utils';

const payload = {
  userId: 42,
  organizationId: 7,
  role: 'DISPATCHER',
  email: 'jwt-hardening@dockslot.local',
  tokenVersion: 0,
};

// Test-only values: long enough for validation, but deliberately non-secret.
const testSecretSuffix = 'x'.repeat(40);
const strongSecret = (label: string) => `${label}-${testSecretSuffix}`;
const validTotpConfigValue = '0'.repeat(64);
const placeholderAccessSecret = [
  'replace',
  'with',
  'a',
  'random',
  'access',
  'secret',
].join('-');
const legacyDevSecret = ['local', 'development', 'only'].join('-');

describe('Authentication environment validation', () => {
  it('rejects production without dedicated access and refresh secrets', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /JWT_ACCESS_SECRET is required/i
    );
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /JWT_REFRESH_SECRET is required/i
    );
  });

  it('rejects weak, reused, or legacy production secrets', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        JWT_ACCESS_SECRET: 'short',
        JWT_REFRESH_SECRET: strongSecret('refresh'),
      })
    ).toThrow(/at least 32 characters/i);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        JWT_ACCESS_SECRET: strongSecret('same'),
        JWT_REFRESH_SECRET: strongSecret('same'),
      })
    ).toThrow(/must be different/i);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        JWT_ACCESS_SECRET: strongSecret('access'),
        JWT_REFRESH_SECRET: strongSecret('refresh'),
        JWT_SECRET: strongSecret('access'),
      })
    ).toThrow(/legacy JWT_SECRET/i);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        JWT_ACCESS_SECRET: placeholderAccessSecret,
        JWT_REFRESH_SECRET: strongSecret('refresh'),
      })
    ).toThrow(/placeholder/i);
  });

  it('requires an explicit CORS allowlist and Secure cookies in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: strongSecret('access'),
        JWT_REFRESH_SECRET: strongSecret('refresh'),
      })
    ).toThrow(/CORS_ORIGIN is required/i);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        COOKIE_SECURE: 'false',
        JWT_ACCESS_SECRET: strongSecret('access'),
        JWT_REFRESH_SECRET: strongSecret('refresh'),
      })
    ).toThrow(/COOKIE_SECURE must be true/i);
  });

  it('requires a 32-byte TOTP encryption key in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        JWT_ACCESS_SECRET: strongSecret('access'),
        JWT_REFRESH_SECRET: strongSecret('refresh'),
      })
    ).toThrow(/TOTP_ENCRYPTION_KEY is required/i);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        JWT_ACCESS_SECRET: strongSecret('access'),
        JWT_REFRESH_SECRET: strongSecret('refresh'),
        TOTP_ENCRYPTION_KEY: 'not-a-32-byte-key',
      })
    ).toThrow(/TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes/i);
  });

  it('accepts strong, distinct production secrets', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        JWT_ACCESS_SECRET: strongSecret('access'),
        JWT_REFRESH_SECRET: strongSecret('refresh'),
        TOTP_ENCRYPTION_KEY: validTotpConfigValue,
      })
    ).not.toThrow();
  });

  it('allows the legacy JWT_SECRET outside production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        JWT_SECRET: legacyDevSecret,
      })
    ).not.toThrow();
  });

  it('exposes stateful refresh-session settings', () => {
    const original = {
      JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
      REFRESH_SESSION_ABSOLUTE_TTL: process.env.REFRESH_SESSION_ABSOLUTE_TTL,
      REFRESH_SESSION_IDLE_TTL: process.env.REFRESH_SESSION_IDLE_TTL,
      REFRESH_REUSE_GRACE_SECONDS: process.env.REFRESH_REUSE_GRACE_SECONDS,
      TOKEN_VERSION_CACHE_TTL_SECONDS: process.env.TOKEN_VERSION_CACHE_TTL_SECONDS,
    };

    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.REFRESH_SESSION_ABSOLUTE_TTL = '30d';
    process.env.REFRESH_SESSION_IDLE_TTL = '7d';
    process.env.REFRESH_REUSE_GRACE_SECONDS = '30';
    process.env.TOKEN_VERSION_CACHE_TTL_SECONDS = '60';

    try {
      expect(securityConfig.refreshTokenTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(securityConfig.refreshSessionAbsoluteTtlMs).toBe(
        30 * 24 * 60 * 60 * 1000
      );
      expect(securityConfig.refreshSessionIdleTtlMs).toBe(
        7 * 24 * 60 * 60 * 1000
      );
      expect(securityConfig.refreshReuseGraceMs).toBe(30 * 1000);
      expect(securityConfig.tokenVersionCacheTtlSeconds).toBe(60);

      delete process.env.REFRESH_SESSION_IDLE_TTL;
      expect(securityConfig.refreshSessionIdleTtlMs).toBeNull();
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('JWT hardening', () => {
  it('pins HS256 and includes issuer/audience claims on access tokens', () => {
    const token = signAccessToken(payload);
    const decoded = jwt.decode(token, { complete: true });

    expect(decoded?.header.alg).toBe('HS256');
    expect(decoded?.payload).toMatchObject({
      iss: securityConfig.jwtIssuer,
      aud: securityConfig.jwtAudience,
      type: 'access',
      userId: payload.userId,
    });
  });

  it('rejects an access token with the wrong issuer or audience', () => {
    const wrongAudience = jwt.sign(
      { ...payload, type: 'access' },
      securityConfig.jwtAccessSecret,
      {
        expiresIn: '5m',
        algorithm: 'HS256',
        issuer: securityConfig.jwtIssuer,
        audience: 'some-other-app',
      }
    );

    expect(() => verifyAccessToken(wrongAudience)).toThrow();
  });

  it('embeds the session jti and family id in stateful refresh tokens', () => {
    const token = signRefreshToken(payload, {
      jti: 'session-jti',
      familyId: 'token-family',
      expiresIn: 60,
    });

    expect(verifyRefreshToken(token)).toMatchObject({
      type: 'refresh',
      jti: 'session-jti',
      familyId: 'token-family',
    });
  });

  it('rejects a refresh token when an access token is expected', () => {
    expect(() => verifyAccessToken(signRefreshToken(payload))).toThrow();
  });

  it('rejects an access token when a refresh token is expected', () => {
    expect(() => verifyRefreshToken(signAccessToken(payload))).toThrow();
  });

  it('keeps 2FA challenge tokens separate from access tokens', () => {
    const tempToken = signTemp2faToken(payload.userId, payload.email);

    expect(verifyTemp2faToken(tempToken)).toMatchObject({
      userId: payload.userId,
      email: payload.email,
      type: '2fa_temp',
    });
    expect(() => verifyAccessToken(tempToken)).toThrow();
  });
});
