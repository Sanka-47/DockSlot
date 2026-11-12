import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  isEncryptedTotpSecret,
} from '../src/utils/totpCrypto';

const ORIGINAL_KEY = process.env.TOTP_ENCRYPTION_KEY;
// Deterministic test-only keys; no secret-shaped literals are committed.
const testKey = Buffer.alloc(32, 0x42).toString('base64');
const otherKey = Buffer.alloc(32, 0x43).toString('base64');
const plaintextSecret = 'test-only-totp-value';

describe('TOTP secret encryption', () => {
  beforeEach(() => {
    process.env.TOTP_ENCRYPTION_KEY = testKey;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it('round-trips a secret in iv:authTag:ciphertext format', () => {
    const encrypted = encryptTotpSecret(plaintextSecret);

    expect(encrypted.split(':')).toHaveLength(3);
    expect(encrypted).not.toContain(plaintextSecret);
    expect(isEncryptedTotpSecret(encrypted)).toBe(true);
    expect(decryptTotpSecret(encrypted)).toBe(plaintextSecret);
  });

  it('returns legacy plaintext values unchanged for lazy migration', () => {
    expect(isEncryptedTotpSecret(plaintextSecret)).toBe(false);
    expect(decryptTotpSecret(plaintextSecret)).toBe(plaintextSecret);
  });

  it('fails authentication when the key changes', () => {
    const encrypted = encryptTotpSecret(plaintextSecret);
    process.env.TOTP_ENCRYPTION_KEY = otherKey;

    expect(() => decryptTotpSecret(encrypted)).toThrow(/unable to decrypt/i);
  });
});
