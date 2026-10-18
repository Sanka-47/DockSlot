import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The Redis client ships an in-memory fallback so the app runs locally without
 * Docker. That fallback must NOT be active in production: a per-process Map
 * diverges from the other instances behind the load balancer, silently breaking
 * cross-instance session revocation and global rate limiting. In production a
 * Redis outage must fail fast instead.
 *
 * `NODE_ENV` is read once when the module is first imported, so each case loads
 * a fresh copy with `vi.resetModules()`.
 */
describe('Redis in-memory fallback gating', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the local store when NODE_ENV is not production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    const { redis } = await import('../src/config/redis');

    await expect(redis.get('a-key-that-does-not-exist')).resolves.toBeNull();
    redis.disconnect();
  });

  it('fails fast instead of using per-instance memory when NODE_ENV=production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    // Unreachable address guarantees the client never connects, so the fallback
    // path is the only one left.
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');

    const { redis } = await import('../src/config/redis');

    await expect(redis.get('any-key')).rejects.toThrow(/disabled in production/i);
    redis.disconnect();
  });
});
