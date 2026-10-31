/**
 * NovaFleetLive — the permanent, free WebSocket link between the panel and the
 * whole program.
 *
 * One socket per browser tab, opened once at app level and never torn down by
 * navigation. It carries:
 *   • `fleet`   — every connected machine (CPU / arch / RAM / uptime / tools)
 *   • `task`    — what is running right now, what finished, what is next
 *   • `event`   — the raw live-event feed from the server
 *
 * It also drives a REST fallback (polling `/api/local-agent/agents`) so the UI
 * still shows the truth when the socket is briefly down. Nothing here is paid
 * or third-party: it is the same free WS endpoint the device agents use.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { getRemoteBase, remoteWsUrl } from "@/lib/remote";

export interface FleetMachine {
  id: string;
  hostname?: string;
  platform?: string;
  arch?: string;
  user?: string;
  connectedAt?: number;
  lastSeen?: number;
  tools?: number;
  cpu?: number;
  ramUsed?: number;
  ramTotal?: number;
  uptime?: number;
  readOnly?: boolean;
}

export interface NovaTask {
  id: string;
  title: string;
  status: "running" | "done" | "failed" | "queued";
  tool?: string;
  target?: string;
  startedAt: number;
  endedAt?: number;
  ms?: number;
}

export interface NovaEvent {
  id: string;
  at: number;
  kind: string;
  level?: "info" | "warn" | "error" | "ok";
  message: string;
}

export type NovaSocketState = "connecting" | "open" | "closed";

const API = "/api";
const MAX_EVENTS = 120;
const MAX_TASKS = 40;

function apiBase(): string {
  return `${API}/local-agent`;
}

function wsUrl(): string {
  // A linked NOVA server owns the realtime channel. Without one we still try
  // same-origin, and the UI reports the truth instead of a fake green dot.
  try {
    const remote = getRemoteBase();
    if (remote) return remoteWsUrl(`/api/ws`);
  } catch {
    /* fall through to same-origin */
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${proto}//${location.host}${base}${API}/ws`.replace(/([^:])\/+/g, "$1/");
}

/* ────────────────────────────── store ────────────────────────────── */

interface NovaLinkState {
  socket: NovaSocketState;
  machines: FleetMachine[];
  running: NovaTask[];
  done: NovaTask[];
  next: NovaTask[];
  events: NovaEvent[];
  toolsRun: number;
  brainMode: string;
  memoryCount: number;
  lastBeat: number;
  /** Did this session ever have a working socket? Distinguishes "offline" from "static build". */
  everOpened: boolean;
}

const initial: NovaLinkState = {
  socket: "connecting",
  machines: [],
  running: [],
  done: [],
  next: [],
  events: [],
  toolsRun: 0,
  brainMode: "—",
  memoryCount: 0,
  lastBeat: 0,
  everOpened: false,
};

let state: NovaLinkState = initial;
const listeners = new Set<(s: NovaLinkState) => void>();
let started = false;

function publish(patch: Partial<NovaLinkState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

function pushEvent(ev: Omit<NovaEvent, "id"> & { id?: string }) {
  const item: NovaEvent = { ...ev, id: ev.id ?? `${ev.at}-${Math.random().toString(36).slice(2, 8)}` };
  const events = [item, ...state.events].slice(0, MAX_EVENTS);
  publish({ events });
}

function upsertTask(task: NovaTask) {
  const running = state.running.filter((t) => t.id !== task.id);
  const done = state.done.filter((t) => t.id !== task.id);
  if (task.status === "running" || task.status === "queued") {
    running.unshift(task);
    publish({ running: running.slice(0, MAX_TASKS) });
  } else {
    done.unshift(task);
    publish({ running: running.slice(0, MAX_TASKS), done: done.slice(0, MAX_TASKS) });
  }
}

export function getNovaLink(): NovaLinkState {
  return state;
}

/* ────────────────────────────── socket ────────────────────────────── */

function ingest(payload: any) {
  if (!payload || typeof payload !== "object") return;
  const type = String(payload.type ?? payload.kind ?? "");
  publish({ lastBeat: Date.now() });

  if (type === "fleet" || type === "agents" || Array.isArray(payload.agents)) {
    const machines: FleetMachine[] = (payload.agents ?? []).map((a: any) => ({
      id: a.id ?? a.agentId,
      hostname: a.hostname,
      platform: a.platform,
      arch: a.arch,
      user: a.user,
      connectedAt: a.connectedAt,
      lastSeen: a.lastSeen,
      tools: a.tools ?? a.toolCount,
      cpu: a.cpu,
      ramUsed: a.ramUsed,
      ramTotal: a.ramTotal,
      uptime: a.uptime,
      readOnly: a.readOnly,
    }));
    publish({ machines });
    return;
  }

  if (type === "task" || type === "task_update") {
    upsertTask({
      id: String(payload.id ?? payload.taskId),
      title: String(payload.title ?? payload.name ?? "مهمة"),
      status: payload.status ?? "running",
      tool: payload.tool,
      target: payload.target,
      startedAt: payload.startedAt ?? Date.now(),
      endedAt: payload.endedAt,
      ms: payload.ms,
    });
    return;
  }

  if (type === "agent_tool_result" || type === "tool" || type === "tool_result") {
    publish({ toolsRun: state.toolsRun + 1 });
  }

  if (type === "task_start" || type === "task_done" || type === "task_failed") {
    upsertTask({
      id: String(payload.id ?? payload.taskId ?? `${type}-${Date.now()}`),
      title: String(payload.title ?? payload.name ?? payload.tool ?? "مهمة"),
      status: type === "task_start" ? "running" : type === "task_done" ? "done" : "failed",
      tool: payload.tool,
      target: payload.target,
      startedAt: payload.startedAt ?? Date.now(),
      endedAt: payload.endedAt,
      ms: payload.ms,
    });
  }

  const message =
    payload.message ??
    payload.text ??
    payload.summary ??
    (type === "agent_tool_result"
      ? `${payload.tool ?? "أداة"} ${payload.ok ? "نجحت" : "فشلت"}`
      : type === "local_agent_status"
        ? `الأسطول اتحدّث: ${(payload.agents ?? []).length} جهاز`
        : undefined);
  if (message) {
    pushEvent({
      at: payload.at ?? Date.now(),
      kind: type || "live",
      level: payload.level ?? "info",
      message: String(message).slice(0, 400),
    });
  }
}

let retry = 0;
let socket: WebSocket | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];

async function refreshFleet() {
  try {
    const r = await fetch(`${apiBase()}/agents`, { headers: { accept: "application/json" } });
    if (!r.ok) return;
    const j = await r.json();
    ingest({ type: "fleet", agents: Array.isArray(j) ? j : (j.agents ?? []) });
  } catch {
    /* offline: keep last known truth */
  }
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  publish({ socket: "connecting" });
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    publish({ socket: "closed" });
    return;
  }
  socket = ws;

  ws.onopen = () => {
    retry = 0;
    publish({ socket: "open", everOpened: true });
    pushEvent({ at: Date.now(), kind: "link", level: "ok", message: "اتصال مباشر دائم اتفتح مع المنصة" });
    void refreshFleet();
  };

  ws.onmessage = (e) => {
    try {
      ingest(JSON.parse(e.data));
    } catch {
      pushEvent({ at: Date.now(), kind: "raw", level: "info", message: String(e.data).slice(0, 200) });
    }
  };

  ws.onclose = () => {
    publish({ socket: "closed" });
    retry = Math.min(retry + 1, 6);
    const delay = Math.min(1000 * 2 ** (retry - 1), 15000);
    timers.push(setTimeout(connect, delay));
  };

  ws.onerror = () => publish({ socket: "closed" });
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  connect();
  // The socket is permanent, so these only backstop gaps in the feed.
  timers.push(setInterval(refreshFleet, 5000));
  timers.push(
    setInterval(() => {
      if (socket && socket.readyState !== WebSocket.OPEN) connect();
    }, 20000),
  );
}

if (typeof window !== "undefined") start();

/* ────────────────────────────── hook ────────────────────────────── */

export function useNovaLive() {
  const [snap, setSnap] = useState<NovaLinkState>(getNovaLink());
  useEffect(() => {
    listeners.add(setSnap);
    setSnap(getNovaLink());
    return () => {
      listeners.delete(setSnap);
    };
  }, []);
  return snap;
}

/** Publish a local action (a tool the UI just ran) into the shared feed. */
export const novaLog = pushEvent;
export const novaTask = upsertTask;

/* ────────────────────────────── UI ────────────────────────────── */

/**
 * A single strip that proves the link is live: socket state, machines online,
 * what is running now, what just finished, and the newest events — all fed by
 * the permanent socket, never by a mock.
 */
export function NovaLiveBar({ onOpen }: { onOpen?: () => void }) {
  const live = useNovaLive();
  const dot =
    live.socket === "open"
      ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
      : live.socket === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-red-500";
  const label =
    live.socket === "open"
      ? "اتصال مباشر دائم"
      : live.socket === "connecting"
        ? "بيتصل…"
        : live.everOpened
          ? "انقطع — بيعيد المحاولة تلقائياً"
          : "مفيش سيرفر مباشر (وضع ثابت) — شغّل الخادم عشان الأسطول يشتغل";

  return (
    <div className="rounded-xl p-3 border border-white/10" style={{ background: "rgba(16,185,129,0.05)" }}>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <span className="text-[11px] font-black text-emerald-300">{label}</span>
          <span className="text-[9px] font-mono text-white/40">WS /api/ws</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-white/60">أجهزة <b className="text-emerald-300">{live.machines.length}</b></span>
          <span className="text-white/60">شغّال <b className="text-amber-300">{live.running.length}</b></span>
          <span className="text-white/60">خلص <b className="text-sky-300">{live.done.length}</b></span>
          <span className="text-white/60">أدوات <b className="text-fuchsia-300">{live.toolsRun}</b></span>
          {onOpen && (
            <button onClick={onOpen} className="px-2 py-0.5 rounded-lg text-[9px] font-black bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 border border-emerald-500/40">
              افتح نوفا
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="rounded-lg p-2 bg-black/30 border border-white/5">
          <div className="text-[9px] font-black text-amber-300 mb-1">شغّال دلوقتي</div>
          {live.running.length === 0 ? (
            <div className="text-[9px] text-white/35">مفيش حاجة شغالة</div>
          ) : (
            live.running.slice(0, 3).map((t) => (
              <div key={t.id} className="text-[9px] text-white/75 truncate">
                ⏳ {t.title} {t.tool ? <span className="text-white/35">· {t.tool}</span> : null}
              </div>
            ))
          )}
        </div>
        <div className="rounded-lg p-2 bg-black/30 border border-white/5">
          <div className="text-[9px] font-black text-sky-300 mb-1">خلص</div>
          {live.done.length === 0 ? (
            <div className="text-[9px] text-white/35">لسه مفيش</div>
          ) : (
            live.done.slice(0, 3).map((t) => (
              <div key={t.id} className="text-[9px] text-white/75 truncate">
                {t.status === "failed" ? "❌" : "✅"} {t.title}
                {t.ms != null ? <span className="text-white/30"> · {t.ms}ms</span> : null}
              </div>
            ))
          )}
        </div>
        <div className="rounded-lg p-2 bg-black/30 border border-white/5">
          <div className="text-[9px] font-black text-white/60 mb-1">آخر الأحداث</div>
          {live.events.length === 0 ? (
            <div className="text-[9px] text-white/35">مستني أول حدث…</div>
          ) : (
            live.events.slice(0, 3).map((e) => (
              <div key={e.id} className="text-[9px] text-white/60 truncate" title={e.message}>
                · {e.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
