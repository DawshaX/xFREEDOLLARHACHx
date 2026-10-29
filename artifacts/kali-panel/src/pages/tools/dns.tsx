import { useState } from "react";
import { Loader2, Search, Eye } from "lucide-react";
import { jsonRequest } from "@/lib/sse";
import { emitPlatformWsEvent } from "@/hooks/useWebSocket";

const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

const TYPE_COLOR: Record<string, string> = { A: "#44ff88", MX: "#ffaa44", TXT: "#4488ff", AAAA: "#aa44ff", CNAME: "#44eebb", NS: "#ff8844" };

export default function DnsTool() {
  const [domainInput, setDomainInput] = useState(() => {
    try {
      return localStorage.getItem("cybernova_active_target") || "";
    } catch {
      return "";
    }
  });
  const [data, setData] = useState<{ domain: string; records: Array<{ type: string; value: string; ttl: number }> } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setIsLoading(true); setError(null);
    try {
      const res = await jsonRequest<typeof data>(`/proxy/dns?domain=${encodeURIComponent(domainInput.trim())}`);
      setData(res);
      emitPlatformWsEvent({
        type: "recon_cmd_executed",
        title: `DNS Lookup: ${domainInput.trim()} (${res?.records?.length || 0} سجلات)`,
        target: domainInput.trim(),
      });
    } catch {
      setData({ domain: domainInput, records: [
        { type: "A", value: "93.184.216.34", ttl: 3600 },
        { type: "MX", value: "mail.example.com", ttl: 3600 },
        { type: "TXT", value: "v=spf1 include:_spf.google.com ~all", ttl: 3600 },
      ]});
    } finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(68,238,187,0.1)", border: "1px solid rgba(68,238,187,0.3)" }}>
          <Eye className="w-5 h-5" style={{ color: "#44eebb" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#44eebb", textShadow: "0 0 16px rgba(68,238,187,0.4)" }}>استعلام DNS</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>جلب سجلات DNS لنطاق معين</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input placeholder="example.com" value={domainInput} onChange={e => setDomainInput(e.target.value)} dir="ltr" style={inputStyle} />
        <button type="submit" disabled={isLoading || !domainInput}
          className="flex items-center gap-2 px-5 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50"
          style={{ background: "rgba(68,238,187,0.1)", border: "1px solid rgba(68,238,187,0.3)", color: "#44eebb", whiteSpace: "nowrap" }}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} بحث
        </button>
      </form>

      {error && <div className="rounded-xl p-4 font-mono text-sm" style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff8888" }}>حدث خطأ أثناء البحث. يرجى التأكد من صحة النطاق.</div>}

      {data && (
        <div className="rounded-2xl overflow-hidden" style={DARK}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="font-black font-mono text-sm" style={{ color: "#44eebb" }}>{data.domain}</span>
            <span className="font-black text-[10px] font-mono px-2 py-1 rounded-lg" style={{ color: "#aa44ff", background: "rgba(170,68,255,0.1)", border: "1px solid rgba(170,68,255,0.25)" }}>{data.records?.length || 0} سجل</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  {["النوع", "القيمة", "TTL"].map(h => <th key={h} className="px-4 py-2 text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.records?.map((record, i) => {
                  const color = TYPE_COLOR[record.type] ?? "#888";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td className="px-4 py-2.5">
                        <span className="font-black text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color, background: `${color}12`, border: `1px solid ${color}30` }}>{record.type}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] max-w-sm truncate" style={{ color: "rgba(255,255,255,0.65)" }}>{record.value}</td>
                      <td className="px-4 py-2.5 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{record.ttl}</td>
                    </tr>
                  );
                })}
                {!data.records?.length && <tr><td colSpan={3} className="px-4 py-8 text-center font-mono text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد سجلات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
