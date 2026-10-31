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

export default router;
