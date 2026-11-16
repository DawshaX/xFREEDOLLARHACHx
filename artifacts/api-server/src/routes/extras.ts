/**
 * TEST45 — the remaining dead wires, made real in one router:
 *   GET  /ai/history            → persisted AI chat turns (state/ai-chat-history.json)
 *   POST /ai/chat               → real LLM completion via llmComplete + persistence
 *   POST /agent/autonomous/run  → real daemon cycle (tickAutonomousDaemon)
 *   POST /nova/knowledge/upload → real local knowledge base (state/knowledge/) — multipart, no deps
 *   POST /nova/knowledge/search → real substring scoring over indexed chunks
 *   GET/POST /vulns, DELETE /vulns/:id → real CRUD store (state/vulns-page.json)
 *   GET  /system/screenshot     → real capture when a display/tool exists; honest 503 otherwise
 * Every store is plain state/*.json — no DB required (standalone-first).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { requireOps } from "../lib/ops/gate";
import { logger } from "../lib/logger";
import { llmComplete } from "../lib/agent/llm";
import { tickAutonomousDaemon } from "../lib/autonomous-daemon";
import { getNexusSnapshot } from "../lib/agent/session-nexus";
import { recordBackgroundEvent } from "../lib/agent/session-nexus";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";

const router: IRouter = Router();
const exec = promisify(execCb);
const S = () => process.env.NOVA_STATE_DIR || path.join(process.cwd(), "state");
const jread = <T,>(f: string, d: T): T => { try { return JSON.parse(fs.readFileSync(f, "utf8")) as T; } catch { return d; } };
const jwrite = (f: string, v: unknown): void => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); } catch { /* read-only */ } };

type ChatMsg = { role: "user" | "assistant" | "system"; content: string; timestamp: string };
const histFile = () => path.join(S(), "ai-chat-history.json");

router.get("/ai/history", (_req: Request, res: Response) => {
  const saved = jread<ChatMsg[]>(histFile(), []);
  // أغنى مصدر حقيقي: جلسات النكسس الفعلية (لو موجودة) — مدموجة مع المحفوظ
  try {
    const snap = getNexusSnapshot();
    type Sess = { messages?: Array<{ role?: string; content?: string; ts?: number }> };
    const sessions = (snap as unknown as { sessions?: Record<string, Sess> }).sessions ?? {};
    const fromNexus: ChatMsg[] = [];
    for (const s of Object.values(sessions)) {
      for (const m of s.messages ?? []) {
        const role = m.role === "user" || m.role === "assistant" || m.role === "system" ? m.role : null;
        if (!role || !m.content) continue;
        fromNexus.push({ role, content: String(m.content).slice(0, 4000), timestamp: m.ts ? new Date(m.ts).toISOString() : new Date().toISOString() });
      }
    }
    const merged = [...saved, ...fromNexus].slice(-50);
    return res.json(merged.length ? merged : saved);
  } catch { return res.json(saved); }
});

router.post("/ai/chat", async (req: Request, res: Response) => {
  const { message } = (req.body ?? {}) as { message?: string };
  const msg = String(message ?? "").trim().slice(0, 8000);
  if (!msg) { res.status(400).json({ error: "مافيش رسالة" }); return; }
  try {
    const r = await llmComplete(
      [
        { role: "system", content: "انت NOVA — مساعد الأمن السيبراني للمنصة. رد بالعربية بإيجاز عملي." },
        { role: "user", content: msg },
      ],
      { temperature: 0.5, maxTokens: 900, timeoutMs: 45_000, tries: 1 },
    );
    const text = String((r as unknown as { text?: string })?.text ?? (r as unknown as { content?: string })?.content ?? "").trim();
    const reply = text || "المزود رد فارغ — جرب تاني.";
    const hist = jread<ChatMsg[]>(histFile(), []);
    hist.push({ role: "user", content: msg, timestamp: new Date().toISOString() }, { role: "assistant", content: reply.slice(0, 4000), timestamp: new Date().toISOString() });
    jwrite(histFile(), hist.slice(-100));
    res.json({ message: reply });
  } catch (e) {
    logger.warn({ e }, "ai/chat failed");
    res.status(502).json({ error: "مافيش مزود LLM متاح حالًا — ظبّت API key واحد على الأقل" });
  }
});

router.post("/agent/autonomous/run", async (req: Request, res: Response) => {
  try {
    const brain = await Promise.race([
      tickAutonomousDaemon(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 60_000)),
    ]);
    recordBackgroundEvent({ kind: "mission", title: "دورة الذكاء الذاتي انطلقت من اللوحة", detail: "المالك ضغط زر التشغيل اليدوي للدايمون الذاتي.", source: "agent-autonomous" });
    if (!brain) { res.json({ ok: true, started: true, note: "الدورة لسه شغالة — النتيجة بتتسجل في نبضات الخلفية" }); return; }
    res.json({ ok: true, measured: true, at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e as Error).message) });
  }
});

/* ── Knowledge base (local RAG-lite, real files) ─────────────────────────── */
const KB_DIR = () => path.join(S(), "knowledge");
const KB_INDEX = () => path.join(KB_DIR(), "index.json");
type KBIndex = Record<string, { size: number; date: string; chunks: string[] }>;

function kbIndex(): KBIndex { return jread<KBIndex>(KB_INDEX(), {}); }
function kbSave(ix: KBIndex): void { jwrite(KB_INDEX(), ix); }
function chunkText(t: string, size = 600): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size));
  return out.slice(0, 400);
}
function splitBuf(body: Buffer, sep: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  for (;;) {
    const i = body.indexOf(sep, start);
    if (i < 0) { parts.push(body.subarray(start)); break; }
    parts.push(body.subarray(start, i));
    start = i + sep.length;
  }
  return parts;
}

function extractMultipart(req: Request): { name: string; buf: Buffer } | null {
  const ct = String(req.headers["content-type"] ?? "");
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  if (!m) return null;
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const body = req.body as unknown as Buffer;
  if (!Buffer.isBuffer(body)) return null;
  for (const part of splitBuf(body, boundary)) {
    const idx = part.indexOf("\r\n\r\n");
    if (idx < 0) continue;
    const headers = part.subarray(0, idx).toString("utf8");
    const fn = /filename="([^"]+)"/.exec(headers);
    if (fn) {
      let payload = part.subarray(idx + 4);
      if (payload.subarray(-2).toString() === "\r\n") payload = payload.subarray(0, -2);
      return { name: fn[1].replace(/[^\w.\-]/g, "_").slice(0, 80), buf: payload };
    }
  }
  return null;
}

router.post("/nova/knowledge/upload", express.raw({ type: "*/*", limit: "20mb" }), async (req: Request, res: Response) => {
  const part = extractMultipart(req);
  if (!part || !part.buf.length) { res.status(400).json({ error: "مافيش ملف في الطلب" }); return; }
  const name = `${Date.now()}-${part.name}`;
  fs.mkdirSync(KB_DIR(), { recursive: true });
  fs.writeFileSync(path.join(KB_DIR(), name), part.buf);
  const text = part.buf.toString("utf8").replace(/\u0000/g, "");
  const ix = kbIndex();
  ix[name] = { size: part.buf.length, date: new Date().toISOString(), chunks: chunkText(text) };
  kbSave(ix);
  recordBackgroundEvent({ kind: "knowledge", title: `ملف معرفة اتضاف: ${part.name}`, detail: `${part.buf.length} بايت — ${ix[name].chunks.length} مقطع اتفهرسوا`, source: "nova-knowledge" });
  res.json({ ok: true, name: part.name, bytes: part.buf.length, chunks: ix[name].chunks.length });
});

router.post("/nova/knowledge/search", async (req: Request, res: Response) => {
  const q = String((req.body ?? {}).query ?? "").trim().toLowerCase();
  if (!q) { res.json({ results: [] }); return; }
  const ix = kbIndex();
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ name: string; snippet: string; score: number }> = [];
  for (const [name, meta] of Object.entries(ix)) {
    for (const chunk of meta.chunks ?? []) {
      const lc = chunk.toLowerCase();
      let score = 0;
      for (const t of terms) { let i = 0, n = 0; while ((i = lc.indexOf(t, i)) !== -1) { n++; i += t.length; } score += n * t.length; }
      if (score > 0) {
        const pos = lc.indexOf(terms[0]);
        scored.push({ name, snippet: chunk.slice(Math.max(0, pos - 80), pos + 220).replace(/\s+/g, " "), score });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  res.json({ results: scored.slice(0, 20), files: Object.keys(ix).length, measured: true });
});

/* ── Vulnerabilities CRUD (the page's own store) ─────────────────────────── */
type Vuln = { id: number; title: string; description: string; target: string; severity: string; port?: number; cve?: string; status: string };
const vulnFile = () => path.join(S(), "vulns-page.json");
router.get("/vulns", (_req: Request, res: Response) => {
  res.json({ vulns: jread<Vuln[]>(vulnFile(), []) });
});
router.post("/vulns", (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Partial<Vuln>;
  const list = jread<Vuln[]>(vulnFile(), []);
  const v: Vuln = {
    id: Date.now(),
    title: String(b.title ?? "بدون عنوان").slice(0, 200),
    description: String(b.description ?? "").slice(0, 4000),
    target: String(b.target ?? "").slice(0, 200),
    severity: ["critical", "high", "medium", "low", "info"].includes(String(b.severity)) ? String(b.severity) : "medium",
    port: Number.isFinite(b.port) ? Number(b.port) : undefined,
    cve: b.cve ? String(b.cve).slice(0, 40) : undefined,
    status: String(b.status ?? "open"),
  };
  list.unshift(v);
  jwrite(vulnFile(), list.slice(0, 500));
  res.status(201).json(v);
});
router.delete("/vulns/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const list = jread<Vuln[]>(vulnFile(), []);
  const next = list.filter((v) => v.id !== id);
  jwrite(vulnFile(), next);
  res.json({ ok: next.length !== list.length });
});

/* ── Screenshot: real when possible, honest 503 otherwise ────────────────── */
router.get("/system/screenshot", async (_req: Request, res: Response) => {
  const tries: Array<[string, string]> = [
    ["import", "import -window root png:-"],
    ["scrot", "scrot -o /dev/stdout"],
    ["gnome-screenshot", "gnome-screenshot -f /dev/stdout"],
  ];
  for (const [tool, cmd] of tries) {
    try {
      await exec(`command -v ${tool}`);
      const { stdout } = await exec(cmd, { timeout: 15_000, maxBuffer: 30 * 1024 * 1024, encoding: "buffer" } as never);
      const buf = stdout as unknown as Buffer;
      if (buf?.length > 1000) {
        res.setHeader("Content-Type", "image/png");
        return res.send(buf);
      }
    } catch { /* next tool */ }
  }
  res.status(503).json({ ok: false, error: "مافيش شاشة فعالة على الهَب (بلا DISPLAY/أداة التقاط) — سطح المكتب الحي من عقد الأسطول هو الطايرة المدعومة للشاشة" });
  return;
});

export default router;
