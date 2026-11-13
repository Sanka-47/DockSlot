import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import redis from '../src/config/redis';
import { securityConfig } from '../src/config/security.config';
import { signAccessToken } from '../src/utils/jwt.utils';
import { isEncryptedTotpSecret } from '../src/utils/totpCrypto';
import { OrganizationType, UserRole } from '@prisma/client';

describe('TOTP secret encryption in the 2FA flow', () => {
  const ts = Date.now();
  const email = `totp_encryption_${ts}@dockslot.test`;
  const password = 'Password123!';

  let orgId: number;
  let userId: number;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `TOTP Encryption Org ${ts}`, type: OrganizationType.CARRIER },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email,
        passwordHash: await bcrypt.hash(password, securityConfig.saltRounds),
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await redis.del(`user:${userId}:tokenVersion`, `user:${userId}:isActive`).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  });

  it('stores an encrypted secret, lazily migrates plaintext, and logs in', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const accessToken = signAccessToken({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
      tokenVersion: user.tokenVersion,
    });

    const missingPassword = await request(app)
      .post('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(missingPassword.status).toBe(400);

    const wrongPassword = await request(app)
      .post('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: 'WrongPassword123!' });

    expect(wrongPassword.status).toBe(401);

    const setup = await request(app)
      .post('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password });

    expect(setup.status).toBe(200);
    const secret: string = setup.body.data.secret;
    expect(secret).toBeTruthy();

    const storedAfterSetup = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(storedAfterSetup.totpSecret).toBeTruthy();
    expect(isEncryptedTotpSecret(storedAfterSetup.totpSecret!)).toBe(true);
    expect(storedAfterSetup.totpSecret).not.toBe(secret);

    // Simulate an enrollment created before Phase 5, then confirm it is
    // re-encrypted the next time the secret is used.
    await prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });

    const token = speakeasy.totp({ secret, encoding: 'base32' });
    const enable = await request(app)
      .post('/api/auth/2fa/verify-and-enable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ token });

    expect(enable.status).toBe(200);
    expect(enable.body.isTwoFactorEnabled).toBe(true);

    const storedAfterEnable = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(isEncryptedTotpSecret(storedAfterEnable.totpSecret!)).toBe(true);

    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.requires2FA).toBe(true);

    const loginToken = speakeasy.totp({ secret, encoding: 'base32' });
    const verify = await request(app)
      .post('/api/auth/2fa/login-verify')
      .send({ tempToken: login.body.tempToken, token: loginToken });

    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();
    expect(verify.headers['set-cookie']).toBeDefined();
  });
});
