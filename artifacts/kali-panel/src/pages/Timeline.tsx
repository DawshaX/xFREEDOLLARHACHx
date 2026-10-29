import { useState, useEffect } from "react";
import { Clock, RefreshCw, Loader2, Filter, Brain, Shield, Target, Database, Zap, AlertTriangle, Bot, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import { intel, type IntelEvent } from "@/lib/intelligence";
import { useLocation } from "wouter";

interface BotAlert { id: number; severity: string; title: string; message: string; source: string; createdAt: string; }
interface CronJob { id: number; name: string; schedule: string; lastRunAt?: string; nextRunAt?: string; isEnabled: boolean; lastStatus?: string; }

interface TimelineItem {
  id: string; ts: number; type: string;
  title: string; subtitle?: string; severity: "critical" | "high" | "medium" | "low" | "info";
  source: string; icon: typeof Clock;
}

const TYPE_ICONS: Record<string, typeof Clock> = { alert: AlertTriangle, cron: Clock, intel: Brain, cve: Database, scan: Zap, bot: Bot };
const SEV_COLOR: Record<string, string> = { critical: "#ff4444", high: "#ff8844", medium: "#ffaa44", low: "#4488ff", info: "#44eebb" };
const SEV_RGB: Record<string, string> = { critical: "255,68,68", high: "255,136,68", medium: "255,170,68", low: "68,136,255", info: "68,238,187" };

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "6px 12px", outline: "none" };

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (d > 0) return `منذ ${d} يوم`;
  if (h > 0) return `منذ ${h} ساعة`;
  if (m > 0) return `منذ ${m} دقيقة`;
  return "الآن";
}

export default function Timeline() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [, navigate] = useLocation();

  function intelToItem(ev: IntelEvent): TimelineItem {
    return {
      id: ev.id, ts: ev.timestamp, type: ev.category,
      title: ev.title, subtitle: ev.detail.slice(0, 80),
      severity: ev.severity, source: ev.source,
      icon: TYPE_ICONS[ev.category] ?? Clock,
    };
  }

  async function load() {
    setLoading(true);
    try {
      const [alerts, jobs] = await Promise.all([
        jsonRequest<BotAlert[]>("/bot/alerts?limit=30"),
        jsonRequest<CronJob[]>("/bot/cron?limit=20"),
      ]);
      const alertItems: TimelineItem[] = (alerts ?? []).map(a => ({
        id: `alert-${a.id}`, ts: new Date(a.createdAt).getTime(),
        type: "alert", title: a.title, subtitle: a.message,
        severity: a.severity as TimelineItem["severity"], source: a.source, icon: AlertTriangle,
      }));
      const cronItems: TimelineItem[] = (jobs ?? []).filter(j => j.lastRunAt).map(j => ({
        id: `cron-${j.id}`, ts: new Date(j.lastRunAt!).getTime(),
        type: "cron", title: `Cron: ${j.name}`, subtitle: `الحالة: ${j.lastStatus ?? "unknown"}`,
        severity: j.lastStatus === "failed" ? "high" : "info", source: "Cron Jobs", icon: Clock,
      }));
      const intelItems = intel.getRecent({ limit: 30 }).map(intelToItem);
      setItems([...alertItems, ...cronItems, ...intelItems].sort((a, b) => b.ts - a.ts).slice(0, 150));
    } catch { }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const unsub = intel.subscribe(ev => setItems(p => [intelToItem(ev), ...p].slice(0, 150)));
    return () => unsub();
  }, []);

  const filtered = filter === "all" ? items : items.filter(i => i.type === filter || i.severity === filter);
  const today = items.filter(i => Date.now() - i.ts < 86400000).length;
  const critical = items.filter(i => i.severity === "critical").length;

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ Timeline" subtitle="الجدول الزمني — سجل موحد لجميع أحداث المنصة" icon={Clock} danger
        actions={
          <div className="flex gap-2">
            <button onClick={() => { intel.clear(); void load(); }}
              className="text-[10px] font-mono px-2.5 py-1.5 rounded-xl flex items-center gap-1 transition-all"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)" }}>
              <Filter className="w-3 h-3" />مسح
            </button>
            <button onClick={() => void load()} className="p-1.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "الإجمالي", value: items.length, color: "#4488ff", rgb: "68,136,255" },
          { label: "اليوم", value: today, color: "#44eebb", rgb: "68,238,187" },
          { label: "حرجة", value: critical, color: "#ff4444", rgb: "255,68,68" },
          { label: "مصادر", value: new Set(items.map(i => i.source)).size, color: "#aa44ff", rgb: "170,68,255" },
        ].map(({ label, value, color, rgb }) => (
          <div key={label} className="rounded-xl p-4 text-center"
            style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 12px rgba(${rgb},0.5)` }}>{value}</div>
            <div className="text-[9px] font-mono mt-1" style={{ color: `rgba(${rgb},0.5)` }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: "all", label: "الكل" }, { id: "alert", label: "التنبيهات" }, { id: "cron", label: "Cron" },
          { id: "cve", label: "CVE" }, { id: "scan", label: "Scan" }, { id: "ioc", label: "IOC" },
          { id: "critical", label: "حرجة" }, { id: "high", label: "عالية" },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setFilter(id)}
            className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl border transition-all"
            style={filter === id
              ? { background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }
              : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Timeline List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#ff5555" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl p-12 text-center space-y-4" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد أحداث — استخدم الأدوات لملء الجدول الزمني</p>
          <div className="flex justify-center gap-2 mt-3 flex-wrap">
            {[{ l: "Monitor", p: "/monitor" }, { l: "CVE Live", p: "/cve-live" }, { l: "Bot", p: "/live-agent" }].map(({ l, p }) => (
              <button key={p} onClick={() => navigate(p)}
                className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
                style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.2)", color: "#ff5555" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute end-5 top-0 bottom-0 w-px" style={{ background: "rgba(255,255,255,0.06)" }} />
          <div className="space-y-2">
            {filtered.map((item) => {
              const Icon = item.icon;
              const color = SEV_COLOR[item.severity] ?? "#888";
              const rgb = SEV_RGB[item.severity] ?? "136,136,136";
              return (
                <div key={item.id} className="relative flex gap-4 pe-10">
                  <div className="absolute end-0 w-10 h-10 rounded-full flex items-center justify-center shrink-0 z-10"
                    style={{ background: `rgba(${rgb},0.1)`, border: `2px solid rgba(${rgb},0.35)` }}>
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <div className="flex-1 rounded-xl p-3 transition-all"
                    style={{ background: `rgba(${rgb},0.04)`, border: `1px solid rgba(${rgb},0.15)`, borderRadius: 12 }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[11px] font-black" style={{ color: "rgba(255,255,255,0.75)" }}>{item.title}</span>
                          <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                            style={{ color, background: `${color}14`, border: `1px solid ${color}28` }}>{item.severity}</span>
                        </div>
                        {item.subtitle && <p className="text-[10px] font-mono truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{item.subtitle}</p>}
                        <div className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>{item.source}</div>
                      </div>
                      <div className="shrink-0 text-left">
                        <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{timeAgo(item.ts)}</div>
                        <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.18)" }}>{new Date(item.ts).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
