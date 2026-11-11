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

const strongSecret = (label: string) => `${label}-${'x'.repeat(40)}`;

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
        JWT_ACCESS_SECRET: 'replace-with-a-random-access-secret',
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

  it('accepts strong, distinct production secrets', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.dockslot.example',
        JWT_ACCESS_SECRET: strongSecret('access'),
        JWT_REFRESH_SECRET: strongSecret('refresh'),
      })
    ).not.toThrow();
  });

  it('allows the legacy JWT_SECRET outside production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        JWT_SECRET: 'local-development-only-secret',
      })
    ).not.toThrow();
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
