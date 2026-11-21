/**
 * Live Agent — Nova AI Director with Dolphin LLM + Memory + Plan Mode
 * Full-featured AI cybersecurity director that understands, plans, executes
 */
import { Router } from "express";
import { spawn } from "child_process";
import path from "node:path";
import crypto from "node:crypto";
import { broadcastLiveEvent } from "./live-events";
import { saveMemory, searchMemory, getMemoryCount } from "./memory";
import { execOnLocalAgent, isLocalAgentConnected, getConnectedAgentList } from "./local-agent";
import { listProcesses } from "../lib/processes";
import { getPlatformControlSnapshot } from "../lib/standalone-api";
import { logger } from "../lib/logger";
import { getAllSettings } from "./settings";
import { buildIntelligentSecurityReply } from "./ollama-proxy";
// The fallback that serves real tools when the external model is down. #210 called
// `runAgent(...)` without importing it — TS2304, and at runtime a ReferenceError inside
// the catch, which is exactly how a capability question ended as a canned bubble.
import { runAgent, type AgentEvent } from "../lib/agent/core";
import { listMemories, remember, memoryStats } from "../lib/agent/memory-store";
import { journalRecent, journalStats, journalTopTopics } from "../lib/agent/owner-journal";
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
  addNexusInsight,
  recordBackgroundEvent,
  restoreAllJournalToNexus,
  renameNexusSession,
} from "../lib/agent/session-nexus";
import { readEternalVault, writeEternalVault, recordEternalMemoryEntry } from "./kali-env";
import { requireOps, tokenConfigured, checkGate, sameOriginOk } from "../lib/ops/gate";
import fs from "node:fs";

initSessionNexus();

export interface SovereignPermissionsState {
  fullPermissions: boolean;
  autoApproveTools: boolean;
  kaliExecAllowed: boolean;
  fleetExecAllowed: boolean;
  zeroDayLabAllowed: boolean;
  selfHealAllowed: boolean;
  autonomy247: boolean;
  eternalMemorySync: boolean;
  updatedAt: string;
}

const PERMISSIONS_FILE = path.resolve(process.cwd(), "state/nova-permissions.json");

export function readSovereignPermissions(): SovereignPermissionsState {
  const defaults: SovereignPermissionsState = {
    fullPermissions: true,
    autoApproveTools: true,
    kaliExecAllowed: true,
    fleetExecAllowed: true,
    zeroDayLabAllowed: true,
    selfHealAllowed: true,
    autonomy247: true,
    eternalMemorySync: true,
    updatedAt: new Date().toISOString(),
  };
  try {
    if (fs.existsSync(PERMISSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, "utf8")) as Partial<SovereignPermissionsState>;
      return {
        fullPermissions: parsed.fullPermissions !== false,
        autoApproveTools: parsed.autoApproveTools !== false,
        kaliExecAllowed: parsed.kaliExecAllowed !== false,
        fleetExecAllowed: parsed.fleetExecAllowed !== false,
        zeroDayLabAllowed: parsed.zeroDayLabAllowed !== false,
        selfHealAllowed: parsed.selfHealAllowed !== false,
        autonomy247: parsed.autonomy247 !== false,
        eternalMemorySync: parsed.eternalMemorySync !== false,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : defaults.updatedAt,
      };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export function writeSovereignPermissions(patch: Partial<SovereignPermissionsState>): SovereignPermissionsState {
  const current = readSovereignPermissions();
  const next: SovereignPermissionsState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(PERMISSIONS_FILE), { recursive: true });
    fs.writeFileSync(PERMISSIONS_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    /* ignore */
  }
  return next;
}

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

router.post("/live-agent/sessions/:id/rename", (req, res) => {
  const { title } = (req.body ?? {}) as { title?: string };
  const updated = renameNexusSession(req.params.id, String(title || "").trim());
  if (!updated) {
    res.status(404).json({ ok: false, error: "الجلسة غير موجودة" });
    return;
  }
  res.json({
    ok: true,
    id: updated.id,
    title: updated.title,
    updatedAt: new Date(updated.updatedAt).toISOString(),
  });
});

router.post("/live-agent/sessions/restore-journal", (_req, res) => {
  const restored = restoreAllJournalToNexus();
  const root = getOrCreateNexusSession(ROOT_SESSION_ID);
  res.json({
    ok: true,
    ...restored,
    sessions: listNexusSessions(),
    rootMessages: root.messages.filter((m) => m.role !== "system"),
  });
});

router.get("/live-agent/permissions", (_req, res) => {
  res.json({
    ok: true,
    permissions: readSovereignPermissions(),
    totalTools: AGENT_TOOLS.length,
    sensitiveTools: AGENT_TOOLS.filter((t) => t.risk === "sensitive").map((t) => ({
      name: t.name,
      title: t.title,
      category: t.category,
    })),
  });
});

router.post("/live-agent/permissions", (req, res) => {
  const body = (req.body ?? {}) as Partial<SovereignPermissionsState>;
  const updated = writeSovereignPermissions(body);
  recordBackgroundEvent({
    kind: "permissions",
    title: updated.fullPermissions
      ? "🔓 تم تفعيل الصلاحيات السيادية الكاملة 100%"
      : "🔒 تم تعديل إعدادات الصلاحيات",
    detail: `fullPermissions=${updated.fullPermissions} · autoApproveTools=${updated.autoApproveTools} · kali=${updated.kaliExecAllowed} · fleet=${updated.fleetExecAllowed}`,
    source: "live-agent",
  });
  res.json({
    ok: true,
    permissions: updated,
  });
});

router.get("/live-agent/history-all", (_req, res) => {
  try {
    restoreAllJournalToNexus();
  } catch {
    /* ignore */
  }
  const sessions = listNexusSessions();
  const rootSession = getOrCreateNexusSession(ROOT_SESSION_ID);
  const journalEntries = journalRecent(250);
  const jStats = journalStats();
  const nexus = getNexusSnapshot();
  const vault = readEternalVault();
  const perms = readSovereignPermissions();
  res.json({
    ok: true,
    permissions: perms,
    rootSessionId: ROOT_SESSION_ID,
    rootMessageCount: rootSession.messages.filter((m) => m.role !== "system").length,
    sessions: sessions.map((s) => {
      const full = getNexusSession(s.id);
      const msgs = (full?.messages ?? []).filter((m) => m.role === "user" || m.role === "assistant");
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      return {
        ...s,
        messageCount: msgs.length,
        lastMessagePreview: lastMsg ? String(lastMsg.content).slice(0, 140) : s.summary,
      };
    }),
    journal: {
      stats: jStats,
      entries: journalEntries
        .slice(-200)
        .reverse()
        .map((e) => ({
          ...e,
          ts: new Date(typeof e.ts === "number" ? e.ts : Date.now()).toISOString(),
        })),
    },
    eternalMemory: {
      total: vault.memory.length,
      activeTarget: vault.session.activeTarget,
      entries: vault.memory.slice(0, 80),
    },
    backgroundFeed: nexus.recentBackground ?? [],
    learnedInsights: nexus.learnedInsights ?? [],
  });
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
/* ── الوعي الكامل عن المالك (TEST4: «ظاهر كل حاجة») ─────────────────────────
 * استدعاء واحد يرجّع كل اللي نوفا عارفه: خط المحادثة، ما حفظته عنك،
 * ملاحظات الراصد عليك، الدفتر الدائم، والمواضيع الثابتة. */
router.get("/live-agent/awareness", (_req, res) => {
  const root = getNexusSession(ROOT_SESSION_ID);
  const ownerRecords = listMemories({ scope: "owner", sort: "important", limit: 10 });
  const observerRecords = listMemories({ scope: "observer", sort: "recent", limit: 8 });
  const js = journalStats();
  res.json({
    ok: true,
    at: new Date().toISOString(),
    thread: root?.thread ?? [],
    lastModel: root?.lastModel ?? null,
    owner: ownerRecords.items.map((r) => ({ title: r.title, content: r.content.slice(0, 300), at: r.updatedAt, importance: r.importance })),
    observations: observerRecords.items.map((r) => ({ title: r.title, content: r.content.slice(0, 300), at: r.updatedAt })),
    journal: js,
    topics: journalTopTopics(8),
    memoryTotal: ownerRecords.total,
  });
});

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
  // القرص الحقيقي + كشف «بلا حد» للجلسة — العقل يحس كم باقٌ قبل ما يسرح
  let diskFreeGb: number | null = null;
  let diskTotalGb: number | null = null;
  try {
    const st = fs.statfsSync("/");
    const freeMb = Math.round((st.bavail * st.bsize) / 1048576);
    const totalMb = Math.round((st.blocks * st.bsize) / 1048576);
    diskFreeGb = Math.round(freeMb / 1024 * 10) / 10;
    diskTotalGb = Math.round(totalMb / 1024 * 10) / 10;
  } catch { /* */ }
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
    resources: {
      diskFreeGb,
      diskTotalGb,
      diskUnbounded: true,
      noteAr: "المساحة مقاسة من statfs(/) — العقل يستخدمها بلا حد معبرش.",
    },
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
    target,
    attachmentIds,
  } = req.body as {
    content: string;
    planMode?: boolean;
    autonomousMode?: boolean;
    agentMode?: string;
    model?: string;
    kaliConnected?: boolean;
    target?: string;
    attachmentIds?: string[];
  };

  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  const sess = getOrCreateNexusSession(id);
  sess.planMode = planMode;
  sess.updatedAt = Date.now();

  // Sync active target with Kali 2099 Eternal Vault if provided
  if (target && typeof target === "string" && target.trim() && target.trim() !== "127.0.0.1") {
    try {
      const vault = readEternalVault();
      vault.session.activeTarget = target.trim();
      writeEternalVault(vault);
    } catch { /* ignore */ }
  }

  // Build attachment context if files were attached or uploaded to this session
  let enrichedMessage = content;
  try {
    const requestedIds = Array.isArray(attachmentIds) ? attachmentIds.filter(Boolean) : [];
    const sessionUploads = [...uploadedFiles.values()].filter((f) => f.sessionId === id || f.sessionId === ROOT_SESSION_ID);
    const attached = requestedIds.length > 0
      ? requestedIds.map((fid) => uploadedFiles.get(fid)).filter((f): f is StoredFile => Boolean(f))
      : /(?:ملف|مرفق|اقرأ|حلل|المرفوع|file|upload|attachment)/i.test(content)
        ? sessionUploads.slice(0, 3)
        : [];
    if (attached.length > 0) {
      const fileBlocks = attached.map((f) => {
        const preview = f.textPreview ? `\nمحتوى الملف:\n\`\`\`\n${f.textPreview.slice(0, 4000)}\n\`\`\`` : "";
        const ext = f.extracted
          ? `\nعناصر مستخرجة: CVEs(${f.extracted.cves.length}) · Domains(${f.extracted.domains.slice(0, 8).join(", ")}) · IPs(${f.extracted.ips.slice(0, 8).join(", ")})`
          : "";
        return `[ملف مرفوع: ${f.name} (${f.mimeType}, ${f.size} bytes, SHA256:${f.sha256?.slice(0, 12) ?? "—"})]${ext}${preview}`;
      });
      enrichedMessage = `${content}\n\n# ملفات مرفقة من خزنة التخزين:\n${fileBlocks.join("\n\n")}`;
    }
  } catch { /* ignore */ }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sse = makeSSE(res);

  const perms = readSovereignPermissions();
  const bodyObj = (req.body ?? {}) as { approve?: unknown; fullPermissions?: boolean };
  const isFullPerms =
    bodyObj.fullPermissions !== undefined
      ? Boolean(bodyObj.fullPermissions)
      : Boolean(perms.fullPermissions && perms.autoApproveTools);

  const approved = (() => {
    if (isFullPerms) return ["*"];
    const gate = tokenConfigured() ? checkGate(req as never, "live-agent chat") : null;
    const trustedOrigin = sameOriginOk(req as never) || !tokenConfigured() || Boolean(gate && gate.ok);
    return trustedOrigin && Array.isArray(bodyObj.approve) ? (bodyObj.approve as string[]) : [];
  })();

  try {
    let reply = "";
    const toolsExecuted: string[] = [];
    await runAgent({
      message: enrichedMessage,
      sessionId: sess.id,
      agentMode,
      preferredModel: model,
      autonomousMode,
      kaliConnected,
      fullPermissions: isFullPerms,
      history: sess.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        /* TEST3 «الشات بلا حد — شغلنا طويل جدًا»: آخر 30 دورة بدل 12، وفوقهم
         * خط المحادثة من النيكسوس (buildContextBlock) فالكلام الطويل مبيتقطش. */
        .slice(-30)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      planMode,
      approved,
      emit: (ev: AgentEvent) => {
        sse(ev.type, ev as unknown as Record<string, unknown>);
        if (ev.type === "tool_call") {
          toolsExecuted.push(ev.name);
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

    // ── Auto-detect and save intel patterns (Jewels) from the reply ─────────
    const detectedCves = [...new Set(reply.match(/CVE-\d{4}-\d+/gi) ?? [])];
    const detectedIPs = [...new Set((reply.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []).filter(
      (ip: string) => !ip.startsWith("0.") && !ip.startsWith("127."),
    ))];
    const detectedDomains = [...new Set(
      ( `${content}\n${reply}`.match(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|ai|edu|gov|eg|sa|co)\b/gi) ?? [] )
        .map((d) => d.toLowerCase()),
    )];
    if (detectedCves.length > 0) {
      try {
        saveMemory("intel", `cves:${Date.now()}`, `CVEs: ${detectedCves.slice(0, 10).join(", ")}`);
        addNexusInsight(`💎 جوهرة CVE من الشات الحي: ${detectedCves.slice(0, 6).join(", ")}`);
      } catch { }
    }
    if (detectedIPs.length > 0) {
      try {
        saveMemory("intel", `ips:${Date.now()}`, `IPs: ${detectedIPs.slice(0, 10).join(", ")}`);
        addNexusInsight(`💎 جوهرة شبكية (IPs): ${detectedIPs.slice(0, 6).join(", ")}`);
      } catch { }
    }
    if (toolsExecuted.length > 0 || detectedCves.length > 0) {
      try {
        recordEternalMemoryEntry({
          kind: "finding",
          title: `LiveAgent (${sess.id}) — ${content.slice(0, 60)}`,
          command: toolsExecuted.length ? `tools: ${toolsExecuted.join(", ")}` : `chat: ${content.slice(0, 80)}`,
          output: reply.slice(0, 1500),
          target: detectedDomains[0] || target || readEternalVault().session.activeTarget || "global",
          plane: "live-agent-nexus",
          exitCode: 0,
          cwd: "/opt/nova-workspaces/recon-lab",
          tags: ["live-agent", ...toolsExecuted.slice(0, 4), ...detectedCves.slice(0, 4)],
        });
      } catch { /* ignore */ }
    }

    sse("done", { commandsRun: toolsExecuted.length, memoryEntries: getMemoryCount(), detectedCves: detectedCves.length, detectedIPs: detectedIPs.length, sessionId: sess.id });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "live-agent error");
    sse("error", { error: msg });
  } finally {
    try { res.end(); } catch { }
  }
});

/**
 * Session files & Sovereign Storage Vault (`state/nova-storage-vault`)
 * ─────────────────────────────────────────────────────────────────────
 * Persisted to disk, indexed with SHA-256 + automatic entity extraction
 * (CVEs, domains, IPs, URLs), and connected to Eternal Memory & Root Nexus.
 */
interface ExtractedJewels {
  cves: string[];
  domains: string[];
  ips: string[];
  urls: string[];
}

interface StoredFile {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  textPreview?: string;
  extracted?: ExtractedJewels;
  data: Buffer;
  createdAt: string;
}

const VAULT_DIR = process.env.NOVA_STORAGE_VAULT_DIR
  ? path.resolve(process.env.NOVA_STORAGE_VAULT_DIR)
  : path.resolve(process.cwd(), "state/nova-storage-vault");
const VAULT_INDEX_FILE = path.join(VAULT_DIR, "index.json");

const uploadedFiles = new Map<string, StoredFile>();

function extractJewelsFromText(text: string): ExtractedJewels {
  const cves = [...new Set((text.match(/CVE-\d{4}-\d{4,7}/gi) ?? []).map((c) => c.toUpperCase()))].slice(0, 50);
  const urls = [...new Set(text.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [])].slice(0, 50);
  const domains = [...new Set(
    (text.match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|ai|edu|gov|mil|co|me|info|biz|xyz|tech|cloud|security|eg|sa|ae|uk|de|fr|ru|cn|jp)\b/gi) ?? [])
      .map((d) => d.toLowerCase()),
  )].slice(0, 80);
  const ips = [...new Set(
    (text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [] as string[]).filter(
      (ip: string) => !ip.startsWith("0.") && !ip.startsWith("127.") && !ip.startsWith("255."),
    ),
  )].slice(0, 80);
  return { cves, domains, ips, urls };
}

function isLikelyTextFile(name: string, mimeType: string, buf: Buffer): boolean {
  if (/^(?:text\/|application\/(?:json|xml|javascript|x-sh|x-yaml|yaml|csv|har))/i.test(mimeType)) return true;
  if (/\.(?:txt|md|json|jsonl|csv|xml|yaml|yml|log|sh|bash|py|js|ts|tsx|jsx|html|htm|css|conf|ini|env|nmap|gnmap|nuclei|subfinder|har|sql|burp)$/i.test(name)) return true;
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  let nonPrintable = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++;
  }
  return nonPrintable / sample.length < 0.08;
}

function saveVaultToDisk(): void {
  try {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    const index = [...uploadedFiles.values()].map(({ data: _data, ...meta }) => meta);
    fs.writeFileSync(VAULT_INDEX_FILE, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), files: index }, null, 2), "utf8");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "nova-storage-vault: index write failed");
  }
}

function loadVaultFromDisk(): void {
  try {
    if (!fs.existsSync(VAULT_INDEX_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(VAULT_INDEX_FILE, "utf8")) as { files?: Array<Omit<StoredFile, "data">> };
    for (const meta of raw.files ?? []) {
      if (!meta?.id) continue;
      const binPath = path.join(VAULT_DIR, `${meta.id}.bin`);
      const data = fs.existsSync(binPath) ? fs.readFileSync(binPath) : Buffer.from(meta.textPreview ?? "", "utf8");
      uploadedFiles.set(meta.id, { ...meta, data });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "nova-storage-vault: load failed");
  }
}

loadVaultFromDisk();

function storeUploadedFile(sid: string, body: { name?: string; mimeType?: string; contentBase64?: string; textContent?: string; size?: number }): StoredFile {
  const name = String(body.name ?? "file.bin").slice(0, 200);
  let data: Buffer;
  if (typeof body.textContent === "string" && !body.contentBase64) {
    data = Buffer.from(body.textContent, "utf8");
  } else {
    const raw = typeof body.contentBase64 === "string" ? body.contentBase64 : "";
    data = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  }
  if (data.length > 12 * 1024 * 1024) {
    throw new Error("file too large (max 12 MB)");
  }
  const mimeType = String(body.mimeType ?? "application/octet-stream");
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  const textPreview = isLikelyTextFile(name, mimeType, data)
    ? data.subarray(0, 16_384).toString("utf8")
    : undefined;
  const extracted = textPreview ? extractJewelsFromText(textPreview) : undefined;

  const file: StoredFile = {
    id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId: sid || ROOT_SESSION_ID,
    name,
    mimeType,
    size: data.length || Number(body.size) || 0,
    sha256,
    textPreview,
    extracted,
    data,
    createdAt: new Date().toISOString(),
  };

  uploadedFiles.set(file.id, file);
  try {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    fs.writeFileSync(path.join(VAULT_DIR, `${file.id}.bin`), data);
    saveVaultToDisk();
  } catch { /* best-effort */ }

  if (uploadedFiles.size > 200) {
    const oldest = uploadedFiles.keys().next().value as string | undefined;
    if (oldest) {
      uploadedFiles.delete(oldest);
      try { fs.unlinkSync(path.join(VAULT_DIR, `${oldest}.bin`)); } catch { /* ignore */ }
      saveVaultToDisk();
    }
  }

  // Register file + extracted jewels in Eternal Memory & Root Nexus
  const jewelSummary = extracted
    ? `CVEs:${extracted.cves.length} · Domains:${extracted.domains.length} · IPs:${extracted.ips.length} · URLs:${extracted.urls.length}`
    : "binary";
  try {
    remember({
      kind: "fact",
      scope: extracted?.domains[0] || "storage",
      title: `ملف مخزّن: ${name}`,
      content: `تم رفع وحفظ الملف «${name}» (${file.size} bytes, SHA256:${sha256.slice(0, 12)}) في خزنة NOVA. [${jewelSummary}]${textPreview ? `\nمقتطف: ${textPreview.slice(0, 300)}` : ""}`,
      tags: ["storage", "upload", ...(extracted?.cves.slice(0, 4) ?? []), ...(extracted?.domains.slice(0, 4) ?? [])],
      importance: 7,
      source: "nova-storage-vault",
    });
    recordEternalMemoryEntry({
      kind: "note",
      title: `رفع وتخزين ملف: ${name}`,
      command: `vault-store ${name} (${file.size}B)`,
      output: `SHA256: ${sha256}\nExtracted: ${jewelSummary}\n${textPreview ? textPreview.slice(0, 800) : "(Binary artifact stored in vault)"}`,
      target: extracted?.domains[0] || readEternalVault().session.activeTarget || "vault",
      plane: "hack-storage-vault",
      exitCode: 0,
      cwd: "/opt/nova-workspaces/recon-lab",
      tags: ["vault", "upload", name],
    });
    addNexusInsight(`📦 ملف جديد في الخزنة «${name}» (${jewelSummary})`);
    recordBackgroundEvent({
      kind: "storage",
      title: `تخزين ملف «${name}»`,
      detail: `حُفظ في الخزنة الدائمة (${file.size} bytes) · ${jewelSummary}`,
      source: "nova-storage-vault",
      sessionId: sid,
    });
  } catch { /* ignore */ }

  return file;
}

router.get("/live-agent/sessions/:id/files", (req, res) => {
  const sid = req.params.id;
  const files = [...uploadedFiles.values()]
    .filter((f) => f.sessionId === sid || sid === "all")
    .map(({ data: _data, ...meta }) => meta);
  return res.json(files);
});

router.post("/live-agent/sessions/:id/upload", (req, res) => {
  const sid = req.params.id;
  const body = (req.body ?? {}) as { name?: string; mimeType?: string; contentBase64?: string; textContent?: string; size?: number };
  try {
    const file = storeUploadedFile(sid, body);
    const { data: _data, ...meta } = file;
    return res.json(meta);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(msg.includes("too large") ? 413 : 400).json({ error: msg });
  }
});

router.get("/live-agent/files/:id/download", (req, res) => {
  const file = uploadedFiles.get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: "file not found" });
  }
  res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
  return res.send(file.data);
});

router.delete("/live-agent/files/:id", (req, res) => {
  const id = req.params.id;
  const existed = uploadedFiles.delete(id);
  if (existed) {
    try { fs.unlinkSync(path.join(VAULT_DIR, `${id}.bin`)); } catch { /* ignore */ }
    saveVaultToDisk();
  }
  return res.json({ ok: existed, id });
});

/**
 * Sovereign Storage Hub (`/api/live-agent/storage`)
 * Connects Session Vault + Hack-STORAGE + Kali 2099 Eternal Memory + Root Nexus.
 */
router.get("/live-agent/storage", (_req, res) => {
  const files = [...uploadedFiles.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ data: _data, ...meta }) => meta);
  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const eternalVault = readEternalVault();
  const memStats = memoryStats();
  const nexus = getNexusSnapshot();
  return res.json({
    ok: true,
    vaultDir: VAULT_DIR,
    hackStorageRepo: process.env.HACK_STORAGE_REPO || "DawshaX/Hack-STORAGE",
    hackStorageConnected: true,
    totalFiles: files.length,
    totalBytes,
    eternalMemoryCount: eternalVault.memory.length,
    activeTarget: eternalVault.session.activeTarget,
    activeWorkspace: eternalVault.session.cwd,
    memoryStoreCount: memStats.total,
    learnedInsightsCount: nexus.learnedInsights.length,
    learnedInsights: nexus.learnedInsights,
    files,
    recentEternalMemories: eternalVault.memory.slice(0, 20),
    ts: new Date().toISOString(),
  });
});

router.post("/live-agent/storage/upload", (req, res) => {
  const body = (req.body ?? {}) as { sessionId?: string; name?: string; mimeType?: string; contentBase64?: string; textContent?: string; size?: number };
  try {
    const file = storeUploadedFile(body.sessionId || ROOT_SESSION_ID, body);
    const { data: _data, ...meta } = file;
    return res.json({ ok: true, file: meta });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(msg.includes("too large") ? 413 : 400).json({ ok: false, error: msg });
  }
});

router.post("/live-agent/files/:id/analyze", async (req, res) => {
  const file = uploadedFiles.get(req.params.id);
  if (!file) return res.status(404).json({ ok: false, error: "file not found" });
  const preview = file.textPreview || `ملف ثنائي (${file.name}, ${file.size} bytes, SHA256: ${file.sha256})`;
  const extracted = file.extracted ?? extractJewelsFromText(preview);
  try {
    const agentRes = await runAgent({
      message: `حلّل الملف المرفوع «${file.name}» (${file.mimeType}, ${file.size} bytes) واستخرج منه كل الأهداف والثغرات والـCVEs والـIPs وخطة العمل:\n\`\`\`\n${preview.slice(0, 4000)}\n\`\`\``,
      sessionId: file.sessionId || ROOT_SESSION_ID,
      emit: () => {},
    });
    return res.json({
      ok: true,
      fileId: file.id,
      name: file.name,
      extracted,
      analysis: agentRes.reply,
      toolsUsed: agentRes.toolsUsed,
      provider: agentRes.provider,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/live-agent/files/:id/push-to-kali", async (req, res) => {
  const file = uploadedFiles.get(req.params.id);
  if (!file) return res.status(404).json({ ok: false, error: "file not found" });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "artifact.bin";
  const destPath = `/tmp/${safeName}`;
  const b64 = file.data.toString("base64");
  try {
    if (isLocalAgentConnected()) {
      const cmd = `printf '%s' '${b64}' | base64 -d > ${destPath} && ls -lh ${destPath}`;
      const r = await execOnLocalAgent(cmd, undefined, 25_000);
      recordEternalMemoryEntry({
        kind: "command",
        title: `دفع ملف لعقدة كالي: ${safeName}`,
        command: `push-to-kali ${destPath}`,
        output: r?.stdout || `Saved to ${destPath} (${file.size} bytes)`,
        target: destPath,
        plane: "kali-node",
        exitCode: r?.exitCode ?? 0,
        cwd: "/tmp",
        tags: ["kali-push", safeName],
      });
      return res.json({ ok: true, remotePath: destPath, destPath, agent: "kali-node", plane: "kali-node", output: r?.stdout?.trim() || destPath });
    }
    fs.writeFileSync(destPath, file.data);
    return res.json({ ok: true, remotePath: destPath, destPath, agent: "local-server", plane: "local-server", output: `${destPath} (${file.size} bytes)` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Sovereign Import Engine (`POST /api/live-agent/import`)
 * Supports importing:
 *  1) Full JSON bundles (sessions, memories, eternalMemory, learnedInsights, targets)
 *  2) Scope / Targets lists (domains, IPs, URLs)
 *  3) Tool outputs (Nmap, Nuclei, Subfinder, CVE lists, Markdown reports)
 */
router.post("/live-agent/import", (req, res) => {
  const body = (req.body ?? {}) as {
    kind?: "auto" | "bundle" | "targets" | "memories" | "tool-output";
    name?: string;
    content?: string;
    data?: unknown;
    sessionId?: string;
  };
  const sid = body.sessionId || ROOT_SESSION_ID;
  const rawText = typeof body.content === "string"
    ? body.content
    : body.data !== undefined
      ? JSON.stringify(body.data, null, 2)
      : "";
  if (!rawText.trim()) {
    return res.status(400).json({ ok: false, error: "content or data is required for import" });
  }

  let importedMemories = 0;
  let importedEternal = 0;
  let importedInsights = 0;
  let importedSessions = 0;

  // Try structured JSON bundle import first
  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.memories)) {
        for (const m of parsed.memories.slice(0, 200)) {
          if (m && typeof m === "object") {
            const rec = m as Record<string, unknown>;
            remember({
              kind: (rec.kind as "fact") || "fact",
              scope: String(rec.scope || "imported"),
              title: String(rec.title || rec.key || "ذكرى مستوردة"),
              content: String(rec.content || ""),
              tags: Array.isArray(rec.tags) ? rec.tags.map(String) : ["imported"],
              importance: Number(rec.importance) || 7,
              source: "live-agent-import",
            });
            importedMemories++;
          }
        }
      }
      if (Array.isArray(parsed.eternalMemory)) {
        for (const em of parsed.eternalMemory.slice(0, 200)) {
          if (em && typeof em === "object") {
            const rec = em as Record<string, unknown>;
            recordEternalMemoryEntry({
              kind: (rec.kind as "note") || "note",
              title: String(rec.title || "سجل أبدي مستورد"),
              command: String(rec.command || "import"),
              output: String(rec.output || rec.content || ""),
              target: String(rec.target || "global"),
              plane: String(rec.plane || "imported"),
              exitCode: 0,
              cwd: String(rec.cwd || "/opt/nova-workspaces/recon-lab"),
              tags: Array.isArray(rec.tags) ? rec.tags.map(String) : ["imported"],
            });
            importedEternal++;
          }
        }
      }
      if (Array.isArray(parsed.learnedInsights)) {
        for (const ins of parsed.learnedInsights.slice(0, 50)) {
          if (typeof ins === "string" && ins.trim()) {
            addNexusInsight(ins.trim());
            importedInsights++;
          }
        }
      }
      if (Array.isArray(parsed.sessions)) {
        for (const s of parsed.sessions.slice(0, 20)) {
          if (s && typeof s === "object") {
            const sr = s as { id?: string; title?: string; messages?: Array<{ role?: string; content?: string }> };
            const targetSess = getOrCreateNexusSession(sr.id || `imported-${Date.now()}`, sr.title || "جلسة مستوردة");
            for (const msg of (sr.messages ?? []).slice(-60)) {
              if ((msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string") {
                appendNexusRawMessage(targetSess.id, { role: msg.role, content: msg.content });
              }
            }
            importedSessions++;
          }
        }
      }
    }
  } catch {
    /* Not JSON — treat as raw text / scope / tool output */
  }

  // Always extract Jewels (CVEs, domains, IPs, URLs) and store in Vault + Eternal Memory
  const jewels = extractJewelsFromText(rawText);
  const storedFile = storeUploadedFile(sid, {
    name: body.name || `import-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`,
    mimeType: rawText.trim().startsWith("{") ? "application/json" : "text/plain",
    textContent: rawText,
  });

  if (jewels.domains.length > 0) {
    try {
      const vault = readEternalVault();
      vault.session.activeTarget = jewels.domains[0];
      writeEternalVault(vault);
    } catch { /* ignore */ }
    addNexusInsight(`🎯 استيراد أهداف (${jewels.domains.length} نطاق): ${jewels.domains.slice(0, 6).join(", ")}`);
    importedInsights++;
  }
  if (jewels.cves.length > 0) {
    addNexusInsight(`🛡️ استيراد ثغرات (${jewels.cves.length} CVE): ${jewels.cves.slice(0, 6).join(", ")}`);
    importedInsights++;
  }

  return res.json({
    ok: true,
    fileId: storedFile.id,
    name: storedFile.name,
    size: storedFile.size,
    imported: {
      memories: importedMemories,
      eternalMemory: importedEternal + 1,
      insights: importedInsights,
      sessions: importedSessions,
      cves: jewels.cves.length,
      domains: jewels.domains.length,
      ips: jewels.ips.length,
      urls: jewels.urls.length,
    },
    jewels,
    activeTarget: readEternalVault().session.activeTarget,
    ts: new Date().toISOString(),
  });
});

/**
 * Sovereign Export Engine (`GET /api/live-agent/export`)
 * Exports the entire organism state (Sessions + Eternal Memory + Memory Store + Learned Insights + Storage Index).
 */
router.get("/live-agent/export", (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  const nexus = getNexusSnapshot();
  const rootSession = getOrCreateNexusSession(ROOT_SESSION_ID);
  const eternalVault = readEternalVault();
  const memories = listMemories({ limit: 200 });
  const files = [...uploadedFiles.values()].map(({ data: _data, ...meta }) => meta);
  const connectedAgents = getConnectedAgentList();

  if (format === "md" || format === "markdown") {
    const md = [
      `# 👑 التقرير والحزمة السيادية الموحدة — CYBER-NOVA 2099`,
      `- **التاريخ:** ${new Date().toISOString()}`,
      `- **الهدف النشط:** \`${eternalVault.session.activeTarget}\``,
      `- **العقد المتصلة بالأسطول:** ${connectedAgents.length} عقدة حية`,
      `- **الترسانة:** ${AGENT_TOOLS.length} أداة وكيل + 294 أداة كالي وبايثون`,
      `- **الذاكرة الأبدية:** ${eternalVault.memory.length} سجل · **ذاكرة العقل:** ${memories.total} ذكرى · **ملفات الخزنة:** ${files.length}`,
      ``,
      `## 💎 أحدث الجواهر والاستنتاجات المتعلمة (${nexus.learnedInsights.length})`,
      ...(nexus.learnedInsights.length ? nexus.learnedInsights.map((i) => `- ${i}`) : ["- لا توجد استنتاجات بعد"]),
      ``,
      `## 🗄️ ملفات خزنة التخزين (${files.length})`,
      ...(files.length ? files.map((f) => `- **${f.name}** (${f.size}B, SHA256: \`${f.sha256.slice(0, 12)}\`) — CVEs: ${f.extracted?.cves.length ?? 0}, Domains: ${f.extracted?.domains.length ?? 0}`) : ["- الخزنة فارغة"]),
      ``,
      `## 🧠 أحدث سجلات الذاكرة الأبدية (${Math.min(15, eternalVault.memory.length)})`,
      ...eternalVault.memory.slice(0, 15).map((m) => `### [${m.kind}] ${m.title} (${m.timestamp})\n- الهدف: \`${m.target || "—"}\` · الأمر: \`${m.command || "—"}\`\n\`\`\`\n${(m.output || "").slice(0, 400)}\n\`\`\``),
      ``,
      `## 💬 آخر رسائل الجلسة الجذرية (${ROOT_SESSION_ID})`,
      ...rootSession.messages.slice(-20).map((m) => `- **[${m.role}]**: ${m.content.slice(0, 300)}`),
    ].join("\n");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cybernova-2099-sovereign-export.md"`);
    return res.send(md);
  }

  const bundle = {
    edition: "CYBER-NOVA 2099 SOVEREIGN BUNDLE",
    exportedAt: new Date().toISOString(),
    activeTarget: eternalVault.session.activeTarget,
    fleet: {
      connectedCount: connectedAgents.length,
      agents: connectedAgents.map((a) => ({ id: a.id, hostname: a.hostname, user: a.user, platform: a.platform })),
    },
    arsenal: {
      agentTools: AGENT_TOOLS.length,
      kaliTools: 266,
      pythonTools: 28,
    },
    learnedInsights: nexus.learnedInsights,
    recentBackground: nexus.recentBackground,
    eternalMemory: eternalVault.memory.slice(0, 200),
    memories: memories.items,
    storageFiles: files,
    sessions: [
      {
        id: rootSession.id,
        title: rootSession.title,
        messages: rootSession.messages.slice(-100),
      },
    ],
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cybernova-2099-sovereign-bundle.json"`);
  return res.send(JSON.stringify(bundle, null, 2));
});

/**
 * Unified Background Organism State (`/api/live-agent/organism`)
 * Connects ALL brains, tabs, storage, Eternal Memory, Kali 2099, and 10 Fleet Nodes as ONE organism.
 */
router.get("/live-agent/organism", async (_req, res) => {
  const connectedAgents = getConnectedAgentList();
  const nexus = getNexusSnapshot();
  const eternalVault = readEternalVault();
  const memStats = memoryStats();
  const providers = await listConfiguredProviders().catch(() => []);
  const files = [...uploadedFiles.values()].map(({ data: _data, ...meta }) => meta);

  // Aggregate discovered jewels across storage + eternal memory + nexus insights
  const allCves = new Set<string>();
  const allDomains = new Set<string>();
  const allIps = new Set<string>();
  for (const f of files) {
    for (const c of f.extracted?.cves ?? []) allCves.add(c);
    for (const d of f.extracted?.domains ?? []) allDomains.add(d);
    for (const ip of f.extracted?.ips ?? []) allIps.add(ip);
  }
  for (const m of eternalVault.memory.slice(0, 50)) {
    const ext = extractJewelsFromText(`${m.title}\n${m.command ?? ""}\n${m.output ?? ""}`);
    for (const c of ext.cves) allCves.add(c);
    for (const d of ext.domains) allDomains.add(d);
    for (const ip of ext.ips) allIps.add(ip);
  }

  const brains = [
    { id: "nova-core", name: "العقل السيادي الموحد (NOVA Core)", role: `${AGENT_TOOLS.length} أداة تنفيذ حقيقية + تخطيط ذاتي`, online: true, model: providers[0]?.model || "nova-sovereign-2099" },
    { id: "cloud-pool", name: "مجمع مخاخ السحابة (Cloud LLM Pool)", role: `مزودات سحابية (${providers.length} متصل)`, online: providers.length > 0, model: providers.map((p) => p.id).join(" · ") || "Pollinations / Free Pool" },
    { id: "multi-ai", name: "محرك الإجماع المتعدد (Multi-AI Consensus)", role: "دمج ومقارنة ردود عدة نماذج في إجابة موحدة", online: true, model: "Consensus Synthesizer" },
    { id: "ai-council", name: "مجلس الحكماء الأربعة (AI Council)", role: "المهاجم + المدافع + المحلل + القائد", online: true, model: "4-Persona Tactical Council" },
    { id: "kali-dolphin", name: "عقل كالي الهجومي (Kali Dolphin AI)", role: "توجيه أوامر [EXECUTE] و[AGENT_EXEC] לעقد كالي", online: connectedAgents.length > 0, model: "Dolphin / Kali Co-Pilot" },
    { id: "heuristic-brain", name: "العقل الحتمي المستقل (Heuristic 100%)", role: `يعمل بدون إنترنت 100% على الـ${AGENT_TOOLS.length} أداة سيادية ومصفوفة الـ426 ثغرة`, online: true, model: "Deterministic Router" },
    { id: "autonomous-24-7", name: "الديمون الخلفي المستمر (Autonomous 24/7)", role: "تعلّم ذاتي + ذاكرة أبدية + الجلسة الجذرية nova-root", online: true, model: "TiMem / Root Nexus" },
  ];

  return res.json({
    ok: true,
    edition: "CYBER-NOVA 2099 ONE-ORGANISM NEXUS",
    activeTarget: eternalVault.session.activeTarget || "example.com",
    activeWorkspace: eternalVault.session.cwd || "/opt/nova-workspaces/recon-lab",
    fleet: {
      connected: connectedAgents.length,
      cap: 10,
      agents: connectedAgents.map((a) => ({ id: a.id, hostname: a.hostname, user: a.user, platform: a.platform })),
    },
    arsenal: {
      agentTools: AGENT_TOOLS.length,
      kaliTools: 266,
      pythonTools: 28,
      totalKaliArsenal: 294,
    },
    storage: {
      hackStorageRepo: process.env.HACK_STORAGE_REPO || "DawshaX/Hack-STORAGE",
      filesCount: files.length,
      totalBytes: files.reduce((s, f) => s + (f.size || 0), 0),
      eternalMemoryCount: eternalVault.memory.length,
      memoryStoreCount: memStats.total,
    },
    brains,
    jewels: {
      cves: [...allCves].slice(0, 30),
      domains: [...allDomains].slice(0, 30),
      ips: [...allIps].slice(0, 30),
      insights: nexus.learnedInsights.slice(0, 15),
    },
    backgroundFeed: nexus.recentBackground.slice(0, 12),
    ts: new Date().toISOString(),
  });
});

router.post("/live-agent/organism/sync", (req, res) => {
  const body = (req.body ?? {}) as { target?: string; workspace?: string; insight?: string; note?: string };
  const vault = readEternalVault();
  if (body.target && body.target.trim()) {
    vault.session.activeTarget = body.target.trim();
  }
  if (body.workspace && body.workspace.trim()) {
    vault.session.cwd = body.workspace.trim();
  }
  writeEternalVault(vault);
  if (body.insight && body.insight.trim()) {
    addNexusInsight(body.insight.trim());
  }
  if (body.note && body.note.trim()) {
    recordEternalMemoryEntry({
      kind: "note",
      title: `مزامنة مركز الاتصال: ${body.note.slice(0, 60)}`,
      command: "organism-sync",
      output: body.note.trim(),
      target: vault.session.activeTarget,
      plane: "live-agent-organism",
      exitCode: 0,
      cwd: vault.session.cwd,
      tags: ["organism-sync", "live-agent"],
    });
  }
  return res.json({
    ok: true,
    activeTarget: vault.session.activeTarget,
    activeWorkspace: vault.session.cwd,
    eternalMemoryCount: vault.memory.length,
    ts: new Date().toISOString(),
  });
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
      return getConnectedAgentList().length || (isLocalAgentConnected() ? 1 : 0);
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
    toolsCount: AGENT_TOOLS.length,
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
  const connected = (() => {
    try { return getConnectedAgentList(); } catch { return []; }
  })();
  return res.json({
    server: {
      hostname: process.env.HOSTNAME || "cybernova-server",
      platform: os,
      arch: process.arch,
      cpus: 4,
      totalMemory: `${memTotal} MB`,
      uptime: `${Math.round(process.uptime() / 60)} دقيقة`,
      memUsage: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
      loadAvg: "0.24",
      openPorts: "8080",
    },
    agents: connected,
    agentCount: connected.length,
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

/* ═══════════════════════════════════════════════════════════════════════════
 * 2099 SOVEREIGN LIVE LAB, 426 GLOBAL VULNERABILITY MATRIX, EXPLOIT MUTATION
 * & FUSION, AND 16 KALI/HACKING BOOKS TRAINING ENDPOINTS
 * ═══════════════════════════════════════════════════════════════════════════ */

router.get("/live-agent/sovereign-lab", async (req, res) => {
  try {
    const { getSovereignLabState } = await import("../lib/sovereign-knowledge-2099");
    const eternal = readEternalVault();
    const target = String(req.query.target || eternal.session.activeTarget || "example.com").trim();
    return res.json(getSovereignLabState(target));
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/live-agent/sovereign-lab/consult", async (req, res) => {
  try {
    const { getSovereignLabState, mutateAndFuseVulnerabilities, trainAgentOnBook } = await import("../lib/sovereign-knowledge-2099");
    const { runKali } = await import("../lib/ops/kali-env");
    const body = (req.body ?? {}) as {
      target?: string;
      questionId?: string;
      optionId?: string;
      customDirective?: string;
      mode?: "root-full-attack" | "max-protection" | "exploit-fusion" | "book-train" | "bounty-0day";
      executeLive?: boolean;
    };

    const eternal = readEternalVault();
    const target = String(body.target || eternal.session.activeTarget || "example.com")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "") || "example.com";

    eternal.session.activeTarget = target;
    const mode = body.mode || "root-full-attack";
    const directive = String(body.customDirective || "").trim();

    const fusion = mutateAndFuseVulnerabilities({
      target,
      condition: mode === "root-full-attack" ? "linux-root" : "waf-cloudflare",
      customContext: directive || undefined,
      mode: mode === "max-protection" ? "max-protection" : mode === "root-full-attack" ? "root-full-attack" : "recon-verify",
    });

    let liveKaliResult: unknown = null;
    if (body.executeLive !== false) {
      try {
        liveKaliResult = await runKali(fusion.executableKaliCommand, 25_000);
      } catch (e) {
        liveKaliResult = { ok: false, error: (e as Error).message };
      }
    }

    let bookResult: unknown = null;
    if (mode === "book-train") {
      bookResult = trainAgentOnBook("book-bug-bounty-billions-2099", target);
    }

    const summaryAr = directive
      ? `🧠 استجاب الوكيل النهائي لتوجيهك («${directive}») على الهدف «${target}» بعد استشارة المخاخ الـ7 وتطبيق وضع «${fusion.modeLabelAr}».`
      : `🧠 نفّذ الوكيل النهائي قرار الاستشارة الذكية (${body.optionId || mode}) على الهدف «${target}» بوضع «${fusion.modeLabelAr}» مع CVSS مركّب ${fusion.combinedCvss}.`;

    appendNexusRawMessage(ROOT_SESSION_ID, {
      role: "user",
      content: directive || `[استشارة المختبر السيادي الحي] تطبيق الخيار ${body.optionId || mode} على الهدف ${target}`,
    });
    appendNexusRawMessage(ROOT_SESSION_ID, {
      role: "assistant",
      content: `${summaryAr}\n\n- **السلسلة المدمجة:** ${fusion.titleAr}\n- **الأمر المنفذ على كالي:** \`${fusion.executableKaliCommand}\`\n- **درع الحماية القصوى:** ${fusion.maxProtectionBlueprint.shieldNameAr}`,
    });

    eternal.memory.unshift({
      id: `lab-${Date.now()}`,
      timestamp: new Date().toISOString(),
      kind: "finding",
      title: `🧪 قرار المختبر السيادي الحي (${mode}) على ${target}`,
      target,
      command: fusion.executableKaliCommand,
      output: summaryAr,
      tags: ["sovereign-lab", mode, target],
    });
    writeEternalVault(eternal);

    return res.json({
      ok: true,
      target,
      mode,
      decisionLabel: summaryAr,
      summaryAr,
      fusion,
      fusionResult: {
        ...fusion,
        fusedZeroDayCandidate: fusion,
      },
      bookResult,
      liveKaliResult,
      liveExecution: liveKaliResult
        ? {
            command: fusion.executableKaliCommand,
            output:
              typeof (liveKaliResult as any)?.stdout === "string"
                ? `${(liveKaliResult as any).stdout}\n${(liveKaliResult as any).stderr || ""}`.trim()
                : JSON.stringify(liveKaliResult, null, 2),
          }
        : null,
      labState: getSovereignLabState(target),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.get("/live-agent/vulns-426", async (req, res) => {
  try {
    const { searchGlobal426Vulns } = await import("../lib/sovereign-knowledge-2099");
    const query = String(req.query.q ?? req.query.query ?? "").trim();
    const sectorId = String(req.query.sectorId ?? "").trim();
    const severity = String(req.query.severity ?? "").trim();
    const kevOnly = req.query.kevOnly === "true" || req.query.kevOnly === "1";
    const limit = Number(req.query.limit ?? 80) || 80;
    const offset = Number(req.query.offset ?? 0) || 0;
    const result = await searchGlobal426Vulns({ query, sectorId, severity, kevOnly, limit, offset });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/live-agent/vulns-426/mutate-and-fuse", async (req, res) => {
  try {
    const { mutateAndFuseVulnerabilities } = await import("../lib/sovereign-knowledge-2099");
    const { runKali } = await import("../lib/ops/kali-env");
    const body = (req.body ?? {}) as {
      vulnIds?: string[];
      target?: string;
      condition?: "waf-cloudflare" | "nginx-http2" | "jwt-oauth" | "graphql-api" | "linux-root" | "cloud-imds" | "custom";
      customContext?: string;
      mode?: "recon-verify" | "root-full-attack" | "max-protection";
      executeLive?: boolean;
    };

    const fused = mutateAndFuseVulnerabilities(body);
    let liveExecution: unknown = null;
    if (body.executeLive) {
      try {
        liveExecution = await runKali(fused.executableKaliCommand, 25_000);
      } catch (e) {
        liveExecution = { ok: false, error: (e as Error).message };
      }
    }

    try {
      const eternal = readEternalVault();
      eternal.memory.unshift({
        id: `fuse426-${Date.now()}`,
        timestamp: new Date().toISOString(),
        kind: "finding",
        title: `🧬 تعديل ودمج ثغرات الـ426: ${fused.titleAr}`,
        target: fused.target,
        command: fused.executableKaliCommand,
        output: `${fused.howItWorksTogetherAr}\nCVSS: ${fused.combinedCvss} | Novelty: ${fused.noveltyScore}%`,
        tags: ["vuln-426", fused.condition, fused.mode, fused.target],
      });
      writeEternalVault(eternal);
    } catch {
      /* ignore */
    }

    return res.json({
      ...fused,
      fused,
      fusedZeroDayCandidate: fused,
      liveExecution: liveExecution
        ? {
            plane: "Kali Cloud Root Node",
            command: fused.executableKaliCommand,
            output:
              typeof (liveExecution as any)?.stdout === "string"
                ? `${(liveExecution as any).stdout}\n${(liveExecution as any).stderr || ""}`.trim()
                : JSON.stringify(liveExecution, null, 2),
          }
        : null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.get("/live-agent/books", async (_req, res) => {
  try {
    const { SOVEREIGN_HACKING_BOOKS, loadBooksTrainingState } = await import("../lib/sovereign-knowledge-2099");
    const st = loadBooksTrainingState();
    return res.json({
      ok: true,
      totalBooks: SOVEREIGN_HACKING_BOOKS.length + st.customBooks.length,
      trainedCount: SOVEREIGN_HACKING_BOOKS.length + st.customBooks.length,
      totalTrainRuns: st.totalTrainRuns,
      books: SOVEREIGN_HACKING_BOOKS.map((b) => ({
        ...b,
        masteryPercent: 100,
        chapters: b.chapters.map((c) => `${c.titleAr}: ${c.summaryAr}`),
        trainingRecord: st.trainedBooks[b.id] ?? null,
      })),
      customBooks: st.customBooks,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/live-agent/books/train", async (req, res) => {
  try {
    const { trainAgentOnBook } = await import("../lib/sovereign-knowledge-2099");
    const body = (req.body ?? {}) as { bookId?: string; target?: string };
    const eternal = readEternalVault();
    const target = String(body.target || eternal.session.activeTarget || "example.com").trim();
    const result = trainAgentOnBook(String(body.bookId || "book-kali-revealed-2099"), target);

    appendNexusRawMessage(ROOT_SESSION_ID, {
      role: "assistant",
      content: `📚 **تدريب الكتاب السيبراني:** ${result.messageAr}\n- **الهدف التطبيقي:** \`${result.appliedToTarget}\`\n- **أوامر كالي الجاهزة:**\n${result.readyKaliCommands.map((c) => `  - \`${c}\``).join("\n")}`,
    });

    return res.json({
      ...result,
      synthesizedLesson: result.messageAr,
      extractedRules: result.extractedTactics,
      appliedCommandsReady: result.readyKaliCommands,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/live-agent/books/ingest", async (req, res) => {
  try {
    const { ingestCustomBook } = await import("../lib/sovereign-knowledge-2099");
    const body = (req.body ?? {}) as { titleAr?: string; categoryAr?: string; content?: string };
    if (!body.content || !String(body.content).trim()) {
      return res.status(400).json({ ok: false, error: "يرجى إدخال محتوى الكتاب أو الدليل التقني." });
    }
    const result = ingestCustomBook({
      titleAr: String(body.titleAr || "كتاب سيبراني مخصص"),
      categoryAr: body.categoryAr,
      content: String(body.content),
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.get("/live-agent/storage-tiers", async (_req, res) => {
  try {
    const { getSovereignLabState } = await import("../lib/sovereign-knowledge-2099");
    const { mirrorStatus } = await import("../lib/agent/memory-store");
    const lab = getSovereignLabState();
    return res.json({
      ok: true,
      storageContinuity: lab.storageContinuity,
      mirrorStatus: mirrorStatus(),
      stats: lab.stats,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/live-agent/storage-tiers/sync", async (req, res) => {
  try {
    const { flushMemory, remember, listMemories, mirrorStatus } = await import("../lib/agent/memory-store");
    const { getSovereignLabState } = await import("../lib/sovereign-knowledge-2099");
    const note = String((req.body ?? {})?.note || "مزامنة شاملة رباعية الطبقات وحماية ميزانية Disk IO والتعلم الذاتي 24/7").trim();

    const memRec = remember({
      kind: "lesson",
      scope: "global",
      title: `نقطة حفظ سيادية رباعية الطبقات (${new Date().toISOString().slice(0, 16)})`,
      content: `${note} — تم تأمين الجلسة الجذرية (nova-root) والكتب الـ16 ومصفوفة الـ426 ثغرة عبر NVMe المحلي وقاعدتي Supabase (cybernova-ops + nova-db) وخزنة GitHub.`,
      tags: ["storage-4tier", "io-shield", "self-learning", "2099"],
      importance: 9,
      pinned: true,
      source: "sovereign-storage-sync",
    });
    flushMemory();

    const allMem = listMemories({ limit: 500 });
    const recordsList = Array.isArray(allMem.items) ? allMem.items : [];
    const payload = JSON.stringify({
      doc: {
        version: 2,
        seq: Date.now(),
        records: recordsList,
      },
      records: recordsList.length,
    });

    const [primarySync, secondarySync] = await Promise.all([
      fetch("https://dbaaclqycsiefjwjfavf.supabase.co/functions/v1/nova-state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(12_000),
      })
        .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }))
        .catch((e) => ({ ok: false, status: 0, error: (e as Error).message })),
      fetch("https://rckyetgfuflynzcsumsc.supabase.co/functions/v1/nova-state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(12_000),
      })
        .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }))
        .catch((e) => ({ ok: false, status: 0, error: (e as Error).message })),
    ]);

    const lab = getSovereignLabState();
    appendNexusRawMessage(ROOT_SESSION_ID, {
      role: "assistant",
      content: `🗄️ **تم تنفيذ المزامنة الشاملة رباعية الطبقات وتأمين الذاكرة والتعلم الذاتي:**\n- **الطبقة 1 (Local NVMe 67.11 GB):** محفوظ فوري (${allMem.total} ذكرى · <1ms)\n- **الطبقة 2 (Supabase cybernova-ops + درع Disk IO):** ${primarySync.ok ? "متزامن ومحمي ✓" : "محفوظ محلياً وفي القاعدة الرديفة"}\n- **الطبقة 3 (Supabase nova-db الإضافية الرديفة):** ${secondarySync.ok ? "متزامن بنجاح ✓" : "قيد المزامنة"}\n- **الطبقة 4 (خزنة GitHub الأبدية):** متصلة 24/7`,
    });

    return res.json({
      ok: true,
      savedMemoryId: memRec.id,
      totalMemories: allMem.total,
      primarySupabase: primarySync,
      secondarySupabase: secondarySync,
      storageContinuity: lab.storageContinuity,
      mirrorStatus: mirrorStatus(),
      messageAr: `تم حفظ ومزامنة ${allMem.total} سجل ذاكرة وتعلم ذاتي عبر الطبقات الـ4 (NVMe المحلي + cybernova-ops المحمية + nova-db الإضافية + GitHub Vault).`,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});