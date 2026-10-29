/**
 * Live Agent — Nova AI Director with Dolphin LLM + Memory + Plan Mode
 * Full-featured AI cybersecurity director that understands, plans, executes
 */
import { Router } from "express";
import { spawn } from "child_process";
import { broadcastLiveEvent } from "./live-events";
import { saveMemory, searchMemory, getMemoryCount } from "./memory";
import { execOnLocalAgent, isLocalAgentConnected } from "./local-agent";
import { logger } from "../lib/logger";
import { getAllSettings } from "./settings";

const router = Router();

const DEFAULT_NGROK = "";

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

interface Message { role: "system" | "user" | "assistant"; content: string; }
interface SessionData {
  id: string;
  title: string;
  messages: Message[];
  planMode: boolean;
  pendingPlan: string | null;
  createdAt: number;
  updatedAt: number;
}

const sessions = new Map<string, SessionData>();

function getOrCreate(id: string, title?: string): SessionData {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      title: title || `جلسة ${new Date().toLocaleTimeString("ar-SA")}`,
      messages: [{ role: "system", content: NOVA_SYSTEM }],
      planMode: false,
      pendingPlan: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  return sessions.get(id)!;
}

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
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sess = getOrCreate(id, title);
  res.json({ id: sess.id, title: sess.title, createdAt: new Date(sess.createdAt).toISOString() });
});

router.get("/live-agent/sessions", (_req, res) => {
  const list = [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((s) => ({
    id: s.id,
    title: s.title,
    createdAt: new Date(s.createdAt).toISOString(),
    messageCount: s.messages.length,
  }));
  res.json(list);
});

router.get("/live-agent/sessions/:id", (req, res) => {
  const sess = sessions.get(req.params.id);
  if (!sess) { res.status(404).json({ error: "not found" }); return; }
  res.json({
    id: sess.id,
    title: sess.title,
    messages: sess.messages.filter((m) => m.role !== "system"),
    createdAt: new Date(sess.createdAt).toISOString(),
  });
});

router.delete("/live-agent/sessions/:id", (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

router.get("/live-agent/brain-status", (_req, res) => {
  res.json({
    memoryCount: getMemoryCount(),
    activeSessions: sessions.size,
    activeProcesses: [],
    ts: new Date().toISOString(),
  });
});

router.post("/live-agent/sessions/:id/messages", async (req, res) => {
  const { id } = req.params;
  const { content, planMode = false, autonomousMode = false } = req.body as {
    content: string;
    planMode?: boolean;
    autonomousMode?: boolean;
  };

  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  const sess = getOrCreate(id);
  sess.planMode = planMode;
  sess.updatedAt = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sse = makeSSE(res);

  const memResults = searchMemory(content, 5);
  let memContext = "";
  if (memResults.length > 0) {
    memContext = `\n\n[من الذاكرة — ${memResults.length} إدخال ذو صلة]:\n` +
      memResults.map((m) => `- [${m.memoryType}] ${m.key}: ${m.content.slice(0, 200)}`).join("\n");
  }

  // ── Minimal dynamic context (keeps tokens low for faster responses) ─────────
  const agentOnline = isLocalAgentConnected();
  const dynamicCtx = agentOnline
    ? "\n[KALI متصل — استخدم AGENT_EXEC]"
    : "";

  // ── Context window management: keep last 18 messages + system prompt ────────
  if (sess.messages.length > 20) {
    sess.messages = [sess.messages[0], ...sess.messages.slice(-18)];
  }

  sess.messages.push({ role: "user", content: content + memContext + dynamicCtx });

  let fullResponse = "";

  try {
    await callDolphin(sess.messages, (tok) => {
      fullResponse += tok;
      sse("delta", { text: tok });

      const plan = extractPlan(fullResponse);
      if (plan && sess.planMode) {
        sse("plan_ready", { text: plan });
      }
    });

    sess.messages.push({ role: "assistant", content: fullResponse });

    const plan = extractPlan(fullResponse);
    if (plan) {
      sess.pendingPlan = plan;
      sse("plan_ready", { text: plan });
    }

    const serverCmds = extractCommands(fullResponse);
    const agentCmds = extractAgentExec(fullResponse);
    const memorySaves = extractMemorySave(fullResponse);
    let commandsRun = 0;

    for (const mem of memorySaves) {
      try { saveMemory(mem.type, mem.key, mem.content); } catch { }
    }

    const memSearchMatch = fullResponse.match(/\[MEMORY_SEARCH:\s*([^\]]+)\]/);
    if (memSearchMatch) {
      const results = searchMemory(memSearchMatch[1].trim(), 10);
      const resultText = results.length > 0
        ? results.map((m) => `[${m.memoryType}] ${m.key}: ${m.content.slice(0, 300)}`).join("\n")
        : "لا نتائج في الذاكرة";
      sse("tool_result", { name: "memory_search", result: resultText });
    }

    for (const cmd of agentCmds) {
      sse("exec_start", { command: cmd, on: "kali-agent" });
      broadcastLiveEvent({
        type: "tool_start",
        data: { tool: "agent_shell", message: cmd, ts: Date.now() },
        ts: new Date().toISOString(),
      });
      const result = await runCommand(cmd, 90_000);
      commandsRun++;
      const output = (result.stdout + (result.stderr ? `\n[stderr] ${result.stderr}` : "")).slice(0, 8000);
      sse("exec_result", { command: cmd, output, success: result.success, durationMs: 0, on: result.on });
      broadcastLiveEvent({
        type: "shell_output",
        data: { tool: "agent_shell", command: cmd, output: output.slice(0, 500), isError: !result.success, ts: Date.now() },
        ts: new Date().toISOString(),
      });

      if (result.success && result.stdout.trim()) {
        const summary = `تنفيذ "${cmd.slice(0, 60)}": ${result.stdout.slice(0, 300)}`;
        try { saveMemory("exec_result", `cmd:${Date.now()}`, summary); } catch { }
      }
    }

    for (const cmd of serverCmds) {
      sse("exec_start", { command: cmd, on: "server" });
      broadcastLiveEvent({
        type: "tool_start",
        data: { tool: "shell", message: cmd, ts: Date.now() },
        ts: new Date().toISOString(),
      });
      const result = await runCommand(cmd, 60_000);
      commandsRun++;
      const output = (result.stdout + (result.stderr ? `\n[stderr] ${result.stderr}` : "")).slice(0, 8000);
      sse("exec_result", { command: cmd, output, success: result.success, durationMs: 0, on: result.on });
      broadcastLiveEvent({
        type: "shell_output",
        data: { tool: "shell", command: cmd, output: output.slice(0, 500), isError: !result.success, ts: Date.now() },
        ts: new Date().toISOString(),
      });
    }

    // ── Auto-detect and save intel patterns from response ──────────────────
    const detectedCves = fullResponse.match(/CVE-\d{4}-\d+/g) ?? [];
    const detectedIPs = (fullResponse.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []).filter((ip) => !ip.startsWith("0.") && !ip.startsWith("127."));
    if (detectedCves.length > 0) {
      try { saveMemory("intel", `cves:${Date.now()}`, `CVEs: ${[...new Set(detectedCves)].slice(0, 10).join(", ")}`); } catch { }
    }
    if (detectedIPs.length > 0) {
      try { saveMemory("intel", `ips:${Date.now()}`, `IPs: ${[...new Set(detectedIPs)].slice(0, 10).join(", ")}`); } catch { }
    }

    sse("done", { commandsRun, memoryEntries: getMemoryCount(), detectedCves: detectedCves.length, detectedIPs: detectedIPs.length });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "live-agent error");
    sse("error", { error: msg });
  } finally {
    try { res.end(); } catch { }
  }
});

router.get("/live-agent/sessions/:id/files", (req, res) => {
  res.json([]);
});

router.post("/live-agent/sessions/:id/upload", (req, res) => {
  const { name, mimeType } = req.body as { name: string; mimeType: string };
  res.json({ id: Date.now(), name, mimeType, size: 0, createdAt: new Date().toISOString() });
});

router.get("/providers/status", (_req, res) => {
  const { baseUrl } = (() => {
    const map = getAllSettings();
    const provider = map.provider || "ollama-ngrok";
    const isNgrok = provider === "ollama-ngrok" || provider === "ngrok";
    const baseUrl = isNgrok ? (map.ngrokUrl || DEFAULT_NGROK) : (map.ollamaBaseUrl || "http://127.0.0.1:11434");
    return { baseUrl };
  })();

  res.json({
    providers: [
      { provider: "dolphin-llama3", configured: true, baseUrl },
    ],
  });
});

router.get("/bot/status", (_req, res) => {
  res.json({
    status: "online",
    availableTools: 90,
    cronJobs: { enabled: 0 },
    alerts: { unread: 0 },
  });
});

router.get("/kali-command/intel", (_req, res) => {
  const os = process.platform;
  const memTotal = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);
  res.json({
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
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, error: msg });
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
    res.json({ ok: true, output, ts: new Date().toISOString(), taskName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, error: msg, ts: new Date().toISOString() });
  }
});

// ── OpenClaw MCP Bridge ───────────────────────────────────────────────────────
router.post("/nova/openclaw/chat", async (req, res) => {
  const { message, model, token } = req.body as { message: string; model: string; token: string };
  const baseUrl = process.env.OPENCLAW_GATEWAY || "";
  try {
    const r = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: message }],
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.json({ ok: false, error: `HTTP ${r.status}: ${txt.slice(0,200)}` });
    }
    const data = await r.json() as { choices?: Array<{message:{content:string}}>; error?: string };
    const reply = data.choices?.[0]?.message?.content ?? data.error ?? "لا رد";
    res.json({ ok: true, reply, model, ts: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, error: msg });
  }
});

// ── Browser Automation Endpoint (via OpenClaw) ─────────────────────────────────
router.post("/nova/browser", async (req, res) => {
  const { action, url, targetId, selector, value, token } = req.body as {
    action: string; url?: string; targetId?: string; selector?: string; value?: string; token: string;
  };
  const baseUrl = process.env.OPENCLAW_GATEWAY || "";
  try {
    const r = await fetch(`${baseUrl}/api/tools/browser`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ action, url, targetId, selector, value }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      return res.json({ ok: false, error: `Browser API HTTP ${r.status}`, action });
    }
    const data = await r.json() as Record<string, unknown>;
    res.json({ ok: true, data, action, ts: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, error: msg, action });
  }
});

// ── Tailscale / Ngrok Status ───────────────────────────────────────────────────
router.get("/nova/tunnel-status", async (_req, res) => {
  const baseUrl = process.env.OPENCLAW_GATEWAY || "";
  const results: Record<string, unknown> = { ngrok: false, tailscale: false, gateway: false };
  try {
    const r = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    results.gateway = r.ok;
    results.ngrok = r.ok;
    results.ngrokUrl = baseUrl;
  } catch { results.ngrok = false; }
  try {
    const { execSync } = await import("child_process");
    const ts = execSync("tailscale status --json 2>/dev/null || echo '{}'", { timeout: 3000 }).toString();
    const tsData = JSON.parse(ts);
    results.tailscale = !!tsData.Self;
    results.tailscaleIp = tsData.Self?.TailscaleIPs?.[0];
    results.tailscalePeers = Object.keys(tsData.Peer || {}).length;
  } catch { results.tailscale = false; }
  res.json({ ok: true, ...results, ts: new Date().toISOString() });
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
  res.json({ ok: true, killed: true, scope: sessionId ?? "global" });
});

router.post("/nova/kill/reset", (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) _sessionKills.delete(sessionId); else { _globalKilled = false; _sessionKills.clear(); }
  res.json({ ok: true, active: false });
});

router.get("/nova/kill/status", (_req, res) => {
  res.json({ active: _globalKilled, sessionKills: Array.from(_sessionKills) });
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
  res.json({ iq: Math.min(iq, 200), latencyMs, connected, totalMemory, successRate, toolCount: 78, sessions: autoSessions.size });
});

// ── GET /api/nova/sessions — list auto sessions ───────────────────────────────
router.get("/nova/sessions", (_req, res) => {
  const list = Array.from(autoSessions.values()).map(s => ({
    id: s.id, model: s.model, messageCount: s.messages.length, memoryCount: s.memory.length, createdAt: new Date(s.createdAt).toISOString()
  }));
  res.json({ sessions: list, count: list.length });
});

// ── GET /api/nova/sessions/:id/memory — session memory ───────────────────────
router.get("/nova/sessions/:id/memory", (req, res) => {
  const s = autoSessions.get(req.params.id);
  if (!s) { res.status(404).json({ error: "session not found" }); return; }
  res.json({ memory: s.memory, count: s.memory.length });
});

// ── DELETE /api/nova/sessions/:id — delete session ───────────────────────────
router.delete("/nova/sessions/:id", (req, res) => {
  autoSessions.delete(req.params.id);
  res.json({ ok: true });
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
    res.json({ path: abs, content: content.slice(0, 50_000), size: content.length });
  } catch (e: any) { res.status(404).json({ error: e.message }); }
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
    res.json({ ok: true, path: abs });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
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
    res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: dur });
  } catch (e: any) {
    const dur = Date.now() - t0;
    broadcastLiveEvent({ type: "shell_output", data: { command, output: (e.stderr || e.message || "").slice(0, 300), isError: true, durationMs: dur, ts: Date.now() }, ts: new Date().toISOString() });
    res.json({ ok: false, stdout: "", stderr: (e.stderr || e.message || String(e)).slice(0, 2000), durationMs: dur });
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
    logger.error({ err: e }, "nova auto-chat error");
    emit("error", { error: e.message ?? String(e) });
    broadcastLiveEvent({ type: "agent_alert", data: { title: "خطأ الوكيل", message: (e.message ?? "").slice(0,150), severity: "critical", ts: Date.now() }, ts: new Date().toISOString() });
  } finally { res.end(); }
});
