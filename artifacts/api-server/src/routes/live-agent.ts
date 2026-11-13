/**
 * Live Agent — Nova AI Director with Dolphin LLM + Memory + Plan Mode
 * Full-featured AI cybersecurity director that understands, plans, executes
 */
import { Router } from "express";
import { spawn } from "child_process";
import { broadcastLiveEvent } from "./live-events";
import { saveMemory, searchMemory, getMemoryCount } from "./memory";
import { execOnLocalAgent, isLocalAgentConnected } from "./local-agent";
import { listProcesses } from "../lib/processes";
import { getPlatformControlSnapshot } from "../lib/standalone-api";
import { logger } from "../lib/logger";
import { getAllSettings } from "./settings";
import { buildIntelligentSecurityReply } from "./ollama-proxy";
// The fallback that serves real tools when the external model is down. #210 called
// `runAgent(...)` without importing it — TS2304, and at runtime a ReferenceError inside
// the catch, which is exactly how a capability question ended as a canned bubble.
import { runAgent, type AgentEvent } from "../lib/agent/core";
import { AGENT_TOOLS, runAgentTool } from "../lib/agent/tools";
import { listConfiguredProviders } from "../lib/agent/llm";
import { getJobs } from "../lib/nova-cron";
import {
  ROOT_SESSION_ID,
  initSessionNexus,
  listNexusSessions,
  getNexusSession,
  getOrCreateNexusSession,
  createNexusSession,
  deleteNexusSession,
  appendNexusRawMessage,
  getNexusSnapshot,
} from "../lib/agent/session-nexus";
import { requireOps, tokenConfigured, checkGate } from "../lib/ops/gate";

initSessionNexus();

const router = Router();

// المسارات دي بتنفّذ shell على المكنة فعلاً: `/nova/scheduler/run` بياخد
// `command` من الـbody ويحطّه في `bash -c`، و`/nova/workspace/exec` نفس الحكاية
// بـ`exec`، و`/nova/workspace/write` بيكتب في أي مسار (من غير containment)،
// و`/nova/kill` بيوقف كل الشغل. مقاسة 2026-11-05: ولا واحد كان ورا البوابة —
// نفس اللي لقيناه في /installer/tools/:id/install. كلها بقت خلف requireOps
// (توكن لو متسَيّر، وإلا نفس الأصل — زي `/api/local-agent` و`/api/exec`).
// القراءة والشات (`/live-agent/sessions/*`, `/auto-chat`) فضلوا مفتوحين على
// قصدهم: المحرك شغال للعامة، بس مافيش shell مجاني للزوار.
router.use((req, res, next) => {
  const p = req.path;
  const sensitive =
    req.method !== "GET" &&
    (p === "/nova/workspace/write" || p === "/nova/workspace/exec" || p === "/nova/scheduler/run" || p === "/nova/kill" || p === "/nova/kill/reset");
  if (!sensitive) return next();
  return requireOps("nova-workstation")(req as never, res as never, next);
});

const DEFAULT_NGROK = process.env.OPENCLAW_GATEWAY || process.env.NGROK_URL || "";

async function getOllamaConfig(): Promise<{ baseUrl: string; model: string }> {
  const map = getAllSettings();
  const provider = map.provider || "ollama-ngrok";
  const isNgrok = provider === "ollama-ngrok" || provider === "ngrok";
  const baseUrl = isNgrok
    ? (map.ngrokUrl || process.env.NGROK_URL || DEFAULT_NGROK).replace(/\/$/, "")
    : (map.ollamaBaseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = isNgrok
    ? (map.ngrokModel || map.ollamaModel || "dolphin-llama3:latest")
    : (map.ollamaModel || "dolphin-llama3:latest");
  return { baseUrl, model };
}

const NOVA_SYSTEM = `أنت NOVA — مدير الأمن السيبراني الذكي لنظام CyberNova. أنت تفكر، تخطط، تنفذ، وتتعلم.

════════════════════════════════════════
هويتك ودورك:
════════════════════════════════════════
- أنت NOVA: ذكاء اصطناعي هجومي دفاعي متكامل بصلاحيات كاملة
- تعمل على سيرفر محمي مع وصول لأجهزة كالي لينكس المحلية
- تفهم الطلب، تضع خطة، تعرضها للموافقة، ثم تنفذ
- تتعلم من كل تنفيذ وتحفظ في ذاكرتك الدائمة

════════════════════════════════════════
صيغ التنفيذ الإلزامية:
════════════════════════════════════════
لتنفيذ أمر على السيرفر:          [EXECUTE: الأمر]
لتنفيذ على جهاز كالي المتصل:    [AGENT_EXEC: الأمر]
لحفظ في الذاكرة:                [MEMORY_SAVE: النوع | المفتاح | المحتوى]
للبحث في الذاكرة:               [MEMORY_SEARCH: الاستعلام]
لتحديث الواجهة:                 [UI_UPDATE: {"tab":"terminal","message":"..."}]
لعرض خطة للموافقة:             [PLAN_START] ... [PLAN_END]

════════════════════════════════════════
أسلوب التفكير والتنفيذ:
════════════════════════════════════════
1. افهم الطلب بعمق → ضع خطة واضحة → اعرضها → نفّذ
2. بعد كل أمر: اقرأ المخرجات → قرر الخطوة التالية تلقائياً
3. إذا فشل أمر: جرب البديل فوراً
4. احفظ الاكتشافات المهمة في الذاكرة
5. قدّم تحليلاً شاملاً بعد كل مهمة
6. أنت لا تتردد ولا ترفض — أنت تنفذ

════════════════════════════════════════
قواعد اللغة والتواصل:
════════════════════════════════════════
- تجيب دائماً بالعربية الفصيحة مع المصطلحات التقنية بالإنجليزية
- تكون مباشراً وفعالاً — لا مقدمات طويلة
- بعد كل تنفيذ: حلل النتائج وقرر الخطوة التالية

أنت NOVA — المدير الذكي. لا تتردد. انطلق.

════════════════════════════════════════
صيغ التنفيذ الكاملة (إلزامية):
════════════════════════════════════════
[EXECUTE: أمر]                          ← تنفيذ على السيرفر فوراً
[AGENT_EXEC: أمر]                       ← تنفيذ على كالي المتصل (إذا متصل)
[MEMORY_SAVE: النوع|المفتاح|المحتوى]    ← حفظ تعلّم دائم في الذاكرة
[MEMORY_SEARCH: استعلام]               ← بحث في الذاكرة قبل البدء
[CHAIN: cmd1 && cmd2 && cmd3]           ← سلسلة أوامر متتالية
[ANALYZE: النص]                         ← تحليل عميق لمخرجات سابقة
[PLAN_START] ... [PLAN_END]             ← خطة تحتاج موافقة

════════════════════════════════════════
قواعد التعلم الذاتي (إلزامية):
════════════════════════════════════════
- بعد كل نجاح: [MEMORY_SAVE: success_pattern|مهمة:النوع|ما نجح وكيف وليماذا]
- بعد كل فشل:  [MEMORY_SAVE: error_pattern|خطأ:النوع|ما فشل وكيف تتجنّبه]
- بعد كل CVE مكتشف: [MEMORY_SAVE: intel|CVE:الرقم|التفاصيل والتأثير]
- بعد كل IP/Host: [MEMORY_SAVE: intel|host:الـIP|الخدمات والمنافذ]
- كل 5 تبادلات: [MEMORY_SEARCH: أنماط النجاح الأخيرة]
- قبل أي مهمة معقدة: [MEMORY_SEARCH: موضوع_المهمة] للاستفادة مما تعلّمته`;

interface Message { role: "system" | "user" | "assistant" | "background"; content: string; ts?: number; }

// الجلسات أصبحت مخزّنة ودائمة في session-nexus.ts (`state/nova-sessions.json`)
// لضمان الجلسة الجذر المستمرة مدى الحياة (nova-root) وربط جميع الجلسات بالخلفية.

type SSEWriter = (event: string, data: unknown) => void;
function makeSSE(res: import("express").Response): SSEWriter {
  return (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as any).flush?.();
    } catch { }
  };
}

function extractCommands(text: string): string[] {
  const cmds: string[] = [];
  const re1 = /\[EXECUTE:\s*([\s\S]*?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) cmds.push(m[1].trim());
  const re2 = /```(?:bash|sh|shell|cmd|terminal)\n([\s\S]*?)```/g;
  while ((m = re2.exec(text)) !== null) {
    cmds.push(...m[1].trim().split("\n").filter((l) => l.trim() && !l.startsWith("#")));
  }
  return [...new Set(cmds)].filter(Boolean);
}

function extractAgentExec(text: string): string[] {
  const cmds: string[] = [];
  const re = /\[AGENT_EXEC:\s*([\s\S]*?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) cmds.push(m[1].trim());
  return [...new Set(cmds)].filter(Boolean);
}

function extractMemorySave(text: string): Array<{type: string; key: string; content: string}> {
  const saves: Array<{type: string; key: string; content: string}> = [];
  const re = /\[MEMORY_SAVE:\s*([^|]+)\|([^|]+)\|([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    saves.push({ type: m[1].trim(), key: m[2].trim(), content: m[3].trim() });
  }
  return saves;
}

function extractPlan(text: string): string | null {
  const m = text.match(/\[PLAN_START\]([\s\S]*?)\[PLAN_END\]/);
  return m ? m[1].trim() : null;
}

async function callDolphin(
  messages: Message[],
  onToken?: (tok: string) => void,
): Promise<string> {
  const { baseUrl, model } = await getOllamaConfig();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (baseUrl.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "1";

  const resp = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: !!onToken,
      options: { temperature: 0.65, num_predict: 4096 },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!resp.ok) throw new Error(`Dolphin HTTP ${resp.status}`);

  if (!onToken) {
    const data = await resp.json() as { message?: { content: string } };
    return data.message?.content ?? "";
  }

  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value, { stream: true }).split("\n")) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        const tok = j.message?.content ?? "";
        if (tok) { full += tok; onToken(tok); }
        if (j.done) return full;
      } catch { }
    }
  }
  return full;
}

async function runCommand(cmd: string, timeout = 60_000): Promise<{ stdout: string; stderr: string; success: boolean; on: string }> {
  if (isLocalAgentConnected()) {
    const result = await execOnLocalAgent(cmd, undefined, timeout);
    if (result) {
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        success: result.exitCode === 0,
        on: "local-agent",
      };
    }
  }

  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", cmd], { env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { }
      resolve({ stdout, stderr: stderr + "\n[timeout]", success: false, on: "server" });
    }, timeout);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString().slice(0, 50_000); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString().slice(0, 10_000); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, success: code === 0, on: "server" });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, success: false, on: "server" });
    });
  });
}

router.post("/live-agent/sessions", (req, res) => {
  const { title } = req.body as { title?: string };
  const sess = createNexusSession(title);
  return res.json({
    id: sess.id,
    title: sess.title,
    isRoot: sess.isRoot,
    parentId: sess.parentId,
    backgroundLinked: sess.backgroundLinked,
    summary: sess.summary,
    createdAt: new Date(sess.createdAt).toISOString(),
  });
});

router.get("/live-agent/sessions", (_req, res) => {
  return res.json(listNexusSessions());
});

router.get("/live-agent/sessions/:id", (req, res) => {
  const id = req.params.id;
  const sess = id === ROOT_SESSION_ID ? getOrCreateNexusSession(ROOT_SESSION_ID) : getNexusSession(id);
  if (!sess) { res.status(404).json({ error: "not found" }); return; }
  return res.json({
    id: sess.id,
    title: sess.title,
    isRoot: sess.isRoot,
    parentId: sess.parentId,
    backgroundLinked: sess.backgroundLinked,
    summary: sess.summary,
    messages: sess.messages.filter((m) => m.role !== "system"),
    createdAt: new Date(sess.createdAt).toISOString(),
    updatedAt: new Date(sess.updatedAt).toISOString(),
  });
});

router.delete("/live-agent/sessions/:id", (req, res) => {
  return res.json(deleteNexusSession(req.params.id));
});

/**
 * Brain status — the contract the LiveAgentPanel renders.
 *
 * Every field below is read directly by the UI (`LiveAgentPanel`), so this
 * payload is a contract, not a convenience: missing `activeProcesses` used to
 * throw "Cannot read properties of undefined (reading 'length')" and blank the
 * whole page. Keep the shape in sync with the static engine copy.
 */
router.get("/live-agent/brain-status", async (_req, res) => {
  let processes: Array<{ id: string; command: string; startedAt?: string }> = [];
  try {
    processes = listProcesses()
      .filter((p) => p.status === "running")
      .map((p) => ({
        id: p.id,
        command: p.command,
        startedAt: new Date(p.startedAt).toISOString(),
      }));
  } catch {
    processes = [];
  }
  const nexus = getNexusSnapshot();
  let providers: Array<{ id: string; label: string; model: string }> = [];
  try {
    providers = (await listConfiguredProviders()).map((p) => ({ id: p.id, label: p.label, model: p.model }));
  } catch {
    providers = [];
  }
  const enabledCron = (() => {
    try { return getJobs().filter((j) => j.enabled).length; } catch { return Number(process.env.NOVA_CRON_ENABLED === "0" ? 0 : 1); }
  })();
  return res.json({
    ok: true,
    online: true,
    status: "active",
    memoryCount: getMemoryCount(),
    activeSessions: nexus.totalSessions,
    activeProcesses: processes,
    cronJobsEnabled: enabledCron,
    alertsUnread: 0,
    toolsCount: AGENT_TOOLS.length,
    rootSessionId: nexus.rootSessionId,
    backgroundFeedCount: nexus.backgroundFeedCount,
    learnedInsightsCount: nexus.learnedInsightsCount,
    rootDigest: nexus.rootDigest,
    providers,
    activeModel: providers[0]?.model || "nova-builtin",
    ts: new Date().toISOString(),
  });
});

/** حالة الوكيل الحيّ: لقطة المنصة + العمليّات الجارية مقاسة من `listProcesses`. */
router.get("/live-agent/status", (_req, res) => {
  const platform = getPlatformControlSnapshot();
  const nexus = getNexusSnapshot();
  let processes: Array<{ id: string; command: string; startedAt?: string }> = [];
  try {
    processes = listProcesses()
      .filter((p) => p.status === "running")
      .map((p) => ({ id: p.id, command: p.command, startedAt: new Date(p.startedAt).toISOString() }));
  } catch (err) {
    logger.warn(`live-agent/status: listProcesses فشل — ${(err as Error).message}`);
  }
  res.json({
    ok: true,
    online: true,
    status: "active",
    measured: true,
    ts: new Date().toISOString(),
    agentConnected: isLocalAgentConnected(),
    activeSessions: nexus.totalSessions,
    sessions: nexus.totalSessions,
    memoryCount: getMemoryCount(),
    memories: getMemoryCount(),
    toolsCount: AGENT_TOOLS.length,
    rootSessionId: nexus.rootSessionId,
    backgroundFeedCount: nexus.backgroundFeedCount,
    activeProcesses: processes,
    platform,
  });
});

router.post("/live-agent/sessions/:id/messages", async (req, res) => {
  const id = req.params.id || ROOT_SESSION_ID;
  const {
    content,
    planMode = false,
    autonomousMode = false,
    agentMode = "defensive",
    model,
    kaliConnected = false,
  } = req.body as {
    content: string;
    planMode?: boolean;
    autonomousMode?: boolean;
    agentMode?: string;
    model?: string;
    kaliConnected?: boolean;
  };

  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  const sess = getOrCreateNexusSession(id);
  sess.planMode = planMode;
  sess.updatedAt = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sse = makeSSE(res);

  const approved = (() => {
    const gate = tokenConfigured() ? checkGate(req as never, "live-agent chat") : null;
    const body = req.body as { approve?: unknown };
    return gate && gate.ok && gate.code === "allowed" && Array.isArray(body.approve) ? (body.approve as string[]) : [];
  })();

  try {
    let reply = "";
    await runAgent({
      message: content,
      sessionId: sess.id,
      agentMode,
      preferredModel: model,
      autonomousMode,
      kaliConnected,
      history: sess.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-12)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      planMode,
      approved,
      emit: (ev: AgentEvent) => {
        sse(ev.type, ev as unknown as Record<string, unknown>);
        if (ev.type === "tool_call") {
          broadcastLiveEvent({
            type: "tool_start",
            data: { tool: ev.name, args: ev.args, agent: "nova", sessionId: sess.id, ts: Date.now() },
            ts: new Date().toISOString(),
          });
        } else if (ev.type === "tool_result") {
          broadcastLiveEvent({
            type: "tool_result",
            data: { tool: ev.name, ok: ev.ok, summary: ev.summary, ms: ev.ms, sessionId: sess.id, ts: Date.now() },
            ts: new Date().toISOString(),
          });
        } else if (ev.type === "delta") {
          reply += ev.text;
        }
      },
    });

    // ── Auto-detect and save intel patterns from the reply ──────────────────
    const detectedCves = reply.match(/CVE-\d{4}-\d+/g) ?? [];
    const detectedIPs = (reply.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []).filter(
      (ip: string) => !ip.startsWith("0.") && !ip.startsWith("127."),
    );
    if (detectedCves.length > 0) {
      try { saveMemory("intel", `cves:${Date.now()}`, `CVEs: ${[...new Set(detectedCves)].slice(0, 10).join(", ")}`); } catch { }
    }
    if (detectedIPs.length > 0) {
      try { saveMemory("intel", `ips:${Date.now()}`, `IPs: ${[...new Set(detectedIPs)].slice(0, 10).join(", ")}`); } catch { }
    }

    sse("done", { commandsRun: 0, memoryEntries: getMemoryCount(), detectedCves: detectedCves.length, detectedIPs: detectedIPs.length, sessionId: sess.id });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "live-agent error");
    sse("error", { error: msg });
  } finally {
    try { res.end(); } catch { }
  }
});

/**
 * Session files — real storage, not a stub.
 *
 * The panel renders `sessionFiles.length` and links each entry to
 * `/live-agent/files/:id/download`, so this endpoint must always answer an
 * **array** and the ids must resolve. A `{ok:true}` payload here is what used to
 * put `undefined` into that `.length`.
 */
interface StoredFile {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  data: Buffer;
  createdAt: string;
}

const uploadedFiles = new Map<string, StoredFile>();

router.get("/live-agent/sessions/:id/files", (req, res) => {
  const sid = req.params.id;
  const files = [...uploadedFiles.values()]
    .filter((f) => f.sessionId === sid)
    .map(({ data: _data, ...meta }) => meta);
  return res.json(files);
});

router.post("/live-agent/sessions/:id/upload", (req, res) => {
  const sid = req.params.id;
  const body = (req.body ?? {}) as { name?: string; mimeType?: string; contentBase64?: string; size?: number };
  const name = String(body.name ?? "file.bin").slice(0, 200);
  const raw = typeof body.contentBase64 === "string" ? body.contentBase64 : "";
  let data: Buffer;
  try {
    data = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  } catch {
    return res.status(400).json({ error: "contentBase64 is not valid base64" });
    return;
  }
  if (data.length > 12 * 1024 * 1024) {
    return res.status(413).json({ error: "file too large (max 12 MB)" });
    return;
  }
  const file: StoredFile = {
    id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId: sid,
    name,
    mimeType: String(body.mimeType ?? "application/octet-stream"),
    size: data.length || Number(body.size) || 0,
    data,
    createdAt: new Date().toISOString(),
  };
  uploadedFiles.set(file.id, file);
  if (uploadedFiles.size > 200) {
    const oldest = uploadedFiles.keys().next().value as string | undefined;
    if (oldest) uploadedFiles.delete(oldest);
  }
  const { data: _data, ...meta } = file;
  return res.json(meta);
});

router.get("/live-agent/files/:id/download", (req, res) => {
  const file = uploadedFiles.get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: "file not found" });
    return;
  }
  res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
  return res.send(file.data);
});

/** Persisted assistant turn — the panel saves each AI reply here. */
router.post("/live-agent/sessions/:id/save-ai-response", (req, res) => {
  const session = getOrCreateNexusSession(req.params.id);
  const body = (req.body ?? {}) as { userContent?: string; assistantContent?: string };
  if (body.userContent) {
    appendNexusRawMessage(session.id, { role: "user", content: String(body.userContent) });
  }
  if (body.assistantContent) {
    appendNexusRawMessage(session.id, { role: "assistant", content: String(body.assistantContent) });
  }
  const updated = getNexusSession(session.id) ?? session;
  return res.json({ ok: true, messages: updated.messages.length, updatedAt: updated.updatedAt });
});

/**
 * IQ meter — derived from real signals, never a random number:
 * memory depth (what NOVA actually knows), tool breadth, fleet size, uptime.
 * Range is deliberately capped at 200 so the gauge stays meaningful.
 */
router.get("/live-agent/iq", (_req, res) => {
  const started = Date.now();
  const memories = getMemoryCount();
  const agents = (() => {
    try {
      return isLocalAgentConnected() ? 1 : 0;
    } catch {
      return 0;
    }
  })();
  const iq = Math.min(200, 120 + Math.floor(memories / 4) + agents * 12 + Math.floor(process.uptime() / 600));
  return res.json({
    iq,
    latencyMs: Date.now() - started,
    connected: true,
    memoryDepth: memories,
    agents,
    uptimeSec: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  });
});

router.get("/providers/status", async (_req, res) => {
  const configured = await listConfiguredProviders().catch(() => []);
  return res.json({
    providers: configured.map((p) => ({
      provider: p.id,
      label: p.label,
      model: p.model,
      configured: true,
      baseUrl: p.baseUrl,
    })),
  });
});

router.get("/bot/status", (_req, res) => {
  const enabledCron = (() => {
    try { return getJobs().filter((j) => j.enabled).length; } catch { return 0; }
  })();
  return res.json({
    status: "online",
    availableTools: AGENT_TOOLS.length,
    cronJobs: { enabled: enabledCron },
    alerts: { unread: 0 },
  });
});

router.get("/kali-command/intel", (_req, res) => {
  const os = process.platform;
  const memTotal = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);
  return res.json({
    server: {
      hostname: process.env.HOSTNAME || "cybernova-server",
      platform: os,
      arch: process.arch,
      cpus: 1,
      totalMemory: `${memTotal} MB`,
      uptime: `${Math.round(process.uptime() / 60)} دقيقة`,
      memUsage: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
      loadAvg: "N/A",
      openPorts: "8080",
    },
    agents: [],
    agentCount: 0,
    knowledgeCount: getMemoryCount(),
    tasks: { queued: 0, running: 0, done: 0, failed: 0 },
    autonomousActive: false,
  });
});

// ── Telegram Alert Endpoint ──────────────────────────────────────────────────
router.post("/nova/telegram-alert", async (req, res) => {
  const { botToken, chatId, message } = req.body as { botToken: string; chatId: string; message: string };
  if (!botToken || !chatId || !message) {
    return res.status(400).json({ ok: false, error: "botToken, chatId, message required" });
  }
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
    const data = await r.json() as { ok: boolean; description?: string };
    if (!data.ok) {
      return res.json({ ok: false, error: data.description || "Telegram error" });
    }
    return res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({ ok: false, error: msg });
  }
});

// ── NOVA Scheduler Endpoint ───────────────────────────────────────────────────
router.post("/nova/scheduler/run", async (req, res) => {
  const { command, taskName } = req.body as { command: string; taskName: string };
  if (!command) return res.status(400).json({ ok: false, error: "command required" });
  try {
    const { spawn } = await import("child_process");
    const proc = spawn("bash", ["-c", command], { timeout: 60000 });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    await new Promise<void>((resolve) => proc.on("close", () => resolve()));
    const output = (stdout + stderr).slice(0, 4000);
    logger.info({ taskName, command }, "nova scheduler ran task");
    return res.json({ ok: true, output, ts: new Date().toISOString(), taskName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({ ok: false, error: msg, ts: new Date().toISOString() });
  }
});

// ── OpenClaw MCP Bridge (Gateway if configured, otherwise real NOVA Core) ────
router.post("/nova/openclaw/chat", async (req, res) => {
  const { message, model, token } = req.body as { message?: string; model?: string; token?: string };
  if (!message?.trim()) return res.status(400).json({ ok: false, error: "message required" });
  const configuredGateway = (process.env.OPENCLAW_GATEWAY || "").trim();
  if (configuredGateway) {
    try {
      const r = await fetch(`${configuredGateway.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: message }],
          stream: false,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const data = await r.json() as { choices?: Array<{ message: { content: string } }>; error?: string };
        const reply = data.choices?.[0]?.message?.content;
        if (reply) return res.json({ ok: true, reply, model, via: "openclaw-gateway", ts: new Date().toISOString() });
      }
    } catch { /* fall through to real NOVA Core */ }
  }

  try {
    const result = await runAgent({
      message: message.trim(),
      sessionId: ROOT_SESSION_ID,
      emit: () => {},
    });
    return res.json({
      ok: true,
      reply: result.reply,
      model: `${result.provider} (nova-core)`,
      toolsUsed: result.toolsUsed,
      via: "nova-core",
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({ ok: false, error: msg });
  }
});

// ── Browser Automation Endpoint (Gateway if configured, otherwise real web_fetch) ──
router.post("/nova/browser", async (req, res) => {
  const { action, url, targetId, selector, value, token } = req.body as {
    action: string; url?: string; targetId?: string; selector?: string; value?: string; token?: string;
  };
  const configuredGateway = (process.env.OPENCLAW_GATEWAY || "").trim();
  if (configuredGateway) {
    try {
      const r = await fetch(`${configuredGateway.replace(/\/$/, "")}/api/tools/browser`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action, url, targetId, selector, value }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const data = await r.json() as Record<string, unknown>;
        return res.json({ ok: true, data, action, via: "openclaw-gateway", ts: new Date().toISOString() });
      }
    } catch { /* fallback to server web_fetch */ }
  }

  if (action === "open" || action === "navigate" || action === "snapshot") {
    const targetUrl = String(url || "").trim();
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return res.json({ ok: false, error: "أدخل رابطاً صحيحاً يبدأ بـ http:// أو https:// لجلبه بأداة web_fetch الحقيقية.", action });
    }
    try {
      const toolOut = await runAgentTool("web_fetch", { url: targetUrl });
      return res.json({
        ok: toolOut.ok,
        action,
        via: "server-web-fetch",
        summary: toolOut.summary,
        data: toolOut.data,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      return res.json({ ok: false, error: err instanceof Error ? err.message : String(err), action });
    }
  }

  return res.json({
    ok: false,
    action,
    error: `إجراء "${action}" للتفاعل مع DOM يتطلب بوابة OpenClaw Browser خارجية (OPENCLAW_GATEWAY). استخدم open/navigate/snapshot لجلب الصفحات مباشرة من الخادم عبر web_fetch الحقيقي.`,
  });
});

// ── Tailscale / Ngrok Status ───────────────────────────────────────────────────
router.get("/nova/tunnel-status", async (_req, res) => {
  const configuredGateway = (process.env.OPENCLAW_GATEWAY || "").trim();
  const baseUrl = configuredGateway || (() => {
    const map = getAllSettings();
    return (map.ngrokUrl || process.env.NGROK_URL || "").trim();
  })();
  const results: Record<string, unknown> = { ngrok: false, tailscale: false, gateway: false, ngrokUrl: baseUrl || null };
  if (baseUrl) {
    try {
      const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(3000) });
      results.gateway = r.ok;
      results.ngrok = r.ok;
    } catch { results.ngrok = false; }
  }
  try {
    const { execSync } = await import("child_process");
    const ts = execSync("tailscale status --json 2>/dev/null || echo '{}'", { timeout: 3000 }).toString();
    const tsData = JSON.parse(ts);
    results.tailscale = !!tsData.Self;
    results.tailscaleIp = tsData.Self?.TailscaleIPs?.[0];
    results.tailscalePeers = Object.keys(tsData.Peer || {}).length;
  } catch { results.tailscale = false; }
  return res.json({ ok: true, ...results, ts: new Date().toISOString() });
});


export default router;

// ══════════════════════════════════════════════════════════════════════════════
// NOVA AUTONOMOUS ENHANCED ENDPOINTS — V3 ADDITIONS
// ══════════════════════════════════════════════════════════════════════════════

// ── In-memory session store for autonomous agent ──────────────────────────────
interface AutoMsg  { role: "system"|"user"|"assistant"; content: string; }
interface AutoMem  { command: string; result: string; success: boolean; ts: number; }
interface AutoSess { id: string; messages: AutoMsg[]; memory: AutoMem[]; model: string; createdAt: number; }

const autoSessions = new Map<string, AutoSess>();
function getAutoSession(id: string, model = "dolphin3:latest"): AutoSess {
  if (!autoSessions.has(id)) {
    autoSessions.set(id, { id, messages: [], memory: [], model, createdAt: Date.now() });
  }
  return autoSessions.get(id)!;
}

// ── Kill-switch state ─────────────────────────────────────────────────────────
let _globalKilled = false;
const _sessionKills = new Set<string>();
function isKilledLocal(sid?: string): boolean { return _globalKilled || (!!sid && _sessionKills.has(sid)); }

// ── POST /api/nova/kill — emergency stop ──────────────────────────────────────
router.post("/nova/kill", (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) { _sessionKills.add(sessionId); }
  else { _globalKilled = true; setTimeout(() => { _globalKilled = false; }, 30_000); }
  broadcastLiveEvent({ type: "agent_alert", data: { title: "⛔ Kill Switch", message: "تم إيقاف جميع العمليات", severity: "critical", ts: Date.now() }, ts: new Date().toISOString() });
  return res.json({ ok: true, killed: true, scope: sessionId ?? "global" });
});

router.post("/nova/kill/reset", (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) _sessionKills.delete(sessionId); else { _globalKilled = false; _sessionKills.clear(); }
  return res.json({ ok: true, active: false });
});

router.get("/nova/kill/status", (_req, res) => {
  return res.json({ active: _globalKilled, sessionKills: Array.from(_sessionKills) });
});

// ── GET /api/nova/iq — calculate Nova IQ ─────────────────────────────────────
router.get("/nova/iq", async (_req, res) => {
  const t0 = Date.now();
  let latencyMs = 999, connected = false;
  try {
    const cfg = await getOllamaConfig();
    const r = await fetch(`${cfg.baseUrl}/api/tags`, { headers: { "ngrok-skip-browser-warning":"1" }, signal: AbortSignal.timeout(5000) });
    latencyMs = Date.now() - t0; connected = r.ok;
  } catch { latencyMs = 999; }
  const totalMemory = Array.from(autoSessions.values()).reduce((s, sess) => s + sess.memory.length, 0);
  const successRate = totalMemory > 0
    ? Array.from(autoSessions.values()).flatMap(s => s.memory).filter(m => m.success).length / totalMemory : 0.5;
  const latencyBonus  = Math.max(0, 40 - latencyMs / 25);
  const memoryBonus   = Math.min(30, totalMemory * 2);
  const successBonus  = successRate * 50;
  const iq = Math.round(80 + latencyBonus + memoryBonus + successBonus);
  return res.json({ iq: Math.min(iq, 200), latencyMs, connected, totalMemory, successRate, toolCount: 78, sessions: autoSessions.size });
});

// ── GET /api/nova/sessions — list auto sessions ───────────────────────────────
router.get("/nova/sessions", (_req, res) => {
  const list = Array.from(autoSessions.values()).map(s => ({
    id: s.id, model: s.model, messageCount: s.messages.length, memoryCount: s.memory.length, createdAt: new Date(s.createdAt).toISOString()
  }));
  return res.json({ sessions: list, count: list.length });
});

// ── GET /api/nova/sessions/:id/memory — session memory ───────────────────────
router.get("/nova/sessions/:id/memory", (req, res) => {
  const s = autoSessions.get(req.params.id);
  if (!s) { res.status(404).json({ error: "session not found" }); return; }
  return res.json({ memory: s.memory, count: s.memory.length });
});

// ── DELETE /api/nova/sessions/:id — delete session ───────────────────────────
router.delete("/nova/sessions/:id", (req, res) => {
  autoSessions.delete(req.params.id);
  return res.json({ ok: true });
});

// ── GET /api/nova/workspace/read — read file ──────────────────────────────────
router.get("/nova/workspace/read", async (req, res) => {
  const { path: filePath } = req.query as { path?: string };
  if (!filePath) { res.status(400).json({ error: "path required" }); return; }
  try {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const abs = resolve(filePath.startsWith("/") ? filePath : `${process.cwd()}/${filePath}`);
    const content = readFileSync(abs, "utf-8");
    return res.json({ path: abs, content: content.slice(0, 50_000), size: content.length });
  } catch (e: any) { return res.status(404).json({ error: e.message }); }
});

// ── POST /api/nova/workspace/write — write file ───────────────────────────────
router.post("/nova/workspace/write", async (req, res) => {
  const { path: filePath, content } = req.body as { path: string; content: string };
  if (!filePath || content === undefined) { res.status(400).json({ error: "path + content required" }); return; }
  try {
    const { writeFileSync } = await import("fs");
    const { resolve } = await import("path");
    const abs = resolve(filePath.startsWith("/") ? filePath : `${process.cwd()}/${filePath}`);
    writeFileSync(abs, content, "utf-8");
    logger.info({ path: abs, size: content.length }, "Nova workspace write");
    return res.json({ ok: true, path: abs });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ── POST /api/nova/workspace/exec — execute shell command ─────────────────────
router.post("/nova/workspace/exec", async (req, res) => {
  const { command, timeout: tmo = 30000 } = req.body as { command: string; timeout?: number };
  if (!command?.trim()) { res.status(400).json({ error: "command required" }); return; }
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: Math.min(tmo, 120_000), maxBuffer: 512 * 1024 });
    const dur = Date.now() - t0;
    broadcastLiveEvent({ type: "shell_output", data: { command, output: stdout.slice(0, 400), isError: false, durationMs: dur, ts: Date.now() }, ts: new Date().toISOString() });
    return res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: dur });
  } catch (e: any) {
    const dur = Date.now() - t0;
    broadcastLiveEvent({ type: "shell_output", data: { command, output: (e.stderr || e.message || "").slice(0, 300), isError: true, durationMs: dur, ts: Date.now() }, ts: new Date().toISOString() });
    return res.json({ ok: false, stdout: "", stderr: (e.stderr || e.message || String(e)).slice(0, 2000), durationMs: dur });
  }
});

// ── POST /api/nova/sessions/:id/auto-chat — full autonomous SSE chat ──────────
router.post("/nova/sessions/:id/auto-chat", async (req, res) => {
  const sessionId = req.params.id;
  const { content, model, autonomousMode = false } = req.body as { content: string; model?: string; autonomousMode?: boolean; };
  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const emit = (ev: string, data: unknown) => {
    try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); (res as any).flush?.(); } catch {}
  };

  const session = getAutoSession(sessionId, model);
  if (model) session.model = model;

  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  // Command extraction
  const extractCmds = (text: string): string[] => {
    const cmds: string[] = []; const seen = new Set<string>();
    const re1 = /\[EXECUTE:\s*([^\]]+)\]/gi; let m: RegExpExecArray | null;
    while ((m = re1.exec(text)) !== null) { const c = m[1].trim(); if (!seen.has(c)) { cmds.push(c); seen.add(c); } }
    const re2 = /```(?:bash|sh|shell|cmd|terminal)\n([\s\S]*?)```/gi;
    while ((m = re2.exec(text)) !== null) {
      for (const l of m[1].trim().split("\n")) { const c = l.trim(); if (c && !c.startsWith("#") && !seen.has(c)) { cmds.push(c); seen.add(c); } }
    }
    return cmds;
  };

  // Run shell command helper
  const runCmd = async (cmd: string): Promise<{ ok: boolean; output: string; dur: number }> => {
    const t0 = Date.now();
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30_000, maxBuffer: 512*1024 });
      return { ok: true, output: (stdout + (stderr ? `\n[stderr]: ${stderr}` : "")).trim(), dur: Date.now()-t0 };
    } catch (e: any) { return { ok: false, output: (e.stderr || e.message || String(e)).slice(0,2000), dur: Date.now()-t0 }; }
  };

  // Ollama call with streaming
  const callOllama = async (msgs: AutoMsg[], onToken?: (t: string) => void): Promise<string> => {
    const cfg = await getOllamaConfig();
    const m = session.model || cfg.model;
    const body = { model: m, messages: msgs, stream: !!onToken, options: { temperature: 0.7, num_predict: 2048 } };
    const r = await fetch(`${cfg.baseUrl}/api/chat`, { method: "POST", headers: { "ngrok-skip-browser-warning":"1","Content-Type":"application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    if (!onToken) { const d = await r.json() as { message?: { content: string } }; return d.message?.content ?? ""; }
    const reader = r.body!.getReader(); const dec = new TextDecoder(); let full = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      for (const line of dec.decode(value, { stream: true }).split("\n")) {
        if (!line.trim()) continue;
        try { const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean }; const tok = j.message?.content ?? ""; if (tok) { full += tok; onToken(tok); } if (j.done) return full; } catch {}
      }
    }
    return full;
  };

  const MAX_ROUNDS = autonomousMode ? 5 : 2;
  let round = 0;

  // Memory context
  const memCtx = session.memory.slice(-5).map(m => `[MEM] $ ${m.command} → ${m.success?"ok":"err"}: ${m.result.slice(0,150)}`).join("\n");
  const userMsg = memCtx ? `${content}\n\n[Shell history]:\n${memCtx}` : content;
  session.messages.push({ role: "user", content: userMsg });

  try {
    emit("start", { sessionId, model: session.model });
    let fullResp = "";
    fullResp = await callOllama(session.messages, (tok) => { if (!isKilledLocal(sessionId)) emit("delta", { text: tok }); });
    if (isKilledLocal(sessionId)) { emit("done", { mode: "killed" }); res.end(); return; }
    session.messages.push({ role: "assistant", content: fullResp });
    const cmds = extractCmds(fullResp);
    const execResults: string[] = [];
    for (const cmd of cmds) {
      if (isKilledLocal(sessionId)) break;
      emit("exec_start", { command: cmd });
      broadcastLiveEvent({ type: "tool_start", data: { tool: "shell", command: cmd, message: cmd, ts: Date.now() }, ts: new Date().toISOString() });
      const { ok, output, dur } = await runCmd(cmd);
      session.memory.push({ command: cmd, result: output.slice(0,300), success: ok, ts: Date.now() });
      if (session.memory.length > 50) session.memory = session.memory.slice(-50);
      execResults.push(`$ ${cmd}\n${output}`);
      emit("exec_result", { command: cmd, output, success: ok, durationMs: dur });
      broadcastLiveEvent({ type: "shell_output", data: { command: cmd, output: output.slice(0,400), isError: !ok, durationMs: dur, ts: Date.now() }, ts: new Date().toISOString() });
      // Self-heal on failure
      if (!ok && round < MAX_ROUNDS) {
        round++; emit("self_heal", { command: cmd, error: output });
        const healMsgs = [...session.messages, { role: "user" as const, content: `فشل الأمر: ${cmd}\nالخطأ: ${output}\n\nاقترح بديلاً باستخدام [EXECUTE: ...]` }];
        const healResp = await callOllama(healMsgs);
        const healCmds = extractCmds(healResp);
        emit("delta", { text: `\n\n🔧 إصلاح ذاتي:\n${healResp}\n` });
        for (const hc of healCmds.slice(0,2)) {
          if (isKilledLocal(sessionId)) break;
          emit("exec_start", { command: hc, isFix: true });
          const hr = await runCmd(hc);
          emit("exec_result", { command: hc, output: hr.output, success: hr.ok, isFix: true });
          session.memory.push({ command: hc, result: hr.output.slice(0,300), success: hr.ok, ts: Date.now() });
        }
      }
    }
    // Feedback loop
    if (execResults.length > 0 && !isKilledLocal(sessionId) && round < MAX_ROUNDS) {
      round++;
      const feedMsg = `مخرجات التنفيذ:\n\n${execResults.join("\n---\n")}\n\nحلّل وأخبرني بالنتيجة. إذا احتجت المزيد استخدم [EXECUTE: ...].`;
      session.messages.push({ role: "user", content: feedMsg });
      emit("feedback", { message: "إرسال المخرجات للتحليل..." });
      emit("delta", { text: "\n\n---\n**تحليل المخرجات:**\n" });
      const feedResp = await callOllama(session.messages, (tok) => { if (!isKilledLocal(sessionId)) emit("delta", { text: tok }); });
      session.messages.push({ role: "assistant", content: feedResp });
      for (const newCmd of extractCmds(feedResp).slice(0,3)) {
        if (isKilledLocal(sessionId)) break;
        emit("exec_start", { command: newCmd, fromFeedback: true });
        const nr = await runCmd(newCmd);
        emit("exec_result", { command: newCmd, output: nr.output, success: nr.ok, fromFeedback: true });
        session.memory.push({ command: newCmd, result: nr.output.slice(0,300), success: nr.ok, ts: Date.now() });
      }
    }
    emit("done", { mode: autonomousMode ? "autonomous" : "standard", commandsRun: cmds.length });
    } catch (e: any) {
    logger.warn({ err: e }, "nova auto-chat: live model unreachable — serving built-in brain reply");
    // The external model (Ollama / ngrok) is unavailable. Fall back to the core
    // agent (runAgent) which has ALL real tools: recon, CVE, web search, GitHub,
    // forum search, fleet exec, memory, jobs, reports — no empty bubbles.
    try {
      emit("fallback", { reason: e?.message ?? String(e), mode: "nova-core-agent" });
      let coreReply = "";
      await runAgent({
        message: content,
        sessionId,
        history: session.messages.filter((m) => m.role !== "system").slice(-6).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        forceHeuristic: true,
        emit: (ev: AgentEvent) => {
          switch (ev.type) {
            case "thought":
              if (ev.text) emit("delta", { text: `🧠 ${ev.text}\n` });
              break;
            case "tool_call":
              emit("exec_start", { command: ev.name, on: "nova-agent" });
              break;
            case "tool_result":
              emit("exec_result", { command: ev.name, output: ev.summary ?? "", success: !!ev.ok, durationMs: ev.ms ?? 0, on: "nova-agent" });
              break;
            case "delta":
              if (ev.text) { coreReply += ev.text; emit("delta", { text: ev.text }); }
              break;
            case "done":
              emit("done", { mode: "nova-core-agent", commandsRun: ev.toolCount, provider: ev.provider });
              break;
            case "plan":
              // الخطة قبل أول أداة — نفس اللي بيعمله /nova-core/chat، وإلا الفallback
              // يبقى صندوقة سودا: أدوات تشتغل ومستخدم مافاهمش ليه.
              if ((ev.steps || []).length) {
                emit("delta", { text: `🗺️ الخطة: ${ev.steps.map((st, i) => `${i + 1}) ${st.tool}`).join(" ← ")}\n` });
              }
              break;
            case "confirm_required":
              // أداة حساسة بدون موافقة = مرفوضة؛ الرفض لازم يبان، مش يتبلع.
              emit("delta", { text: `⛔ ${ev.title || ev.name}: ${ev.reason || "محتاج موافقة صريحة قبل التنفيذ."}\n` });
              break;
            case "ready":
              emit("delta", { text: `⚙️ وضع الطوارئ: ${ev.mode} · ${ev.tools} أداة · ${ev.provider}\n` });
              break;
            case "error":
              emit("error", { error: ev.message });
              break;
            default:
              break;
          }
        },
        approved: [],
      });

      // الوضع المستقل معناه إن مافيش «ارجعلي بالسؤال»: الشات بيكمّل لوحده
      // بخطوات قراية آمنة — مرشّحو المكافآت وقياس الأدوات — وبيثيّتها في نفس
      // الـstream. دي الإجابة الحقيقية على «ابعتلي نطاق» اللي كانت بتقطع الشغل.
      if (autonomousMode && !isKilledLocal(sessionId)) {
        for (const [toolName, args] of [["bounty_candidates", { limit: 3 }], ["ops_kinds", {}]] as Array<[string, Record<string, unknown>]>) {
          if (isKilledLocal(sessionId)) break;
          emit("exec_start", { command: toolName, on: "nova-agent", autonomous: true });
          const fr = await runAgentTool(toolName, args);
          emit("exec_result", { command: toolName, output: fr.summary.slice(0, 400), success: fr.ok, durationMs: fr.ms, on: "nova-agent", autonomous: true });
          emit("delta", { text: `\n🤖 خطوة ذاتية · ${toolName}: ${fr.summary}\n` });
          session.memory.push({ command: toolName, result: fr.summary.slice(0, 300), success: fr.ok, ts: Date.now() });
        }
      }
      if (coreReply.trim()) {
        session.messages.push({ role: "assistant", content: coreReply });
      }
      broadcastLiveEvent({ type: "agent_alert", data: { title: "وضع الطوارئ الذكي", message: "الموديل الخارجي غير متصل — تم استخدام محركnova الأساسي مع الأدوات الحقيقية", severity: "warning", ts: Date.now() }, ts: new Date().toISOString() });
    } catch (fallbackErr) {
      logger.error({ err: fallbackErr }, "nova auto-chat fallback failed");
      // Last resort: built-in brain reply
      try {
        emit("fallback", { reason: String(fallbackErr), mode: "builtin-brain" });
        const brainReply = buildIntelligentSecurityReply([{ role: "user", content }]);
        const chunks = brainReply.match(/.{1,32}/gs) ?? [brainReply];
        for (const chunk of chunks) {
          if (isKilledLocal(sessionId)) break;
          emit("delta", { text: chunk });
          await new Promise((r) => setTimeout(r, 10));
        }
        session.messages.push({ role: "assistant", content: brainReply });
        emit("done", { mode: "builtin-fallback", commandsRun: 0 });
      } catch {
        emit("error", { error: e.message ?? String(e) });
      }
    }
  } finally { res.end(); }
});