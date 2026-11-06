import { Prisma } from '@prisma/client';
import { DbClient, db, transaction } from './base.repository';

export const invitationRepository = {
  transaction,

  findUserByEmail(email: string) {
    return db.user.findUnique({
      where: { email },
    });
  },

  findOrganizationById(organizationId: number) {
    return db.organization.findUnique({
      where: { id: organizationId },
    });
  },

  upsertInvitation(
    email: string,
    data: {
      organizationId: number;
      role: string;
      token: string;
      expiresAt: Date;
    }
  ) {
    return db.invitation.upsert({
      where: { email },
      create: {
        email,
        organizationId: data.organizationId,
        role: data.role,
        token: data.token,
        expiresAt: data.expiresAt,
        status: 'PENDING',
      },
      update: {
        organizationId: data.organizationId,
        role: data.role,
        token: data.token,
        expiresAt: data.expiresAt,
        status: 'PENDING',
      },
    });
  },

  findByToken(token: string) {
    return db.invitation.findUnique({
      where: { token },
      include: { organization: true },
    });
  },

  updateStatus(invitationId: number, status: string, client: DbClient = db) {
    return client.invitation.update({
      where: { id: invitationId },
      data: { status },
    });
  },

  createUser(data: Prisma.UserUncheckedCreateInput, client: DbClient = db) {
    return client.user.create({ data });
  },
};
