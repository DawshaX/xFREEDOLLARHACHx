import { useState, useEffect } from "react";
import { Brain, RefreshCw, Loader2, Shield, Target, Zap, AlertTriangle, CheckCircle, Globe, Database, Filter, Skull, Activity, Radio } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import { intel, type IntelEvent, type IntelCategory } from "@/lib/intelligence";
import { useLocation } from "wouter";

interface RiskScore { cveId: string; riskScore: number; riskLabel: string; cvss: number; isInKev: boolean; hasPublicExploit: boolean; affectedAssets: string[]; aiSummary: string; }
interface DashStats { totalCves?: number; totalAssets?: number; totalEvidence?: number; criticalRisk?: number; unreadAlerts?: number; }

const CAT_ICONS: Record<IntelCategory, typeof Shield> = {
  cve: Database, ioc: Target, asset: Globe, scan: Zap, alert: AlertTriangle, bot: Brain, exploit: AlertTriangle, threat: Shield, network: Globe,
};

const SEV_STYLES: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  critical: { border: "rgba(255,30,30,0.4)", bg: "rgba(255,10,10,0.06)", text: "#ff4444", glow: "0 0 12px rgba(255,0,0,0.15)" },
  high:     { border: "rgba(255,120,0,0.4)", bg: "rgba(255,100,0,0.06)", text: "#ff8844", glow: "0 0 12px rgba(255,100,0,0.12)" },
  medium:   { border: "rgba(255,180,0,0.35)", bg: "rgba(255,160,0,0.05)", text: "#ffaa44", glow: "0 0 10px rgba(255,150,0,0.1)" },
  low:      { border: "rgba(0,150,255,0.3)", bg: "rgba(0,130,255,0.05)", text: "#44aaff", glow: "" },
  info:     { border: "rgba(0,255,220,0.2)", bg: "rgba(0,240,200,0.04)", text: "#44eebb", glow: "" },
};

const NEON = {
  card: { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04), inset 0 0 30px rgba(0,0,0,0.3)" },
  section: { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,30,30,0.1)", borderRadius: 12 },
};

export default function ThreatIntelligence() {
  const [events, setEvents] = useState<IntelEvent[]>([]);
  const [risks, setRisks] = useState<RiskScore[]>([]);
  const [stats, setStats] = useState<DashStats>({});
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState<IntelCategory | "all">("all");
  const [, navigate] = useLocation();
  const [pulse, setPulse] = useState(false);

  useEffect(() => { const id = setInterval(() => setPulse(p => !p), 1200); return () => clearInterval(id); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [dashData, riskData] = await Promise.all([
        jsonRequest<DashStats>("/stats/dashboard").catch(() => ({})),
        jsonRequest<{ scores: RiskScore[] }>("/risk/scores?limit=10&label=CRITICAL").catch(() => ({ scores: [] })),
      ]);
      setStats(dashData);
      setRisks(riskData.scores ?? []);
      for (const r of (riskData.scores ?? []).slice(0, 5)) {
        intel.publish({ category: "cve", severity: r.riskLabel === "CRITICAL" ? "critical" : r.riskLabel === "HIGH" ? "high" : "medium", title: `${r.cveId} — CVSS ${r.cvss}`, detail: r.aiSummary ?? r.cveId, source: "Risk Engine" });
      }
    } catch { }
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
    const unsub = intel.subscribe((ev) => { setEvents((p) => [ev, ...p].slice(0, 100)); });
    setEvents(intel.getRecent({ limit: 50 }));
    return () => unsub();
  }, []);

  const filtered = catFilter === "all" ? events : events.filter((e) => e.category === catFilter);
  const busStats = intel.getStats();

  const CATEGORIES: Array<{ id: IntelCategory | "all"; label: string; sym: string }> = [
    { id: "all", label: "الكل", sym: "◈" }, { id: "cve", label: "CVE", sym: "☢" }, { id: "ioc", label: "IOC", sym: "⚡" },
    { id: "scan", label: "Scan", sym: "◉" }, { id: "alert", label: "تنبيه", sym: "☠" }, { id: "bot", label: "Bot", sym: "⚔" },
    { id: "threat", label: "تهديد", sym: "▲" },
  ];

  const statCards = [
    { label: "إجمالي CVEs", value: stats.totalCves ?? 0, color: "#ff4444", glow: "rgba(255,0,0,0.2)", page: "/cve-live", icon: Database, sym: "☢" },
    { label: "الأصول", value: stats.totalAssets ?? 0, color: "#44eebb", glow: "rgba(0,255,200,0.15)", page: "/assets", icon: Globe, sym: "◉" },
    { label: "الأدلة", value: stats.totalEvidence ?? 0, color: "#aa44ff", glow: "rgba(170,0,255,0.2)", page: "/evidence", icon: Shield, sym: "⚔" },
    { label: "مخاطر حرجة", value: stats.criticalRisk ?? 0, color: "#ff5500", glow: "rgba(255,80,0,0.2)", page: "/risk-center", icon: AlertTriangle, sym: "☠" },
    { label: "التنبيهات", value: stats.unreadAlerts ?? 0, color: "#ffaa00", glow: "rgba(255,160,0,0.2)", page: "/monitor", icon: Zap, sym: "⚡" },
  ];

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ Threat Intelligence" subtitle="مركز الاستخبارات الأمنية — تحليل موحد لجميع الأدوات والبيانات" icon={Brain} danger
        actions={
          <div className="flex gap-2">
            <button onClick={() => { intel.clear(); setEvents([]); }}
              className="text-[11px] font-mono px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
              style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.2)", color: "rgba(255,100,100,0.7)" }}>
              <Filter className="w-3 h-3" />مسح
            </button>
            <button onClick={loadData}
              className="p-1.5 rounded-lg transition-all"
              style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.15)", color: "#ff5555" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statCards.map(({ label, value, color, glow, page, icon: Icon, sym }) => (
          <button key={label} onClick={() => navigate(page)}
            className="rounded-xl p-4 text-center transition-all cursor-pointer flex flex-col items-center gap-1"
            style={{ background: "rgba(8,0,18,0.9)", border: `1px solid ${color}22`, boxShadow: `0 0 15px ${glow}` }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 25px ${glow}`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 15px ${glow}`; }}>
            <div className="text-xl mb-1">{sym}</div>
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 15px ${color}` }}>{value}</div>
            <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</div>
          </button>
        ))}
      </div>

      {/* ── Intel Bus Activity ── */}
      {Object.values(busStats).some(v => v > 0) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.entries(busStats) as Array<[IntelCategory, number]>).filter(([, v]) => v > 0).map(([cat, count]) => {
            const Icon = CAT_ICONS[cat] ?? Shield;
            return (
              <button key={cat} onClick={() => setCatFilter(cat)}
                className="rounded-xl p-3 text-right transition-all"
                style={{ ...NEON.section, border: catFilter === cat ? "1px solid rgba(255,30,30,0.4)" : "1px solid rgba(255,30,30,0.1)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-3.5 h-3.5" style={{ color: "#ff5555" }} />
                  <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{cat}</span>
                </div>
                <div className="text-xl font-black font-mono" style={{ color: "#ff4444" }}>{count}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Critical CVEs ── */}
      {risks.length > 0 && (
        <div className="rounded-2xl p-5 space-y-4" style={NEON.card}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff4444", textShadow: "0 0 10px rgba(255,0,0,0.5)" }}>
            <Skull className="w-4 h-4" />أشد الثغرات خطورة — CRITICAL
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {risks.slice(0, 6).map((r) => (
              <button key={r.cveId} onClick={() => navigate(`/cve-search?q=${r.cveId}`)}
                className="flex items-start gap-3 p-3 rounded-xl text-right transition-all"
                style={{ background: "rgba(255,10,10,0.05)", border: "1px solid rgba(255,30,30,0.25)", boxShadow: "0 0 10px rgba(255,0,0,0.07)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,10,10,0.1)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,10,10,0.05)"; }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[11px] font-black font-mono" style={{ color: "#ff4444" }}>{r.cveId}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(255,30,30,0.15)", color: "#ff6666" }}>CVSS {r.cvss}</span>
                    {r.isInKev && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(255,160,0,0.15)", color: "#ffaa44" }}>KEV</span>}
                    {r.hasPublicExploit && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(255,80,0,0.15)", color: "#ff8844" }}>Exploit</span>}
                  </div>
                  {r.aiSummary && <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>{r.aiSummary.slice(0, 80)}</p>}
                  {r.affectedAssets.length > 0 && <p className="text-[10px] font-mono mt-1" style={{ color: "#44eebb" }}>{r.affectedAssets.length} أصل متأثر</p>}
                </div>
                <div className="shrink-0 text-center">
                  <div className="text-sm font-black font-mono" style={{ color: "#ff4444" }}>{Math.round(r.riskScore)}</div>
                  <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>risk</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Live Intel Feed ── */}
      <div className="rounded-2xl p-5 space-y-4" style={NEON.card}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#aa44ff", textShadow: "0 0 10px rgba(170,0,255,0.5)" }}>
            <Radio className="w-4 h-4" style={{ color: pulse ? "#aa44ff" : "#8800cc" }} />
            تغذية الاستخبارات اللحظية
          </h3>
          <div className="flex gap-1 flex-wrap">
            {CATEGORIES.map(({ id, label, sym }) => (
              <button key={id} onClick={() => setCatFilter(id)}
                className="text-[10px] font-mono px-2 py-1 rounded-lg transition-all"
                style={catFilter === id
                  ? { background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.4)", color: "#ff5555" }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
                {sym} {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#ff5555" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 space-y-3">
            <Brain className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.1)" }} />
            <p className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد أحداث — الأدوات ستملأ هذا الحقل تلقائياً</p>
            <div className="flex justify-center gap-2 mt-3 flex-wrap">
              {[{ l: "IOC Tracker", p: "/ioc" }, { l: "Active Scanner", p: "/active-scanner" }, { l: "CVE Live", p: "/cve-live" }].map(({ l, p }) => (
                <button key={p} onClick={() => navigate(p)}
                  className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.2)", color: "#ff6666" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {filtered.map((ev) => {
              const Icon = CAT_ICONS[ev.category] ?? Shield;
              const s = SEV_STYLES[ev.severity] ?? SEV_STYLES.info;
              return (
                <div key={ev.id} className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: s.bg, border: `1px solid ${s.border}`, boxShadow: s.glow }}>
                  <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: s.text }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-xs font-bold truncate" style={{ color: s.text }}>{ev.title}</span>
                      <span className="text-[9px] font-mono shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>{ev.category}</span>
                    </div>
                    <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{ev.detail}</p>
                    <div className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>
                      {ev.source} · {new Date(ev.timestamp).toLocaleTimeString("ar-EG")}
                    </div>
                  </div>
                  <span className="text-[10px] font-black font-mono shrink-0" style={{ color: s.text }}>{ev.severity.toUpperCase()}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Quick Links ── */}
      <div className="rounded-2xl p-5 space-y-4" style={NEON.card}>
        <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#44eebb" }}>
          <CheckCircle className="w-4 h-4" />روابط سريعة — كل أدوات المنصة
        </h3>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {[
            { label: "CVE Live", path: "/cve-live", color: "#ff4444" },
            { label: "IOC Tracker", path: "/ioc", color: "#ffaa00" },
            { label: "Active Scanner", path: "/active-scanner", color: "#ff8844" },
            { label: "مركز المخاطر", path: "/risk-center", color: "#aa44ff" },
            { label: "الأدلة", path: "/evidence", color: "#44eebb" },
            { label: "Live Monitor", path: "/monitor", color: "#44ff88" },
            { label: "Playbooks", path: "/playbooks", color: "#4488ff" },
            { label: "التقارير", path: "/reports", color: "#ff44aa" },
            { label: "Workspaces", path: "/workspaces", color: "#44eebb" },
            { label: "الأصول", path: "/assets", color: "#ffaa00" },
            { label: "Live Agent", path: "/live-agent", color: "#aa44ff" },
            { label: "MITRE", path: "/mitre", color: "#ff4444" },
          ].map(({ label, path, color }) => (
            <button key={path} onClick={() => navigate(path)}
              className="text-[10px] font-mono px-2 py-2.5 rounded-xl transition-all"
              style={{ background: `${color}08`, border: `1px solid ${color}22`, color }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${color}15`; (e.currentTarget as HTMLElement).style.boxShadow = `0 0 10px ${color}20`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${color}08`; (e.currentTarget as HTMLElement).style.boxShadow = ""; }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
