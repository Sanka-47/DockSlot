import crypto from 'crypto';

/**
 * Hash a high-entropy bearer token before storing it. Reset tokens are
 * credentials: a database read should not hand an attacker a working reset
 * link. The raw token only exists in the email sent to the user.
 *
 * SHA-256 is appropriate here (unlike for passwords) because the input is a
 * 256-bit random value, not a low-entropy human secret.
 */
export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}
