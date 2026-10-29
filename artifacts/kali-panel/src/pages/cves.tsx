import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { jsonRequest } from "@/lib/sse";
import { Search, Filter, Loader2, Database, Skull } from "lucide-react";

const SEV_COLOR: Record<string, string> = { critical: "#ff4444", high: "#ff8844", medium: "#ffaa44", low: "#44ff88", info: "#44eebb" };
const SEV_RGB: Record<string, string> = { critical: "255,68,68", high: "255,136,68", medium: "255,170,68", low: "68,255,136", info: "68,238,187" };
const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

interface CveItem { id: string; cveId?: string; severity?: string; cvss?: number; description?: string; source?: string; publishedAt?: string; }

export default function Cves() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [severity, setSeverity] = useState<string | undefined>(undefined);

  const { data: rawCves, isLoading } = useQuery<CveItem[] | { items?: CveItem[]; cves?: CveItem[]; results?: CveItem[] }>({
    queryKey: ["cves-search", debouncedSearch, severity],
    queryFn: () => {
      const p = new URLSearchParams();
      if (debouncedSearch) p.set("q", debouncedSearch);
      if (severity) p.set("severity", severity);
      p.set("limit", "50");
      return jsonRequest<CveItem[] | { items?: CveItem[]; cves?: CveItem[]; results?: CveItem[] }>(`/cve/db/search?${p}`);
    },
  });
  const cves = Array.isArray(rawCves) ? rawCves : (rawCves?.items ?? rawCves?.cves ?? rawCves?.results ?? []);

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Database className="w-6 h-6" style={{ color: "#ff5555" }} />
        <div>
          <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>بحث الثغرات الأمنية (CVEs)</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>قاعدة بيانات CVE — بحث شامل</p>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Sidebar */}
        <div className="w-56 shrink-0 space-y-4">
          <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
            <form onSubmit={e => { e.preventDefault(); setDebouncedSearch(search); }} className="space-y-2">
              <div className="text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>بحث</div>
              <div className="relative">
                <input placeholder="CVE-2024-..." style={inputStyle} value={search} onChange={e => setSearch(e.target.value)} dir="ltr" />
              </div>
              <button type="submit" className="w-full font-black text-[11px] py-2 rounded-xl transition-all"
                style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
                بحث
              </button>
            </form>
            <div className="space-y-2">
              <div className="text-[9px] font-black font-mono uppercase flex items-center gap-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                <Filter className="w-3 h-3" />مستوى الخطورة
              </div>
              {["critical", "high", "medium", "low"].map(sev => {
                const color = SEV_COLOR[sev] ?? "#888";
                const rgb = SEV_RGB[sev] ?? "136,136,136";
                const active = severity === sev;
                return (
                  <button key={sev} onClick={() => setSeverity(active ? undefined : sev)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all text-right"
                    style={active ? { background: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.35)` } : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center"
                      style={{ background: active ? `rgba(${rgb},0.25)` : "rgba(255,255,255,0.05)", border: `1px solid rgba(${rgb},0.4)` }}>
                      {active && <div className="w-1.5 h-1.5 rounded-sm" style={{ background: color }} />}
                    </div>
                    <span className="font-black font-mono text-[10px] uppercase" style={{ color: active ? color : "rgba(255,255,255,0.4)" }}>{sev}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 rounded-2xl overflow-hidden" style={NEON_CARD}>
          <div className="h-full overflow-y-auto p-4 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#ff5555" }} />
              </div>
            ) : !cves?.length ? (
              <div className="flex flex-col items-center justify-center h-40 space-y-3">
                <Skull className="w-12 h-12" style={{ color: "rgba(255,255,255,0.05)" }} />
                <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا يوجد بيانات بعد — ابحث عن ثغرة</p>
              </div>
            ) : (
              cves.map((cve) => {
                const sev = cve.severity ?? "info";
                const color = SEV_COLOR[sev] ?? "#888";
                const rgb = SEV_RGB[sev] ?? "136,136,136";
                return (
                  <div key={cve.id} className="rounded-xl p-3 transition-all"
                    style={{ background: `rgba(${rgb},0.04)`, border: `1px solid rgba(${rgb},0.14)`, borderRadius: 12 }}>
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 text-center space-y-1 pt-0.5">
                        <div className="text-lg font-black font-mono" style={{ color, textShadow: `0 0 8px rgba(${rgb},0.5)` }}>
                          {cve.cvss?.toFixed(1) ?? "—"}
                        </div>
                        <div className="text-[8px] font-black font-mono px-1.5 py-0.5 rounded"
                          style={{ color, background: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.3)` }}>{sev.toUpperCase()}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-black font-mono text-sm" style={{ color: "#4488ff" }}>{cve.cveId ?? cve.id}</span>
                          {cve.source && <span className="text-[8px] font-mono px-1 py-0.5 rounded" style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)" }}>{cve.source}</span>}
                        </div>
                        <p className="text-[10px] font-mono leading-relaxed line-clamp-2" style={{ color: "rgba(255,255,255,0.5)" }}>{cve.description}</p>
                        {cve.publishedAt && (
                          <div className="text-[9px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>
                            نُشر: {new Date(cve.publishedAt).toLocaleDateString("ar-EG")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
