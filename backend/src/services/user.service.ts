import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/db.config';
import { securityConfig } from '../config/security.config';
import { emailService } from './email.service';

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
}

export const userService = new UserService();
