import type { Server } from 'http';
import app from './app';
import { prisma } from './config/db.config';
import { outboxWorker } from './workers/outbox.worker';

const PORT = process.env.PORT || 5000;

/** How long to wait for in-flight work before forcing the process to exit. */
const SHUTDOWN_TIMEOUT_MS = 15000;

if (process.env.NODE_ENV !== 'test') {
  const server: Server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Swagger documentation available at http://localhost:${PORT}/api-docs`);
  });

  // Start the transactional outbox drain loop. It runs entirely outside the
  // request path, so booking endpoints return as soon as the DB transaction commits.
  outboxWorker.start();

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[Server] ${signal} received. Shutting down gracefully...`);

    // Hard deadline: never hang the process on a stuck socket or delivery cycle.
    const forceExit = setTimeout(() => {
      console.error('[Server] Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      // 1. Stop dispatching and let any in-flight webhook cycle settle so no
      //    event is left stranded in PROCESSING.
      await outboxWorker.stop();

      // 2. Stop accepting new connections and finish in-flight HTTP responses.
      await new Promise<void>((resolve) => server.close(() => resolve()));

      // 3. Release database connections.
      await prisma.$disconnect();

      clearTimeout(forceExit);
      console.log('[Server] Shutdown complete.');
      process.exit(0);
    } catch (error: any) {
      console.error(`[Server] Error during shutdown: ${error?.message || String(error)}`);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

export { app };
export default app;
