import { Prisma } from '@prisma/client';
import { DbClient, db } from './base.repository';

export const userRepository = {
  findOrganizationById(organizationId: number) {
    return db.organization.findUnique({
      where: { id: organizationId },
    });
  },

  findByEmail(email: string) {
    return db.user.findUnique({
      where: { email },
    });
  },

  createInvitedUser(data: Prisma.UserUncheckedCreateInput) {
    return db.user.create({
      data,
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
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

  findSummaryById(userId: number) {
    return db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
      },
    });
  },

  updateSummaryById(userId: number, data: Prisma.UserUpdateInput) {
    return db.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
      },
    });
  },

  findOrganizationUsers(organizationId: number) {
    return db.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  findActiveStatusById(userId: number, client: DbClient = db) {
    return client.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });
  },

  findEmailVerificationStatusById(userId: number) {
    return db.user.findUnique({
      where: { id: userId },
      select: { isEmailVerified: true },
    });
  },
};
