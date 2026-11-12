import crypto from 'crypto';
import { hashOpaqueToken } from './tokenHash';

/** Email verification links are valid for 24 hours. */
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Builds a fresh verification token. The raw value is emailed to the user; only
 * the SHA-256 hash and expiry are persisted.
 */
export function createVerificationToken(): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
  };
}
