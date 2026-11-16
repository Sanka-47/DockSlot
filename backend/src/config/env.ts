import dotenv from 'dotenv';

let envLoaded = false;

/**
 * Loads the backend `.env` file once per process.
 *
 * Config modules import this module for its side effect instead of calling
 * `dotenv.config()` directly. Keeping the loader here avoids repeated parsing
 * and duplicate "injected env" output during startup.
 */
export function loadEnv(): void {
  if (envLoaded) return;

  dotenv.config({ quiet: true });
  envLoaded = true;
}

loadEnv();
