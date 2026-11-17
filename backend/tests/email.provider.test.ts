import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'NODE_ENV',
  'EMAIL_PROVIDER',
  'EMAIL_FROM',
  'SMTP_FROM',
  'SMTP_USER',
  'SMTP_PASS',
  'RESEND_API_KEY',
  'BREVO_API_KEY',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    setEnv(key, originalEnv[key]);
  }
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('email provider configuration', () => {
  it('defaults to SMTP and accepts the legacy SMTP_FROM fallback', async () => {
    setEnv('EMAIL_PROVIDER', undefined);
    setEnv('EMAIL_FROM', '');
    setEnv('SMTP_FROM', 'Legacy Sender <legacy@example.com>');

    const { mailConfig } = await import('../src/config/mail.config');

    expect(mailConfig.provider).toBe('smtp');
    expect(mailConfig.from).toBe('Legacy Sender <legacy@example.com>');
  });

  it('rejects an unsupported provider', async () => {
    setEnv('EMAIL_PROVIDER', 'sendgrid');

    await expect(import('../src/config/mail.config')).rejects.toThrow(/EMAIL_PROVIDER/);
  });

  it('requires SMTP credentials to be configured together', async () => {
    setEnv('EMAIL_PROVIDER', 'smtp');
    setEnv('SMTP_USER', 'relay-user');
    setEnv('SMTP_PASS', '');

    await expect(import('../src/config/mail.config')).rejects.toThrow(/SMTP_USER and SMTP_PASS/);
  });

  it('preserves SMTP credentials containing hash characters', async () => {
    setEnv('EMAIL_PROVIDER', 'smtp');
    setEnv('SMTP_USER', 'relay-user');
    setEnv('SMTP_PASS', 'p#ssword');

    const { mailConfig } = await import('../src/config/mail.config');

    expect(mailConfig.pass).toBe('p#ssword');
  });

  it('requires a Resend API key', async () => {
    setEnv('EMAIL_PROVIDER', 'resend');
    setEnv('RESEND_API_KEY', '');

    await expect(import('../src/config/mail.config')).rejects.toThrow(/RESEND_API_KEY/);
  });

  it('requires a Brevo API key', async () => {
    setEnv('EMAIL_PROVIDER', 'brevo');
    setEnv('BREVO_API_KEY', '');

    await expect(import('../src/config/mail.config')).rejects.toThrow(/BREVO_API_KEY/);
  });
});

describe('email provider delivery', () => {
  it('delivers through the Resend HTTPS API', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('EMAIL_PROVIDER', 'resend');
    setEnv('EMAIL_FROM', 'DockSlot <no-reply@example.com>');
    setEnv('RESEND_API_KEY', 're_test_key');

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const { emailService } = await import('../src/services/email.service');
    const result = await emailService.sendMail({
      to: 'user@example.com',
      subject: 'Verify your account',
      html: '<p>Verify</p>',
      text: 'Verify',
    });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer re_test_key' }),
      }),
    );

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body));
    expect(body).toEqual({
      from: 'DockSlot <no-reply@example.com>',
      to: ['user@example.com'],
      subject: 'Verify your account',
      html: '<p>Verify</p>',
      text: 'Verify',
    });
  });

  it('delivers through the Brevo HTTPS API', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('EMAIL_PROVIDER', 'brevo');
    setEnv('EMAIL_FROM', 'DockSlot <no-reply@example.com>');
    setEnv('BREVO_API_KEY', 'brevo_test_key');

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const { emailService } = await import('../src/services/email.service');
    const result = await emailService.sendMail({
      to: 'user@example.com',
      subject: 'Reset your password',
      html: '<p>Reset</p>',
      text: 'Reset',
    });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'api-key': 'brevo_test_key' }),
      }),
    );

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body));
    expect(body).toEqual({
      sender: { email: 'no-reply@example.com', name: 'DockSlot' },
      to: [{ email: 'user@example.com' }],
      subject: 'Reset your password',
      htmlContent: '<p>Reset</p>',
      textContent: 'Reset',
    });
  });

  it('returns false when the provider rejects the request', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('EMAIL_PROVIDER', 'resend');
    setEnv('EMAIL_FROM', 'DockSlot <no-reply@example.com>');
    setEnv('RESEND_API_KEY', 're_test_key');

    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { emailService } = await import('../src/services/email.service');
    const result = await emailService.sendMail({
      to: 'user@example.com',
      subject: 'Verify your account',
      html: '<p>Verify</p>',
    });

    expect(result).toBe(false);
  });
});
