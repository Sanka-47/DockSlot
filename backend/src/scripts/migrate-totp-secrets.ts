import { PrismaClient } from '@prisma/client';
import { encryptTotpSecret, isEncryptedTotpSecret } from '../utils/totpCrypto';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { totpSecret: { not: null } },
    select: { id: true, email: true, totpSecret: true },
  });

  let migrated = 0;

  for (const user of users) {
    if (!user.totpSecret || isEncryptedTotpSecret(user.totpSecret)) {
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptTotpSecret(user.totpSecret) },
    });
    migrated += 1;
    console.log(`[totp-migration] encrypted secret for user ${user.id} (${user.email})`);
  }

  console.log(`[totp-migration] complete: ${migrated} secret(s) encrypted, ${users.length} scanned.`);
}

main()
  .catch((error) => {
    console.error('[totp-migration] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
