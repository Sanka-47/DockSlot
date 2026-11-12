import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import { hashOpaqueToken } from '../src/utils/tokenHash';
import { OrganizationType, UserRole } from '@prisma/client';

describe('email verification token hygiene', () => {
  const ts = Date.now();
  let orgId: number;
  const userIds: number[] = [];

  const createPendingUser = async (label: string, expiresAt: Date) => {
    const rawToken = `verify-${label}-${ts}`;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `verify_${label}_${ts}@dockslot.test`,
        passwordHash: 'unused-in-this-test',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: false,
        verificationToken: hashOpaqueToken(rawToken),
        verificationTokenExpires: expiresAt,
      },
    });
    userIds.push(user.id);
    return { user, rawToken };
  };

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Verification Test Org ${ts}`, type: OrganizationType.CARRIER },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  });

  it('stores only a hash and verifies a valid 24-hour token', async () => {
    const { user, rawToken } = await createPendingUser(
      'valid',
      new Date(Date.now() + 60 * 60 * 1000)
    );

    const stored = await prisma.user.findUnique({
      where: { id: user.id },
      select: { verificationToken: true },
    });
    expect(stored?.verificationToken).toBe(hashOpaqueToken(rawToken));
    expect(stored?.verificationToken).not.toBe(rawToken);

    const res = await request(app)
      .get('/api/auth/verify')
      .query({ token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const verified = await prisma.user.findUnique({ where: { id: user.id } });
    expect(verified?.isEmailVerified).toBe(true);
    expect(verified?.verificationToken).toBeNull();
    expect(verified?.verificationTokenExpires).toBeNull();
  });

  it('rejects and consumes an expired verification token', async () => {
    const { user, rawToken } = await createPendingUser(
      'expired',
      new Date(Date.now() - 60 * 1000)
    );

    const res = await request(app)
      .get('/api/auth/verify')
      .query({ token: rawToken });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.isEmailVerified).toBe(false);
    expect(after?.verificationToken).toBeNull();
    expect(after?.verificationTokenExpires).toBeNull();
  });

  it('does not accept a raw token if a legacy plaintext value is stored', async () => {
    const rawToken = `legacy-plaintext-${ts}`;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `verify_legacy_${ts}@dockslot.test`,
        passwordHash: 'unused-in-this-test',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: false,
        verificationToken: rawToken,
        verificationTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    userIds.push(user.id);

    const res = await request(app)
      .get('/api/auth/verify')
      .query({ token: rawToken });

    expect(res.status).toBe(400);
  });
});
