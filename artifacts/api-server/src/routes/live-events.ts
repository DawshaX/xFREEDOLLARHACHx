import { Router, type Request, type Response } from "express";

const router = Router();

const clients = new Set<Response>();

export interface LiveEvent {
  type: string;
  data: Record<string, unknown>;
  ts: string;
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
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

router.get("/live-events", (req: Request, res: Response) => {
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
});

router.get("/live-events/count", (_req, res) => {
  res.json({ subscribers: clients.size });
});

export default router;
