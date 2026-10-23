import { authApi } from '../api/auth.api';

/** Reads the reset token from the current URL (?token=...). */
export function getResetTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('token');
}

/** Business rules and API orchestration for the reset-password page. */
export const resetPasswordPageService = {
  getTokenFromUrl: getResetTokenFromUrl,

  /** Returns a user-facing validation message, or null when the input is valid. */
  validateResetInput(
    token: string,
    newPassword: string,
    confirmPassword: string
  ): string | null {
    if (!token.trim()) {
      return 'Missing password reset token. Please use the link provided in your email or request a new one.';
    }

    if (newPassword.length < 6) {
      return 'New password must be at least 6 characters long.';
    }

    if (newPassword !== confirmPassword) {
      return 'Passwords do not match. Please verify both fields.';
    }

    return null;
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await authApi.resetPassword(token.trim(), newPassword);
  },
};
