import { useState, useEffect, useCallback } from "react";
import { Shield, AlertTriangle, Activity, Globe, Database, RefreshCw, TrendingUp, Search, ExternalLink, Calendar, ShieldAlert, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface Threat { id: string; description: string; severity: string; publishedAt: string; cvss: number; url: string; }
interface IntelStats { totalThreats: number; criticalThreats: number; lastSync: string; activeMonitors: number; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", flex: 1 };

const SEV_COLOR: Record<string, string> = { CRITICAL: "#ff4444", HIGH: "#ff8844", MEDIUM: "#ffaa44", LOW: "#4488ff" };
const SEV_RGB: Record<string, string> = { CRITICAL: "255,68,68", HIGH: "255,136,68", MEDIUM: "255,170,68", LOW: "68,136,255" };

export default function NovaIntelligence() {
  const [threats, setThreats] = useState<Threat[]>([]);
  const [stats, setStats] = useState<IntelStats>({ totalThreats: 0, criticalThreats: 0, lastSync: new Date().toISOString(), activeMonitors: 12 });
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSeverity, setActiveSeverity] = useState<string>("CRITICAL");

  const fetchThreats = useCallback(async (severity: string = "CRITICAL") => {
    setIsSyncing(true);
    try {
      const data = await jsonRequest<Threat[]>(`/cve/recent?severity=${severity}&limit=10`);
      if (data) {
        setThreats(data);
        setStats(prev => ({ ...prev, totalThreats: data.length, criticalThreats: data.filter(t => t.severity === "CRITICAL").length, lastSync: new Date().toISOString() }));
      }
    } catch { } finally { setIsSyncing(false); }
  }, []);

  const searchThreats = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    setIsSyncing(true);
    try {
      const data = await jsonRequest<Threat[]>(`/cve/search?q=${encodeURIComponent(searchTerm)}`);
      if (data) setThreats(data);
    } catch { } finally { setIsSyncing(false); }
  };

  useEffect(() => { fetchThreats(activeSeverity); const t = setInterval(() => fetchThreats(activeSeverity), 300000); return () => clearInterval(t); }, [fetchThreats, activeSeverity]);

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ Nova Intelligence" subtitle="مراقبة التهديدات السيبرانية العالمية في الوقت الفعلي" icon={Shield} danger
        actions={
          <button onClick={() => fetchThreats(activeSeverity)}
            className="p-1.5 rounded-xl transition-all" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
            <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "إجمالي التهديدات", value: stats.totalThreats, color: "#44eebb", rgb: "68,238,187", icon: Activity },
          { label: "تهديدات حرجة", value: stats.criticalThreats, color: "#ff4444", rgb: "255,68,68", icon: ShieldAlert },
          { label: "أجهزة المراقبة", value: stats.activeMonitors, color: "#4488ff", rgb: "68,136,255", icon: Globe },
          { label: "آخر تحديث", value: new Date(stats.lastSync).toLocaleTimeString("ar-SA"), color: "#aa44ff", rgb: "170,68,255", icon: RefreshCw },
        ].map(({ label, value, color, rgb, icon: Icon }) => (
          <div key={label} className="rounded-xl p-4 space-y-1" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
            <div className="flex items-center gap-1.5 text-[9px] font-mono" style={{ color: `rgba(${rgb},0.7)` }}>
              <Icon className="w-3 h-3" />{label}
            </div>
            <div className="font-black text-xl font-mono" style={{ color, textShadow: `0 0 10px rgba(${rgb},0.4)` }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2">
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(s => {
                const color = SEV_COLOR[s] ?? "#888"; const rgb = SEV_RGB[s] ?? "136,136,136";
                const active = activeSeverity === s;
                return (
                  <button key={s} onClick={() => setActiveSeverity(s)}
                    className="px-3 py-1.5 rounded-xl text-[9px] font-black font-mono transition-all"
                    style={active ? { background: `rgba(${rgb},0.15)`, border: `1px solid rgba(${rgb},0.4)`, color } : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                    {s}
                  </button>
                );
              })}
            </div>
            <form onSubmit={searchThreats} className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <Search className="w-3 h-3 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                <input placeholder="بحث في CVE..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...inputStyle, padding: "2px 0", width: 180 }} />
              </div>
            </form>
          </div>

          <div className="space-y-3">
            {threats.map(threat => {
              const color = SEV_COLOR[threat.severity.toUpperCase()] ?? "#888";
              const rgb = SEV_RGB[threat.severity.toUpperCase()] ?? "136,136,136";
              return (
                <div key={threat.id} className="rounded-2xl p-4 transition-all" style={{ background: "rgba(8,0,18,0.85)", border: `1px solid rgba(${rgb},0.12)`, borderRadius: 16 }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded uppercase"
                          style={{ color, background: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.3)` }}>{threat.severity}</span>
                        <span className="font-black font-mono text-xs" style={{ color: "#4488ff" }}>{threat.id}</span>
                        <span className="text-[9px] font-mono flex items-center gap-1" style={{ color: "rgba(255,255,255,0.25)" }}>
                          <Calendar className="w-3 h-3" />{new Date(threat.publishedAt).toLocaleDateString("ar-EG")}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "rgba(255,255,255,0.6)" }}>{threat.description}</p>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                            <div className="h-full rounded-full" style={{ width: `${threat.cvss * 10}%`, background: color }} />
                          </div>
                          <span className="text-[10px] font-black font-mono" style={{ color }}>{threat.cvss.toFixed(1)}</span>
                        </div>
                        <a href={threat.url} target="_blank" rel="noopener noreferrer"
                          className="text-[9px] font-black font-mono flex items-center gap-1 transition-all" style={{ color: "#4488ff" }}>
                          عرض التفاصيل <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {threats.length === 0 && !isSyncing && (
              <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
                <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.04)" }} />
                <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لم يتم العثور على تهديدات حالياً</p>
              </div>
            )}
          </div>
        </div>

        <div className="w-full lg:w-72 space-y-4">
          <div className="rounded-2xl p-5 space-y-4" style={{ background: "rgba(255,30,30,0.04)", border: "1px solid rgba(255,30,30,0.15)", borderRadius: 16 }}>
            <h3 className="text-[10px] font-black tracking-widest font-mono flex items-center gap-2" style={{ color: "#ff5555" }}>
              <TrendingUp className="w-4 h-4" />تحليل التوجهات
            </h3>
            {[
              { label: "RCE Exploits", pct: 85, trend: "+12%", color: "#ff4444" },
              { label: "SQL Injection", pct: 60, trend: "+5%", color: "#ff8844" },
              { label: "XSS Attacks", pct: 45, trend: "-3%", color: "#44ff88" },
            ].map(({ label, pct, trend, color }) => (
              <div key={label} className="space-y-1.5">
                <div className="flex justify-between text-[9px] font-black font-mono">
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>{label}</span>
                  <span style={{ color }}>{trend}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl p-5 space-y-3" style={DARK}>
            <h3 className="text-[10px] font-black tracking-widest font-mono flex items-center gap-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              <Database className="w-4 h-4" />مصادر البيانات
            </h3>
            {["NVD (NIST)", "Exploit-DB", "GitHub Security", "Zero Day Initiative"].map(source => (
              <div key={source} className="flex items-center justify-between p-2 rounded-xl" style={{ background: "rgba(255,255,255,0.02)" }}>
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{source}</span>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#44ff88", boxShadow: "0 0 5px #44ff88" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
