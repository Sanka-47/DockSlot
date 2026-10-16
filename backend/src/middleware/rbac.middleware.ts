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

/**
 * Middleware restricting access strictly to users with the DOCK_MANAGER role
 * belonging to a WAREHOUSE_OPERATOR organization.
 */
export const requireDockManager = async (
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

  if (req.user.role !== 'DOCK_MANAGER') {
    res.status(403).json({
      success: false,
      message: `Forbidden. Role '${req.user.role}' is not authorized to perform this action. Only Dock Managers are permitted.`,
    });
    return;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { type: true },
  });

  if (!organization || organization.type !== OrganizationType.WAREHOUSE_OPERATOR) {
    res.status(403).json({
      success: false,
      message: 'Forbidden. User does not belong to a Warehouse Operator organization.',
    });
    return;
  }

  next();
};

/**
 * Middleware restricting access to users with WAREHOUSE_ADMIN or DOCK_MANAGER role
 * belonging to a WAREHOUSE_OPERATOR organization.
 */
export const requireWarehouseStaff = async (
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

  if (req.user.role !== 'WAREHOUSE_ADMIN' && req.user.role !== 'DOCK_MANAGER') {
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

  if (!organization || organization.type !== OrganizationType.WAREHOUSE_OPERATOR) {
    res.status(403).json({
      success: false,
      message: 'Forbidden. User does not belong to a Warehouse Operator organization.',
    });
    return;
  }

  next();
};

/**
 * Middleware restricting access to booking audit logs.
 * Accessible only to authorized roles on both sides of the transaction:
 * - Warehouse operator side: WAREHOUSE_ADMIN, DOCK_MANAGER
 * - Carrier side: DISPATCHER, CARRIER_ADMIN
 */
export const requireBookingAuditAccess = async (
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

  const allowedRoles = ['WAREHOUSE_ADMIN', 'DOCK_MANAGER', 'CARRIER_ADMIN', 'DISPATCHER'];
  if (!allowedRoles.includes(req.user.role)) {
    res.status(403).json({
      success: false,
      message: `Forbidden. Role '${req.user.role}' is not authorized to view booking audit logs.`,
    });
    return;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { type: true },
  });

  if (!organization) {
    res.status(403).json({
      success: false,
      message: 'Forbidden. User organization not found.',
    });
    return;
  }

  const isWarehouseAuthorized =
    (req.user.role === 'WAREHOUSE_ADMIN' || req.user.role === 'DOCK_MANAGER') &&
    organization.type === OrganizationType.WAREHOUSE_OPERATOR;

  const isCarrierAuthorized =
    (req.user.role === 'CARRIER_ADMIN' || req.user.role === 'DISPATCHER') &&
    organization.type === OrganizationType.CARRIER;

  if (!isWarehouseAuthorized && !isCarrierAuthorized) {
    res.status(403).json({
      success: false,
      message: 'Forbidden. Role does not match organization type.',
    });
    return;
  }

  next();
};

export const rbacMiddleware = authorize;
export default authorize;
