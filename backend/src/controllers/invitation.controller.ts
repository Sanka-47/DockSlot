import { Request, Response } from 'express';
import { invitationService } from '../services/invitation.service';
import { mailConfig } from '../config/mail.config';
import { sendError } from '../utils/httpError';

export const inviteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
      return;
    }

    // Accepts only email from request body
    const { email } = req.body;

  const result = await invitationService.createInvitation(
      {
        userId: req.user.userId,
        organizationId: req.user.organizationId,
        role: req.user.role,
      },
      { email }
    );

    const inviteUrl = `${mailConfig.frontendUrl}/accept-invite?token=${result.invitation.token}`;
    console.log(`[InvitationController] Invitation link for ${email} (${result.invitation.role}): ${inviteUrl}`);

    res.status(201).json({
      success: true,
      message: result.message,
      data: {
        ...result.invitation,
        inviteUrl,
      },
      invitation: {
        ...result.invitation,
        inviteUrl,
      },
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while creating the invitation.');
  }
};
