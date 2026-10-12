import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../config/security.config';

export interface AuthPayload {
  userId: number;
  organizationId: number;
  organization_id: number;
  role: string;
  email: string;
}

export interface TenantContext {
  organization_id: number;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      tenant?: TenantContext;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Access denied. Missing or invalid Authorization header.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, securityConfig.jwtSecret) as any;

    const organization_id = decoded.organization_id || decoded.organizationId;

    const userPayload: AuthPayload = {
      userId: decoded.userId || decoded.id,
      organizationId: organization_id,
      organization_id: organization_id,
      role: decoded.role,
      email: decoded.email,
    };

    req.user = userPayload;
    req.tenant = {
      organization_id: organization_id,
      role: decoded.role,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.',
      });
      return;
    }

    res.status(401).json({
      success: false,
      message: 'Invalid authorization token.',
    });
  }
};

export default authenticate;
