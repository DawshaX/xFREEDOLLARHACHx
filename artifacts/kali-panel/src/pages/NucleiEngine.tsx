import { useState, useEffect, useRef } from "react";
import { PageHeader } from "@/components/Layout";
import {
  Crosshair, Play, Square, RefreshCw, AlertTriangle, CheckCircle,
  ChevronDown, ChevronRight, Download, Zap, Shield, Globe, Code,
  Filter, Terminal, Skull,
} from "lucide-react";

const API_BASE = (() => {
  const base = "";
  return "/api";
})();

interface NucleiResult { templateId: string; name: string; severity: string; matched: string; type: string; timestamp: string; info?: string; }

interface ScanState {
  status: "idle" | "running" | "done" | "error";
  target: string; results: NucleiResult[]; logs: string[];
  startedAt?: number; duration?: number; error?: string;
}

const SEV_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#ff4444", bg: "rgba(255,30,30,0.08)", border: "rgba(255,30,30,0.35)" },
  high:     { color: "#ff8844", bg: "rgba(255,100,0,0.07)", border: "rgba(255,100,0,0.3)" },
  medium:   { color: "#ffaa44", bg: "rgba(255,150,0,0.06)", border: "rgba(255,150,0,0.25)" },
  low:      { color: "#ffdd44", bg: "rgba(255,200,0,0.05)", border: "rgba(255,200,0,0.2)" },
  info:     { color: "#4488ff", bg: "rgba(0,100,255,0.06)", border: "rgba(0,100,255,0.22)" },
  unknown:  { color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)" },
};

const TEMPLATE_GROUPS = [
  { id: "cves",            label: "CVEs",           icon: AlertTriangle, color: "#ff4444" },
  { id: "exposures",       label: "Exposures",      icon: Globe,         color: "#ffaa44" },
  { id: "technologies",    label: "Technologies",   icon: Code,          color: "#4488ff" },
  { id: "misconfiguration",label: "Misconfigs",     icon: Shield,        color: "#aa44ff" },
  { id: "default-logins",  label: "Default Logins", icon: Zap,           color: "#44eebb" },
  { id: "takeovers",       label: "Takeovers",      icon: Crosshair,     color: "#ff6688" },
];

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04), inset 0 0 30px rgba(0,0,0,0.3)" };

export default function NucleiEngine() {
  const [target, setTarget] = useState("");
  const [templates, setTemplates] = useState<string[]>(["cves", "exposures", "technologies", "misconfiguration"]);
  const [severity, setSeverity] = useState<string[]>(["critical", "high", "medium"]);
  const [scan, setScan] = useState<ScanState>({ status: "idle", target: "", results: [], logs: [] });
  const [filterSev, setFilterSev] = useState("all");
  const [showLogs, setShowLogs] = useState(false);
  const [nucleiAvail, setNucleiAvail] = useState<boolean | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    void fetch(`${API_BASE}/nuclei/status`).then(r => r.json()).then((d: { available: boolean }) => setNucleiAvail(d.available)).catch(() => setNucleiAvail(false));
  }, []);

  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight; }, [scan.logs]);
  useEffect(() => () => { sseRef.current?.close(); }, []);

  const toggleTemplate = (tpl: string) => setTemplates(p => p.includes(tpl) ? p.filter(t => t !== tpl) : [...p, tpl]);
  const toggleSev = (s: string) => setSeverity(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  const startScan = async () => {
    if (!target.trim() || scan.status === "running") return;
    sseRef.current?.close();
    const startedAt = Date.now();
    setScan({ status: "running", target: target.trim(), results: [], logs: [`[${new Date().toLocaleTimeString()}] ⚡ Starting Nuclei scan on ${target}...`], startedAt });
    const params = new URLSearchParams({ target: target.trim(), templates: templates.join(","), severity: severity.join(",") });
    const es = new EventSource(`${API_BASE}/nuclei/scan?${params.toString()}`);
    sseRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as { type: string; data?: unknown; message?: string; results?: NucleiResult[]; duration?: number };
      if (data.type === "log") {
        setScan(p => ({ ...p, logs: [...p.logs, String(data.message ?? "")].slice(-200) }));
      } else if (data.type === "result") {
        const r = data.data as NucleiResult;
        setScan(p => ({ ...p, results: [...p.results, r] }));
      } else if (data.type === "done") {
        setScan(p => ({ ...p, status: "done", duration: Date.now() - startedAt, logs: [...p.logs, `[DONE] ✓ Scan complete. ${p.results.length} findings.`] }));
        es.close();
      } else if (data.type === "error") {
        setScan(p => ({ ...p, status: "error", error: String(data.message ?? "Scan failed"), logs: [...p.logs, `[ERROR] ✗ ${String(data.message ?? "")}`] }));
        es.close();
      }
    };
    es.onerror = () => {
      setScan(p => ({ ...p, status: "error", error: "SSE connection lost", logs: [...p.logs, "[ERROR] ✗ Connection dropped"] }));
      es.close();
    };
  };

  const stopScan = () => { sseRef.current?.close(); setScan(p => ({ ...p, status: "idle", logs: [...p.logs, "[STOPPED] ■ Aborted"] })); };

  const exportResults = () => {
    const csv = ["Template ID,Name,Severity,Matched URL,Type,Timestamp",
      ...scan.results.map(r => `${r.templateId},"${r.name}",${r.severity},"${r.matched}",${r.type},${r.timestamp}`)
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `nuclei-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = filterSev === "all" ? scan.results : scan.results.filter(r => r.severity === filterSev);
  const counts = scan.results.reduce<Record<string, number>>((acc, r) => { acc[r.severity] = (acc[r.severity] ?? 0) + 1; return acc; }, {});

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace",
    padding: "10px 14px", outline: "none", width: "100%",
  };

  function logColor(line: string): string {
    if (line.includes("[ERROR]")) return "#ff5555";
    if (line.includes("[DONE]")) return "#44eebb";
    if (line.includes("[STOPPED]")) return "#ffaa44";
    return "rgba(100,255,150,0.8)";
  }

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ محرك Nuclei" subtitle="فحص الثغرات الأمني بقوالب Nuclei — SSE streaming" icon={Crosshair} danger />

      {/* ── Nuclei not installed warning ── */}
      {nucleiAvail === false && (
        <div className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: "rgba(255,160,0,0.07)", border: "1px solid rgba(255,160,0,0.3)", borderRadius: 16 }}>
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#ffaa44" }} />
          <div>
            <p className="font-black text-sm mb-1" style={{ color: "#ffaa44" }}>⚡ Nuclei غير مثبّت</p>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
              لتثبيت: <code className="px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.3)", color: "#44ff88" }}>go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest</code>
            </p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
              أو: <code className="px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.3)", color: "#44ff88" }}>apt install nuclei</code> — الفحص يعمل في الوضع التجريبي حتى بدونه.
            </p>
          </div>
        </div>
      )}

      {/* ── Target + Controls ── */}
      <div className="rounded-2xl p-5 space-y-5" style={NEON_CARD}>
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 relative min-w-48">
            <Globe className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(255,255,255,0.25)" }} />
            <input value={target} onChange={e => setTarget(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void startScan(); }}
              placeholder="الهدف: https://example.com أو 192.168.1.1"
              style={{ ...inputStyle, paddingRight: 40 }} dir="ltr" />
          </div>
          <button onClick={scan.status === "running" ? stopScan : startScan}
            disabled={!target.trim() && scan.status !== "running"}
            className="px-6 py-2.5 rounded-xl font-black text-[12px] font-mono flex items-center gap-2 transition-all disabled:opacity-50"
            style={scan.status === "running"
              ? { background: "rgba(255,30,30,0.2)", border: "1px solid rgba(255,30,30,0.5)", color: "#ff5555" }
              : { background: "rgba(0,200,100,0.12)", border: "1px solid rgba(0,200,100,0.35)", color: "#44ff88", boxShadow: "0 0 12px rgba(0,200,100,0.1)" }}>
            {scan.status === "running" ? <><Square className="w-4 h-4" />إيقاف</> : <><Play className="w-4 h-4" />⚡ ابدأ الفحص</>}
          </button>
          {scan.results.length > 0 && (
            <button onClick={exportResults}
              className="px-4 py-2.5 rounded-xl font-mono text-[11px] flex items-center gap-1.5 transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
              <Download className="w-4 h-4" />CSV
            </button>
          )}
        </div>

        {/* Template Groups */}
        <div>
          <p className="text-[9px] font-black font-mono uppercase tracking-[0.2em] mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>القوالب</p>
          <div className="flex gap-2 flex-wrap">
            {TEMPLATE_GROUPS.map(tg => {
              const Icon = tg.icon;
              const active = templates.includes(tg.id);
              return (
                <button key={tg.id} onClick={() => toggleTemplate(tg.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black font-mono transition-all"
                  style={active
                    ? { background: `${tg.color}14`, border: `1px solid ${tg.color}40`, color: tg.color }
                    : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
                  <Icon className="w-3 h-3" />{tg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Severity Selection */}
        <div>
          <p className="text-[9px] font-black font-mono uppercase tracking-[0.2em] mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>الخطورة</p>
          <div className="flex gap-2 flex-wrap">
            {(["critical", "high", "medium", "low", "info"] as const).map(sev => {
              const s = SEV_STYLE[sev]!;
              return (
                <button key={sev} onClick={() => toggleSev(sev)}
                  className="px-3 py-1 rounded-xl text-[11px] font-black font-mono transition-all"
                  style={severity.includes(sev)
                    ? { background: s.bg, border: `1px solid ${s.border}`, color: s.color }
                    : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
                  {sev}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Status Bar ── */}
      {scan.status !== "idle" && (
        <div className="rounded-2xl p-4 flex items-center gap-4 flex-wrap"
          style={{
            background: scan.status === "running" ? "rgba(0,100,255,0.07)" : scan.status === "done" ? "rgba(0,200,100,0.07)" : "rgba(255,30,30,0.07)",
            border: `1px solid ${scan.status === "running" ? "rgba(0,100,255,0.25)" : scan.status === "done" ? "rgba(0,200,100,0.25)" : "rgba(255,30,30,0.25)"}`,
            borderRadius: 16,
          }}>
          {scan.status === "running"
            ? <RefreshCw className="w-5 h-5 animate-spin shrink-0" style={{ color: "#4488ff" }} />
            : scan.status === "done"
            ? <CheckCircle className="w-5 h-5 shrink-0" style={{ color: "#44ff88" }} />
            : <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: "#ff5555" }} />}
          <div className="flex-1">
            <p className="text-sm font-black" style={{ color: scan.status === "running" ? "#4488ff" : scan.status === "done" ? "#44ff88" : "#ff5555" }}>
              {scan.status === "running" ? `⚡ جارٍ الفحص: ${scan.target}` : scan.status === "done" ? `✓ اكتمل — ${scan.results.length} نتيجة` : `✗ خطأ: ${scan.error}`}
            </p>
            {scan.duration && <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>مدة الفحص: {(scan.duration / 1000).toFixed(1)}s</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(counts).map(([sev, cnt]) => {
              const s = SEV_STYLE[sev] ?? SEV_STYLE.unknown;
              return (
                <span key={sev} className="px-2 py-0.5 rounded-lg text-[10px] font-black font-mono"
                  style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
                  {sev}: {cnt}
                </span>
              );
            })}
          </div>
          <button onClick={() => setShowLogs(p => !p)}
            className="text-[10px] font-mono flex items-center gap-1 transition-all"
            style={{ color: "rgba(255,255,255,0.4)" }}>
            <Terminal className="w-3.5 h-3.5" />
            {showLogs ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}Logs
          </button>
        </div>
      )}

      {/* ── Logs ── */}
      {showLogs && scan.logs.length > 0 && (
        <div ref={logsRef} className="rounded-2xl p-4 h-44 overflow-y-auto space-y-0.5"
          style={{ background: "rgba(0,5,0,0.85)", border: "1px solid rgba(0,200,100,0.1)", borderRadius: 16, scrollbarWidth: "thin" }}>
          {scan.logs.map((log, i) => (
            <div key={i} className="text-[10px] font-mono" style={{ color: logColor(log) }}>{log}</div>
          ))}
        </div>
      )}

      {/* ── Results ── */}
      {scan.results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-black text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>{filtered.length} نتيجة</span>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => setFilterSev("all")}
                className="px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all"
                style={filterSev === "all"
                  ? { background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.4)", color: "#ff5555" }
                  : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                الكل
              </button>
              {Object.keys(counts).map(sev => {
                const s = SEV_STYLE[sev] ?? SEV_STYLE.unknown;
                return (
                  <button key={sev} onClick={() => setFilterSev(sev)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all"
                    style={filterSev === sev
                      ? { background: s.bg, border: `1px solid ${s.border}`, color: s.color }
                      : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
                    {sev} ({counts[sev]})
                  </button>
                );
              })}
            </div>
            <Filter className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.25)" }} />
          </div>

          <div className="space-y-2">
            {filtered.map((r, i) => {
              const s = SEV_STYLE[r.severity] ?? SEV_STYLE.unknown;
              return (
                <div key={i} className="rounded-xl p-4"
                  style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12 }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="font-black text-sm" style={{ color: s.color }}>{r.name}</span>
                        <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                          style={{ color: s.color, background: `${s.color}18`, border: `1px solid ${s.border}` }}>
                          {r.severity.toUpperCase()}
                        </span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
                          {r.type}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{r.matched}</p>
                      {r.info && <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>{r.info}</p>}
                    </div>
                    <div className="text-[9px] font-mono shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>{r.templateId}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Idle state ── */}
      {scan.status === "idle" && scan.results.length === 0 && (
        <div className="text-center py-20 space-y-4">
          <Skull className="w-16 h-16 mx-auto" style={{ color: "rgba(255,255,255,0.06)", filter: "drop-shadow(0 0 10px rgba(255,0,0,0.1))" }} />
          <div>
            <h3 className="text-lg font-black" style={{ color: "rgba(255,255,255,0.3)" }}>☠ محرك Nuclei جاهز</h3>
            <p className="text-sm font-mono mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>أدخل الهدف واضغط ابدأ الفحص</p>
          </div>
        </div>
      )}
    </div>
  );
}
