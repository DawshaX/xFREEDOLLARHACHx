import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Server, Plus, Trash2, Edit3, Globe, CheckCircle,
  AlertTriangle, Shield, Database, Code, Smartphone, Network, Skull
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `/api${p}`;

interface Asset {
  id: string; name: string; description: string; techStack: string[];
  domains: string[]; ips: string[]; category: string; criticality: string;
  owner: string; notes: string; isActive: boolean; tags: string[]; createdAt: string;
}

const CRIT_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#ff4444", bg: "rgba(255,30,30,0.1)", border: "rgba(255,30,30,0.35)" },
  high:     { color: "#ff8844", bg: "rgba(255,100,0,0.08)", border: "rgba(255,100,0,0.3)" },
  medium:   { color: "#ffaa44", bg: "rgba(255,150,0,0.07)", border: "rgba(255,150,0,0.25)" },
  low:      { color: "#44cc88", bg: "rgba(0,200,100,0.07)", border: "rgba(0,200,100,0.22)" },
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  web: Globe, api: Code, mobile: Smartphone,
  network: Network, server: Server, database: Database,
};

const POPULAR_STACKS = ["nodejs", "python", "php", "java", "nginx", "apache", "mysql", "postgresql", "mongodb", "redis", "docker", "kubernetes", "wordpress", "react", "express"];

const BLANK_FORM = { name: "", description: "", techStack: [] as string[], domains: [""], ips: [""], category: "web", criticality: "medium", owner: "", notes: "", tags: [] as string[] };

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", width: "100%", outline: "none" };
const labelStyle: React.CSSProperties = { fontSize: 10, fontFamily: "monospace", marginBottom: 6, display: "block", color: "rgba(255,255,255,0.4)" };

export default function Assets() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [stackInput, setStackInput] = useState("");

  const { data, isLoading } = useQuery<{ assets: Asset[] }>({
    queryKey: ["assets"],
    queryFn: () => fetch(api("/assets")).then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (body: typeof form) => fetch(api("/assets"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { toast({ title: "✅ تم إضافة الأصل" }); qc.invalidateQueries({ queryKey: ["assets"] }); setShowForm(false); setForm({ ...BLANK_FORM }); },
    onError: () => toast({ title: "خطأ", description: "فشل إضافة الأصل", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<typeof form> }) => fetch(api(`/assets/${id}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { toast({ title: "✅ تم التحديث" }); qc.invalidateQueries({ queryKey: ["assets"] }); setShowForm(false); setEditId(null); setForm({ ...BLANK_FORM }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetch(api(`/assets/${id}`), { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { toast({ title: "✅ تم الحذف" }); qc.invalidateQueries({ queryKey: ["assets"] }); },
  });

  const handleSubmit = () => {
    const body = { ...form, domains: form.domains.filter(Boolean), ips: form.ips.filter(Boolean) };
    if (editId) updateMut.mutate({ id: editId, body });
    else createMut.mutate(body);
  };

  const startEdit = (asset: Asset) => {
    setForm({ name: asset.name, description: asset.description, techStack: asset.techStack ?? [], domains: asset.domains.length ? asset.domains : [""], ips: asset.ips.length ? asset.ips : [""], category: asset.category, criticality: asset.criticality, owner: asset.owner ?? "", notes: asset.notes ?? "", tags: asset.tags ?? [] });
    setEditId(asset.id); setShowForm(true);
  };

  const addStack = (tech: string) => {
    const t = tech.trim().toLowerCase();
    if (t && !form.techStack.includes(t)) setForm(f => ({ ...f, techStack: [...f.techStack, t] }));
    setStackInput("");
  };

  const assets = data?.assets ?? [];

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">

      {/* ── Header ── */}
      <div className="rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4" style={NEON_CARD}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,rgba(0,100,255,0.3),rgba(0,200,255,0.15))", border: "1px solid rgba(0,150,255,0.4)", boxShadow: "0 0 20px rgba(0,100,255,0.15)" }}>
            <Shield className="w-6 h-6" style={{ color: "#4488ff", filter: "drop-shadow(0 0 6px rgba(0,100,255,0.8))" }} />
          </div>
          <div>
            <h1 className="text-lg font-black" style={{ color: "#4488ff", textShadow: "0 0 15px rgba(0,100,255,0.5)" }}>
              ◈ مخزون الأصول
            </h1>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
              Asset Inventory · ربط الثغرات بالأنظمة الخاصة بك
            </p>
          </div>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ ...BLANK_FORM }); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-[12px] font-mono transition-all"
          style={{ background: "rgba(0,100,255,0.12)", border: "1px solid rgba(0,100,255,0.35)", color: "#4488ff", boxShadow: "0 0 12px rgba(0,100,255,0.1)" }}>
          <Plus className="w-4 h-4" />+ إضافة أصل
        </button>
      </div>

      {/* ── Form ── */}
      {showForm && (
        <div className="rounded-2xl p-5 space-y-4" style={{ ...NEON_CARD, border: "1px solid rgba(0,100,255,0.25)" }}>
          <h3 className="font-black text-sm" style={{ color: "#4488ff" }}>
            {editId ? "✏ تعديل الأصل" : "◈ إضافة أصل جديد"}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={labelStyle}>اسم الأصل *</label>
              <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: Production API Server" />
            </div>
            <div>
              <label style={labelStyle}>النوع</label>
              <select style={inputStyle as React.CSSProperties} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {["web", "api", "mobile", "network", "server", "database"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>الأهمية</label>
              <select style={inputStyle as React.CSSProperties} value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value }))}>
                {["critical", "high", "medium", "low"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>المالك</label>
              <input style={inputStyle} value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} placeholder="فريق التطوير..." />
            </div>
          </div>

          <div>
            <label style={labelStyle}>النطاقات (Domains)</label>
            {form.domains.map((d, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input style={{ ...inputStyle, flex: 1 }} value={d}
                  onChange={e => { const ds = [...form.domains]; ds[i] = e.target.value; setForm(f => ({ ...f, domains: ds })); }}
                  placeholder="example.com" dir="ltr" />
                {i === form.domains.length - 1 && (
                  <button onClick={() => setForm(f => ({ ...f, domains: [...f.domains, ""] }))}
                    className="px-3 py-2 rounded-lg font-mono text-[10px] transition-all"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div>
            <label style={labelStyle}>التقنيات المستخدمة (Tech Stack)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.techStack.map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, techStack: f.techStack.filter(x => x !== t) }))}
                  className="text-[9px] font-mono px-2 py-0.5 rounded-full transition-all"
                  style={{ background: "rgba(0,100,255,0.12)", border: "1px solid rgba(0,100,255,0.3)", color: "#4488ff" }}>
                  {t} ×
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-2">
              <input style={{ ...inputStyle, flex: 1 }} value={stackInput}
                onChange={e => setStackInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addStack(stackInput); }}
                placeholder="أضف تقنية..." />
              <button onClick={() => addStack(stackInput)}
                className="px-3 py-2 rounded-lg font-mono text-[10px] transition-all"
                style={{ background: "rgba(0,100,255,0.1)", border: "1px solid rgba(0,100,255,0.25)", color: "#4488ff" }}>
                إضافة
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR_STACKS.filter(t => !form.techStack.includes(t)).map(t => (
                <button key={t} onClick={() => addStack(t)}
                  className="text-[9px] px-2 py-0.5 rounded font-mono transition-all"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#4488ff"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)"; }}>
                  + {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>ملاحظات</label>
            <input style={inputStyle} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="أي ملاحظات إضافية..." />
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setEditId(null); }}
              className="text-[11px] font-mono px-3 py-1.5 rounded-lg"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>إلغاء</button>
            <button onClick={handleSubmit} disabled={!form.name || createMut.isPending || updateMut.isPending}
              className="flex items-center gap-2 text-[11px] font-black font-mono px-4 py-1.5 rounded-lg transition-all disabled:opacity-50"
              style={{ background: "rgba(0,100,255,0.15)", border: "1px solid rgba(0,100,255,0.4)", color: "#4488ff" }}>
              {(createMut.isPending || updateMut.isPending) ? "جارٍ الحفظ..." : editId ? "✓ تحديث" : "◈ إضافة"}
            </button>
          </div>
        </div>
      )}

      {/* ── Assets List ── */}
      {isLoading && (
        <div className="text-center py-10 font-mono text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>جارٍ التحميل...</div>
      )}
      {assets.length === 0 && !isLoading && !showForm && (
        <div className="text-center py-14 space-y-3">
          <Skull className="w-14 h-14 mx-auto" style={{ color: "rgba(255,255,255,0.07)" }} />
          <p className="text-lg font-black" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد أصول بعد</p>
          <p className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>أضف أصولك (سيرفرات، مواقع، APIs) لربطها بالثغرات تلقائياً</p>
          <button className="mt-4 px-5 py-2.5 rounded-xl font-black text-[12px] font-mono transition-all"
            onClick={() => setShowForm(true)}
            style={{ background: "rgba(0,100,255,0.12)", border: "1px solid rgba(0,100,255,0.35)", color: "#4488ff" }}>
            <Plus className="w-4 h-4 inline mr-1" /> إضافة أول أصل
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {assets.map(asset => {
          const CatIcon = CATEGORY_ICONS[asset.category] ?? Server;
          const cs = CRIT_STYLE[asset.criticality] ?? CRIT_STYLE.medium!;
          return (
            <div key={asset.id} className="rounded-xl p-5 transition-all" style={NEON_CARD}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,100,255,0.2)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,0,255,0.12)"; }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(0,100,255,0.1)", border: "1px solid rgba(0,100,255,0.2)" }}>
                    <CatIcon className="w-4 h-4" style={{ color: "#4488ff" }} />
                  </div>
                  <div>
                    <h3 className="font-black text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>{asset.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                        style={{ color: cs.color, background: cs.bg, border: `1px solid ${cs.border}` }}>
                        {asset.criticality}
                      </span>
                      <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{asset.category}</span>
                      {asset.owner && <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>· {asset.owner}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(asset)} className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                    style={{ color: "rgba(255,255,255,0.2)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#4488ff"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.2)"; }}>
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteMut.mutate(asset.id)} className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                    style={{ color: "rgba(255,255,255,0.2)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ff5555"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.2)"; }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {asset.domains?.filter(Boolean).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {asset.domains.filter(Boolean).map(d => (
                    <div key={d} className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded"
                      style={{ background: "rgba(0,240,180,0.05)", border: "1px solid rgba(0,240,180,0.12)", color: "#44eebb" }} dir="ltr">
                      <Globe className="w-3 h-3 shrink-0" /> {d}
                    </div>
                  ))}
                </div>
              )}

              {asset.techStack?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {asset.techStack.map(t => (
                    <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(0,200,255,0.06)", border: "1px solid rgba(0,200,255,0.15)", color: "#44ccff" }}>{t}</span>
                  ))}
                </div>
              )}

              {asset.notes && <p className="text-[10px] font-mono mt-2 line-clamp-1" style={{ color: "rgba(255,255,255,0.35)" }}>{asset.notes}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
