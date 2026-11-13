import { describe, it, expect, afterEach, vi } from 'vitest';
import { sanitizeUrlForLogging } from '../src/middleware/requestLogger';
import { requireTrustedOrigin } from '../src/middleware/origin.middleware';

const originalNodeEnv = process.env.NODE_ENV;
const originalCorsOrigin = process.env.CORS_ORIGIN;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = originalCorsOrigin;
});

describe('request log URL sanitization', () => {
  it('redacts one-time tokens and credentials from logged URLs', () => {
    expect(
      sanitizeUrlForLogging('/api/auth/invitation?token=invite-secret&email=user%40example.com')
    ).toBe('/api/auth/invitation?token=REDACTED&email=user%40example.com');
  });

  it('leaves ordinary URLs unchanged', () => {
    expect(sanitizeUrlForLogging('/api/bookings?page=2&limit=20')).toBe(
      '/api/bookings?page=2&limit=20'
    );
  });
});

describe('trusted origin middleware', () => {
  it('rejects a cookie-backed POST with no Origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example.com';

    const req = { method: 'POST', get: () => undefined } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireTrustedOrigin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an allowlisted Origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example.com';

    const req = {
      method: 'POST',
      get: (header: string) =>
        header.toLowerCase() === 'origin' ? 'https://app.example.com' : undefined,
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireTrustedOrigin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('bypasses the check outside production', () => {
    process.env.NODE_ENV = 'test';

    const req = { method: 'POST', get: () => undefined } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireTrustedOrigin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
