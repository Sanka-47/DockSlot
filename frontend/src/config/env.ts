/**
 * Typed, validated access to Vite environment variables.
 *
 * Development keeps a localhost fallback for zero-config `npm run dev`.
 * Production builds must provide an explicit HTTPS API URL; `vite.config.ts`
 * enforces the same rule at build time so a misconfigured bundle never ships.
 */

const DEV_API_FALLBACK = 'http://localhost:5000/api';

function parseApiUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VITE_API_URL must be a valid absolute URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('VITE_API_URL must use http or https.');
  }

  if (url.username || url.password) {
    throw new Error('VITE_API_URL must not include credentials.');
  }

  if (url.search || url.hash) {
    throw new Error('VITE_API_URL must not include a query string or fragment.');
  }

  if (url.pathname === '/' || url.pathname === '') {
    throw new Error('VITE_API_URL must include the API base path, for example /api.');
  }

  return url;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function resolveApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL?.trim();

  if (!raw) {
    if (import.meta.env.PROD) {
      throw new Error('VITE_API_URL is required for production builds.');
    }
    return DEV_API_FALLBACK;
  }

  const url = parseApiUrl(raw);

  if (import.meta.env.PROD && url.protocol !== 'https:') {
    throw new Error('VITE_API_URL must use HTTPS in production.');
  }

  if (import.meta.env.PROD && isLocalHostname(url.hostname)) {
    throw new Error('VITE_API_URL must not point at localhost in production.');
  }

  return raw.replace(/\/+$/, '');
}

export const apiBaseUrl = resolveApiBaseUrl();
