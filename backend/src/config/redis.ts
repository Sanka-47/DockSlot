import Redis from 'ioredis';
import crypto from 'crypto';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// In-memory fallback maps for zero-dependency local development / testing without Docker
const inMemoryStore = new Map<string, string>();
const inMemoryExpiry = new Map<string, number>();
const inMemoryScripts = new Map<string, string>();
let isRedisConnected = false;

// The in-memory fallback exists ONLY for local development / CI without Docker.
// In production it must be disabled: a per-process Map silently diverges from
// other instances, breaking cross-instance session revocation, the isActive
// cache, and global rate limiting (i.e. a split-brain). When disabled, a Redis
// outage fails fast instead of degrading to inconsistent local state.
const inMemoryFallbackEnabled = process.env.NODE_ENV !== 'production';

/** Falls back to the local store, or throws when running in production. */
function memFallback(args: string[]): any {
  if (!inMemoryFallbackEnabled) {
    throw new Error(
      '[Redis] Redis is unreachable and the in-memory fallback is disabled in production. ' +
        'A shared, highly-available Redis is required for multi-instance correctness.'
    );
  }
  return executeInMemoryCommand(args);
}

/** Mirrors a command into the local store while connected (dev only). */
function mirrorToMemory(args: string[]): void {
  if (inMemoryFallbackEnabled) {
    executeInMemoryCommand(args);
  }
}

function getInMemoryPttl(key: string): number {
  if (!inMemoryStore.has(key)) {
    inMemoryExpiry.delete(key);
    return -2;
  }
  const exp = inMemoryExpiry.get(key);
  if (exp === undefined) {
    return -1;
  }
  const remaining = exp - Date.now();
  if (remaining <= 0) {
    inMemoryStore.delete(key);
    inMemoryExpiry.delete(key);
    return -2;
  }
  return remaining;
}

function executeInMemoryCommand(args: string[]): any {
  const cmd = (args[0] || '').toUpperCase();

  if (cmd === 'SCRIPT' && (args[1] || '').toUpperCase() === 'LOAD') {
    const script = args[2] || '';
    const sha = crypto.createHash('sha1').update(script).digest('hex');
    inMemoryScripts.set(sha, script);
    return sha;
  }

  if (cmd === 'EVALSHA') {
    const sha = args[1] || '';
    const script = inMemoryScripts.get(sha);
    if (!script) {
      throw new Error('NOSCRIPT No matching script. Please use EVAL.');
    }
    const key = args[3] || '';
    const argv1 = args[4];

    // rate-limit-redis increment script contains "INCR" and "SET" with "PX"
    if (script.includes('INCR') && script.includes('PX')) {
      const windowMs = Number(argv1) || 60000;
      const pttl = getInMemoryPttl(key);
      if (pttl <= 0) {
        inMemoryStore.set(key, '1');
        inMemoryExpiry.set(key, Date.now() + windowMs);
        return [1, windowMs];
      }
      const totalHits = parseInt(inMemoryStore.get(key) || '0', 10) + 1;
      inMemoryStore.set(key, String(totalHits));
      return [totalHits, pttl];
    }

    // rate-limit-redis get script
    const pttl = getInMemoryPttl(key);
    if (pttl === -2) {
      return [false, -2];
    }
    const rawVal = inMemoryStore.get(key);
    const totalHits = rawVal !== undefined ? parseInt(rawVal, 10) : false;
    return [totalHits, pttl];
  }

  if (cmd === 'DECR') {
    const key = args[1] || '';
    const current = parseInt(inMemoryStore.get(key) || '0', 10);
    const next = Math.max(0, current - 1);
    inMemoryStore.set(key, String(next));
    return next;
  }

  if (cmd === 'INCR') {
    const key = args[1] || '';
    const current = parseInt(inMemoryStore.get(key) || '0', 10);
    const next = current + 1;
    inMemoryStore.set(key, String(next));
    return next;
  }

  if (cmd === 'DEL') {
    let deleted = 0;
    for (let i = 1; i < args.length; i++) {
      const key = args[i];
      if (inMemoryStore.has(key)) {
        deleted++;
      }
      inMemoryStore.delete(key);
      inMemoryExpiry.delete(key);
    }
    return deleted;
  }

  if (cmd === 'GET') {
    const key = args[1] || '';
    const pttl = getInMemoryPttl(key);
    if (pttl === -2) return null;
    return inMemoryStore.get(key) ?? null;
  }

  if (cmd === 'SET') {
    const key = args[1] || '';
    const val = String(args[2] ?? '');
    inMemoryStore.set(key, val);
    for (let i = 3; i < args.length; i++) {
      const opt = (args[i] || '').toUpperCase();
      if (opt === 'PX' && args[i + 1]) {
        inMemoryExpiry.set(key, Date.now() + Number(args[i + 1]));
        i++;
      } else if (opt === 'EX' && args[i + 1]) {
        inMemoryExpiry.set(key, Date.now() + Number(args[i + 1]) * 1000);
        i++;
      }
    }
    return 'OK';
  }

  if (cmd === 'PTTL') {
    const key = args[1] || '';
    return getInMemoryPttl(key);
  }

  if (cmd === 'PING') {
    return 'PONG';
  }

  if (cmd === 'FLUSHALL' || cmd === 'FLUSHDB') {
    inMemoryStore.clear();
    inMemoryExpiry.clear();
    return 'OK';
  }

  return 'OK';
}

export const rawRedis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  enableOfflineQueue: false,
  retryStrategy(times) {
    if (times > 2) return null; // Stop retrying quickly in local dev without docker
    return Math.min(times * 100, 300);
  },
});

rawRedis.on('connect', () => {
  isRedisConnected = true;
  console.log('[Redis] Connected to Redis server.');
});

rawRedis.on('ready', () => {
  isRedisConnected = true;
});

rawRedis.on('error', () => {
  isRedisConnected = false;
  // Non-fatal warning for local development without Docker
});

rawRedis.on('close', () => {
  isRedisConnected = false;
});

// Attempt background connection if Redis is running locally
rawRedis.connect().catch(() => {
  // Silently fall back to in-memory store if Redis server is not running
});

/**
 * High-performance Redis client with graceful in-memory fallback
 * for local development without Docker.
 */
export const redis = {
  /**
   * Executes a raw Redis command (used by rate-limit-redis RedisStore).
   */
  async call(...args: string[]): Promise<any> {
    // Register SCRIPT LOAD in memory (dev only) so SHA1 is known if fallback is needed
    if ((args[0] || '').toUpperCase() === 'SCRIPT' && (args[1] || '').toUpperCase() === 'LOAD') {
      mirrorToMemory(args);
    }

    if (isRedisConnected) {
      try {
        const [command, ...rest] = args;
        return await (rawRedis as any).call(command, ...rest);
      } catch (err: any) {
        if (err instanceof Error && /^NOSCRIPT(?:\s|$)/.test(err.message)) {
          throw err;
        }
        // Fall back to in-memory execution if Redis connection dropped
      }
    }

    return memFallback(args);
  },

  /**
   * Alias for call() to support sendCommand conventions.
   */
  async sendCommand(args: string[]): Promise<any> {
    return this.call(...args);
  },

  /**
   * Retrieves the string value associated with key.
   */
  async get(key: string): Promise<string | null> {
    if (isRedisConnected) {
      try {
        return await rawRedis.get(key);
      } catch {
        // Fall back to in-memory store if Redis command fails
      }
    }
    return memFallback(['GET', key]);
  },

  /**
   * Sets key to hold the string value.
   */
  async set(key: string, value: string | number, ...args: any[]): Promise<'OK' | string | null> {
    const strVal = String(value);
    mirrorToMemory(['SET', key, strVal, ...args.map(String)]);
    if (isRedisConnected) {
      try {
        return await (rawRedis as any).set(key, strVal, ...args);
      } catch {
        // Fall through to the local store / production guard
      }
    }
    return memFallback(['SET', key, strVal, ...args.map(String)]);
  },

  /**
   * Increments the number stored at key by one.
   * If key does not exist, it is set to 0 before performing the operation.
   */
  async incr(key: string): Promise<number> {
    if (isRedisConnected) {
      try {
        const val = await rawRedis.incr(key);
        mirrorToMemory(['SET', key, String(val)]);
        return val;
      } catch {
        // Fall through to the local store / production guard
      }
    }
    return memFallback(['INCR', key]);
  },

  /**
   * Removes the specified key.
   */
  async del(key: string): Promise<number> {
    mirrorToMemory(['DEL', key]);
    if (isRedisConnected) {
      try {
        return await rawRedis.del(key);
      } catch {
        // Fall through to the local store / production guard
      }
    }
    return memFallback(['DEL', key]);
  },

  /**
   * Returns PONG if client/fallback is ready.
   */
  async ping(): Promise<string> {
    if (isRedisConnected) {
      try {
        return await rawRedis.ping();
      } catch {
        // Fall through
      }
    }
    if (!inMemoryFallbackEnabled) {
      throw new Error('[Redis] ping failed: Redis is unreachable (in-memory fallback disabled in production).');
    }
    return 'PONG';
  },

  /**
   * Clears the store.
   */
  async flushall(): Promise<'OK'> {
    if (inMemoryFallbackEnabled) {
      inMemoryStore.clear();
      inMemoryExpiry.clear();
    }
    if (isRedisConnected) {
      try {
        await rawRedis.flushall();
      } catch {
        // Fall back
      }
    }
    return 'OK';
  },

  /**
   * Quits connection.
   */
  async quit(): Promise<'OK'> {
    if (isRedisConnected) {
      try {
        await rawRedis.quit();
      } catch {
        // Suppress
      }
    }
    return 'OK';
  },

  /**
   * Disconnects client.
   */
  async disconnect(): Promise<void> {
    try {
      rawRedis.disconnect();
    } catch {
      // Suppress
    }
  },

  get isConnected(): boolean {
    return isRedisConnected;
  },
};

export default redis;
