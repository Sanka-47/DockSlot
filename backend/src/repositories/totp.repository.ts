import { Prisma } from '@prisma/client';
import { db } from './base.repository';

export const totpRepository = {
  findStatusById(userId: number) {
    return db.user.findUnique({
      where: { id: userId },
      select: { isTwoFactorEnabled: true, totpSecret: true },
    });
  },

  findById(userId: number) {
    return db.user.findUnique({
      where: { id: userId },
    });
  },

  findByIdWithOrganization(userId: number) {
    return db.user.findUnique({
      where: { id: userId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });
  },

  findByEmailWithOrganization(email: string) {
    return db.user.findUnique({
      where: { email },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });
  },

  updateUser(userId: number, data: Prisma.UserUpdateInput) {
    return db.user.update({
      where: { id: userId },
      data,
    });
  },
};
