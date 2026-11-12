/**
 * Central password policy for user-chosen credentials.
 *
 * Phase 5 sets an 8-character minimum and 128-character maximum. Common
 * passwords are still rejected, and callers should surface the returned message
 * directly.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'abc123',
  'admin',
  'admin123',
  'dockslot',
  'dragon',
  'football',
  'iloveyou',
  'letmein',
  'monkey',
  'password',
  'password1',
  'password123',
  'password1234',
  'qwerty',
  'qwerty123',
  'welcome',
]);

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password is required.';
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`;
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common. Please choose a stronger password.';
  }

  return null;
}

/** Throws the project's standard `{ status, message }` error shape. */
export function assertValidPassword(password: unknown): asserts password is string {
  const error = validatePassword(password);
  if (error) {
    throw { status: 400, message: error };
  }
}
