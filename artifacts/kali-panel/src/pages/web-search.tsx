import { useState } from "react";
import { Globe, Send, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { jsonRequest } from "@/lib/sse";

interface WebResult { status: number; contentType: string; bytes: number; title: string; text: string; headers: Record<string, string>; }

const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

export default function WebSearchPage() {
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [tab, setTab] = useState<"content" | "headers">("content");

  const { data, isLoading, error } = useQuery<WebResult>({
    queryKey: ["webfetch", submitted],
    queryFn: () => jsonRequest<WebResult>(`/tools/webfetch?url=${encodeURIComponent(submitted)}`),
    enabled: !!submitted,
  });

  const statusColor = (s: number) => s < 300 ? "#44ff88" : s < 400 ? "#ffaa44" : "#ff4444";

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "rgba(68,136,255,0.1)", border: "1px solid rgba(68,136,255,0.3)" }}>
          <Globe className="w-5 h-5" style={{ color: "#4488ff" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#4488ff", textShadow: "0 0 16px rgba(68,136,255,0.4)" }}>Web Fetch / Recon</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>جلب أي URL خارجي وعرض محتواه وعناوينه (HTML / JSON / النصوص)</p>
        </div>
      </div>

      <form onSubmit={e => { e.preventDefault(); setSubmitted(url.trim()); }} className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" dir="ltr" style={inputStyle} />
        <button type="submit" disabled={isLoading || !url.trim()}
          className="flex items-center gap-2 px-5 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50"
          style={{ background: "rgba(68,136,255,0.12)", border: "1px solid rgba(68,136,255,0.35)", color: "#4488ff", whiteSpace: "nowrap" }}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} جلب
        </button>
      </form>

      {error && <div className="rounded-xl p-4 font-mono text-sm" style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.25)", color: "#ff8888" }}>فشل الجلب — تأكد من صحة الـ URL.</div>}

      {data && (
        <div className="rounded-2xl overflow-hidden flex flex-col" style={DARK}>
          <div className="px-4 py-3 flex flex-wrap items-center gap-2" style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="font-black text-xs font-mono px-2 py-1 rounded-lg"
              style={{ color: statusColor(data.status), background: `${statusColor(data.status)}12`, border: `1px solid ${statusColor(data.status)}35` }}>
              HTTP {data.status}
            </span>
            <span className="font-mono text-[10px] px-2 py-1 rounded-lg" style={{ color: "#aa44ff", background: "rgba(170,68,255,0.08)", border: "1px solid rgba(170,68,255,0.2)" }}>{data.contentType}</span>
            <span className="font-mono text-[10px] px-2 py-1 rounded-lg" style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>{((data.bytes ?? 0) / 1024).toFixed(1)} KB</span>
            {data.title && <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{data.title}</span>}
          </div>

          <div className="flex" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            {(["content", "headers"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="px-5 py-2.5 font-black text-[10px] font-mono uppercase transition-all"
                style={{ color: tab === t ? "#4488ff" : "rgba(255,255,255,0.25)", borderBottom: tab === t ? "2px solid #4488ff" : "2px solid transparent", background: "transparent" }}>
                {t === "content" ? "المحتوى" : "الترويسات"}
              </button>
            ))}
          </div>

          {tab === "content" && (
            <div className="overflow-auto" style={{ maxHeight: 400 }}>
              <pre className="text-[10px] whitespace-pre-wrap font-mono p-4" style={{ color: "rgba(68,255,136,0.8)" }}>{data.text}</pre>
            </div>
          )}
          {tab === "headers" && (
            <div className="p-4 space-y-1 overflow-auto" style={{ maxHeight: 400 }}>
              {Object.entries(data.headers ?? {}).map(([k, v]) => (
                <div key={k} className="flex gap-3 text-[10px] font-mono">
                  <span className="shrink-0 min-w-40" style={{ color: "#4488ff" }}>{k}:</span>
                  <span className="break-all" style={{ color: "rgba(255,255,255,0.5)" }}>{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
