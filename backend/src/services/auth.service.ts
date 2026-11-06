import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { UserRole, OrganizationType } from '@prisma/client';
import { authRepository } from '../repositories/auth.repository';
import { securityConfig } from '../config/security.config';
import { signAccessToken, signRefreshToken, verifyJwtToken, signTemp2faToken } from '../utils/jwt.utils';
import { emailService } from './email.service';
import redis from '../config/redis';

export interface RegisterInput {
  email: string;
  password: string;
  organizationName?: string;
  organizationType?: OrganizationType | 'warehouse' | 'carrier' | 'WAREHOUSE_OPERATOR' | 'CARRIER';
  role?: UserRole;
  organizationId?: number;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export interface ChangePasswordInput {
  userId: number;
  oldPassword: string;
  newPassword: string;
}

export interface ResendVerificationInput {
  email?: string;
  userId?: number;
}

export interface AcceptInviteInput {
  token: string;
  password: string;
}

export interface AuthResponse {
  token?: string;
  refreshToken?: string;
  requires2FA?: boolean;
  tempToken?: string;
  user: {
    id: number;
    email: string;
    role: UserRole;
    organizationId: number;
    isEmailVerified: boolean;
    isTwoFactorEnabled?: boolean;
    organization?: {
      id: number;
      name: string;
      type: OrganizationType;
    };
  };
}

export class AuthService {
  /**
   * Helper to issue a signed access JWT token using configured JWT_EXPIRES_IN.
   */
  public generateToken(
    user: { id: number; organizationId: number; role: UserRole; email: string },
    tokenVersion: number = 0
  ): string {
    return signAccessToken({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
      tokenVersion,
    });
  }

  /**
   * Helper to issue a signed refresh JWT token using configured JWT_REFRESH_EXPIRES_IN.
   */
  public generateRefreshToken(
    user: { id: number; organizationId: number; role: UserRole; email: string },
    tokenVersion: number = 0
  ): string {
    return signRefreshToken({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
      tokenVersion,
    });
  }

  /**
   * Helper to verify a JWT token using configured JWT_SECRET.
   */
  public verifyToken(token: string) {
    return verifyJwtToken(token);
  }

  /**
   * Exchange a valid refresh token for a new access token plus a rotated
   * refresh token.
   *
   * Rejects tokens that are not of type `refresh`, belong to a deactivated
   * user, or whose `tokenVersion` no longer matches the value in Redis (i.e.
   * it was revoked via logout-all).
   */
  public async refresh(refreshToken?: string): Promise<AuthResponse> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw { status: 400, message: 'Refresh token is required.' };
    }

    let decoded: any;
    try {
      decoded = verifyJwtToken(refreshToken);
    } catch {
      throw { status: 401, message: 'Invalid or expired refresh token.' };
    }

    // Only genuine refresh tokens may be redeemed here. Access and 2FA
    // challenge tokens must never be accepted.
    if (!decoded || decoded.type !== 'refresh') {
      throw { status: 401, message: 'Invalid refresh token.' };
    }

    const user = await authRepository.findUserWithOrganizationById(decoded.userId);

    if (!user) {
      throw { status: 401, message: 'Invalid refresh token.' };
    }

    if (!user.isActive) {
      throw { status: 403, message: 'Account is deactivated. Please contact support.' };
    }

    // Revocation check: logout-all increments the Redis token version, which
    // instantly invalidates every previously issued refresh token.
    const currentVersion = await this.getUserTokenVersion(user.id);
    if ((decoded.tokenVersion ?? 0) !== currentVersion) {
      throw { status: 401, message: 'Refresh token has been revoked. Please login again.' };
    }

    const token = this.generateToken(user, currentVersion);
    const rotatedRefreshToken = this.generateRefreshToken(user, currentVersion);

    return {
      token,
      refreshToken: rotatedRefreshToken,
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

  /**
   * Fetch user's current token version from Redis (defaults to 0 if not set).
   */
  public async getUserTokenVersion(userId: number): Promise<number> {
    const version = await redis.get(`user:${userId}:tokenVersion`);
    return version !== null ? parseInt(version, 10) : 0;
  }

  /**
   * Invalidate all active sessions for a user by incrementing their token version in Redis.
   */
  public async logoutAll(userId: number): Promise<void> {
    await redis.incr(`user:${userId}:tokenVersion`);
  }

  /**
   * Parse and normalize organization type string to Prisma OrganizationType enum.
   */
  private normalizeOrganizationType(type?: string): OrganizationType {
    if (!type) {
      throw {
        status: 400,
        message: 'organizationType is required and must be either "WAREHOUSE_OPERATOR" (warehouse) or "CARRIER" (carrier).',
      };
    }

    const upper = type.toUpperCase().trim();
    if (upper === 'WAREHOUSE' || upper === 'WAREHOUSE_OPERATOR') {
      return OrganizationType.WAREHOUSE_OPERATOR;
    }
    if (upper === 'CARRIER') {
      return OrganizationType.CARRIER;
    }

    throw {
      status: 400,
      message: 'Invalid organizationType. Must be either "WAREHOUSE_OPERATOR" (warehouse) or "CARRIER" (carrier).',
    };
  }

  /**
   * Register a new user.
   * Requirement: Creating an account creates a new organization (warehouse or carrier)
   * and that user automatically becomes its Admin.
   * Also generates verificationToken and sends a verification email.
   */
  public async register(input: RegisterInput): Promise<AuthResponse> {
    const { email, password, organizationName, organizationType, organizationId, role } = input;

    if (!email || !password) {
      throw { status: 400, message: 'Email and password are required.' };
    }

    if (password.length < 6) {
      throw { status: 400, message: 'Password must be at least 6 characters long.' };
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const existingUser = await authRepository.findUserByEmail(normalizedEmail);

    if (existingUser) {
      throw { status: 409, message: 'A user with this email already exists.' };
    }

    // Hash password before transaction
    const passwordHash = await bcrypt.hash(password, securityConfig.saltRounds);

    // Generate secure email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Scenario A: Standard Sign Up (Creates a new Organization & designates user as its Admin)
    if (!organizationId) {
      const orgType = this.normalizeOrganizationType(organizationType);

      // Automatically assign the user as Admin based on organization type
      const adminRole =
        orgType === OrganizationType.WAREHOUSE_OPERATOR
          ? UserRole.WAREHOUSE_ADMIN
          : UserRole.CARRIER_ADMIN;

      const orgName =
        organizationName?.trim() ||
        `${normalizedEmail.split('@')[0]} ${orgType === OrganizationType.WAREHOUSE_OPERATOR ? 'Warehouse' : 'Fleet'}`;

      // Execute atomically in a transaction
      const { user, organization } = await authRepository.transaction(async (tx) => {
        const newOrg = await authRepository.createOrganization(
          {
            name: orgName,
            type: orgType,
          },
          tx
        );

        const newUser = await authRepository.createUser(
          {
            email: normalizedEmail,
            passwordHash,
            role: adminRole,
            organizationId: newOrg.id,
            isActive: true,
            isEmailVerified: false,
            verificationToken,
          },
          tx
        );

        return { user: newUser, organization: newOrg };
      });

      // Send verification email asynchronously
      emailService.sendVerificationEmail(user.email, verificationToken).catch((err) => {
        console.error('[AuthService] Error dispatching verification email:', err);
      });

      const tokenVersion = await this.getUserTokenVersion(user.id);
      const token = this.generateToken(user, tokenVersion);
      const refreshToken = this.generateRefreshToken(user, tokenVersion);

      return {
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          isEmailVerified: user.isEmailVerified,
          isTwoFactorEnabled: user.isTwoFactorEnabled,
          organization: {
            id: organization.id,
            name: organization.name,
            type: organization.type,
          },
        },
      };
    }

    // Scenario B: Joining an existing Organization (e.g., invited employee/dispatcher)
    const existingOrg = await authRepository.findOrganizationById(organizationId);

    if (!existingOrg) {
      throw { status: 404, message: `Organization with ID ${organizationId} not found.` };
    }

    const assignedRole =
      role ||
      (existingOrg.type === OrganizationType.WAREHOUSE_OPERATOR
        ? UserRole.DOCK_MANAGER
        : UserRole.DISPATCHER);

    const user = await authRepository.createUser({
      email: normalizedEmail,
      passwordHash,
      role: assignedRole,
      organizationId: existingOrg.id,
      isActive: true,
      isEmailVerified: false,
      verificationToken,
    });

    // Send verification email asynchronously
    emailService.sendVerificationEmail(user.email, verificationToken).catch((err) => {
      console.error('[AuthService] Error dispatching verification email:', err);
    });

    const tokenVersion = await this.getUserTokenVersion(user.id);
    const token = this.generateToken(user, tokenVersion);
    const refreshToken = this.generateRefreshToken(user, tokenVersion);

    return {
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        isEmailVerified: user.isEmailVerified,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
        organization: {
          id: existingOrg.id,
          name: existingOrg.name,
          type: existingOrg.type,
        },
      },
    };
  }

  /**
   * Verify a user's email using the verification token.
   */
  public async verifyEmail(token: string): Promise<{ message: string; email: string }> {
    if (!token || typeof token !== 'string') {
      throw { status: 400, message: 'Verification token is required.' };
    }

    const user = await authRepository.findUserByVerificationToken(token.trim());

    if (!user) {
      throw { status: 400, message: 'Invalid or expired verification token.' };
    }

    await authRepository.markEmailVerified(user.id);

    return {
      message: 'Email verified successfully. Your account is now fully active.',
      email: user.email,
    };
  }

  /**
   * Resend a verification email.
   */
  public async resendVerification(input: ResendVerificationInput): Promise<{ message: string }> {
    const { email, userId } = input;

    let user;
    if (userId) {
      user = await authRepository.findUserById(userId);
    } else if (email) {
      user = await authRepository.findUserByEmail(email.toLowerCase().trim());
    } else {
      throw { status: 400, message: 'Either email or authenticated user ID is required.' };
    }

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    if (user.isEmailVerified) {
      return { message: 'Email is already verified.' };
    }

    // Generate a fresh token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    await authRepository.setVerificationToken(user.id, verificationToken);

    // Send verification email
    await emailService.sendVerificationEmail(user.email, verificationToken);

    return { message: 'A new verification email has been sent to your email address.' };
  }

  /**
   * Login an existing user and issue a JWT token.
   * Protects against brute-force attacks via temporary account lockout after
   * MAX_FAILED_LOGIN_ATTEMPTS consecutive failed attempts for LOGIN_LOCKOUT_DURATION_MINUTES.
   */
  public async login(input: LoginInput): Promise<AuthResponse> {
    const { email, password } = input;

    if (!email || !password) {
      throw { status: 400, message: 'Email and password are required.' };
    }

    const user = await authRepository.findUserWithOrganizationByEmail(email.toLowerCase().trim());

    if (!user) {
      throw { status: 401, message: 'Invalid email or password.' };
    }

    if (!user.isActive) {
      throw { status: 403, message: 'Account is deactivated. Please contact support.' };
    }

    const maxAttempts = securityConfig.maxFailedLoginAttempts;
    const lockoutDurationMinutes = securityConfig.loginLockoutDurationMinutes;

    // 1. Check if the account is currently locked
    const now = new Date();
    if (user.lockUntil && user.lockUntil > now) {
      const remainingMinutes = Math.ceil((user.lockUntil.getTime() - now.getTime()) / (60 * 1000));
      throw {
        status: 423,
        message: `Account is temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
      };
    }

    // 2. Validate password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      // If a previous lock window has expired, reset the consecutive counter before incrementing
      const baseAttempts =
        user.lockUntil && user.lockUntil <= now ? 0 : user.failedLoginAttempts || 0;
      const failedAttempts = baseAttempts + 1;

      if (failedAttempts >= maxAttempts) {
        // Lock account for configured LOGIN_LOCKOUT_DURATION_MINUTES
        const lockUntil = new Date(Date.now() + lockoutDurationMinutes * 60 * 1000);
        await authRepository.updateUser(user.id, {
          failedLoginAttempts: failedAttempts,
          lockUntil,
        });
        throw {
          status: 423,
          message: `Account is temporarily locked due to ${maxAttempts} consecutive failed login attempts. Please try again after ${lockoutDurationMinutes} minutes.`,
        };
      } else {
        await authRepository.updateUser(user.id, {
          failedLoginAttempts: failedAttempts,
          lockUntil: null,
        });
        const remaining = maxAttempts - failedAttempts;
        throw {
          status: 401,
          message: `Invalid email or password. ${remaining} attempt(s) remaining before account lockout.`,
        };
      }
    }

    // 3. Password is valid: reset failed attempts and unlock account if needed
    if (user.failedLoginAttempts > 0 || user.lockUntil !== null) {
      await authRepository.updateUser(user.id, {
        failedLoginAttempts: 0,
        lockUntil: null,
      });
    }

    // 4. Two-Factor Authentication Check
    if (user.isTwoFactorEnabled && user.totpSecret) {
      const tempToken = signTemp2faToken(user.id, user.email);
      return {
        requires2FA: true,
        tempToken,
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

    const tokenVersion = await this.getUserTokenVersion(user.id);
    const token = this.generateToken(user, tokenVersion);
    const refreshToken = this.generateRefreshToken(user, tokenVersion);

    return {
      token,
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

  /**
   * Forgot password: Sends a password reset link to the user's email.
   * Mitigates user enumeration by always returning a generic success message.
   */
  public async forgotPassword(email: string): Promise<{ message: string }> {
    const genericSuccess = {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };

    if (!email || typeof email !== 'string') {
      return genericSuccess;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await authRepository.findUserByEmail(normalizedEmail);

    if (!user) {
      return genericSuccess;
    }

    // Generate secure random reset token and set expiration (1 hour from now)
    const resetPasswordToken = crypto.randomBytes(32).toString('hex');
    const resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);

    await authRepository.setPasswordResetToken(user.id, resetPasswordToken, resetPasswordExpires);

    // Send reset email via Nodemailer
    emailService.sendPasswordResetEmail(user.email, resetPasswordToken).catch((err) => {
      console.error('[AuthService] Error dispatching password reset email:', err);
    });

    return genericSuccess;
  }

  /**
   * Reset password using a reset token.
   */
  public async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    if (!token || typeof token !== 'string') {
      throw { status: 400, message: 'Password reset token is required.' };
    }

    if (!newPassword || newPassword.length < 6) {
      throw { status: 400, message: 'New password must be at least 6 characters long.' };
    }

    const user = await authRepository.findUserByResetToken(token.trim());

    if (!user) {
      throw { status: 400, message: 'Invalid or expired password reset token.' };
    }

    const passwordHash = await bcrypt.hash(newPassword, securityConfig.saltRounds);

    await authRepository.clearPasswordResetToken(user.id, passwordHash);

    return { message: 'Password has been reset successfully. You can now login with your new password.' };
  }

  /**
   * Change password for authenticated user using old password and new password.
   */
  public async changePassword(input: ChangePasswordInput): Promise<{ message: string }> {
    const { userId, oldPassword, newPassword } = input;

    if (!userId || !oldPassword || !newPassword) {
      throw { status: 400, message: 'Current password and new password are required.' };
    }

    if (newPassword.length < 6) {
      throw { status: 400, message: 'New password must be at least 6 characters long.' };
    }

    const user = await authRepository.findUserById(userId);

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) {
      throw { status: 401, message: 'Current password does not match.' };
    }

    const passwordHash = await bcrypt.hash(newPassword, securityConfig.saltRounds);

    await authRepository.setPasswordHash(user.id, passwordHash);

    return { message: 'Password changed successfully.' };
  }

  /**
   * Get user profile by ID.
   */
  public async getUserById(userId: number) {
    const user = await authRepository.findProfileById(userId);

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    return user;
  }
}

export const authService = new AuthService();
