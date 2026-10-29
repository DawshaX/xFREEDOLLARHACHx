import { useState, useEffect, useRef, useCallback } from "react";
import {
  Globe, Play, Square, RefreshCw, CheckCircle, AlertTriangle,
  Database, GitBranch, Shield, Code, FileText, Terminal,
  TrendingUp, Zap, Download, Search, Filter, Eye, Clock,
  ChevronRight, ChevronDown, Layers, Skull,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";

const API_BASE = (() => {
  const base = "";
  return "/api";
})();

interface Source { id: string; name: string; description: string; itemCount: number; interval: string; tags: string[]; }
interface Stats { total: number; autoExplored: number; byCategory: Record<string, number>; }
interface StatusData { running: string[]; lastRunResults: Array<{ task: string; collected: number; skipped: number; at: string }>; stats: Stats; }
interface KnowledgeRow { id: string; title: string; category: string; content: string; tags: string[]; createdAt: string; }

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  payloads: Code, "github-repos": GitBranch, cheatsheets: Shield,
  techniques: Zap, "github-topics": Globe, "exploit-db": AlertTriangle,
  mitre: Layers, "cve-stats": TrendingUp,
};

const CAT_COLOR: Record<string, string> = {
  payloads:     "#ff4444",
  wordlists:    "#ff8844",
  repos:        "#4488ff",
  cheatsheets:  "#44eebb",
  techniques:   "#aa44ff",
  frameworks:   "#44ccff",
  advisories:   "#ffaa44",
  stats:        "#ff44aa",
  "threat-intel": "#ff6666",
};
function getCatColor(cat: string): string {
  const prefix = cat.split("/")[0] ?? cat;
  return CAT_COLOR[prefix] ?? "#888888";
}

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04), inset 0 0 30px rgba(0,0,0,0.3)" };
const DARK_SECTION = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };

export default function AutoExplorer() {
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [knowledgeRows, setKnowledgeRows] = useState<KnowledgeRow[]>([]);
  const [filterCat, setFilterCat] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [showLogs, setShowLogs] = useState(true);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  const loadStatus = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/explorer/status`); if (r.ok) setStatus(await r.json() as StatusData); } catch {}
  }, []);

  const loadSources = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/explorer/sources`); if (r.ok) { const d = await r.json() as { sources: Source[] }; setSources(d.sources); } } catch {}
  }, []);

  const loadKnowledge = useCallback(async (cat: string, q: string) => {
    setLoadingKnowledge(true);
    try {
      const p = new URLSearchParams({ limit: "60" });
      if (cat !== "all") p.set("category", cat);
      if (q) p.set("q", q);
      const r = await fetch(`${API_BASE}/explorer/knowledge?${p}`);
      if (r.ok) setKnowledgeRows(await r.json() as KnowledgeRow[]);
    } catch {} finally { setLoadingKnowledge(false); }
  }, []);

  useEffect(() => {
    void loadStatus(); void loadSources(); void loadKnowledge("all", "");
    const iv = setInterval(() => void loadStatus(), 8000);
    return () => clearInterval(iv);
  }, [loadStatus, loadSources, loadKnowledge]);

  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight; }, [logs]);
  useEffect(() => () => sseRef.current?.close(), []);

  const startRun = (task: string) => {
    if (running) return;
    sseRef.current?.close();
    setRunning(task);
    setLogs([`[${new Date().toLocaleTimeString()}] ⚡ Starting: ${task}...`]);
    setShowLogs(true);
    const es = new EventSource(`${API_BASE}/explorer/run?task=${task}`);
    sseRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as { type: string; message?: string; summary?: { totalCollected: number; totalSkipped: number; duration: number } };
      if (data.type === "log" && data.message) {
        setLogs(p => [...p, data.message!].slice(-300));
      } else if (data.type === "done") {
        const s = data.summary;
        setLogs(p => [...p, `\n[DONE] ✓ Collected: ${s?.totalCollected} | Skipped: ${s?.totalSkipped} | Time: ${((s?.duration ?? 0) / 1000).toFixed(1)}s`]);
        setRunning(null); es.close(); void loadStatus(); void loadKnowledge(filterCat, searchQ);
      } else if (data.type === "error") {
        setLogs(p => [...p, `[ERROR] ✗ ${data.message ?? "Unknown error"}`]);
        setRunning(null); es.close();
      }
    };
    es.onerror = () => { setLogs(p => [...p, "[ERROR] ✗ Connection lost"]); setRunning(null); es.close(); };
  };

  const stopRun = () => { sseRef.current?.close(); setRunning(null); setLogs(p => [...p, "[STOPPED] ■ Aborted by user"]); };

  const exportLogs = () => {
    const blob = new Blob([logs.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `nova-explorer-${Date.now()}.log`; a.click();
    URL.revokeObjectURL(url);
  };

  const categories = ["all", ...Array.from(new Set(Object.keys(status?.stats.byCategory ?? {}).map(k => k.split("/")[0] ?? k)))];

  function logColor(line: string): string {
    if (line.includes("[ERROR]")) return "#ff5555";
    if (line.includes("[SKIP]")) return "#ffaa44";
    if (line.includes("[SAVED]")) return "#44ff88";
    if (line.includes("[DONE]")) return "#44eebb";
    if (line.includes("[STOPPED]")) return "#ff8844";
    return "rgba(100,255,150,0.8)";
  }

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ Nova Explorer" subtitle="استكشاف أمني تلقائي — GitHub + الويب + قواعد البيانات الأمنية" icon={Globe} danger />

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "إجمالي المعرفة", value: status?.stats.total ?? "...", icon: Database, color: "#4488ff", sym: "◈" },
          { label: "مجمّع تلقائياً", value: status?.stats.autoExplored ?? "...", icon: Globe, color: "#44eebb", sym: "◉" },
          { label: "التصنيفات", value: Object.keys(status?.stats.byCategory ?? {}).length, icon: Layers, color: "#aa44ff", sym: "⚔" },
          { label: "حالة المحرك", value: running ? "☠ يعمل" : "● جاهز", icon: Zap, color: running ? "#ffaa00" : "#44ff88", sym: running ? "⚡" : "✓" },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="rounded-xl p-4 flex items-center gap-3" style={{ ...NEON_CARD, borderRadius: 12 }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `${s.color}12`, border: `1px solid ${s.color}30` }}>
                <Icon className="w-4 h-4" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-xl font-black font-mono" style={{ color: s.color, textShadow: `0 0 15px ${s.color}44` }}>
                  {String(s.value)}
                </p>
                <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Controls ── */}
      <div className="rounded-2xl p-5 space-y-5" style={NEON_CARD}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-black text-base" style={{ color: "#ff4444", textShadow: "0 0 10px rgba(255,0,0,0.4)" }}>
              ☠ تحكم في الاستكشاف
            </h3>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
              شغّل المحرك لجمع البيانات تلقائياً من GitHub والويب والمصادر الأمنية
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {running ? (
              <button onClick={stopRun}
                className="px-5 py-2.5 rounded-xl font-black text-[12px] font-mono flex items-center gap-2 transition-all"
                style={{ background: "rgba(255,30,30,0.2)", border: "1px solid rgba(255,30,30,0.5)", color: "#ff5555", boxShadow: "0 0 15px rgba(255,0,0,0.15)" }}>
                <Square className="w-4 h-4" />إيقاف
              </button>
            ) : (
              <button onClick={() => startRun("all")}
                className="px-5 py-2.5 rounded-xl font-black text-[12px] font-mono flex items-center gap-2 transition-all"
                style={{ background: "rgba(0,200,100,0.12)", border: "1px solid rgba(0,200,100,0.35)", color: "#44ff88", boxShadow: "0 0 12px rgba(0,200,100,0.1)" }}>
                <Play className="w-4 h-4" />⚡ تشغيل الكل
              </button>
            )}
            <button onClick={() => { void loadStatus(); void loadKnowledge(filterCat, searchQ); }}
              className="px-3 py-2.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            {logs.length > 0 && (
              <button onClick={exportLogs}
                className="px-3 py-2.5 rounded-xl flex items-center gap-1.5 transition-all"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
                <Download className="w-4 h-4" />سجل
              </button>
            )}
          </div>
        </div>

        {/* Source Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {sources.map(src => {
            const Icon = SOURCE_ICONS[src.id] ?? Globe;
            const isRunning = running === src.id;
            return (
              <div key={src.id} className="rounded-xl p-3 space-y-2.5" style={DARK_SECTION}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg" style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.15)" }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: "#ff5555" }} />
                    </div>
                    <div>
                      <p className="font-black text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>{src.name}</p>
                      <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{src.interval} · {src.itemCount}</p>
                    </div>
                  </div>
                  <button onClick={() => setExpandedSource(expandedSource === src.id ? null : src.id)}
                    className="p-0.5 rounded transition-all" style={{ color: "rgba(255,255,255,0.3)" }}>
                    {expandedSource === src.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>
                </div>

                {expandedSource === src.id && (
                  <p className="text-[10px] font-mono leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>{src.description}</p>
                )}

                <div className="flex flex-wrap gap-1">
                  {src.tags.slice(0, 3).map(t => (
                    <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-full font-mono"
                      style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.15)", color: "rgba(255,100,100,0.6)" }}>
                      {t}
                    </span>
                  ))}
                </div>

                <button onClick={() => startRun(src.id)} disabled={!!running}
                  className="w-full py-1.5 rounded-lg text-[10px] font-black font-mono flex items-center justify-center gap-1 transition-all"
                  style={isRunning
                    ? { background: "rgba(255,160,0,0.12)", border: "1px solid rgba(255,160,0,0.3)", color: "#ffaa44" }
                    : { background: running ? "rgba(255,255,255,0.03)" : "rgba(0,200,100,0.08)", border: running ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(0,200,100,0.2)", color: running ? "rgba(255,255,255,0.2)" : "#44ff88", opacity: running && !isRunning ? 0.4 : 1 }}>
                  {isRunning ? <><RefreshCw className="w-3 h-3 animate-spin" />يعمل...</> : <><Play className="w-3 h-3" />تشغيل</>}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Live Logs ── */}
      {logs.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ ...NEON_CARD, padding: 0 }}>
          <div className="flex items-center justify-between px-4 py-2.5"
            style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(0,255,100,0.1)" }}>
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4" style={{ color: "#44ff88" }} />
              <span className="text-sm font-black font-mono" style={{ color: "#44ff88" }}>سجل الاستكشاف المباشر</span>
              {running && <span className="text-[10px] font-mono animate-pulse" style={{ color: "#ffaa44" }}>● يعمل: {running}</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowLogs(p => !p)} className="text-[10px] font-mono transition-all" style={{ color: "rgba(255,255,255,0.4)" }}>
                {showLogs ? "إخفاء" : "إظهار"}
              </button>
              <button onClick={() => setLogs([])} className="text-[10px] font-mono transition-all" style={{ color: "#ff5555" }}>مسح</button>
            </div>
          </div>
          {showLogs && (
            <div ref={logsRef} className="p-4 h-56 overflow-y-auto space-y-0.5" style={{ background: "rgba(0,5,0,0.85)", scrollbarWidth: "thin" }}>
              {logs.map((log, i) => (
                <div key={i} className="text-[10px] font-mono leading-relaxed" style={{ color: logColor(log) }}>{log}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Last Run History ── */}
      {(status?.lastRunResults?.length ?? 0) > 0 && (
        <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ffaa44" }}>
            <Clock className="w-4 h-4" />آخر عمليات الاستكشاف
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {status?.lastRunResults.slice(0, 8).map((r, i) => (
              <div key={i} className="rounded-xl p-3 space-y-1" style={DARK_SECTION}>
                <p className="text-[10px] font-black truncate" style={{ color: "rgba(255,255,255,0.7)" }}>{r.task}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black font-mono" style={{ color: "#44ff88" }}>+{r.collected}</span>
                  <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>محفوظ</span>
                </div>
                <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{new Date(r.at).toLocaleTimeString("ar-SA")}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Category Stats ── */}
      {status?.stats.byCategory && Object.keys(status.stats.byCategory).length > 0 && (
        <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#aa44ff" }}>
            <Database className="w-4 h-4" />المعرفة المجمّعة حسب التصنيف
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(status.stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
              const color = getCatColor(cat);
              return (
                <div key={cat} className="rounded-xl p-3" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
                  <p className="text-[9px] font-black font-mono truncate" style={{ color }}>{cat}</p>
                  <p className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 10px ${color}44` }}>{count}</p>
                  <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>مدخل</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Knowledge Browser ── */}
      <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#44eebb" }}>
            <Eye className="w-4 h-4" />تصفّح المعرفة المجمّعة
          </h3>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { void loadKnowledge(filterCat, searchQ); } }}
                placeholder="بحث..." dir="rtl"
                className="pr-8 pl-3 py-2 rounded-xl text-xs w-40 outline-none"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }} />
            </div>
            <button onClick={() => { void loadKnowledge(filterCat, searchQ); }}
              className="px-3 py-2 rounded-xl transition-all"
              style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff5555" }}>
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Category chips */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <Filter className="w-3 h-3 shrink-0" style={{ color: "rgba(255,255,255,0.25)" }} />
          {categories.map(cat => {
            const color = cat === "all" ? "#ff5555" : getCatColor(cat);
            return (
              <button key={cat} onClick={() => { setFilterCat(cat); void loadKnowledge(cat, searchQ); }}
                className="px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all"
                style={filterCat === cat
                  ? { background: `${color}18`, border: `1px solid ${color}40`, color }
                  : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }}>
                {cat}
              </button>
            );
          })}
        </div>

        {/* Knowledge rows */}
        {loadingKnowledge ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin" style={{ color: "#ff5555" }} />
          </div>
        ) : knowledgeRows.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Globe className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.1)" }} />
            <p className="text-sm font-black" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد بيانات في هذا التصنيف</p>
            <p className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>شغّل محرك الاستكشاف لجمع البيانات</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {knowledgeRows.map(row => {
              const color = getCatColor(row.category);
              return (
                <div key={row.id} className="rounded-xl p-3 space-y-1.5"
                  style={{ background: `${color}07`, border: `1px solid ${color}20` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] font-bold flex-1" style={{ color: "rgba(255,255,255,0.8)" }}>{row.title}</p>
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: `${color}18`, color }}>{row.category}</span>
                  </div>
                  <p className="text-[10px] font-mono line-clamp-2" style={{ color: "rgba(255,255,255,0.4)" }}>{row.content}</p>
                  <div className="flex flex-wrap gap-1">
                    {row.tags.slice(0, 5).map(t => (
                      <span key={t} className="text-[8px] px-1 py-0.5 rounded font-mono"
                        style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" }}>{t}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
