import { useState, useEffect, useCallback } from "react";
import { Database, Plus, Trash2, Skull, X, Pin, Search, RefreshCw } from "lucide-react";
import { jsonRequest } from "@/lib/sse";

interface MemoryItem {
  id: string;
  kind: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: string;
}

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };
const KIND_COLOR: Record<string, string> = { fact: "#4488ff", project: "#44ff88", preference: "#aa44ff", contact: "#ffaa44" };
const KIND_RGB: Record<string, string> = { fact: "68,136,255", project: "68,255,136", preference: "170,68,255", contact: "255,170,68" };

export default function Memory() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [kind, setKind] = useState("fact");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const url = q ? `/memory?search=${encodeURIComponent(q)}` : "/memory";
      const data = await jsonRequest<MemoryItem[]>(url);
      setMemories(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => { void load(search || undefined); }, 350);
    return () => clearTimeout(t);
  }, [search, load]);

  const kinds = ["all", "fact", "project", "preference", "contact"];
  const getVisible = () => {
    if (activeTab === "all") return memories;
    return memories.filter(m => m.kind === activeTab);
  };

  const handleCreate = async () => {
    if (!title || !content) return;
    setSaving(true);
    try {
      const created = await jsonRequest<MemoryItem>("/memory", {
        method: "POST",
        body: JSON.stringify({ kind, title, content }),
      });
      setMemories(p => [created, ...p]);
      setShowAdd(false); setTitle(""); setContent("");
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await jsonRequest(`/memory/${id}`, { method: "DELETE" });
    setMemories(p => p.filter(m => m.id !== id));
  };

  const handlePin = async (item: MemoryItem) => {
    const { pinned } = await jsonRequest<{ id: string; pinned: boolean }>(`/memory/${item.id}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: !item.pinned }),
    });
    setMemories(p => {
      const updated = p.map(m => m.id === item.id ? { ...m, pinned } : m);
      return [...updated.filter(m => m.pinned), ...updated.filter(m => !m.pinned)];
    });
  };

  const visible = getVisible();

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Database className="w-6 h-6" style={{ color: "#ff5555" }} />
          <div>
            <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>ذاكرة الوكيل</h1>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Long-term Agent Memory — {memories.length} عنصر · {memories.filter(m => m.pinned).length} مثبت</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load(search || undefined)} className="p-2 rounded-xl" style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] transition-all"
            style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff5555" }}>
            <Plus className="w-3.5 h-3.5" />إضافة ذاكرة
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.25)" }} />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث في الذاكرة..."
          style={{ ...inputStyle, paddingRight: "32px" }} />
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="w-full max-w-md p-5 space-y-4 rounded-2xl" style={NEON_CARD} dir="rtl">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-sm" style={{ color: "#ff5555" }}>إضافة عنصر جديد</h2>
              <button onClick={() => setShowAdd(false)} style={{ color: "rgba(255,255,255,0.3)" }}><X className="w-4 h-4" /></button>
            </div>
            <select value={kind} onChange={e => setKind(e.target.value)} style={inputStyle}>
              <option value="fact">Fact (حقيقة)</option>
              <option value="project">Project (مشروع)</option>
              <option value="preference">Preference (تفضيل)</option>
              <option value="contact">Contact (جهة اتصال)</option>
            </select>
            <input placeholder="العنوان" style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} />
            <textarea placeholder="المحتوى" style={{ ...inputStyle, minHeight: 100, resize: "vertical" }} value={content} onChange={e => setContent(e.target.value)} />
            <button onClick={handleCreate} disabled={!title || !content || saving}
              className="w-full py-2 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}حفظ
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {kinds.map(k => {
          const count = k === "all" ? memories.length : memories.filter(m => m.kind === k).length;
          const color = KIND_COLOR[k] ?? "#888"; const rgb = KIND_RGB[k] ?? "136,136,136"; const active = activeTab === k;
          return (
            <button key={k} onClick={() => setActiveTab(k)}
              className="px-3 py-1.5 rounded-xl font-black text-[10px] font-mono transition-all"
              style={active ? { background: `rgba(${rgb ?? "255,85,85"},0.12)`, border: `1px solid rgba(${rgb ?? "255,85,85"},0.35)`, color: k === "all" ? "#ff5555" : color } : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
              {k === "all" ? "الكل" : k} ({count})
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 animate-spin" style={{ color: "rgba(255,85,85,0.4)" }} />
        </div>
      ) : !visible.length ? (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>{search ? "لا نتائج للبحث" : "لا توجد عناصر في هذا القسم"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(item => {
            const color = KIND_COLOR[item.kind] ?? "#888"; const rgb = KIND_RGB[item.kind] ?? "136,136,136";
            return (
              <div key={item.id} className="rounded-xl p-4 space-y-2 group relative transition-all"
                style={{ background: `rgba(${rgb},0.04)`, border: `1px solid rgba(${item.pinned ? rgb + ",0.4" : rgb + ",0.15"})`, borderRadius: 14 }}>
                {item.pinned && (
                  <div className="absolute top-2 left-2">
                    <Pin className="w-3 h-3" style={{ color }} />
                  </div>
                )}
                <div className="absolute top-2 start-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => void handlePin(item)}
                    className="p-1 rounded-lg"
                    style={{ background: item.pinned ? `rgba(${rgb},0.15)` : "rgba(255,255,255,0.05)", border: `1px solid rgba(${rgb},0.2)`, color: item.pinned ? color : "rgba(255,255,255,0.3)" }}
                    title={item.pinned ? "إلغاء التثبيت" : "تثبيت"}>
                    <Pin className="w-3 h-3" />
                  </button>
                  <button onClick={() => void handleDelete(item.id)}
                    className="p-1 rounded-lg"
                    style={{ background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff4444" }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                  style={{ color, background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.25)` }}>{item.kind}</span>
                <h3 className="font-black text-sm" style={{ color }}>{item.title}</h3>
                <p className="text-[10px] font-mono whitespace-pre-wrap" style={{ color: "rgba(255,255,255,0.4)" }}>{item.content}</p>
                <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>{new Date(item.createdAt).toLocaleDateString("ar-EG")}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
