import type { Request, Response } from 'express';
import { securityConfig } from '../config/security.config';

/**
 * Refresh tokens are transported in an HttpOnly cookie so client-side
 * JavaScript (and therefore any injected script) can never read them. The
 * cookie is scoped to the auth endpoints to limit where it is transmitted.
 */
const cookieBaseOptions = () => ({
  httpOnly: true,
  secure: securityConfig.cookieSecure,
  sameSite: securityConfig.cookieSameSite,
  path: securityConfig.refreshCookiePath,
});

/** Attach (or rotate) the refresh token cookie on the response. */
export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(securityConfig.refreshCookieName, token, {
    ...cookieBaseOptions(),
    maxAge: securityConfig.refreshCookieMaxAgeMs,
  });
}

/** Remove the refresh token cookie (logout / failed refresh). */
export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(securityConfig.refreshCookieName, cookieBaseOptions());
}

/** Read the refresh token from the incoming Cookie header, if present. */
export function getRefreshTokenFromRequest(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  const name = securityConfig.refreshCookieName;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const raw = trimmed.slice(name.length + 1);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}
