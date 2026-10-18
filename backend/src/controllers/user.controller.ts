import { Request, Response } from 'express';
import { userService } from '../services/user.service';
import { sendError } from '../utils/httpError';

export { inviteUser } from './invitation.controller';

export const deactivateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const requester = req.user;
    if (!requester) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required.',
      });
      return;
    }

    const targetUserIdParam = req.params.id;
    const targetUserId = parseInt(
      typeof targetUserIdParam === 'string' ? targetUserIdParam : '',
      10
    );
    if (isNaN(targetUserId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid target user ID.',
      });
      return;
    }

    const isReactivating = req.body?.isActive === true || req.body?.action === 'reactivate';

    const result = isReactivating
      ? await userService.reactivateUser(
          {
            userId: requester.userId,
            organizationId: requester.organizationId,
            role: requester.role,
          },
          targetUserId
        )
      : await userService.deactivateUser(
          {
            userId: requester.userId,
            organizationId: requester.organizationId,
            role: requester.role,
          },
          targetUserId
        );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.user,
    });
  } catch (error: any) {
    sendError(res, error, 'Failed to update user status.');
  }
};

export const reactivateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const requester = req.user;
    if (!requester) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required.',
      });
      return;
    }

    const targetUserIdParam = req.params.id;
    const targetUserId = parseInt(
      typeof targetUserIdParam === 'string' ? targetUserIdParam : '',
      10
    );
    if (isNaN(targetUserId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid target user ID.',
      });
      return;
    }

    const result = await userService.reactivateUser(
      {
        userId: requester.userId,
        organizationId: requester.organizationId,
        role: requester.role,
      },
      targetUserId
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.user,
    });
  } catch (error: any) {
    sendError(res, error, 'Failed to reactivate user.');
  }
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const requester = req.user;
    if (!requester) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required.',
      });
      return;
    }

    const users = await userService.getOrganizationUsers({
      userId: requester.userId,
      organizationId: requester.organizationId,
      role: requester.role,
    });

    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error: any) {
    sendError(res, error, 'Failed to retrieve organization users.');
  }
};
