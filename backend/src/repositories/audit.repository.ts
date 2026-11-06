import { Prisma } from '@prisma/client';
import { DbClient, db } from './base.repository';

export const auditRepository = {
  findActorById(userId: number, client: DbClient = db) {
    return client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
      },
    });
  },

  createLog(
    data: {
      bookingId: number;
      userId: number;
      action: string;
      details: Record<string, unknown>;
    },
    client: DbClient = db
  ) {
    return client.auditLog.create({
      data: {
        bookingId: data.bookingId,
        userId: data.userId,
        action: data.action,
        details: data.details as Prisma.InputJsonValue,
      },
    });
  },
};
