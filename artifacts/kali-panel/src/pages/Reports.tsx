import { useState, useEffect } from "react";
import { FileText, Plus, Download, Trash2, RefreshCw, Loader2, Eye, Shield, Target, Search, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface Report { id: number; title: string; target: string; kind: string; summary?: string; markdown?: string; createdAt: string; }

const REPORT_KINDS = ["penetration_test", "vulnerability_assessment", "security_audit", "incident_response", "risk_assessment"];
const KIND_LABELS: Record<string, string> = {
  penetration_test: "اختبار اختراق",
  vulnerability_assessment: "تقييم ثغرات",
  security_audit: "تدقيق أمني",
  incident_response: "استجابة للحوادث",
  risk_assessment: "تقييم مخاطر",
};
const KIND_COLORS: Record<string, string> = {
  penetration_test: "#ff4444",
  vulnerability_assessment: "#ff8844",
  security_audit: "#44eebb",
  incident_response: "#ffaa44",
  risk_assessment: "#aa44ff",
};

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", width: "100%", outline: "none" };

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", target: "", kind: "penetration_test", notes: "" });

  async function load() {
    setLoading(true);
    try { const r = await jsonRequest<Report[]>("/reports"); setReports(r); } catch { }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function generateReport() {
    if (!form.title || !form.target) return;
    setGenerating(true);
    try {
      const r = await jsonRequest<Report>("/reports", { method: "POST", body: JSON.stringify(form) });
      setReports((p) => [r, ...p]);
      setShowCreate(false);
      setSelectedReport(r);
      setForm({ title: "", target: "", kind: "penetration_test", notes: "" });
    } catch { } finally { setGenerating(false); }
  }

  async function deleteReport(id: number) {
    if (!confirm("حذف هذا التقرير؟")) return;
    await jsonRequest(`/reports/${id}`, { method: "DELETE" }).catch(() => {});
    setReports((p) => p.filter((r) => r.id !== id));
    if (selectedReport?.id === id) setSelectedReport(null);
  }

  function downloadReport(report: Report) {
    const blob = new Blob([report.markdown ?? report.summary ?? ""], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${report.title}.md`; a.click();
    URL.revokeObjectURL(url);
  }

  const statCards = [
    { label: "إجمالي التقارير", value: reports.length, icon: FileText, color: "#aa44ff" },
    { label: "اختبار اختراق", value: reports.filter((r) => r.kind === "penetration_test").length, icon: Target, color: "#ff4444" },
    { label: "تقييم ثغرات", value: reports.filter((r) => r.kind === "vulnerability_assessment").length, icon: Shield, color: "#ff8844" },
    { label: "تدقيق أمني", value: reports.filter((r) => r.kind === "security_audit").length, icon: Search, color: "#44eebb" },
  ];

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ التقارير الأمنية" subtitle="مولد تقارير ذكي — تقييمات أمنية احترافية باللغة العربية" icon={FileText} danger
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-1.5 rounded-lg transition-all"
              style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.15)", color: "#ff5555" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 text-[11px] font-black font-mono px-3 py-1.5 rounded-lg transition-all"
              style={{ background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.4)", color: "#ff5555", boxShadow: "0 0 12px rgba(255,0,0,0.1)" }}>
              <Plus className="w-3.5 h-3.5" />⚡ تقرير جديد
            </button>
          </div>
        }
      />

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl p-4" style={NEON_CARD}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4" style={{ color }} />
              <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</span>
            </div>
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 15px ${color}44` }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Create Form ── */}
      {showCreate && (
        <div className="rounded-2xl p-5 space-y-4" style={{ ...NEON_CARD, border: "1px solid rgba(255,30,30,0.25)" }}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff4444" }}>
            <Plus className="w-4 h-4" />☠ إنشاء تقرير جديد
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>عنوان التقرير *</label>
              <input style={inputStyle} placeholder="مثال: تقرير اختبار اختراق example.com" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>الهدف *</label>
              <input style={inputStyle} placeholder="example.com أو 192.168.1.0/24" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} dir="ltr" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>نوع التقرير</label>
            <select style={inputStyle as React.CSSProperties} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
              {REPORT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>ملاحظات إضافية</label>
            <textarea style={{ ...inputStyle, resize: "none" } as React.CSSProperties} rows={3} placeholder="أي معلومات إضافية عن النطاق أو النتائج..." value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="text-[11px] font-mono px-3 py-1.5 rounded-lg"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>إلغاء</button>
            <button onClick={generateReport} disabled={generating || !form.title || !form.target}
              className="flex items-center gap-2 text-[11px] font-black font-mono px-4 py-1.5 rounded-lg transition-all disabled:opacity-50"
              style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
              {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />جاري التوليد...</> : <><Plus className="w-3.5 h-3.5" />⚡ توليد التقرير</>}
            </button>
          </div>
        </div>
      )}

      {/* ── List + Viewer ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Reports List */}
        <div className="lg:col-span-1 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#ff5555" }} /></div>
          ) : reports.length === 0 ? (
            <div className="rounded-xl p-8 text-center space-y-3" style={NEON_CARD}>
              <Skull className="w-10 h-10 mx-auto" style={{ color: "rgba(255,255,255,0.08)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد تقارير بعد</p>
            </div>
          ) : reports.map((report) => {
            const color = KIND_COLORS[report.kind] ?? "#aa44ff";
            return (
              <button key={report.id} onClick={() => setSelectedReport(report)}
                className="w-full rounded-xl p-4 text-right transition-all"
                style={{
                  background: selectedReport?.id === report.id ? `${color}08` : "rgba(8,0,18,0.9)",
                  border: `1px solid ${selectedReport?.id === report.id ? color + "35" : "rgba(180,0,255,0.1)"}`,
                }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{report.title}</p>
                    <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.35)" }} dir="ltr">{report.target}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                        style={{ color, background: `${color}12`, border: `1px solid ${color}30` }}>
                        {KIND_LABELS[report.kind] ?? report.kind}
                      </span>
                      <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
                        {new Date(report.createdAt).toLocaleDateString("ar-EG")}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); downloadReport(report); }}
                      className="p-1 transition-all" style={{ color: "rgba(255,255,255,0.2)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#44eebb"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.2)"; }}>
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); void deleteReport(report.id); }}
                      className="p-1 transition-all" style={{ color: "rgba(255,255,255,0.2)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ff5555"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.2)"; }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Report Viewer */}
        <div className="lg:col-span-2 rounded-2xl p-5" style={NEON_CARD}>
          {selectedReport ? (
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-black text-base" style={{ color: "rgba(255,255,255,0.85)" }}>{selectedReport.title}</h2>
                  <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {selectedReport.target} · {KIND_LABELS[selectedReport.kind]}
                  </p>
                </div>
                <button onClick={() => downloadReport(selectedReport)}
                  className="flex items-center gap-1.5 text-[11px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
                  style={{ background: "rgba(0,240,180,0.08)", border: "1px solid rgba(0,240,180,0.25)", color: "#44eebb" }}>
                  <Download className="w-3 h-3" />تحميل
                </button>
              </div>
              <div className="flex-1 overflow-y-auto rounded-xl p-4" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.04)", minHeight: 400, scrollbarWidth: "thin" }}>
                {selectedReport.markdown ? (
                  <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>{selectedReport.markdown}</pre>
                ) : (
                  <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>{selectedReport.summary ?? "لا يوجد محتوى"}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 space-y-3">
              <Eye className="w-12 h-12" style={{ color: "rgba(255,255,255,0.07)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>اختر تقريراً لعرض محتواه</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
