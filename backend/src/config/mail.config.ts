import './env';

export type EmailProvider = 'smtp' | 'resend' | 'brevo';

function readString(value: string | undefined, fallback = ''): string {
  return (value ?? '').trim() || fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const cleaned = readString(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(cleaned)) return true;
  if (['false', '0', 'no', 'off'].includes(cleaned)) return false;
  return fallback;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(readString(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readProvider(value: string | undefined): EmailProvider {
  const provider = readString(value, 'smtp').toLowerCase();
  if (provider === 'smtp' || provider === 'resend' || provider === 'brevo') {
    return provider;
  }

  throw new Error(
    `EMAIL_PROVIDER must be one of "smtp", "resend", or "brevo" (received "${provider}").`,
  );
}

const provider = readProvider(process.env.EMAIL_PROVIDER);
const smtpUser = readString(process.env.SMTP_USER);
const smtpPass = readString(process.env.SMTP_PASS);
const resendApiKey = readString(process.env.RESEND_API_KEY);
const brevoApiKey = readString(process.env.BREVO_API_KEY);

if (Boolean(smtpUser) !== Boolean(smtpPass)) {
  throw new Error('SMTP_USER and SMTP_PASS must be configured together.');
}

if (provider === 'resend' && !resendApiKey) {
  throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend.');
}

if (provider === 'brevo' && !brevoApiKey) {
  throw new Error('BREVO_API_KEY is required when EMAIL_PROVIDER=brevo.');
}

export const mailConfig = {
  provider,
  host: readString(process.env.SMTP_HOST, 'localhost'),
  port: readPositiveInt(process.env.SMTP_PORT, 1025),
  secure: readBoolean(process.env.SMTP_SECURE, false),
  // Mailhog does not use STARTTLS. Once SMTP credentials are configured, default
  // to standard STARTTLS behavior unless the deployment explicitly overrides it.
  ignoreTls: readBoolean(process.env.SMTP_IGNORE_TLS, !(smtpUser && smtpPass)),
  requireTls: readBoolean(process.env.SMTP_REQUIRE_TLS, false),
  user: smtpUser,
  pass: smtpPass,
  from: readString(
    process.env.EMAIL_FROM || process.env.SMTP_FROM,
    'DockSlot <no-reply@dockslot.local>',
  ),
  appUrl: readString(process.env.APP_URL, 'http://localhost:5000'),
  frontendUrl: readString(process.env.FRONTEND_URL, 'http://localhost:5173'),
  httpTimeoutMs: readPositiveInt(process.env.EMAIL_HTTP_TIMEOUT_MS, 10_000),
  resendApiKey,
  brevoApiKey,
};
