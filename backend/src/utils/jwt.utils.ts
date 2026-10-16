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

/**
 * Signs a temporary JWT specifically for the 2FA login verification challenge.
 * Expires in 5 minutes.
 */
export function signTemp2faToken(userId: number, email: string): string {
  return jwt.sign(
    {
      userId,
      email,
      type: '2fa_temp',
    },
    securityConfig.jwtSecret,
    { expiresIn: '5m' }
  );
}

/**
 * Verifies a 2FA temporary token.
 */
export function verifyTemp2faToken(token: string): { userId: number; email: string; type: string } {
  const decoded = jwt.verify(token, securityConfig.jwtSecret) as any;
  if (!decoded || decoded.type !== '2fa_temp') {
    throw { status: 401, message: 'Invalid or expired 2FA session token.' };
  }
  return decoded;
}
