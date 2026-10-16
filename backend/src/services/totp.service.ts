import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import bcrypt from 'bcrypt';
import { prisma } from '../config/db.config';
import { authService, AuthResponse } from './auth.service';
import { verifyTemp2faToken } from '../utils/jwt.utils';

export interface Setup2FAResponse {
  secret: string;
  qrCode: string;
  otpauthUrl: string;
}

export interface VerifyAndEnableInput {
  userId: number;
  token: string;
}

export interface Disable2FAInput {
  userId: number;
  password?: string;
  token?: string;
}

export interface LoginVerify2FAInput {
  tempToken?: string;
  token: string;
  email?: string;
  password?: string;
}

export class TotpService {
  /**
   * Reports whether 2FA is fully enabled, or whether a setup was started but never confirmed.
   */
  public async getStatus(
    userId: number
  ): Promise<{ isTwoFactorEnabled: boolean; isSetupPending: boolean }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isTwoFactorEnabled: true, totpSecret: true },
    });

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    return {
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      isSetupPending: !user.isTwoFactorEnabled && !!user.totpSecret,
    };
  }

  /**
   * Generates a new TOTP secret for the authenticated user and returns QR code data URL and secret string.
   */
  public async setup(userId: number): Promise<Setup2FAResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    // Generate standard 20-byte base32 secret
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `DockSlot (${user.email})`,
      issuer: 'DockSlot',
    });

    const otpauthUrl = speakeasy.otpauthURL({
      secret: secret.base32,
      label: `DockSlot (${user.email})`,
      issuer: 'DockSlot',
      encoding: 'base32',
    });

    const qrCode = await QRCode.toDataURL(otpauthUrl);

    // Persist secret on the user record; 2FA remains disabled until verifyAndEnable is completed
    await prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: secret.base32,
      },
    });

    return {
      secret: secret.base32,
      qrCode,
      otpauthUrl,
    };
  }

  /**
   * Accepts a 6-digit token from the authenticator app to confirm and enable isTwoFactorEnabled = true.
   */
  public async verifyAndEnable(input: VerifyAndEnableInput): Promise<{ message: string; isTwoFactorEnabled: boolean }> {
    const { userId, token } = input;

    if (!token || typeof token !== 'string') {
      throw { status: 400, message: 'A 6-digit verification code is required.' };
    }

    const cleanToken = token.trim();
    if (cleanToken.length !== 6 || !/^\d{6}$/.test(cleanToken)) {
      throw { status: 400, message: 'Verification code must be exactly 6 numeric digits.' };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    if (!user.totpSecret) {
      throw { status: 400, message: '2FA setup has not been initiated. Please run setup first.' };
    }

    const isVerified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: cleanToken,
      window: 1, // Allow 1-step window (±30s) for time drift
    });

    if (!isVerified) {
      throw { status: 400, message: 'Invalid verification code. Please check your authenticator app and try again.' };
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        isTwoFactorEnabled: true,
      },
    });

    return {
      message: 'Two-factor authentication has been enabled successfully.',
      isTwoFactorEnabled: true,
    };
  }

  /**
   * Disables 2FA (requires current password or valid 2FA token for security).
   */
  public async disable(input: Disable2FAInput): Promise<{ message: string; isTwoFactorEnabled: boolean }> {
    const { userId, password, token } = input;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    if (!user.isTwoFactorEnabled) {
      throw { status: 400, message: 'Two-factor authentication is not currently enabled.' };
    }

    let authorized = false;

    // Validate password if provided
    if (password && typeof password === 'string') {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (isMatch) {
        authorized = true;
      } else {
        throw { status: 401, message: 'Current password does not match.' };
      }
    }

    // Validate 2FA token if password was not provided or to allow token-based disable
    if (!authorized && token && typeof token === 'string' && user.totpSecret) {
      const cleanToken = token.trim();
      const isVerified = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: cleanToken,
        window: 1,
      });

      if (isVerified) {
        authorized = true;
      } else {
        throw { status: 401, message: 'Invalid two-factor authentication code.' };
      }
    }

    if (!authorized) {
      throw {
        status: 400,
        message: 'Your current account password or a valid 6-digit 2FA code is required to disable 2FA.',
      };
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        isTwoFactorEnabled: false,
        totpSecret: null,
      },
    });

    return {
      message: 'Two-factor authentication has been disabled successfully.',
      isTwoFactorEnabled: false,
    };
  }

  /**
   * Verifies the 6-digit TOTP code with a tempToken (or credentials) and issues final authentication tokens.
   */
  public async loginVerify(input: LoginVerify2FAInput): Promise<AuthResponse> {
    const { tempToken, token, email, password } = input;

    if (!token || typeof token !== 'string') {
      throw { status: 400, message: 'A 6-digit verification code is required.' };
    }

    const cleanToken = token.trim();
    if (cleanToken.length !== 6 || !/^\d{6}$/.test(cleanToken)) {
      throw { status: 400, message: 'Verification code must be exactly 6 numeric digits.' };
    }

    let user: any = null;

    if (tempToken) {
      const payload = verifyTemp2faToken(tempToken);
      user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      });
    } else if (email && password) {
      const normalizedEmail = email.toLowerCase().trim();
      const foundUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      });

      if (!foundUser) {
        throw { status: 401, message: 'Invalid credentials.' };
      }

      const isPasswordValid = await bcrypt.compare(password, foundUser.passwordHash);
      if (!isPasswordValid) {
        throw { status: 401, message: 'Invalid credentials.' };
      }

      user = foundUser;
    } else {
      throw { status: 400, message: 'Session token or credentials are required for 2FA verification.' };
    }

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    if (!user.isActive) {
      throw { status: 403, message: 'Account is deactivated. Please contact support.' };
    }

    if (!user.isTwoFactorEnabled || !user.totpSecret) {
      throw { status: 400, message: 'Two-factor authentication is not enabled for this account.' };
    }

    const isVerified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: cleanToken,
      window: 1,
    });

    if (!isVerified) {
      throw { status: 401, message: 'Invalid two-factor verification code.' };
    }

    // Reset failed login attempts on successful TOTP verification
    if (user.failedLoginAttempts > 0 || user.lockUntil !== null) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });
    }

    const tokenVersion = await authService.getUserTokenVersion(user.id);
    const accessToken = authService.generateToken(user, tokenVersion);
    const refreshToken = authService.generateRefreshToken(user, tokenVersion);

    return {
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        isEmailVerified: user.isEmailVerified,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
        organization: user.organization,
      },
    };
  }
}

export const totpService = new TotpService();
