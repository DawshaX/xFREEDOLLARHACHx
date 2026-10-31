/**
 * Stub routes for CyberNova frontend compatibility
 * These provide sensible empty responses so the UI loads without errors
 */
import { Router } from "express";
import { getMemoryCount } from "./memory";

const router = Router();

// ── CVE routes ────────────────────────────────────────────────────────────────
router.get("/cve/db/search", (_req, res) => {
  res.json({ cves: [], items: [], total: 0, page: 1, limit: 20 });
});

router.get("/cve/db/stats", (_req, res) => {
  res.json({ total: 0, critical: 0, high: 0, medium: 0, low: 0, lastUpdated: null, bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } });
});

router.get("/cve/recent", (req, res) => {
  res.json([]);
});

router.get("/cve/sync/status", (_req, res) => {
  res.json(null);
});

router.post("/cve/sync", (_req, res) => {
  res.json({ ok: true, started: false, message: "CVE sync not available — database not connected" });
});

router.get("/cve/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 25_000);
  req.on("close", () => clearInterval(ping));
});

router.get("/cves", (_req, res) => {
  res.json({ cves: [], total: 0 });
});

router.get("/cves/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders?.();
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 25_000);
  req.on("close", () => clearInterval(ping));
});

// ── Stats / Dashboard ─────────────────────────────────────────────────────────
router.get("/stats/dashboard", (_req, res) => {
  res.json({
    scans: { total: 0, active: 0, completed: 0, failed: 0 },
    vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 },
    nodes: { total: 0, active: 0, offline: 0 },
    alerts: { unread: 0, total: 0 },
    uptime: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  });
});

router.get("/stats/overview", (_req, res) => {
  res.json({ scans: 0, nodes: 0, alerts: 0, vulnerabilities: 0 });
});

// ── Monitor / System ──────────────────────────────────────────────────────────
router.get("/monitor/system", (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    cpu: { usage: 0, cores: 1, model: "unknown" },
    memory: {
      total: mem.heapTotal,
      used: mem.heapUsed,
      free: mem.heapTotal - mem.heapUsed,
      pct: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    },
    uptime: Math.round(process.uptime()),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    ts: new Date().toISOString(),
  });
});

router.get("/monitor/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = () => {
    const mem = process.memoryUsage();
    try {
      res.write(`data: ${JSON.stringify({
        type: "stats",
        cpu: 0,
        memUsed: mem.heapUsed,
        memTotal: mem.heapTotal,
        uptime: process.uptime(),
        ts: Date.now(),
      })}\n\n`);
    } catch { clearInterval(timer); }
  };
  send();
  const timer = setInterval(send, 5000);
  req.on("close", () => clearInterval(timer));
});

// ── Bot routes ────────────────────────────────────────────────────────────────
router.get("/bot/status", (_req, res) => {
  res.json({ status: "online", availableTools: 90, cronJobs: { enabled: 0 }, alerts: { unread: 0 } });
});

router.get("/bot/alerts", (_req, res) => {
  res.json([]);
});

router.get("/bot/cron", (_req, res) => {
  res.json([]);
});

router.post("/bot/alerts/:id/read", (req, res) => {
  res.json({ ok: true, id: req.params.id });
});

// ── Providers ─────────────────────────────────────────────────────────────────
router.get("/providers/status", (_req, res) => {
  res.json({
    providers: [{ provider: "dolphin-llama3", configured: true, status: "online" }],
    activeProvider: "dolphin-llama3",
  });
});

router.get("/providers/detailed", (_req, res) => {
  res.json({
    providers: [
      {
        id: "ollama-ngrok",
        name: "Dolphin LLaMA3 (Ngrok)",
        configured: true,
        status: "online",
        models: ["dolphin-llama3:latest"],
        activeModel: "dolphin-llama3:latest",
      },
    ],
    active: "ollama-ngrok",
  });
});

// ── Agent routes ──────────────────────────────────────────────────────────────
router.get("/agent/tasks", (_req, res) => {
  res.json([]);
});

router.post("/agent/tasks", (req, res) => {
  res.json({ id: `task-${Date.now()}`, status: "queued", ts: new Date().toISOString() });
});

router.get("/agent/status", (_req, res) => {
  res.json({ status: "online", version: "2.0", capabilities: ["chat", "exec", "kali"] });
});

// ── Intel / Knowledge ─────────────────────────────────────────────────────────
router.get("/intel/recent", (_req, res) => {
  res.json({ items: [] });
});

router.get("/knowledge", (_req, res) => {
  res.json({ items: [], total: getMemoryCount() });
});

router.get("/knowledge/stats", (_req, res) => {
  res.json({ total: getMemoryCount(), byType: {} });
});

// ── Nodes / Assets ────────────────────────────────────────────────────────────
router.get("/nodes", (_req, res) => {
  res.json({ nodes: [], total: 0 });
});

router.get("/assets", (_req, res) => {
  res.json({ assets: [], total: 0 });
});

// ── Scans ─────────────────────────────────────────────────────────────────────
router.get("/scanner/scans", (_req, res) => {
  res.json({ scans: [], total: 0 });
});

router.post("/scanner/scan", (req, res) => {
  res.json({ id: `scan-${Date.now()}`, status: "queued", ts: new Date().toISOString() });
});

// ── Notifications ─────────────────────────────────────────────────────────────
router.get("/notifications", (_req, res) => {
  res.json({ notifications: [], unread: 0, total: 0 });
});

router.post("/notifications/:id/read", (req, res) => {
  res.json({ ok: true, id: req.params.id });
});

// ── Reports ───────────────────────────────────────────────────────────────────
router.get("/reports", (_req, res) => {
  res.json({ reports: [], total: 0 });
});

// ── Playbooks ─────────────────────────────────────────────────────────────────
router.get("/playbooks", (_req, res) => {
  res.json({ playbooks: [], total: 0 });
});

// ── Audit log ─────────────────────────────────────────────────────────────────
router.get("/audit", (_req, res) => {
  res.json({ entries: [], total: 0 });
});

// ── AI / Model status ─────────────────────────────────────────────────────────
router.get("/ai/status", (_req, res) => {
  res.json({ status: "online", provider: "dolphin-llama3", model: "dolphin-llama3:latest" });
});

// ── Keys ─────────────────────────────────────────────────────────────────────
router.get("/keys", (_req, res) => {
  res.json({ keys: [] });
});

// ── Kill switch ───────────────────────────────────────────────────────────────
router.get("/kill-switch/status", (_req, res) => {
  res.json({ killed: false, ts: null });
});

router.post("/kill-switch/activate", (_req, res) => {
  res.json({ ok: true, killed: true, ts: new Date().toISOString() });
});

router.post("/kill-switch/reset", (_req, res) => {
  res.json({ ok: true, killed: false });
});

// ── Modules ───────────────────────────────────────────────────────────────────
router.get("/modules", (_req, res) => {
  res.json({ modules: [], total: 0 });
});

// ── Evidence ──────────────────────────────────────────────────────────────────
router.get("/evidence", (_req, res) => {
  res.json({ evidence: [], total: 0 });
});

router.post("/evidence/scan", (_req, res) => {
  res.json({ started: true, scanId: `scan-${Date.now()}` });
});

// ── IOC Tracker ───────────────────────────────────────────────────────────────
router.get("/ioc", (_req, res) => {
  res.json({ iocs: [], total: 0 });
});

router.post("/ioc", (req, res) => {
  const body = req.body as Record<string, unknown>;
  res.json({ ioc: { id: Date.now(), ...body, createdAt: new Date().toISOString() } });
});

router.delete("/ioc/:id", (req, res) => {
  res.json({ ok: true, id: req.params.id });
});

// ── Files ─────────────────────────────────────────────────────────────────────
router.get("/files", (_req, res) => {
  res.json([]);
});

router.post("/files", (req, res) => {
  const { name, contentBase64, mimeType } = req.body as { name: string; contentBase64: string; mimeType?: string };
  res.json({ id: Date.now(), name, mimeType: mimeType || "application/octet-stream", createdAt: new Date().toISOString() });
});

router.delete("/files/:id", (req, res) => {
  res.json({ ok: true, id: req.params.id });
});

router.get("/files/:id", (req, res) => {
  res.status(404).json({ error: "file not found" });
});

// ── Processes ─────────────────────────────────────────────────────────────────
router.get("/processes", (_req, res) => {
  res.json([]);
});

// ── Anthropic Conversations ────────────────────────────────────────────────────
const anthropicConvs: Array<{ id: number; title: string; createdAt: string; messages: Array<{ id: number; role: string; content: string }> }> = [];
let anthropicIdSeq = 1;

router.get("/anthropic/conversations", (_req, res) => {
  res.json(anthropicConvs.map(({ id, title, createdAt }) => ({ id, title, createdAt })));
});

router.post("/anthropic/conversations", (req, res) => {
  const { title = "محادثة جديدة" } = req.body as { title?: string };
  const conv = { id: anthropicIdSeq++, title, createdAt: new Date().toISOString(), messages: [] as Array<{ id: number; role: string; content: string }> };
  anthropicConvs.push(conv);
  res.json({ id: conv.id, title: conv.title, createdAt: conv.createdAt });
});

router.get("/anthropic/conversations/:id", (req, res) => {
  const conv = anthropicConvs.find((c) => c.id === Number(req.params.id));
  if (!conv) { res.status(404).json({ error: "not found" }); return; }
  res.json(conv);
});

router.delete("/anthropic/conversations/:id", (req, res) => {
  const idx = anthropicConvs.findIndex((c) => c.id === Number(req.params.id));
  if (idx >= 0) anthropicConvs.splice(idx, 1);
  res.json({ ok: true });
});

router.post("/anthropic/conversations/:id/messages", async (req, res) => {
  const conv = anthropicConvs.find((c) => c.id === Number(req.params.id));
  if (!conv) { res.status(404).json({ error: "not found" }); return; }
  const { content } = req.body as { content: string };
  conv.messages.push({ id: Date.now(), role: "user", content });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const reply = "هذه الخاصية تستخدم Dolphin عبر Ngrok — جرّب تبويب KaliGPT أو الشات الرئيسي.";
  for (const char of reply) {
    res.write(`event: delta\ndata: ${JSON.stringify({ text: char })}\n\n`);
    (res as any).flush?.();
    await new Promise((r) => setTimeout(r, 10));
  }
  conv.messages.push({ id: Date.now() + 1, role: "assistant", content: reply });
  res.write(`event: done\ndata: {}\n\n`);
  res.end();
});

// ── GitHub Search ─────────────────────────────────────────────────────────────
router.get("/github/search/repositories", (req, res) => {
  res.json({ items: [], total_count: 0 });
});

// ── Exploit DB ────────────────────────────────────────────────────────────────
router.get("/exploitdb/search", (_req, res) => {
  res.json({ data: [], total: 0 });
});

// ── Live Agent Sessions ───────────────────────────────────────────────────────
interface LiveSession { id: number; title: string; status: string; createdAt: string; messages: Array<{ id: number; role: string; content: string; toolName?: string; toolInput?: string; toolResult?: string; createdAt: string }> }
const liveSessions: LiveSession[] = [];
let liveSessionIdSeq = 1;

router.get("/live-agent/sessions", (_req, res) => {
  res.json(liveSessions.map(({ id, title, status, createdAt }) => ({ id, title, status, createdAt })));
});

router.post("/live-agent/sessions", (req, res) => {
  const { title = "جلسة جديدة" } = (req.body ?? {}) as { title?: string };
  const s: LiveSession = { id: liveSessionIdSeq++, title, status: "active", createdAt: new Date().toISOString(), messages: [] };
  liveSessions.push(s);
  res.json({ id: s.id, title: s.title, status: s.status, createdAt: s.createdAt });
});

router.get("/live-agent/sessions/:id", (req, res) => {
  const s = liveSessions.find(x => x.id === Number(req.params.id));
  if (!s) { res.status(404).json({ error: "not found" }); return; }
  res.json(s);
});

router.delete("/live-agent/sessions/:id", (req, res) => {
  const idx = liveSessions.findIndex(x => x.id === Number(req.params.id));
  if (idx >= 0) liveSessions.splice(idx, 1);
  res.json({ ok: true });
});

router.post("/live-agent/sessions/:id/messages", async (req, res) => {
  const s = liveSessions.find(x => x.id === Number(req.params.id));
  if (!s) { res.status(404).json({ error: "not found" }); return; }
  const { content = "" } = (req.body ?? {}) as { content?: string };
  s.messages.push({ id: Date.now(), role: "user", content, createdAt: new Date().toISOString() });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const reply = "الوكيل الحي يتطلب اتصال nova-agent.js — شغّل: node nova-agent.js wss://YOUR-DOMAIN/api/local-agent/ws";
  s.messages.push({ id: Date.now() + 1, role: "assistant", content: reply, createdAt: new Date().toISOString() });
  for (const char of reply) {
    res.write(`event: text\ndata: ${JSON.stringify({ type: "text", text: char })}\n\n`);
    (res as any).flush?.();
    await new Promise(r => setTimeout(r, 8));
  }
  res.write(`event: done\ndata: {}\n\n`);
  res.end();
});

router.get("/live-agent/processes", (_req, res) => {
  res.json([]);
});

// ── CVE hunt trigger ──────────────────────────────────────────────────────────
router.post("/cve/hunt/trigger", (_req, res) => {
  res.json({ ok: true, started: true, newFound: 0, total: 0, ts: new Date().toISOString() });
});

// ── Mission Tracker ───────────────────────────────────────────────────────────
interface Finding { id: number; type: string; title: string; severity: string; detail: string; tool?: string; raw?: string; ts: string; }
interface Mission {
  id: number; name: string; target: string; objective: string;
  phase: string; status: string; createdAt: string; updatedAt: string;
  findings: Finding[]; commands: Array<{ cmd: string; output: string; ts: string }>;
  notes: string; tags: string[];
}
const missions: Mission[] = [];
let missionIdSeq = 1;
let findingIdSeq = 1;

// ── Boot seed ─────────────────────────────────────────────────────────────────
// The mission store is in-memory, so a fresh process used to start with an empty
// list: MissionTracker showed nothing and every `/api/missions/:id` call 404'd
// (the agent's record_finding / mission_status tools had nothing to write to).
// One starter mission keeps the whole flow alive from the first second.
(() => {
  if (missions.length > 0) return;
  const now = new Date().toISOString();
  missions.push({
    id: missionIdSeq++,
    name: "مهمة الاستطلاع الأولى",
    target: "github.com",
    objective: "استطلاع آمن لسطح الهجوم الخارجي: DNS، شهادة TLS، ترويسات الأمان، والنطاقات الفرعية.",
    phase: "reconnaissance",
    status: "active",
    createdAt: now,
    updatedAt: now,
    findings: [],
    commands: [],
    notes: "مهمة افتتاحية تُنشأ تلقائياً عند تشغيل الخادم — عدّلها أو احذفها كما تحب.",
    tags: ["recon", "starter"],
  } as Mission);
})();

router.get("/missions", (_req, res) => {
  res.json(missions.map(m => ({
    ...m, findingCount: m.findings.length, commandCount: m.commands.length,
  })));
});

router.post("/missions", (req, res) => {
  const { name, target, objective, phase = "reconnaissance", tags = [] } = req.body as {
    name: string; target: string; objective: string; phase?: string; tags?: string[];
  };
  const m: Mission = {
    id: missionIdSeq++, name, target, objective, phase, status: "active",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    findings: [], commands: [], notes: "", tags,
  };
  missions.push(m);
  res.json(m);
});

router.get("/missions/:id", (req, res) => {
  const m = missions.find(x => x.id === Number(req.params.id));
  if (!m) { res.status(404).json({ error: "not found" }); return; }
  res.json(m);
});

router.patch("/missions/:id", (req, res) => {
  const m = missions.find(x => x.id === Number(req.params.id));
  if (!m) { res.status(404).json({ error: "not found" }); return; }
  const { name, target, objective, phase, status, notes, tags } = req.body as Partial<Mission>;
  if (name !== undefined) m.name = name;
  if (target !== undefined) m.target = target;
  if (objective !== undefined) m.objective = objective;
  if (phase !== undefined) m.phase = phase;
  if (status !== undefined) m.status = status;
  if (notes !== undefined) m.notes = notes;
  if (tags !== undefined) m.tags = tags;
  m.updatedAt = new Date().toISOString();
  res.json(m);
});

router.delete("/missions/:id", (req, res) => {
  const idx = missions.findIndex(x => x.id === Number(req.params.id));
  if (idx >= 0) missions.splice(idx, 1);
  res.json({ ok: true });
});

router.post("/missions/:id/findings", (req, res) => {
  const m = missions.find(x => x.id === Number(req.params.id));
  if (!m) { res.status(404).json({ error: "not found" }); return; }
  const { type = "info", title, severity = "medium", detail, tool, raw } = req.body as Partial<Finding>;
  const f: Finding = {
    id: findingIdSeq++, type, title: title ?? "Finding", severity, detail: detail ?? "", tool, raw,
    ts: new Date().toISOString(),
  };
  m.findings.push(f);
  m.updatedAt = new Date().toISOString();
  res.json(f);
});

router.delete("/missions/:id/findings/:fid", (req, res) => {
  const m = missions.find(x => x.id === Number(req.params.id));
  if (!m) { res.status(404).json({ error: "not found" }); return; }
  const idx = m.findings.findIndex(f => f.id === Number(req.params.fid));
  if (idx >= 0) m.findings.splice(idx, 1);
  m.updatedAt = new Date().toISOString();
  res.json({ ok: true });
});

router.post("/missions/:id/commands", (req, res) => {
  const m = missions.find(x => x.id === Number(req.params.id));
  if (!m) { res.status(404).json({ error: "not found" }); return; }
  const { cmd, output } = req.body as { cmd: string; output: string };
  m.commands.push({ cmd, output, ts: new Date().toISOString() });
  m.updatedAt = new Date().toISOString();
  res.json({ ok: true, count: m.commands.length });
});

// ── Live Agent IQ ─────────────────────────────────────────────────────────────
router.get("/live-agent/iq", (_req, res) => {
  res.json({ connected: true, iq: 95, latencyMs: 12 });
});

// ── Autonomous ────────────────────────────────────────────────────────────────
router.post("/autonomous/enable", (_req, res) => { res.json({ ok: true, active: true }); });
router.post("/autonomous/disable", (_req, res) => { res.json({ ok: true, active: false }); });
router.get("/autonomous/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(ping); } }, 25_000);
  req.on("close", () => clearInterval(ping));
});

// ── Kill switch routes ────────────────────────────────────────────────────────
router.post("/kill-switch", (_req, res) => { res.json({ ok: true, killed: true, ts: new Date().toISOString() }); });

// ── Kali Command Autonomous routes ────────────────────────────────────────────
router.get("/kali-command/autonomous/status", (_req, res) => {
  res.json({ active: false, mode: "manual", lastRun: null });
});

router.post("/kali-command/autonomous/enable", (_req, res) => {
  res.json({ ok: true, active: true, mode: "autonomous" });
});

router.post("/kali-command/autonomous/disable", (_req, res) => {
  res.json({ ok: true, active: false, mode: "manual" });
});

router.get("/kali-command/autonomous/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(ping); } }, 25_000);
  req.on("close", () => clearInterval(ping));
});

// ── Kali Command Memories ──────────────────────────────────────────────────────
router.get("/kali-command/memories", (_req, res) => {
  res.json({ memories: [], total: 0 });
});

router.post("/kali-command/memories", (req, res) => {
  const body = req.body as Record<string, unknown>;
  res.json({ id: `mem-${Date.now()}`, ...body, createdAt: new Date().toISOString() });
});

router.delete("/kali-command/memories/:id", (req, res) => {
  res.json({ ok: true, id: req.params.id });
});

// ── Intelligence routes (DB-free stubs) ───────────────────────────────────────
router.get("/intelligence/stats", (_req, res) => {
  res.json({ memory: 0, knowledge: 0, pocCount: 0, threatCount: 0, patterns: 0, github: 0, webIntel: 0, cveTotal: 0, byType: {}, topCves: [] });
});
router.get("/intelligence/memory", (_req, res) => res.json([]));
router.get("/intelligence/knowledge", (_req, res) => res.json({ items: [], total: 0 }));
router.post("/intelligence/learn", (_req, res) => res.json({ stored: 0, patternsFound: 0, durationMs: 0 }));
router.post("/intelligence/consolidate", (_req, res) => res.json({ consolidated: 0, durationMs: 0 }));
router.post("/intelligence/hunt-poc", (_req, res) => res.json({ stored: 0, durationMs: 0 }));
router.post("/intelligence/crawl", (_req, res) => res.json({ stored: 0, durationMs: 0 }));
router.post("/intelligence/classify", (_req, res) => res.json({ updated: 0, durationMs: 0 }));
router.get("/intelligence/knowledge/:id", (req, res) => res.status(404).json({ error: "not found" }));

// ── Risk routes (DB-free stubs) ────────────────────────────────────────────────
router.get("/risk/stats", (_req, res) => {
  res.json({ total: 0, scored: 0, critical: 0, high: 0, medium: 0, low: 0, kev: 0, avgScore: 0, ollama: false, lastScored: null });
});
router.get("/risk/top", (_req, res) => res.json({ scores: [], total: 0 }));
router.get("/risk/kev", (_req, res) => res.json({ items: [], total: 0 }));
router.get("/risk/scores", (_req, res) => res.json({ scores: [] }));
router.post("/risk/score-batch", (_req, res) => res.json({ scored: 0, skipped: 0, durationMs: 0 }));
router.post("/risk/analyze-llm", (_req, res) => res.json({ analyzed: 0, skipped: 0, durationMs: 0 }));
router.post("/risk/score-one", (_req, res) => res.json({ ok: true }));

// ── Nova Commander Chat (fallback if kali-command route doesn't handle) ────────
router.post("/nova-commander/chat", async (req, res) => {
  const { message } = req.body as { message?: string };
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const reply = `Nova Commander: استلمت رسالتك "${message || ""}" — تأكد من إعداد Ollama/Ngrok في الإعدادات للحصول على ردود الذكاء الاصطناعي.`;
  for (const char of reply) {
    res.write(`event: delta\ndata: ${JSON.stringify({ token: char })}\n\n`);
    (res as any).flush?.();
    await new Promise(r => setTimeout(r, 8));
  }
  res.write(`event: done\ndata: {}\n\n`);
  res.end();
});

export default router;
