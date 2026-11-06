import { db } from './base.repository';

export const organizationRepository = {
  findTypeById(organizationId: number) {
    return db.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
  },
};
