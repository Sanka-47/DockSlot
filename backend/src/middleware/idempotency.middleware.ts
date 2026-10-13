import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db.config';

// 24 hours TTL for short-term mobile network retries
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyCustomRequest extends Request {
  idempotencyKey?: string;
}

/**
 * Cleans up idempotency records older than the specified hours (default: 24h).
 */
export async function cleanupExpiredIdempotencyRecords(olderThanHours: number = 24): Promise<number> {
  const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const result = await prisma.idempotencyRecord.deleteMany({
    where: {
      createdAt: {
        lt: cutoffDate,
      },
    },
  });
  return result.count;
}

/**
 * Idempotency middleware for POST endpoints (e.g. /api/bookings).
 * Checks the Idempotency-Key header. If present and previously cached within TTL,
 * immediately replays the cached status code and JSON response body.
 */
export const idempotencyMiddleware = async (
  req: IdempotencyCustomRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const rawKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  const idempotencyKey = typeof rawKey === 'string' ? rawKey.trim() : Array.isArray(rawKey) ? rawKey[0].trim() : undefined;

  // If no idempotency key is provided, proceed normally
  if (!idempotencyKey) {
    next();
    return;
  }

  try {
    // Opportunistically prune older records in the background without blocking request
    const cutoffDate = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
    prisma.idempotencyRecord
      .deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      })
      .catch(() => {});

    // Query IdempotencyRecord table for this key
    const existing = await prisma.idempotencyRecord.findUnique({
      where: { key: idempotencyKey },
    });

    if (existing) {
      const recordAge = Date.now() - existing.createdAt.getTime();
      if (recordAge < IDEMPOTENCY_TTL_MS) {
        // Return cached response immediately without re-running booking logic
        res.setHeader('X-Cache-Lookup', 'HIT');
        res.status(existing.responseCode).json(existing.responseBody);
        return;
      }

      // Record is older than 24 hours, delete expired record and allow fresh request
      await prisma.idempotencyRecord.delete({
        where: { key: idempotencyKey },
      });
    }

    // Attach key to request for controller or service awareness
    req.idempotencyKey = idempotencyKey;

    // Intercept res.json to capture and cache the exact JSON payload
    const originalJson = res.json.bind(res);
    res.json = (body: any): Response => {
      // Cache successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const serializableBody = JSON.parse(JSON.stringify(body));
        prisma.idempotencyRecord
          .upsert({
            where: { key: idempotencyKey },
            create: {
              key: idempotencyKey,
              responseCode: res.statusCode,
              responseBody: serializableBody,
            },
            update: {
              responseCode: res.statusCode,
              responseBody: serializableBody,
              createdAt: new Date(),
            },
          })
          .then(() => {
            originalJson(body);
          })
          .catch((err) => {
            console.error('[IdempotencyMiddleware] Failed to store idempotency record:', err);
            originalJson(body);
          });
        return res;
      }

      return originalJson(body);
    };

    next();
  } catch (error) {
    console.error('[IdempotencyMiddleware] Error processing idempotency:', error);
    next();
  }
};

export default idempotencyMiddleware;
