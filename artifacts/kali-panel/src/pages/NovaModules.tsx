import { useState, useEffect } from "react";
import { Shield, Zap, Globe, Database, Cpu, Activity, AlertTriangle, CheckCircle, Play, RefreshCw, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";

interface Module { id: string; name: string; description: string; category: "exploit" | "intel" | "stealth" | "defense"; status: "idle" | "running" | "completed" | "failed"; progress: number; lastRun?: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; }
interface ThreatIntel { id: string; title: string; severity: "low" | "medium" | "high" | "critical"; description: string; source: string; publishedAt: string; status: "new" | "analyzing" | "mitigated"; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const SEV: Record<string, string> = { critical: "#ff4444", high: "#ff8844", medium: "#ffaa44", low: "#4488ff" };
const SEV_RGB: Record<string, string> = { critical: "255,68,68", high: "255,136,68", medium: "255,170,68", low: "68,136,255" };
const CAT_COLOR: Record<string, string> = { exploit: "#ff4444", intel: "#4488ff", stealth: "#aa44ff", defense: "#ffaa44" };
const CAT_RGB: Record<string, string> = { exploit: "255,68,68", intel: "68,136,255", stealth: "170,68,255", defense: "255,170,68" };
const STAT_COLOR: Record<string, string> = { idle: "#555", running: "#ffaa44", completed: "#44ff88", failed: "#ff4444" };
const STAT_LABEL: Record<string, string> = { idle: "IDLE", running: "جارٍ التشغيل", completed: "مكتمل", failed: "فشل" };

export default function NovaModules() {
  const [modules, setModules] = useState<Module[]>([
    { id: "exploit-crafter", name: "Exploit Auto-Crafter", description: "توليد إكسبلويتات مخصصة تلقائياً بناءً على الثغرات", category: "exploit", status: "idle", progress: 0, icon: Zap },
    { id: "zero-day-intel", name: "Zero-Day Intelligence", description: "مزامنة مع أحدث التهديدات والثغرات غير المعروفة", category: "intel", status: "idle", progress: 0, icon: Shield },
    { id: "stealth-mode", name: "Stealth & Anti-Forensics", description: "تقنيات التخفي ومقاومة التحليل الجنائي الرقمي", category: "stealth", status: "idle", progress: 0, icon: Activity },
    { id: "defense-evasion", name: "Defense Evasion", description: "تجاوز أنظمة الدفاع والكشف عن التهديدات", category: "defense", status: "idle", progress: 0, icon: AlertTriangle },
  ]);
  const [threatIntel, setThreatIntel] = useState<ThreatIntel[]>([
    { id: "1", title: "Remote Code Execution in Web Framework", severity: "critical", description: "ثغرة تنفيذ أكواد عن بعد في إطار ويب شائع", source: "NVD", publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), status: "new" },
    { id: "2", title: "SQL Injection in Database System", severity: "high", description: "ثغرة حقن SQL في نظام إدارة قواعد البيانات", source: "CVE Database", publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), status: "analyzing" },
    { id: "3", title: "XSS in Content Management System", severity: "medium", description: "ثغرة XSS في نظام إدارة المحتوى", source: "Security Researcher", publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), status: "mitigated" },
  ]);
  const [systemStats, setSystemStats] = useState({ cpuUsage: 0, memoryUsage: 0, activeConnections: 0, threatsDetected: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemStats({ cpuUsage: Math.min(99, 15 + Math.random() * 25), memoryUsage: Math.min(95, 35 + Math.random() * 30), activeConnections: Math.floor(Math.random() * 50), threatsDetected: Math.floor(Math.random() * 10) });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const runModule = async (moduleId: string) => {
    setModules(prev => prev.map(m => m.id === moduleId ? { ...m, status: "running", progress: 0 } : m));
    for (let progress = 0; progress <= 100; progress += 10) {
      await new Promise(r => setTimeout(r, 250));
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, progress } : m));
    }
    setModules(prev => prev.map(m => m.id === moduleId ? { ...m, status: "completed", progress: 100, lastRun: new Date().toISOString() } : m));
  };

  const syncThreatIntel = async () => {
    await new Promise(r => setTimeout(r, 1500));
    const newThreat: ThreatIntel = { id: Date.now().toString(), title: "New Zero-Day Vulnerability Discovered", severity: "critical", description: "ثغرة خطيرة جديدة تتطلب اهتماماً فورياً", source: "Threat Intel Feed", publishedAt: new Date().toISOString(), status: "new" };
    setThreatIntel(prev => [newThreat, ...prev].slice(0, 10));
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ Nova Modules" subtitle="وحدات متقدمة للأمن السيبراني والهجوم والدفاع" icon={Shield} danger />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "CPU", value: `${systemStats.cpuUsage.toFixed(1)}%`, color: "#44eebb", rgb: "68,238,187", icon: Cpu },
          { label: "Memory", value: `${systemStats.memoryUsage.toFixed(1)}%`, color: "#aa44ff", rgb: "170,68,255", icon: Database },
          { label: "Connections", value: systemStats.activeConnections, color: "#4488ff", rgb: "68,136,255", icon: Globe },
          { label: "Threats", value: systemStats.threatsDetected, color: "#ff4444", rgb: "255,68,68", icon: AlertTriangle },
        ].map(({ label, value, color, rgb, icon: Icon }) => (
          <div key={label} className="rounded-xl p-4" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.2)`, borderRadius: 16 }}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4" style={{ color }} />
              <span className="text-[9px] font-mono uppercase" style={{ color: `rgba(${rgb},0.6)` }}>{label}</span>
            </div>
            <div className="font-black text-xl font-mono" style={{ color, textShadow: `0 0 10px rgba(${rgb},0.4)` }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Modules */}
      <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
        <div className="flex items-center justify-between">
          <h3 className="font-black text-sm" style={{ color: "#ff5555" }}>الوحدات النشطة</h3>
          <button onClick={() => modules.forEach(m => runModule(m.id))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] font-mono transition-all"
            style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff5555" }}>
            <Play className="w-3 h-3" />تشغيل الكل
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {modules.map(module => {
            const Icon = module.icon;
            const cc = CAT_COLOR[module.category]; const cr = CAT_RGB[module.category];
            const sc = STAT_COLOR[module.status];
            return (
              <div key={module.id} className="rounded-xl p-4 space-y-3"
                style={{ background: `rgba(${cr},0.04)`, border: `1px solid rgba(${cr},0.15)`, borderRadius: 14 }}>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl shrink-0" style={{ background: `rgba(${cr},0.12)` }}>
                    <Icon className="w-4 h-4" style={{ color: cc }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{module.name}</h4>
                    <p className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{module.description}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black font-mono" style={{ color: sc }}>{STAT_LABEL[module.status]}</span>
                  {module.lastRun && <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{new Date(module.lastRun).toLocaleTimeString("ar-SA")}</span>}
                </div>
                {module.status === "running" && (
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${module.progress}%`, background: cc }} />
                  </div>
                )}
                <button onClick={() => runModule(module.id)} disabled={module.status === "running"}
                  className="w-full py-1.5 rounded-xl font-black text-[10px] font-mono transition-all disabled:opacity-50"
                  style={{ background: `rgba(${cr},0.08)`, border: `1px solid rgba(${cr},0.2)`, color: cc }}>
                  {module.status === "running" ? "جاري التشغيل..." : "تشغيل"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Threat Intel */}
      <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
        <div className="flex items-center justify-between">
          <h3 className="font-black text-sm" style={{ color: "#ff5555" }}>معلومات التهديدات</h3>
          <button onClick={syncThreatIntel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] font-mono transition-all"
            style={{ background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.2)", color: "#44ff88" }}>
            <RefreshCw className="w-3 h-3" />مزامنة
          </button>
        </div>
        <div className="space-y-2">
          {threatIntel.map(threat => {
            const sc = SEV[threat.severity]; const sr = SEV_RGB[threat.severity];
            return (
              <div key={threat.id} className="rounded-xl p-4" style={{ background: `rgba(${sr},0.04)`, border: `1px solid rgba(${sr},0.15)`, borderRadius: 14 }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h4 className="font-black text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>{threat.title}</h4>
                      <span className="text-[8px] font-black font-mono px-1.5 py-0.5 rounded uppercase"
                        style={{ color: sc, background: `rgba(${sr},0.12)`, border: `1px solid rgba(${sr},0.3)` }}>{threat.severity}</span>
                    </div>
                    <p className="text-[10px] font-mono mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>{threat.description}</p>
                    <div className="flex items-center gap-4 text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
                      <span>المصدر: {threat.source}</span>
                      <span>نشر: {new Date(threat.publishedAt).toLocaleDateString("ar-EG")}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {threat.status === "new" && <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#ff4444", boxShadow: "0 0 6px #ff4444" }} />}
                    {threat.status === "analyzing" && <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: "#ffaa44" }} />}
                    {threat.status === "mitigated" && <CheckCircle className="w-3.5 h-3.5" style={{ color: "#44ff88" }} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
