import { Router, type Request, type Response } from "express";

const router = Router();

const clients = new Set<Response>();

export interface LiveEvent {
  type: string;
  data: Record<string, unknown>;
  ts: string;
}

/**
 * Rolling history of the last N events.
 *
 * Until now the bus was fire-and-forget: a panel that loaded a second late saw
 * nothing. Keeping a small ring buffer means `/api/events/history` can answer
 * with real recent events instead of an empty array or, worse, SPA HTML.
 */
const HISTORY_LIMIT = 200;
const history: LiveEvent[] = [];

export function getLiveEventHistory(limit = 50): LiveEvent[] {
  const n = Math.max(1, Math.min(HISTORY_LIMIT, limit));
  return history.slice(-n).reverse();
}

export function broadcastLiveEvent(
  eventOrType: LiveEvent | string | Record<string, unknown>,
  data?: Record<string, unknown>,
): void {
  const obj =
    typeof eventOrType === "string"
      ? { type: eventOrType, data: data ?? {}, ts: new Date().toISOString() }
      : eventOrType;
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  if (obj && typeof obj === "object" && "type" in obj) {
    history.push(obj as LiveEvent);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  }
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

/**
 * Register an SSE response on the shared platform event bus.
 * Used by `/api/live-events` and `/api/agent/events` so that every real-time
 * consumer (SystemContext, dashboards, ...) receives the same broadcast stream.
 */
export function subscribeLiveEvents(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);
  clients.add(res);

  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); clients.delete(res); }
  }, 20_000);

  req.on("close", () => { clearInterval(ping); clients.delete(res); });
}

router.get("/live-events", subscribeLiveEvents);

// Alias consumed by the frontend SystemContext (GET /api/agent/events)
router.get("/agent/events", subscribeLiveEvents);

router.get("/live-events/count", (_req, res) => {
  res.json({ subscribers: clients.size });
});

export default router;
