import crypto from 'crypto';
import { securityConfig } from '../config/security.config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENCRYPTED_PARTS = 3;

/**
 * Encrypt a TOTP secret for storage using AES-256-GCM.
 * Format: `iv:authTag:ciphertext`, each part base64url encoded.
 */
export function encryptTotpSecret(secret: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, securityConfig.totpEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/** True when a stored TOTP value uses the encrypted `iv:authTag:ciphertext` format. */
export function isEncryptedTotpSecret(value: string): boolean {
  return value.split(':').length === ENCRYPTED_PARTS;
}

/**
 * Decrypt a stored TOTP secret. Legacy plaintext base32 values are returned
 * as-is so they can be re-encrypted lazily by the service layer.
 */
export function decryptTotpSecret(stored: string): string {
  if (!isEncryptedTotpSecret(stored)) {
    return stored;
  }

  const [ivPart, tagPart, ciphertextPart] = stored.split(':');

  try {
    const iv = Buffer.from(ivPart, 'base64url');
    const authTag = Buffer.from(tagPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');

    if (iv.length !== IV_LENGTH) {
      throw new Error('Invalid TOTP encryption IV.');
    }

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      securityConfig.totpEncryptionKey,
      iv
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Unable to decrypt TOTP secret. Check TOTP_ENCRYPTION_KEY.');
  }
}
