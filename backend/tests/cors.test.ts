import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalCorsOrigin = process.env.CORS_ORIGIN;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = originalCorsOrigin;

  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  vi.resetModules();
});

async function loadApp() {
  const module = await import('../src/app');
  return module.default;
}

function preflight(app: Awaited<ReturnType<typeof loadApp>>, origin: string) {
  return request(app)
    .options('/api/auth/login')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type');
}

describe('CORS preflight', () => {
  it('returns the exact allowed origin with credentials enabled', async () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGIN = 'https://dockslot.kalindu47kk.workers.dev';

    const app = await loadApp();
    const res = await preflight(app, 'https://dockslot.kalindu47kk.workers.dev');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://dockslot.kalindu47kk.workers.dev',
    );
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('normalizes trailing slashes in configured origins', async () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGIN = 'https://app.example.com/';

    const app = await loadApp();
    const res = await preflight(app, 'https://app.example.com');

    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not emit an allow-origin header for an unlisted origin', async () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGIN = 'https://app.example.com';

    const app = await loadApp();
    const res = await preflight(app, 'https://evil.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
