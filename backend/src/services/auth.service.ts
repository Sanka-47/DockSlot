import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { UserRole, OrganizationType } from '@prisma/client';
import { prisma } from '../config/db.config';
import { securityConfig } from '../config/security.config';
import { emailService } from './email.service';

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

export interface AuthResponse {
  token: string;
  user: {
    id: number;
    email: string;
    role: UserRole;
    organizationId: number;
    isEmailVerified: boolean;
    organization?: {
      id: number;
      name: string;
      type: OrganizationType;
    };
  };
}

export class AuthService {
  /**
   * Helper to issue a signed JWT token containing user ID, organization ID, and role.
   */
  public generateToken(user: { id: number; organizationId: number; role: UserRole; email: string }): string {
    return jwt.sign(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
        email: user.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: securityConfig.jwtExpiresIn as any }
    );
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
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

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
      const { user, organization } = await prisma.$transaction(async (tx) => {
        const newOrg = await tx.organization.create({
          data: {
            name: orgName,
            type: orgType,
          },
        });

        const newUser = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            role: adminRole,
            organizationId: newOrg.id,
            isActive: true,
            isEmailVerified: false,
            verificationToken,
          },
        });

        return { user: newUser, organization: newOrg };
      });

      // Send verification email asynchronously
      emailService.sendVerificationEmail(user.email, verificationToken).catch((err) => {
        console.error('[AuthService] Error dispatching verification email:', err);
      });

      const token = this.generateToken(user);

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          isEmailVerified: user.isEmailVerified,
          organization: {
            id: organization.id,
            name: organization.name,
            type: organization.type,
          },
        },
      };
    }

    // Scenario B: Joining an existing Organization (e.g., invited employee/dispatcher)
    const existingOrg = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!existingOrg) {
      throw { status: 404, message: `Organization with ID ${organizationId} not found.` };
    }

    const assignedRole =
      role ||
      (existingOrg.type === OrganizationType.WAREHOUSE_OPERATOR
        ? UserRole.DOCK_MANAGER
        : UserRole.DISPATCHER);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: assignedRole,
        organizationId: existingOrg.id,
        isActive: true,
        isEmailVerified: false,
        verificationToken,
      },
    });

    // Send verification email asynchronously
    emailService.sendVerificationEmail(user.email, verificationToken).catch((err) => {
      console.error('[AuthService] Error dispatching verification email:', err);
    });

    const token = this.generateToken(user);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        isEmailVerified: user.isEmailVerified,
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

    const user = await prisma.user.findUnique({
      where: { verificationToken: token.trim() },
    });

    if (!user) {
      throw { status: 400, message: 'Invalid or expired verification token.' };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        verificationToken: null,
      },
    });

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
      user = await prisma.user.findUnique({ where: { id: userId } });
    } else if (email) {
      user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
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

    await prisma.user.update({
      where: { id: user.id },
      data: { verificationToken },
    });

    // Send verification email
    await emailService.sendVerificationEmail(user.email, verificationToken);

    return { message: 'A new verification email has been sent to your email address.' };
  }

  /**
   * Login an existing user and issue a JWT token.
   */
  public async login(input: LoginInput): Promise<AuthResponse> {
    const { email, password } = input;

    if (!email || !password) {
      throw { status: 400, message: 'Email and password are required.' };
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
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

    if (!user) {
      throw { status: 401, message: 'Invalid email or password.' };
    }

    if (!user.isActive) {
      throw { status: 403, message: 'Account is deactivated. Please contact support.' };
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw { status: 401, message: 'Invalid email or password.' };
    }

    const token = this.generateToken(user);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        isEmailVerified: user.isEmailVerified,
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
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return genericSuccess;
    }

    // Generate secure random reset token and set expiration (1 hour from now)
    const resetPasswordToken = crypto.randomBytes(32).toString('hex');
    const resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken,
        resetPasswordExpires,
      },
    });

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

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: token.trim(),
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      throw { status: 400, message: 'Invalid or expired password reset token.' };
    }

    const passwordHash = await bcrypt.hash(newPassword, securityConfig.saltRounds);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

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

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) {
      throw { status: 401, message: 'Current password does not match.' };
    }

    const passwordHash = await bcrypt.hash(newPassword, securityConfig.saltRounds);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return { message: 'Password changed successfully.' };
  }

  /**
   * Get user profile by ID.
   */
  public async getUserById(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
        updatedAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    return user;
  }
}

export const authService = new AuthService();
