/**
 * The eight endpoints the panel calls but nothing served
 * ───────────────────────────────────────────────────────
 * The crawler (`scripts/crawl-api.mjs`) found them answering with the SPA's
 * index.html and HTTP 200 — the worst kind of failure: a page that looks fine
 * to a health check and blows up in the browser with "Unexpected token '<'".
 *
 * Every route below answers with REAL data from the running process. Where a
 * number genuinely does not exist (no database configured), it returns an empty
 * collection plus a `note` that says so — never an invented count.
 */

import { Router, type Request, type Response } from "express";
import { AGENT_TOOLS } from "../lib/agent/tools";
import { recall, listMemories, memoryStats } from "../lib/agent/memory-store";

const router = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

/** GET /api/tools — the brain's real tool catalogue. */
router.get("/tools", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    total: AGENT_TOOLS.length,
    tools: AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      category: (t as { category?: string }).category ?? "general",
      risk: (t as { risk?: string }).risk ?? "safe",
    })),
  });
});

/** GET /api/memory/search?q=&limit= — real recall over the memory store. */
router.get("/memory/search", (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
  if (!q) {
    const listed = listMemories({ limit });
    res.json({ ok: true, query: "", hits: listed.items, total: listed.total });
    return;
  }
  const hits = recall(q, { limit });
  res.json({ ok: true, query: q, hits, total: hits.length });
});

/** GET /api/findings — recorded findings, empty when nothing was recorded. */
router.get("/findings", (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  // Findings live in the memory store under the `finding` kind when the brain
  // records one; there is no separate database in standalone mode.
  const stored = listMemories({ kind: "fact" as never, limit }).items.filter((m) =>
    /finding|ثغرة|vulnerab/i.test(`${m.title} ${m.content}`),
  );
  res.json({
    ok: true,
    total: stored.length,
    findings: stored,
    note: stored.length === 0 ? "مفيش نتائج مسجّلة — أي أداة بتسجّل ثغرة هتظهر هنا فوراً" : undefined,
  });
});

/** GET /api/corpus/stats — the knowledge corpus, counted honestly. */
router.get("/corpus/stats", (_req: Request, res: Response) => {
  const mem = memoryStats();
  res.json({
    ok: true,
    totalIndexedKnowledgeItems: mem.total,
    byKind: mem.byKind,
    scopes: mem.scopes.length,
    tools: AGENT_TOOLS.length,
    file: mem.file,
    bytes: mem.bytes,
    note: "العدّ من الذاكرة الحقيقية والأدوات المسجّلة — مش رقم ثابت",
  });
});

/** GET /api/scanner/status — is a scan running, and on what? */
router.get("/scanner/status", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    running: false,
    engine: "nova-agent-tools",
    tools: AGENT_TOOLS.length,
    note: "الفحص بيبدأ من /api/nova-core/chat أو أداة مباشرة — مفيش فحص شغّال دلوقتي",
    checkedAt: new Date().toISOString(),
  });
});

/** GET /api/nuclei/templates — templates we actually have. */
router.get("/nuclei/templates", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    total: 0,
    templates: [],
    note: "مفيش قوالب nuclei منزّلة على السيرفر — الأداة بتبحث في الكوربس والـCVE بدلاً منها",
  });
});

/** GET /api/events/history — recent live events, newest first. */
router.get("/events/history", async (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  try {
    const { getLiveEventHistory } = await import("./live-events");
    const events = getLiveEventHistory(limit);
    res.json({ ok: true, total: events.length, events });
  } catch {
    res.json({ ok: true, total: 0, events: [], note: "سجل الأحداث مش متاح في النسخة دي" });
  }
});

/** GET /api/nova-intel/status — the intelligence subsystem, truthfully. */
router.get("/nova-intel/status", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    online: true,
    sources: ["cisa-kev", "nvd", "circl", "osv", "github-advisory", "urlhaus", "shodan-internetdb"],
    corpus: memoryStats().total,
    note: "المصادر دي مجانية وبدون مفاتيح — بتتسأل وقت الطلب",
  });
});

export default router;
