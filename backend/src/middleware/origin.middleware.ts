import type { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF defense-in-depth for cookie-authenticated auth endpoints.
 *
 * Browsers attach an `Origin` header to cross-origin state-changing requests.
 * In production, reject cookie-backed POSTs whose Origin is absent or not in
 * the configured CORS allowlist. Development and test environments keep the
 * existing behavior so local tools and supertest requests do not need an
 * Origin header.
 */
export function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (SAFE_METHODS.has(req.method) || process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin));

  const requestOrigin = normalizeOrigin(req.get('origin'));

  if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
    res.status(403).json({
      success: false,
      message: 'Request origin is not allowed.',
    });
    return;
  }

  next();
}

export default requireTrustedOrigin;
