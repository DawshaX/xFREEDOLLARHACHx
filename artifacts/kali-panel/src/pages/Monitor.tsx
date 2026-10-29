import { useEffect, useState } from "react";
import { Activity, Bell, BellOff, Bot, CheckCircle, AlertTriangle, Cpu, MemoryStick, Terminal, Zap, X, RefreshCw, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

const API_BASE = "/api";

interface SystemStats { cpu: number; memUsed: number; uptime: number; hostname: string; loadAvg: number; timestamp: string; }
interface ProcessInfo { id: string; command: string; status: string; startedAt: number; }
interface BotAlert { id: number; severity: string; title: string; message: string; source: string; isRead: string; createdAt: string; }
interface ActivityMessage { id: number; role: string; content: string; toolName?: string | null; createdAt: string; }
interface MonitorDashboard {
  system: { cpu: number; memUsed: number; uptime: number; hostname: string };
  processes: { total: number; running: number };
  agent: { activeSessions: number; totalSessions: number };
  alerts: { unread: number; critical: number };
  cronJobs: { enabled: number };
  timestamp: string;
}

function formatUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const SEV_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#ff4444", bg: "rgba(255,30,30,0.08)", border: "rgba(255,30,30,0.3)" },
  high:     { color: "#ff8844", bg: "rgba(255,100,0,0.07)", border: "rgba(255,100,0,0.27)" },
  medium:   { color: "#ffaa44", bg: "rgba(255,150,0,0.06)", border: "rgba(255,150,0,0.22)" },
  low:      { color: "#4488ff", bg: "rgba(0,100,255,0.06)", border: "rgba(0,100,255,0.2)" },
  info:     { color: "#44eebb", bg: "rgba(0,240,180,0.05)", border: "rgba(0,240,180,0.17)" },
};

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };

function GaugeBar({ value }: { value: number }) {
  const color = value > 80 ? "#ff4444" : value > 60 ? "#ffaa44" : "#44eebb";
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(value, 100)}%`, background: color, boxShadow: `0 0 6px ${color}88` }} />
    </div>
  );
}

export default function Monitor() {
  const [dashboard, setDashboard] = useState<MonitorDashboard | null>(null);
  const [liveStats, setLiveStats] = useState<SystemStats | null>(null);
  const [liveProcs, setLiveProcs] = useState<ProcessInfo[]>([]);
  const [alerts, setAlerts] = useState<BotAlert[]>([]);
  const [activity, setActivity] = useState<ActivityMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);

  function addLog(line: string) {
    const t = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogLines((p) => [`[${t}] ${line}`, ...p].slice(0, 200));
  }

  useEffect(() => {
    void (async () => {
      try {
        const [dash, al, ac] = await Promise.all([
          jsonRequest<MonitorDashboard>("/monitor/dashboard"),
          jsonRequest<BotAlert[]>("/bot/alerts?limit=30"),
          jsonRequest<{ recentMessages: ActivityMessage[] }>("/monitor/activity"),
        ]);
        setDashboard(dash); setAlerts(al); setActivity(ac.recentMessages);
        addLog("✅ تم تحميل بيانات لوحة المراقبة");
      } catch { addLog("⚠ فشل تحميل البيانات الأولية"); }
    })();
  }, []);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/monitor/stream`);
    es.onopen = () => { setConnected(true); addLog("✅ متصل بـ CyberNova Monitor — بث مباشر نشط"); };
    es.onerror = () => { setConnected(false); addLog("❌ انقطع الاتصال — إعادة المحاولة..."); };

    function parseEvt(e: MessageEvent, eventType?: string) {
      try {
        const data = JSON.parse(e.data);
        const ev = eventType ?? "message";
        if (ev === "system") { const s = data as SystemStats; setLiveStats(s); addLog(`📊 CPU: ${s.cpu}% | RAM: ${s.memUsed}% | Load: ${(s.loadAvg ?? 0).toFixed(2)}`); }
        else if (ev === "processes") { const p = data as { total: number; running: number; processes: ProcessInfo[] }; setLiveProcs(p.processes ?? []); if (p.running > 0) addLog(`⚙️ عمليات جارية: ${p.running}/${p.total}`); }
        else if (ev === "alerts") {
          const a = data as { count: number; alerts: BotAlert[] };
          setAlerts((prev) => {
            const ids = new Set(prev.map((x) => x.id));
            const newA = (a.alerts ?? []).filter((x) => !ids.has(x.id));
            if (newA.length > 0) addLog(`🚨 ${newA.length} تنبيه جديد`);
            return [...(a.alerts ?? []), ...prev.filter((x) => !(a.alerts ?? []).find((y) => y.id === x.id))].slice(0, 100);
          });
        } else if (ev === "ping") { addLog("🏓 نبضة — النظام يعمل 24/7"); }
        else if (ev === "connected") { setConnected(true); }
      } catch { /* ignore */ }
    }

    for (const evName of ["system", "processes", "alerts", "ping", "connected"]) {
      es.addEventListener(evName, (e) => parseEvt(e as MessageEvent, evName));
    }
    es.onmessage = (e) => parseEvt(e);
    return () => es.close();
  }, []);

  async function markAllRead() {
    try { await jsonRequest("/bot/alerts/read-all", { method: "PUT" }); setAlerts((p) => p.map((a) => ({ ...a, isRead: "true" }))); addLog("✅ تم تحديد جميع التنبيهات كمقروءة"); }
    catch { addLog("⚠ فشل تحديث التنبيهات"); }
  }

  const cpu = liveStats?.cpu ?? dashboard?.system.cpu ?? 0;
  const mem = liveStats?.memUsed ?? dashboard?.system.memUsed ?? 0;
  const uptime = liveStats?.uptime ?? dashboard?.system.uptime ?? 0;
  const unread = alerts.filter((a) => a.isRead === "false").length;

  function logColor(line: string): string {
    if (line.includes("❌")) return "#ff5555";
    if (line.includes("🚨")) return "#ffaa44";
    if (line.includes("✅")) return "#44ff88";
    if (line.includes("📊")) return "#44eebb";
    return "rgba(100,255,150,0.7)";
  }

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ مراقبة مباشرة" subtitle="Live Command Center — مراقبة النظام والبوت والعمليات لحظة بلحظة" icon={Activity} danger
        actions={
          <div className="flex items-center gap-1.5 text-[10px] font-black font-mono px-2.5 py-1.5 rounded-xl"
            style={connected
              ? { color: "#44ff88", border: "1px solid rgba(0,200,100,0.35)", background: "rgba(0,200,100,0.08)" }
              : { color: "#ff5555", border: "1px solid rgba(255,30,30,0.35)", background: "rgba(255,30,30,0.08)" }}>
            <div className={`w-2 h-2 rounded-full ${connected ? "animate-pulse" : "animate-bounce"}`}
              style={{ background: connected ? "#44ff88" : "#ff5555", boxShadow: connected ? "0 0 6px #44ff88" : "0 0 6px #ff5555" }} />
            {connected ? "متصل — بث مباشر" : "جاري الاتصال..."}
          </div>
        }
      />

      {/* ── System Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "المعالج", value: `${cpu}%`, subLabel: "CPU", icon: Cpu, color: cpu > 80 ? "#ff4444" : "#44eebb", gauge: cpu },
          { label: "الذاكرة", value: `${mem}%`, subLabel: "RAM", icon: MemoryStick, color: mem > 80 ? "#ff4444" : "#aa44ff", gauge: mem },
          { label: "وقت التشغيل", value: formatUptime(uptime), subLabel: dashboard?.system.hostname ?? "—", icon: Zap, color: "#ffaa44", gauge: null },
          { label: "التنبيهات", value: String(unread), subLabel: `${dashboard?.alerts.critical ?? 0} حرجة`, icon: Bell, color: unread > 0 ? "#ff4444" : "#44ff88", gauge: null },
        ].map(({ label, value, subLabel, icon: Icon, color, gauge }) => (
          <div key={label} className="rounded-xl p-4 space-y-2" style={NEON_CARD}>
            <div className="flex items-center gap-2 text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>
              <Icon className="w-4 h-4" style={{ color }} />{label}
            </div>
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 15px ${color}66` }}>{value}</div>
            {gauge !== null ? <GaugeBar value={gauge} /> : null}
            <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{subLabel}</div>
          </div>
        ))}
      </div>

      {/* ── Secondary Stats ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "البوت", icon: Bot, main: `${dashboard?.agent.activeSessions ?? 0} جلسة`, sub: `${dashboard?.agent.totalSessions ?? 0} إجمالي`, color: "#aa44ff" },
          { label: "العمليات", icon: Terminal, main: `${liveProcs.filter((p) => p.status === "running").length} جارية`, sub: `${liveProcs.length} إجمالي`, color: "#44ff88" },
          { label: "Cron Jobs", icon: Zap, main: `${dashboard?.cronJobs.enabled ?? 0} مفعّل`, sub: "مهام مجدولة", color: "#ffaa44" },
        ].map(({ label, icon: Icon, main, sub, color }) => (
          <div key={label} className="rounded-xl p-4" style={NEON_CARD}>
            <div className="flex items-center gap-2 mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>
              <Icon className="w-4 h-4" style={{ color }} />
              <span className="text-[9px] font-black font-mono uppercase">{label}</span>
            </div>
            <div className="text-lg font-black font-mono" style={{ color, textShadow: `0 0 12px ${color}44` }}>{main}</div>
            <div className="text-[9px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Log + Processes ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Event Log */}
        <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
          <div className="flex items-center justify-between">
            <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#44eebb", textShadow: "0 0 10px rgba(0,240,180,0.3)" }}>
              <Activity className="w-4 h-4" />سجل الأحداث اللحظي
            </h3>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: connected ? "#44ff88" : "#ff5555", boxShadow: connected ? "0 0 5px #44ff88" : "0 0 5px #ff5555", animation: "pulse 1.5s infinite" }} />
              <button onClick={() => setLogLines([])} className="transition-all" style={{ color: "rgba(255,255,255,0.3)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ff5555"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)"; }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="h-64 overflow-y-auto font-mono space-y-1 rounded-xl p-3" style={{ background: "rgba(0,5,0,0.8)", border: "1px solid rgba(0,200,100,0.08)", scrollbarWidth: "thin" }}>
            {logLines.length === 0 ? (
              <div className="text-center py-8 flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin opacity-30" style={{ color: "#44eebb" }} />
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>في انتظار الأحداث...</span>
              </div>
            ) : logLines.map((line, i) => (
              <div key={i} className="text-[10px] leading-relaxed" style={{ color: logColor(line) }}>{line}</div>
            ))}
          </div>
        </div>

        {/* Running Processes */}
        <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#44ff88" }}>
            <Terminal className="w-4 h-4" />العمليات الجارية
          </h3>
          <div className="h-64 overflow-y-auto space-y-2" style={{ scrollbarWidth: "thin" }}>
            {liveProcs.length === 0 ? (
              <div className="text-center text-[10px] font-mono py-8" style={{ color: "rgba(255,255,255,0.25)" }}>لا توجد عمليات جارية</div>
            ) : liveProcs.map((proc) => (
              <div key={proc.id} className="rounded-xl p-2.5 space-y-1" style={DARK}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${proc.status === "running" ? "animate-pulse" : ""}`}
                    style={{ background: proc.status === "running" ? "#44ff88" : "rgba(255,255,255,0.2)", boxShadow: proc.status === "running" ? "0 0 5px #44ff88" : "none" }} />
                  <span className="text-[10px] font-mono flex-1 truncate" style={{ color: "#44ff88" }}>{proc.command}</span>
                  <span className="text-[8px] font-black font-mono px-1.5 py-0.5 rounded"
                    style={proc.status === "running"
                      ? { background: "rgba(0,200,100,0.12)", border: "1px solid rgba(0,200,100,0.25)", color: "#44ff88" }
                      : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" }}>
                    {proc.status}
                  </span>
                </div>
                <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
                  ID: {proc.id} | {new Date(proc.startedAt).toLocaleTimeString("ar-EG")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Alerts ── */}
      <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
        <div className="flex items-center justify-between">
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ffaa44" }}>
            <Bell className={`w-4 h-4 ${unread > 0 ? "animate-pulse" : ""}`} style={{ color: unread > 0 ? "#ff4444" : "#ffaa44" }} />
            التنبيهات
            {unread > 0 && (
              <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                style={{ background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.4)", color: "#ff5555" }}>
                {unread} جديد
              </span>
            )}
          </h3>
          {unread > 0 && (
            <button onClick={markAllRead}
              className="text-[10px] font-mono flex items-center gap-1 transition-all"
              style={{ color: "rgba(255,255,255,0.35)" }}>
              <BellOff className="w-3 h-3" />تحديد الكل كمقروء
            </button>
          )}
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {alerts.length === 0 ? (
            <div className="text-center text-[10px] font-mono py-4 flex items-center justify-center gap-2">
              <CheckCircle className="w-4 h-4" style={{ color: "#44ff88" }} />
              <span style={{ color: "rgba(255,255,255,0.35)" }}>لا توجد تنبيهات</span>
            </div>
          ) : alerts.slice(0, 30).map((alert) => {
            const s = SEV_STYLE[alert.severity] ?? SEV_STYLE.info;
            return (
              <div key={alert.id}
                className="flex items-start gap-3 p-2.5 rounded-xl transition-all"
                style={alert.isRead === "false"
                  ? { background: s.bg, border: `1px solid ${s.border}` }
                  : { background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)", opacity: 0.4 }}>
                {(alert.severity === "critical" || alert.severity === "high")
                  ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: s.color }} />
                  : <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#44ff88" }} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-[11px] font-black truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{alert.title}</span>
                    <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded uppercase"
                      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>{alert.severity}</span>
                  </div>
                  <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{alert.message}</p>
                  <div className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                    {new Date(alert.createdAt).toLocaleString("ar-EG")} · {alert.source}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bot Activity ── */}
      <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
        <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#aa44ff" }}>
          <Bot className="w-4 h-4" />نشاط البوت الأخير
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {activity.length === 0 ? (
            <div className="text-center text-[10px] font-mono py-4" style={{ color: "rgba(255,255,255,0.25)" }}>لا يوجد نشاط حديث</div>
          ) : activity.slice(0, 20).map((msg) => (
            <div key={msg.id} className="flex items-start gap-2 p-2 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                style={{ background: msg.role === "user" ? "#44eebb" : msg.role === "tool" ? "#ffaa44" : "#aa44ff" }} />
              <div className="flex-1 min-w-0">
                {msg.toolName && (
                  <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded ml-1"
                    style={{ background: "rgba(255,170,0,0.1)", border: "1px solid rgba(255,170,0,0.2)", color: "#ffaa44" }}>
                    {msg.toolName}
                  </span>
                )}
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {msg.content.slice(0, 150)}{msg.content.length > 150 ? "..." : ""}
                </span>
                <div className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {new Date(msg.createdAt).toLocaleTimeString("ar-EG")} · {msg.role}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
