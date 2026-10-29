import { useState } from "react";
import { Search, Skull, RefreshCw, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface Cve { id: string; description: string; cvss: number; severity: string; publishedAt: string; url: string; }

const SEV_COLOR: Record<string, string> = { CRITICAL: "#ff4444", HIGH: "#ff8844", MEDIUM: "#ffaa44", LOW: "#44ff88" };
const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", width: "100%" };

export default function CveSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Cve[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true); setError(null);
    try {
      const data = await jsonRequest<Cve[]>(`/cve/search?q=${encodeURIComponent(q)}&limit=50`);
      setResults(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Search failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ بحث CVE" subtitle="ابحث عن ثغرات معروفة باستخدام كلمات مفتاحية — NVD Live" icon={Search} danger />

      <form onSubmit={onSearch} className="flex gap-2" style={NEON_CARD}>
        <div className="flex gap-2 w-full p-4">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.2)" }} />
            <input data-testid="input-cve-q" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="مثال: log4j, apache, wordpress..."
              style={{ ...inputStyle, paddingRight: 40 }} />
          </div>
          <button type="submit" data-testid="btn-cve-search" disabled={loading}
            className="px-6 rounded-xl font-black text-[12px] font-mono flex items-center gap-2 transition-all disabled:opacity-50"
            style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? "..." : "بحث"}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-xl p-4 font-mono text-sm" style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff6666" }}>
          {error}
        </div>
      )}

      <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
        {results.length === 0 && !loading && !error && (
          <div className="text-center py-16 space-y-3">
            <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
            <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>ابدأ البحث للحصول على نتائج</div>
          </div>
        )}
        <div data-testid="cve-search-results">
          {results.map((c, i) => {
            const color = SEV_COLOR[c.severity] ?? "#888";
            return (
              <div key={c.id} className="p-4 transition-all"
                style={{ borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                  <a href={c.url} target="_blank" rel="noreferrer"
                    className="font-black font-mono text-sm hover:underline" style={{ color: "#ff5555" }}>
                    {c.id}
                  </a>
                  <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded"
                    style={{ color, background: `${color}14`, border: `1px solid ${color}30` }}>
                    {c.severity} · {c.cvss?.toFixed(1) ?? "—"}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                    {new Date(c.publishedAt).toLocaleDateString("ar-EG")}
                  </span>
                  <a href={c.url} target="_blank" rel="noreferrer" className="ms-auto transition-all" style={{ color: "rgba(255,255,255,0.2)" }}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <p className="text-[11px] font-mono leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{c.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
