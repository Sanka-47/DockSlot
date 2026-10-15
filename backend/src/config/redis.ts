import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// In-memory fallback map for zero-dependency local development without Docker
const inMemoryStore = new Map<string, string>();
let isRedisConnected = false;

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

rawRedis.on('error', (err) => {
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
    return inMemoryStore.get(key) ?? null;
  },

  /**
   * Sets key to hold the string value.
   */
  async set(key: string, value: string | number, ...args: any[]): Promise<'OK' | string | null> {
    const strVal = String(value);
    inMemoryStore.set(key, strVal);
    if (isRedisConnected) {
      try {
        return await (rawRedis as any).set(key, strVal, ...args);
      } catch {
        // Fall back to in-memory store
      }
    }
    return 'OK';
  },

  /**
   * Increments the number stored at key by one.
   * If key does not exist, it is set to 0 before performing the operation.
   */
  async incr(key: string): Promise<number> {
    if (isRedisConnected) {
      try {
        const val = await rawRedis.incr(key);
        inMemoryStore.set(key, String(val));
        return val;
      } catch {
        // Fall back to in-memory store
      }
    }
    const current = parseInt(inMemoryStore.get(key) || '0', 10);
    const next = current + 1;
    inMemoryStore.set(key, String(next));
    return next;
  },

  /**
   * Removes the specified key.
   */
  async del(key: string): Promise<number> {
    const existed = inMemoryStore.has(key) ? 1 : 0;
    inMemoryStore.delete(key);
    if (isRedisConnected) {
      try {
        return await rawRedis.del(key);
      } catch {
        // Fall back to in-memory store
      }
    }
    return existed;
  },

  /**
   * Returns PONG if client/fallback is ready.
   */
  async ping(): Promise<string> {
    if (isRedisConnected) {
      try {
        return await rawRedis.ping();
      } catch {
        // Fall back
      }
    }
    return 'PONG';
  },

  /**
   * Clears the store.
   */
  async flushall(): Promise<'OK'> {
    inMemoryStore.clear();
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
