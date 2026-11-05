import { authApi } from '../api/auth.api';
import { storage } from '../utils/storage';
import { getApiErrorMessage } from './errors';
import type {
  AuthResponse,
  LoginRequest,
  OrganizationType,
  RegisterRequest,
  User,
} from '../types/user.types';

/** A fully authenticated session (access token + user). */
export interface AuthenticatedSession {
  token: string;
  user: User;
}

/** Result of the first sign-in step: either a session or a 2FA challenge. */
export type SignInResult =
  | { requiresTwoFactor: true; tempToken: string; email: string }
  | { requiresTwoFactor: false; token: string; user: User };

export interface RegisterOrganizationInput {
  organizationName: string;
  organizationType: OrganizationType;
  email: string;
  password: string;
}

export type DashboardRoute = 'carrier' | 'warehouse';

function extractSession(
  response: AuthResponse,
  incompleteMessage: string
): AuthenticatedSession {
  const token = response.token ?? response.data?.token;
  const user = response.user ?? response.data?.user;

  if (!token || !user) {
    throw new Error(incompleteMessage);
  }

  return { token, user };
}

/**
 * Authentication use cases for the Auth page: credential sign-in (including the
 * 2FA challenge), TOTP completion, organization registration, session storage
 * and role-based routing.
 */
export const authPageService = {
  async signIn(email: string, password: string): Promise<SignInResult> {
    const credentials: LoginRequest = {
      email: email.trim().toLowerCase(),
      password,
    };

    const response = await authApi.login(credentials);
    const requiresTwoFactor = Boolean(response.requires2FA ?? response.data?.requires2FA);

    if (requiresTwoFactor) {
      const tempToken = response.tempToken ?? response.data?.tempToken;

      if (!tempToken) {
        throw new Error(
          'Two-factor authentication is required but the challenge token is missing.'
        );
      }

      return {
        requiresTwoFactor: true,
        tempToken,
        email: credentials.email,
      };
    }

    const session = extractSession(
      response,
      'Authentication succeeded but received an incomplete server response.'
    );
    return { requiresTwoFactor: false, ...session };
  },

  async verifyTwoFactor(tempToken: string, code: string): Promise<AuthenticatedSession> {
    const response = await authApi.verify2FALogin({
      tempToken,
      token: code.trim(),
    });

    return extractSession(
      response,
      'Verification succeeded but received an incomplete server response.'
    );
  },

  async registerOrganization(
    input: RegisterOrganizationInput
  ): Promise<AuthenticatedSession> {
    const organizationName = input.organizationName.trim();
    const payload: RegisterRequest = {
      organizationName,
      orgName: organizationName,
      organizationType: input.organizationType,
      orgType: input.organizationType,
      email: input.email.trim().toLowerCase(),
      password: input.password,
    };

    const response = await authApi.register(payload);
    return extractSession(
      response,
      'Registration completed but received an incomplete server response.'
    );
  },

  /** Persists the access token; the refresh token stays in its HttpOnly cookie. */
  persistSession(token: string): void {
    storage.setToken(token);
  },

  /** Role/organization rule used to choose the post-login dashboard. */
  getDashboardRoute(user: User): DashboardRoute {
    const isCarrier =
      user.role === 'CARRIER_ADMIN' ||
      user.role === 'DISPATCHER' ||
      user.organization?.type === 'CARRIER';

    return isCarrier ? 'carrier' : 'warehouse';
  },

  /** True when a 401 means the short-lived 2FA temp token expired. */
  isTwoFactorSessionExpired(error: unknown): boolean {
    const err = error as { response?: { status?: number } } | null | undefined;
    if (err?.response?.status !== 401) return false;

    return /temp|session|expired/i.test(getApiErrorMessage(error, ''));
  },

  /** Returns a user-facing validation message, or null when the input is valid. */
  validateSignIn(email: string, password: string): string | null {
    if (!email.trim() || !password) {
      return 'Please provide both email address and password.';
    }

    return null;
  },

  /** Returns a user-facing validation message, or null when the code is valid. */
  validateTwoFactorCode(code: string): string | null {
    return /^\d{6}$/.test(code.trim())
      ? null
      : 'Please enter the 6-digit code from your authenticator app.';
  },

  /** Returns a user-facing validation message, or null when the input is valid. */
  validateRegistration(input: {
    organizationName: string;
    email: string;
    password: string;
  }): string | null {
    if (!input.organizationName.trim()) {
      return 'Organization Name is required.';
    }

    if (!input.email.trim()) {
      return 'Email Address is required.';
    }

    if (!input.password || input.password.length < 6) {
      return 'Password must be at least 6 characters long.';
    }

    return null;
  },
};
