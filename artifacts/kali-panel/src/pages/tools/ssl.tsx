import { useState } from "react";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { jsonRequest } from "@/lib/sse";
import { emitPlatformWsEvent } from "@/hooks/useWebSocket";

const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

function gradeColor(g: string | null): { color: string; rgb: string } {
  if (!g) return { color: "#555", rgb: "85,85,85" };
  if (g.startsWith("A")) return { color: "#44ff88", rgb: "68,255,136" };
  if (g.startsWith("B")) return { color: "#4488ff", rgb: "68,136,255" };
  if (g.startsWith("C")) return { color: "#ffaa44", rgb: "255,170,68" };
  return { color: "#ff4444", rgb: "255,68,68" };
}

export default function SslTool() {
  const [domainInput, setDomainInput] = useState(() => {
    try {
      return localStorage.getItem("cybernova_active_target") || "";
    } catch {
      return "";
    }
  });
  const [data, setData] = useState<{ domain: string; grade: string | null; issuer: string | null; protocol: string | null; cipher: string | null; validFrom: string | null; validTo: string | null; connected?: boolean; error?: string | null; reasonAr?: string; howAr?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setIsLoading(true); setError(null);
    try {
      const res = await jsonRequest<typeof data>(`/proxy/ssl?domain=${encodeURIComponent(domainInput.trim())}`);
      setData(res);
      emitPlatformWsEvent({
        type: "recon_cmd_executed",
        title: `SSL/TLS Check: ${domainInput.trim()} (${res?.grade ?? (res?.connected ? "مقاس" : "مفيش مصدر")})`,
        target: domainInput.trim(),
      });
    } catch (e) {
      // الأول كان أي فشل في الطلب بيتمّلاه شهادة A+ ملفّقة. بقى خطأ مبيّن.
      setData(null);
      setError(e instanceof Error ? e.message : "الفحص فشل");
    } finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.3)" }}>
          <ShieldCheck className="w-5 h-5" style={{ color: "#44ff88" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#44ff88", textShadow: "0 0 16px rgba(68,255,136,0.4)" }}>فحص SSL/TLS</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>التحقق من صحة وقوة شهادة الأمان</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input placeholder="example.com" value={domainInput} onChange={e => setDomainInput(e.target.value)} dir="ltr" style={inputStyle} />
        <button type="submit" disabled={isLoading || !domainInput}
          className="flex items-center gap-2 px-5 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50"
          style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.3)", color: "#44ff88", whiteSpace: "nowrap" }}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} فحص
        </button>
      </form>

      {error && <div className="rounded-xl p-4 font-mono text-sm" style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff8888" }}>الفحص ما اتعملش: {error}</div>}
      {data?.connected === false && (data.reasonAr || data.error) && (
        <div className="rounded-xl p-4 space-y-1 font-mono text-[11px]" style={{ background: "rgba(255,170,68,0.07)", border: "1px solid rgba(255,170,68,0.25)", color: "#ffaa44" }}>
          <div>{data.error && data.error !== "no_execution_plane" ? data.error : "مفيش مصدر قياس للشهادة دي"}</div>
          {data.reasonAr && <div style={{ color: "rgba(255,255,255,0.5)" }}>{data.reasonAr}</div>}
          {data.howAr && <div style={{ color: "rgba(255,255,255,0.35)" }}>{data.howAr}</div>}
        </div>
      )}

      {data && (() => {
        const { color, rgb } = gradeColor(data.grade);
        const nz = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : "غير مقاس");
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl p-8 flex flex-col items-center justify-center space-y-3" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.25)`, borderRadius: 20 }}>
              <div className="w-28 h-28 rounded-full flex items-center justify-center" style={{ border: `4px solid ${color}`, boxShadow: `0 0 30px rgba(${rgb},0.3)` }}>
                <span className="font-black text-4xl font-mono" style={{ color }}>{data.grade ?? "—"}</span>
              </div>
              <span className="font-black font-mono text-base" style={{ color: "rgba(255,255,255,0.7)" }}>{data.domain}</span>
              {data.grade === null && (
                <span className="font-mono text-[10px] text-center" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {data.connected === false ? "الاتصال ما كملش — مفيش شهادة مقاسة" : "مفيش تقييم مُحسب (التقييم محتاج SSLLabs)"}
                </span>
              )}
            </div>

            <div className="md:col-span-2 rounded-2xl p-5 space-y-4" style={DARK}>
              {[
                { label: "المُصدِر (Issuer)", value: nz(data.issuer) },
                { label: "البروتوكول", value: nz(data.protocol) },
                { label: "خوارزمية التشفير (Cipher)", value: nz(data.cipher), highlight: true },
              ].map(({ label, value, highlight }) => (
                <div key={label} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: 12 }}>
                  <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
                  <div className="font-mono text-sm" style={{ color: highlight ? "#44eebb" : "rgba(255,255,255,0.65)" }}>{value}</div>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "تاريخ الإصدار", value: data.validFrom ? new Date(data.validFrom).toLocaleDateString("ar-EG") : "غير مقاس" },
                  { label: "تاريخ الانتهاء", value: data.validTo ? new Date(data.validTo).toLocaleDateString("ar-EG") : "غير مقاس" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
                    <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
