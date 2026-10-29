/**
 * Nova Gateway — Centralized AI + ngrok auto-detect + health checks
 *
 * GET  /api/nova/gateway/status   — full system status (all providers + ngrok + Ollama)
 * POST /api/nova/gateway/ngrok    — update ngrok URL and probe it
 * GET  /api/nova/gateway/stream   — SSE stream of live status updates
 */

import { Router } from "express";
import { listMultiProviders } from "../lib/ai-multi-router";
import { logger } from "../lib/logger";
import { db, settings } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

interface NgrokStatus {
  url: string;
  online: boolean;
  latencyMs?: number;
  models?: string[];
  error?: string;
  checkedAt: string;
}

interface OllamaLocalStatus {
  online: boolean;
  baseUrl: string;
  latencyMs?: number;
  models?: string[];
  error?: string;
  checkedAt: string;
}

interface GatewayStatus {
  ngrok: NgrokStatus;
  ollamaLocal: OllamaLocalStatus;
  multiProviders: {
    total: number;
    available: number;
    enabled: number;
    providers: Array<{
      id: string;
      displayName: string;
      emoji: string;
      available: boolean;
      enabled: boolean;
      speed: string;
      exhaustedUntil?: number;
    }>;
  };
  systemOnline: boolean;
  activeModelCount: number;
  timestamp: string;
}

let _gatewayCache: GatewayStatus | null = null;
let _gatewayCacheAt = 0;
const GATEWAY_CACHE_TTL = 8_000;

async function getDbSetting(key: string): Promise<string | undefined> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return rows[0]?.value;
  } catch { return undefined; }
}

async function probeNgrokUrl(url: string): Promise<NgrokStatus> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4_000);
    const r = await fetch(`${url.replace(/\/$/, "")}/api/tags`, {
      signal: ctrl.signal,
      headers: {
        "ngrok-skip-browser-warning": "1",
        "User-Agent": "CyberNova/3.0",
      },
    });
    clearTimeout(t);

    if (!r.ok) {
      return { url, online: false, error: `HTTP ${r.status}`, checkedAt: new Date().toISOString() };
    }

    const data = await r.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    return {
      url,
      online: true,
      latencyMs: Date.now() - start,
      models,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      url,
      online: false,
      error: err instanceof Error ? err.message.slice(0, 100) : "Connection failed",
      checkedAt: new Date().toISOString(),
    };
  }
}

async function probeOllamaLocal(): Promise<OllamaLocalStatus> {
  const baseUrl = (await getDbSetting("ollamaBaseUrl")) || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2_500);
    const r = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);

    if (!r.ok) {
      return { online: false, baseUrl, error: `HTTP ${r.status}`, checkedAt: new Date().toISOString() };
    }

    const data = await r.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    return {
      online: true,
      baseUrl,
      latencyMs: Date.now() - start,
      models,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      online: false,
      baseUrl,
      error: err instanceof Error ? err.message.slice(0, 100) : "Not reachable",
      checkedAt: new Date().toISOString(),
    };
  }
}

async function buildGatewayStatus(): Promise<GatewayStatus> {
  const ngrokUrl = (await getDbSetting("ngrokUrl")) || "https://nucleus-uninjured-tusk.ngrok-free.dev";

  const [ngrok, ollamaLocal, multiProviders] = await Promise.all([
    probeNgrokUrl(ngrokUrl),
    probeOllamaLocal(),
    listMultiProviders(),
  ]);

  const available = multiProviders.filter((p) => p.available);
  const enabled = multiProviders.filter((p) => p.available && p.enabled);

  const status: GatewayStatus = {
    ngrok,
    ollamaLocal,
    multiProviders: {
      total: multiProviders.length,
      available: available.length,
      enabled: enabled.length,
      providers: multiProviders.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        emoji: p.emoji,
        available: p.available,
        enabled: p.enabled,
        speed: p.speed,
        ...(p.exhaustedUntil ? { exhaustedUntil: p.exhaustedUntil } : {}),
      })),
    },
    systemOnline: ngrok.online || ollamaLocal.online || enabled.length > 0,
    activeModelCount: enabled.length + (ngrok.online ? 1 : 0) + (ollamaLocal.online ? 1 : 0),
    timestamp: new Date().toISOString(),
  };

  _gatewayCache = status;
  _gatewayCacheAt = Date.now();
  return status;
}

async function getCachedStatus(): Promise<GatewayStatus> {
  if (_gatewayCache && Date.now() - _gatewayCacheAt < GATEWAY_CACHE_TTL) return _gatewayCache;
  return buildGatewayStatus();
}

// ── GET /api/nova/gateway/status ─────────────────────────────────────────────
router.get("/nova/gateway/status", async (_req, res) => {
  try {
    const status = await getCachedStatus();
    res.json(status);
  } catch (err) {
    logger.error({ err }, "nova/gateway/status error");
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/nova/gateway/ngrok ─────────────────────────────────────────────
router.post("/nova/gateway/ngrok", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url?.startsWith("http")) {
    res.status(400).json({ error: "Valid URL required" });
    return;
  }

  const clean = url.trim().replace(/\/$/, "");

  try {
    // Save to DB
    await db.insert(settings).values({ key: "ngrokUrl", value: clean })
      .onConflictDoUpdate({ target: settings.key, set: { value: clean, updatedAt: new Date() } });

    // Invalidate cache and probe immediately
    _gatewayCache = null;
    const ngrokStatus = await probeNgrokUrl(clean);

    if (ngrokStatus.online) {
      // Save the model if found
      const defaultModel = ngrokStatus.models?.[0] ?? "dolphin-llama3:latest";
      await db.insert(settings).values({ key: "ngrokModel", value: defaultModel })
        .onConflictDoUpdate({ target: settings.key, set: { value: defaultModel, updatedAt: new Date() } });
    }

    res.json({ saved: true, url: clean, status: ngrokStatus });
  } catch (err) {
    logger.error({ err }, "nova/gateway/ngrok update error");
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/nova/gateway/probe ──────────────────────────────────────────────
router.get("/nova/gateway/probe", async (_req, res) => {
  _gatewayCache = null;
  try {
    const status = await buildGatewayStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── SSE Stream ───────────────────────────────────────────────────────────────
type SseClient = { res: import("express").Response; id: number };
const sseClients: SseClient[] = [];
let sseClientSeq = 0;

async function broadcastGatewayStatus(): Promise<void> {
  if (sseClients.length === 0) return;
  try {
    const status = await buildGatewayStatus();
    const payload = `data: ${JSON.stringify(status)}\n\n`;
    for (let i = sseClients.length - 1; i >= 0; i--) {
      try { sseClients[i].res.write(payload); }
      catch { sseClients.splice(i, 1); }
    }
  } catch { /* ignore */ }
}

let bgTimer: ReturnType<typeof setInterval> | null = null;
function ensureBgTimer() {
  if (bgTimer) return;
  bgTimer = setInterval(() => void broadcastGatewayStatus(), 15_000);
  void broadcastGatewayStatus();
}

router.get("/nova/gateway/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const clientId = ++sseClientSeq;
  sseClients.push({ res, id: clientId });
  ensureBgTimer();

  void getCachedStatus().then((s) => {
    try { res.write(`data: ${JSON.stringify(s)}\n\n`); } catch { /* gone */ }
  });

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const idx = sseClients.findIndex((c) => c.id === clientId);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

export default router;
