import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { userRepository } from '../repositories/user.repository';
import { securityConfig } from '../config/security.config';
import { emailService } from './email.service';
import { authService } from './auth.service';
import { createVerificationToken } from '../utils/verificationToken';
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
        message: `Only Carrier Admin and Warehouse Admin  are authorized to invite Users`,
      };
    }

    // Verify requester organization exists
    const organization = await userRepository.findOrganizationById(requester.organizationId);

    if (!organization) {
      throw { status: 404, message: 'Requester organization not found.' };
    }

    // Check if user already exists
    const existingUser = await userRepository.findByEmail(normalizedEmail);

    if (existingUser) {
      throw { status: 409, message: 'A user with this email already exists.' };
    }

    // Generate random secure temporary password and hash it
    const temporaryPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, securityConfig.saltRounds);

    // Generate a 24-hour verification/invitation token; persist only its hash.
    const verification = createVerificationToken();

    // Create user record linked to requester's organization
    const newUser = await userRepository.createInvitedUser({
      email: normalizedEmail,
      passwordHash,
      role: targetRole,
      organizationId: requester.organizationId,
      isActive: true,
      isEmailVerified: false,
      verificationToken: verification.tokenHash,
      verificationTokenExpires: verification.expiresAt,
    });

    // Dispatch invitation email asynchronously
    emailService
      .sendInvitationEmail(newUser.email, organization.name, targetRole, verification.token)
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
        message: `Only Carrier Admin and Wharehouse Admins are authorized to diactivate Users.`,
      };
    }

    const targetUser = await userRepository.findSummaryById(targetUserId);

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
    const updatedUser = await userRepository.updateSummaryById(targetUserId, { isActive: false });

    // Step 2: Sever access immediately. tokenVersion is durable in MySQL and
    // every refresh session is revoked, so re-enabling the account does not
    // resurrect previously issued credentials.
    await redis.set(`user:${targetUserId}:isActive`, '0');
    await authService.logoutAll(targetUserId);

    return {
      user: updatedUser,
      message: `User ${updatedUser.email} has been deactivated successfully.`,
    };
  }

  /**
   * Reactivate a previously deactivated user belonging to the requester's organization.
   * Restricted strictly to CARRIER_ADMIN or WAREHOUSE_ADMIN.
   */
  public async reactivateUser(
    requester: RequesterContext,
    targetUserId: number
  ): Promise<{ user: { id: number; email: string; role: UserRole; organizationId: number; isActive: boolean }; message: string }> {
    if (!targetUserId || isNaN(targetUserId)) {
      throw { status: 400, message: 'A valid target user ID is required.' };
    }

    if (requester.role !== 'CARRIER_ADMIN' && requester.role !== 'WAREHOUSE_ADMIN') {
      throw {
        status: 403,
        message: `Only Carrier Admin and Warehouse Admin are authorized to Reactivate User.`,
      };
    }

    const targetUser = await userRepository.findSummaryById(targetUserId);

    if (!targetUser) {
      throw { status: 404, message: 'User not found.' };
    }

    // Tenant isolation: Admin can only reactivate users in their own organization
    if (targetUser.organizationId !== requester.organizationId) {
      throw {
        status: 403,
        message: 'Forbidden. You cannot reactivate users belonging to another organization.',
      };
    }

    // Step 1: Update MySQL to set isActive = true and clear failed login locks
    const updatedUser = await userRepository.updateSummaryById(targetUserId, {
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    });

    // Step 2: Update Redis cache to reflect active status
    await redis.set(`user:${targetUserId}:isActive`, '1');

    return {
      user: updatedUser,
      message: `User ${updatedUser.email} has been reactivated successfully.`,
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
        message: `You do not have authorization to list organization users.`,
      };
    }

    const users = await userRepository.findOrganizationUsers(requester.organizationId);

    return users;
  }
}

export const userService = new UserService();
