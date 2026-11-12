/**
 * Authentication configuration validation.
 *
 * The process should fail fast when required secrets are missing. Production
 * deployments must use separate, high-entropy access and refresh secrets so a
 * leaked token-issuing key cannot be used to forge both token types.
 */

const MIN_SECRET_LENGTH = 32;

const PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-random-access-secret',
  'replace-with-a-different-random-refresh-secret',
  'your_jwt_secret_key',
  'default_secret_key',
]);

const TOTP_KEY_PLACEHOLDER = 'replace-with-a-32-byte-base64-key';

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? '').split('#')[0].trim();
}

function decodeTotpKey(value: string): Buffer {
  return /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
}

export interface ValidateEnvOptions {
  /** Overrides NODE_ENV, mainly useful for tests. */
  nodeEnv?: string;
}

export function validateEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ValidateEnvOptions = {}
): void {
  const nodeEnv = options.nodeEnv ?? readEnv(env, 'NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';

  const accessSecret = readEnv(env, 'JWT_ACCESS_SECRET');
  const refreshSecret = readEnv(env, 'JWT_REFRESH_SECRET');
  const legacySecret = readEnv(env, 'JWT_SECRET');
  const corsOrigin = readEnv(env, 'CORS_ORIGIN');
  const cookieSecure = readEnv(env, 'COOKIE_SECURE').toLowerCase();

  const errors: string[] = [];

  if (isProduction) {
    if (!accessSecret) {
      errors.push('JWT_ACCESS_SECRET is required when NODE_ENV=production.');
    }
    if (!refreshSecret) {
      errors.push('JWT_REFRESH_SECRET is required when NODE_ENV=production.');
    }
    if (!corsOrigin) {
      errors.push('CORS_ORIGIN is required when NODE_ENV=production.');
    }
    if (cookieSecure && cookieSecure !== 'true' && cookieSecure !== '1') {
      errors.push('COOKIE_SECURE must be true when NODE_ENV=production.');
    }
    if (accessSecret && accessSecret.length < MIN_SECRET_LENGTH) {
      errors.push(`JWT_ACCESS_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
    }
    if (refreshSecret && refreshSecret.length < MIN_SECRET_LENGTH) {
      errors.push(`JWT_REFRESH_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
    }
    if (accessSecret && PLACEHOLDER_SECRETS.has(accessSecret)) {
      errors.push('JWT_ACCESS_SECRET must not use an example/placeholder value.');
    }
    if (refreshSecret && PLACEHOLDER_SECRETS.has(refreshSecret)) {
      errors.push('JWT_REFRESH_SECRET must not use an example/placeholder value.');
    }
    if (accessSecret && refreshSecret && accessSecret === refreshSecret) {
      errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
    }
    if (accessSecret && legacySecret && accessSecret === legacySecret) {
      errors.push('JWT_ACCESS_SECRET must differ from the legacy JWT_SECRET.');
    }
    if (refreshSecret && legacySecret && refreshSecret === legacySecret) {
      errors.push('JWT_REFRESH_SECRET must differ from the legacy JWT_SECRET.');
    }

    const totpKey = readEnv(env, 'TOTP_ENCRYPTION_KEY');
    if (!totpKey) {
      errors.push('TOTP_ENCRYPTION_KEY is required when NODE_ENV=production.');
    } else if (totpKey === TOTP_KEY_PLACEHOLDER) {
      errors.push('TOTP_ENCRYPTION_KEY must not use an example/placeholder value.');
    } else if (decodeTotpKey(totpKey).length !== 32) {
      errors.push('TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    }
  } else {
    // Local development and tests may keep the legacy single secret until the
    // separate secrets are configured. Production never uses this fallback.
    if (!accessSecret && !legacySecret && nodeEnv !== 'test') {
      errors.push('JWT_ACCESS_SECRET (or legacy JWT_SECRET) is required.');
    }
    if (!refreshSecret && !legacySecret && nodeEnv !== 'test') {
      errors.push('JWT_REFRESH_SECRET (or legacy JWT_SECRET) is required.');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid authentication configuration:\n- ${errors.join('\n- ')}`);
  }
}
