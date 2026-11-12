export const PASSWORD_MIN_LENGTH = 12;
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

/**
 * Mirrors backend/src/utils/passwordPolicy.ts so users get immediate feedback
 * instead of waiting for a 400 response. The backend remains authoritative.
 */
export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Password is required.';
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`;
  }

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  if (classes < 3) {
    return 'Password must include at least three of: lowercase letters, uppercase letters, numbers, and symbols.';
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common. Please choose a stronger password.';
  }

  return null;
}
