import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sendError, GENERIC_5XX_MESSAGE } from '../src/utils/httpError';
import { errorHandler } from '../src/middleware/error.middleware';

/** Minimal Express Response double that records `status()`/`json()` calls. */
const mockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.headersSent = false;
  return res;
};

describe('sendError - internal details never reach the client', () => {
  it('returns a generic message for an unexpected Error (500)', () => {
    const res = mockRes();
    sendError(res, new Error('connect ECONNREFUSED 127.0.0.1:3306 to DB dockslot_db'));

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.message).toBe(GENERIC_5XX_MESSAGE);
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('3306');
  });

  it('hides a Prisma-style error raised from a service', () => {
    const res = mockRes();
    const prismaError = Object.assign(
      new Error('Invalid `prisma.user.findUnique()` invocation: Unique constraint failed on the fields: (`email`)'),
      { code: 'P2002' }
    );
    sendError(res, prismaError);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe(GENERIC_5XX_MESSAGE);
  });

  it('preserves user-facing 4xx messages thrown by services', () => {
    const res = mockRes();
    sendError(res, {
      status: 409,
      message: 'Conflict. The requested dock slot is already booked.',
    });

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toContain('Conflict');
  });

  it('coerces a malformed status to 500 and hides the message', () => {
    const res = mockRes();
    sendError(res, { status: 9999, message: 'leaky internal detail' });

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).not.toContain('leaky');
  });
});

describe('global error handler - sanitizes forwarded errors', () => {
  it('hides internal details on an unhandled 500', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('Prisma: query failed against mysql://root:secret@localhost:3306');
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(GENERIC_5XX_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(JSON.stringify(res.body)).not.toContain('mysql');
  });

  it('forwards a deliberate 4xx message', async () => {
    const app = express();
    app.get('/forbidden', () => {
      throw Object.assign(new Error('Forbidden: tenant mismatch'), { status: 403 });
    });
    app.use(errorHandler);

    const res = await request(app).get('/forbidden');

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Forbidden');
  });
});
