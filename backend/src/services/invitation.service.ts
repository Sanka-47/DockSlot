import crypto from 'crypto';
import { prisma } from '../config/db.config';
import { emailService } from './email.service';

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

export class InvitationService {
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
        message: `Forbidden. Role '${requester.role}' cannot invite users. Only CARRIER_ADMIN and WAREHOUSE_ADMIN are authorized.`,
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
}

export const invitationService = new InvitationService();
