import { Prisma } from '@prisma/client';
import { db } from './base.repository';

export const idempotencyRepository = {
  deleteOlderThan(cutoffDate: Date) {
    return db.idempotencyRecord.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
    });
  },

  findByKey(key: string) {
    return db.idempotencyRecord.findUnique({
      where: { key },
    });
  },

  deleteByKey(key: string) {
    return db.idempotencyRecord.delete({
      where: { key },
    });
  },

  upsertResponse(key: string, responseCode: number, responseBody: Prisma.InputJsonValue) {
    return db.idempotencyRecord.upsert({
      where: { key },
      create: {
        key,
        responseCode,
        responseBody,
      },
      update: {
        responseCode,
        responseBody,
        createdAt: new Date(),
      },
    });
  },
};
