import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Shield, AlertTriangle, CheckCircle, XCircle, Clock,
  FileText, Eye, Zap, RefreshCw, ExternalLink, ChevronDown, ChevronUp,
  Target, Globe, Code, Activity, Skull, Plus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `/api${p}`;

interface EvidenceItem {
  id: string; scanId: string; targetUrl: string; cveId: string; evidenceType: string;
  severity: string; title: string; description: string; request: string; response: string;
  payload: string; proofText: string; statusCode: string; responseTime: number;
  isVerified: boolean; isFalsePositive: boolean; createdAt: string;
}

const SEV_COLOR: Record<string, string> = { critical: "#ff4444", high: "#ff8844", medium: "#ffaa44", low: "#44ff88", info: "#44eebb" };
const TYPE_ICONS: Record<string, React.ElementType> = {
  header_analysis: Shield, xss: Code, sqli: AlertTriangle,
  open_redirect: ExternalLink, information_disclosure: Eye, ssrf: Target,
};

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };
const codeBlock: React.CSSProperties = { background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px", fontFamily: "monospace", fontSize: 11, color: "#44eebb", overflowX: "auto", maxHeight: 140, whiteSpace: "pre" };

export default function EvidenceDashboard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"scan" | "evidence" | "ioc">("scan");
  const [scanUrl, setScanUrl] = useState(() => {
    try {
      return localStorage.getItem("cybernova_active_target") || "";
    } catch {
      return "";
    }
  });
  const [scanResult, setScanResult] = useState<{
    scanId: string; target: string; findings: EvidenceItem[];
    totalFindings: number; aiReport: string; severity: Record<string, number>;
  } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState("");
  const [iocForm, setIocForm] = useState({ iocType: "ip", value: "", source: "manual", severity: "medium", description: "" });

  const { data: evidenceData, isLoading: evLoading } = useQuery<{ evidence: EvidenceItem[] }>({
    queryKey: ["evidence", severityFilter],
    queryFn: () => fetch(api(`/evidence?${severityFilter ? `severity=${severityFilter}` : ""}&limit=100`)).then(r => r.json()),
    enabled: tab === "evidence",
  });

  const { data: iocData, isLoading: iocLoading } = useQuery<{ iocs: Array<{ id: string; iocType: string; value: string; severity: string; source: string; description: string; firstSeen: string; isVerified: boolean }> }>({
    queryKey: ["ioc"],
    queryFn: () => fetch(api("/ioc")).then(r => r.json()),
    enabled: tab === "ioc",
  });

  const scanMut = useMutation({
    mutationFn: (url: string) => fetch(api("/evidence/scan"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).then(r => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ title: "خطأ", description: d.error, variant: "destructive" }); return; }
      setScanResult(d);
      toast({ title: `✅ انتهى الفحص — ${d.totalFindings} نتيجة`, description: `معرف الفحص: ${d.scanId}` });
    },
    onError: () => toast({ title: "خطأ", description: "فشل الفحص", variant: "destructive" }),
  });

  const verifyMut = useMutation({
    mutationFn: ({ id, isVerified, isFalsePositive }: { id: string; isVerified: boolean; isFalsePositive: boolean }) =>
      fetch(api(`/evidence/${id}/verify`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isVerified, isFalsePositive }) }).then(r => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["evidence"] }); },
  });

  const addIocMut = useMutation({
    mutationFn: (body: typeof iocForm) => fetch(api("/ioc"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "✅ تم إضافة IOC" });
      void qc.invalidateQueries({ queryKey: ["ioc"] });
      setIocForm({ iocType: "ip", value: "", source: "manual", severity: "medium", description: "" });
    },
  });

  const tabs = [
    { id: "scan", label: "الفحص النشط", icon: Zap, color: "#ff4444" },
    { id: "evidence", label: "الأدلة المجمّعة", icon: FileText, color: "#ffaa44" },
    { id: "ioc", label: "IOC — مؤشرات الاختراق", icon: Target, color: "#aa44ff" },
  ];

  function FindingCard({ f }: { f: EvidenceItem }) {
    const Icon = TYPE_ICONS[f.evidenceType] ?? Shield;
    const expanded = expandedId === f.id;
    const color = SEV_COLOR[f.severity] ?? "#888";
    return (
      <div className="rounded-xl overflow-hidden transition-all"
        style={{ border: f.isVerified ? "1px solid rgba(0,200,100,0.3)" : f.isFalsePositive ? "1px solid rgba(255,255,255,0.06)" : `1px solid rgba(180,0,255,0.1)`, background: "rgba(5,0,12,0.8)" }}>
        <div className="p-4 flex items-start gap-3 cursor-pointer" onClick={() => setExpandedId(expanded ? null : f.id)}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${color}14`, border: `1px solid ${color}30` }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-black" style={{ color: "rgba(255,255,255,0.8)" }}>{f.title}</span>
              <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                style={{ color, background: `${color}14`, border: `1px solid ${color}28` }}>{f.severity}</span>
              {f.isVerified && <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color: "#44ff88", background: "rgba(0,200,100,0.08)", border: "1px solid rgba(0,200,100,0.25)" }}>✓ مؤكد</span>}
              {f.isFalsePositive && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}>⊘ إيجابي كاذب</span>}
              {f.responseTime ? <span className="text-[9px] font-mono ms-auto" style={{ color: "rgba(255,255,255,0.25)" }}>{f.responseTime}ms</span> : null}
            </div>
            <p className="text-[10px] font-mono truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{f.description}</p>
            {f.proofText && <p className="text-[10px] font-mono mt-1 truncate" style={{ color: "#ffaa44" }}>{f.proofText}</p>}
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />}
        </div>
        {expanded && (
          <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            {f.payload && (
              <div><div className="text-[9px] font-black font-mono mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Payload المستخدم</div>
                <pre style={{ ...codeBlock, color: "#ffaa44" }}>{f.payload}</pre></div>
            )}
            {f.request && (
              <div><div className="text-[9px] font-black font-mono mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>الطلب (Request)</div>
                <pre style={{ ...codeBlock, color: "#4488ff" }}>{f.request}</pre></div>
            )}
            {f.response && (
              <div><div className="text-[9px] font-black font-mono mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>الرد (Response)</div>
                <pre style={{ ...codeBlock, color: "#44ff88" }}>{f.response}</pre></div>
            )}
            <div className="flex gap-2 flex-wrap pt-1">
              <button onClick={() => verifyMut.mutate({ id: f.id, isVerified: true, isFalsePositive: false })}
                className="flex items-center gap-1.5 text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
                style={{ background: "rgba(0,200,100,0.08)", border: "1px solid rgba(0,200,100,0.25)", color: "#44ff88" }}>
                <CheckCircle className="w-3 h-3" />تأكيد كدليل حقيقي
              </button>
              <button onClick={() => verifyMut.mutate({ id: f.id, isVerified: false, isFalsePositive: true })}
                className="flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded-xl transition-all"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
                <XCircle className="w-3 h-3" />إيجابي كاذب
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,rgba(255,100,0,0.3),rgba(255,30,30,0.2))", border: "1px solid rgba(255,80,0,0.4)" }}>
            <Search className="w-5 h-5" style={{ color: "#ff5555" }} />
          </div>
          <div>
            <h1 className="text-base font-black" style={{ color: "#ff5555", textShadow: "0 0 12px rgba(255,30,30,0.4)" }}>☠ الفحص النشط والأدلة</h1>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Active Scanner · Evidence Collector · IOC Tracker</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 px-6 pt-4">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black font-mono transition-all"
            style={tab === t.id
              ? { background: `${t.color}12`, border: `1px solid ${t.color}35`, color: t.color }
              : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4" style={{ scrollbarWidth: "thin" }}>

        {/* ── Scan Tab ── */}
        {tab === "scan" && (
          <div className="space-y-4">
            <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "#ff5555" }}>
                <Zap className="w-4 h-4" />فحص موقع — مع التقاط الأدلة
              </h3>
              <div className="flex gap-2">
                <input value={scanUrl} onChange={e => setScanUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !scanMut.isPending && scanMut.mutate(scanUrl)}
                  placeholder="https://example.com" dir="ltr"
                  style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => scanMut.mutate(scanUrl)} disabled={!scanUrl || scanMut.isPending}
                  className="flex items-center gap-2 px-5 rounded-xl font-black text-[12px] font-mono transition-all disabled:opacity-50"
                  style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
                  {scanMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {scanMut.isPending ? "جارٍ الفحص..." : "ابدأ الفحص"}
                </button>
              </div>
              <div className="flex flex-wrap gap-3 text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                {[{ icon: Shield, label: "Security Headers" }, { icon: Code, label: "XSS Detection" }, { icon: AlertTriangle, label: "SQL Injection" }, { icon: ExternalLink, label: "Open Redirect" }, { icon: Eye, label: "Sensitive Files" }].map(({ icon: Icon, label }) => (
                  <span key={label} className="flex items-center gap-1"><Icon className="w-3 h-3" />{label}</span>
                ))}
              </div>
            </div>

            {scanResult && (
              <div className="space-y-3">
                <div className="rounded-2xl p-4" style={NEON_CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "#ffaa44" }}>
                      <Activity className="w-4 h-4" />نتائج فحص: {scanResult.target}
                    </h3>
                    <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{scanResult.scanId}</span>
                  </div>
                  <div className="flex gap-3 flex-wrap items-center">
                    {Object.entries(scanResult.severity).filter(([, v]) => v > 0).map(([sev, count]) => {
                      const color = SEV_COLOR[sev] ?? "#888";
                      return (
                        <div key={sev} className="flex items-center gap-1.5">
                          <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                            style={{ color, background: `${color}14`, border: `1px solid ${color}28` }}>{sev}</span>
                          <span className="font-black text-sm" style={{ color }}>{count}</span>
                        </div>
                      );
                    })}
                    <div className="ms-auto text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>
                      إجمالي: <span className="font-black" style={{ color: "rgba(255,255,255,0.8)" }}>{scanResult.totalFindings}</span> نتيجة
                    </div>
                  </div>
                </div>

                {scanResult.aiReport && (
                  <div className="rounded-2xl p-4" style={{ background: "rgba(170,0,255,0.06)", border: "1px solid rgba(170,0,255,0.22)" }}>
                    <h3 className="text-sm font-black mb-3 flex items-center gap-2" style={{ color: "#aa44ff" }}>🧠 تقرير Llama3 الذكي</h3>
                    <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap" style={{ color: "rgba(255,255,255,0.6)" }}>{scanResult.aiReport}</pre>
                  </div>
                )}

                <div className="space-y-2">
                  {scanResult.findings.length === 0 ? (
                    <div className="text-center py-10 rounded-2xl" style={NEON_CARD}>
                      <CheckCircle className="w-8 h-8 mx-auto mb-2" style={{ color: "#44ff88" }} />
                      <p className="font-black text-sm" style={{ color: "#44ff88" }}>لم يُعثر على ثغرات واضحة</p>
                      <p className="text-[10px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>ذلك لا يعني الأمان الكامل — الفحص اليدوي ضروري دائماً</p>
                    </div>
                  ) : (
                    scanResult.findings.map((f, i) => (
                      <FindingCard key={f.id ?? `scan-${i}`} f={{ ...(f as unknown as EvidenceItem), id: (f as unknown as EvidenceItem).id ?? `scan-${i}` }} />
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Evidence Tab ── */}
        {tab === "evidence" && (
          <div className="space-y-4">
            <div className="flex gap-1.5 flex-wrap">
              {["", "critical", "high", "medium", "low", "info"].map(sev => {
                const color = sev ? (SEV_COLOR[sev] ?? "#888") : "#ff5555";
                return (
                  <button key={sev} onClick={() => setSeverityFilter(sev)}
                    className="px-3 py-1.5 rounded-xl text-[10px] font-black font-mono transition-all"
                    style={severityFilter === sev
                      ? { background: `${color}14`, border: `1px solid ${color}35`, color }
                      : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                    {sev === "" ? "الكل" : sev}
                  </button>
                );
              })}
            </div>
            {evLoading && <div className="text-center py-10 font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>جارٍ التحميل...</div>}
            <div className="space-y-2">
              {(evidenceData?.evidence ?? []).map(e => <FindingCard key={e.id} f={e} />)}
              {(evidenceData?.evidence ?? []).length === 0 && !evLoading && (
                <div className="text-center py-12 rounded-2xl space-y-2" style={NEON_CARD}>
                  <Skull className="w-10 h-10 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                  <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>لا توجد أدلة بعد — ابدأ فحصاً من تبويب الفحص النشط</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── IOC Tab ── */}
        {tab === "ioc" && (
          <div className="space-y-4">
            <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "#aa44ff" }}>
                <Target className="w-4 h-4" />إضافة مؤشر اختراق IOC
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black font-mono mb-1 block" style={{ color: "rgba(255,255,255,0.35)" }}>النوع</label>
                  <select value={iocForm.iocType} onChange={e => setIocForm(f => ({ ...f, iocType: e.target.value }))}
                    style={inputStyle as React.CSSProperties}>
                    {["ip", "domain", "url", "hash", "email", "cve"].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black font-mono mb-1 block" style={{ color: "rgba(255,255,255,0.35)" }}>الخطورة</label>
                  <select value={iocForm.severity} onChange={e => setIocForm(f => ({ ...f, severity: e.target.value }))}
                    style={inputStyle as React.CSSProperties}>
                    {["critical", "high", "medium", "low"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-[9px] font-black font-mono mb-1 block" style={{ color: "rgba(255,255,255,0.35)" }}>القيمة</label>
                  <input value={iocForm.value} onChange={e => setIocForm(f => ({ ...f, value: e.target.value }))}
                    placeholder="192.168.1.1 أو evil.com أو hash..." dir="ltr" style={inputStyle} />
                </div>
                <div className="col-span-2">
                  <label className="text-[9px] font-black font-mono mb-1 block" style={{ color: "rgba(255,255,255,0.35)" }}>الوصف</label>
                  <input value={iocForm.description} onChange={e => setIocForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="وصف مختصر لهذا المؤشر..." style={inputStyle} />
                </div>
              </div>
              <button onClick={() => addIocMut.mutate(iocForm)} disabled={!iocForm.value || addIocMut.isPending}
                className="flex items-center gap-2 text-[11px] font-black font-mono px-4 py-2 rounded-xl transition-all disabled:opacity-50"
                style={{ background: "rgba(170,0,255,0.1)", border: "1px solid rgba(170,0,255,0.3)", color: "#aa44ff" }}>
                {addIocMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}إضافة IOC
              </button>
            </div>

            {iocLoading && <div className="text-center py-6 font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>جارٍ التحميل...</div>}
            <div className="space-y-2">
              {(iocData?.iocs ?? []).map(ioc => {
                const color = SEV_COLOR[ioc.severity] ?? "#888";
                return (
                  <div key={ioc.id} className="rounded-xl p-3 flex items-center gap-3" style={DARK}>
                    <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)" }}>
                      {ioc.iocType.toUpperCase()}
                    </span>
                    <span className="text-sm font-mono flex-1 min-w-0 truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{ioc.value}</span>
                    <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded shrink-0"
                      style={{ color, background: `${color}14`, border: `1px solid ${color}28` }}>{ioc.severity}</span>
                    <span className="text-[9px] font-mono shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>{ioc.source}</span>
                    <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(255,255,255,0.15)" }} />
                  </div>
                );
              })}
              {(iocData?.iocs ?? []).length === 0 && !iocLoading && (
                <div className="text-center py-10 rounded-2xl space-y-2" style={NEON_CARD}>
                  <Skull className="w-10 h-10 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                  <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>لا توجد مؤشرات اختراق مسجّلة بعد</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
