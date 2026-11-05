import { authApi } from '../api/auth.api';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Business rules and API orchestration for the forgot-password page. */
export const forgotPasswordPageService = {
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  },

  /** Returns a user-facing validation message, or null when the input is valid. */
  validateEmail(email: string): string | null {
    if (!email) {
      return 'Please enter your email address.';
    }

    if (!EMAIL_PATTERN.test(email)) {
      return 'Please enter a valid email address.';
    }

    return null;
  },

  async requestPasswordReset(email: string): Promise<void> {
    await authApi.forgotPassword(email);
  },
};
