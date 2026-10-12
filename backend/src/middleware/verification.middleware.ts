import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db.config';

/**
 * Middleware guard that enforces that the authenticated user has verified their email address.
 * If not verified, blocks access with HTTP 403 Forbidden.
 */
export const requireVerifiedEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user?.userId) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized. Authentication required.',
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { isEmailVerified: true },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User account not found.',
      });
      return;
    }

    if (!user.isEmailVerified) {
      res.status(403).json({
        success: false,
        message: 'Email verification required. Please verify your email before proceeding.',
      });
      return;
    }

    next();
  } catch (error) {
    console.error('[VerificationMiddleware] Error verifying user status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error checking account verification.',
    });
  }
};

export default requireVerifiedEmail;
