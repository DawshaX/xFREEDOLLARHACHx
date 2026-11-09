import { useState } from "react";
import { Loader2, Search, ShieldCheck, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import { jsonRequest } from "@/lib/sse";
import { emitPlatformWsEvent } from "@/hooks/useWebSocket";

const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

const EXPECTED: { key: string; label: string; why: string }[] = [
  { key: "content-security-policy", label: "Content-Security-Policy", why: "يمنع حقن السكربتات (XSS)" },
  { key: "x-frame-options", label: "X-Frame-Options", why: "يمنع التأطير (Clickjacking)" },
  { key: "x-content-type-options", label: "X-Content-Type-Options", why: "يمنع تخمين نوع المحتوى (MIME sniffing)" },
  { key: "strict-transport-security", label: "Strict-Transport-Security", why: "يفرض HTTPS (HSTS)" },
  { key: "referrer-policy", label: "Referrer-Policy", why: "يتحكم في تسريب الـ Referrer" },
  { key: "permissions-policy", label: "Permissions-Policy", why: "يقيّد صلاحيات المتصفح (كاميرا/موقع)" },
];

type HeadersData = {
  domain: string;
  measured?: boolean;
  status?: number;
  headers?: Record<string, string | string[] | undefined>;
  missing?: string[];
  present?: string[];
  score?: string;
  error?: string;
  saysAr?: string;
};

export default function HeadersTool() {
  const [domainInput, setDomainInput] = useState(() => {
    try {
      return localStorage.getItem("cybernova_active_target") || "";
    } catch {
      return "";
    }
  });
  const [data, setData] = useState<HeadersData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await jsonRequest<HeadersData>(`/tools/headers?domain=${encodeURIComponent(domainInput.trim())}`);
      setData(res);
      emitPlatformWsEvent({
        type: "recon_cmd_executed",
        title: `Header Analyzer: ${domainInput.trim()} (${res?.score ?? "غير مقاس"})`,
        target: domainInput.trim(),
      });
    } catch (e) {
      // قبل كده كان الفشل بيتملّى بتقرير ثابت. دلوقتي الفشل بيبان فشل.
      setData(null);
      setError(e instanceof Error ? e.message : "الفحص فشل");
    } finally {
      setIsLoading(false);
    }
  };

  const presentSet = new Set((data?.present ?? []).map((h) => h.toLowerCase()));

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(68,136,255,0.1)", border: "1px solid rgba(68,136,255,0.3)" }}>
          <ShieldCheck className="w-5 h-5" style={{ color: "#4488ff" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#4488ff", textShadow: "0 0 16px rgba(68,136,255,0.4)" }}>تحليل ترويسات HTTP</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>فحص حقيقي لترويسات الأمان على الهدف (HEAD request)</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input placeholder="example.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} dir="ltr" style={inputStyle} />
        <button type="submit" disabled={isLoading || !domainInput}
          className="flex items-center gap-2 px-5 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50"
          style={{ background: "rgba(68,136,255,0.1)", border: "1px solid rgba(68,136,255,0.3)", color: "#4488ff", whiteSpace: "nowrap" }}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} فحص
        </button>
      </form>

      {error && <div className="rounded-xl p-4 font-mono text-sm" style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff8888" }}>الفحص ما اتعملش: {error}</div>}

      {data && data.measured === false && (
        <div className="rounded-xl p-4 space-y-1 font-mono text-[11px]" style={{ background: "rgba(255,170,68,0.07)", border: "1px solid rgba(255,170,68,0.25)", color: "#ffaa44" }}>
          <div>مفيش ترويسات مقاسة</div>
          {data.saysAr && <div style={{ color: "rgba(255,255,255,0.5)" }}>{data.saysAr}</div>}
          {data.error && <div style={{ color: "rgba(255,255,255,0.35)" }}>{data.error}</div>}
        </div>
      )}

      {data && data.measured !== false && (
        <>
          <div className="rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3" style={DARK}>
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5" style={{ color: "#ffaa44" }} />
              <span className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>{data.domain}</span>
              {data.status && <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.25)", color: "#44ff88" }}>HTTP {data.status}</span>}
            </div>
            <span className="font-black font-mono text-lg" style={{ color: (data.present?.length ?? 0) >= 4 ? "#44ff88" : (data.present?.length ?? 0) >= 2 ? "#ffaa44" : "#ff4444" }}>{data.score ?? "—"}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {EXPECTED.map(({ key, label, why }) => {
              const ok = presentSet.has(key);
              return (
                <div key={key} className="rounded-xl p-4 flex items-start gap-3" style={{ background: ok ? "rgba(68,255,136,0.05)" : "rgba(255,68,68,0.05)", border: `1px solid ${ok ? "rgba(68,255,136,0.2)" : "rgba(255,68,68,0.2)"}` }}>
                  {ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#44ff88" }} /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#ff4444" }} />}
                  <div className="space-y-1 min-w-0">
                    <div className="font-mono text-xs font-black" style={{ color: ok ? "#44ff88" : "#ff8888" }}>{label}</div>
                    <div className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>{why}</div>
                    {ok && data.headers?.[key] && (
                      <div className="font-mono text-[10px] break-all" style={{ color: "rgba(255,255,255,0.55)" }} dir="ltr">{String(data.headers[key])}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
