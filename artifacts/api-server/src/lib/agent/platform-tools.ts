/**
 * NOVA — Platform Tools (أدوات المنصة)
 * ────────────────────────────────────────────────────────────────────────────
 * The tools that let NOVA act on the platform itself rather than only on the
 * internet: read its own measured state, drive the panel, run commands on a
 * connected node, and read/write files there.
 *
 * Why a separate module: `tools.ts` is the security-tool registry (recon, intel,
 * memory, mission). These are *platform* tools — they answer "what am I, right
 * now" and "do this on the machine". Keeping them apart means the self-report
 * can be imported by the claim guard and the persona without dragging the whole
 * recon registry (and its network stack) into every call site.
 *
 * Every number returned here is MEASURED at call time from the live registries.
 * Nothing is cached, nothing is typed by hand. That is the whole point: the
 * transcript that started this work had the agent quote «3 ماكينة» while the
 * fleet page showed zero, because a number was remembered instead of measured.
 */

import { buildSelfModel } from "./self-model";
import { getConnectedAgentList, getAgentDeepProfile, execOnLocalAgent } from "../../routes/local-agent";
import { listMemories, memoryStats } from "./memory-store";
import { broadcastEvent } from "../ws-hub";

export interface PlatformToolResult {
  ok: boolean;
  summary: string;
  data: unknown;
  ms: number;
}

/* ── platform_self_report ─────────────────────────────────────────────────── */

/**
 * The measured state of every part of the platform, in one object.
 *
 * This is the tool the agent must call before saying anything about its own
 * capabilities. It is also what the claim guard compares a reply against, so
 * the two can never disagree.
 */
export function platformSelfReport(): PlatformToolResult {
  const started = Date.now();
  const m = buildSelfModel();

  const agents = getConnectedAgentList();
  const deep = agents.length ? getAgentDeepProfile(agents[0].id) : null;

  const data = {
    measuredAt: new Date().toISOString(),
    fleet: {
      connected: m.machines.connected,
      registered: m.machines.registered,
      connectedNames: m.machines.connectedNames,
      registeredNames: m.machines.names,
      // The distinction that was lost on the live slot, stated explicitly so a
      // reader (human or model) cannot conflate them again.
      note: "connected = WebSocket مفتوح الآن · registered = موجود في السجل بس مش متصل",
    },
    tools: {
      count: m.tools.count,
      byCategory: m.tools.byCategory,
    },
    corpus: {
      measured: m.corpus.measured,
      total: m.corpus.total,
      ageMin: m.corpus.ageMin,
    },
    memory: {
      total: m.memory.total,
      stats: (() => {
        try {
          return memoryStats();
        } catch {
          return null;
        }
      })(),
    },
    node: deep
      ? {
          hostname: deep.system?.hostname,
          platform: deep.system?.platform,
          arch: deep.system?.arch,
          cpus: deep.system?.cpus?.count,
          totalMemMb: deep.system?.memory ? Math.round(deep.system.memory.total / 1024 / 1024) : null,
          uptimeSec: deep.system?.uptime ?? null,
          toolCount: deep.toolCount,
          docker: deep.docker ?? null,
        }
      : null,
    capabilities: {
      canExecuteOnNode: agents.length > 0,
      canReadWriteFiles: agents.length > 0,
      // Stated, not hidden: this image has neither, and the agent must say so
      // rather than promise a capability it cannot deliver.
      canBrowse: false,
      canRunDocker: Boolean(deep?.docker),
    },
  };

  const summary = agents.length
    ? `حالة المنصة: ${m.machines.connected} جهاز متصل · ${m.tools.count} أداة · ${m.memory.total} ذكرى`
    : `حالة المنصة: صفر جهاز متصل (${m.machines.registered} مسجّل) · ${m.tools.count} أداة · ${m.memory.total} ذكرى`;

  return { ok: true, summary, data, ms: Date.now() - started };
}

/* ── terminal_exec ────────────────────────────────────────────────────────── */

/**
 * Run a command on a connected node and return its real output.
 *
 * When no node is connected this returns `ok:false` with the reason — it does
 * NOT pretend to have run anything. The self-node (registered by
 * `routes/local-agent.ts`) means there is normally at least one node, so this
 * works out of the box on a fresh deploy.
 */
export async function terminalExec(
  command: string,
  agentId?: string,
  timeoutMs = 30_000,
): Promise<PlatformToolResult> {
  const started = Date.now();
  const cmd = String(command ?? "").trim();
  if (!cmd) return { ok: false, summary: "الأمر فاضي", data: null, ms: Date.now() - started };

  const agents = getConnectedAgentList();
  if (agents.length === 0) {
    return {
      ok: false,
      summary: "مفيش جهاز متصل — التنفيذ محتاج عقدة (شغّل nova-agent.js أو فعّل العقدة الذاتية)",
      data: { connected: 0, registered: buildSelfModel().machines.registered },
      ms: Date.now() - started,
    };
  }

  const res = await execOnLocalAgent(cmd, agentId, timeoutMs);
  if (!res) {
    return { ok: false, summary: "العقدة ما ردّتش في الوقت المحدد", data: null, ms: Date.now() - started };
  }

  const out = (res.stdout || "").trim();
  const err = (res.stderr || "").trim();
  const ok = res.exitCode === 0;
  return {
    ok,
    summary: ok
      ? `نفّذت الأمر على العقدة (exit 0 · ${res.durationMs}ms)${out ? `: ${out.slice(0, 160)}` : ""}`
      : `الأمر رجع exit ${res.exitCode}${err ? `: ${err.slice(0, 160)}` : ""}`,
    data: {
      command: cmd,
      stdout: out.slice(0, 8000),
      stderr: err.slice(0, 4000),
      exitCode: res.exitCode,
      durationMs: res.durationMs,
    },
    ms: Date.now() - started,
  };
}

/* ── file_read / file_write / file_list ───────────────────────────────────── */

/** Read a file on the connected node (via `cat`, bounded). */
export async function fileRead(path: string, agentId?: string): Promise<PlatformToolResult> {
  const started = Date.now();
  const p = String(path ?? "").trim();
  if (!p) return { ok: false, summary: "المسار مطلوب", data: null, ms: Date.now() - started };
  const res = await terminalExec(`cat -- ${JSON.stringify(p)} | head -c 200000`, agentId, 20_000);
  const stdout = String((res.data as { stdout?: string } | null)?.stdout ?? "");
  return {
    ok: res.ok,
    summary: res.ok ? `قرأت ${p} (${stdout.length} حرف)` : `فشل قراءة ${p}`,
    data: res.data,
    ms: Date.now() - started,
  };
}

/** Write a file on the connected node (base64 → decode, so no shell quoting bugs). */
export async function fileWrite(path: string, content: string, agentId?: string): Promise<PlatformToolResult> {
  const started = Date.now();
  const p = String(path ?? "").trim();
  if (!p) return { ok: false, summary: "المسار مطلوب", data: null, ms: Date.now() - started };
  const b64 = Buffer.from(String(content ?? ""), "utf8").toString("base64");
  const res = await terminalExec(
    `mkdir -p -- "$(dirname -- ${JSON.stringify(p)})" && printf '%s' ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(p)} && wc -c < ${JSON.stringify(p)}`,
    agentId,
    20_000,
  );
  return {
    ok: res.ok,
    summary: res.ok ? `كتبت ${p}` : `فشل كتابة ${p}`,
    data: res.data,
    ms: Date.now() - started,
  };
}

/** List a directory on the connected node. */
export async function fileList(path = ".", agentId?: string): Promise<PlatformToolResult> {
  const started = Date.now();
  const p = String(path ?? ".").trim() || ".";
  const res = await terminalExec(`ls -la -- ${JSON.stringify(p)} | head -200`, agentId, 15_000);
  return {
    ok: res.ok,
    summary: res.ok ? `محتويات ${p}` : `فشل سرد ${p}`,
    data: res.data,
    ms: Date.now() - started,
  };
}

/* ── process_list / service_status ────────────────────────────────────────── */

export async function processList(agentId?: string): Promise<PlatformToolResult> {
  const started = Date.now();
  const res = await terminalExec("ps -eo pid,ppid,pcpu,pmem,etime,comm --sort=-pcpu | head -40", agentId, 15_000);
  return { ok: res.ok, summary: res.ok ? "أهم 40 عملية" : "فشل سرد العمليات", data: res.data, ms: Date.now() - started };
}

export async function serviceStatus(name: string, agentId?: string): Promise<PlatformToolResult> {
  const started = Date.now();
  const n = String(name ?? "").trim();
  if (!n) return { ok: false, summary: "اسم الخدمة مطلوب", data: null, ms: Date.now() - started };
  const res = await terminalExec(
    `(systemctl is-active ${JSON.stringify(n)} 2>/dev/null || echo unknown) ; (pgrep -af ${JSON.stringify(n)} | head -5 || true)`,
    agentId,
    15_000,
  );
  return { ok: res.ok, summary: res.ok ? `حالة ${n}` : `فشل فحص ${n}`, data: res.data, ms: Date.now() - started };
}

/* ── ui_navigate / ui_action ──────────────────────────────────────────────── */

/**
 * Ask the panel to open a page. Broadcast over the same WebSocket hub the UI
 * already listens on, so no new transport is introduced.
 */
export function uiNavigate(path: string): PlatformToolResult {
  const started = Date.now();
  const p = String(path ?? "").trim();
  if (!p) return { ok: false, summary: "المسار مطلوب", data: null, ms: Date.now() - started };
  broadcastEvent("nova:ui", { action: "navigate", path: p, at: Date.now() });
  return { ok: true, summary: `طلبت من اللوحة تفتح ${p}`, data: { path: p }, ms: Date.now() - started };
}

/** Ask the panel to perform a named action (run a scan, toggle a setting…). */
export function uiAction(action: string, payload: Record<string, unknown> = {}): PlatformToolResult {
  const started = Date.now();
  const a = String(action ?? "").trim();
  if (!a) return { ok: false, summary: "اسم الإجراء مطلوب", data: null, ms: Date.now() - started };
  broadcastEvent("nova:ui", { action: a, payload, at: Date.now() });
  return { ok: true, summary: `طلبت من اللوحة تنفيذ «${a}»`, data: { action: a, payload }, ms: Date.now() - started };
}

/* ── memory_recall (convenience over the durable store) ───────────────────── */

export function memoryRecall(limit = 10): PlatformToolResult {
  const started = Date.now();
  const res = listMemories({ limit: Math.min(Number(limit) || 10, 50), sort: "recent" });
  return {
    ok: true,
    summary: `آخر ${res.items.length} ذكرى من ${res.total}`,
    data: res,
    ms: Date.now() - started,
  };
}

/* ── tool catalogue ───────────────────────────────────────────────────────── */

/** Names of the platform tools, for the persona's capability list. */
export const PLATFORM_TOOL_NAMES = [
  "platform_self_report",
  "terminal_exec",
  "file_read",
  "file_write",
  "file_list",
  "process_list",
  "service_status",
  "ui_navigate",
  "ui_action",
  "memory_recall",
] as const;

/** How many platform tools exist (the security registry is counted separately). */
export function platformToolCount(): number {
  return PLATFORM_TOOL_NAMES.length;
}
