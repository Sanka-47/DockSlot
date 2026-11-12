import type { HelmetOptions } from 'helmet';

/**
 * Strict CSP for JSON API responses. The API does not serve executable content,
 * so everything is locked to the API origin and no inline script/style is
 * allowed.
 */
const API_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "worker-src 'none'",
].join('; ');

/**
 * Swagger UI needs inline scripts/styles and may load local static assets. It is
 * intentionally scoped to the documentation routes; the API routes keep the
 * strict policy above.
 */
export const SWAGGER_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'none'",
].join('; ');

/**
 * Build the Helmet options used by the app. Exported separately so tests can
 * assert the production-only HSTS configuration without changing NODE_ENV.
 */
export function buildSecurityHeadersOptions(isProduction: boolean): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        manifestSrc: ["'self'"],
        mediaSrc: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        workerSrc: ["'none'"],
        // HTTP-only local development must not receive upgrade directives.
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    // HSTS is only meaningful over HTTPS. Enable it in production, where the
    // refresh cookie is also Secure by default.
    hsts: isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    noSniff: true,
    dnsPrefetchControl: { allow: false },
    // The API and Swagger UI do not need cross-origin isolation. Disabling COEP
    // avoids breaking Swagger UI static assets while the other headers remain.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
  };
}

export { API_CONTENT_SECURITY_POLICY };
