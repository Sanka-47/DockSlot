import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.utils';
import { userRepository } from '../repositories/user.repository';
import redis from '../config/redis';
import { securityConfig } from '../config/security.config';

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
    decoded = verifyAccessToken(token);
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

    // Reject short-lived intermediate tokens (2FA login challenge, refresh tokens).
    // Only a fully authenticated access token may pass this middleware.
    if (decoded.type === '2fa_temp' || decoded.type === 'refresh') {
      res.status(401).json({
        success: false,
        message: 'Invalid authorization token.',
      });
      return;
    }

    // Step 2: Check MySQL/Prisma or Redis for isActive and tokenVersion.
    // tokenVersion is durable in MySQL; Redis is only a short-lived cache.
    const activeKey = `user:${userId}:isActive`;
    const versionKey = `user:${userId}:tokenVersion`;
    const [cachedActive, cachedVersion] = await Promise.all([
      redis.get(activeKey),
      redis.get(versionKey),
    ]);

    if (cachedActive === '0' || cachedActive === 'false') {
      res.status(403).json({
        success: false,
        message: 'Account has been deactivated',
      });
      return;
    }

    let currentTokenVersion: number;
    if (cachedActive === null || cachedVersion === null) {
      const authState = await userRepository.findAuthStateById(userId);

      if (!authState || authState.isActive === false) {
        await redis.set(activeKey, '0');
        res.status(403).json({
          success: false,
          message: 'Account has been deactivated',
        });
        return;
      }

      currentTokenVersion = authState.tokenVersion;
      await Promise.all([
        redis.set(activeKey, '1'),
        redis.set(
          versionKey,
          String(currentTokenVersion),
          'EX',
          securityConfig.tokenVersionCacheTtlSeconds
        ),
      ]);
    } else {
      const parsed = parseInt(cachedVersion, 10);
      currentTokenVersion = Number.isNaN(parsed) ? 0 : parsed;
    }

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
