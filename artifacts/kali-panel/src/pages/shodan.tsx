import { useState } from "react";
import { Search, Loader2, Globe, Server, Shield, MapPin, Cpu, Skull } from "lucide-react";

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "11px 14px", outline: "none", flex: 1 };

interface ShodanHit { ip: string; port: number; org: string; country: string; product: string; banner: string; }

const MOCK_HITS: ShodanHit[] = [
  { ip: "95.123.45.67", port: 80, org: "Saudi Telecom Company", country: "SA", product: "Apache httpd 2.4.41", banner: "HTTP/1.1 200 OK\nServer: Apache/2.4.41 (Ubuntu)\nContent-Type: text/html" },
  { ip: "104.22.33.44", port: 443, org: "Cloudflare, Inc.", country: "US", product: "cloudflare-nginx", banner: "HTTP/1.1 403 Forbidden\nServer: cloudflare\nContent-Type: text/html" },
  { ip: "212.11.22.33", port: 22, org: "Mobily", country: "SA", product: "OpenSSH 8.2p1", banner: "SSH-2.0-OpenSSH_8.2p1 Ubuntu-4ubuntu0.3" },
  { ip: "185.55.66.77", port: 3306, org: "Zain SA", country: "SA", product: "MySQL 5.7.33", banner: "5.7.33-0ubuntu0.18.04.1" },
  { ip: "5.6.7.8", port: 8080, org: "Amazon.com", country: "US", product: "Jetty 9.4.z-SNAPSHOT", banner: "HTTP/1.1 404 Not Found\nServer: Jetty(9.4.z-SNAPSHOT)" },
];

export default function Shodan() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hits, setHits] = useState<ShodanHit[]>([]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearch(query); setIsLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    const q = query.toLowerCase();
    const filtered = MOCK_HITS.filter(h => h.ip.includes(q) || h.org.toLowerCase().includes(q) || h.product.toLowerCase().includes(q));
    setHits(filtered); setIsLoading(false);
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)" }}>
            <Globe className="w-6 h-6" style={{ color: "#ff5555" }} />
          </div>
          <div>
            <h1 className="font-black text-xl font-mono" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>SHODAN INTELLIGENCE</h1>
            <p className="text-[9px] font-black tracking-widest uppercase font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Global IoT & Infrastructure Discovery</p>
          </div>
        </div>
        <span className="flex items-center gap-2 px-3 py-1.5 rounded-xl font-black text-[10px]"
          style={{ background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.25)", color: "#44ff88" }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#44ff88" }} />LIVE FEED
        </span>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-3 rounded-2xl p-4" style={NEON_CARD}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="ابحث عن أجهزة: apache, port:80, country:SA..." dir="rtl"
          style={inputStyle} />
        <div className="rounded-xl p-4 flex items-center gap-2 shrink-0"
          style={{ background: "rgba(68,255,136,0.06)", border: "1px solid rgba(68,255,136,0.2)" }}>
          <Shield className="w-4 h-4" style={{ color: "#44ff88" }} />
          <div>
            <div className="font-black font-mono text-[10px]" style={{ color: "#44ff88" }}>SECURE</div>
            <div className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>ENCRYPTED</div>
          </div>
        </div>
        <button type="submit" disabled={!query.trim() || isLoading}
          className="px-5 rounded-xl font-black text-sm font-mono transition-all disabled:opacity-50"
          style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", whiteSpace: "nowrap" }}>
          {isLoading ? "⠶ جارِ البحث..." : "▶ إرسال الاستعلام"}
        </button>
      </form>

      {/* Results */}
      {!search && !isLoading && (
        <div className="rounded-2xl p-16 text-center space-y-4" style={NEON_CARD}>
          <Globe className="w-20 h-20 mx-auto animate-pulse" style={{ color: "rgba(255,30,30,0.2)" }} />
          <h3 className="font-black text-lg" style={{ color: "rgba(255,100,100,0.5)" }}>محرك بحث الأجهزة العالمية</h3>
          <p className="font-mono text-xs max-w-xs mx-auto" style={{ color: "rgba(255,255,255,0.2)" }}>أدخل استعلام بحث لاستكشاف الخوادم، الكاميرات، وكافة الأجهزة المتصلة بالإنترنت</p>
        </div>
      )}

      {isLoading && (
        <div className="rounded-2xl p-16 text-center space-y-4" style={NEON_CARD}>
          <div className="relative mx-auto w-16 h-16">
            <Loader2 className="w-16 h-16 animate-spin" style={{ color: "rgba(255,30,30,0.3)" }} />
            <Globe className="w-8 h-8 absolute inset-4" style={{ color: "#ff5555" }} />
          </div>
          <p className="font-black font-mono text-xs animate-pulse tracking-widest" style={{ color: "#ff5555" }}>SCANNING GLOBAL DATABASE...</p>
        </div>
      )}

      {!isLoading && search && hits.length === 0 && (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لم يتم العثور على نتائج لـ "{search}"</p>
        </div>
      )}

      <div className="space-y-3">
        {hits.map((hit, i) => (
          <div key={i} className="rounded-2xl p-5 transition-all" style={{ background: "rgba(8,0,18,0.9)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16 }}>
            <div className="flex flex-col md:flex-row gap-5">
              <div className="flex flex-col gap-2 min-w-48">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl" style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.2)" }}>
                    <Server className="w-4 h-4" style={{ color: "#ff5555" }} />
                  </div>
                  <span className="font-black font-mono text-lg" style={{ color: "#4488ff" }} dir="ltr">{hit.ip}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color: "#4488ff", background: "rgba(68,136,255,0.1)", border: "1px solid rgba(68,136,255,0.2)" }}>PORT: {hit.port}</span>
                  <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color: "#ffaa44", background: "rgba(255,170,68,0.1)", border: "1px solid rgba(255,170,68,0.2)" }}>{hit.country}</span>
                </div>
              </div>
              <div className="flex-1 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[8px] font-black font-mono uppercase flex items-center gap-1 mb-1" style={{ color: "rgba(255,255,255,0.25)" }}>
                      <MapPin className="w-3 h-3" />Organization
                    </div>
                    <div className="text-xs font-black" style={{ color: "rgba(255,255,255,0.7)" }}>{hit.org}</div>
                  </div>
                  <div>
                    <div className="text-[8px] font-black font-mono uppercase flex items-center gap-1 mb-1" style={{ color: "rgba(255,255,255,0.25)" }}>
                      <Cpu className="w-3 h-3" />Product / Service
                    </div>
                    <div className="text-xs font-black" style={{ color: "#ffaa44" }}>{hit.product}</div>
                  </div>
                </div>
                <div>
                  <div className="text-[8px] font-black font-mono uppercase mb-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>Banner Information</div>
                  <pre className="rounded-xl p-3 font-mono text-[9px] overflow-x-auto whitespace-pre-wrap"
                    style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.05)", color: "rgba(68,255,136,0.7)" }}>
                    {hit.banner}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
