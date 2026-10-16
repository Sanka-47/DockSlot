import jwt from 'jsonwebtoken';
import { securityConfig } from '../config/security.config';

export interface JwtUserPayload {
  userId: number;
  organizationId: number;
  role: string;
  email: string;
  tokenVersion?: number;
  type?: 'access' | 'refresh';
}

/**
 * Signs an access JWT using `JWT_EXPIRES_IN` from securityConfig.
 */
export function signAccessToken(payload: JwtUserPayload): string {
  return jwt.sign(
    {
      userId: payload.userId,
      organizationId: payload.organizationId,
      role: payload.role,
      email: payload.email,
      tokenVersion: payload.tokenVersion ?? 0,
    },
    securityConfig.jwtSecret,
    { expiresIn: securityConfig.jwtExpiresIn as any }
  );
}

/**
 * Signs a refresh JWT using `JWT_REFRESH_EXPIRES_IN` from securityConfig.
 */
export function signRefreshToken(payload: JwtUserPayload): string {
  return jwt.sign(
    {
      userId: payload.userId,
      organizationId: payload.organizationId,
      role: payload.role,
      email: payload.email,
      tokenVersion: payload.tokenVersion ?? 0,
      type: 'refresh',
    },
    securityConfig.jwtSecret,
    { expiresIn: securityConfig.jwtRefreshExpiresIn as any }
  );
}

/**
 * Verifies a JWT signature and expiration against `securityConfig.jwtSecret`.
 */
export function verifyJwtToken<T = JwtUserPayload>(token: string): T {
  return jwt.verify(token, securityConfig.jwtSecret) as T;
}
