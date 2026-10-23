import { authApi } from '../api/auth.api';
import type { TwoFactorStatus } from '../types/user.types';

export interface TwoFactorSetupPayload {
  secret: string;
  qrCode: string;
  otpauthUrl: string;
}

/** API orchestration for the two-factor authentication settings panel. */
export const twoFactorSettingsService = {
  async fetchStatus(): Promise<TwoFactorStatus | null> {
    const response = await authApi.get2FAStatus();
    return response.data ?? null;
  },

  async startSetup(): Promise<TwoFactorSetupPayload> {
    const response = await authApi.setup2FA();
    const payload = response.data;

    const secret = payload?.secret || response.secret || '';
    const qrCode = payload?.qrCode || response.qrCode || '';
    const otpauthUrl = payload?.otpauthUrl || response.otpauthUrl || '';

    if (!secret || !qrCode) {
      throw new Error('The server did not return a usable 2FA secret.');
    }

    return { secret, qrCode, otpauthUrl };
  },

  async verifyAndEnable(code: string): Promise<{ message: string }> {
    const response = await authApi.verifyAndEnable2FA({ token: code.trim() });
    return {
      message:
        response.message ||
        'Two-factor authentication is now enabled for your account.',
    };
  },

  async disable(input: {
    password?: string;
    token?: string;
  }): Promise<{ message: string }> {
    const response = await authApi.disable2FA({
      password: input.password || undefined,
      token: input.token?.trim() || undefined,
    });

    return {
      message: response.message || 'Two-factor authentication has been disabled.',
    };
  },

  validateVerificationCode(code: string): string | null {
    return /^\d{6}$/.test(code.trim())
      ? null
      : 'Enter the 6-digit code shown in your authenticator app.';
  },

  validateDisableInput(password: string, code: string): string | null {
    if (!password && !code.trim()) {
      return 'Provide your account password or a current 6-digit code to disable 2FA.';
    }

    return null;
  },
};
