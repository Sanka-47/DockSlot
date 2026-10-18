import { Request, Response } from 'express';
import { healthService } from '../services/health.service';

/**
 * GET /health - readiness/liveness probe.
 *
 * Maps the service-level health result onto HTTP:
 *   200 UP   - the process is running and the database answers.
 *   503 DOWN - the database is unreachable, errored, or the probe timed out.
 *
 * The heavy lifting (dependency selection, timeout policy, failure logging)
 * lives in `healthService`; this handler only owns HTTP concerns.
 */
export const healthCheck = async (_req: Request, res: Response): Promise<void> => {
  // Health responses describe a single instant; never let a proxy or CDN cache them.
  res.setHeader('Cache-Control', 'no-store');

  // `check()` is guaranteed not to throw, so there is nothing to catch here.
  const result = await healthService.check();

  res.status(result.status === 'UP' ? 200 : 503).json(result);
};
