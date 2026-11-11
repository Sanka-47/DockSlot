import { Prisma } from '@prisma/client';
import { DbClient, db } from './base.repository';

/**
 * Data-access helpers for stateful refresh-token sessions. Rotation and reuse
 * detection are orchestrated by AuthService inside a transaction; this module
 * only owns the queries.
 */
export const refreshSessionRepository = {
  create(data: Prisma.RefreshSessionUncheckedCreateInput, client: DbClient = db) {
    return client.refreshSession.create({ data });
  },

  findByJti(jti: string, client: DbClient = db) {
    return client.refreshSession.findUnique({ where: { jti } });
  },

  findFamily(familyId: string, client: DbClient = db) {
    return client.refreshSession.findMany({
      where: { familyId },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * Atomically revokes a session only if it is still active. The returned count
   * tells the caller whether it won a concurrent rotation race.
   */
  revokeActiveByJti(
    jti: string,
    data: Prisma.RefreshSessionUpdateManyMutationInput,
    client: DbClient = db
  ) {
    return client.refreshSession.updateMany({
      where: { jti, revokedAt: null },
      data,
    });
  },

  revokeByJti(
    jti: string,
    reason: string,
    client: DbClient = db,
    now: Date = new Date()
  ) {
    return client.refreshSession.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  },

  revokeFamily(
    familyId: string,
    reason: string,
    client: DbClient = db,
    now: Date = new Date()
  ) {
    return client.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  },

  revokeAllForUser(
    userId: number,
    reason: string,
    client: DbClient = db,
    now: Date = new Date()
  ) {
    return client.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  },

  deleteExpired(now: Date = new Date(), client: DbClient = db) {
    return client.refreshSession.deleteMany({
      where: { expiresAt: { lt: now } },
    });
  },
};
