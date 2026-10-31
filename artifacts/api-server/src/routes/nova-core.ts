/**
 * NOVA Core — Agent routes
 * ────────────────────────
 *   POST /api/nova-core/chat     → SSE stream of the agent's live execution
 *   GET  /api/nova-core/status   → persona + providers + tool count
 *   GET  /api/nova-core/tools    → full tool catalogue (schema included)
 *   POST /api/nova-core/execute  → run one tool directly (UI buttons / tests)
 *   GET  /api/nova-core/persona  → persona card
 */

import { Router, type Request, type Response } from "express";
import { runAgent, type AgentEvent } from "../lib/agent/core";
import { AGENT_TOOLS, runAgentTool, getToolSpec } from "../lib/agent/tools";
import { buildPersonaCard, NOVA_IDENTITY } from "../lib/agent/persona";
import { listConfiguredProviders } from "../lib/agent/llm";
import {
  listMemories,
  memoryStats,
  recall,
  remember,
  forget,
  forgetMany,
  pinMemory,
  updateMemory,
  exportMemories,
  importMemories,
  flushMemory,
  initMemory,
  type MemoryKind,
} from "../lib/agent/memory-store";
import { ensureOllamaReady, ollamaHealth } from "../lib/agent/ollama-manager";
import { broadcastEvent } from "../lib/ws-hub";
import { logger } from "../lib/logger";

const router = Router();

/** Shared SSE header setup. */
function openSse(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

/* ── chat (the heart) ────────────────────────────────────────────────────── */

router.post("/nova-core/chat", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    message?: string;
    sessionId?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    forceHeuristic?: boolean;
    approve?: string[];
  };
  const message = String(body.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  openSse(res);
  let closed = false;
  // NOTE: listen on `res`, not `req`. In Node 20+/22 the request stream emits
  // "close" as soon as the (already-consumed) body stream ends, which would
  // silence the very first event. Response "close" only fires on real aborts.
  res.on("close", () => {
    closed = true;
  });

  const emit = (event: AgentEvent) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      (res as Response & { flush?: () => void }).flush?.();
    } catch {
      closed = true;
    }
  };

  // Heartbeat keeps proxies from closing an idle stream during long tool runs.
  const heartbeat = setInterval(() => {
    if (closed || res.writableEnded) return;
    try {
      res.write(": ping\n\n");
    } catch {
      /* ignore */
    }
  }, 15_000);

  try {
    const result = await runAgent({
      message,
      sessionId: body.sessionId,
      history: Array.isArray(body.history) ? body.history.slice(-8) : [],
      forceHeuristic: body.forceHeuristic === true,
      approved: Array.isArray(body.approve) ? body.approve.map(String) : [],
      emit,
    });
    broadcastEvent({ type: "agent_run_complete", agent: "nova", mode: result.mode, tools: result.toolsUsed, ts: Date.now() });
  } catch (err) {
    logger.warn({ err }, "nova-core chat failed");
    emit({ type: "error", message: (err as Error).message });
  } finally {
    clearInterval(heartbeat);
    if (!closed && !res.writableEnded) res.end();
  }
});

/* ── status ──────────────────────────────────────────────────────────────── */

router.get("/nova-core/status", async (_req: Request, res: Response) => {
  try {
    const providers = await listConfiguredProviders();
    const ollama = providers.find((p) => p.id === "ollama");
    let ollamaOnline = false;
    if (ollama) {
      try {
        const r = await fetch(`${ollama.baseUrl}/api/tags`, {
          headers: { "ngrok-skip-browser-warning": "1" },
          signal: AbortSignal.timeout(2500),
        });
        ollamaOnline = r.ok;
      } catch {
        ollamaOnline = false;
      }
    }
    const cloudProviders = providers.filter((p) => p.id !== "ollama");
    res.json({
      ok: true,
      identity: NOVA_IDENTITY,
      brain: {
        mode: ollamaOnline || cloudProviders.length > 0 ? "llm" : "builtin",
        ollamaOnline,
        ollamaModel: ollama?.model ?? null,
        cloudProviders: cloudProviders.map((p) => ({ id: p.id, label: p.label, model: p.model })),
        note:
          ollamaOnline || cloudProviders.length > 0
            ? "العقل اللغوي متصل — نوفا تفكّر وتخطّط بنفسها."
            : "لا يوجد نموذج لغوي متاح الآن، لكن العقل المدمج ينفّذ نفس الأدوات الحقيقية بنفس الترتيب.",
      },
      tools: AGENT_TOOLS.length,
      categories: [...new Set(AGENT_TOOLS.map((t) => t.category))],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/* ── catalogue ───────────────────────────────────────────────────────────── */

router.get("/nova-core/tools", (_req: Request, res: Response) => {
  res.json({
    total: AGENT_TOOLS.length,
    tools: AGENT_TOOLS,
  });
});

router.get("/nova-core/persona", (_req: Request, res: Response) => {
  res.json(buildPersonaCard(AGENT_TOOLS.map((t) => `${t.title} — ${t.description}`)));
});

/* ── direct execution ────────────────────────────────────────────────────── */

router.post("/nova-core/execute", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { tool?: string; args?: Record<string, unknown> };
  const tool = String(body.tool ?? "");
  if (!tool) {
    res.status(400).json({ error: "tool is required" });
    return;
  }
  if (!getToolSpec(tool)) {
    res.status(404).json({ error: `unknown tool: ${tool}`, available: AGENT_TOOLS.map((t) => t.name) });
    return;
  }
  try {
    const result = await runAgentTool(tool, body.args ?? {});
    res.json({ ok: result.ok, tool, summary: result.summary, ms: result.ms, data: result.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/* ── long-term memory (durable, on disk) ─────────────────────────────────── */

const KINDS: MemoryKind[] = ["fact", "preference", "lesson", "event", "session"];

router.get("/nova-core/memory", (req: Request, res: Response) => {
  initMemory();
  const kind = String(req.query.kind ?? "");
  const res1 = listMemories({
    kind: KINDS.includes(kind as MemoryKind) ? (kind as MemoryKind) : undefined,
    scope: req.query.scope ? String(req.query.scope) : undefined,
    limit: Number(req.query.limit ?? 50),
    offset: Number(req.query.offset ?? 0),
    sort: req.query.sort === "important" ? "important" : "recent",
  });
  res.json({ ...res1, stats: memoryStats() });
});

router.get("/nova-core/memory/stats", (_req: Request, res: Response) => {
  initMemory();
  res.json(memoryStats());
});

router.get("/nova-core/memory/search", (req: Request, res: Response) => {
  initMemory();
  const q = String(req.query.q ?? "").trim();
  const hits = recall(q, {
    scope: req.query.scope ? String(req.query.scope) : undefined,
    limit: Number(req.query.limit ?? 12),
  });
  res.json({ query: q, count: hits.length, hits });
});

router.post("/nova-core/memory", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    kind?: string;
    title?: string;
    content?: string;
    scope?: string;
    tags?: string[];
    importance?: number;
    pinned?: boolean;
  };
  if (!body.title || !body.content) {
    res.status(400).json({ error: "title and content are required" });
    return;
  }
  const rec = remember({
    kind: KINDS.includes(body.kind as MemoryKind) ? (body.kind as MemoryKind) : "fact",
    title: body.title,
    content: body.content,
    scope: body.scope,
    tags: body.tags,
    importance: body.importance,
    pinned: body.pinned,
    source: "user",
  });
  res.status(201).json(rec);
});

router.patch("/nova-core/memory/:id", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: string; content?: string; importance?: number; tags?: string[]; scope?: string };
  const rec = updateMemory(String(req.params.id), body);
  if (!rec) {
    res.status(404).json({ error: "memory not found" });
    return;
  }
  res.json(rec);
});

router.patch("/nova-core/memory/:id/pin", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { pinned?: boolean };
  const rec = pinMemory(String(req.params.id), body.pinned !== false);
  if (!rec) {
    res.status(404).json({ error: "memory not found" });
    return;
  }
  res.json(rec);
});

router.delete("/nova-core/memory/:id", (req: Request, res: Response) => {
  const ok = forget(String(req.params.id));
  res.status(ok ? 200 : 404).json({ deleted: ok, id: req.params.id });
});

router.delete("/nova-core/memory", (req: Request, res: Response) => {
  const kind = String(req.query.kind ?? "");
  const removed = forgetMany({
    kind: KINDS.includes(kind as MemoryKind) ? (kind as MemoryKind) : undefined,
    scope: req.query.scope ? String(req.query.scope) : undefined,
    olderThanDays: req.query.olderThanDays ? Number(req.query.olderThanDays) : undefined,
  });
  res.json({ removed });
});

router.get("/nova-core/memory/export", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nova-memory-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(exportMemories());
});

router.post("/nova-core/memory/import", (req: Request, res: Response) => {
  const body = req.body as { records?: unknown[] } | undefined;
  if (!body) {
    res.status(400).json({ error: "body required" });
    return;
  }
  try {
    const result = importMemories(JSON.stringify(body));
    flushMemory();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/* ── local model (Ollama) self-management ────────────────────────────────── */

router.get("/nova-core/ollama", async (_req: Request, res: Response) => {
  try {
    res.json(await ollamaHealth());
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/nova-core/ollama/prepare", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { model?: string; pull?: boolean };
  try {
    const result = await ensureOllamaReady({ model: body.model, allowPull: body.pull !== false });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
