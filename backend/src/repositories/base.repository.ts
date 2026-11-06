import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/db.config';

/**
 * A Prisma client that can be either the root client or a transaction client.
 * Repository methods accept this so callers can compose several writes into a
 * single transaction without repositories owning transaction boundaries.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export const db: DbClient = prisma;

/**
 * Runs a callback inside a Prisma transaction and hands it the transaction
 * client. Repositories use this instead of touching `prisma` directly.
 */
export function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number }
): Promise<T> {
  return prisma.$transaction(fn, options);
}

/** Closes the underlying database connection pool. */
export function disconnect(): Promise<void> {
  return prisma.$disconnect();
}
