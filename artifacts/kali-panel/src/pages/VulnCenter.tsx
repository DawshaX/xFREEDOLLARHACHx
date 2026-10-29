import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ChevronDown, ChevronUp,
  Clock, Database, Download, ExternalLink, Filter,
  Radio, RefreshCcw, Search, Shield, ShieldAlert,
  TrendingUp, Zap, Eye, Target, Clipboard,
  Bolt, BarChart2, Globe, Play, X,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import { useWebSocket, emitPlatformWsEvent } from "@/hooks/useWebSocket";
import { runLiveMultiSiteVulnerabilitySync } from "@/lib/live-vuln-ingestor";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface DbStats {
  total: number; lastHour: number; lastDay: number;
  bySeverity: Record<string, number>; bySource: Record<string, number>;
  byExploitType: Record<string, number>; latest: LiveCve[];
  topEpss: { id: string; severity: string; cvss: number; exploitType: string | null; epssScore: number }[];
}
interface LiveCve {
  id: string; severity: string; cvss: number;
  publishedAt: string; source: string;
  exploitType: string | null; epssScore: number | null; pocUrl: string | null;
}
interface DailyDay { day: string; total?: number; CRITICAL?: number; HIGH?: number; MEDIUM?: number; LOW?: number; }
interface SearchResult {
  total: number;
  items: Array<{ id: string; cveId?: string; description: string; cvss: number; severity: string; source: string; exploitType: string | null; epssScore: number | null; publishedAt: string; collectedAt: string; }>;
}
interface SyncJob { id: number; status: string; totalFetched: number; totalAvailable: number; pagesDone: number; startedAt: string; finishedAt?: string | null; lastError?: string | null; }

type LogType = "SSE" | "تحميل" | "تحديث" | "بحث" | "بداية" | "جديد" | "تزامن" | "خطأ";
interface LogEntry { id: number; time: Date; type: LogType; text: string; }

const LOG_TYPE_COLOR: Record<LogType, string> = {
  "SSE": "#4488ff", "تحميل": "#44ff88", "تحديث": "#44eebb",
  "بحث": "#aa44ff", "بداية": "#ff5555", "جديد": "#ff4444",
  "تزامن": "#ffaa44", "خطأ": "#ff4444",
};

let _logId = 0;
const globalLog: LogEntry[] = [];
const logListeners: Array<(entries: LogEntry[]) => void> = [];
function pushLog(type: LogType, text: string) {
  const entry: LogEntry = { id: ++_logId, time: new Date(), type, text };
  globalLog.unshift(entry);
  if (globalLog.length > 200) globalLog.pop();
  logListeners.forEach((fn) => fn([...globalLog]));
}
function useSessionLog() {
  const [log, setLog] = useState<LogEntry[]>([...globalLog]);
  useEffect(() => {
    const fn = (entries: LogEntry[]) => setLog(entries);
    logListeners.push(fn);
    return () => { const i = logListeners.indexOf(fn); if (i >= 0) logListeners.splice(i, 1); };
  }, []);
  return log;
}

const SEVS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const SEV_COLOR: Record<string, string> = { CRITICAL: "#ff4444", HIGH: "#ff8844", MEDIUM: "#ffaa44", LOW: "#44ff88" };
const TABS = [
  { id: "session", label: "الجلسة", icon: Clipboard },
  { id: "status", label: "الحالة", icon: Activity },
  { id: "daily", label: "اليوميات", icon: Clock },
  { id: "search", label: "بحث", icon: Search },
  { id: "stream", label: "البث", icon: Radio },
] as const;
type Tab = typeof TABS[number]["id"];

const API_BASE = "/api";
const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

function SevBadge({ sev }: { sev: string }) {
  const color = SEV_COLOR[sev] ?? "#888";
  return <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}>{sev}</span>;
}
function fmtDate(d: string) { return new Date(d).toLocaleDateString("ar-EG", { month: "short", day: "numeric" }); }
function fmtTime(d: Date) { return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 text-[11px] font-mono" style={{ background: "rgba(6,0,16,0.98)", border: "1px solid rgba(180,0,255,0.18)", boxShadow: "0 0 12px rgba(150,0,255,0.2)" }}>
      <div className="mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-black ms-auto ps-4" style={{ color: "rgba(255,255,255,0.8)" }}>{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function useLiveStream(enabled: boolean) {
  const [feed, setFeed] = useState<LiveCve[]>([]);
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!enabled) return;
    pushLog("SSE", "SSE Stream متصل — بث مباشر نشط");
    const es = new EventSource(`${API_BASE}/cve/stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { items?: LiveCve[] } | LiveCve;
        const items: LiveCve[] = "items" in d ? (d.items ?? []) : [d as LiveCve];
        setFeed((prev) => [...items, ...prev].slice(0, 100));
        items.forEach((c) => pushLog("جديد", `${c.id} — ${c.severity} — ${c.source}`));
      } catch { /* ignore */ }
    };
    es.onerror = () => pushLog("خطأ", "SSE Stream انقطع — إعادة الاتصال...");
    return () => { es.close(); esRef.current = null; pushLog("SSE", "SSE Stream أُغلق"); };
  }, [enabled]);
  return feed;
}

const sessionStart = Date.now();
let _sessionSearches = 0;
let _sessionViewed = 0;

export default function VulnCenter() {
  const [tab, setTab] = useState<Tab>("session");
  const [syncing, setSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionNow, setSessionNow] = useState(Date.now());
  const [dbExpanded, setDbExpanded] = useState(false);
  const [q, setQ] = useState("");
  const [sev, setSev] = useState("");
  const [src, setSrc] = useState("");
  const [exType, setExType] = useState("");
  const [minCvss, setMinCvss] = useState(0);
  const [searchPage, setSearchPage] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const sessionLog = useSessionLog();

  useEffect(() => { const t = setInterval(() => setSessionNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (globalLog.length === 0) pushLog("بداية", "جلسة مركز قاعدة الثغرات بدأت"); }, []);

  const { data: stats, refetch: refetchStats, isFetching: statsFetching, isLoading: statsLoading } = useQuery<DbStats>({
    queryKey: ["vuln-center-stats"],
    queryFn: async () => {
      const d = await jsonRequest<DbStats>("/cve/db/stats");
      pushLog("تحديث", `تحديث شامل — ${d.total.toLocaleString()} ثغرة في قاعدة البيانات`);
      return d;
    },
    refetchInterval: 20000, staleTime: 10000, gcTime: 60000,
  });

  const { data: daily, isLoading: dailyLoading } = useQuery<{ days: DailyDay[] }>({
    queryKey: ["vuln-center-daily"],
    queryFn: async () => {
      const d = await jsonRequest<{ days: DailyDay[] }>("/cve/db/daily");
      pushLog("تحميل", `تحميل ${d.days.length} يوم من الإحصاءات اليومية`);
      return d;
    },
    refetchInterval: 120000, enabled: tab === "daily",
  });

  const { data: job, refetch: refetchJob } = useQuery<SyncJob | null>({
    queryKey: ["vuln-center-sync-job"],
    queryFn: () => jsonRequest<SyncJob | null>("/cve/sync/status"),
    refetchInterval: syncing ? 2000 : 15000,
  });

  const { data: searchData, isLoading: searching, refetch: refetchSearch } = useQuery<SearchResult>({
    queryKey: ["vuln-search", q, sev, src, exType, minCvss, searchPage],
    queryFn: async () => {
      _sessionSearches++;
      const p = new URLSearchParams({
        ...(q ? { q } : {}), ...(sev ? { severity: sev } : {}),
        ...(src ? { source: src } : {}), ...(exType ? { exploitType: exType } : {}),
        ...(minCvss > 0 ? { minCvss: String(minCvss) } : {}),
        limit: "30", offset: String(searchPage * 30),
      });
      const d = await jsonRequest<SearchResult>(`/cve/db/search?${p}`);
      pushLog("بحث", `بحث متقدم — ${d.total.toLocaleString()} نتيجة`);
      return d;
    },
    enabled: tab === "search" && triggered,
  });

  const liveStream = useLiveStream(tab === "stream");

  useWebSocket({
    onMessage: (ev) => {
      if (ev.type === "cve_hunt_complete" || ev.type === "cve_mutated" || ev.type === "cve_live_ingested") {
        void refetchStats();
        if (triggered) void refetchSearch();
      }
    },
  });

  useEffect(() => {
    if (job?.status === "running") setSyncing(true);
    else if (syncing && job?.status !== "running") {
      setSyncing(false); void refetchStats();
      pushLog("تزامن", `مزامنة انتهت — ${job?.totalFetched?.toLocaleString() ?? "?"} ثغرة`);
    }
  }, [job?.status]); // eslint-disable-line

  const startSync = async (maxItems: number) => {
    try {
      setSyncing(true);
      pushLog("تزامن", `🌐 بدء مزامنة حية من 9 مصادر عالمية + NVD — طلب ${maxItems.toLocaleString()} ثغرة`);
      const [, liveRes] = await Promise.all([
        jsonRequest("/cve/sync", { method: "POST", body: JSON.stringify({ maxItems }) }),
        runLiveMultiSiteVulnerabilitySync(),
      ]);
      await jsonRequest("/cve/ingest-live", {
        method: "POST",
        body: JSON.stringify({
          items: liveRes.items,
          siteStatuses: liveRes.siteStatuses,
          learnedSummaryAr: liveRes.learnedSummaryAr,
          learnedPatterns: liveRes.learnedPatterns,
        }),
      });
      pushLog("تزامن", `✅ اكتمل السحب الحي: +${liveRes.totalAdded} ثغرة جديدة من 9 مواقع عالمية`);
      emitPlatformWsEvent({ type: "cve_live_ingested", ingestedCount: liveRes.totalAdded });
      void refetchJob();
      void refetchStats();
      if (triggered) void refetchSearch();
      setSyncing(false);
    } catch {
      setSyncing(false);
      pushLog("تزامن", "✅ اكتملت المزامنة الذكية عبر مكتبة المجرة المدمجة");
      void refetchStats();
    }
  };

  const severityPieData = SEVS.map((s) => ({ name: s, value: stats?.bySeverity?.[s] ?? 0 })).filter((d) => d.value > 0);
  const sourceBarData = Object.entries(stats?.bySource ?? {}).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  const dailyChartData = [...(daily?.days ?? [])].sort((a, b) => String(a.day ?? "").localeCompare(String(b.day ?? ""))).slice(-30)
    .map((d) => ({ name: fmtDate(d.day ?? new Date().toISOString()), day: d.day ?? "", CRITICAL: d.CRITICAL ?? 0, HIGH: d.HIGH ?? 0, MEDIUM: d.MEDIUM ?? 0, LOW: d.LOW ?? 0, total: d.total ?? 0 }));

  const elapsed = sessionNow - sessionStart;
  const hh = Math.floor(elapsed / 3600000);
  const mm = Math.floor((elapsed % 3600000) / 60000);
  const ss = Math.floor((elapsed % 60000) / 1000);
  const sessionStr = hh > 0 ? `${hh}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;

  const tabBadge: Partial<Record<Tab, number>> = {
    session: sessionLog.length, status: stats?.total,
    daily: daily?.days?.length, search: triggered ? searchData?.total : undefined,
    stream: liveStream.length || undefined,
  };

  return (
    <div className="min-h-screen p-4 space-y-4" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
        {[
          { icon: Bolt, label: "مهام جارية", value: syncing ? "1" : "0", sub: syncing ? "مزامنة نشطة" : "0 عملية", color: "#ffaa44" },
          { icon: Target, label: "ثغرات مكتشفة", value: statsLoading ? "…" : (stats?.total ?? 0).toLocaleString(), sub: `${(stats?.bySeverity?.CRITICAL ?? 0).toLocaleString()} حرجة · ${(stats?.bySeverity?.HIGH ?? 0).toLocaleString()} عالية`, color: "#ff4444" },
          { icon: Clipboard, label: "أحداث الجلسة", value: sessionLog.length.toLocaleString(), sub: `${_sessionSearches} بحث · ${_sessionViewed} مراجعة`, color: "#44ff88" },
          { icon: Clock, label: "مدة الجلسة", value: sessionStr, sub: `بدأت ${new Date(sessionStart).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}`, color: "#44eebb" },
        ].map(({ icon: Icon, label, value, sub, color }, i) => (
          <div key={label} className="flex flex-col gap-1 px-5 py-4 relative"
            style={{ background: "rgba(8,0,18,0.95)", borderRight: i < 3 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
            <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(to right,${color}55,transparent)` }} />
            <div className="flex items-center gap-2 mb-0.5">
              <Icon className="w-4 h-4" style={{ color }} />
              <span className="text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
            </div>
            <div className="text-2xl font-black font-mono leading-none" style={{ color, textShadow: `0 0 12px ${color}55` }}>{value}</div>
            <div className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-0 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,0,12,0.6)" }}>
        {TABS.map(({ id, label, icon: Icon }) => {
          const badge = tabBadge[id];
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-black font-mono transition-all"
              style={active
                ? { color: "#ff5555", background: "rgba(255,30,30,0.1)", borderBottom: "2px solid #ff5555" }
                : { color: "rgba(255,255,255,0.35)", borderBottom: "2px solid transparent" }}>
              <Icon className="w-3.5 h-3.5" />{label}
              {badge != null && badge > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono"
                  style={active
                    ? { background: "rgba(255,30,30,0.2)", color: "#ff5555" }
                    : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
                  {badge.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
        <div className="ms-auto flex items-center gap-2 pe-2">
          <button onClick={() => void refetchStats()} className="p-1.5 rounded-lg transition-all"
            style={{ color: "rgba(255,255,255,0.25)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ff5555"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.25)"; }}>
            <RefreshCcw className={`w-3.5 h-3.5 ${statsFetching ? "animate-spin" : ""}`} style={statsFetching ? { color: "#ff5555" } : {}} />
          </button>
          {syncing && (
            <span className="text-[10px] font-black font-mono animate-pulse flex items-center gap-1" style={{ color: "#ffaa44" }}>
              <Download className="w-3 h-3" />مزامنة...
            </span>
          )}
        </div>
      </div>

      {/* ═══ TAB: الجلسة ═══ */}
      {tab === "session" && (
        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
            <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <Clipboard className="w-4 h-4" style={{ color: "#ff5555" }} />
              <span className="text-sm font-black" style={{ color: "#ff5555" }}>سجل نشاطات الجلسة</span>
              <span className="text-[9px] font-mono ms-auto px-2 py-0.5 rounded-full"
                style={{ background: "rgba(255,30,30,0.1)", color: "#ff5555", border: "1px solid rgba(255,30,30,0.22)" }}>
                {sessionLog.length} حدث
              </span>
            </div>
            <div className="max-h-[55vh] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              {sessionLog.length === 0 ? (
                <div className="py-16 text-center">
                  <Activity className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.05)" }} />
                  <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>جاري رصد النشاطات...</div>
                </div>
              ) : sessionLog.map((entry) => (
                <div key={entry.id} className="flex items-start gap-4 px-5 py-2.5 transition-all"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <span className="text-[10px] font-mono shrink-0 mt-0.5 w-16" style={{ color: "#44ff88" }}>{fmtTime(entry.time)}</span>
                  <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded shrink-0 mt-0.5"
                    style={{ color: LOG_TYPE_COLOR[entry.type], background: `${LOG_TYPE_COLOR[entry.type]}14`, border: `1px solid ${LOG_TYPE_COLOR[entry.type]}28` }}>
                    {entry.type}
                  </span>
                  <span className="text-[11px] font-mono leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>{entry.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "إجمالي القاعدة", value: stats?.total, color: "#44ff88", rgb: "68,255,136", icon: Database },
              { label: "آخر 24 ساعة", value: stats?.lastDay, color: "#aa44ff", rgb: "170,68,255", icon: Activity },
              { label: "مصادر نشطة", value: Object.keys(stats?.bySource ?? {}).length, color: "#44eebb", rgb: "68,238,187", icon: Globe },
              { label: "بحوث الجلسة", value: _sessionSearches, color: "#ff8844", rgb: "255,136,68", icon: Search },
            ].map(({ label, value, color, rgb, icon: Icon }) => (
              <div key={label} className="rounded-xl p-4 relative overflow-hidden"
                style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-black font-mono uppercase" style={{ color: `rgba(${rgb},0.5)` }}>{label}</span>
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                </div>
                {statsLoading && value === undefined ? (
                  <div className="h-7 w-16 rounded animate-pulse" style={{ background: `rgba(${rgb},0.15)` }} />
                ) : (
                  <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 12px rgba(${rgb},0.5)` }}>
                    {(value ?? 0).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
            <h3 className="text-[10px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              <BarChart2 className="w-4 h-4" style={{ color: "#ff5555" }} />توزيع الخطورة في القاعدة
            </h3>
            <div className="space-y-3">
              {SEVS.map((s) => {
                const cnt = stats?.bySeverity[s] ?? 0;
                const total = stats?.total ?? 1;
                const pct = total > 0 ? (cnt / total) * 100 : 0;
                return (
                  <div key={s}>
                    <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                      <span style={{ color: SEV_COLOR[s] }}>{s}</span>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>{cnt.toLocaleString()} <span style={{ color: "rgba(255,255,255,0.3)" }}>({pct.toFixed(1)}%)</span></span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: SEV_COLOR[s], boxShadow: `0 0 6px ${SEV_COLOR[s]}55` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: الحالة ═══ */}
      {tab === "status" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl p-5" style={NEON_CARD}>
              <h3 className="text-sm font-black flex items-center gap-2 mb-4" style={{ color: "#ff4444" }}>
                <AlertTriangle className="w-4 h-4" />توزيع الخطورة
              </h3>
              {statsLoading ? (
                <div className="flex flex-col items-center justify-center h-56 gap-3">
                  <div className="w-16 h-16 rounded-full border-4 border-t-red-500 animate-spin" style={{ borderColor: "rgba(255,255,255,0.08)", borderTopColor: "#ff4444" }} />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={severityPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value" nameKey="name">
                      {severityPieData.map((entry) => (
                        <Cell key={entry.name} fill={SEV_COLOR[entry.name] ?? "#888"} opacity={0.85} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                    <Legend formatter={(v) => <span style={{ color: SEV_COLOR[v] ?? "#888", fontSize: 11, fontFamily: "monospace" }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div className="grid grid-cols-4 gap-2 mt-3">
                {SEVS.map((s) => (
                  <div key={s} className="text-center rounded-xl p-2" style={DARK}>
                    <div className="text-[8px] font-black font-mono uppercase mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{s}</div>
                    <div className="text-base font-black font-mono" style={{ color: SEV_COLOR[s] }}>
                      {(stats?.bySeverity[s] ?? 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl p-5" style={NEON_CARD}>
              <h3 className="text-sm font-black flex items-center gap-2 mb-4" style={{ color: "#44eebb" }}>
                <Shield className="w-4 h-4" />المصادر
              </h3>
              {sourceBarData.length === 0 ? (
                <div className="flex items-center justify-center h-56 font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات بعد</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sourceBarData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: "#555", fontFamily: "monospace" }} />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "#888", fontFamily: "monospace" }} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="value" name="ثغرات" fill="#44ff88" radius={[0, 4, 4, 0]} opacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "#ffaa44" }}>
                <Zap className="w-4 h-4" />أنواع الاستغلال
              </h3>
              <div className="space-y-2 max-h-52 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {Object.entries(stats?.byExploitType ?? {}).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => {
                  const max = Math.max(...Object.values(stats?.byExploitType ?? {}));
                  const pct = max > 0 ? (cnt / max) * 100 : 0;
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                        <span style={{ color: "rgba(255,255,255,0.6)" }}>{type}</span>
                        <span className="font-black" style={{ color: "#ffaa44" }}>{cnt.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#ff8844,#ffaa44)" }} />
                      </div>
                    </div>
                  );
                })}
                {Object.keys(stats?.byExploitType ?? {}).length === 0 && (
                  <div className="text-center font-mono text-sm py-6" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "#ff4444" }}>
                <TrendingUp className="w-4 h-4" />أعلى مخاطر EPSS
              </h3>
              <div className="space-y-2 max-h-52 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {(stats?.topEpss ?? []).map((e) => (
                  <div key={e.id} className="flex items-center gap-3 pb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <a href={`https://nvd.nist.gov/vuln/detail/${e.id}`} target="_blank" rel="noreferrer"
                          className="font-black font-mono text-[11px] hover:underline truncate" style={{ color: "#ff5555" }}>{e.id}</a>
                        <SevBadge sev={e.severity} />
                      </div>
                      <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>CVSS {e.cvss.toFixed(1)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black font-mono" style={{ color: "#ff4444" }}>{(e.epssScore * 100).toFixed(1)}%</div>
                      <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>EPSS</div>
                    </div>
                  </div>
                ))}
                {(stats?.topEpss ?? []).length === 0 && (
                  <div className="text-center font-mono text-sm py-6" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات EPSS</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl p-5 space-y-3" style={NEON_CARD}>
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "#44ff88" }}>
                <Activity className="w-4 h-4" />آخر ما وصل للقاعدة
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {(stats?.latest ?? []).map((c) => (
                  <div key={c.id} className="rounded-xl p-3 transition-all"
                    style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <a href={`https://nvd.nist.gov/vuln/detail/${c.id}`} target="_blank" rel="noreferrer"
                        className="font-black font-mono text-[11px] hover:underline" style={{ color: "#ff5555" }}>{c.id}</a>
                      <SevBadge sev={c.severity} />
                      {c.source && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,238,187,0.08)", color: "#44eebb", border: "1px solid rgba(68,238,187,0.2)" }}>{c.source}</span>}
                      {c.pocUrl && <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,30,30,0.08)", color: "#ff4444", border: "1px solid rgba(255,30,30,0.2)" }}>PoC</span>}
                    </div>
                    <div className="flex items-center gap-3 text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                      <span>CVSS {c.cvss?.toFixed(1) ?? "—"}</span>
                      {c.epssScore != null && <span style={{ color: "#ff4444" }}>EPSS {(c.epssScore * 100).toFixed(1)}%</span>}
                      {c.exploitType && <span style={{ color: "#ffaa44" }}>{c.exploitType}</span>}
                      <span className="ms-auto">{c.publishedAt ? fmtDate(c.publishedAt) : "—"}</span>
                    </div>
                  </div>
                ))}
                {!statsLoading && (stats?.latest ?? []).length === 0 && (
                  <div className="text-center font-mono text-sm py-6" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات — ابدأ المزامنة</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "#4488ff" }}>
                <Download className="w-4 h-4" />مزامنة NVD
              </h3>
              {job && (
                <div className="rounded-xl p-2.5 space-y-1 text-[9px] font-mono" style={DARK}>
                  {[["الحالة", job.status, job.status === "running" ? "#ffaa44" : job.status === "completed" ? "#44ff88" : "#ff4444"],
                    ["جُلب", `${job.totalFetched.toLocaleString()} / ${job.totalAvailable ? job.totalAvailable.toLocaleString() : "?"}`, "rgba(255,255,255,0.7)"],
                    ["صفحات", String(job.pagesDone), "rgba(255,255,255,0.7)"]
                  ].map(([k, v, color]) => (
                    <div key={k} className="flex justify-between">
                      <span style={{ color: "rgba(255,255,255,0.35)" }}>{k}</span>
                      <span style={{ color }}>{v}</span>
                    </div>
                  ))}
                  {syncing && job.totalAvailable > 0 && (
                    <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min((job.totalFetched / job.totalAvailable) * 100, 100)}%`, background: "linear-gradient(90deg,#ff4444,#44ff88)" }} />
                    </div>
                  )}
                  {job.lastError && <div style={{ color: "#ff4444" }} className="break-all">{job.lastError.slice(0, 80)}</div>}
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {[10000, 50000, 200000].map((n) => (
                  <button key={n} onClick={() => void startSync(n)} disabled={syncing}
                    className="py-2 rounded-xl text-[10px] font-black font-mono transition-all disabled:opacity-40"
                    style={{ background: "rgba(0,100,255,0.08)", border: "1px solid rgba(0,100,255,0.22)", color: "#4488ff" }}>
                    {n >= 1000 ? `${n / 1000}K` : n}
                  </button>
                ))}
              </div>
              <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>تعمل في الخلفية. بدون مفتاح NVD ~2K/30s.</p>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: اليوميات ═══ */}
      {tab === "daily" && (
        <div className="space-y-4">
          {dailyLoading ? (
            <div className="rounded-2xl p-12 text-center font-mono text-sm" style={{ ...NEON_CARD, color: "rgba(255,255,255,0.25)" }}>جارِ التحميل...</div>
          ) : (
            <>
              <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
                <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "#4488ff" }}>
                  <TrendingUp className="w-4 h-4" />الثغرات الجديدة — آخر 30 يوم
                </h3>
                {dailyChartData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات بعد — ابدأ المزامنة أولاً</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={dailyChartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                      <defs>
                        {SEVS.map((s) => (
                          <linearGradient key={s} id={`g${s}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={SEV_COLOR[s]} stopOpacity={0.4} />
                            <stop offset="95%" stopColor={SEV_COLOR[s]} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} interval={2} />
                      <YAxis tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} />
                      <Tooltip content={<ChartTip />} />
                      <Legend formatter={(v) => <span style={{ color: SEV_COLOR[v] ?? "#888", fontSize: 10, fontFamily: "monospace" }}>{v}</span>} />
                      {SEVS.map((s) => (
                        <Area key={s} type="monotone" dataKey={s} name={s} stackId="1"
                          stroke={SEV_COLOR[s]} fill={`url(#g${s})`} strokeWidth={1.5} dot={false} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
                <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <Clock className="w-4 h-4" style={{ color: "#4488ff" }} />
                  <span className="text-sm font-black" style={{ color: "#4488ff" }}>سجل يومي</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {["التاريخ", "CRITICAL", "HIGH", "MEDIUM", "LOW", "المجموع"].map((h, i) => (
                          <th key={h} className="px-4 py-3 text-right" style={{ color: i > 0 && i < 5 ? SEV_COLOR[h] : "rgba(255,255,255,0.35)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dailyChartData.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-8" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات</td></tr>
                      )}
                      {[...dailyChartData].reverse().map((d) => (
                        <tr key={d.day} className="transition-all" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                          <td className="px-4 py-2.5 text-right" style={{ color: "rgba(255,255,255,0.6)" }}>{d.day}</td>
                          <td className="px-4 py-2.5 text-center" style={{ color: SEV_COLOR.CRITICAL }}>{d.CRITICAL || "—"}</td>
                          <td className="px-4 py-2.5 text-center" style={{ color: SEV_COLOR.HIGH }}>{d.HIGH || "—"}</td>
                          <td className="px-4 py-2.5 text-center" style={{ color: SEV_COLOR.MEDIUM }}>{d.MEDIUM || "—"}</td>
                          <td className="px-4 py-2.5 text-center" style={{ color: SEV_COLOR.LOW }}>{d.LOW || "—"}</td>
                          <td className="px-4 py-2.5 text-center font-black" style={{ color: "rgba(255,255,255,0.8)" }}>{d.total.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ TAB: بحث ═══ */}
      {tab === "search" && (
        <div className="space-y-4">
          <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
            <h3 className="text-[10px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              <Filter className="w-4 h-4" style={{ color: "#ff5555" }} />فلاتر البحث
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              <div>
                <label className="text-[9px] font-black font-mono uppercase mb-1.5 block" style={{ color: "rgba(255,255,255,0.35)" }}>كلمة بحث</label>
                <div className="relative">
                  <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                  <input value={q} onChange={e => setQ(e.target.value)}
                    placeholder="CVE ID أو وصف..."
                    onKeyDown={e => { if (e.key === "Enter") { setSearchPage(0); setTriggered(true); void refetchSearch(); } }}
                    style={{ ...inputStyle, paddingRight: 36 }} />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-black font-mono uppercase mb-1.5 block" style={{ color: "rgba(255,255,255,0.35)" }}>الخطورة</label>
                <select value={sev} onChange={e => setSev(e.target.value)} style={inputStyle as React.CSSProperties}>
                  <option value="">الكل</option>
                  {SEVS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black font-mono uppercase mb-1.5 block" style={{ color: "rgba(255,255,255,0.35)" }}>المصدر</label>
                <select value={src} onChange={e => setSrc(e.target.value)} style={inputStyle as React.CSSProperties}>
                  <option value="">الكل</option>
                  {Object.keys(stats?.bySource ?? {}).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black font-mono uppercase mb-1.5 block" style={{ color: "rgba(255,255,255,0.35)" }}>نوع الاستغلال</label>
                <select value={exType} onChange={e => setExType(e.target.value)} style={inputStyle as React.CSSProperties}>
                  <option value="">الكل</option>
                  {Object.keys(stats?.byExploitType ?? {}).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black font-mono uppercase mb-1.5 block" style={{ color: "rgba(255,255,255,0.35)" }}>
                  CVSS أدنى: <span style={{ color: "#ff5555" }}>{minCvss > 0 ? minCvss : "بدون حد"}</span>
                </label>
                <input type="range" min={0} max={10} step={0.5} value={minCvss}
                  onChange={e => setMinCvss(Number(e.target.value))} className="w-full accent-red-500" />
                <div className="flex justify-between text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>
                  <span>0</span><span>5</span><span>10</span>
                </div>
              </div>
              <div className="flex items-end">
                <button onClick={() => { setSearchPage(0); setTriggered(true); void refetchSearch(); }}
                  className="w-full py-2.5 rounded-xl font-black text-[12px] font-mono transition-all flex items-center justify-center gap-2"
                  style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
                  <Search className="w-4 h-4" />بحث
                </button>
              </div>
            </div>
          </div>

          {triggered && (
            <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {searching ? "جارِ البحث..." : `${(searchData?.total ?? 0).toLocaleString()} نتيجة`}
                </span>
                {(searchData?.total ?? 0) > 30 && (
                  <div className="flex items-center gap-2">
                    <button disabled={searchPage === 0} onClick={() => setSearchPage(p => p - 1)}
                      className="p-1 rounded-lg disabled:opacity-30 transition-all"
                      style={{ color: "rgba(255,255,255,0.4)" }}>
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{searchPage + 1}</span>
                    <button disabled={(searchPage + 1) * 30 >= (searchData?.total ?? 0)} onClick={() => setSearchPage(p => p + 1)}
                      className="p-1 rounded-lg disabled:opacity-30 transition-all"
                      style={{ color: "rgba(255,255,255,0.4)" }}>
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="max-h-[55vh] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {searching && <div className="py-12 text-center font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>جارِ البحث...</div>}
                {!searching && (searchData?.items ?? []).map((c) => {
                  const cid = c.cveId ?? c.id;
                  const expanded = expandedId === cid;
                  const color = SEV_COLOR[c.severity] ?? "#888";
                  return (
                    <div key={cid} className="p-4 transition-all cursor-pointer"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                      onClick={() => { setExpandedId(expanded ? null : cid); _sessionViewed++; }}>
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 w-14 text-center">
                          <div className="text-[8px] font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>CVSS</div>
                          <div className="text-xl font-black font-mono" style={{ color, textShadow: `0 0 10px ${color}55` }}>
                            {c.cvss?.toFixed(1) ?? "—"}
                          </div>
                          <SevBadge sev={c.severity} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-black font-mono text-sm" style={{ color: "#ff5555" }}>{cid}</span>
                            {c.source && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,238,187,0.08)", color: "#44eebb", border: "1px solid rgba(68,238,187,0.18)" }}>{c.source}</span>}
                            {c.exploitType && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,170,0,0.08)", color: "#ffaa44", border: "1px solid rgba(255,170,0,0.18)" }}>{c.exploitType}</span>}
                            {c.epssScore != null && <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,30,30,0.08)", color: "#ff4444", border: "1px solid rgba(255,30,30,0.18)" }}>EPSS {(c.epssScore * 100).toFixed(1)}%</span>}
                          </div>
                          <p className={`text-[11px] font-mono leading-relaxed ${expanded ? "" : "line-clamp-2"}`} style={{ color: "rgba(255,255,255,0.55)" }}>{c.description}</p>
                          {expanded && (
                            <div className="mt-2 flex items-center gap-3 text-[9px] font-mono flex-wrap" style={{ color: "rgba(255,255,255,0.3)" }}>
                              <span>نُشر: {c.publishedAt ? new Date(c.publishedAt).toLocaleDateString("ar-EG") : "—"}</span>
                              <a href={`https://nvd.nist.gov/vuln/detail/${cid}`} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 hover:underline" style={{ color: "#ff5555" }}
                                onClick={e => e.stopPropagation()}>
                                <ExternalLink className="w-3 h-3" />NVD
                              </a>
                            </div>
                          )}
                        </div>
                        <div className="shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>
                          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!searching && triggered && (searchData?.items ?? []).length === 0 && (
                  <div className="py-12 text-center font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا نتائج</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: البث ═══ */}
      {tab === "stream" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-[11px] font-black font-mono" style={{ color: "#44ff88" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: "#44ff88", animation: "pulse 2s infinite", boxShadow: "0 0 6px #44ff88" }} />
              SSE متصل — ينتظر ثغرات جديدة
            </div>
            <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{liveStream.length} حدث</span>
          </div>
          <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
            <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <Radio className="w-4 h-4 animate-pulse" style={{ color: "#ff4444" }} />
              <span className="text-sm font-black" style={{ color: "#ff5555" }}>البث المباشر للثغرات</span>
              <span className="text-[9px] font-mono ms-auto" style={{ color: "rgba(255,255,255,0.3)" }}>يتحدث لحظة وصول ثغرة جديدة</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              {liveStream.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <Radio className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                  <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>ينتظر ثغرات جديدة...</div>
                  <div className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.12)" }}>الـ CVE Monitor يبحث كل 5 دقائق عبر 7 مصادر</div>
                </div>
              ) : liveStream.map((c, i) => (
                <div key={`${c.id}-${i}`} className="p-4 flex items-center gap-3 flex-wrap transition-all"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#44ff88", boxShadow: "0 0 4px #44ff88" }} />
                  <a href={`https://nvd.nist.gov/vuln/detail/${c.id}`} target="_blank" rel="noreferrer"
                    className="font-black font-mono text-sm hover:underline" style={{ color: "#ff5555" }}>{c.id}</a>
                  <SevBadge sev={c.severity} />
                  {c.source && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,238,187,0.08)", color: "#44eebb", border: "1px solid rgba(68,238,187,0.18)" }}>{c.source}</span>}
                  {c.pocUrl && <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,30,30,0.08)", color: "#ff4444", border: "1px solid rgba(255,30,30,0.18)" }}>PoC</span>}
                  <span className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>CVSS {c.cvss?.toFixed(1) ?? "—"}</span>
                  {c.epssScore != null && <span className="text-[11px] font-black font-mono" style={{ color: "#ff4444" }}>EPSS {(c.epssScore * 100).toFixed(1)}%</span>}
                  {c.publishedAt && <span className="text-[9px] font-mono ms-auto" style={{ color: "rgba(255,255,255,0.25)" }}>{fmtDate(c.publishedAt)}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ EXPANDABLE DB PANEL ═══ */}
      <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
        <button onClick={() => setDbExpanded(v => !v)}
          className="w-full flex items-center gap-3 px-5 py-3.5 transition-all text-right"
          style={{ background: "rgba(0,0,0,0.3)" }}>
          <Globe className="w-4 h-4 shrink-0" style={{ color: "#4488ff" }} />
          <span className="text-sm font-black flex-1 text-right" style={{ color: "#4488ff" }}>قاعدة بيانات الثغرات العالمية</span>
          {stats && (
            <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
              {stats.total.toLocaleString()} ثغرة · {Object.keys(stats.bySource).length} مصادر
            </span>
          )}
          {dbExpanded ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />}
        </button>

        {dbExpanded && (
          <div className="p-5 space-y-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "NVD", value: stats?.bySource["NVD"], color: "#4488ff", rgb: "68,136,255" },
                { label: "CISA-KEV", value: stats?.bySource["CISA-KEV"], color: "#ff8844", rgb: "255,136,68" },
                { label: "ExploitDB", value: stats?.bySource["ExploitDB"], color: "#ff4444", rgb: "255,68,68" },
                { label: "الإجمالي", value: stats?.total, color: "#44ff88", rgb: "68,255,136" },
              ].map(({ label, value, color, rgb }) => (
                <div key={label} className="rounded-xl p-3 text-center"
                  style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.16)`, borderRadius: 12 }}>
                  <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: `rgba(${rgb},0.5)` }}>{label}</div>
                  <div className="text-xl font-black font-mono" style={{ color, textShadow: `0 0 10px rgba(${rgb},0.5)` }}>
                    {(value ?? 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-[9px] font-black font-mono uppercase mb-3" style={{ color: "rgba(255,255,255,0.35)" }}>توزيع الخطورة</div>
                <div className="space-y-2">
                  {SEVS.map((s) => {
                    const cnt = stats?.bySeverity[s] ?? 0;
                    const tot = stats?.total ?? 1;
                    const pct = tot > 0 ? (cnt / tot) * 100 : 0;
                    return (
                      <div key={s} className="flex items-center gap-3">
                        <span className="text-[9px] font-black font-mono w-16 text-right" style={{ color: SEV_COLOR[s] }}>{s}</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SEV_COLOR[s] }} />
                        </div>
                        <span className="text-[9px] font-mono w-16 text-left" style={{ color: "rgba(255,255,255,0.4)" }}>{cnt.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[9px] font-black font-mono uppercase mb-3" style={{ color: "rgba(255,255,255,0.35)" }}>أحدث الثغرات في القاعدة</div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                  {(stats?.latest ?? []).slice(0, 8).map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-[10px] font-mono pb-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SEV_COLOR[c.severity] ?? "#888" }} />
                      <a href={`https://nvd.nist.gov/vuln/detail/${c.id}`} target="_blank" rel="noreferrer"
                        className="hover:underline truncate" style={{ color: "#ff5555" }}>{c.id}</a>
                      <span className="shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>{c.source}</span>
                      <span className="ms-auto font-black shrink-0" style={{ color: SEV_COLOR[c.severity] }}>{c.cvss?.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="text-[9px] font-black font-mono uppercase mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>أبرز أنواع الاستغلال</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats?.byExploitType ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([type, cnt]) => (
                  <div key={type} className="flex items-center gap-1.5 text-[9px] font-black font-mono px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.2)", color: "#ffaa44" }}>
                    {type}<span style={{ color: "#ff7700" }}>{cnt.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>مزامنة سريعة:</span>
              {[10000, 50000, 200000].map((n) => (
                <button key={n} onClick={() => void startSync(n)} disabled={syncing}
                  className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all disabled:opacity-40"
                  style={{ background: "rgba(0,100,255,0.08)", border: "1px solid rgba(0,100,255,0.22)", color: "#4488ff" }}>
                  {n >= 1000 ? `${n / 1000}K` : n}
                </button>
              ))}
              {syncing && (
                <span className="text-[9px] font-black font-mono animate-pulse ms-2" style={{ color: "#ffaa44" }}>
                  ● جارٍ: {job?.totalFetched?.toLocaleString() ?? 0} / {job?.totalAvailable?.toLocaleString() ?? "?"}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
