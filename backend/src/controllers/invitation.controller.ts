import { Request, Response } from 'express';
import { invitationService } from '../services/invitation.service';

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

    res.status(201).json({
      success: true,
      message: result.message,
      data: result.invitation,
      invitation: result.invitation,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred while creating the invitation.',
    });
  }
};
