import { useState } from "react";
import { Upload, FileText, Trash2, Search, Loader2, Skull } from "lucide-react";

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function NovaKnowledge() {
  const [files, setFiles] = useState<Array<{ name: string; size: number; date: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<string[]>([]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData(); formData.append("file", file);
    try {
      const res = await fetch("/api/nova/knowledge/upload", { method: "POST", body: formData });
      if (res.ok) setFiles(f => [...f, { name: file.name, size: file.size, date: new Date().toISOString() }]);
    } catch { } finally { setUploading(false); }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch("/api/nova/knowledge/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch { }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(170,68,255,0.1)", border: "1px solid rgba(170,68,255,0.3)" }}>
          <FileText className="w-6 h-6" style={{ color: "#aa44ff" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#aa44ff", textShadow: "0 0 16px rgba(170,68,255,0.5)" }}>Knowledge Base</h1>
          <p className="text-[9px] font-black tracking-widest uppercase font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>Local RAG — قاعدة المعرفة المحلية</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Upload */}
        <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
          <h2 className="font-black text-sm" style={{ color: "#aa44ff" }}>رفع الكتب والملفات</h2>
          <label className="block cursor-pointer">
            <input type="file" accept=".pdf,.txt,.md" onChange={handleFileUpload} disabled={uploading} className="hidden" />
            <div className="rounded-xl p-8 text-center transition-all" style={{ border: `2px dashed ${uploading ? "rgba(170,68,255,0.5)" : "rgba(255,255,255,0.08)"}`, background: "rgba(170,68,255,0.03)" }}>
              {uploading ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" style={{ color: "#aa44ff" }} />
                  <p className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>جارٍ الرفع...</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: "rgba(255,255,255,0.2)" }} />
                  <p className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>اسحب الملف أو انقر للاختيار</p>
                  <p className="text-[10px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>PDF, TXT, Markdown</p>
                </>
              )}
            </div>
          </label>
          <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>ارفع كتباً تقنية ووثائق أمنية. سيتعلم منها Nova تلقائياً.</p>
        </div>

        {/* Search */}
        <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
          <h2 className="font-black text-sm" style={{ color: "#44ff88" }}>البحث في المعرفة</h2>
          <div className="flex gap-2">
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="ابحث في كتبك..." style={inputStyle} />
            <button onClick={handleSearch}
              className="p-2 rounded-xl transition-all"
              style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.3)", color: "#44ff88" }}>
              <Search className="w-4 h-4" />
            </button>
          </div>
          <div className="rounded-xl p-3 space-y-2 overflow-y-auto max-h-60" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.04)", scrollbarWidth: "thin" }}>
            {searchResults.length === 0 ? (
              <p className="text-[10px] font-mono text-center py-4" style={{ color: "rgba(255,255,255,0.2)" }}>لا نتائج بعد...</p>
            ) : searchResults.map((result, i) => (
              <div key={i} className="text-[10px] font-mono p-2 rounded-lg" style={{ background: "rgba(68,255,136,0.04)", border: "1px solid rgba(68,255,136,0.1)", color: "rgba(255,255,255,0.6)" }}>
                {result}
              </div>
            ))}
          </div>
        </div>

        {/* Files list */}
        <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
          <h2 className="font-black text-sm" style={{ color: "#ffaa44" }}>الملفات المرفوعة</h2>
          <div className="rounded-xl p-3 space-y-2 overflow-y-auto max-h-72" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.04)", scrollbarWidth: "thin" }}>
            {files.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <Skull className="w-8 h-8 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>لا ملفات مرفوعة بعد...</p>
              </div>
            ) : files.map((file, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "rgba(255,170,68,0.04)", border: "1px solid rgba(255,170,68,0.12)" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-black font-mono truncate" style={{ color: "rgba(255,255,255,0.7)" }}>{file.name}</p>
                  <p className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="p-1.5 rounded-lg transition-all ms-2"
                  style={{ color: "rgba(255,68,68,0.5)", background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.15)" }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
