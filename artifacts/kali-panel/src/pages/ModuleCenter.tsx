import { useState, useEffect } from "react";
import { Shield, RefreshCw, Loader2, CheckCircle, XCircle, Search, Layers, Zap, Brain, Globe, Terminal, Package, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import { useLocation } from "wouter";

interface Tool { id: string; name: string; category: string; description: string; installed: boolean; version?: string; }

const TOOL_INTEGRATIONS: Record<string, { icon: typeof Shield; color: string; relatedPage?: string; hint: string }> = {
  nmap:      { icon: Globe,    color: "#44eebb", relatedPage: "/tools/portscan",    hint: "يُستخدم في فحص المنافذ" },
  sqlmap:    { icon: Terminal, color: "#ff4444", relatedPage: "/kaligpt",           hint: "يُستخدم في اختبار SQL Injection" },
  nikto:     { icon: Shield,   color: "#ff8844", relatedPage: "/scanner",           hint: "يُستخدم في فحص خوادم الويب" },
  nuclei:    { icon: Zap,      color: "#aa44ff", relatedPage: "/scanner",           hint: "يُستخدم في الفحص بالقوالب" },
  dnsutils:  { icon: Globe,    color: "#44eebb", relatedPage: "/tools/dns",         hint: "يُستخدم في بحث DNS" },
  subfinder: { icon: Search,   color: "#4488ff", relatedPage: "/tools/subdomains",  hint: "يُستخدم في اكتشاف النطاقات الفرعية" },
  gobuster:  { icon: Search,   color: "#ffaa44", relatedPage: "/scanner",           hint: "يُستخدم في اكتشاف المسارات" },
  hydra:     { icon: Zap,      color: "#ff5555", relatedPage: "/kaligpt",           hint: "يُستخدم في هجمات Brute Force" },
  httpx:     { icon: Globe,    color: "#44ff88", relatedPage: "/scanner",           hint: "يُستخدم في فحص HTTP" },
};
const CATEGORY_LABELS: Record<string, string> = { recon: "الاستطلاع", exploit: "الاستغلال", analysis: "التحليل", python: "Python", scanner: "الفحص" };
const CATEGORY_COLORS: Record<string, string> = { recon: "#44eebb", exploit: "#ff4444", analysis: "#aa44ff", python: "#ffaa44", scanner: "#44ff88" };

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "7px 12px", outline: "none" };

export default function ModuleCenter() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [, navigate] = useLocation();

  async function load() {
    setLoading(true);
    try { const r = await jsonRequest<Tool[]>("/installer/tools"); setTools(r); } catch { }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const categories = ["all", ...Array.from(new Set(tools.map(t => t.category)))];
  const filtered = tools.filter(t => {
    const matchCat = filter === "all" || t.category === filter;
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.includes(search);
    return matchCat && matchSearch;
  });
  const installedTools = tools.filter(t => t.installed);
  const byCategory = categories.filter(c => c !== "all").map(cat => ({
    cat, installed: tools.filter(t => t.category === cat && t.installed).length,
    total: tools.filter(t => t.category === cat).length,
  }));

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ Module Center" subtitle="مركز الوحدات — نظرة شاملة على أدوات المنصة وتكاملاتها" icon={Layers} danger
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="p-1.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => navigate("/installer")}
              className="flex items-center gap-1.5 text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
              style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff5555" }}>
              <Package className="w-3.5 h-3.5" />تثبيت أدوات
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "إجمالي الوحدات", value: tools.length, color: "#4488ff", rgb: "68,136,255" },
          { label: "مثبّت ونشط", value: installedTools.length, color: "#44ff88", rgb: "68,255,136" },
          { label: "غير مثبّت", value: tools.length - installedTools.length, color: "#ffaa44", rgb: "255,170,68" },
          { label: "تكامل مع الصفحات", value: Object.keys(TOOL_INTEGRATIONS).length, color: "#aa44ff", rgb: "170,68,255" },
        ].map(({ label, value, color, rgb }) => (
          <div key={label} className="rounded-xl p-4 text-center"
            style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 12px rgba(${rgb},0.5)` }}>{value}</div>
            <div className="text-[9px] font-mono mt-1" style={{ color: `rgba(${rgb},0.5)` }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Category Overview */}
      <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
        <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff5555" }}>
          <Brain className="w-4 h-4" />نظرة عامة على الفئات
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {byCategory.map(({ cat, installed, total }) => {
            const color = CATEGORY_COLORS[cat] ?? "#4488ff";
            const pct = total ? (installed / total) * 100 : 0;
            return (
              <div key={cat} onClick={() => setFilter(cat)} className="rounded-xl p-3 text-center cursor-pointer transition-all"
                style={{ background: "rgba(255,255,255,0.02)", border: `1px solid rgba(255,255,255,0.05)`, borderRadius: 12 }}>
                <div className="text-lg font-black font-mono" style={{ color }}>{installed}/{total}</div>
                <div className="text-[9px] font-mono mt-1 mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>{CATEGORY_LABELS[cat] ?? cat}</div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-48" style={{ ...DARK, padding: "7px 12px", borderRadius: 10 }}>
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
          <input className="bg-transparent flex-1 focus:outline-none text-[12px] font-mono"
            style={{ color: "rgba(255,255,255,0.7)" }}
            placeholder="بحث في الوحدات..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {categories.map(cat => (
          <button key={cat} onClick={() => setFilter(cat)}
            className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl border transition-all"
            style={filter === cat
              ? { background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }
              : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
            {cat === "all" ? "الكل" : (CATEGORY_LABELS[cat] ?? cat)}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#ff5555" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد وحدات</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(tool => {
            const integration = TOOL_INTEGRATIONS[tool.id];
            const Icon = integration?.icon ?? Package;
            const iconColor = integration?.color ?? "rgba(255,255,255,0.3)";
            const catColor = CATEGORY_COLORS[tool.category] ?? "#888";
            return (
              <div key={tool.id} className="rounded-2xl p-4 space-y-3 transition-all"
                style={{ ...NEON_CARD, opacity: tool.installed ? 1 : 0.65, border: tool.installed ? "1px solid rgba(68,255,136,0.1)" : "1px solid rgba(180,0,255,0.08)" }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5" style={{ color: iconColor }} />
                    <div>
                      <span className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{tool.name}</span>
                      <span className="ms-2 text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                        style={{ color: catColor, background: `${catColor}14` }}>{CATEGORY_LABELS[tool.category] ?? tool.category}</span>
                    </div>
                  </div>
                  {tool.installed
                    ? <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "#44ff88" }} />
                    : <XCircle className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.15)" }} />}
                </div>
                <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{tool.description}</p>
                {tool.version && <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{tool.version.slice(0, 60)}</p>}
                {integration?.hint && (
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{integration.hint}</p>
                    {integration.relatedPage && tool.installed && (
                      <button onClick={() => navigate(integration.relatedPage!)}
                        className="text-[9px] font-black font-mono hover:underline" style={{ color: "#ff5555" }}>فتح →</button>
                    )}
                  </div>
                )}
                {!tool.installed && (
                  <button onClick={() => navigate("/installer")}
                    className="w-full text-[10px] font-black font-mono py-1.5 rounded-xl transition-all"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                    تثبيت من المثبّت
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
