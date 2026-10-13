import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db.config';
import { OrganizationType } from '@prisma/client';

export const authorize = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' is not authorized to perform this action.`,
      });
      return;
    }

    next();
  };
};

/**
 * Middleware restricting access strictly to users with the DISPATCHER role
 * belonging to a CARRIER organization.
 */
export const requireCarrierDispatcher = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
    return;
  }

  if (req.user.role !== 'DISPATCHER') {
    res.status(403).json({
      success: false,
      message: `Forbidden. Role '${req.user.role}' is not authorized to perform this action. Only Carrier Dispatchers are permitted.`,
    });
    return;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { type: true },
  });

  if (!organization || organization.type !== OrganizationType.CARRIER) {
    res.status(403).json({
      success: false,
      message: 'Forbidden. User does not belong to a Carrier organization.',
    });
    return;
  }

  next();
};

/**
 * Middleware restricting access strictly to users with DISPATCHER or CARRIER_ADMIN role
 * belonging to a CARRIER organization.
 */
export const requireCarrierRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
    return;
  }

  if (req.user.role !== 'DISPATCHER' && req.user.role !== 'CARRIER_ADMIN') {
    res.status(403).json({
      success: false,
      message: `Forbidden. Role '${req.user.role}' is not authorized to perform this action.`,
    });
    return;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { type: true },
  });

  if (!organization || organization.type !== OrganizationType.CARRIER) {
    res.status(403).json({
      success: false,
      message: 'Forbidden. User does not belong to a Carrier organization.',
    });
    return;
  }

  next();
};

export const rbacMiddleware = authorize;
export default authorize;
