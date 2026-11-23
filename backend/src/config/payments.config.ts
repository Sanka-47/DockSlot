import './env';

export type PaymentsMode = 'stripe' | 'disabled';

function readString(value: string | undefined, fallback = ''): string {
  return (value ?? '').split('#')[0].trim() || fallback;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(readString(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveMode(): PaymentsMode {
  const configured = readString(process.env.PAYMENTS_MODE).toLowerCase();
  if (configured === 'disabled') return 'disabled';
  if (configured === 'stripe') return 'stripe';

  // Tests never call Stripe. Production must opt into "stripe" explicitly in
  // env.validation.ts, so this fallback is only a local-development convenience.
  return process.env.NODE_ENV === 'test' ? 'disabled' : 'stripe';
}

function resolveFrontendUrl(): string {
  const explicit = readString(process.env.FRONTEND_URL);
  if (explicit) return explicit.replace(/\/+$/, '');

  const firstCorsOrigin = readString(process.env.CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .find(Boolean);
  if (firstCorsOrigin) return firstCorsOrigin.replace(/\/+$/, '');

  return 'http://localhost:5173';
}

const frontendUrl = resolveFrontendUrl();

/**
 * Payment configuration is intentionally backend-only. The browser never sees
 * a Stripe secret or publishable key: Checkout is hosted by Stripe and the API
 * creates sessions on the server.
 */
export const paymentsConfig = {
  mode: resolveMode(),
  get enabled(): boolean {
    return this.mode === 'stripe';
  },
  get secretKey(): string {
    return readString(process.env.STRIPE_SECRET_KEY);
  },
  get webhookSecret(): string {
    return readString(process.env.STRIPE_WEBHOOK_SECRET);
  },
  /** Stripe requires Checkout Session expiry to be at least 30 minutes out. */
  get holdMinutes(): number {
    // Stripe accepts 30 minutes to 24 hours.
    return Math.min(1440, Math.max(30, readPositiveInt(process.env.PAYMENT_HOLD_MINUTES, 30)));
  },
  /** Reject bookings that start too soon for a Checkout Session to be useful. */
  get minLeadMinutes(): number {
    return Math.max(30, readPositiveInt(process.env.PAYMENT_MIN_LEAD_MINUTES, 30));
  },
  get expirySweepIntervalMs(): number {
    return readPositiveInt(process.env.PAYMENT_EXPIRY_SWEEP_INTERVAL_MS, 60_000);
  },
  get frontendUrl(): string {
    return frontendUrl;
  },
  get successUrl(): string {
    return (
      readString(process.env.STRIPE_SUCCESS_URL) ||
      `${frontendUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`
    );
  },
  get cancelUrl(): string {
    return readString(process.env.STRIPE_CANCEL_URL) || `${frontendUrl}/?checkout=cancelled`;
  },
};
