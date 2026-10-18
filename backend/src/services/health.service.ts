import { prisma } from '../config/db.config';
import { childLogger } from '../utils/logger';
import { getRequestId } from '../utils/requestContext';

/**
 * HealthService
 * -------------
 * Infrastructure-level health checks. This layer owns *how* the service is
 * probed (which dependency, with what timeout) but knows nothing about HTTP -
 * it returns a plain result, and the controller decides the status code.
 *
 * Kept free of Express types so the same check can be reused from a boot-time
 * self-check, a smoke-test script, or a future CLI without pulling in HTTP.
 */

export type HealthStatus = 'UP' | 'DOWN';
export type DatabaseStatus = 'connected' | 'disconnected';

export interface HealthCheckResult {
  status: HealthStatus;
  database: DatabaseStatus;
  /** ISO 8601 timestamp of when the probe completed. */
  timestamp: string;
  /** Present only when the check failed. */
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Upper bound on the probe's database round-trip. A probe that hangs is worse
 * than one that fails: the orchestrator would wait for its own deadline instead
 * of receiving a fast 503 and rescheduling the container.
 */
function readTimeoutMs(): number {
  const parsed = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export class HealthService {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number = readTimeoutMs()) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Probes MySQL through Prisma with a trivial query.
   *
   * Never throws: every failure - unreachable server, auth error, or timeout -
   * is converted into a `DOWN` result so a probe can always answer. Failures are
   * logged with the request's correlation id so an unhealthy reading in the logs
   * can be tied back to the orchestrator's probe request.
   */
  public async check(): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString();

    try {
      await this.withTimeout(prisma.$queryRaw`SELECT 1`, this.timeoutMs);

      return {
        status: 'UP',
        database: 'connected',
        timestamp,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      childLogger({ requestId: getRequestId() }).error(
        { err, timeoutMs: this.timeoutMs },
        'Health check failed: the database is not reachable.'
      );

      return {
        status: 'DOWN',
        database: 'disconnected',
        // Generic only. The detailed error stays in the server logs above so an
        // unauthenticated probe can never learn DB hosts, credentials, or SQL.
        error: 'Database check failed',
        timestamp,
      };
    }
  }

  /**
   * Rejects if `promise` has not settled within `timeoutMs`. The timer is
   * unref'd so a pending probe can never hold the event loop open.
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Database health check timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      timer.unref?.();

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
}

export const healthService = new HealthService();
