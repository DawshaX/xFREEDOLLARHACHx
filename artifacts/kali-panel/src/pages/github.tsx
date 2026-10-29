import { useState } from "react";
import { Search, Github, Star, GitFork, ExternalLink, Skull } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { jsonRequest } from "@/lib/sse";

interface GithubRepo { id: string; name: string; fullName: string; description: string; url: string; stars: number; forks: number; language: string; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };
const LANG_COLORS: Record<string, string> = { Go: "#00ADD8", Python: "#3776AB", C: "#A8B9CC", "C++": "#00599C", Ruby: "#CC342D", Rust: "#DEA584", Shell: "#89e051", JavaScript: "#F7DF1E", TypeScript: "#3178c6" };

export default function GithubSearchPage() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [kind, setKind] = useState<"repo" | "code">("repo");

  const { data, isLoading, error } = useQuery<GithubRepo[]>({
    queryKey: ["github", kind, submitted],
    queryFn: () => jsonRequest<GithubRepo[]>(`/search/github?q=${encodeURIComponent(submitted)}&kind=${kind}`),
    enabled: !!submitted,
  });

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Github className="w-6 h-6" style={{ color: "#ff5555" }} />
        <div>
          <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>GitHub Search</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>ابحث في GitHub عن مستودعات أو كود (PoCs / أدوات)</p>
        </div>
      </div>

      {/* Search Form */}
      <form onSubmit={e => { e.preventDefault(); setSubmitted(q.trim()); }}
        className="flex gap-3 items-center rounded-2xl p-4" style={NEON_CARD}>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="مثال: log4shell poc, sqlmap, nuclei templates..." dir="rtl"
          style={inputStyle} />
        <select value={kind} onChange={e => setKind(e.target.value as "repo" | "code")}
          className="focus:outline-none"
          style={{ ...inputStyle, flex: "none", width: "auto", padding: "10px 10px" }}>
          <option value="repo">مستودعات</option>
          <option value="code">كود</option>
        </select>
        <button type="submit"
          className="px-5 rounded-xl font-black text-sm font-mono transition-all"
          style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", whiteSpace: "nowrap" }}>
          ▶ بحث
        </button>
      </form>

      {/* Status */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <div className="font-mono text-sm animate-pulse" style={{ color: "#ff5555" }}>جاري البحث...</div>
        </div>
      )}
      {error && (
        <div className="rounded-xl p-4 font-mono text-sm" style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff8888" }}>
          ⚠ تعذر الاتصال بـ GitHub
        </div>
      )}
      {!isLoading && submitted && !data?.length && !error && (
        <div className="rounded-2xl p-10 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد نتائج</div>
        </div>
      )}

      {/* Results */}
      <div className="space-y-2">
        {(data ?? []).map(r => {
          const langColor = LANG_COLORS[r.language] ?? "#888";
          return (
            <div key={r.id} className="rounded-xl p-4 transition-all"
              style={{ background: "rgba(8,0,18,0.9)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14 }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-black text-sm truncate mb-1" style={{ color: "#4488ff" }}>{r.fullName || r.name}</div>
                  <div className="text-[10px] font-mono line-clamp-2 mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>{r.description || "بدون وصف"}</div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1 text-[10px] font-black" style={{ color: "#ffaa44" }}>
                      <Star className="w-3 h-3" />{r.stars.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-black" style={{ color: "rgba(255,255,255,0.3)" }}>
                      <GitFork className="w-3 h-3" />{r.forks.toLocaleString()}
                    </span>
                    {r.language && (
                      <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                        style={{ color: langColor, background: `${langColor}14`, border: `1px solid ${langColor}30` }}>{r.language}</span>
                    )}
                  </div>
                </div>
                <a href={r.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-[10px] transition-all shrink-0"
                  style={{ background: "rgba(68,136,255,0.1)", border: "1px solid rgba(68,136,255,0.25)", color: "#4488ff" }}>
                  <ExternalLink className="w-3 h-3" />فتح
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
