import { authApi } from '../api/auth.api';
import { validatePassword } from '../utils/passwordPolicy';

export interface InvitationDetails {
  email: string;
  role: string;
  organizationName?: string;
}

/** Business rules and API orchestration for the invitation registration modal. */
export const userRegisterModalService = {
  /** Returns a user-facing validation message, or null when the input is valid. */
  validateRegistration(
    token: string,
    password: string,
    confirmPassword: string
  ): string | null {
    if (!token) {
      return 'Missing invitation token. Please ensure you clicked the full link from your invitation email.';
    }

    if (!password) {
      return 'Please enter a password.';
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return passwordError;
    }

    if (password !== confirmPassword) {
      return 'Passwords do not match. Please verify both fields.';
    }

    return null;
  },

  async getInvitationDetails(token: string): Promise<InvitationDetails> {
    const response = await authApi.getInvitationDetails(token);
    return response.data;
  },

  async acceptInvitation(
    token: string,
    password: string
  ): Promise<{ message: string; email?: string }> {
    const response = await authApi.acceptInvite(token, password);

    return {
      message:
        response.message || 'Account registered successfully! Redirecting to sign in...',
      email: response.user?.email,
    };
  },
};
