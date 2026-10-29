import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LucideProps } from "lucide-react";
import {
  X, Activity, Minimize2, Maximize2, Trash2, Cpu, HardDrive, Wifi,
  Play, Pause, Square, Timer, RefreshCw, CheckSquare,
  ChevronDown, ChevronUp, Layers, Server,
} from "lucide-react";
import { APPS } from "./taskmanager-apps";

// Helper: render Lucide icon with style prop safely
function LIcon({ Icon, style }: { Icon: React.ComponentType<LucideProps>; style?: React.CSSProperties }) {
  return <Icon style={style} />;
}

interface WindowInfo {
  id: string; kind: string; title?: string;
  minimized?: boolean; maximized?: boolean;
}

interface TaskManagerProps {
  wins: WindowInfo[];
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onCloseAll: () => void;
}

type SortKey = "name" | "kind" | "memory" | "cpu";
type TMTab = "windows" | "services" | "timer";

// Simulated per-window resource usage (stable per id)
const getSimStats = (id: string) => {
  const seed = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    cpu: ((seed * 37) % 45) + 3,
    mem: ((seed * 13) % 180) + 40,
  };
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const PANEL: React.CSSProperties = {
  background: "rgba(4,0,10,0.97)",
  border: "1px solid rgba(0,212,255,0.25)",
  borderRadius: 20,
  boxShadow: "0 0 40px rgba(0,212,255,0.12), 0 20px 60px rgba(0,0,0,0.8)",
  backdropFilter: "blur(24px)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const HDR: React.CSSProperties = {
  background: "rgba(0,212,255,0.06)",
  borderBottom: "1px solid rgba(0,212,255,0.12)",
  padding: "10px 14px",
  cursor: "grab",
  userSelect: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const TAB_BTN = (active: boolean): React.CSSProperties => ({
  padding: "5px 12px",
  borderRadius: 10,
  fontFamily: "monospace",
  fontWeight: 900,
  fontSize: 10,
  letterSpacing: "0.08em",
  cursor: "pointer",
  border: `1px solid ${active ? "rgba(0,212,255,0.4)" : "rgba(255,255,255,0.07)"}`,
  background: active ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.02)",
  color: active ? "#00d4ff" : "rgba(255,255,255,0.3)",
  transition: "all 0.15s",
});

const ROW = (selected: boolean, paused: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 8,
  padding: "7px 12px",
  background: selected ? "rgba(0,212,255,0.08)" : "transparent",
  borderBottom: "1px solid rgba(255,255,255,0.03)",
  opacity: paused ? 0.55 : 1,
  transition: "all 0.15s",
  cursor: "pointer",
});

const ICON_BOX = (color: string): React.CSSProperties => ({
  width: 28, height: 28, borderRadius: 9,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: `${color}15`,
  border: `1px solid ${color}35`,
  flexShrink: 0,
});

const PILL = (color: string): React.CSSProperties => ({
  fontSize: 9, fontFamily: "monospace", fontWeight: 900,
  padding: "2px 6px", borderRadius: 6,
  color, background: `${color}12`,
  border: `1px solid ${color}25`,
  whiteSpace: "nowrap",
});

const BAR_WRAP: React.CSSProperties = { width: 44, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" };

const BTN = (color: string, bg = false): React.CSSProperties => ({
  width: 22, height: 22, borderRadius: 7, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: bg ? `${color}12` : "rgba(255,255,255,0.04)",
  border: `1px solid ${bg ? color + "30" : "rgba(255,255,255,0.06)"}`,
  color: bg ? color : "rgba(255,255,255,0.3)",
  transition: "all 0.15s",
});

const INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8, color: "rgba(255,255,255,0.6)",
  fontFamily: "monospace", fontSize: 12,
  padding: "4px 8px", outline: "none", width: 52, textAlign: "center",
};

// ─── Timer Component ───────────────────────────────────────────────────────────
function ChronosTimer() {
  const [mode, setMode] = useState<"stopwatch" | "countdown">("stopwatch");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);    // ms
  const [targetMs, setTargetMs] = useState(300000); // 5 min default
  const [minInput, setMinInput] = useState("5");
  const [secInput, setSecInput] = useState("0");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fmt = (ms: number) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };

  const display = mode === "stopwatch" ? elapsed : Math.max(0, targetMs - elapsed);
  const pct = mode === "stopwatch"
    ? Math.min(100, (elapsed / Math.max(targetMs, 1)) * 100)
    : Math.max(0, ((targetMs - elapsed) / Math.max(targetMs, 1)) * 100);
  const finished = mode === "countdown" && elapsed >= targetMs;

  useEffect(() => {
    if (running && !finished) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 100), 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, finished]);

  const reset = () => { setRunning(false); setElapsed(0); };
  const applyTarget = () => {
    const m = Math.max(0, parseInt(minInput) || 0);
    const s = Math.max(0, Math.min(59, parseInt(secInput) || 0));
    setTargetMs((m * 60 + s) * 1000);
    reset();
  };

  const color = finished ? "#ff4444" : mode === "stopwatch" ? "#00d4ff" : pct > 25 ? "#44ff88" : pct > 10 ? "#ffaa44" : "#ff4444";

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {(["stopwatch", "countdown"] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); reset(); }}
            style={{ ...TAB_BTN(mode === m), padding: "4px 14px", fontSize: 9 }}>
            {m === "stopwatch" ? "⏱ ساعة إيقاف" : "⏳ عد تنازلي"}
          </button>
        ))}
      </div>

      {/* Main display */}
      <div style={{ textAlign: "center", padding: "16px 0" }}>
        <div style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 42, color, letterSpacing: "-0.02em",
          textShadow: `0 0 20px ${color}50`, transition: "color 0.3s" }}>
          {fmt(display)}
        </div>
        {finished && (
          <div style={{ color: "#ff4444", fontFamily: "monospace", fontWeight: 900, fontSize: 11,
            animation: "pulse 1s infinite", marginTop: 4 }}>⚠ انتهى الوقت!</div>
        )}
      </div>

      {/* Progress ring (bar) */}
      <div style={{ height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 99, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${color}80, ${color})`,
          borderRadius: 99, transition: "width 0.1s linear, background 0.3s" }} />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button onClick={() => setRunning(r => !r)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 20px", borderRadius: 12,
            fontFamily: "monospace", fontWeight: 900, fontSize: 11, cursor: "pointer",
            background: running ? "rgba(255,170,68,0.12)" : "rgba(68,255,136,0.12)",
            border: `1px solid ${running ? "rgba(255,170,68,0.3)" : "rgba(68,255,136,0.3)"}`,
            color: running ? "#ffaa44" : "#44ff88" }}>
          {running ? <><Pause style={{ width: 12, height: 12 }} />إيقاف</> : <><Play style={{ width: 12, height: 12 }} />تشغيل</>}
        </button>
        <button onClick={reset}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 12,
            fontFamily: "monospace", fontWeight: 900, fontSize: 11, cursor: "pointer",
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)" }}>
          <RefreshCw style={{ width: 11, height: 11 }} />إعادة
        </button>
      </div>

      {/* Countdown config */}
      {mode === "countdown" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
          padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <span style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>المدة:</span>
          <input value={minInput} onChange={e => setMinInput(e.target.value)} style={INPUT} placeholder="5" />
          <span style={{ fontFamily: "monospace", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>:</span>
          <input value={secInput} onChange={e => setSecInput(e.target.value)} style={{ ...INPUT, width: 44 }} placeholder="00" />
          <span style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>د:ث</span>
          <button onClick={applyTarget}
            style={{ padding: "4px 10px", borderRadius: 8, fontFamily: "monospace", fontWeight: 900, fontSize: 9,
              cursor: "pointer", background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.25)", color: "#00d4ff" }}>
            تطبيق
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main TaskManager ──────────────────────────────────────────────────────────
export function TaskManager({ wins, onClose, onFocus, onMinimize, onMaximize, onCloseAll }: TaskManagerProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [paused, setPaused]     = useState<string[]>([]);
  const [sortBy, setSortBy]     = useState<SortKey>("name");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("asc");
  const [tab, setTab]           = useState<TMTab>("windows");
  const [position, setPosition] = useState({ x: 120, y: 100 });
  const [isDragging, setIsDragging]   = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Draggable header
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); setIsDragging(true);
    const sx = e.clientX, sy = e.clientY, sl = position.x, st = position.y;
    const onMove = (ev: MouseEvent) => setPosition({ x: Math.max(0, Math.min(window.innerWidth - 420, sl + ev.clientX - sx)), y: Math.max(0, Math.min(window.innerHeight - 300, st + ev.clientY - sy)) });
    const onUp   = () => { setIsDragging(false); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [position]);

  const toggleSelect = (id: string) => setSelected(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);
  const togglePause  = (id: string) => setPaused(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);

  const getSortValue = (w: WindowInfo): number | string => {
    if (sortBy === "memory") return getSimStats(w.id).mem;
    if (sortBy === "cpu")    return getSimStats(w.id).cpu;
    if (sortBy === "kind")   return w.kind;
    return w.title || w.kind;
  };

  const sorted = [...wins].sort((a, b) => {
    const av = getSortValue(a), bv = getSortValue(b);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalMem = wins.reduce((a, w) => a + getSimStats(w.id).mem, 0);
  const avgCpu   = wins.length ? wins.reduce((a, w) => a + getSimStats(w.id).cpu, 0) / wins.length : 0;

  const getColor = (kind: string) => {
    const map: Record<string, string> = {
      agent:"#aa44ff", browser:"#44eebb", terminal:"#44ff88", scanner:"#ff8844", editor:"#4488ff",
      keys:"#ffaa44", monitor:"#00d4ff", dashboard:"#4488ff", files:"#ffaa44", nodes:"#44ff88",
    };
    return map[kind] ?? "#888888";
  };

  const cycleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("asc"); }
  };

  const doCloseAll = () => { onCloseAll(); setSelected([]); setPaused([]); setShowCloseConfirm(false); };

  return (
    <div style={{ position: "fixed", left: position.x, top: position.y, width: 420, zIndex: 9000, ...PANEL, cursor: isDragging ? "grabbing" : "default" }}>
      {/* Header */}
      <div style={HDR} onMouseDown={startDrag}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity style={{ width: 14, height: 14, color: "#00d4ff" }} />
          <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 12, color: "#00d4ff", letterSpacing: "0.1em" }}>TASK MANAGER</span>
          <span style={{ ...PILL("#00d4ff"), marginRight: 0 }}>{wins.length} نشط</span>
        </div>
        {/* Close All */}
        {!showCloseConfirm ? (
          <button onClick={() => wins.length > 0 && setShowCloseConfirm(true)}
            disabled={wins.length === 0}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 9, cursor: "pointer",
              fontFamily: "monospace", fontWeight: 900, fontSize: 9,
              background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.3)",
              color: wins.length > 0 ? "#ff4444" : "rgba(255,255,255,0.2)", opacity: wins.length > 0 ? 1 : 0.4 }}>
            <Square style={{ width: 11, height: 11 }} /> إغلاق الكل
          </button>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "#ffaa44" }}>تأكيد؟</span>
            <button onClick={doCloseAll}
              style={{ padding: "3px 10px", borderRadius: 7, cursor: "pointer", fontFamily: "monospace", fontWeight: 900, fontSize: 9,
                background: "rgba(255,68,68,0.2)", border: "1px solid rgba(255,68,68,0.4)", color: "#ff4444" }}>نعم</button>
            <button onClick={() => setShowCloseConfirm(false)}
              style={{ padding: "3px 10px", borderRadius: 7, cursor: "pointer", fontFamily: "monospace", fontWeight: 900, fontSize: 9,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>لا</button>
          </div>
        )}
      </div>

      {/* System stats bar */}
      <div style={{ display: "flex", gap: 12, padding: "8px 14px", background: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        {[
          { label: "CPU", val: avgCpu.toFixed(0) + "%", icon: Cpu, color: "#44ff88", w: Math.min(100, avgCpu) },
          { label: "RAM", val: totalMem + " MB", icon: HardDrive, color: "#aa44ff", w: Math.min(100, totalMem / 5) },
          { label: "الشبكة", val: "نشط", icon: Wifi, color: "#44eebb", w: 60 },
        ].map(({ label, val, icon: Icon, color, w }) => (
          <div key={label} style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
              <Icon style={{ width: 10, height: 10, color }} />
              <span style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{label}</span>
              <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 9, color, marginRight: "auto" }}>{val}</span>
            </div>
            <div style={BAR_WRAP}>
              <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 99, transition: "width 0.5s" }} />
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        {([["windows","النوافذ",Layers], ["services","الخدمات",Server], ["timer","المؤقت",Timer]] as [TMTab, string, React.ComponentType<{style?: React.CSSProperties}>][]).map(([t, label, Icon]) => (
          <button key={t} onClick={() => setTab(t)} style={TAB_BTN(tab === t)}>
            <Icon style={{ width: 9, height: 9, display: "inline", marginLeft: 3 }} />{label}
          </button>
        ))}
        {tab === "windows" && (
          <div style={{ marginRight: "auto", display: "flex", gap: 4 }}>
            {([["name","الاسم"], ["cpu","CPU"], ["memory","RAM"]] as [SortKey, string][]).map(([k, l]) => (
              <button key={k} onClick={() => cycleSort(k)}
                style={{ ...PILL(sortBy === k ? "#00d4ff" : "#555"), cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                {l}
                {sortBy === k && (sortDir === "asc" ? <ChevronUp style={{ width: 8, height: 8 }} /> : <ChevronDown style={{ width: 8, height: 8 }} />)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "timer" && (
          <div style={{ overflowY: "auto", maxHeight: 380 }}><ChronosTimer /></div>
        )}

        {tab === "services" && (
          <div style={{ padding: "8px 12px", overflowY: "auto", maxHeight: 380 }}>
            {[
              { name: "Nova Agent",    id: "nova-agent",   color: "#aa44ff" },
              { name: "API Server",    id: "api-server",   color: "#44ff88" },
              { name: "Nova Sentinel", id: "sentinel",     color: "#ff4444" },
              { name: "Ollama Engine", id: "ollama",       color: "#ffaa44" },
              { name: "Task Runner",   id: "task-runner",  color: "#00d4ff" },
              { name: "CVE Sync",      id: "cve-sync",     color: "#ff8844" },
              { name: "File System",   id: "file-system",  color: "#44eebb" },
              { name: "Log Analyzer",  id: "log-analyzer", color: "#4488ff" },
              { name: "Health Monitor",id: "health-mon",   color: "#44ff88" },
              { name: "Webhook Mgr",   id: "webhook-mgr",  color: "#aa44ff" },
            ].map((svc) => {
              const active = !paused.includes(svc.id);
              return (
                <div key={svc.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 10,
                  marginBottom: 2, background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: active ? svc.color : "rgba(255,255,255,0.1)",
                    boxShadow: active ? `0 0 8px ${svc.color}` : "none" }} />
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: active ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)", flex: 1 }}>{svc.name}</span>
                  <span style={PILL(active ? "#44ff88" : "#ff4444")}>{active ? "نشط" : "متوقف"}</span>
                  {/* Stop/Start toggle */}
                  <button onClick={() => togglePause(svc.id)}
                    title={active ? "إيقاف الخدمة" : "تشغيل الخدمة"}
                    style={{ ...BTN(active ? "#ff8844" : "#44ff88", true), width: 26, height: 22 }}>
                    {active ? <Pause style={{ width: 10, height: 10 }} /> : <Play style={{ width: 10, height: 10 }} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === "windows" && (
          <>
            {/* Bulk actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <button onClick={() => setSelected(wins.length === selected.length ? [] : wins.map(w => w.id))}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 7, cursor: "pointer",
                  fontFamily: "monospace", fontSize: 9, fontWeight: 900, background: "rgba(0,212,255,0.06)",
                  border: "1px solid rgba(0,212,255,0.15)", color: "#00d4ff" }}>
                <CheckSquare style={{ width: 9, height: 9 }} />
                {selected.length === wins.length && wins.length > 0 ? "إلغاء الكل" : "تحديد الكل"}
              </button>
              {selected.length > 0 && (
                <>
                  <button onClick={() => { selected.forEach(onMinimize); setSelected([]); }}
                    style={{ ...BTN("#ffaa44", false), width: "auto", padding: "3px 7px", fontSize: 9, fontFamily: "monospace", fontWeight: 900 }}>
                    <Minimize2 style={{ width: 9, height: 9 }} />
                  </button>
                  <button onClick={() => { selected.forEach(onMaximize); setSelected([]); }}
                    style={{ ...BTN("#4488ff", false), width: "auto", padding: "3px 7px", fontSize: 9, fontFamily: "monospace", fontWeight: 900 }}>
                    <Maximize2 style={{ width: 9, height: 9 }} />
                  </button>
                  <button onClick={() => { selected.forEach(id => togglePause(id)); setSelected([]); }}
                    style={{ ...BTN("#ffaa44", true), width: "auto", padding: "3px 7px", fontSize: 9, fontFamily: "monospace", fontWeight: 900 }}>
                    <Pause style={{ width: 9, height: 9 }} />
                  </button>
                  <button onClick={() => { selected.forEach(onClose); setSelected([]); }}
                    style={{ ...BTN("#ff4444", true), width: "auto", padding: "3px 7px", fontSize: 9, fontFamily: "monospace", fontWeight: 900 }}>
                    <Trash2 style={{ width: 9, height: 9 }} />
                  </button>
                  <span style={{ fontFamily: "monospace", fontSize: 9, color: "#00d4ff" }}>{selected.length} محدد</span>
                </>
              )}
            </div>

            {/* Window list */}
            <div style={{ overflowY: "auto", maxHeight: 320, scrollbarWidth: "thin" }}>
              {wins.length === 0 && (
                <div style={{ padding: 32, textAlign: "center", fontFamily: "monospace", fontSize: 12, color: "rgba(255,255,255,0.15)" }}>
                  لا توجد نوافذ مفتوحة
                </div>
              )}
              {sorted.map((win) => {
                const isPaused = paused.includes(win.id);
                const color = getColor(win.kind);
                const stats = getSimStats(win.id);
                const isSelected = selected.includes(win.id);
                const app = APPS.find(a => a.kind === win.kind);

                return (
                  <div key={win.id} style={ROW(isSelected, isPaused)}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; onFocus(win.id); }}>
                    {/* Checkbox */}
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(win.id)}
                      style={{ width: 12, height: 12, accentColor: "#00d4ff", cursor: "pointer", flexShrink: 0 }}
                      onClick={e => e.stopPropagation()} />
                    {/* Icon */}
                    <div style={ICON_BOX(color)}>
                      {app ? <app.icon style={{ width: 13, height: 13, color }} /> : <Activity style={{ width: 13, height: 13, color }} />}
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 11, color: "rgba(255,255,255,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {win.title || win.kind}
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                        {win.minimized ? "مخفي" : win.maximized ? "مكبّر" : "عادي"} · {stats.mem}MB · {stats.cpu}%
                      </div>
                    </div>
                    {/* CPU bar */}
                    <div style={BAR_WRAP}>
                      <div style={{ height: "100%", width: `${stats.cpu}%`, background: "#44ff88", borderRadius: 99 }} />
                    </div>
                    {/* Status dot */}
                    <div style={{ width: 7, height: 7, borderRadius: "50%",
                      background: isPaused ? "#ffaa44" : "#44ff88",
                      boxShadow: isPaused ? "0 0 6px #ffaa44" : "0 0 6px #44ff88",
                      flexShrink: 0 }} />
                    {/* Controls */}
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => togglePause(win.id)} title={isPaused ? "استئناف" : "إيقاف مؤقت"}
                        style={BTN(isPaused ? "#44ff88" : "#ffaa44", true)}>
                        {isPaused ? <Play style={{ width: 9, height: 9 }} /> : <Pause style={{ width: 9, height: 9 }} />}
                      </button>
                      <button onClick={() => onMinimize(win.id)} style={BTN("#888")} title="تصغير">
                        <Minimize2 style={{ width: 9, height: 9 }} />
                      </button>
                      <button onClick={() => onMaximize(win.id)} style={BTN("#888")} title="تكبير">
                        <Maximize2 style={{ width: 9, height: 9 }} />
                      </button>
                      <button onClick={() => onClose(win.id)} style={BTN("#ff4444", true)} title="إغلاق">
                        <X style={{ width: 9, height: 9 }} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 14px",
        background: "rgba(0,0,0,0.4)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#44ff88", boxShadow: "0 0 6px #44ff88" }} />
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{wins.filter(w => !paused.includes(w.id)).length} نشط</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffaa44" }} />
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{paused.length} موقوف</span>
          </div>
        </div>
        <span style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
          {totalMem} MB · {avgCpu.toFixed(0)}% avg
        </span>
      </div>
    </div>
  );
}
