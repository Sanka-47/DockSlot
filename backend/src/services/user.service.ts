import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/db.config';
import { securityConfig } from '../config/security.config';
import { emailService } from './email.service';
import redis from '../config/redis';

export interface InviteUserInput {
  email: string;
}

export interface RequesterContext {
  userId: number;
  organizationId: number;
  role: string;
}

export interface InvitedUserDTO {
  id: number;
  email: string;
  role: UserRole;
  organizationId: number;
  isActive: boolean;
  isEmailVerified: boolean;
  createdAt: Date;
  organization?: {
    id: number;
    name: string;
    type: string;
  };
}

export interface InviteUserResponse {
  user: InvitedUserDTO;
  message: string;
}

export class UserService {
  /**
   * Invite a new user to the requester's organization.
   * Restricts role assignment strictly based on the requester's admin type:
   * - CARRIER_ADMIN -> DISPATCHER (Carrier Organization)
   * - WAREHOUSE_ADMIN -> DOCK_MANAGER (Warehouse Operator Organization)
   */
  public async inviteUser(
    requester: RequesterContext,
    input: InviteUserInput
  ): Promise<InviteUserResponse> {
    const { email } = input;

    // Validate email presence and format
    if (!email || typeof email !== 'string') {
      throw { status: 400, message: 'A valid email address is required.' };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      throw { status: 400, message: 'Invalid email address format.' };
    }

    // Determine target role strictly by requester role
    let targetRole: UserRole;
    if (requester.role === 'CARRIER_ADMIN') {
      targetRole = UserRole.DISPATCHER;
    } else if (requester.role === 'WAREHOUSE_ADMIN') {
      targetRole = UserRole.DOCK_MANAGER;
    } else {
      throw {
        status: 403,
        message: `Forbidden. Role '${requester.role}' cannot invite users. Only CARRIER_ADMIN and WAREHOUSE_ADMIN are authorized.`,
      };
    }

    // Verify requester organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: requester.organizationId },
    });

    if (!organization) {
      throw { status: 404, message: 'Requester organization not found.' };
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw { status: 409, message: 'A user with this email already exists.' };
    }

    // Generate random secure temporary password and hash it
    const temporaryPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, securityConfig.saltRounds);

    // Generate verification/invitation token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Create user record linked to requester's organization
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: targetRole,
        organizationId: requester.organizationId,
        isActive: true,
        isEmailVerified: false,
        verificationToken,
      },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    // Dispatch invitation email asynchronously
    emailService
      .sendInvitationEmail(newUser.email, organization.name, targetRole, verificationToken)
      .catch((err) => {
        console.error('[UserService] Failed to dispatch invitation email:', err);
      });

    return {
      user: newUser,
      message: `Invitation successfully sent to ${newUser.email} as ${targetRole}.`,
    };
  }

  /**
   * Deactivate a user belonging to the requester's organization and invalidate their active sessions.
   * Restricted strictly to CARRIER_ADMIN or WAREHOUSE_ADMIN.
   */
  public async deactivateUser(
    requester: RequesterContext,
    targetUserId: number
  ): Promise<{ user: { id: number; email: string; role: UserRole; organizationId: number; isActive: boolean }; message: string }> {
    if (!targetUserId || isNaN(targetUserId)) {
      throw { status: 400, message: 'A valid target user ID is required.' };
    }

    if (requester.role !== 'CARRIER_ADMIN' && requester.role !== 'WAREHOUSE_ADMIN') {
      throw {
        status: 403,
        message: `Forbidden. Role '${requester.role}' cannot deactivate users. Only CARRIER_ADMIN and WAREHOUSE_ADMIN are authorized.`,
      };
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
      },
    });

    if (!targetUser) {
      throw { status: 404, message: 'User not found.' };
    }

    // Tenant isolation: Admin can only deactivate users in their own organization
    if (targetUser.organizationId !== requester.organizationId) {
      throw {
        status: 403,
        message: 'Forbidden. You cannot deactivate users belonging to another organization.',
      };
    }

    // Step 1: Update MySQL to set isActive = false
    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: { isActive: false },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
      },
    });

    // Step 2: Sever access immediately via Redis cache & token version increment
    await redis.set(`user:${targetUserId}:isActive`, '0');
    await redis.incr(`user:${targetUserId}:tokenVersion`);

    return {
      user: updatedUser,
      message: `User ${updatedUser.email} has been deactivated successfully.`,
    };
  }

  /**
   * Retrieve all users belonging to the requester's organization.
   * Restricted to organization admins.
   */
  public async getOrganizationUsers(requester: RequesterContext) {
    if (requester.role !== 'CARRIER_ADMIN' && requester.role !== 'WAREHOUSE_ADMIN') {
      throw {
        status: 403,
        message: `Forbidden. Role '${requester.role}' cannot list organization users.`,
      };
    }

    const users = await prisma.user.findMany({
      where: { organizationId: requester.organizationId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }
}

export const userService = new UserService();
