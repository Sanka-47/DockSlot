/**
 * NotificationService
 * -------------------
 * Transport layer for outbound carrier webhook notifications.
 *
 * This service performs exactly one job: POST a single outbox payload to the
 * external Carrier Notify API and report the outcome. It never writes to the
 * database and never retries - scheduling and retry policy belong to the
 * OutboxWorker / OutboxService.
 *
 * Every request carries the outbox event id as both `X-Event-Id` and
 * `Idempotency-Key` so the receiver can de-duplicate redeliveries.
 */

export interface CarrierNotifyResult {
  /** True only for a 2xx response. */
  ok: boolean;
  /** HTTP status code, or 0 when the request never produced a response. */
  status: number;
  /** Parsed JSON response body when available. */
  body: any;
  /** Transport-level failure detail (network error / timeout). */
  error?: string;
  /** True when the failure was a client-side timeout or connection reset. */
  timedOut: boolean;
}

export class NotificationService {
  private get webhookUrl(): string {
    return process.env.CARRIER_NOTIFY_URL || 'http://localhost:4001/notify';
  }

  private get timeoutMs(): number {
    const parsed = parseInt(process.env.OUTBOX_REQUEST_TIMEOUT_MS || '8000', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 8000;
  }

  private get authToken(): string | undefined {
    const token = process.env.CARRIER_NOTIFY_TOKEN;
    return token && token.trim() ? token.trim() : undefined;
  }

  /**
   * True when the failure is worth retrying with backoff. Network errors and
   * timeouts always are; among HTTP responses, 408/425/429 and all 5xx are
   * transient, while other 4xx responses indicate a malformed request that
   * would fail identically on every redelivery.
   */
  public isRetryable(result: CarrierNotifyResult): boolean {
    if (result.timedOut || result.error) return true;
    if (result.status === 0) return true;
    if (result.status >= 200 && result.status < 300) return false;
    if ([408, 425, 429].includes(result.status)) return true;
    if (result.status >= 500) return true;
    return false;
  }

  /**
   * Dispatches one outbox event to the carrier webhook. Never throws: all
   * failures are returned as a structured result so the caller decides policy.
   */
  public async dispatchCarrierNotification(
    eventId: string,
    payload: unknown
  ): Promise<CarrierNotifyResult> {
    const url = this.webhookUrl;
    const timeoutMs = this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Event-Id': eventId,
      'Idempotency-Key': eventId,
      'User-Agent': 'DockSlot-OutboxWorker/1.0',
    };

    const token = this.authToken;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const raw = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        body: this.parseJson(raw),
        timedOut: false,
      };
    } catch (error: any) {
      const timedOut = error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
      const message = timedOut
        ? `Request to ${url} timed out after ${timeoutMs}ms`
        : `Network error calling ${url}: ${error?.message || String(error)}`;

      return { ok: false, status: 0, body: null, error: message, timedOut };
    } finally {
      clearTimeout(timer);
    }
  }

  private parseJson(raw: string): any {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // Receiver returned non-JSON (HTML error page, plain text, empty body).
      return { raw: raw.slice(0, 500) };
    }
  }
}

export const notificationService = new NotificationService();
