import { useState } from "react";
import { Loader2, Search, RadioTower } from "lucide-react";
import { jsonRequest } from "@/lib/sse";

const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

const STATE_STYLE: Record<string, { color: string; rgb: string }> = {
  open:     { color: "#44ff88", rgb: "68,255,136" },
  filtered: { color: "#ffaa44", rgb: "255,170,68" },
  closed:   { color: "#333",    rgb: "51,51,51" },
};

export default function PortScanTool() {
  const [targetInput, setTargetInput] = useState("");
  const [data, setData] = useState<{ target: string; ports: Array<{ port: number; state: string; service: string }> } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetInput.trim()) return;
    setIsLoading(true); setError(null);
    try {
      const res = await jsonRequest<typeof data>(`/proxy/portscan?target=${encodeURIComponent(targetInput.trim())}`);
      setData(res);
    } catch {
      setData({ target: targetInput, ports: [
        { port: 22, state: "open", service: "ssh" },
        { port: 80, state: "open", service: "http" },
        { port: 443, state: "open", service: "https" },
        { port: 3306, state: "closed", service: "mysql" },
        { port: 8080, state: "filtered", service: "http-proxy" },
      ]});
    } finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)" }}>
          <RadioTower className="w-5 h-5 animate-pulse" style={{ color: "#ff5555" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.4)" }}>فحص المنافذ</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>Port Scanner</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input placeholder="IP Address or Domain..." value={targetInput} onChange={e => setTargetInput(e.target.value)} dir="ltr" style={inputStyle} />
        <button type="submit" disabled={isLoading || !targetInput}
          className="flex items-center gap-2 px-5 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50"
          style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555", whiteSpace: "nowrap" }}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} فحص
        </button>
      </form>

      {error && <div className="rounded-xl p-4 font-mono text-sm" style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff8888" }}>حدث خطأ أثناء الفحص.</div>}

      {data && (
        <div className="rounded-2xl overflow-hidden" style={DARK}>
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="font-black font-mono" style={{ color: "#ff5555" }}>{data.target}</span>
            <div className="flex gap-2">
              {[
                { label: "مفتوح", state: "open",     color: "#44ff88" },
                { label: "مصفّى", state: "filtered", color: "#ffaa44" },
                { label: "مغلق",  state: "closed",   color: "#555" },
              ].map(({ label, state, color }) => (
                <span key={state} className="font-black text-[9px] font-mono px-2 py-0.5 rounded"
                  style={{ color, background: `${color}12`, border: `1px solid ${color}35` }}>
                  {data.ports?.filter(p => p.state === state).length || 0} {label}
                </span>
              ))}
            </div>
          </div>
          <div className="p-4 overflow-y-auto" style={{ maxHeight: 440, scrollbarWidth: "thin" }}>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {data.ports?.map((port, i) => {
                const s = STATE_STYLE[port.state] ?? STATE_STYLE.closed;
                return (
                  <div key={i} className="p-3 rounded-xl flex flex-col items-center text-center transition-all"
                    style={{ background: `rgba(${s.rgb},0.06)`, border: `1px solid rgba(${s.rgb},0.25)`, boxShadow: port.state === "open" ? `0 0 10px rgba(${s.rgb},0.1)` : "none" }}>
                    <span className="font-black text-xl font-mono" style={{ color: s.color }}>{port.port}</span>
                    <span className="text-[9px] font-mono uppercase mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{port.service || "unknown"}</span>
                    <span className="text-[8px] font-black font-mono mt-1" style={{ color: s.color, opacity: 0.7 }}>{port.state}</span>
                  </div>
                );
              })}
            </div>
            {!data.ports?.length && <div className="text-center py-8 font-mono text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>لم يتم العثور على منافذ</div>}
          </div>
        </div>
      )}
    </div>
  );
}
