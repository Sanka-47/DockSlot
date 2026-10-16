import { Request, Response, NextFunction } from 'express';
import { verifyJwtToken } from '../utils/jwt.utils';
import { prisma } from '../config/db.config';
import redis from '../config/redis';

export interface AuthPayload {
  userId: number;
  organizationId: number;
  role: string;
  email: string;
  tokenVersion?: number;
}

export interface TenantContext {
  organizationId: number;
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

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Access denied. Missing or invalid Authorization header.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  let decoded: any;
  try {
    // Step 1: Verify the JWT signature cryptographically (stateless, zero latency)
    decoded = verifyJwtToken(token);
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
    return;
  }

  try {
    const userId = decoded.userId || decoded.id;
    const organizationId = decoded.organizationId || decoded.organization_id;

    // Step 2: Check MySQL/Prisma or Redis for isActive status
    const cachedActive = await redis.get(`user:${userId}:isActive`);
    if (cachedActive === '0' || cachedActive === 'false') {
      res.status(403).json({
        success: false,
        message: 'Account has been deactivated',
      });
      return;
    }

    if (cachedActive === null) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isActive: true },
      });

      if (!user || user.isActive === false) {
        await redis.set(`user:${userId}:isActive`, '0');
        res.status(403).json({
          success: false,
          message: 'Account has been deactivated',
        });
        return;
      }
      // Cache active status
      await redis.set(`user:${userId}:isActive`, '1');
    }

    // Step 3: Check Redis for the user's current token version
    const currentVersionStr = await redis.get(`user:${userId}:tokenVersion`);
    const currentTokenVersion = currentVersionStr !== null ? parseInt(currentVersionStr, 10) : 0;
    const tokenVersionInJwt = decoded.tokenVersion ?? 0;

    if (tokenVersionInJwt !== currentTokenVersion) {
      res.status(401).json({
        success: false,
        message: 'Account has been deactivated',
      });
      return;
    }

    const userPayload: AuthPayload = {
      userId,
      organizationId,
      role: decoded.role,
      email: decoded.email,
      tokenVersion: tokenVersionInJwt,
    };

    req.user = userPayload;
    req.tenant = {
      organizationId,
      role: decoded.role,
    };

    next();
  } catch (error: any) {
    next(error);
  }
};

export const authMiddleware = authenticate;

export default authenticate;
