/**
 * RagPanel — نظام الذاكرة التراكمية المتقدم (RAG).
 * رفع الكتب والأكواد والوثائق — يستدعيها الوكيل عند الحاجة.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { BookOpen, Upload, Search, Trash2, FileText, RefreshCw, Database, Brain, ChevronRight, Plus, AlertCircle } from "lucide-react";

const BASE = "/api";

interface RagFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  summary: string;
  content: string;
  createdAt: string;
}

export function RagPanel() {
  const [files, setFiles] = useState<RagFile[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<RagFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<"files" | "search" | "add">("files");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [selected, setSelected] = useState<RagFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/rag`);
      if (res.ok) setFiles(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const searchRag = async () => {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/rag/search?q=${encodeURIComponent(search)}`);
      if (res.ok) setResults(await res.json());
    } catch {}
    setLoading(false);
  };

  const addText = async () => {
    if (!textTitle.trim() || !textContent.trim()) return;
    setAddLoading(true);
    try {
      await fetch(`${BASE}/rag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: textTitle, content: textContent, mimeType: "text/plain" }),
      });
      setTextTitle(""); setTextContent("");
      setTab("files");
      await loadFiles();
    } catch {}
    setAddLoading(false);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const text = await file.text();
      await fetch(`${BASE}/rag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, content: text, mimeType: file.type || "text/plain", size: file.size }),
      });
      await loadFiles();
    } catch {}
    setUploading(false);
  };

  const deleteFile = async (id: string) => {
    try {
      await fetch(`${BASE}/rag/${id}`, { method: "DELETE" });
      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch {}
  };

  const fmtSize = (s: number) => s > 1024 ? `${(s / 1024).toFixed(1)}KB` : `${s}B`;

  return (
    <div className="flex flex-col h-full bg-black/90 text-white" dir="rtl" style={{ fontFamily: "monospace" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-teal-500/20 bg-black/60">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-teal-400" />
          <div className="flex-1">
            <div className="text-sm font-bold text-teal-200">RAG — الذاكرة التراكمية</div>
            <div className="text-[10px] text-teal-500/60">{files.length} ملف في قاعدة المعرفة</div>
          </div>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 bg-teal-500/10 border border-teal-500/20 rounded text-teal-300 text-[10px] hover:bg-teal-500/20">
            {uploading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            رفع
          </button>
          <input ref={fileInputRef} type="file" className="hidden" accept=".txt,.md,.pdf,.py,.js,.ts,.json,.yaml,.csv"
            onChange={(e) => e.target.files?.[0] && void uploadFile(e.target.files[0])} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-teal-500/10">
        {(["files", "search", "add"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[11px] font-medium transition-all ${tab === t ? "text-teal-300 border-b-2 border-teal-500" : "text-slate-500 hover:text-slate-300"}`}>
            {t === "files" ? `الملفات (${files.length})` : t === "search" ? "البحث" : "إضافة نص"}
          </button>
        ))}
      </div>

      {/* FILES TAB */}
      {tab === "files" && (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-2/5 border-l border-white/5 overflow-auto p-2 space-y-1">
            {files.length === 0 && !loading && (
              <div className="text-center text-slate-600 text-xs py-8">
                <Database className="w-8 h-8 mx-auto opacity-20 mb-2" />
                لا توجد ملفات
              </div>
            )}
            {files.map((f) => (
              <div key={f.id} onClick={() => setSelected(f)}
                className={`flex items-start gap-1.5 p-2 rounded-lg cursor-pointer transition-all ${selected?.id === f.id ? "bg-teal-500/10 border border-teal-500/20" : "hover:bg-white/3 border border-transparent"}`}>
                <FileText className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-white truncate">{f.name}</div>
                  <div className="text-[9px] text-slate-600">{fmtSize(f.content.length)}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); void deleteFile(f.id); }} className="text-red-500/30 hover:text-red-400 p-0.5 opacity-0 group-hover:opacity-100">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-3">
            {selected ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-white">{selected.name}</span>
                  <button onClick={() => void deleteFile(selected.id)} className="text-red-400/60 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {selected.summary && (
                  <div className="text-[10px] text-teal-300 bg-teal-500/5 border border-teal-500/15 rounded p-2 mb-3">
                    <Brain className="w-3 h-3 inline mr-1" /> {selected.summary}
                  </div>
                )}
                <pre className="text-[10px] text-slate-400 whitespace-pre-wrap leading-relaxed bg-black/30 rounded p-2 max-h-64 overflow-auto">
                  {selected.content.slice(0, 2000)}{selected.content.length > 2000 ? "\n…" : ""}
                </pre>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
                <ChevronRight className="w-6 h-6 opacity-30" />
                <span className="text-xs">اختر ملفاً لعرضه</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEARCH TAB */}
      {tab === "search" && (
        <div className="flex-1 overflow-auto p-3">
          <div className="flex gap-2 mb-3">
            <div className="flex items-center gap-1.5 flex-1 bg-black/40 border border-teal-500/20 rounded px-2">
              <Search className="w-3 h-3 text-slate-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void searchRag()}
                placeholder="ابحث في قاعدة المعرفة…"
                className="flex-1 bg-transparent text-xs text-white outline-none py-1.5" />
            </div>
            <button onClick={() => void searchRag()} disabled={loading}
              className="px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-300 rounded text-xs hover:bg-teal-500/30 disabled:opacity-40">
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : "بحث"}
            </button>
          </div>
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.id} className="p-2.5 rounded-lg bg-teal-500/5 border border-teal-500/15">
                <div className="text-[11px] font-bold text-teal-300 mb-1">{r.name}</div>
                <div className="text-[10px] text-slate-400 leading-relaxed">{r.content.slice(0, 200)}…</div>
              </div>
            ))}
            {results.length === 0 && search && !loading && (
              <div className="text-center text-slate-600 text-xs py-6">لا نتائج</div>
            )}
          </div>
        </div>
      )}

      {/* ADD TEXT TAB */}
      {tab === "add" && (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          <div className="text-[10px] text-teal-400 flex items-center gap-1 mb-2">
            <Brain className="w-3 h-3" /> أضف محتوى نصياً لقاعدة معرفة Nova
          </div>
          <input value={textTitle} onChange={(e) => setTextTitle(e.target.value)}
            placeholder="عنوان المستند (مثلاً: دليل أمن الشبكات)"
            className="w-full bg-black/40 border border-teal-500/20 rounded px-3 py-2 text-xs text-white outline-none focus:border-teal-500/50" />
          <textarea value={textContent} onChange={(e) => setTextContent(e.target.value)}
            placeholder="المحتوى: أكواد، كتب، وثائق، ملاحظات…" rows={8}
            className="w-full bg-black/40 border border-teal-500/20 rounded px-3 py-2 text-xs text-white outline-none focus:border-teal-500/50 resize-none" />
          <div className="flex gap-2">
            <button onClick={() => void addText()} disabled={addLoading || !textTitle.trim() || !textContent.trim()}
              className="flex-1 py-2 bg-teal-500/20 border border-teal-500/30 text-teal-300 rounded text-xs hover:bg-teal-500/30 disabled:opacity-40 flex items-center justify-center gap-1">
              {addLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              إضافة للذاكرة
            </button>
            <button onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 bg-white/5 border border-white/10 text-slate-400 rounded text-xs hover:bg-white/10 flex items-center gap-1">
              <Upload className="w-3 h-3" /> ملف
            </button>
          </div>
          <div className="text-[9px] text-slate-600">
            تنسيقات مدعومة: .txt .md .py .js .ts .json .yaml .csv
          </div>
        </div>
      )}
    </div>
  );
}
