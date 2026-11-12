import { Prisma } from '@prisma/client';
import { DbClient, db, transaction } from './base.repository';

export const authRepository = {
  transaction,

  findUserById(userId: number) {
    return db.user.findUnique({
      where: { id: userId },
    });
  },

  findUserByEmail(email: string) {
    return db.user.findUnique({
      where: { email },
    });
  },

  findTokenVersionById(userId: number, client: DbClient = db) {
    return client.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
  },

  incrementTokenVersion(userId: number, client: DbClient = db) {
    return client.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
  },

  findUserByVerificationToken(tokenHash: string) {
    return db.user.findUnique({
      where: { verificationToken: tokenHash },
    });
  },

  findUserByResetToken(token: string) {
    return db.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });
  },

  findUserWithOrganizationById(userId: number) {
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

  findUserWithOrganizationByEmail(email: string) {
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

  findProfileById(userId: number) {
    return db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
        isEmailVerified: true,
        isTwoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
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

  findOrganizationById(organizationId: number) {
    return db.organization.findUnique({
      where: { id: organizationId },
    });
  },

  createOrganization(data: Prisma.OrganizationCreateInput, client: DbClient = db) {
    return client.organization.create({ data });
  },

  createUser(data: Prisma.UserUncheckedCreateInput, client: DbClient = db) {
    return client.user.create({ data });
  },

  updateUser(userId: number, data: Prisma.UserUpdateInput, client: DbClient = db) {
    return client.user.update({
      where: { id: userId },
      data,
    });
  },

  markEmailVerified(userId: number) {
    return this.updateUser(userId, {
      isEmailVerified: true,
      verificationToken: null,
      verificationTokenExpires: null,
    });
  },

  setVerificationToken(
    userId: number,
    verificationTokenHash: string,
    expiresAt: Date
  ) {
    return this.updateUser(userId, {
      verificationToken: verificationTokenHash,
      verificationTokenExpires: expiresAt,
    });
  },

  setPasswordResetToken(userId: number, token: string, expiresAt: Date) {
    return this.updateUser(userId, {
      resetPasswordToken: token,
      resetPasswordExpires: expiresAt,
    });
  },

  clearPasswordResetToken(
    userId: number,
    passwordHash: string,
    client: DbClient = db
  ) {
    return this.updateUser(
      userId,
      {
        passwordHash,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
      client
    );
  },

  setPasswordHash(userId: number, passwordHash: string, client: DbClient = db) {
    return this.updateUser(userId, { passwordHash }, client);
  },
};
