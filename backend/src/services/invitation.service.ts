import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/db.config';
import { securityConfig } from '../config/security.config';
import { signAccessToken, signRefreshToken } from '../utils/jwt.utils';
import { emailService } from './email.service';
import redis from '../config/redis';

export interface CreateInvitationInput {
  email: string;
}

export interface RequesterContext {
  userId: number;
  organizationId: number;
  role: string;
}

export interface InvitationResponse {
  invitation: {
    id: number;
    email: string;
    organizationId: number;
    role: string;
    token: string;
    expiresAt: Date;
    status: string;
    createdAt: Date;
  };
  message: string;
}

export interface AcceptInvitationInput {
  token: string;
  password: string;
}

export interface AcceptInvitationResponse {
  token: string;
  refreshToken?: string;
  user: {
    id: number;
    email: string;
    role: UserRole;
    organizationId: number;
    isEmailVerified: boolean;
    organization?: {
      id: number;
      name: string;
      type: string;
    };
  };
}

export class InvitationService {
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
   * Create or refresh an invitation for a new team member.
   * - Restricted strictly to CARRIER_ADMIN or WAREHOUSE_ADMIN.
   * - CARRIER_ADMIN -> "DISPATCHER"
   * - WAREHOUSE_ADMIN -> "DOCK_MANAGER"
   * - Token expiration: 48 hours
   * - Rejects if email belongs to an existing user (409 Conflict)
   */
  public async createInvitation(
    requester: RequesterContext,
    input: CreateInvitationInput
  ): Promise<InvitationResponse> {
    const { email } = input;

    if (!email || typeof email !== 'string') {
      throw { status: 400, message: 'A valid email address is required.' };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      throw { status: 400, message: 'Invalid email address format.' };
    }

    // Role mapping
    let targetRole: string;
    if (requester.role === 'CARRIER_ADMIN') {
      targetRole = 'DISPATCHER';
    } else if (requester.role === 'WAREHOUSE_ADMIN') {
      targetRole = 'DOCK_MANAGER';
    } else {
      throw {
        status: 403,
        message: `Only Carrier Admin and Warehouse Admin are authorized to invite User`,
      };
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw { status: 409, message: 'A user with this email already exists.' };
    }

    // Verify requester organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: requester.organizationId },
    });

    if (!organization) {
      throw { status: 404, message: 'Requester organization not found.' };
    }

    // Generate secure random token and 48-hour expiration
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Upsert invitation record (handles fresh invites and resends)
    const invitation = await prisma.invitation.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        organizationId: requester.organizationId,
        role: targetRole,
        token,
        expiresAt,
        status: 'PENDING',
      },
      update: {
        organizationId: requester.organizationId,
        role: targetRole,
        token,
        expiresAt,
        status: 'PENDING',
      },
    });

    // Send invitation email asynchronously
    emailService
      .sendInvitationEmail(normalizedEmail, organization.name, targetRole, token)
      .catch((err) => {
        console.error('[InvitationService] Failed to dispatch invitation email:', err);
      });

    return {
      invitation,
      message: `Invitation successfully created for ${normalizedEmail} as ${targetRole}.`,
    };
  }

  /**
   * Accept an invitation and create user account.
   */
  public async acceptInvitation(input: AcceptInvitationInput): Promise<AcceptInvitationResponse> {
    const { token, password } = input;

    if (!token || typeof token !== 'string') {
      throw { status: 400, message: 'Invitation token is required.' };
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      throw { status: 400, message: 'Password must be at least 6 characters long.' };
    }

    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: { organization: true },
    });

    if (!invitation) {
      throw { status: 404, message: 'Invalid or non-existent invitation token.' };
    }

    if (invitation.status !== 'PENDING') {
      throw { status: 400, message: `Invitation cannot be accepted. Current status is ${invitation.status}.` };
    }

    if (new Date(invitation.expiresAt) <= new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      }).catch(() => {});
      throw { status: 400, message: 'Invitation token has expired.' };
    }

    // Check if user with this email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
    });

    if (existingUser) {
      throw { status: 409, message: 'A user with this email already exists.' };
    }

    const passwordHash = await bcrypt.hash(password, securityConfig.saltRounds);

    const { user, organization } = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          role: invitation.role as UserRole,
          organizationId: invitation.organizationId,
          isActive: true,
          isEmailVerified: true,
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });

      return { user: newUser, organization: invitation.organization };
    });

    const version = await redis.get(`user:${user.id}:tokenVersion`);
    const tokenVersion = version !== null ? parseInt(version, 10) : 0;
    const jwtToken = this.generateToken(user, tokenVersion);

    return {
      token: jwtToken,
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

  /**
   * Get public invitation details by secure token to populate registration modal.
   */
  public async getInvitationByToken(token: string) {
    if (!token || typeof token !== 'string') {
      throw { status: 400, message: 'Invitation token is required.' };
    }

    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: { organization: true },
    });

    if (!invitation) {
      throw { status: 404, message: 'Invalid or non-existent invitation token.' };
    }

    if (invitation.status !== 'PENDING') {
      throw {
        status: 400,
        message: `Invitation cannot be accepted. Current status is ${invitation.status}.`,
      };
    }

    if (new Date(invitation.expiresAt) <= new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      }).catch(() => {});
      throw { status: 400, message: 'Invitation token has expired.' };
    }

    return {
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.organization?.name || 'Organization',
      expiresAt: invitation.expiresAt,
    };
  }
}

export const invitationService = new InvitationService();
