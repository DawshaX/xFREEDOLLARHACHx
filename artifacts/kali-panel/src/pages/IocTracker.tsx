import { useState, useEffect } from "react";
import { Target, Plus, RefreshCw, Loader2, Shield, Search, Trash2, CheckCircle, AlertTriangle, XCircle, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface IOC {
  id: string; iocType: string; value: string; source: string; confidence: number;
  severity: string; description?: string; relatedCves: string[]; tags: string[];
  isActive: boolean; isVerified: boolean; firstSeen: string; lastSeen: string;
}
interface IOCStats { byType: Array<{ iocType: string; count: number }>; bySeverity: Array<{ severity: string; count: number }>; }

const TYPE_COLOR: Record<string, { color: string; bg: string; border: string }> = {
  ip:          { color: "#ff4444", bg: "rgba(255,30,30,0.08)", border: "rgba(255,30,30,0.3)" },
  domain:      { color: "#ffaa44", bg: "rgba(255,150,0,0.07)", border: "rgba(255,150,0,0.28)" },
  url:         { color: "#44eebb", bg: "rgba(0,240,180,0.06)", border: "rgba(0,240,180,0.2)" },
  hash:        { color: "#aa44ff", bg: "rgba(170,0,255,0.07)", border: "rgba(170,0,255,0.25)" },
  email:       { color: "#4488ff", bg: "rgba(0,100,255,0.07)", border: "rgba(0,100,255,0.22)" },
  file:        { color: "#44ff88", bg: "rgba(0,200,100,0.07)", border: "rgba(0,200,100,0.22)" },
  user_agent:  { color: "#ff88aa", bg: "rgba(255,80,120,0.07)", border: "rgba(255,80,120,0.22)" },
  registry_key:{ color: "#ffdd44", bg: "rgba(255,200,0,0.06)", border: "rgba(255,200,0,0.2)" },
};
const SEV_COLOR: Record<string, string> = {
  critical: "#ff4444", high: "#ff8844", medium: "#ffaa44", low: "#4488ff", info: "#44eebb",
};
const IOC_TYPES = ["ip", "domain", "url", "hash", "email", "file", "user_agent", "registry_key"];

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", width: "100%", outline: "none" };

export default function IocTracker() {
  const [iocs, setIocs] = useState<IOC[]>([]);
  const [stats, setStats] = useState<IOCStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ type: "all", severity: "all", search: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<IOC | null>(null);
  const [form, setForm] = useState({ iocType: "ip", value: "", source: "manual", severity: "medium", confidence: 0.8, description: "", tags: "" });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.type !== "all") params.set("type", filter.type);
      if (filter.severity !== "all") params.set("severity", filter.severity);
      const [iocData, statsData] = await Promise.all([
        jsonRequest<{ iocs: IOC[]; total: number }>(`/ioc?${params}`),
        jsonRequest<IOCStats>("/ioc/stats"),
      ]);
      setIocs(iocData.iocs);
      setStats(statsData);
    } catch { }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [filter.type, filter.severity]);

  async function addIoc() {
    if (!form.value) return;
    const r = await jsonRequest<{ ioc: IOC }>("/ioc", { method: "POST", body: JSON.stringify({ ...form, tags: form.tags ? form.tags.split(",").map((t) => t.trim()) : [] }) });
    setIocs((p) => [r.ioc, ...p]);
    setShowAdd(false);
    setForm({ iocType: "ip", value: "", source: "manual", severity: "medium", confidence: 0.8, description: "", tags: "" });
  }

  async function deleteIoc(id: string) {
    await jsonRequest(`/ioc/${id}`, { method: "DELETE" }).catch(() => {});
    setIocs((p) => p.filter((x) => x.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  const filtered = iocs.filter((ioc) => !filter.search || ioc.value.includes(filter.search) || (ioc.description ?? "").includes(filter.search));

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ IOC Tracker" subtitle="تتبع مؤشرات الاختراق — IP / Domain / Hash / URL في الوقت الحقيقي" icon={Target} danger
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-1.5 rounded-lg transition-all"
              style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.15)", color: "#ff5555" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 text-[11px] font-black font-mono px-3 py-1.5 rounded-lg transition-all"
              style={{ background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.4)", color: "#ff5555", boxShadow: "0 0 12px rgba(255,0,0,0.1)" }}>
              <Plus className="w-3.5 h-3.5" />☠ إضافة IOC
            </button>
          </div>
        }
      />

      {/* ── Stats by severity ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(stats?.bySeverity.length ? stats.bySeverity : [{ severity: "total", count: iocs.length }]).map(({ severity, count }) => (
          <div key={severity} className="rounded-xl p-4 text-center" style={NEON_CARD}>
            <div className="text-2xl font-black font-mono" style={{ color: SEV_COLOR[severity] ?? "#aa44ff", textShadow: `0 0 15px ${SEV_COLOR[severity] ?? "#aa44ff"}66` }}>{count}</div>
            <div className="text-[10px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>{severity}</div>
          </div>
        ))}
      </div>

      {/* ── Type Distribution ── */}
      {stats && stats.byType.length > 0 && (
        <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#aa44ff" }}>
            <Shield className="w-4 h-4" />توزيع الأنواع
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.byType.map(({ iocType, count }) => {
              const s = TYPE_COLOR[iocType] ?? TYPE_COLOR.ip!;
              const isActive = filter.type === iocType;
              return (
                <button key={iocType} onClick={() => setFilter((f) => ({ ...f, type: f.type === iocType ? "all" : iocType }))}
                  className="flex items-center gap-1.5 text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
                  style={isActive
                    ? { background: s.bg, border: `1px solid ${s.border}`, color: s.color }
                    : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
                  {iocType} <span className="font-black">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Add IOC Form ── */}
      {showAdd && (
        <div className="rounded-2xl p-5 space-y-4" style={{ ...NEON_CARD, border: "1px solid rgba(255,30,30,0.25)" }}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff4444" }}>
            <Plus className="w-4 h-4" />☠ إضافة IOC جديد
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>النوع</label>
              <select style={inputStyle as React.CSSProperties} value={form.iocType} onChange={(e) => setForm((f) => ({ ...f, iocType: e.target.value }))}>
                {IOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>القيمة *</label>
              <input style={inputStyle} placeholder="1.2.3.4 أو evil.com أو abc123..." value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>الخطورة</label>
              <select style={inputStyle as React.CSSProperties} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
                {["critical", "high", "medium", "low", "info"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>المصدر</label>
              <input style={inputStyle} value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>الثقة (0-1)</label>
              <input type="number" min={0} max={1} step={0.1} style={inputStyle} value={form.confidence} onChange={(e) => setForm((f) => ({ ...f, confidence: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>الوصف</label>
            <input style={inputStyle} placeholder="وصف مختصر..." value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="text-[10px] font-mono mb-1.5 block" style={{ color: "rgba(255,255,255,0.4)" }}>Tags (فاصلة)</label>
            <input style={inputStyle} placeholder="apt,ransomware,c2" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="text-[11px] font-mono px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>إلغاء</button>
            <button onClick={addIoc} disabled={!form.value} className="text-[11px] font-black font-mono px-4 py-1.5 rounded-lg transition-all disabled:opacity-50" style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
              ⚡ إضافة IOC
            </button>
          </div>
        </div>
      )}

      {/* ── Search + Severity Filter ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-48 rounded-xl px-3 py-1.5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <Search className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
          <input className="bg-transparent text-sm font-mono flex-1 outline-none" placeholder="بحث في IOCs..." dir="ltr"
            style={{ color: "rgba(255,255,255,0.7)" }} value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} />
        </div>
        {["all", "critical", "high", "medium", "low"].map((sev) => (
          <button key={sev} onClick={() => setFilter((f) => ({ ...f, severity: sev }))}
            className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
            style={filter.severity === sev
              ? { background: `${SEV_COLOR[sev] ?? "#aa44ff"}14`, border: `1px solid ${SEV_COLOR[sev] ?? "#aa44ff"}40`, color: SEV_COLOR[sev] ?? "#aa44ff" }
              : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
            {sev === "all" ? "◈ الكل" : sev}
          </button>
        ))}
      </div>

      {/* ── IOC List + Detail ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2 max-h-[620px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#ff5555" }} /></div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl p-8 text-center space-y-3" style={NEON_CARD}>
              <Skull className="w-10 h-10 mx-auto" style={{ color: "rgba(255,255,255,0.08)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد IOCs مطابقة</p>
            </div>
          ) : filtered.map((ioc) => {
            const ts = TYPE_COLOR[ioc.iocType] ?? TYPE_COLOR.ip!;
            return (
              <button key={ioc.id} onClick={() => setSelected(ioc)}
                className="w-full rounded-xl p-3 text-right transition-all"
                style={{
                  background: selected?.id === ioc.id ? ts.bg : "rgba(8,0,18,0.9)",
                  border: `1px solid ${selected?.id === ioc.id ? ts.border : "rgba(180,0,255,0.1)"}`,
                }}>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: ts.color, background: ts.bg, border: `1px solid ${ts.border}` }}>{ioc.iocType}</span>
                  <code className="text-xs font-mono flex-1 truncate text-left" style={{ color: "#44eebb" }} dir="ltr">{ioc.value}</code>
                  <span className="text-[9px] font-black font-mono shrink-0" style={{ color: SEV_COLOR[ioc.severity] ?? "#888" }}>{ioc.severity}</span>
                  {ioc.isVerified ? <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "#44ff88" }} /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(255,170,0,0.4)" }} />}
                  <button onClick={(e) => { e.stopPropagation(); void deleteIoc(ioc.id); }}
                    className="p-1 shrink-0 transition-all" style={{ color: "rgba(255,255,255,0.2)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ff5555"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.2)"; }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[9px] font-mono flex-wrap" style={{ color: "rgba(255,255,255,0.25)" }}>
                  <span>{ioc.source}</span>
                  <span>ثقة: {Math.round(ioc.confidence * 100)}%</span>
                  <span>{new Date(ioc.lastSeen).toLocaleDateString("ar-EG")}</span>
                  {ioc.relatedCves.length > 0 && <span style={{ color: "#44eebb" }}>{ioc.relatedCves[0]}</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div className="rounded-2xl p-5" style={NEON_CARD}>
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                {(() => { const ts = TYPE_COLOR[selected.iocType] ?? TYPE_COLOR.ip!; return (
                  <span className="text-[10px] font-black font-mono px-2 py-1 rounded"
                    style={{ color: ts.color, background: ts.bg, border: `1px solid ${ts.border}` }}>{selected.iocType}</span>
                ); })()}
                <span className="text-[10px] font-black font-mono" style={{ color: SEV_COLOR[selected.severity] ?? "#888" }}>{selected.severity}</span>
                {selected.isVerified && <span className="text-[10px] font-black font-mono flex items-center gap-1" style={{ color: "#44ff88" }}><CheckCircle className="w-3 h-3" />مُتحقق</span>}
                {!selected.isActive && <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: "rgba(255,255,255,0.3)" }}><XCircle className="w-3 h-3" />غير نشط</span>}
              </div>
              <div>
                <h3 className="text-[10px] font-black font-mono mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>القيمة:</h3>
                <code className="text-sm font-mono break-all" style={{ color: "#44eebb" }} dir="ltr">{selected.value}</code>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px] font-mono">
                <div><span style={{ color: "rgba(255,255,255,0.35)" }}>المصدر: </span><span style={{ color: "rgba(255,255,255,0.6)" }}>{selected.source}</span></div>
                <div><span style={{ color: "rgba(255,255,255,0.35)" }}>الثقة: </span><span style={{ color: "rgba(255,255,255,0.6)" }}>{Math.round(selected.confidence * 100)}%</span></div>
                <div><span style={{ color: "rgba(255,255,255,0.35)" }}>أول ظهور: </span><span style={{ color: "rgba(255,255,255,0.6)" }}>{new Date(selected.firstSeen).toLocaleDateString("ar-EG")}</span></div>
                <div><span style={{ color: "rgba(255,255,255,0.35)" }}>آخر ظهور: </span><span style={{ color: "rgba(255,255,255,0.6)" }}>{new Date(selected.lastSeen).toLocaleDateString("ar-EG")}</span></div>
              </div>
              {selected.description && <p className="text-[11px] font-mono leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>{selected.description}</p>}
              {selected.relatedCves.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black font-mono mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>CVEs مرتبطة:</h4>
                  <div className="flex flex-wrap gap-1">
                    {selected.relatedCves.map((cve) => (
                      <span key={cve} className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff5555" }}>{cve}</span>
                    ))}
                  </div>
                </div>
              )}
              {selected.tags.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black font-mono mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>Tags:</h4>
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map((tag) => (
                      <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.45)" }}>{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-52 space-y-3">
              <Target className="w-12 h-12" style={{ color: "rgba(255,255,255,0.07)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>اختر IOC لعرض تفاصيله</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
