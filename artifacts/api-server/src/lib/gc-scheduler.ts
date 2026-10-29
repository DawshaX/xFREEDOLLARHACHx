/**
 * Periodic garbage collection — runs every 5 minutes if --expose-gc is available.
 * Helps keep memory usage low on long-running Node.js processes.
 */
import { logger } from "./logger";

declare const global: Record<string, unknown>;

export function scheduleGC(): void {
  if (typeof global["gc"] !== "function") return;
  const gc = global["gc"] as () => void;
  setInterval(() => {
    const before = process.memoryUsage().heapUsed;
    gc();
    const after = process.memoryUsage().heapUsed;
    const freedMb = Math.round((before - after) / 1024 / 1024);
    if (freedMb > 0) {
      logger.info({ freedMb }, "GC: heap reclaimed");
    }
  }, 5 * 60 * 1000);
  logger.info("GC scheduler active (5-min interval)");
}
