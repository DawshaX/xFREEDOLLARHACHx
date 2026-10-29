import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Bug, ChevronDown, ChevronUp,
  Database, Download, ExternalLink, FileText, Globe,
  LayoutDashboard, MessageSquare, Shield, ShieldAlert,
  TrendingUp, Zap, Skull,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import { useState } from "react";

interface Stats {
  criticalCves: number; highCves: number; totalScans: number;
  agentTasks: number; completedTasks: number; filesStored: number; conversations: number;
}
interface Cve { id: string; description: string; cvss: number; severity: string; publishedAt: string; url: string; }
interface DbStats {
  total: number; lastHour: number; lastDay: number;
  bySeverity: Record<string, number>; bySource: Record<string, number>;
  byExploitType: Record<string, number>;
  latest: Array<{ id: string; severity: string; cvss: number; publishedAt: string; source: string; exploitType: string | null; epssScore: number | null; pocUrl: string | null }>;
  topEpss: Array<{ id: string; severity: string; cvss: number; exploitType: string | null; epssScore: number }>;
}
interface SyncJob { id: number; status: string; totalFetched: number; totalAvailable: number; pagesDone: number; startedAt: string; finishedAt?: string | null; lastError?: string | null; }

const SEV_COLOR: Record<string, string> = { CRITICAL: "#ff4444", HIGH: "#ff8844", MEDIUM: "#ffaa44", LOW: "#44ff88" };
const SEVS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };

function SevBadge({ sev }: { sev: string }) {
  const color = SEV_COLOR[sev] ?? "#888";
  return <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}>{sev}</span>;
}

export default function Dashboard() {
  const [syncing, setSyncing] = useState(false);
  const [dbOpen, setDbOpen] = useState(true);

  const { data: stats } = useQuery<Stats>({ queryKey: ["dashboard-stats"], queryFn: () => jsonRequest<Stats>("/stats/dashboard"), refetchInterval: 30000 });
  const { data: recentCves } = useQuery<Cve[]>({ queryKey: ["recent-cves-dash"], queryFn: () => jsonRequest<Cve[]>("/cve/recent?severity=CRITICAL&limit=5"), refetchInterval: 60000 });
  const { data: dbStats, isLoading: dbLoading } = useQuery<DbStats>({ queryKey: ["dashboard-db-stats"], queryFn: () => jsonRequest<DbStats>("/cve/db/stats"), refetchInterval: 30000, staleTime: 15000 });
  const { data: job, refetch: refetchJob } = useQuery<SyncJob | null>({ queryKey: ["dashboard-sync-job"], queryFn: () => jsonRequest<SyncJob | null>("/cve/sync/status"), refetchInterval: syncing ? 2000 : 30000 });

  const startSync = async (maxItems: number) => {
    try { await jsonRequest("/cve/sync", { method: "POST", body: JSON.stringify({ maxItems }) }); setSyncing(true); void refetchJob(); }
    catch { /* ignore */ }
  };

  const sourceEntries = Object.entries(dbStats?.bySource ?? {}).sort((a, b) => b[1] - a[1]);

  const statCards = [
    { testId: "stat-critical", label: "ثغرات حرجة", value: stats?.criticalCves?.toLocaleString() ?? "—", icon: AlertTriangle, color: "#ff4444", rgb: "255,68,68", hint: "CRITICAL في NVD" },
    { testId: "stat-high", label: "ثغرات عالية", value: stats?.highCves?.toLocaleString() ?? "—", icon: ShieldAlert, color: "#ff8844", rgb: "255,136,68", hint: "HIGH في NVD" },
    { testId: "stat-tasks", label: "مهام الوكيل", value: stats?.agentTasks ?? "—", icon: Shield, color: "#aa44ff", rgb: "170,68,255", hint: `${stats?.completedTasks ?? 0} مكتملة` },
    { testId: "stat-files", label: "ملفات مخزنة", value: stats?.filesStored ?? "—", icon: FileText, color: "#44ff88", rgb: "68,255,136" },
    { testId: "stat-convos", label: "محادثات AI", value: stats?.conversations ?? "—", icon: MessageSquare, color: "#44eebb", rgb: "68,238,187" },
    { testId: "stat-scans", label: "عمليات الفحص", value: stats?.totalScans ?? "—", icon: Database, color: "#4488ff", rgb: "68,136,255" },
    { testId: "stat-bugs", label: "حالة النظام", value: "متصل", icon: Bug, color: "#44ff88", rgb: "68,255,136", hint: "جميع الخدمات تعمل" },
    { testId: "stat-shield", label: "حالة الحماية", value: "آمن", icon: Shield, color: "#44ff88", rgb: "68,255,136" },
  ];

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ لوحة التحكم" subtitle="نظرة عامة على نشاط المنصة الأمنية والذكاء الاصطناعي" icon={LayoutDashboard} danger />

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map(({ testId, label, value, icon: Icon, color, rgb, hint }) => (
          <div key={testId} data-testid={testId} className="rounded-2xl p-4 relative overflow-hidden"
            style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.2)`, boxShadow: `0 0 18px rgba(${rgb},0.04)` }}>
            <div className="absolute top-0 left-0 right-0 h-px"
              style={{ background: `linear-gradient(90deg,transparent,rgba(${rgb},0.6) 50%,transparent)` }} />
            <div className="flex items-start justify-between mb-2">
              <span className="text-[9px] font-black font-mono uppercase" style={{ color: `rgba(${rgb},0.5)` }}>{label}</span>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 14px rgba(${rgb},0.55)` }}>{value}</div>
            {hint && <div className="text-[9px] font-mono mt-1" style={{ color: `rgba(${rgb},0.45)` }}>{hint}</div>}
          </div>
        ))}
      </div>

      {/* ── Recent CVEs + Module status ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl p-5 space-y-3" style={NEON_CARD}>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black flex items-center gap-2" style={{ color: "#ff4444", textShadow: "0 0 10px rgba(255,30,30,0.4)" }}>
              <AlertTriangle className="w-5 h-5" />أحدث الثغرات الحرجة
            </h3>
            <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>تحديث تلقائي · NVD Live</span>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto" data-testid="dash-recent-cves" style={{ scrollbarWidth: "thin" }}>
            {recentCves?.map((c) => (
              <div key={c.id} className="rounded-xl p-3 transition-all"
                style={{ background: "rgba(255,30,30,0.04)", border: "1px solid rgba(255,30,30,0.12)" }}>
                <div className="flex items-center justify-between mb-1">
                  <a href={c.url} target="_blank" rel="noreferrer"
                    className="font-black text-sm font-mono transition-all hover:underline" style={{ color: "#ff5555" }}>{c.id}</a>
                  <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded"
                    style={{ background: c.severity === "CRITICAL" ? "rgba(255,30,30,0.12)" : "rgba(255,150,0,0.1)", color: c.severity === "CRITICAL" ? "#ff4444" : "#ffaa44" }}>
                    {c.severity} · {c.cvss}
                  </span>
                </div>
                <p className="text-[10px] font-mono line-clamp-2" style={{ color: "rgba(255,255,255,0.4)" }}>{c.description}</p>
              </div>
            )) ?? (
              <div className="text-sm font-mono text-center py-8" style={{ color: "rgba(255,255,255,0.25)" }}>جارِ التحميل من NVD...</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
          <h3 className="text-base font-black" style={{ color: "#44eebb" }}>حالة الوحدات</h3>
          <div className="space-y-2">
            {[
              { name: "AI Agent v3", status: "online" },
              { name: "محرك CVE", status: "online" },
              { name: "فاحص المواقع", status: "online" },
              { name: "Ollama dolphin-llama3", status: "online" },
              { name: "PostgreSQL", status: "online" },
              { name: "محرك التقارير", status: "ready" },
              { name: "Terminal الافتراضي", status: "ready" },
            ].map((m) => (
              <div key={m.name} className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.65)" }}>{m.name}</span>
                <span className="flex items-center gap-1.5 text-[9px] font-black font-mono uppercase"
                  style={{ color: m.status === "online" ? "#44ff88" : "#44eebb" }}>
                  <span className="w-1.5 h-1.5 rounded-full"
                    style={{ background: m.status === "online" ? "#44ff88" : "#44eebb", animation: "pulse 2s infinite", boxShadow: m.status === "online" ? "0 0 5px #44ff88" : "none" }} />
                  {m.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Global CVE Database ── */}
      <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
        <button onClick={() => setDbOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-5 py-4 transition-all"
          style={{ background: "rgba(0,0,0,0.3)", borderBottom: dbOpen ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
          <Globe className="w-5 h-5 shrink-0" style={{ color: "#4488ff" }} />
          <div className="flex-1 text-right">
            <div className="text-sm font-black" style={{ color: "#4488ff", textShadow: "0 0 10px rgba(0,100,255,0.4)" }}>قاعدة بيانات الثغرات العالمية</div>
            <div className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>NVD · CISA-KEV · ExploitDB — مزامنة دورية تلقائية</div>
          </div>
          {dbStats && !dbLoading && (
            <div className="flex items-center gap-4 text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
              <span style={{ color: "#44ff88" }}><span className="font-black">{(dbStats.total ?? 0).toLocaleString()}</span> ثغرة</span>
              <span>{Object.keys(dbStats.bySource ?? {}).length} مصادر</span>
            </div>
          )}
          {syncing && <span className="text-[10px] font-black font-mono animate-pulse" style={{ color: "#ffaa44" }}>● مزامنة...</span>}
          {dbOpen ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />}
        </button>

        {dbOpen && (
          <div className="p-5 space-y-5">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "إجمالي القاعدة", value: dbStats?.total, color: "#44ff88", rgb: "68,255,136", icon: Database },
                { label: "NVD", value: dbStats?.bySource?.["NVD"], color: "#4488ff", rgb: "68,136,255", icon: Globe },
                { label: "CISA-KEV", value: dbStats?.bySource?.["CISA-KEV"], color: "#ff8844", rgb: "255,136,68", icon: ShieldAlert },
                { label: "ExploitDB", value: dbStats?.bySource?.["ExploitDB"], color: "#ff4444", rgb: "255,68,68", icon: Zap },
              ].map(({ label, value, color, rgb, icon: Icon }) => (
                <div key={label} className="rounded-xl p-4 relative overflow-hidden"
                  style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)` }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black font-mono uppercase" style={{ color: `rgba(${rgb},0.5)` }}>{label}</span>
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                  </div>
                  {dbLoading ? (
                    <div className="h-7 w-20 rounded animate-pulse" style={{ background: `rgba(${rgb},0.15)` }} />
                  ) : (
                    <div className="text-xl font-black font-mono" style={{ color, textShadow: `0 0 12px rgba(${rgb},0.5)` }}>{(value ?? 0).toLocaleString()}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Severity + Sources + EPSS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Severity bars */}
              <div className="rounded-xl p-4 space-y-3" style={DARK}>
                <h4 className="text-[9px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />توزيع الخطورة
                </h4>
                {SEVS.map((s) => {
                  const cnt = dbStats?.bySeverity?.[s] ?? 0;
                  const total = dbStats?.total ?? 1;
                  const pct = total > 0 ? (cnt / total) * 100 : 0;
                  return (
                    <div key={s}>
                      <div className="flex items-center justify-between text-[9px] font-mono mb-1">
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

              {/* Source breakdown */}
              <div className="rounded-xl p-4 space-y-3" style={DARK}>
                <h4 className="text-[9px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <Database className="w-3.5 h-3.5" style={{ color: "#44eebb" }} />تفصيل المصادر
                </h4>
                {sourceEntries.map(([src, cnt]) => {
                  const max = Math.max(...sourceEntries.map(([, v]) => v), 1);
                  const pct = (cnt / max) * 100;
                  return (
                    <div key={src}>
                      <div className="flex items-center justify-between text-[9px] font-mono mb-1">
                        <span style={{ color: "rgba(255,255,255,0.6)" }}>{src}</span>
                        <span className="font-black" style={{ color: "#44eebb" }}>{cnt.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: "linear-gradient(90deg,#44eebb,#4488ff)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Top EPSS */}
              <div className="rounded-xl p-4 space-y-2" style={DARK}>
                <h4 className="text-[9px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <TrendingUp className="w-3.5 h-3.5 text-red-400" />أعلى مخاطر EPSS
                </h4>
                {(dbStats?.topEpss ?? []).length === 0 ? (
                  <div className="text-[10px] font-mono text-center py-6" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات EPSS</div>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                    {(dbStats?.topEpss ?? []).slice(0, 7).map((e) => (
                      <div key={e.id} className="flex items-center gap-2 pb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <div className="flex-1 min-w-0">
                          <a href={`https://nvd.nist.gov/vuln/detail/${e.id}`} target="_blank" rel="noreferrer"
                            className="font-black font-mono text-[10px] block truncate hover:underline" style={{ color: "#ff5555" }}>{e.id}</a>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <SevBadge sev={e.severity} />
                            <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>CVSS {e.cvss.toFixed(1)}</span>
                          </div>
                        </div>
                        <span className="text-sm font-black font-mono shrink-0" style={{ color: "#ff4444" }}>{(e.epssScore * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Latest CVEs Table */}
            <div className="rounded-xl overflow-hidden" style={DARK}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <Activity className="w-4 h-4" style={{ color: "#44ff88" }} />
                <span className="text-sm font-black" style={{ color: "#44ff88" }}>أحدث الثغرات في القاعدة</span>
                {dbStats && (
                  <span className="text-[9px] font-mono ms-auto" style={{ color: "rgba(255,255,255,0.25)" }}>
                    {dbStats.lastHour} ثغرة في الساعة الأخيرة
                  </span>
                )}
              </div>
              <div className="max-h-60 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {dbLoading ? (
                  <div className="py-8 text-center font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>جارِ التحميل...</div>
                ) : (dbStats?.latest ?? []).length === 0 ? (
                  <div className="py-8 text-center font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات — ابدأ المزامنة أولاً</div>
                ) : (dbStats?.latest ?? []).slice(0, 10).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 transition-all"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SEV_COLOR[c.severity] ?? "#888", boxShadow: `0 0 4px ${SEV_COLOR[c.severity] ?? "#888"}` }} />
                    <a href={`https://nvd.nist.gov/vuln/detail/${c.id}`} target="_blank" rel="noreferrer"
                      className="font-black font-mono text-[11px] hover:underline" style={{ color: "#ff5555" }}>{c.id}</a>
                    <SevBadge sev={c.severity} />
                    <span className="text-[9px] font-mono" style={{ color: "#44eebb" }}>{c.source}</span>
                    <span className="text-[9px] font-mono ms-auto" style={{ color: "rgba(255,255,255,0.3)" }}>CVSS {c.cvss?.toFixed(1) ?? "—"}</span>
                    {c.epssScore != null && <span className="text-[9px] font-black font-mono" style={{ color: "#ff4444" }}>EPSS {(c.epssScore * 100).toFixed(1)}%</span>}
                    <a href={`https://nvd.nist.gov/vuln/detail/${c.id}`} target="_blank" rel="noreferrer"
                      className="shrink-0 transition-all" style={{ color: "rgba(255,255,255,0.2)" }}>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {/* Exploit types + Sync */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl p-4 space-y-3" style={DARK}>
                <h4 className="text-[9px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <Zap className="w-3.5 h-3.5" style={{ color: "#ffaa44" }} />أنواع الاستغلال
                </h4>
                {Object.keys(dbStats?.byExploitType ?? {}).length === 0 ? (
                  <div className="text-[10px] font-mono text-center py-4" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد بيانات</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(dbStats?.byExploitType ?? {}).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
                      <div key={type} className="flex items-center gap-1.5 text-[9px] font-black font-mono px-2.5 py-1 rounded-full"
                        style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.2)", color: "#ffaa44" }}>
                        {type}<span style={{ color: "#ff7700" }}>{cnt.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl p-4 space-y-3" style={DARK}>
                <h4 className="text-[9px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <Download className="w-3.5 h-3.5" style={{ color: "#4488ff" }} />مزامنة القاعدة من NVD
                </h4>
                {job && (
                  <div className="rounded-xl p-2.5 space-y-1 text-[9px] font-mono" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="flex justify-between">
                      <span style={{ color: "rgba(255,255,255,0.35)" }}>الحالة</span>
                      <span style={{ color: job.status === "running" ? "#ffaa44" : job.status === "completed" ? "#44ff88" : job.status === "failed" ? "#ff4444" : "rgba(255,255,255,0.4)" }}>
                        {job.status}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "rgba(255,255,255,0.35)" }}>جُلب</span>
                      <span style={{ color: "rgba(255,255,255,0.8)" }}>{(job.totalFetched ?? 0).toLocaleString()} / {(job.totalAvailable ?? 0) > 0 ? job.totalAvailable.toLocaleString() : "?"}</span>
                    </div>
                    {syncing && job.totalAvailable > 0 && (
                      <div className="mt-1.5">
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${Math.min((job.totalFetched / job.totalAvailable) * 100, 100)}%`, background: "linear-gradient(90deg,#ff4444,#44ff88)" }} />
                        </div>
                      </div>
                    )}
                    {job.lastError && <div style={{ color: "#ff4444" }} className="break-all">{job.lastError.slice(0, 80)}</div>}
                  </div>
                )}
                <div className="flex gap-2">
                  {[10000, 50000, 200000].map((n) => (
                    <button key={n} onClick={() => void startSync(n)} disabled={syncing}
                      className="flex-1 text-[10px] font-black font-mono py-2 rounded-xl transition-all disabled:opacity-40"
                      style={{ background: "rgba(0,100,255,0.08)", border: "1px solid rgba(0,100,255,0.22)", color: "#4488ff" }}>
                      {n >= 1000 ? `${n / 1000}K` : n}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] font-mono leading-relaxed" style={{ color: "rgba(255,255,255,0.2)" }}>
                  بدون مفتاح NVD API: ~2K ثغرة / 30 ثانية. مع مفتاح: أسرع 10×.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
