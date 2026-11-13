/**
 * One-time URL token handling for email links.
 *
 * Password-reset and invitation links necessarily arrive with the token in the
 * query string. The token is read once and immediately removed from the visible
 * URL/history entry so it cannot leak through the address bar, screenshots, or a
 * later `Referer` header. The caller keeps the value in memory for the lifetime
 * of the page.
 */

const AUTH_TOKEN_PATHS = new Set(['/reset-password', '/accept-invite']);

export function normalizePathname(pathname: string): string {
  const withoutTrailingSlashes = pathname.replace(/\/+$/, '');
  return withoutTrailingSlashes || '/';
}

export function isResetPasswordPath(pathname: string): boolean {
  return normalizePathname(pathname) === '/reset-password';
}

export function isAcceptInvitePath(pathname: string): boolean {
  return normalizePathname(pathname) === '/accept-invite';
}

export function isForgotPasswordPath(pathname: string): boolean {
  return normalizePathname(pathname) === '/forgot-password';
}

/**
 * Reads `?token=` on an auth-email route and scrubs it from the current history
 * entry. Returns `undefined` when the route is not an auth-token route or when
 * no token is present.
 */
export function consumeAuthTokenFromUrl(
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : ''
): string | undefined {
  if (typeof window === 'undefined') return undefined;

  const path = normalizePathname(pathname);
  if (!AUTH_TOKEN_PATHS.has(path)) return undefined;

  const url = new URL(window.location.href);
  const token = url.searchParams.get('token') ?? undefined;
  if (!token) return undefined;

  url.searchParams.delete('token');

  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch {
    // The token is still held in memory by the caller. A failed history update
    // must not block the reset/invitation flow.
  }

  return token;
}
