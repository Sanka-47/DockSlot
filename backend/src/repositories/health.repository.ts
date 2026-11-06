import { db } from './base.repository';

export const healthRepository = {
  ping() {
    return db.$queryRaw`SELECT 1`;
  },
};
