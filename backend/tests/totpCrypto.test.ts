import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  isEncryptedTotpSecret,
} from '../src/utils/totpCrypto';

const ORIGINAL_KEY = process.env.TOTP_ENCRYPTION_KEY;
const testKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString(
  'base64'
);

describe('TOTP secret encryption', () => {
  beforeEach(() => {
    process.env.TOTP_ENCRYPTION_KEY = testKey;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it('round-trips a secret in iv:authTag:ciphertext format', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptTotpSecret(secret);

    expect(encrypted.split(':')).toHaveLength(3);
    expect(encrypted).not.toContain(secret);
    expect(isEncryptedTotpSecret(encrypted)).toBe(true);
    expect(decryptTotpSecret(encrypted)).toBe(secret);
  });

  it('returns legacy plaintext values unchanged for lazy migration', () => {
    expect(isEncryptedTotpSecret('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(decryptTotpSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('fails authentication when the key changes', () => {
    const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP');
    process.env.TOTP_ENCRYPTION_KEY = Buffer.from(
      'abcdef0123456789abcdef0123456789',
      'utf8'
    ).toString('base64');

    expect(() => decryptTotpSecret(encrypted)).toThrow(/unable to decrypt/i);
  });
});
