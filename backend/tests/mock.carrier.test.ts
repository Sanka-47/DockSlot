import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createMockCarrierApp } from '../src/mock-carrier/server';

describe('Mock Carrier Notify API Service Tests', () => {
  let mockCarrier: ReturnType<typeof createMockCarrierApp>;

  beforeEach(() => {
    // Create fresh instance with fast test defaults
    mockCarrier = createMockCarrierApp({
      isEnabled: true,
      simulateChaos: false,
      minDelayMs: 0,
      maxDelayMs: 0,
    });
  });

  it('responds with 200 OK on health check', async () => {
    const res = await request(mockCarrier.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.service).toBe('Mock Carrier Notify API');
  });

  it('successfully receives and logs webhook notifications on POST /notify', async () => {
    const payload = {
      carrierOrg: { id: 10, name: 'Swift Haulage' },
      booking: { id: 500, slotStartTime: '2026-11-20T10:00:00.000Z' },
      eventType: 'BOOKING_CONFIRMED',
      message: 'Your dock slot has been booked successfully.',
    };

    const res = await request(mockCarrier.app)
      .post('/notify')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deliveryAttempt).toBe(1);
    expect(res.body.isDuplicate).toBe(false);
    expect(res.body.data.eventType).toBe('BOOKING_CONFIRMED');

    // Inspect logs
    const logsRes = await request(mockCarrier.app).get('/api/carrier/logs');
    expect(logsRes.status).toBe(200);
    expect(logsRes.body.totalCount).toBe(1);
    expect(logsRes.body.duplicatesCount).toBe(0);
    expect(logsRes.body.logs[0].body.eventType).toBe('BOOKING_CONFIRMED');
  });

  it('tracks duplicate deliveries caused by mobile/network retries', async () => {
    const payload = {
      carrierOrg: { id: 10, name: 'Swift Haulage' },
      booking: { id: 501, slotStartTime: '2026-11-20T11:00:00.000Z' },
      eventType: 'BOOKING_CONFIRMED',
      message: 'Duplicate retry simulation',
    };

    // First delivery attempt
    const res1 = await request(mockCarrier.app).post('/notify').send(payload);
    expect(res1.status).toBe(200);
    expect(res1.body.isDuplicate).toBe(false);
    expect(res1.body.deliveryAttempt).toBe(1);

    // Second delivery attempt (retry)
    const res2 = await request(mockCarrier.app).post('/notify').send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.isDuplicate).toBe(true);
    expect(res2.body.deliveryAttempt).toBe(2);

    // Check logs summary
    const logsRes = await request(mockCarrier.app).get('/api/carrier/logs');
    expect(logsRes.status).toBe(200);
    expect(logsRes.body.totalCount).toBe(2);
    expect(logsRes.body.duplicatesCount).toBe(1);
    expect(logsRes.body.uniqueCount).toBe(1);
  });

  it('simulates service-down state (503 Service Unavailable) when isEnabled is false', async () => {
    // Disable service via control endpoint
    const controlRes = await request(mockCarrier.app)
      .post('/api/carrier/control')
      .send({ enabled: false });

    expect(controlRes.status).toBe(200);
    expect(controlRes.body.config.isEnabled).toBe(false);

    // POST /notify must immediately return 503
    const notifyRes = await request(mockCarrier.app)
      .post('/notify')
      .send({
        carrierOrg: { id: 10 },
        booking: { id: 502 },
        eventType: 'BOOKING_CANCELLED',
        message: 'Cancellation notice',
      });

    expect(notifyRes.status).toBe(503);
    expect(notifyRes.body.success).toBe(false);
    expect(notifyRes.body.message).toContain('Service Unavailable');

    // Re-enable service
    await request(mockCarrier.app)
      .post('/api/carrier/control')
      .send({ enabled: true });

    const retryRes = await request(mockCarrier.app)
      .post('/notify')
      .send({
        carrierOrg: { id: 10 },
        booking: { id: 502 },
        eventType: 'BOOKING_CANCELLED',
        message: 'Cancellation notice',
      });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.success).toBe(true);
  });

  it('simulates HTTP 500 failures when chaos simulation is triggered', async () => {
    // Configure mock carrier to simulate 100% failure rate with 0ms delay
    await request(mockCarrier.app)
      .post('/api/carrier/control')
      .send({
        simulateChaos: true,
        failRate: 1.0,
        hangRate: 0,
        minDelayMs: 0,
        maxDelayMs: 0,
      });

    const res = await request(mockCarrier.app)
      .post('/notify')
      .send({
        carrierOrg: { id: 10 },
        booking: { id: 503 },
        eventType: 'BOOKING_RESCHEDULED',
        message: 'Reschedule notice',
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Internal Server Error');
  });

  it('simulates timeout hangs with configurable duration', async () => {
    // Configure mock carrier to hang for 30ms (instead of 30 full seconds) for automated test safety
    await request(mockCarrier.app)
      .post('/api/carrier/control')
      .send({
        simulateChaos: true,
        hangRate: 1.0,
        hangDurationMs: 30,
        minDelayMs: 0,
        maxDelayMs: 0,
      });

    const startTime = Date.now();
    const res = await request(mockCarrier.app)
      .post('/notify')
      .send({
        carrierOrg: { id: 10 },
        booking: { id: 504 },
        eventType: 'BOOKING_RESCHEDULED',
        message: 'Timeout test',
      });

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(res.status).toBe(504);
    expect(res.body.message).toContain('Gateway Timeout');
  });

  it('clears webhook logs on DELETE /api/carrier/logs', async () => {
    // Send a webhook
    await request(mockCarrier.app)
      .post('/notify')
      .send({ bookingId: 999, eventType: 'TEST', message: 'Before clear' });

    let logsRes = await request(mockCarrier.app).get('/api/carrier/logs');
    expect(logsRes.body.totalCount).toBe(1);

    // Clear logs
    const deleteRes = await request(mockCarrier.app).delete('/api/carrier/logs');
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    logsRes = await request(mockCarrier.app).get('/api/carrier/logs');
    expect(logsRes.body.totalCount).toBe(0);
    expect(logsRes.body.duplicatesCount).toBe(0);
  });
});
