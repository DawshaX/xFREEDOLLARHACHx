/**
 * Ollama real-time status SSE endpoint.
 *
 * GET /api/ollama/status        — JSON snapshot
 * GET /api/ollama/status/stream — SSE stream (auto-retry every 30s)
 * GET /api/ollama/models        — list installed Ollama models
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { settings } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

async function OLLAMA_BASE_URL(): Promise<string> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, "ollamaBaseUrl")).limit(1);
    const val = rows[0]?.value;
    if (val && typeof val === "string" && val.startsWith("http")) return val.replace(/\/$/, "");
  } catch { /* fall through */ }
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

const OLLAMA_MODEL = () => process.env.OLLAMA_MODEL || "dolphin-llama3";

export interface OllamaStatusSnapshot {
  connected: boolean;
  baseUrl: string;
  model: string;
  checkedAt: string;
  latencyMs?: number;
  models?: string[];
  error?: string;
}

async function probeOllama(): Promise<OllamaStatusSnapshot> {
  const baseUrl = await OLLAMA_BASE_URL();
  const model = OLLAMA_MODEL();
  const start = Date.now();

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2_000);
    const r = await fetch(`${baseUrl}/api/tags`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "CyberNova/3.0" },
    });
    clearTimeout(t);

    if (!r.ok) {
      return {
        connected: false,
        baseUrl,
        model,
        checkedAt: new Date().toISOString(),
        error: `HTTP ${r.status}`,
      };
    }

    const data = (await r.json()) as { models?: Array<{ name: string }> };
    const latencyMs = Date.now() - start;
    const models = (data.models ?? []).map((m) => m.name);

    return {
      connected: true,
      baseUrl,
      model,
      checkedAt: new Date().toISOString(),
      latencyMs,
      models,
    };
  } catch (err) {
    return {
      connected: false,
      baseUrl,
      model,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

// ── Cached state ──────────────────────────────────────────────────────────────

let _cache: OllamaStatusSnapshot | null = null;
let _cacheAt = 0;
const CACHE_TTL = 10_000; // 10s for JSON endpoint

async function getCached(): Promise<OllamaStatusSnapshot> {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  _cache = await probeOllama();
  _cacheAt = Date.now();
  return _cache;
}

// ── SSE broadcast ─────────────────────────────────────────────────────────────

type SseClient = { res: import("express").Response; id: number };
const sseClients: SseClient[] = [];
let sseClientIdSeq = 0;

// Background probe every 30s and broadcast to all SSE clients
let lastBroadcastStatus: boolean | null = null;

async function broadcastToAll(): Promise<void> {
  const status = await probeOllama();
  _cache = status;
  _cacheAt = Date.now();

  // Only broadcast if connected status changed OR every 30s regardless
  const changed = status.connected !== lastBroadcastStatus;
  lastBroadcastStatus = status.connected;

  if (sseClients.length === 0) return;

  const payload = `data: ${JSON.stringify(status)}\n\n`;

  for (let i = sseClients.length - 1; i >= 0; i--) {
    const client = sseClients[i];
    try {
      client.res.write(payload);
    } catch {
      sseClients.splice(i, 1);
    }
  }

  if (changed) {
    // extra broadcast on change
    console.info(
      `[ollama-status] ${status.connected ? "✅ Connected" : "❌ Disconnected"} — ${status.baseUrl}`,
    );
  }
}

// Start background probe timer (lazy — only when first SSE client connects)
let bgTimer: ReturnType<typeof setInterval> | null = null;

function ensureBgTimer(): void {
  if (bgTimer) return;
  bgTimer = setInterval(() => void broadcastToAll(), 30_000);
  // First probe immediately
  void broadcastToAll();
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** JSON snapshot (cached 10s) */
router.get("/ollama/status", async (_req, res) => {
  const status = await getCached();
  res.json(status);
});

/** Force a fresh probe and return */
router.post("/ollama/status/probe", async (_req, res) => {
  _cache = null; // invalidate cache
  const status = await probeOllama();
  _cache = status;
  _cacheAt = Date.now();
  // Broadcast to SSE clients
  if (sseClients.length > 0) {
    const payload = `data: ${JSON.stringify(status)}\n\n`;
    for (let i = sseClients.length - 1; i >= 0; i--) {
      try { sseClients[i].res.write(payload); } catch { sseClients.splice(i, 1); }
    }
  }
  res.json(status);
});

/** SSE stream — pushes status every 30s and on change */
router.get("/ollama/status/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();

  const clientId = ++sseClientIdSeq;
  sseClients.push({ res, id: clientId });

  ensureBgTimer();

  // Send current cached status immediately on connect
  void getCached().then((status) => {
    try {
      res.write(`data: ${JSON.stringify(status)}\n\n`);
    } catch {
      // client already gone
    }
  });

  // Heartbeat every 25s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const idx = sseClients.findIndex((c) => c.id === clientId);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

/** List installed models */
router.get("/ollama/models", async (_req, res) => {
  const baseUrl = await OLLAMA_BASE_URL();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2_000);
    const r = await fetch(`${baseUrl}/api/tags`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "CyberNova/3.0" },
    });
    clearTimeout(t);
    if (!r.ok) {
      res.status(502).json({ error: `Ollama returned HTTP ${r.status}` });
      return;
    }
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Ollama not reachable",
      baseUrl,
    });
  }
});

/** Config — what model/baseURL the server expects */
router.get("/ollama/config", async (_req, res) => {
  res.json({
    baseUrl: await OLLAMA_BASE_URL(),
    model: OLLAMA_MODEL(),
    provider: "ollama",
  });
});

export default router;
