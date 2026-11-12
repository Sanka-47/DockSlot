import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import {
  buildSecurityHeadersOptions,
  SWAGGER_CONTENT_SECURITY_POLICY,
} from '../src/config/securityHeaders.config';

describe('Phase 4 security headers', () => {
  it('applies a strict CSP and hardening headers to API responses', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('keeps authentication responses out of browser and proxy caches', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
    expect(res.headers['expires']).toBe('0');
  });

  it('uses a scoped, relaxed CSP only for Swagger UI', async () => {
    const res = await request(app).get('/api-docs/');

    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(SWAGGER_CONTENT_SECURITY_POLICY);
    expect(res.headers['content-security-policy']).toContain("'unsafe-inline'");
  });

  it('enables HSTS only in production', () => {
    const production = buildSecurityHeadersOptions(true);
    expect(production.hsts).toEqual({
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    });

    const development = buildSecurityHeadersOptions(false);
    expect(development.hsts).toBe(false);
  });
});
