import express, { Request, Response } from 'express';
import cors from 'cors';

export interface WebhookLogEntry {
  id: string;
  receivedAt: string;
  body: any;
  deliveryAttempt: number;
  isDuplicate: boolean;
  key: string;
}

export interface MockCarrierConfig {
  isEnabled: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  failRate: number;
  hangRate: number;
  hangDurationMs: number;
  simulateChaos: boolean;
}

export function createMockCarrierApp(initialConfig?: Partial<MockCarrierConfig>) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // In-memory control state and logs
  const config: MockCarrierConfig = {
    isEnabled: true,
    minDelayMs: parseInt(process.env.MOCK_CARRIER_MIN_DELAY || '1000', 10),
    maxDelayMs: parseInt(process.env.MOCK_CARRIER_MAX_DELAY || '5000', 10),
    failRate: parseFloat(process.env.MOCK_CARRIER_FAIL_RATE || '0.20'),
    hangRate: parseFloat(process.env.MOCK_CARRIER_HANG_RATE || '0.05'),
    hangDurationMs: parseInt(process.env.MOCK_CARRIER_HANG_MS || '30000', 10),
    simulateChaos: process.env.MOCK_CARRIER_SIMULATE_CHAOS !== 'false',
    ...initialConfig,
  };

  let logs: WebhookLogEntry[] = [];
  const deliveryCounts = new Map<string, number>();

  function computePayloadKey(body: any): string {
    if (!body) return 'empty';
    if (body.booking?.id && body.eventType) {
      return `booking:${body.booking.id}:event:${body.eventType}`;
    }
    if (body.bookingId && body.eventType) {
      return `booking:${body.bookingId}:event:${body.eventType}`;
    }
    if (body.messageId) {
      return `msg:${body.messageId}`;
    }
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }

  function getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Health check
  app.get(['/health', '/api/carrier/health'], (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'OK',
      service: 'Mock Carrier Notify API',
      enabled: config.isEnabled,
    });
  });

  // 1. Webhook Endpoint
  app.post(['/notify', '/api/carrier/notify'], async (req: Request, res: Response): Promise<void> => {
    // Control State Check: simulate service down
    if (!config.isEnabled) {
      res.status(503).json({
        success: false,
        message: 'Service Unavailable: Mock carrier notify service is currently disabled.',
      });
      return;
    }

    const { carrierOrg, booking, eventType, message } = req.body;
    const key = computePayloadKey(req.body);
    const previousDeliveries = deliveryCounts.get(key) || 0;
    deliveryCounts.set(key, previousDeliveries + 1);

    const logEntry: WebhookLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      receivedAt: new Date().toISOString(),
      body: req.body,
      deliveryAttempt: previousDeliveries + 1,
      isDuplicate: previousDeliveries > 0,
      key,
    };
    logs.push(logEntry);

    // Chaos Simulation
    if (config.simulateChaos) {
      const roll = Math.random();

      // Approx 5% Timeout Hangs (hangs for hangDurationMs, e.g. 30s)
      if (roll < config.hangRate) {
        await new Promise((resolve) => setTimeout(resolve, config.hangDurationMs));
        res.status(504).json({
          success: false,
          message: 'Gateway Timeout: Mock carrier server hung and timed out.',
        });
        return;
      }

      // Approx 20% HTTP 500 Failures
      if (roll < config.hangRate + config.failRate) {
        const delay = getRandomInt(config.minDelayMs, config.maxDelayMs);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        res.status(500).json({
          success: false,
          message: 'Internal Server Error: Simulated third-party carrier webhook failure.',
        });
        return;
      }

      // Random Latency between 1,000ms and 5,000ms (or configured range)
      const delay = getRandomInt(config.minDelayMs, config.maxDelayMs);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Success response: HTTP 200 OK
    res.status(200).json({
      success: true,
      message: 'Notification received successfully by mock carrier.',
      receivedAt: logEntry.receivedAt,
      deliveryAttempt: logEntry.deliveryAttempt,
      isDuplicate: logEntry.isDuplicate,
      data: {
        carrierOrg,
        booking,
        eventType,
        message,
      },
    });
  });

  // 2. Control Endpoint
  app.post(['/api/carrier/control', '/carrier/control'], (req: Request, res: Response): void => {
    const {
      enabled,
      simulateChaos,
      minDelayMs,
      maxDelayMs,
      failRate,
      hangRate,
      hangDurationMs,
    } = req.body;

    if (typeof enabled === 'boolean') {
      config.isEnabled = enabled;
    }
    if (typeof simulateChaos === 'boolean') {
      config.simulateChaos = simulateChaos;
    }
    if (typeof minDelayMs === 'number') config.minDelayMs = minDelayMs;
    if (typeof maxDelayMs === 'number') config.maxDelayMs = maxDelayMs;
    if (typeof failRate === 'number') config.failRate = failRate;
    if (typeof hangRate === 'number') config.hangRate = hangRate;
    if (typeof hangDurationMs === 'number') config.hangDurationMs = hangDurationMs;

    res.status(200).json({
      success: true,
      message: `Mock carrier control state updated. Service is ${config.isEnabled ? 'ENABLED' : 'DISABLED'}.`,
      config,
    });
  });

  // 3. Inspection Endpoint - GET Logs
  app.get(['/api/carrier/logs', '/carrier/logs'], (_req: Request, res: Response): void => {
    const duplicatesCount = logs.filter((l) => l.isDuplicate).length;
    const summary: Record<string, number> = {};
    for (const [key, count] of deliveryCounts.entries()) {
      summary[key] = count;
    }

    res.status(200).json({
      success: true,
      totalCount: logs.length,
      duplicatesCount,
      uniqueCount: deliveryCounts.size,
      summary,
      logs,
    });
  });

  // 4. Reset Endpoint - DELETE Logs
  app.delete(['/api/carrier/logs', '/carrier/logs'], (_req: Request, res: Response): void => {
    const count = logs.length;
    logs = [];
    deliveryCounts.clear();

    res.status(200).json({
      success: true,
      message: `Cleared ${count} mock carrier webhook logs.`,
    });
  });

  return { app, config, getLogs: () => logs, getCounts: () => deliveryCounts };
}

export const { app, config } = createMockCarrierApp();
export default app;

const PORT = parseInt(process.env.MOCK_CARRIER_PORT || '4001', 10);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[MockCarrier] Mock Carrier Notify API service running on port ${PORT}`);
    console.log(`[MockCarrier] Webhook endpoint: POST http://localhost:${PORT}/notify`);
    console.log(`[MockCarrier] Control endpoint: POST http://localhost:${PORT}/api/carrier/control`);
    console.log(`[MockCarrier] Logs endpoint:    GET  http://localhost:${PORT}/api/carrier/logs`);
  });
}
