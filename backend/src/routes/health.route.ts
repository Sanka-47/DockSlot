import { Router } from 'express';
import { healthCheck } from '../controllers/health.controller';

/**
 * Health routes.
 *
 * Mounted at `/health` (outside `/api`) so container orchestrators can reach the
 * probe without a token and without passing through the Redis-backed limiter.
 */
const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Service and database health probe
 *     description: |
 *       Public readiness/liveness probe for container orchestrators (Kubernetes, ECS, Docker healthcheck).
 *
 *       Runs a trivial query (SELECT 1) against MySQL through Prisma. Returns 200 when the database
 *       answers and 503 when it is unreachable, errors, or exceeds HEALTH_CHECK_TIMEOUT_MS
 *       (default 3000ms). Responses are sent with Cache-Control: no-store so proxies never cache them.
 *
 *       No authentication is required, and the route sits outside /api and ahead of the Redis-backed
 *       rate limiter so authentication or Redis outages cannot affect the probe itself.
 *     tags:
 *       - Health
 *     security: []
 *     servers:
 *       - url: http://localhost:5000
 *         description: Root server
 *     responses:
 *       200:
 *         description: Service is up and the database answered the probe.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [status, database, timestamp]
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [UP]
 *                   example: UP
 *                 database:
 *                   type: string
 *                   enum: [connected]
 *                   example: connected
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: '2026-10-17T01:57:23.689Z'
 *       503:
 *         description: Service is down - the database is unreachable, the query failed, or the probe timed out.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [status, database, error, timestamp]
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [DOWN]
 *                   example: DOWN
 *                 database:
 *                   type: string
 *                   enum: [disconnected]
 *                   example: disconnected
 *                 error:
 *                   type: string
 *                   description: The failure reason reported by the database driver or the probe timeout.
 *                   example: "Can't reach database server at `127.0.0.1:3306`"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: '2026-10-17T01:57:47.374Z'
 */
router.get('/', healthCheck);

export default router;
