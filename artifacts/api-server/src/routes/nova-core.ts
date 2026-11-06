/**
 * NOVA Core — Agent routes
 * ────────────────────────
 *   POST /api/nova-core/chat     → SSE stream of the agent's live execution
 *   GET  /api/nova-core/status   → persona + providers + tool count
 *   GET  /api/nova-core/tools    → full tool catalogue (schema included)
 *   POST /api/nova-core/execute  → run one tool directly (UI buttons / tests)
 *   GET  /api/nova-core/persona  → persona card
 */

import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { buildDrift, canSelfRespawn, selfRespawn, writeRestartMarker, restartMarkerPaths, restartHistory } from "../lib/self-restart";
import { runAgent, type AgentEvent } from "../lib/agent/core";
import { AGENT_TOOLS, runAgentTool, getToolSpec } from "../lib/agent/tools";
import { buildPersonaCard, NOVA_IDENTITY, NOVA_SYSTEM_PROMPT } from "../lib/agent/persona";
import { listConfiguredProviders } from "../lib/agent/llm";
import { councilMembers, runCouncil, fastComplete, pingCouncil } from "../lib/agent/council";
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
import { runSelfCheck, storageSnapshot } from "../lib/agent/self-check";
import { broadcastEvent } from "../lib/ws-hub";
import { watchStatus, watchTick } from "../lib/agent/watchers";
import { logger } from "../lib/logger";

import { requireOps } from "../lib/ops/gate";
import { awareness } from "../lib/awareness";

const router = Router();

// /nova-core/restart, /nova-core/auto-update and /nova-core/storage can redeploy
// or bounce the process — never anonymous.
router.use((req, res, next) => {
  const p = req.path;
  const sensitive =
    p.startsWith("/nova-core/restart") ||
    p.startsWith("/nova-core/auto-update") ||
    p.startsWith("/nova-core/storage");
  if (!sensitive) return next();
  return requireOps("nova-core")(req, res, next);
});

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
    /** Ask the whole council instead of a single model (slower, cross-checked). */
    council?: boolean;
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
    // Council mode: the same question goes to every configured model at once,
    // a different model judges them, and the verdict is streamed as the reply.
    // Slower than one model on purpose — it exists for the answers where being
    // wrong is expensive.
    if (body.council === true) {
      emit({ type: "ready", sessionId: body.sessionId || `nova-${Date.now()}`, mode: "llm", provider: "council", model: "multi-model", tools: AGENT_TOOLS.length } as AgentEvent);
      const verdict = await runCouncil([...((body.history ?? []).slice(-6) as Array<{ role: "user" | "assistant"; content: string }>), { role: "user" as const, content: message }], {
        system: NOVA_SYSTEM_PROMPT,
      });
      const text = verdict.ok
        ? verdict.answer
        : `مفيش إجابة من المجلس: ${verdict.error ?? "سبب غير معروف"}\n\n${verdict.hint ?? ""}`;
      for (const chunk of text.match(/[\s\S]{1,80}/g) ?? [text]) {
        emit({ type: "delta", text: chunk } as AgentEvent);
      }
      emit({
        type: "done",
        sessionId: body.sessionId || "nova-council",
        mode: "llm",
        toolCount: 0,
        ms: verdict.ms,
        provider: verdict.judge ? `${verdict.members.length} نماذج · حكم: ${verdict.judge.provider}` : `صوت واحد: ${verdict.members.find((m) => m.ok)?.provider ?? "?"}`,
      } as AgentEvent);
      broadcastEvent({ type: "agent_run_complete", agent: "nova", mode: "council", tools: [], ts: Date.now() });
      clearInterval(heartbeat);
      if (!closed && !res.writableEnded) res.end();
      return;
    }

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
    // Measured 2026-11-05: two bubbles in a real transcript were empty. The
    // cause was a thrown turn — the panel got `error`, drew nothing, and the
    // human read silence as «البرنامج عبيط». An error must also be a sentence.
    const reason = (err as Error).message || "سبب غير معروف";
    emit({ type: "error", message: reason });
    emit({
      type: "delta",
      text: `حصلت مشكلة وأنا بنفّذ الطلب: **${reason}**\n\nمفيش حاجة اتلغت ومفيش حاجة اتدفنت — جرّب تبعتها تاني، ولو كررت هات نفس الرسالة اكتبلي هنا وأنا أشتغل بالوضع الحتمي (بدون موديل).\n\n**الخطوة التالية المقترحة:** ابعت نفس الطلب تاني، أو اضغط «تنفيذ حتمي» في الشات.`,
    } as AgentEvent);
    emit({
      type: "done",
      sessionId: body.sessionId || "nova-error",
      mode: "error",
      toolCount: 0,
      ms: 0,
      provider: "none",
    } as AgentEvent);
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
    const councilSeats = await councilMembers(9);
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
      council: {
        members: councilSeats.map((p) => ({ id: p.id, label: p.label, model: p.model })),
        mode: councilSeats.length >= 2 ? "vote" : "single",
        note:
          councilSeats.length >= 2
            ? "المجلس جاهز — أكتر من نموذج بيتسألوا مع بعض، ونموذج مختلف بيحكم بينهم."
            : "نموذج واحد (أو ولا واحد) — ضيف مفتاح مجاني تاني والمجلس يبقى تصويت حقيقي.",
      },
      tools: AGENT_TOOLS.length,
      categories: [...new Set(AGENT_TOOLS.map((t) => t.category))],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/* ── the whole organism, in one call ──────────────────────────────────────── */

/**
 * GET /api/nova-core/awareness
 * What `/nova-fleet` (the manager page) reads: brain seats, council, fleet nodes,
 * ops engine, scope registry, evidence dir, throttle, memory, the live bus,
 * outbound internet, and the public sites — each MEASURED, each with a fix line
 * when it is not up. Read-only by design: counts and states, no hostnames, no
 * key values.
 */
router.get("/nova-core/awareness", async (req: Request, res: Response) => {
  try {
    const snap = await awareness(String(req.headers.host ?? ""));
    res.setHeader("Cache-Control", "no-store");
    res.json(snap);
  } catch (err) {
    // A 500 here would leave the manager page blind, which is worse than a
    // degraded snapshot: report what failed and keep the shape.
    res.status(200).json({
      ok: true,
      at: new Date().toISOString(),
      verdict: "degraded",
      moodAr: `الوعي نفسه فشل: ${(err as Error).message} — اللوحة هتعرض الليعرف.`,
      organs: [],
      error: (err as Error).message,
    });
  }
});

/* ── which build is this? ─────────────────────────────────────────────────── */

/**
 * GET /api/nova-core/version
 * The single question every deploy raises: "is the thing I just shipped the
 * thing that is running?" Reads build.json written next to the bundle.
 */
/* ── الصوت الدائم: الملاحقين (state/proactive-log.json) ─────────────────────
   * القراية مفتوحة عشان البانل يعرضها من غير توكن، والكتابة (جري تِك يدوي)
   * تحتاج مفتاح ops — نفس قاعدة باقي مسارات التحكم. */
router.get("/nova-core/watch", (_req: Request, res: Response) => {
  const s = watchStatus();
  res.json({
    ok: true,
    ...s,
    // لو المراقب ما اتشغّلش، ده بيتقال. مش بنخبي الصمت ورا مصفوفة فاضية.
    noteAr: s.enabled ? null : "المراقبين مش متشغّلين على العملية دي (NOVA_WATCHERS=0 أو السيرفر ما إقلعش من طريق index.ts) — السجل اللي باين هو آخر المكتوب.",
  });
});

router.post("/nova-core/watch/tick", (req: Request, res: Response) => {
  const guard = requireOps("nova-core");
  guard(req, res, async () => {
    const force = req.body?.force === true;
    const out = await watchTick({ force });
    res.json({ force, ...out });
  });
});

router.get("/nova-core/version", (_req: Request, res: Response) => {
  const candidates = [
    path.resolve(process.cwd(), "build.json"),
    path.resolve(process.cwd(), "..", "build.json"),
    ...(process.env.NOVA_STATIC_DIR ? [path.resolve(process.env.NOVA_STATIC_DIR, "..", "build.json")] : []),
  ];
  let build: Record<string, unknown> | null = null;
  let from: string | null = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        build = JSON.parse(fs.readFileSync(c, "utf8")) as Record<string, unknown>;
        from = c;
        break;
      } catch {
        /* a broken build.json is not worth a 500 */
      }
    }
  }
  res.setHeader("Cache-Control", "no-store");
  const drift = buildDrift();
  res.json({
    ok: true,
    build: build ?? { commit: "unknown", note: "مفيش build.json — النسخة دي أقدم من نظام البصمة" },
    // `build` is the DISK. `boot` is the code actually executing. When they
    // differ, a deploy landed and no restart happened — the exact state the
    // live Waifly slot sat in for 70 minutes on 2026-11-05.
    boot: drift.boot,
    stale: drift.stale,
    staleWhy: drift.stale
      ? `الملفات على الديسك من ${drift.disk.builtAt} والعملية الشغّالة (pid ${process.pid}) بدأت من ${drift.boot.builtAt} — محتاج إعادة تشغيل`
      : null,
    source: from,
    runtime: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  });
});

/**
 * POST/GET /api/nova-core/restart
 * Reload the running app without anyone touching the hosting panel.
 *
 * The bundle runs as a child of `boot.mjs` (see scripts/build-standalone.mjs).
 * That supervisor watches `state/.nova-restart`; touching the file makes it
 * stop the child and start it again with the freshly deployed code.
 *
 * Without the supervisor (dev server, `pnpm dev`) there is nothing to bring the
 * process back, so this endpoint refuses instead of killing the only thing
 * serving requests.
 */
const handleRestart = (req: Request, res: Response) => {
  const supervised = process.env.NOVA_SUPERVISED === "1";
  const paths = restartMarkerPaths();
  const force = String(req.query.force ?? "") === "1";
  res.setHeader("Cache-Control", "no-store");

  if (!supervised) {
    const can = canSelfRespawn();
    if (force && can.ok) {
      const started = selfRespawn();
      res.json({
        ok: started.ok,
        supervised: false,
        forced: true,
        note: started.ok
          ? "مفيش مُشرف، فالعملية بتبدّل نفسها: هتقفل دلوقتي وتقوم تاني بعد 3 ثواني على نفس البورت."
          : started.reason,
        entry: started.entry ?? null,
        marker: paths,
      });
      return;
    }
    res.status(409).json({
      ok: false,
      supervised: false,
      canSelfRespawn: can.ok,
      forceAvailable: can.ok,
      note: `${can.reason}. مفيش مُشرف في النسخة اللي شغّالة — نادِ /api/nova-core/restart?force=1 عشان البرنامج يبدّل نفسه، أو اضغط Restart من اللوحة.`,
      marker: paths,
    });
    return;
  }

  const written = writeRestartMarker();

  if (written.length === 0) {
    res.status(500).json({ ok: false, supervised: true, note: "مقدرتش أكتب ملف إعادة التشغيل" });
    return;
  }

  // Answer BEFORE the supervisor pulls the plug (~1 s).
  res.json({
    ok: true,
    supervised: true,
    restartingInMs: 1000,
    marker: written,
    trace: restartHistory(),
    note: "المُشرف شاف الملف وهيعيد تشغيل البرنامج بالنسخة الجديدة — عُد بعد 3 ثواني على /api/nova-core/version.",
  });
};

router.get("/nova-core/restart", handleRestart);
router.post("/nova-core/restart", handleRestart);

/* ── self-update (pull model) ────────────────────────────────────────────── */

/**
 * GET /api/nova-core/auto-update            → what the updater knows right now
 * GET /api/nova-core/auto-update?check=1    → run a check (no install)
 * POST /api/nova-core/auto-update           → check and install if newer
 */
router.get("/nova-core/auto-update", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { autoUpdateStatus, checkForUpdate } = await import("../lib/auto-update");
    if (String(req.query.check ?? "") === "1") {
      const state = await checkForUpdate({ install: false });
      res.json({ ok: true, ...state });
      return;
    }
    res.json({ ok: true, ...autoUpdateStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/nova-core/auto-update", async (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { checkForUpdate } = await import("../lib/auto-update");
    const state = await checkForUpdate({ install: true });
    res.json({ ok: true, ...state });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/* ── the council (multi-model deliberation) ──────────────────────────────── */

/**
 * GET /api/nova-core/council
 * Who is sitting in the council right now, and what would it take to have a real
 * vote (two or more voices).
 */
router.get("/nova-core/council", async (_req: Request, res: Response) => {
  try {
    const seats = await councilMembers(9);
    res.json({
      ok: true,
      seats: seats.map((p) => ({ id: p.id, label: p.label, model: p.model, free: true })),
      voting: seats.length >= 2,
      note:
        seats.length >= 2
          ? "المجلس بيصوّت — كل سؤال بيتسأل لأكتر من نموذج، ونموذج مختلف بيحكم."
          : "محتاج مفتاح مجاني واحد على الأقل (أو اتنين لتصويت حقيقي).",
      freeKeys: {
        groq: "console.groq.com → API Keys (مجاني، أسرع استجابة)",
        gemini: "aistudio.google.com/apikey (مجاني)",
        cerebras: "cloud.cerebras.ai (مجاني، سريع جداً)",
        openrouter: "openrouter.ai/keys (نماذج :free كتير)",
        "github-models": "github.com/settings/tokens → GITHUB_MODELS_TOKEN (مجاني بحساب GitHub)",
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * GET /api/nova-core/council/ping
 * One real request per model, so "the key is set" can never be mistaken for
 * "the key works". Open this URL in a browser after editing .env.
 */
router.get("/nova-core/council/ping", async (_req: Request, res: Response) => {
  try {
    const result = await pingCouncil();
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * POST /api/nova-core/council  { message, history?, members? }
 * Ask every configured model the same question in parallel, then have a
 * different model judge them. Returns one answer + where they disagreed.
 */
router.post("/nova-core/council", async (req: Request, res: Response) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ ok: false, error: "مفيش رسالة — اكتب سؤالك." });
    return;
  }

  const history = Array.isArray(req.body?.history)
    ? (req.body.history as Array<{ role: "user" | "assistant"; content: string }>)
        .filter((h) => h && typeof h.content === "string")
        .slice(-6)
        .map((h) => ({ role: h.role === "assistant" ? ("assistant" as const) : ("user" as const), content: h.content.slice(0, 2000) }))
    : [];

  try {
    const report = await runCouncil([...history, { role: "user", content: message }], {
      members: Number(req.body?.members) || undefined,
      system: NOVA_SYSTEM_PROMPT,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(report.ok ? 200 : 503).json(report);
  } catch (err) {
    logger.warn({ err }, "council failed");
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * POST /api/nova-core/fast  { message }
 * Race the providers and return the first good answer — for when waiting on a
 * dead provider would cost more than the answer is worth.
 */
router.post("/nova-core/fast", async (req: Request, res: Response) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ ok: false, error: "مفيش رسالة." });
    return;
  }
  try {
    const result = await fastComplete([
      { role: "system", content: NOVA_SYSTEM_PROMPT },
      { role: "user", content: message },
    ]);
    if (!result) {
      res.status(503).json({ ok: false, error: "مفيش نموذج رد في الوقت المتاح.", losers: [] });
      return;
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/* ── self check (the honest pulse) ───────────────────────────────────────── */

/**
 * GET /api/nova-core/self-check[?refresh=1]
 * Runs real probes and returns evidence, not claims. Cached ~20 s so polling
 * the dashboard cannot melt a free-tier instance.
 */
router.get("/nova-core/self-check", async (req: Request, res: Response) => {
  try {
    const refresh = String(req.query.refresh ?? "") === "1" || String(req.query.refresh) === "true";
    const report = await runSelfCheck({ refresh });
    res.setHeader("Cache-Control", "no-store");
    res.json(report);
  } catch (err) {
    logger.warn({ err }, "self-check failed");
    res.status(200).json({
      ok: false,
      score: 0,
      total: 0,
      passed: 0,
      verdict: `الفحص نفسه وقع: ${(err as Error).message}`,
      checkedAt: new Date().toISOString(),
      cached: false,
      items: [],
    });
  }
});

/** GET /api/nova-core/storage — cheap storage snapshot (no full probe). */
router.get("/nova-core/storage", (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, ...storageSnapshot() });
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

router.get("/nova-core/persona", (req: Request, res: Response) => {
  const isHttps = req.protocol === "https" || req.get("x-forwarded-proto") === "https";
  const publicUrl = `${isHttps ? "https" : "http"}://${req.get("host") || ""}`;
  res.json(buildPersonaCard(AGENT_TOOLS.map((t) => `${t.title} — ${t.description}`), publicUrl));
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
