import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { securityConfig } from '../config/security.config';

export type JwtTokenType = 'access' | 'refresh' | '2fa_temp';

export interface JwtUserPayload {
  userId: number;
  organizationId: number;
  role: string;
  email: string;
  tokenVersion?: number;
  type?: JwtTokenType;
}

const algorithm = securityConfig.jwtAlgorithm;

function verifyOptions(): jwt.VerifyOptions {
  return {
    algorithms: [algorithm],
    issuer: securityConfig.jwtIssuer,
    audience: securityConfig.jwtAudience,
  };
}

function signOptions(expiresIn: string): SignOptions {
  return {
    expiresIn: expiresIn as SignOptions['expiresIn'],
    algorithm,
    issuer: securityConfig.jwtIssuer,
    audience: securityConfig.jwtAudience,
  };
}

/**
 * Signs an access JWT using `JWT_EXPIRES_IN` and the dedicated access secret.
 */
export function signAccessToken(payload: JwtUserPayload): string {
  return jwt.sign(
    {
      userId: payload.userId,
      organizationId: payload.organizationId,
      role: payload.role,
      email: payload.email,
      tokenVersion: payload.tokenVersion ?? 0,
      type: 'access',
    },
    securityConfig.jwtAccessSecret,
    signOptions(securityConfig.jwtExpiresIn)
  );
}

/**
 * Signs a refresh JWT using `JWT_REFRESH_EXPIRES_IN` and the dedicated refresh
 * secret. The `type` claim prevents it from being accepted as an access token.
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
    securityConfig.jwtRefreshSecret,
    signOptions(securityConfig.jwtRefreshExpiresIn)
  );
}

/**
 * Verifies an access JWT, including issuer, audience and the pinned algorithm.
 * Temporary 2FA challenge tokens are explicitly rejected here.
 */
export function verifyAccessToken<T = JwtUserPayload>(token: string): T {
  const decoded = jwt.verify(token, securityConfig.jwtAccessSecret, verifyOptions()) as JwtPayload;
  if (decoded.type === 'refresh' || decoded.type === '2fa_temp') {
    throw new jwt.JsonWebTokenError('Invalid token type.');
  }
  return decoded as T;
}

/**
 * Verifies a refresh JWT using the refresh-only secret and enforces its type.
 */
export function verifyRefreshToken<T = JwtUserPayload>(token: string): T {
  const decoded = jwt.verify(token, securityConfig.jwtRefreshSecret, verifyOptions()) as JwtPayload;
  if (decoded.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Invalid refresh token.');
  }
  return decoded as T;
}

/**
 * @deprecated Use verifyAccessToken or verifyRefreshToken so the expected token
 * type is explicit.
 */
export function verifyJwtToken<T = JwtUserPayload>(token: string): T {
  return verifyAccessToken<T>(token);
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
    securityConfig.jwtAccessSecret,
    signOptions('5m')
  );
}

/**
 * Verifies a 2FA temporary token.
 */
export function verifyTemp2faToken(token: string): { userId: number; email: string; type: string } {
  const decoded = jwt.verify(token, securityConfig.jwtAccessSecret, verifyOptions()) as JwtPayload;
  if (!decoded || decoded.type !== '2fa_temp') {
    throw new jwt.JsonWebTokenError('Invalid or expired 2FA session token.');
  }
  return decoded as { userId: number; email: string; type: string };
}
