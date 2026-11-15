import { useEffect, useState } from 'react';

/**
 * A coarse clock for UI state that depends on "now" (active closures, status
 * availability, timezone offsets). Keeping it in state avoids reading the
 * impure clock during render while still refreshing periodically.
 */
export function useNow(intervalMs: number = 30_000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
