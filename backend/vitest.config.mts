import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite runs against ONE shared MySQL database. Several files create and
    // assert on outbox rows, and the outbox-worker test drains the global queue.
    // Running files concurrently lets one file steal another's due events, so
    // files are executed serially.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    // Keep the existing booking/outbox suite on the immediate-BOOKED path.
    // Stripe-specific unit tests exercise payment logic without network calls.
    env: {
      NODE_ENV: 'test',
      PAYMENTS_MODE: 'disabled',
    },
  },
});
