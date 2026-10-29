import { useState, useEffect, useCallback } from "react";
import {
  BookOpen, Search, FileText, Shield, Code, Database, Globe, Lock,
  Plus, Upload, RefreshCw, Brain, Trash2, Tag, X, ChevronDown, ChevronUp, Skull,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";

const API_BASE = (() => {
  const base = "";
  return "/api";
})();

interface KnowledgeEntry { id: number; title: string; category: string; content: string; tags: string[]; createdAt: string; }
interface SearchResult { title: string; content: string; score: number; }

const CAT_COLOR: Record<string, string> = {
  web: "#4488ff", tools: "#44eebb", tactics: "#ff4444",
  shells: "#ff8844", post: "#aa44ff", internal: "#ff88cc",
  general: "#888888", الأمن: "#ff4444", الشبكات: "#4488ff", البرمجة: "#44ff88",
};
const CAT_ICON: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  web: Globe, tools: Code, tactics: Shield, shells: Code,
  post: Shield, internal: Database, general: FileText,
  الأمن: Shield, الشبكات: Globe, البرمجة: Code,
};
function getCatColor(cat: string): string { return CAT_COLOR[cat] ?? "#888888"; }
function getCatIcon(cat: string): React.ComponentType<{ className?: string; style?: React.CSSProperties }> { return CAT_ICON[cat] ?? FileText; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none" };

export default function Knowledge() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [selectedCat, setSelectedCat] = useState("الكل");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [newEntry, setNewEntry] = useState({ title: "", category: "general", content: "", tags: "" });
  const [uploadText, setUploadText] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/knowledge`);
      if (r.ok) setEntries(await r.json() as KnowledgeEntry[]);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  const categories = ["الكل", ...Array.from(new Set(entries.map(e => e.category)))];

  const filtered = searchResults
    ? []
    : entries.filter(e => {
        const q = searchTerm.toLowerCase();
        const matchQ = !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.tags.some(t => t.toLowerCase().includes(q));
        const matchC = selectedCat === "الكل" || e.category === selectedCat;
        return matchQ && matchC;
      });

  const handleSearch = async () => {
    if (!searchTerm.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const r = await fetch(`${API_BASE}/knowledge/search?q=${encodeURIComponent(searchTerm)}`);
      if (r.ok) { const d = (await r.json()) as { results: SearchResult[] }; setSearchResults(d.results); }
    } catch { setSearchResults(null); } finally { setSearching(false); }
  };

  const handleAsk = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true); setAiAnswer("");
    try {
      const r = await fetch(`${API_BASE}/knowledge/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: aiQuery }) });
      if (r.ok) { const d = (await r.json()) as { answer: string }; setAiAnswer(d.answer); }
    } catch (e) { setAiAnswer(`خطأ: ${e instanceof Error ? e.message : "فشل الاتصال"}`); } finally { setAiLoading(false); }
  };

  const handleAddEntry = async () => {
    if (!newEntry.title.trim() || !newEntry.content.trim()) return;
    try {
      const r = await fetch(`${API_BASE}/knowledge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newEntry.title, category: newEntry.category, content: newEntry.content, tags: newEntry.tags.split(",").map(t => t.trim()).filter(Boolean) }),
      });
      if (r.ok) { setNewEntry({ title: "", category: "general", content: "", tags: "" }); setShowAdd(false); await loadEntries(); }
    } catch {}
  };

  const handleUploadText = async () => {
    if (!uploadText.trim()) return;
    const lines = uploadText.split("\n").filter(l => l.trim());
    const title = lines[0]?.slice(0, 80) ?? "مستند مرفوع";
    try {
      const r = await fetch(`${API_BASE}/knowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, category: "general", content: uploadText, tags: ["مرفوع"] }) });
      if (r.ok) { setUploadText(""); setShowUpload(false); await loadEntries(); }
    } catch {}
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("حذف هذا المدخل؟")) return;
    try { await fetch(`${API_BASE}/knowledge/${id}`, { method: "DELETE" }); await loadEntries(); } catch {}
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ قاعدة المعرفة" subtitle="RAG ذكي مع بحث دلالي عبر Ollama dolphin-llama3" icon={BookOpen} danger />

      {/* ── AI Ask ── */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: "rgba(170,0,255,0.06)", border: "1px solid rgba(170,0,255,0.2)", borderRadius: 16 }}>
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-4 h-4" style={{ color: "#aa44ff", filter: "drop-shadow(0 0 6px rgba(170,0,255,0.8))" }} />
          <span className="text-sm font-black" style={{ color: "#cc66ff", textShadow: "0 0 10px rgba(170,0,255,0.5)" }}>⚡ اسأل Ollama (RAG ذكي)</span>
        </div>
        <div className="flex gap-2">
          <input value={aiQuery} onChange={e => setAiQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void handleAsk(); }}
            placeholder="اسأل أي سؤال أمني... مثلاً: كيف أكتشف SQL Injection؟"
            style={{ ...inputStyle, flex: 1, padding: "10px 14px" }} />
          <button onClick={handleAsk} disabled={aiLoading || !aiQuery.trim()}
            className="px-4 py-2.5 rounded-xl font-black text-[12px] font-mono transition-all disabled:opacity-50 flex items-center gap-2"
            style={{ background: "rgba(170,0,255,0.18)", border: "1px solid rgba(170,0,255,0.45)", color: "#cc66ff", boxShadow: "0 0 12px rgba(170,0,255,0.12)" }}>
            {aiLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            {aiLoading ? "..." : "اسأل"}
          </button>
        </div>
        {aiAnswer && (
          <div className="rounded-xl p-4" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(170,0,255,0.12)" }}>
            <p className="text-sm whitespace-pre-wrap leading-relaxed font-mono" style={{ color: "rgba(255,255,255,0.75)" }}>{aiAnswer}</p>
          </div>
        )}
      </div>

      {/* ── Search + Controls ── */}
      <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 relative min-w-48">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(255,255,255,0.25)" }} />
            <input value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); if (!e.target.value) setSearchResults(null); }}
              onKeyDown={e => { if (e.key === "Enter") void handleSearch(); }}
              placeholder="بحث دلالي في قاعدة المعرفة..."
              style={{ ...inputStyle, width: "100%", paddingRight: 40, paddingLeft: 14, paddingTop: 10, paddingBottom: 10 }} />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchTerm.trim()}
            className="px-4 py-2 rounded-xl font-black text-[11px] font-mono transition-all disabled:opacity-50 flex items-center gap-1.5"
            style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
            {searching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}بحث
          </button>
          {searchResults && (
            <button onClick={() => { setSearchTerm(""); setSearchResults(null); }}
              className="px-3 py-2 rounded-xl font-mono text-[11px] flex items-center gap-1 transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
              <X className="w-3.5 h-3.5" />مسح
            </button>
          )}
          <button onClick={() => setShowAdd(p => !p)}
            className="px-4 py-2 rounded-xl font-black text-[11px] font-mono transition-all flex items-center gap-1.5"
            style={{ background: "rgba(0,200,100,0.1)", border: "1px solid rgba(0,200,100,0.28)", color: "#44ff88" }}>
            <Plus className="w-3.5 h-3.5" />إضافة
          </button>
          <button onClick={() => setShowUpload(p => !p)}
            className="px-4 py-2 rounded-xl font-black text-[11px] font-mono transition-all flex items-center gap-1.5"
            style={{ background: "rgba(0,100,255,0.1)", border: "1px solid rgba(0,100,255,0.28)", color: "#4488ff" }}>
            <Upload className="w-3.5 h-3.5" />رفع نص
          </button>
          <button onClick={loadEntries} disabled={loading}
            className="px-3 py-2 rounded-xl transition-all"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Category chips */}
        <div className="flex gap-1.5 flex-wrap">
          {categories.map(cat => {
            const color = cat === "الكل" ? "#ff5555" : getCatColor(cat);
            return (
              <button key={cat} onClick={() => { setSelectedCat(cat); setSearchResults(null); }}
                className="px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all"
                style={selectedCat === cat
                  ? { background: `${color}16`, border: `1px solid ${color}40`, color }
                  : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }}>
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Add Entry Form ── */}
      {showAdd && (
        <div className="rounded-2xl p-5 space-y-3" style={{ ...NEON_CARD, border: "1px solid rgba(0,200,100,0.2)" }}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#44ff88" }}>
            <Plus className="w-4 h-4" />إضافة معرفة جديدة
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={newEntry.title} onChange={e => setNewEntry(p => ({ ...p, title: e.target.value }))}
              placeholder="العنوان" style={{ ...inputStyle, width: "100%" }} />
            <input value={newEntry.category} onChange={e => setNewEntry(p => ({ ...p, category: e.target.value }))}
              placeholder="التصنيف (web, tools, tactics...)" style={{ ...inputStyle, width: "100%" }} />
          </div>
          <textarea value={newEntry.content} onChange={e => setNewEntry(p => ({ ...p, content: e.target.value }))}
            placeholder="المحتوى..." rows={4}
            style={{ ...inputStyle, width: "100%", resize: "none" } as React.CSSProperties} />
          <div className="flex gap-3 items-center">
            <input value={newEntry.tags} onChange={e => setNewEntry(p => ({ ...p, tags: e.target.value }))}
              placeholder="وسوم (مفصولة بفاصلة)" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={handleAddEntry}
              className="px-5 py-2 rounded-xl font-black text-[11px] font-mono transition-all"
              style={{ background: "rgba(0,200,100,0.12)", border: "1px solid rgba(0,200,100,0.32)", color: "#44ff88" }}>حفظ</button>
            <button onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded-xl font-mono text-[11px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* ── Upload Text Form ── */}
      {showUpload && (
        <div className="rounded-2xl p-5 space-y-3" style={{ ...NEON_CARD, border: "1px solid rgba(0,100,255,0.2)" }}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#4488ff" }}>
            <Upload className="w-4 h-4" />رفع نص/مستند
          </h3>
          <textarea value={uploadText} onChange={e => setUploadText(e.target.value)}
            placeholder="الصق النص أو محتوى الملف هنا..." rows={6}
            style={{ ...inputStyle, width: "100%", resize: "none", fontFamily: "monospace" } as React.CSSProperties} />
          <div className="flex gap-2">
            <button onClick={handleUploadText}
              className="px-5 py-2 rounded-xl font-black text-[11px] font-mono transition-all"
              style={{ background: "rgba(0,100,255,0.12)", border: "1px solid rgba(0,100,255,0.32)", color: "#4488ff" }}>رفع وحفظ</button>
            <button onClick={() => setShowUpload(false)}
              className="px-3 py-2 rounded-xl font-mono text-[11px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* ── Search Results ── */}
      {searchResults && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4" style={{ color: "#ff5555" }} />
            <span className="text-sm font-black" style={{ color: "rgba(255,255,255,0.7)" }}>
              {searchResults.length} نتيجة بحث دلالي لـ &quot;{searchTerm}&quot;
            </span>
          </div>
          {searchResults.length === 0 ? (
            <div className="text-center py-8 font-mono text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>لا نتائج — جرّب كلمات أخرى</div>
          ) : searchResults.map((r, i) => (
            <div key={i} className="rounded-xl p-4 space-y-2" style={NEON_CARD}>
              <div className="flex items-start justify-between">
                <h3 className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{r.title}</h3>
                <span className="text-[10px] font-black font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
                  {(r.score * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-[11px] font-mono line-clamp-3" style={{ color: "rgba(255,255,255,0.45)" }}>{r.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Regular Entries ── */}
      {!searchResults && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{filtered.length} مدخل</span>
            <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>إجمالي: {entries.length}</span>
          </div>

          {loading ? (
            <div className="text-center py-16" style={{ color: "rgba(255,255,255,0.3)" }}>
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 opacity-40" />
              <p className="font-mono text-sm">جارٍ تحميل قاعدة المعرفة...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(item => {
                const color = getCatColor(item.category);
                const Icon = getCatIcon(item.category);
                const expanded = expandedId === item.id;
                return (
                  <div key={item.id} className="rounded-2xl p-4 transition-all"
                    style={{ background: `${color}06`, border: `1px solid ${color}1e`, borderRadius: 16 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${color}35`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = `${color}1e`; }}>
                    <div className="flex items-start gap-3 mb-3">
                      <div className="p-2 rounded-xl shrink-0" style={{ background: `${color}12`, border: `1px solid ${color}28` }}>
                        <Icon className="w-3.5 h-3.5" style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-black text-sm truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{item.title}</h3>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                          style={{ background: `${color}12`, color }}>{item.category}</span>
                      </div>
                      <button onClick={() => void handleDelete(item.id)}
                        className="shrink-0 p-1 rounded-lg transition-all" style={{ color: "rgba(255,255,255,0.15)" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ff5555"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.15)"; }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <p className={`text-[11px] font-mono mb-3 leading-relaxed ${expanded ? "" : "line-clamp-3"}`}
                      style={{ color: "rgba(255,255,255,0.45)" }}>
                      {item.content}
                    </p>

                    {item.content.length > 150 && (
                      <button onClick={() => setExpandedId(expanded ? null : item.id)}
                        className="text-[10px] font-black flex items-center gap-1 mb-2 transition-all"
                        style={{ color }}>
                        {expanded ? <><ChevronUp className="w-3 h-3" />إخفاء</> : <><ChevronDown className="w-3 h-3" />قراءة المزيد</>}
                      </button>
                    )}

                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {item.tags.map(tag => (
                          <span key={tag} onClick={() => setSearchTerm(tag)}
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded-full cursor-pointer flex items-center gap-0.5 transition-all"
                            style={{ background: `${color}10`, color, border: `1px solid ${color}25` }}>
                            <Tag className="w-2.5 h-2.5" />{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
                      {new Date(item.createdAt).toLocaleDateString("ar-SA")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-16 space-y-3">
              <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.07)" }} />
              <h3 className="text-lg font-black" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد نتائج</h3>
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>
                {entries.length === 0 ? "قاعدة المعرفة فارغة — أضف مدخلات جديدة" : "لم يُعثر على محتوى مطابق"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
