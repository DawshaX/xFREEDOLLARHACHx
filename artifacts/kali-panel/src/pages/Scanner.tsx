import { useState } from "react";
import { ScanLine, ShieldCheck, X, Check, AlertTriangle, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface ScanResult {
  url: string; status: number; responseTimeMs: number; server: string;
  contentType: string; title: string;
  headers: Array<{ name: string; value: string }>;
  securityHeaders: Array<{ name: string; present: boolean; value: string; recommendation: string }>;
  score: number; risks: string[];
}

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", width: "100%" };

function scoreColor(s: number) {
  if (s >= 80) return "#44ff88";
  if (s >= 50) return "#ffaa44";
  return "#ff4444";
}

export default function Scanner() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await jsonRequest<ScanResult>("/scanner/url", { method: "POST", body: JSON.stringify({ url }) });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ فاحص المواقع" subtitle="فحص أمني سريع لرؤوس HTTP والثغرات الشائعة" icon={ScanLine} danger />

      <form onSubmit={onScan} className="flex gap-3 rounded-2xl p-4" style={NEON_CARD}>
        <input data-testid="input-scan-url" value={url} onChange={e => setUrl(e.target.value)}
          placeholder="example.com أو https://example.com" dir="ltr"
          style={{ ...inputStyle, flex: 1 }} />
        <button type="submit" data-testid="btn-scan" disabled={loading}
          className="px-6 rounded-xl font-black text-sm font-mono transition-all disabled:opacity-50"
          style={{ background: loading ? "rgba(255,30,30,0.06)" : "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", whiteSpace: "nowrap" }}>
          {loading ? "⠶ جارِ الفحص..." : "▶ ابدأ الفحص"}
        </button>
      </form>

      {error && (
        <div className="rounded-2xl p-4 font-mono text-sm" style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff8888" }}>
          ⚠ {error}
        </div>
      )}

      {!result && !loading && (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-14 h-14 mx-auto" style={{ color: "rgba(255,255,255,0.04)" }} />
          <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.15)" }}>أدخل عنوان الموقع لبدء الفحص الأمني</div>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl p-12 text-center space-y-4" style={NEON_CARD}>
          <div className="w-14 h-14 rounded-full mx-auto animate-spin" style={{ border: "3px solid rgba(255,30,30,0.08)", borderTopColor: "#ff5555" }} />
          <div className="font-black font-mono text-sm animate-pulse" style={{ color: "#ff5555" }}>جارِ الفحص الأمني...</div>
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="scan-result">
          {/* Score panel */}
          <div className="lg:col-span-1 rounded-2xl p-5 space-y-4" style={NEON_CARD}>
            <div className="text-center">
              <div className="text-[9px] font-black font-mono uppercase mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>نقاط الأمان</div>
              <div className="text-7xl font-black font-mono leading-none" style={{ color: scoreColor(result.score), textShadow: `0 0 24px ${scoreColor(result.score)}55` }}>
                {result.score}
              </div>
              <div className="text-sm font-mono mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>/ 100</div>
              <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${result.score}%`, background: scoreColor(result.score), boxShadow: `0 0 8px ${scoreColor(result.score)}` }} />
              </div>
            </div>
            <div className="space-y-2 text-[11px] font-mono">
              {[
                { label: "الحالة", value: result.status, color: result.status < 400 ? "#44ff88" : "#ff4444" },
                { label: "زمن الاستجابة", value: `${result.responseTimeMs} ms`, color: result.responseTimeMs < 500 ? "#44ff88" : "#ffaa44" },
                { label: "الخادم", value: result.server || "—", color: "rgba(255,255,255,0.7)" },
                { label: "نوع المحتوى", value: result.contentType.split(";")[0], color: "rgba(255,255,255,0.7)" },
                ...(result.title ? [{ label: "العنوان", value: result.title, color: "rgba(255,255,255,0.7)" }] : []),
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{label}</span>
                  <span className="truncate max-w-[55%]" dir="ltr" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {/* Security Headers */}
            <div className="rounded-2xl p-5 space-y-3" style={NEON_CARD}>
              <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#44eebb" }}>
                <ShieldCheck className="w-5 h-5" />رؤوس الأمان
              </h3>
              <div className="space-y-2">
                {result.securityHeaders.map((h) => (
                  <div key={h.name} className="flex items-start gap-3 p-2.5 rounded-xl" style={DARK}>
                    {h.present
                      ? <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#44ff88" }} />
                      : <X className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#ff4444" }} />}
                    <div className="flex-1 min-w-0">
                      <div className="font-black font-mono text-[11px]" style={{ color: h.present ? "#44ff88" : "#ff8888" }}>{h.name}</div>
                      {h.present ? (
                        <div className="text-[10px] font-mono truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{h.value}</div>
                      ) : (
                        <div className="text-[10px] font-mono" style={{ color: "#ffaa44" }}>{h.recommendation}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Risks */}
            {result.risks.length > 0 && (
              <div className="rounded-2xl p-5 space-y-3" style={{ background: "rgba(255,100,0,0.05)", border: "1px solid rgba(255,100,0,0.22)", borderRadius: 16 }}>
                <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ffaa44" }}>
                  <AlertTriangle className="w-5 h-5" />المخاطر المكتشفة
                </h3>
                <ul className="space-y-1.5">
                  {result.risks.map((r) => (
                    <li key={r} className="flex items-start gap-2 font-mono text-[11px]" style={{ color: "#ffcc77" }}>
                      <span style={{ color: "#ffaa44" }}>◆</span>{r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
