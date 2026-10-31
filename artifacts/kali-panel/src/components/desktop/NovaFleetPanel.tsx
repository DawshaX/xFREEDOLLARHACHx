import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, CheckCircle2, Circle, Clock, Cpu, HardDrive, Loader2,
  Monitor, Network, Play, RefreshCw, Server, ShieldCheck, Terminal,
  Wifi, WifiOff, AlertTriangle, ChevronRight, Copy, Download,
  Folder, FileText, Camera, Boxes, Gauge, Send, X,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════════════════════════════ */

const API = "/api";

type Agent = {
  id: string;
  hostname: string;
  platform: string;
  user: string;
  arch?: string;
  cpus?: number;
  totalMemory?: number;
  nodeVersion?: string;
  capabilities: string[];
  interfaces?: Record<string, string[]>;
  connectedAt: number;
};

function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} ثانية`;
  if (s < 3600) return `${Math.round(s / 60)} دقيقة`;
  if (s < 86400) return `${Math.round(s / 3600)} ساعة`;
  return `${Math.round(s / 86400)} يوم`;
}

function bytes(n?: number): string {
  if (!n) return "—";
  return n > 1 << 30 ? `${(n / (1 << 30)).toFixed(1)}GB` : `${Math.round(n / (1 << 20))}MB`;
}

const PLATFORM_ICON: Record<string, string> = { linux: "🐧", darwin: "🍎", win32: "🪟" };

/* ═══════════════════════════════════════════════════════════════════════════
   1) FLEET — every machine NOVA can reach
   ═══════════════════════════════════════════════════════════════════════════ */

export function NovaFleetPanel({ compact = false }: { compact?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<Array<{ kind: "cmd" | "out" | "err"; text: string }>>([]);
  const [running, setRunning] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/local-agent/agents`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { agents?: Agent[] };
      setAgents(json.agents ?? []);
      setError(null);
      setSelected((prev) => (prev && (json.agents ?? []).some((a) => a.id === prev) ? prev : json.agents?.[0]?.id ?? null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    outRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [output]);

  const exec = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd || running) return;
    const agentId = selected ?? agents[0]?.id;
    setCommand("");
    setOutput((p) => [...p, { kind: "cmd", text: `$ ${cmd}` }]);
    setRunning(true);
    try {
      const res = await fetch(`${API}/local-agent/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, agentId, timeout: 60000 }),
      });
      const json = (await res.json()) as { stdout?: string; stderr?: string; exitCode?: number };
      if (json.stdout) setOutput((p) => [...p, { kind: "out", text: json.stdout as string }]);
      if (json.stderr) setOutput((p) => [...p, { kind: "err", text: json.stderr as string }]);
      setOutput((p) => [...p, { kind: "out", text: `— exit ${json.exitCode ?? "?"}` }]);
    } catch (e) {
      setOutput((p) => [...p, { kind: "err", text: (e as Error).message }]);
    } finally {
      setRunning(false);
    }
  }, [agents, command, running, selected]);

  const installCmd = useMemo(() => {
    if (typeof window === "undefined") return "";
    const origin = window.location.origin;
    return `curl -fsSL ${origin}/api/local-agent/download-agent | bash -s -- --id my-machine`;
  }, []);

  const active = agents.find((a) => a.id === selected) ?? null;

  return (
    <div className="flex h-full flex-col gap-2 p-2 overflow-y-auto" dir="rtl">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-cyan-300">أجهزة نوفا</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${agents.length ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}>
            {agents.length} متصل
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => void load()} className="p-1 rounded border border-primary/20 hover:bg-primary/10" title="تحديث">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowInstall((v) => !v)}
            className="text-[9px] px-2 py-1 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
          >
            + ربط جهاز
          </button>
        </div>
      </div>

      {showInstall && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2 space-y-1.5">
          <p className="text-[9px] text-cyan-200/80">شغّل الأمر ده على أي جهاز (لينكس/ماك). يحتاج Node 18+ فقط:</p>
          <div className="flex items-center gap-1">
            <code dir="ltr" className="flex-1 text-[8px] font-mono bg-black/50 rounded p-1.5 overflow-x-auto whitespace-pre">{installCmd}</code>
            <button
              onClick={() => void navigator.clipboard?.writeText(installCmd)}
              className="p-1 rounded border border-white/10 hover:bg-white/5"
              title="نسخ"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <p className="text-[9px] text-cyan-200/60">
            ويندوز:{" "}
            <code dir="ltr" className="font-mono">
              powershell -c "iwr {typeof window !== "undefined" ? window.location.origin : ""}/api/local-agent/download-agent?platform=windows -O nova-agent.ps1; ./nova-agent.ps1"
            </code>
          </p>
          <p className="text-[9px] text-cyan-200/60">
            كل جهاز بمعرّف مختلف → تقدر توصل 10 وكلاء أو أكثر في نفس الوقت.
          </p>
        </div>
      )}

      {error && (
        <p className="text-[9px] text-red-300 border border-red-500/30 bg-red-500/10 rounded p-1.5">
          <AlertTriangle className="w-3 h-3 inline me-1" /> {error}
        </p>
      )}

      {/* agent grid */}
      {agents.length === 0 && !loading ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <WifiOff className="w-8 h-8 text-white/20" />
          <p className="text-[10px] text-white/50">مفيش جهاز متصل</p>
          <p className="text-[9px] text-white/30 max-w-[260px] leading-relaxed">
            اضغط «+ ربط جهاز» وشغّل الأمر على الجهاز — هيظهر هنا في ثواني، وتقدر تنفّذ عليه أوامر من الشات.
          </p>
        </div>
      ) : (
        <div className={`grid gap-1.5 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
          {agents.map((a) => {
            const isSel = a.id === selected;
            return (
              <button
                key={a.id}
                onClick={() => setSelected(a.id)}
                className={`text-start rounded-lg border p-2 transition-all ${
                  isSel ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px]">{PLATFORM_ICON[a.platform] ?? "💻"}</span>
                  <span className="text-[10px] font-semibold text-white/90 truncate">{a.hostname}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ms-auto" />
                </div>
                <p className="text-[8px] text-white/40 font-mono truncate" dir="ltr">
                  {a.user}@{a.hostname} · {a.arch ?? "?"} · {a.cpus ?? "?"} CPU · {bytes(a.totalMemory)}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[8px] text-white/35">
                  <span className="flex items-center gap-0.5"><Wifi className="w-2.5 h-2.5" />{ago(a.connectedAt)}</span>
                  <span className="flex items-center gap-0.5"><ShieldCheck className="w-2.5 h-2.5" />{a.capabilities.length} قدرة</span>
                  {a.id !== a.hostname && <span className="font-mono truncate">{a.id}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* quick actions for the selected machine */}
      {active && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-white/60">
              تحكم مباشر · <span className="font-mono text-cyan-300">{active.id}</span>
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setCommand("uname -a && whoami && df -h | head -5");
                }}
                className="text-[8px] px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/5"
              >
                معلومات
              </button>
              <button
                onClick={() => {
                  setCommand("ps aux --sort=-%cpu | head -12");
                }}
                className="text-[8px] px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/5"
              >
                عمليات
              </button>
              <button
                onClick={() => setOutput([])}
                className="text-[8px] px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/5"
              >
                مسح
              </button>
            </div>
          </div>

          <div ref={outRef} className="h-40 overflow-y-auto rounded bg-black/60 p-1.5 font-mono text-[8px] leading-relaxed" dir="ltr">
            {output.length === 0 && <span className="text-white/25">لا مخرجات بعد — اكتب أمر تحت</span>}
            {output.map((l, i) => (
              <pre
                key={i}
                className={`whitespace-pre-wrap ${l.kind === "cmd" ? "text-cyan-300" : l.kind === "err" ? "text-red-300" : "text-emerald-200/80"}`}
              >
                {l.text}
              </pre>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void exec();
            }}
            className="flex items-center gap-1"
          >
            <span className="text-[9px] text-emerald-400 font-mono">$</span>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="اكتب أمر… مثال: nmap -F scanme.nmap.org"
              dir="ltr"
              className="flex-1 bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[9px] font-mono outline-none focus:border-cyan-400/50"
            />
            <button
              type="submit"
              disabled={!command.trim() || running}
              className="p-1 rounded bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 disabled:opacity-40"
            >
              {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   2) PROJECT PULSE — what is running now / next / done
   ═══════════════════════════════════════════════════════════════════════════ */

type PulseEvent = {
  id: string;
  type: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "failed" | "info";
  ts: number;
  source: string;
};

const PULSE_LABEL: Record<string, string> = {
  tool_start: "أداة بدأت",
  tool_done: "أداة انتهت",
  tool_result: "نتيجة أداة",
  shell_output: "مخرجات أوامر",
  agent_alert: "تنبيه جهاز",
  memory_saved: "ذاكرة محفوظة",
  browser_screenshot: "لقطة شاشة",
  connection: "اتصال",
  exec_start: "تنفيذ بدأ",
  exec_result: "تنفيذ انتهى",
  agent_run_complete: "جولة وكيل",
};

export function NovaProjectPulse() {
  const [events, setEvents] = useState<PulseEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<{ memories: number; tools: number; brain: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "running" | "done">("all");
  const listRef = useRef<HTMLDivElement>(null);

  // live stream (SSE — works on both the server and the static build)
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        es = new EventSource(`${API}/live-events`);
        es.onopen = () => setConnected(true);
        es.onerror = () => {
          setConnected(false);
          es?.close();
          retry = setTimeout(connect, 4000);
        };
        es.onmessage = (m) => {
          try {
            const raw = JSON.parse(m.data) as { type?: string; data?: Record<string, unknown>; ts?: string };
            const type = raw.type ?? "event";
            const d = raw.data ?? {};
            const status: PulseEvent["status"] =
              /alert/.test(type) ? "info" : /(done|result|complete)/.test(type) ? "done" : /(start|exec_start)/.test(type) ? "running" : "info";
            const label =
              (typeof d.title === "string" && d.title) ||
              (typeof d.tool === "string" && String(d.tool)) ||
              (typeof d.command === "string" && String(d.command)) ||
              (typeof d.message === "string" && String(d.message)) ||
              PULSE_LABEL[type] ||
              type;
            const detail =
              (d.output as string) || (d.message as string) || (d.args ? JSON.stringify(d.args).slice(0, 120) : undefined);
            setEvents((prev) =>
              [
                {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  type,
                  label: String(label).slice(0, 110),
                  detail: detail ? String(detail).slice(0, 260) : undefined,
                  status,
                  ts: Date.now(),
                  source: typeof d.agent === "string" ? d.agent : typeof d.tool === "string" ? "tool" : "system",
                },
                ...prev,
              ].slice(0, 220),
            );
          } catch {
            /* keep-alive frame */
          }
        };
      } catch {
        setConnected(false);
      }
    };

    connect();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, []);

  // periodic snapshots: fleet + brain + memory
  useEffect(() => {
    const pull = async () => {
      try {
        const [aRes, sRes, mRes] = await Promise.all([
          fetch(`${API}/local-agent/agents`, { signal: AbortSignal.timeout(6000) }).catch(() => null),
          fetch(`${API}/nova-core/status`, { signal: AbortSignal.timeout(6000) }).catch(() => null),
          fetch(`${API}/nova-core/memory/stats`, { signal: AbortSignal.timeout(6000) }).catch(() => null),
        ]);
        if (aRes?.ok) setAgents(((await aRes.json()) as { agents?: Agent[] }).agents ?? []);
        const sJson = sRes?.ok ? ((await sRes.json()) as { brain?: { mode?: string }; tools?: number }) : null;
        const mJson = mRes?.ok ? ((await mRes.json()) as { total?: number }) : null;
        if (sJson) setStats({ memories: mJson?.total ?? 0, tools: sJson.tools ?? 0, brain: sJson.brain?.mode ?? "builtin" });
      } catch {
        /* ignore */
      }
    };
    void pull();
    const t = setInterval(() => void pull(), 12000);
    return () => clearInterval(t);
  }, []);

  const running = events.filter((e) => e.status === "running");
  const done = events.filter((e) => e.status === "done");
  const shown = filter === "running" ? running : filter === "done" ? done : events;

  return (
    <div className="flex h-full flex-col gap-2 p-2 overflow-y-auto" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className={`w-4 h-4 ${connected ? "text-emerald-400" : "text-amber-400"}`} />
          <span className="text-xs font-bold text-white/90">نبض المشروع</span>
          <span className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border ${connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}>
            {connected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
            {connected ? "بث حي" : "إعادة اتصال…"}
          </span>
        </div>
        <div className="flex gap-1">
          {(["all", "running", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[9px] px-2 py-0.5 rounded border ${
                filter === f ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200" : "border-white/10 text-white/50"
              }`}
            >
              {f === "all" ? `الكل ${events.length}` : f === "running" ? `شغّال ${running.length}` : `منجز ${done.length}`}
            </button>
          ))}
        </div>
      </div>

      {/* stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {[
          { icon: Play, label: "شغّال الآن", value: running.length, color: "#22d3ee" },
          { icon: CheckCircle2, label: "منجز", value: done.length, color: "#34d399" },
          { icon: Server, label: "أجهزة متصلة", value: agents.length, color: "#a78bfa" },
          { icon: Boxes, label: "أدوات نوفا", value: stats?.tools ?? 0, color: "#fbbf24" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-white/10 bg-white/[0.02] p-1.5">
            <p className="flex items-center gap-1 text-[8px] text-white/40">
              <s.icon className="w-2.5 h-2.5" style={{ color: s.color }} /> {s.label}
            </p>
            <p className="text-sm font-bold" style={{ color: s.color }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {stats && (
        <p className="text-[8px] text-white/35">
          العقل: <span className="text-cyan-300">{stats.brain === "llm" ? "نموذج لغوي" : "مدمج"}</span> · الذاكرة:{" "}
          <span className="text-violet-300">{stats.memories}</span> ذكرى محفوظة
        </p>
      )}

      {/* timeline */}
      <div ref={listRef} className="flex-1 min-h-[180px] space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-1.5">
        {shown.length === 0 && (
          <p className="py-8 text-center text-[10px] text-white/30">
            مفيش أحداث بعد — أي أداة تشتغل من الشات هتظهر هنا لحظياً
          </p>
        )}
        {shown.map((e) => (
          <div key={e.id} className="flex items-start gap-1.5 rounded border border-white/5 bg-white/[0.015] p-1.5">
            <span className="mt-0.5">
              {e.status === "running" ? (
                <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
              ) : e.status === "done" ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              ) : e.status === "failed" ? (
                <AlertTriangle className="w-3 h-3 text-red-400" />
              ) : (
                <Circle className="w-3 h-3 text-white/30" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] text-white/85 truncate">{e.label}</p>
              {e.detail && <p className="text-[8px] text-white/40 line-clamp-2 dir-ltr" dir="ltr">{e.detail}</p>}
            </div>
            <span className="shrink-0 text-[8px] text-white/25 font-mono">{ago(e.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   3) Compact widget for the dashboard
   ═══════════════════════════════════════════════════════════════════════════ */

export function NovaFleetWidget({ onOpen }: { onOpen?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => {
    const pull = async () => {
      try {
        const r = await fetch(`${API}/local-agent/agents`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) setAgents(((await r.json()) as { agents?: Agent[] }).agents ?? []);
      } catch {
        /* offline */
      }
    };
    void pull();
    const t = setInterval(() => void pull(), 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <button
      onClick={onOpen}
      className="w-full text-start rounded-xl border border-white/10 bg-white/[0.02] p-2 hover:border-cyan-400/40 transition"
      dir="rtl"
    >
      <div className="flex items-center gap-1.5">
        <Server className="w-3 h-3 text-cyan-400" />
        <span className="text-[10px] font-semibold text-white/80">أجهزة نوفا</span>
        <span className={`ms-auto text-[9px] px-1.5 rounded-full ${agents.length ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/40"}`}>
          {agents.length}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {agents.slice(0, 5).map((a) => (
          <span key={a.id} className="text-[8px] font-mono px-1 rounded bg-black/40 text-white/50">
            {PLATFORM_ICON[a.platform] ?? "💻"} {a.hostname}
          </span>
        ))}
        {agents.length === 0 && <span className="text-[8px] text-white/30">مفيش جهاز متصل</span>}
      </div>
    </button>
  );
}
