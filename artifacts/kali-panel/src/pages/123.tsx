import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  BellRing,
  BookMarked,
  Bot,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  Folder,
  Globe,
  HardDrive,
  KeyRound,
  Monitor as MonitorIcon,
  Network,
  ScanLine,
  Server,
  Settings as SettingsIcon,
  Skull,
  Sparkles,
  Terminal as TerminalIcon,
  X,
  Zap,
} from "lucide-react";
import { DraggableWindow, type WindowState } from "@/components/desktop/DraggableWindow";
import { BrowserWindow } from "@/components/desktop/BrowserWindow";
import { TerminalWindow } from "@/components/desktop/TerminalWindow";
import { ScannerWindow } from "@/components/desktop/ScannerWindow";
import { AgentWindow, type ClientToolEvent } from "@/components/desktop/AgentWindow";
import { FilesWindow } from "@/components/desktop/FilesWindow";
import { NodesWindow } from "@/components/desktop/NodesWindow";
import { LiveAgentPanel } from "@/components/desktop/LiveAgentPanel";

type WinKind =
  | "browser"
  | "terminal"
  | "scanner"
  | "agent"
  | "agent_v3"
  | "nodes"
  | "files"
  | "kaligpt"
  | "monitor"
  | "settings"
  | "playbooks"
  | "editor";

interface WinInst extends WindowState {
  kind: WinKind;
  payload?: { url?: string; command?: string; target?: string };
}

const APPS: Array<{
  kind: WinKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hue: string;
  desc: string;
}> = [
  { kind: "browser", label: "متصفح", icon: Globe, hue: "from-cyan-400/30 to-blue-500/10", desc: "تصفح أي موقع داخل النظام" },
  { kind: "terminal", label: "Terminal", icon: TerminalIcon, hue: "from-emerald-400/30 to-emerald-600/10", desc: "أوامر bash حقيقية" },
  { kind: "scanner", label: "Scanner", icon: ScanLine, hue: "from-fuchsia-400/30 to-purple-600/10", desc: "DNS · ports · SSL · headers" },
  { kind: "agent", label: "Agent", icon: Sparkles, hue: "from-amber-400/30 to-orange-600/10", desc: "وكيل ذكي يفتح النوافذ بنفسه" },
  { kind: "agent_v3", label: "AI Agent v3", icon: Bot, hue: "from-orange-400/30 to-rose-600/10", desc: "مخطط مهام ذاتي ينفّذ خطوات" },
  { kind: "nodes", label: "Nodes", icon: Server, hue: "from-indigo-400/30 to-purple-600/10", desc: "خوادم SSH متعددة + ping حي" },
  { kind: "files", label: "ملفات", icon: Folder, hue: "from-sky-400/30 to-sky-600/10", desc: "تخزين ورفع وتحميل" },
  { kind: "kaligpt", label: "KaliGPT", icon: Skull, hue: "from-red-400/30 to-rose-600/10", desc: "خبير الأمن الهجومي" },
  { kind: "monitor", label: "Monitor", icon: Activity, hue: "from-lime-400/30 to-emerald-600/10", desc: "مراقبة العمليات الحية" },
  { kind: "playbooks", label: "Playbooks", icon: BookMarked, hue: "from-violet-400/30 to-indigo-600/10", desc: "خطط تنفيذية محفوظة + ذاتية" },
  { kind: "editor", label: "Editor", icon: FileCode2, hue: "from-teal-400/30 to-cyan-600/10", desc: "محرر الأكواد والملفات" },
  { kind: "settings", label: "Settings", icon: SettingsIcon, hue: "from-slate-400/30 to-slate-600/10", desc: "المفاتيح + المزودين + التحكم" },
];

interface NotifItem {
  id: number;
  level: "info" | "warning" | "critical" | "error";
  source: string | null;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

let zCounter = 10;

export default function Desktop() {
  const [, navigate] = useLocation();
  const [wins, setWins] = useState<WinInst[]>([]);
  const [now, setNow] = useState(new Date());
  const [stats, setStats] = useState({ procs: 0, ram: 0, cpu: 0, net: "—" });
  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [activeTasks, setActiveTasks] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const apiBase = "/api";

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live stats (process count + simulated CPU/RAM gauges keyed off browser perf)
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/processes");
        const arr = (await res.json()) as Array<{ status: string }>;
        const running = arr.filter((p) => p.status === "running").length;
        if (!active) return;
        setStats((s) => ({
          ...s,
          procs: arr.length,
          cpu: Math.min(99, 12 + running * 7 + Math.floor(Math.random() * 6)),
          ram: Math.min(96, 28 + running * 4 + Math.floor(Math.random() * 4)),
          net: navigator.onLine ? "ONLINE" : "OFFLINE",
        }));
      } catch {
        if (active) setStats((s) => ({ ...s, net: "OFFLINE" }));
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Live notifications + active task counter
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const [alertsRes, tasksRes] = await Promise.all([
          fetch(`${apiBase}/bot/alerts?limit=20`),
          fetch(`${apiBase}/agent/tasks`),
        ]);
        if (alertsRes.ok) {
          const data = (await alertsRes.json()) as NotifItem[];
          if (active) setNotifs(data);
        }
        if (tasksRes.ok) {
          const tasks = (await tasksRes.json()) as Array<{ status: string }>;
          if (active)
            setActiveTasks(
              tasks.filter((t) => t.status === "running" || t.status === "pending").length,
            );
        }
      } catch {
        /* offline */
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [apiBase]);

  const unreadCount = notifs.filter((n) => !n.read).length;

  const markAllRead = async () => {
    try {
      await fetch(`${apiBase}/bot/alerts/read-all`, { method: "PUT" });
      setNotifs((arr) => arr.map((n) => ({ ...n, read: true })));
    } catch {
      /* ignore */
    }
  };

  const dismissNotif = async (id: number) => {
    setNotifs((arr) => arr.filter((n) => n.id !== id));
    try {
      await fetch(`${apiBase}/bot/alerts/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  };

  const openWindow = useCallback(
    (kind: WinKind, payload?: WinInst["payload"], titleOverride?: string) => {
      setWins((arr) => {
        const existing = arr.find((w) => w.kind === kind);
        const surface = surfaceRef.current;
        const sw = surface ? surface.clientWidth : 1100;
        const sh = surface ? surface.clientHeight : 700;
        if (existing) {
          // reuse: focus + update payload
          return arr.map((w) =>
            w.id === existing.id
              ? {
                  ...w,
                  z: ++zCounter,
                  minimized: false,
                  payload: payload ?? w.payload,
                }
              : w,
          );
        }
        const idx = arr.length;
        const w = Math.min(820, Math.max(420, sw - 80 - idx * 30));
        const h = Math.min(560, Math.max(320, sh - 140 - idx * 30));
        const x = 40 + idx * 32;
        const y = 30 + idx * 28;
        const app = APPS.find((a) => a.kind === kind);
        return [
          ...arr,
          {
            id: `${kind}-${Date.now()}`,
            kind,
            title: titleOverride ?? app?.label ?? kind,
            x,
            y,
            w,
            h,
            z: ++zCounter,
            minimized: false,
            maximized: false,
            payload,
          },
        ];
      });
    },
    [],
  );

  const focusWindow = (id: string) =>
    setWins((arr) => arr.map((w) => (w.id === id ? { ...w, z: ++zCounter } : w)));
  const closeWindow = (id: string) =>
    setWins((arr) => arr.filter((w) => w.id !== id));
  const minimize = (id: string) =>
    setWins((arr) => arr.map((w) => (w.id === id ? { ...w, minimized: true } : w)));
  const maximize = (id: string) =>
    setWins((arr) =>
      arr.map((w) =>
        w.id === id ? { ...w, maximized: !w.maximized, minimized: false } : w,
      ),
    );
  const move = (id: string, x: number, y: number) =>
    setWins((arr) => arr.map((w) => (w.id === id ? { ...w, x, y } : w)));
  const resize = (id: string, ww: number, hh: number) =>
    setWins((arr) => arr.map((w) => (w.id === id ? { ...w, w: ww, h: hh } : w)));

  // Handle UI tool events from Live Agent
  const handleClientTool = useCallback(
    (e: ClientToolEvent) => {
      const i = e.input || {};
      switch (e.name) {
        case "ui_open_window": {
          const kind = String(i.window || "").toLowerCase() as WinKind;
          if (APPS.some((a) => a.kind === kind))
            openWindow(kind, undefined, String(i.title || ""));
          break;
        }
        case "ui_browse_url":
          openWindow("browser", { url: String(i.url || "https://www.google.com") });
          break;
        case "ui_run_terminal":
          openWindow("terminal", { command: String(i.command || "") });
          break;
        case "ui_start_scanner":
          openWindow("scanner", { target: String(i.target || "") });
          break;
        case "ui_show_page": {
          const page = String(i.page || "").replace(/^\//, "");
          if (page) navigate(`/${page}`);
          break;
        }
        case "ui_focus_window": {
          const kind = String(i.window || "").toLowerCase() as WinKind;
          const w = wins.find((x) => x.kind === kind);
          if (w) focusWindow(w.id);
          break;
        }
        case "ui_close_window": {
          const kind = String(i.window || "").toLowerCase() as WinKind;
          const w = wins.find((x) => x.kind === kind);
          if (w) closeWindow(w.id);
          break;
        }
        default:
          break;
      }
    },
    [openWindow, navigate, wins],
  );

  const renderBody = (w: WinInst) => {
    switch (w.kind) {
      case "browser":
        return (
          <BrowserWindow
            initialUrl={w.payload?.url ?? "https://www.google.com"}
          />
        );
      case "terminal":
        return <TerminalWindow {...(w.payload?.command ? { initialCommand: w.payload.command } : {})} />;
      case "scanner":
        return <ScannerWindow {...(w.payload?.target ? { initialTarget: w.payload.target } : {})} />;
      case "agent":
        return <AgentWindow onClientTool={handleClientTool} />;
      case "agent_v3":
        return (
          <iframe
            title="AI Agent v3"
            className="w-full h-full bg-background"
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/agent`}
          />
        );
      case "nodes":
        return <NodesWindow />;
      case "files":
        return <FilesWindow />;
      case "kaligpt":
        return (
          <iframe
            title="KaliGPT"
            className="w-full h-full bg-background"
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/kaligpt`}
          />
        );
      case "monitor":
        return (
          <iframe
            title="Monitor"
            className="w-full h-full bg-background"
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/monitor`}
          />
        );
      case "settings":
        return (
          <iframe
            title="Settings"
            className="w-full h-full bg-background"
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/settings`}
          />
        );
      case "playbooks":
        return (
          <iframe
            title="Playbooks"
            className="w-full h-full bg-background"
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/playbooks`}
          />
        );
      case "editor":
        return (
          <iframe
            title="Editor"
            className="w-full h-full bg-background"
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/files`}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="-m-6 h-[calc(100vh-3.5rem)] relative overflow-hidden grid-bg">
      {/* Top status bar (matches desktop screenshot) */}
      <div className="absolute top-0 inset-x-0 z-20 h-10 px-4 flex items-center justify-between bg-card/60 backdrop-blur-md border-b border-primary/20 text-[11px] font-mono">
        <div className="flex items-center gap-3 text-primary/80">
          <MonitorIcon className="w-4 h-4 text-primary" />
          <span className="font-bold">CyberNova OS</span>
          <span className="text-muted-foreground">
            {now.toLocaleString("en-GB", { hour12: false })}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Stat icon={Network} label="NET" value={stats.net} ok={stats.net === "ONLINE"} />
          <Stat icon={HardDrive} label="RAM" value={`${stats.ram}%`} ok={stats.ram < 80} />
          <Stat icon={Cpu} label="CPU" value={`${stats.cpu}%`} ok={stats.cpu < 80} />
          <Stat icon={Database} label="PROCS" value={String(stats.procs)} ok />
          {activeTasks > 0 && (
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-400/30"
              title="مهام نشطة"
            >
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-300">{activeTasks} مهمة نشطة</span>
            </div>
          )}
          <button
            onClick={() => setNotifOpen((o) => !o)}
            className="relative flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-primary/10 transition"
            data-testid="notif-toggle"
          >
            <BellRing
              className={`w-4 h-4 ${unreadCount > 0 ? "text-amber-300" : "text-primary/70"}`}
            />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-[9px] text-white grid place-items-center font-bold">
                {unreadCount}
              </span>
            )}
          </button>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
            <span className="text-emerald-300">CONNECTED</span>
          </div>
        </div>
      </div>

      {/* Notifications dropdown */}
      {notifOpen && (
        <div className="absolute top-10 right-[368px] z-40 w-[360px] max-h-[70vh] overflow-y-auto rounded-xl bg-card/95 backdrop-blur-xl border border-primary/30 shadow-[0_0_30px_rgba(0,212,255,0.25)]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-primary/20 sticky top-0 bg-card/95 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <BellRing className="w-4 h-4" />
              <span>الإشعارات ({notifs.length})</span>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] text-primary/80 hover:text-primary"
                >
                  قراءة الكل
                </button>
              )}
              <button
                onClick={() => setNotifOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {notifs.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              لا توجد إشعارات حالياً — البوت بيراقب 24/7
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {notifs.map((n) => {
                const tone =
                  n.level === "critical"
                    ? "border-r-rose-400 bg-rose-500/5"
                    : n.level === "error"
                      ? "border-r-red-400 bg-red-500/5"
                      : n.level === "warning"
                        ? "border-r-amber-400 bg-amber-500/5"
                        : "border-r-primary/60 bg-primary/5";
                return (
                  <div
                    key={n.id}
                    className={`group px-3 py-2 border-r-2 ${tone} ${
                      !n.read ? "" : "opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground line-clamp-1">
                          {n.title}
                        </div>
                        {n.body && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                            {n.body}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-muted-foreground">
                          {n.source && <span className="text-primary/70">{n.source}</span>}
                          <span>{new Date(n.createdAt).toLocaleString("en-GB", { hour12: false })}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => dismissNotif(n.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400 transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Animated particle background */}
      <ParticleCanvas />

      {/* Ambient glow blobs for cinematic depth */}
      <div className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-cyan-500/10 blur-[140px] pointer-events-none" />
      <div className="absolute -bottom-40 right-[20%] w-[600px] h-[600px] rounded-full bg-fuchsia-500/10 blur-[160px] pointer-events-none" />
      <div className="absolute top-1/3 right-[28%] w-[420px] h-[420px] rounded-full bg-emerald-400/8 blur-[140px] pointer-events-none" />

      {/* Desktop surface — leaves 360px on the right for the persistent agent panel */}
      <div ref={surfaceRef} className="absolute inset-y-0 left-0 right-[360px] pt-12 pb-20 px-6">
        {wins.length === 0 && (
          <>
            {/* Hero center card */}
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="pointer-events-auto max-w-xl text-center px-6">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 border border-primary/30 backdrop-blur-md mb-5 shadow-[0_0_40px_rgba(0,212,255,0.25)]">
                  <MonitorIcon className="w-10 h-10 text-primary neon-text" />
                </div>
                <h2 className="text-xl font-bold text-foreground mb-2 neon-text">
                  سطح مكتب الوكيل الأصلي
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed font-mono mb-6">
                  الوكيل عبقري — يفتح <span className="text-cyan-300">terminal</span>،{" "}
                  <span className="text-emerald-300">browser</span>،{" "}
                  <span className="text-fuchsia-300">scanner</span>،{" "}
                  <span className="text-amber-300">dashboard</span> وغيره. شغّال طول اليوم.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {(["kaligpt", "scanner", "monitor", "terminal"] as WinKind[]).map((k) => {
                    const a = APPS.find((x) => x.kind === k)!;
                    return (
                      <button
                        key={k}
                        onClick={() => openWindow(k)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 hover:scale-105 transition text-xs font-mono"
                        data-testid={`hero-${k}`}
                      >
                        <a.icon className="w-3.5 h-3.5" />
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Quick tips bottom-left */}
            <QuickTipsPanel
              onTip={(prompt, kind) => {
                if (kind) openWindow(kind);
                window.dispatchEvent(new CustomEvent("agent-prefill", { detail: prompt }));
              }}
            />

            {/* API Keys panel bottom-right */}
            <ApiKeysPanel />
          </>
        )}
        {wins.map((w) => (
          <DraggableWindow
            key={w.id}
            state={w}
            onClose={() => closeWindow(w.id)}
            onFocus={() => focusWindow(w.id)}
            onMinimize={() => minimize(w.id)}
            onMaximize={() => maximize(w.id)}
            onMove={(x, y) => move(w.id, x, y)}
            onResize={(ww, hh) => resize(w.id, ww, hh)}
          >
            {renderBody(w)}
          </DraggableWindow>
        ))}
      </div>

      {/* Persistent right-side Live Agent panel */}
      <LiveAgentPanel
        onClientTool={handleClientTool}
        onOpenAgentWindow={() => openWindow("agent")}
      />

      {/* Dock */}
      <div className="absolute bottom-0 left-0 right-[360px] z-30 h-16 flex items-center justify-center pb-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-2xl bg-card/70 backdrop-blur-xl border border-primary/30 shadow-[0_0_30px_rgba(0,212,255,0.2)]">
          {APPS.map((a) => {
            const open = wins.find((w) => w.kind === a.kind);
            return (
              <button
                key={a.kind}
                onClick={() => {
                  if (open) {
                    if (open.minimized) minimize(open.id); // toggles
                    if (open.minimized)
                      setWins((arr) =>
                        arr.map((x) =>
                          x.id === open.id ? { ...x, minimized: false } : x,
                        ),
                      );
                    focusWindow(open.id);
                  } else openWindow(a.kind);
                }}
                title={a.label}
                className={`relative w-11 h-11 grid place-items-center rounded-xl transition-all hover:scale-110 ${
                  open
                    ? "bg-primary/20 border border-primary/40"
                    : "bg-card/40 border border-border/40 hover:border-primary/30"
                }`}
                data-testid={`dock-${a.kind}`}
              >
                <a.icon className="w-5 h-5 text-primary" />
                {open && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary shadow-[0_0_4px_hsl(var(--primary))]" />
                )}
              </button>
            );
          })}
          <div className="mx-1 w-px h-8 bg-primary/20" />
          <button
            onClick={() => {
              setWins([]);
            }}
            title="Show desktop"
            className="w-11 h-11 grid place-items-center rounded-xl bg-card/40 border border-border/40 hover:border-primary/30"
          >
            <MonitorIcon className="w-5 h-5 text-primary" />
          </button>
        </div>
      </div>

    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`w-3.5 h-3.5 ${ok ? "text-primary" : "text-amber-400"}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className={ok ? "text-primary" : "text-amber-300"}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// ParticleCanvas — animated dotted background
// ─────────────────────────────────────────────
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width;
      canvas.height = r.height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    const pts = Array.from({ length: 60 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.4,
      a: Math.random() * 0.5 + 0.1,
    }));
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pts.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 212, 255, ${p.a})`;
        ctx.fill();
      });
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 110) {
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = `rgba(0, 212, 255, ${(1 - d / 110) * 0.18})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-50"
    />
  );
}

// ─────────────────────────────────────────────
// QuickTipsPanel — bottom-left agent suggestions
// ─────────────────────────────────────────────
const QUICK_TIPS: Array<{
  id: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  hue: string;
  prompt: string;
  openKind?: WinKind;
}> = [
  {
    id: "show-dashboard",
    title: "SHOW · DASHBOARD",
    desc: "افتح dashboard للمراقبة الحية للعمليات والنظام",
    icon: Activity,
    hue: "from-emerald-500/15 to-cyan-500/5 border-emerald-400/30 text-emerald-300",
    prompt: "اعرض لي dashboard المراقبة الحي للنظام والعمليات",
    openKind: "monitor",
  },
  {
    id: "list-terminal",
    title: "LIST · TERMINAL",
    desc: "افتح terminal وشغّل أوامر سريعة على سطح المكتب الحالي",
    icon: TerminalIcon,
    hue: "from-cyan-500/15 to-sky-500/5 border-cyan-400/30 text-cyan-300",
    prompt: "افتح terminal ونفّذ: uname -a && uptime && whoami",
    openKind: "terminal",
  },
  {
    id: "browse",
    title: "BROWSE",
    desc: "افتح browser على hacker news وحلّل أهم 10 عناوين الآن",
    icon: Globe,
    hue: "from-indigo-500/15 to-blue-500/5 border-indigo-400/30 text-indigo-300",
    prompt: "افتح browser على https://news.ycombinator.com وحلّل أهم العناوين",
    openKind: "browser",
  },
  {
    id: "run-ai-agent",
    title: "RUN · AI AGENT",
    desc: "نفّذ playbook recon كامل + احفظ النتائج في ذاكرة البوت",
    icon: Sparkles,
    hue: "from-fuchsia-500/15 to-purple-500/5 border-fuchsia-400/30 text-fuchsia-300",
    prompt: "ابدأ recon كامل (whois + dns + subdomains + ports) على example.com",
    openKind: "agent",
  },
];

function QuickTipsPanel({
  onTip,
}: {
  onTip: (prompt: string, kind?: WinKind) => void;
}) {
  return (
    <div className="absolute bottom-20 left-4 z-10 grid grid-cols-2 gap-2 w-[360px] max-w-[40vw]">
      {QUICK_TIPS.map((t) => (
        <button
          key={t.id}
          onClick={() => onTip(t.prompt, t.openKind)}
          className={`group relative text-right rounded-xl p-2.5 bg-gradient-to-br ${t.hue} border backdrop-blur-md hover:scale-[1.02] transition-all`}
          data-testid={`tip-${t.id}`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <t.icon className="w-3.5 h-3.5 opacity-70 shrink-0" />
            <div className="text-[9px] font-mono font-bold tracking-wider truncate">
              {t.title}
            </div>
          </div>
          <div className="text-[9px] text-muted-foreground leading-snug font-mono line-clamp-2">
            {t.desc}
          </div>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// ApiKeysPanel — bottom-right key status (read-only, masked)
// ─────────────────────────────────────────────
interface KeyStatus {
  key: string;
  configured: boolean;
  source?: "env" | "settings";
}

interface SettingsResponse {
  provider: string;
  model: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  hasNvdKey?: boolean;
  useReplitDefault: boolean;
}

interface ProviderInfo {
  provider: string;
  configured: boolean;
}

const TRACKED_KEYS = [
  { id: "NVD_API_KEY", providerKey: null, settingsKey: "hasNvdKey" as const },
];

function ApiKeysPanel() {
  const [statuses, setStatuses] = useState<KeyStatus[]>(
    TRACKED_KEYS.map((k) => ({ key: k.id, configured: false })),
  );
  const apiBase = "/api";

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const [sR, pR] = await Promise.all([
          fetch(`${apiBase}/settings`),
          fetch(`${apiBase}/providers/status`),
        ]);
        const s: SettingsResponse | null = sR.ok ? await sR.json() : null;
        const provJson = pR.ok
          ? ((await pR.json()) as { providers: ProviderInfo[] })
          : { providers: [] };
        const provMap = new Map(provJson.providers.map((p) => [p.provider, p.configured]));
        const next: KeyStatus[] = TRACKED_KEYS.map((k) => {
          const fromProvider = k.providerKey ? provMap.get(k.providerKey) : false;
          const fromSettings = s ? Boolean(s[k.settingsKey]) : false;
          return {
            key: k.id,
            configured: Boolean(fromProvider || fromSettings),
            source: fromProvider ? "env" : "settings",
          };
        });
        if (active) setStatuses(next);
      } catch {
        /* offline */
      }
    };
    void tick();
    const t = setInterval(tick, 30_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [apiBase]);

  return (
    <div className="absolute bottom-20 right-4 z-10 w-[260px] rounded-xl bg-card/70 backdrop-blur-xl border border-primary/30 shadow-[0_0_20px_rgba(0,212,255,0.15)] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-primary">
          <KeyRound className="w-3.5 h-3.5" />
          API · KEYS
        </div>
        <a
          href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/settings`}
          className="text-[9px] font-mono text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
        >
          إدارة <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
      <div className="space-y-1">
        {statuses.map((s) => (
          <div
            key={s.key}
            className="flex items-center justify-between text-[10px] font-mono px-2 py-1.5 rounded-md bg-background/40 border border-border/30"
            data-testid={`apikey-${s.key}`}
          >
            <span className="text-muted-foreground truncate">{s.key}</span>
            <span
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                s.configured
                  ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                  : "bg-rose-500/70"
              }`}
              title={s.configured ? "متصل" : "غير مهيأ"}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
