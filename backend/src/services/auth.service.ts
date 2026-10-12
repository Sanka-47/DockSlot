import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserRole, OrganizationType } from '@prisma/client';
import { prisma } from '../config/db.config';
import { securityConfig } from '../config/security.config';

export interface RegisterInput {
  email: string;
  password: string;
  role: UserRole;
  organizationId?: number;
  organizationName?: string;
  organizationType?: OrganizationType;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ResetPasswordInput {
  email?: string;
  userId?: number;
  oldPassword?: string;
  newPassword: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: number;
    email: string;
    role: UserRole;
    organizationId: number;
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
        id: user.id,
        organizationId: user.organizationId,
        organization_id: user.organizationId,
        role: user.role,
        email: user.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: securityConfig.jwtExpiresIn as any }
    );
  }

  /**
   * Register a new user and generate a JWT token.
   */
  public async register(input: RegisterInput): Promise<AuthResponse> {
    const { email, password, role, organizationId, organizationName, organizationType } = input;

    if (!email || !password || !role) {
      throw { status: 400, message: 'Email, password, and role are required.' };
    }

    if (password.length < 6) {
      throw { status: 400, message: 'Password must be at least 6 characters long.' };
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      throw { status: 409, message: 'A user with this email already exists.' };
    }

    let targetOrgId = organizationId;

    // If an organization name & type were provided, create the organization
    if (!targetOrgId && organizationName && organizationType) {
      const newOrg = await prisma.organization.create({
        data: {
          name: organizationName.trim(),
          type: organizationType,
        },
      });
      targetOrgId = newOrg.id;
    }

    if (!targetOrgId) {
      throw { status: 400, message: 'organizationId or organizationName with organizationType is required.' };
    }

    // Verify organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: targetOrgId },
    });

    if (!organization) {
      throw { status: 404, message: `Organization with ID ${targetOrgId} not found.` };
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, securityConfig.saltRounds);

    // Create the user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        role,
        organizationId: targetOrgId,
        isActive: true,
      },
    });

    // Generate JWT token
    const token = this.generateToken(user);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
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
      },
    };
  }

  /**
   * Reset user password.
   */
  public async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const { email, userId, oldPassword, newPassword } = input;

    if (!newPassword || newPassword.length < 6) {
      throw { status: 400, message: 'New password must be at least 6 characters long.' };
    }

    let user;

    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    } else if (email) {
      user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    } else {
      throw { status: 400, message: 'Either email or authenticated user ID must be provided.' };
    }

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    // If oldPassword is provided, verify it
    if (oldPassword) {
      const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
      if (!isMatch) {
        throw { status: 401, message: 'Current password does not match.' };
      }
    }

    // Hash the new password and update
    const passwordHash = await bcrypt.hash(newPassword, securityConfig.saltRounds);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return { message: 'Password has been reset successfully.' };
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
