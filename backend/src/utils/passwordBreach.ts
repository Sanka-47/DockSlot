import crypto from 'crypto';
import { securityConfig } from '../config/security.config';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';
const REQUEST_TIMEOUT_MS = 2500;

function sha1PrefixAndSuffix(password: string): { prefix: string; suffix: string } {
  const hash = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

/**
 * Checks HaveIBeenPwned using its k-anonymity range API. Only the first five
 * characters of the SHA-1 hash leave the process. The check is optional and
 * fails open so a HIBP outage cannot block registration or password changes.
 */
export async function isPasswordBreached(
  password: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (!securityConfig.passwordBreachCheckEnabled) {
    return false;
  }

  const { prefix, suffix } = sha1PrefixAndSuffix(password);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${HIBP_RANGE_URL}/${prefix}`, {
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'DockSlot',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const body = await response.text();
    return body.split('\n').some((line) => {
      const [lineSuffix, count] = line.split(':');
      return (
        lineSuffix?.trim().toUpperCase() === suffix &&
        Number.parseInt(count ?? '0', 10) > 0
      );
    });
  } catch (error) {
    console.warn(
      '[PasswordBreach] HIBP check failed open:',
      error instanceof Error ? error.message : error
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Reject a password when the optional breach check is enabled and finds it. */
export async function assertPasswordNotBreached(password: string): Promise<void> {
  if (await isPasswordBreached(password)) {
    throw {
      status: 400,
      message: 'This password has appeared in a data breach. Please choose a different password.',
    };
  }
}
