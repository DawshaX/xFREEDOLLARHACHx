import { useState, useEffect } from "react";
import { Zap, Plus, RefreshCw, Loader2, Play, CheckCircle, XCircle, AlertTriangle, Target, Clock, FileSearch, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import { useLocation } from "wouter";

interface Evidence {
  id: string; scanId: string; targetUrl: string; cveId?: string; assetId?: string;
  evidenceType: string; severity: string; title: string; description: string;
  request?: string; response?: string; payload?: string; proofText?: string;
  statusCode?: string; responseTime?: number;
  isVerified: boolean; isFalsePositive: boolean; notes?: string; createdAt: string;
}

const SEV_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#ff4444", bg: "rgba(255,30,30,0.08)", border: "rgba(255,30,30,0.35)" },
  high:     { color: "#ff8844", bg: "rgba(255,100,0,0.07)", border: "rgba(255,100,0,0.3)" },
  medium:   { color: "#ffaa44", bg: "rgba(255,150,0,0.06)", border: "rgba(255,150,0,0.25)" },
  low:      { color: "#4488ff", bg: "rgba(0,100,255,0.06)", border: "rgba(0,100,255,0.22)" },
  info:     { color: "#44eebb", bg: "rgba(0,240,180,0.05)", border: "rgba(0,240,180,0.18)" },
};

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04), inset 0 0 30px rgba(0,0,0,0.3)" };
const DARK_SECTION = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };

export default function ActiveScanner() {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Evidence | null>(null);
  const [filter, setFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState({ targetUrl: "", scanType: "http_probe", notes: "" });
  const [, navigate] = useLocation();

  async function load() {
    setLoading(true);
    try {
      const r = await jsonRequest<{ evidence: Evidence[] }>("/evidence");
      setEvidence(r.evidence ?? []);
    } catch { setEvidence([]); }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function startScan() {
    if (!form.targetUrl) return;
    setScanning(true);
    try {
      const r = await jsonRequest<{ started: boolean; scanId: string }>("/evidence/scan", {
        method: "POST",
        body: JSON.stringify({ targetUrl: form.targetUrl, scanType: form.scanType, notes: form.notes }),
      });
      if (r.started) {
        setShowNew(false);
        setForm({ targetUrl: "", scanType: "http_probe", notes: "" });
        setTimeout(() => void load(), 3000);
      }
    } catch { }
    setScanning(false);
  }

  const filtered = filter === "all" ? evidence : evidence.filter((e) => e.severity === filter);
  const counts = {
    critical: evidence.filter((e) => e.severity === "critical").length,
    high:     evidence.filter((e) => e.severity === "high").length,
    medium:   evidence.filter((e) => e.severity === "medium").length,
    low:      evidence.filter((e) => e.severity === "low").length,
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace",
    padding: "8px 12px", width: "100%", outline: "none",
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ الفحص النشط" subtitle="Active Scanner — فحص الثغرات وجمع الأدلة لحظياً" icon={Zap} danger
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/evidence")}
              className="text-[11px] font-mono px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <FileSearch className="w-3.5 h-3.5" />الأدلة الكاملة
            </button>
            <button onClick={load}
              className="p-1.5 rounded-lg transition-all"
              style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.15)", color: "#ff5555" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 text-[11px] font-black font-mono px-3 py-1.5 rounded-lg transition-all"
              style={{ background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.4)", color: "#ff5555", boxShadow: "0 0 12px rgba(255,0,0,0.1)" }}>
              <Play className="w-3.5 h-3.5" />☠ فحص جديد
            </button>
          </div>
        }
      />

      {/* ── Stats ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "حرجة", value: counts.critical, sev: "critical" },
          { label: "عالية", value: counts.high, sev: "high" },
          { label: "متوسطة", value: counts.medium, sev: "medium" },
          { label: "منخفضة", value: counts.low, sev: "low" },
        ].map(({ label, value, sev }) => {
          const s = SEV_STYLE[sev]!;
          return (
            <button key={sev} onClick={() => setFilter(filter === sev ? "all" : sev)}
              className="rounded-xl p-4 text-center transition-all"
              style={{ background: filter === sev ? s.bg : "rgba(8,0,18,0.95)", border: `1px solid ${filter === sev ? s.border : "rgba(180,0,255,0.12)"}`, boxShadow: filter === sev ? `0 0 15px ${s.color}22` : "" }}>
              <div className="text-2xl font-black font-mono" style={{ color: s.color, textShadow: `0 0 15px ${s.color}66` }}>{value}</div>
              <div className="text-[10px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</div>
            </button>
          );
        })}
      </div>

      {/* ── New Scan Form ── */}
      {showNew && (
        <div className="rounded-2xl p-5 space-y-4" style={{ ...NEON_CARD, border: "1px solid rgba(255,30,30,0.25)" }}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff4444", textShadow: "0 0 10px rgba(255,0,0,0.5)" }}>
            <Target className="w-4 h-4" />☠ بدء فحص جديد
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>الهدف *</label>
              <input style={inputStyle} placeholder="https://example.com أو 192.168.1.1" value={form.targetUrl}
                onChange={(e) => setForm((f) => ({ ...f, targetUrl: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>نوع الفحص</label>
              <select style={{ ...inputStyle, appearance: "none" } as React.CSSProperties} value={form.scanType}
                onChange={(e) => setForm((f) => ({ ...f, scanType: e.target.value }))}>
                <option value="http_probe">HTTP Probe</option>
                <option value="port_scan">Port Scan</option>
                <option value="vuln_check">Vuln Check</option>
                <option value="cve_check">CVE Check</option>
                <option value="header_analysis">Header Analysis</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>ملاحظات</label>
            <input style={inputStyle} placeholder="سياق الفحص..." value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)}
              className="text-[11px] font-mono px-3 py-1.5 rounded-lg transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
              إلغاء
            </button>
            <button onClick={startScan} disabled={scanning || !form.targetUrl}
              className="flex items-center gap-2 text-[11px] font-black font-mono px-4 py-1.5 rounded-lg transition-all disabled:opacity-50"
              style={{ background: "rgba(0,200,100,0.1)", border: "1px solid rgba(0,200,100,0.3)", color: "#44ff88" }}>
              {scanning ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />جاري الفحص...</> : <><Play className="w-3.5 h-3.5" />⚡ بدء الفحص</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Filter Tabs ── */}
      <div className="flex gap-2 flex-wrap">
        {["all", "critical", "high", "medium", "low", "info"].map((sev) => {
          const s = SEV_STYLE[sev] ?? { color: "#44eebb", bg: "rgba(0,240,180,0.06)", border: "rgba(0,240,180,0.2)" };
          return (
            <button key={sev} onClick={() => setFilter(sev)}
              className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
              style={filter === sev
                ? { background: s.bg, border: `1px solid ${s.border}`, color: s.color }
                : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
              {sev === "all" ? "◈ الكل" : sev}
            </button>
          );
        })}
      </div>

      {/* ── Evidence + Detail ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* List */}
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#ff5555" }} /></div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl p-8 text-center space-y-3" style={NEON_CARD}>
              <Skull className="w-10 h-10 mx-auto" style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد نتائج — ابدأ فحصاً جديداً</p>
            </div>
          ) : filtered.map((ev) => {
            const s = SEV_STYLE[ev.severity] ?? SEV_STYLE.info;
            return (
              <button key={ev.id} onClick={() => setSelected(ev)}
                className="w-full rounded-xl p-4 text-right transition-all"
                style={{
                  background: selected?.id === ev.id ? s.bg : "rgba(8,0,18,0.9)",
                  border: `1px solid ${selected?.id === ev.id ? s.border : "rgba(180,0,255,0.1)"}`,
                  boxShadow: selected?.id === ev.id ? `0 0 12px ${s.color}18` : "",
                }}>
                <div className="flex items-start gap-3">
                  {ev.isVerified
                    ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#44ff88" }} />
                    : ev.isFalsePositive
                    ? <XCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                    : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#ffaa44" }} />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-bold truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{ev.title}</span>
                      <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded shrink-0"
                        style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
                        {ev.severity}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{ev.targetUrl}</p>
                    <div className="flex items-center gap-3 mt-1 text-[9px] font-mono flex-wrap" style={{ color: "rgba(255,255,255,0.25)" }}>
                      <span>{ev.evidenceType}</span>
                      {ev.statusCode && <span>HTTP {ev.statusCode}</span>}
                      {ev.cveId && <span style={{ color: "#44eebb" }}>{ev.cveId}</span>}
                      <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{new Date(ev.createdAt).toLocaleDateString("ar-EG")}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div className="rounded-2xl p-5" style={NEON_CARD}>
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{selected.title}</h3>
                <span className="text-[9px] font-black font-mono px-2 py-1 rounded"
                  style={{ color: SEV_STYLE[selected.severity]?.color ?? "#44eebb", background: SEV_STYLE[selected.severity]?.bg ?? "rgba(0,240,180,0.05)", border: `1px solid ${SEV_STYLE[selected.severity]?.border ?? "rgba(0,240,180,0.2)"}` }}>
                  {selected.severity.toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px] font-mono">
                <div><span style={{ color: "rgba(255,255,255,0.3)" }}>الهدف: </span><span style={{ color: "#44eebb" }}>{selected.targetUrl}</span></div>
                <div><span style={{ color: "rgba(255,255,255,0.3)" }}>النوع: </span><span style={{ color: "rgba(255,255,255,0.6)" }}>{selected.evidenceType}</span></div>
                {selected.statusCode && <div><span style={{ color: "rgba(255,255,255,0.3)" }}>HTTP: </span><span style={{ color: "rgba(255,255,255,0.6)" }}>{selected.statusCode}</span></div>}
                {selected.responseTime && <div><span style={{ color: "rgba(255,255,255,0.3)" }}>الوقت: </span><span style={{ color: "rgba(255,255,255,0.6)" }}>{selected.responseTime}ms</span></div>}
                {selected.cveId && <div><span style={{ color: "rgba(255,255,255,0.3)" }}>CVE: </span><span style={{ color: "#ff4444" }}>{selected.cveId}</span></div>}
              </div>
              <p className="text-[11px] font-mono leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>{selected.description}</p>
              {selected.proofText && (
                <div>
                  <h4 className="text-[10px] font-black font-mono mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>الدليل:</h4>
                  <pre className="text-[9px] font-mono rounded-xl p-3 overflow-x-auto whitespace-pre-wrap"
                    style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.05)", color: "#44ff88" }}>
                    {selected.proofText.slice(0, 500)}
                  </pre>
                </div>
              )}
              {selected.payload && (
                <div>
                  <h4 className="text-[10px] font-black font-mono mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>Payload:</h4>
                  <code className="text-[10px] font-mono rounded-xl px-3 py-2 block"
                    style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.15)", color: "#ff6666" }}>
                    {selected.payload}
                  </code>
                </div>
              )}
              {selected.notes && <p className="text-[10px] font-mono italic" style={{ color: "rgba(255,255,255,0.3)" }}>{selected.notes}</p>}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-52 space-y-3">
              <FileSearch className="w-12 h-12" style={{ color: "rgba(255,255,255,0.08)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>اختر دليلاً لعرض تفاصيله</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
