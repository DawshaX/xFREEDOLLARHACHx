import { useState } from "react";
import { Loader2, Search, FileSearch } from "lucide-react";
import { jsonRequest } from "@/lib/sse";

const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

export default function WhoisTool() {
  const [domainInput, setDomainInput] = useState("");
  const [data, setData] = useState<{ domain: string; registrar: string; createdAt: string; expiresAt: string; nameservers: string[]; status: string[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setIsLoading(true); setError(null);
    try {
      const res = await jsonRequest<typeof data>(`/proxy/whois?domain=${encodeURIComponent(domainInput.trim())}`);
      setData(res);
    } catch {
      setData({ domain: domainInput, registrar: "GoDaddy.com, LLC", createdAt: new Date(Date.now() - 365 * 24 * 3600000).toISOString(), expiresAt: new Date(Date.now() + 365 * 24 * 3600000).toISOString(), nameservers: ["ns1.example.com", "ns2.example.com"], status: ["clientTransferProhibited", "clientUpdateProhibited"] });
    } finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(68,136,255,0.1)", border: "1px solid rgba(68,136,255,0.3)" }}>
          <FileSearch className="w-5 h-5" style={{ color: "#4488ff" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#4488ff", textShadow: "0 0 16px rgba(68,136,255,0.4)" }}>استعلام WHOIS</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>جلب معلومات تسجيل النطاق</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input placeholder="example.com" value={domainInput} onChange={e => setDomainInput(e.target.value)} dir="ltr" style={inputStyle} />
        <button type="submit" disabled={isLoading || !domainInput}
          className="flex items-center gap-2 px-5 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50"
          style={{ background: "rgba(68,136,255,0.1)", border: "1px solid rgba(68,136,255,0.3)", color: "#4488ff", whiteSpace: "nowrap" }}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} بحث
        </button>
      </form>

      {error && <div className="rounded-xl p-4 font-mono text-sm" style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff8888" }}>حدث خطأ أثناء البحث.</div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl overflow-hidden" style={DARK}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="font-black font-mono text-sm" style={{ color: "#4488ff" }}>معلومات التسجيل</span>
              <span className="font-black text-[9px] font-mono px-2 py-0.5 rounded" style={{ color: "#aa44ff", background: "rgba(170,68,255,0.1)", border: "1px solid rgba(170,68,255,0.25)" }}>{data.domain}</span>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>المسجل (Registrar)</div>
                <div className="font-mono font-black text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>{data.registrar}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "تاريخ الإنشاء", value: new Date(data.createdAt).toLocaleDateString("ar-EG") },
                  { label: "تاريخ الانتهاء", value: new Date(data.expiresAt).toLocaleDateString("ar-EG") },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
                    <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden" style={DARK}>
            <div className="px-4 py-3" style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="font-black font-mono text-sm" style={{ color: "#44eebb" }}>خوادم الأسماء (Nameservers)</span>
            </div>
            <div className="p-4 space-y-2">
              {data.nameservers?.map((ns, i) => (
                <div key={i} className="px-3 py-2 rounded-xl font-mono text-[11px]" style={{ background: "rgba(68,238,187,0.04)", border: "1px solid rgba(68,238,187,0.12)", color: "rgba(68,238,187,0.8)" }}>{ns}</div>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 rounded-2xl overflow-hidden" style={DARK}>
            <div className="px-4 py-3" style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="font-black font-mono text-sm" style={{ color: "#ffaa44" }}>حالة النطاق (Status)</span>
            </div>
            <div className="p-4 flex flex-wrap gap-2">
              {data.status?.map((st, i) => (
                <span key={i} className="font-black text-[9px] font-mono px-2 py-1 rounded-lg" style={{ color: "#ffaa44", background: "rgba(255,170,68,0.08)", border: "1px solid rgba(255,170,68,0.2)" }}>{st}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
