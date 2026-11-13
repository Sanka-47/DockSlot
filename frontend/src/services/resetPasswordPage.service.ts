import { authApi } from '../api/auth.api';
import { validatePassword } from '../utils/passwordPolicy';

/** Business rules and API orchestration for the reset-password page. */
export const resetPasswordPageService = {
  /** Returns a user-facing validation message, or null when the input is valid. */
  validateResetInput(
    token: string,
    newPassword: string,
    confirmPassword: string
  ): string | null {
    if (!token.trim()) {
      return 'Missing password reset token. Please use the link provided in your email or request a new one.';
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return passwordError;
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
