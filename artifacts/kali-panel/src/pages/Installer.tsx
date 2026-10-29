import { useState, useEffect, useRef } from "react";
import {
  Package, RefreshCw, Loader2, CheckCircle, XCircle, Download,
  Search, Terminal, Star, GitFork, Globe, Zap, Skull,
  Shield, AlertTriangle, Clock, Code, Network, Lock,
  Eye, ExternalLink, Play, Square, Filter, ChevronDown,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";

const API_BASE = (() => {
  const base = "";
  return "/api";
})();

interface GitHubStats {
  stars: number; forks: number; desc: string; lang: string; url: string; updatedAt: string;
}

interface Tool {
  id: string; name: string; category: string; description: string;
  installed: boolean; installCommand: string; binary: string;
  version?: string; github?: GitHubStats | null;
}

const CATEGORY_META: Record<string, { label: string; color: string; rgb: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; symbol: string }> = {
  network: { label: "شبكات",      color: "#22aaff", rgb: "30,170,255",  icon: Network,       symbol: "◉" },
  web:     { label: "ويب",         color: "#ff6622", rgb: "255,100,30",  icon: Globe,         symbol: "⚡" },
  recon:   { label: "استطلاع",    color: "#aa44ff", rgb: "170,60,255",  icon: Eye,           symbol: "◈" },
  vuln:    { label: "ثغرات",      color: "#ff2222", rgb: "255,30,30",   icon: AlertTriangle, symbol: "☠" },
  osint:   { label: "OSINT",      color: "#22ffaa", rgb: "30,255,170",  icon: Search,        symbol: "◆" },
  auth:    { label: "كلمات مرور", color: "#ffaa22", rgb: "255,170,30",  icon: Lock,          symbol: "⚔" },
  exploit: { label: "استغلال",    color: "#ff0044", rgb: "255,0,68",    icon: Skull,         symbol: "☢" },
  all:     { label: "الكل",        color: "#ffffff", rgb: "255,255,255", icon: Shield,        symbol: "✦" },
};

const LANG_COLORS: Record<string, string> = {
  "Go": "#00ADD8", "Python": "#3776AB", "C": "#A8B9CC", "C++": "#00599C",
  "Ruby": "#CC342D", "Rust": "#DEA584", "Shell": "#89e051", "JavaScript": "#F7DF1E",
};

function fmtStars(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function timeAgo(iso: string) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 86400 / 30)}mo ago`;
}

export default function Installer() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installLogs, setInstallLogs] = useState<Record<string, string[]>>({});
  const [installStatus, setInstallStatus] = useState<Record<string, "running" | "success" | "error">>({});
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showCat, setShowCat] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const logsEndRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/installer/tools`);
      if (r.ok) setTools(await r.json() as Tool[]);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function installTool(toolId: string) {
    if (installing) return;
    setInstalling(toolId);
    setInstallStatus(p => ({ ...p, [toolId]: "running" }));
    setInstallLogs(p => ({ ...p, [toolId]: [] }));
    setExpandedLogs(p => ({ ...p, [toolId]: true }));

    try {
      const res = await fetch(`${API_BASE}/installer/tools/${toolId}/install`, { method: "POST" });
      if (!res.body) { setInstalling(null); return; }
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = new TextDecoder().decode(value);
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as { line?: string; done?: boolean; installed?: boolean };
            if (data.line) {
              setInstallLogs(p => ({ ...p, [toolId]: [...(p[toolId] ?? []), data.line!].slice(-50) }));
            }
            if (data.done) {
              setInstallStatus(p => ({ ...p, [toolId]: data.installed ? "success" : "error" }));
              await load();
              setInstalling(null);
            }
          } catch {}
        }
      }
    } catch (e) {
      setInstallLogs(p => ({ ...p, [toolId]: [...(p[toolId] ?? []), `[ERROR] ${String(e)}`] }));
      setInstallStatus(p => ({ ...p, [toolId]: "error" }));
      setInstalling(null);
    }
  }

  const categories = ["all", ...Array.from(new Set(tools.map(t => t.category)))];
  const filtered = tools.filter(t => {
    const matchCat = filter === "all" || t.category === filter;
    const matchQ = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.includes(search);
    return matchCat && matchQ;
  });

  const installedCount = tools.filter(t => t.installed).length;
  const totalStars = tools.reduce((s, t) => s + (t.github?.stars ?? 0), 0);

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <PageHeader
        title="Tool Installer"
        subtitle="مثبت أدوات الأمن السيبراني — متصل بـ GitHub · فحص حقيقي"
        icon={Package}
        danger
        badge="GITHUB CONNECTED"
        actions={
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all"
            style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "إجمالي الأدوات", value: tools.length, color: "#4488ff", rgb: "60,130,255" },
          { label: "مثبّتة ✓", value: installedCount, color: "#44ff88", rgb: "60,255,136" },
          { label: "غير مثبّتة", value: tools.length - installedCount, color: "#ff4444", rgb: "255,60,60" },
          { label: "⭐ GitHub Stars", value: `${fmtStars(totalStars)}`, color: "#ffaa22", rgb: "255,170,30" },
        ].map(({ label, value, color, rgb }) => (
          <div key={label} className="rounded-2xl p-4 relative overflow-hidden"
            style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.2)`, boxShadow: `0 0 20px rgba(${rgb},0.05)` }}>
            <div className="absolute top-0 left-0 right-0 h-px"
              style={{ background: `linear-gradient(90deg, transparent, rgba(${rgb},0.6) 50%, transparent)` }} />
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 15px rgba(${rgb},0.6)` }}>{value}</div>
            <div className="text-[10px] font-bold mt-1" style={{ color: `rgba(${rgb},0.6)` }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl flex-1 min-w-44"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <Search className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.25)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-sm font-bold flex-1 focus:outline-none"
            placeholder="بحث عن أداة..." />
        </div>

        {/* Category filter */}
        <div className="relative">
          <button onClick={() => setShowCat(s => !s)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-sm"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <Filter className="w-3.5 h-3.5" />
            {CATEGORY_META[filter]?.label ?? filter}
            <ChevronDown className={`w-3 h-3 transition-transform ${showCat ? "rotate-180" : ""}`} />
          </button>
          {showCat && (
            <div className="absolute top-full mt-2 right-0 z-50 rounded-xl overflow-hidden min-w-36"
              style={{ background: "#0a0a12", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
              {categories.map(cat => {
                const meta = CATEGORY_META[cat];
                return (
                  <button key={cat} onClick={() => { setFilter(cat); setShowCat(false); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-sm font-bold transition-all"
                    style={{
                      background: filter === cat ? `rgba(${meta?.rgb ?? "255,255,255"},0.12)` : "transparent",
                      color: filter === cat ? (meta?.color ?? "#fff") : "rgba(255,255,255,0.6)",
                    }}>
                    <span style={{ color: meta?.color ?? "#fff" }}>{meta?.symbol ?? "◉"}</span>
                    {meta?.label ?? cat}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick filters */}
        <div className="flex gap-2">
          {["installed", "uninstalled"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-2 rounded-xl text-xs font-black transition-all"
              style={filter === f
                ? { background: "rgba(255,60,60,0.2)", border: "1px solid rgba(255,60,60,0.4)", color: "#ff5555" }
                : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }
              }>
              {f === "installed" ? "✓ مثبّت" : "✗ غير مثبّت"}
            </button>
          ))}
        </div>
      </div>

      {/* Tools Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)" }}>
              <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
            </div>
          </div>
          <p className="text-sm font-bold" style={{ color: "rgba(255,80,80,0.7)" }}>جارٍ جلب بيانات GitHub...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-40">
          <Package className="w-12 h-12 text-muted-foreground" />
          <p className="font-bold text-muted-foreground">لا توجد أدوات تطابق البحث</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered
            .filter(t => filter === "installed" ? t.installed : filter === "uninstalled" ? !t.installed : true)
            .map(tool => {
              const cat = CATEGORY_META[tool.category] ?? CATEGORY_META.all!;
              const isInstalling = installing === tool.id;
              const status = installStatus[tool.id];
              const logs = installLogs[tool.id] ?? [];
              const logsOpen = expandedLogs[tool.id] ?? false;
              const CatIcon = cat.icon;

              return (
                <div key={tool.id} className="rounded-2xl overflow-hidden transition-all duration-200 group"
                  style={{
                    background: tool.installed
                      ? `linear-gradient(135deg, rgba(${cat.rgb},0.1) 0%, rgba(0,0,0,0.6) 100%)`
                      : "rgba(10,10,20,0.8)",
                    border: tool.installed
                      ? `1px solid rgba(${cat.rgb},0.35)`
                      : "1px solid rgba(255,255,255,0.07)",
                    boxShadow: tool.installed ? `0 0 20px rgba(${cat.rgb},0.08)` : "none",
                  }}>
                  {/* Top accent */}
                  <div className="h-px" style={{
                    background: `linear-gradient(90deg, transparent, rgba(${cat.rgb},0.7) 40%, rgba(${cat.rgb},0.4) 60%, transparent)`,
                  }} />

                  <div className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        {/* Category icon */}
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                          style={{ background: `rgba(${cat.rgb},0.15)`, border: `1px solid rgba(${cat.rgb},0.3)` }}>
                          <CatIcon style={{ width: 16, height: 16, color: cat.color, filter: `drop-shadow(0 0 5px ${cat.color})` }} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-black text-sm" style={{ color: "#e8eeff" }}>{tool.name}</span>
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-lg"
                              style={{ color: cat.color, background: `rgba(${cat.rgb},0.15)`, border: `1px solid rgba(${cat.rgb},0.3)` }}>
                              {cat.symbol} {cat.label}
                            </span>
                          </div>
                          <p className="text-[10px] mt-0.5 font-medium" style={{ color: "rgba(200,210,255,0.5)" }}>{tool.description}</p>
                        </div>
                      </div>

                      {/* Install status */}
                      <div className="shrink-0">
                        {tool.installed ? (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{ background: "rgba(60,255,130,0.15)", border: "1px solid rgba(60,255,130,0.4)" }}>
                            <CheckCircle style={{ width: 14, height: 14, color: "#44ff88", filter: "drop-shadow(0 0 4px #00ff88)" }} />
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{ background: "rgba(255,40,40,0.1)", border: "1px solid rgba(255,40,40,0.2)" }}>
                            <XCircle style={{ width: 14, height: 14, color: "rgba(255,80,80,0.5)" }} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* GitHub stats */}
                    {tool.github && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <a href={tool.github.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] font-black hover:opacity-80 transition-opacity"
                          style={{ color: "#4488ff" }}>
                          <ExternalLink className="w-3 h-3" />
                          GitHub
                        </a>
                        <span className="flex items-center gap-1 text-[10px] font-black"
                          style={{ color: "#ffaa22" }}>
                          <Star className="w-3 h-3" />
                          {fmtStars(tool.github.stars)}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-bold"
                          style={{ color: "rgba(200,200,255,0.5)" }}>
                          <GitFork className="w-3 h-3" />
                          {fmtStars(tool.github.forks)}
                        </span>
                        {tool.github.lang && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                            style={{ color: LANG_COLORS[tool.github.lang] ?? "#ccc", background: "rgba(255,255,255,0.06)" }}>
                            {tool.github.lang}
                          </span>
                        )}
                        {tool.github.updatedAt && (
                          <span className="text-[9px] font-medium flex items-center gap-1" style={{ color: "rgba(200,200,255,0.35)" }}>
                            <Clock className="w-2.5 h-2.5" />
                            {timeAgo(tool.github.updatedAt)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Install command */}
                    <div className="px-2.5 py-1.5 rounded-lg font-mono text-[9px] truncate"
                      style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(200,210,255,0.4)" }}>
                      $ {tool.installCommand}
                    </div>

                    {/* Version */}
                    {tool.installed && tool.version && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: "0 0 4px #00ff88" }} />
                        <span className="text-[9px] font-black font-mono" style={{ color: "rgba(60,255,130,0.7)" }}>{tool.version.slice(0, 60)}</span>
                      </div>
                    )}

                    {/* Install button */}
                    {!tool.installed && (
                      <button onClick={() => void installTool(tool.id)} disabled={!!installing}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl font-black text-xs transition-all"
                        style={isInstalling
                          ? { background: "rgba(255,170,0,0.15)", border: "1px solid rgba(255,170,0,0.4)", color: "#ffaa22" }
                          : { background: `rgba(${cat.rgb},0.12)`, border: `1px solid rgba(${cat.rgb},0.35)`, color: cat.color, boxShadow: `0 0 10px rgba(${cat.rgb},0.1)` }
                        }>
                        {isInstalling
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />جارٍ التثبيت...</>
                          : <><Download className="w-3.5 h-3.5" />تثبيت {tool.name}</>}
                      </button>
                    )}

                    {/* Logs */}
                    {logs.length > 0 && (
                      <div>
                        <button onClick={() => setExpandedLogs(p => ({ ...p, [tool.id]: !p[tool.id] }))}
                          className="flex items-center gap-1.5 text-[9px] font-black mb-1.5 w-full"
                          style={{ color: status === "success" ? "#44ff88" : status === "error" ? "#ff4444" : "#ffaa22" }}>
                          <Terminal className="w-3 h-3" />
                          سجل التثبيت ({logs.length} سطر)
                          <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${logsOpen ? "rotate-180" : ""}`} />
                        </button>
                        {logsOpen && (
                          <div className="rounded-xl overflow-hidden max-h-40 overflow-y-auto"
                            style={{ background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            <div className="p-2.5 space-y-0.5 font-mono">
                              {logs.map((line, i) => (
                                <div key={i} className="text-[9px] leading-relaxed"
                                  style={{
                                    color: line.startsWith("[✓]") ? "#44ff88"
                                      : line.startsWith("[✗]") || line.startsWith("[ERR]") ? "#ff5555"
                                      : line.startsWith("[☠]") || line.startsWith("[⚡]") ? "#ffaa22"
                                      : "rgba(200,210,255,0.6)",
                                  }}>
                                  {line}
                                </div>
                              ))}
                              <div ref={logsEndRef} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
