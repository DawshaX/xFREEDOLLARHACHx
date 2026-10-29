import { useEffect, useState } from "react";
import { Search, Loader2, ListTree, AlertTriangle, Skull } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CweEntry { id: string; name: string; description: string; abstraction?: string; severity?: string; }

const SEV_COLOR: Record<string, string> = { CRITICAL: "#ff4444", HIGH: "#ff8844", MEDIUM: "#ffaa44", LOW: "#44ff88" };
const SEV_RGB: Record<string, string> = { CRITICAL: "255,68,68", HIGH: "255,136,68", MEDIUM: "255,170,68", LOW: "68,255,136" };

const CWE_DATA: CweEntry[] = [
  { id: "CWE-79",  name: "XSS — Cross-Site Scripting", description: "The software does not neutralize user-controllable input before it is placed in output served to users.", abstraction: "Variant", severity: "HIGH" },
  { id: "CWE-89",  name: "SQL Injection", description: "The software constructs SQL commands using externally-influenced input without proper neutralization.", abstraction: "Class", severity: "CRITICAL" },
  { id: "CWE-22",  name: "Path Traversal", description: "The software uses external input to construct a pathname without properly neutralizing special elements.", abstraction: "Class", severity: "HIGH" },
  { id: "CWE-78",  name: "OS Command Injection", description: "The software constructs OS commands using externally-influenced input without proper neutralization.", abstraction: "Class", severity: "CRITICAL" },
  { id: "CWE-20",  name: "Improper Input Validation", description: "The product receives input but does not validate it properly for the required properties.", abstraction: "Class", severity: "MEDIUM" },
  { id: "CWE-287", name: "Improper Authentication", description: "When an actor claims a given identity, the software does not sufficiently prove that the claim is correct.", abstraction: "Class", severity: "HIGH" },
  { id: "CWE-502", name: "Deserialization of Untrusted Data", description: "The application deserializes untrusted data without sufficiently verifying that the resulting data will be valid.", abstraction: "Class", severity: "HIGH" },
  { id: "CWE-306", name: "Missing Authentication for Critical Function", description: "The software does not perform any authentication for functionality that requires a provably identifiable entity.", abstraction: "Base", severity: "CRITICAL" },
  { id: "CWE-862", name: "Missing Authorization", description: "The software does not perform an authorization check when an actor attempts to access a resource or perform an action.", abstraction: "Class", severity: "HIGH" },
  { id: "CWE-798", name: "Use of Hard-coded Credentials", description: "The software contains hard-coded credentials which it uses for its own inbound authentication or outbound communication.", abstraction: "Base", severity: "CRITICAL" },
  { id: "CWE-918", name: "SSRF — Server-Side Request Forgery", description: "The web server retrieves external URLs without ensuring the request is sent to the expected destination.", abstraction: "Base", severity: "HIGH" },
  { id: "CWE-352", name: "CSRF — Cross-Site Request Forgery", description: "The web application cannot sufficiently verify whether a request was intentionally provided by the submitting user.", abstraction: "Compound", severity: "MEDIUM" },
  { id: "CWE-94",  name: "Code Injection", description: "The software constructs code segments using externally-influenced input without proper neutralization.", abstraction: "Class", severity: "CRITICAL" },
  { id: "CWE-200", name: "Exposure of Sensitive Information", description: "The product exposes sensitive information to an actor not authorized to access it.", abstraction: "Class", severity: "MEDIUM" },
  { id: "CWE-119", name: "Buffer Overflow", description: "The software performs operations on a memory buffer outside of the intended boundary.", abstraction: "Class", severity: "HIGH" },
  { id: "CWE-416", name: "Use After Free", description: "The program dereferences a pointer to memory that was freed, causing crash or code execution.", abstraction: "Base", severity: "HIGH" },
];

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

export default function Cwe() {
  const [search, setSearch] = useState("");
  const [data, setData] = useState<CweEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/cwe?limit=100");
        if (r.ok) { const json = await r.json(); setData(Array.isArray(json) ? json : json.data ?? CWE_DATA); }
        else setData(CWE_DATA);
      } catch { setData(CWE_DATA); }
      setLoading(false);
    };
    void load();
  }, []);

  const filtered = data.filter(c =>
    !search || c.id.toLowerCase().includes(search.toLowerCase()) || c.name.toLowerCase().includes(search.toLowerCase()) || (c.description?.toLowerCase() ?? "").includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ListTree className="w-5 h-5" style={{ color: "#ff5555" }} />
          <div>
            <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>
              قاعدة بيانات CWE
              <span className="text-[10px] font-mono ms-2 px-2 py-0.5 rounded" style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>{filtered.length} نتيجة</span>
            </h1>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Common Weakness Enumeration</p>
          </div>
        </div>
        <div style={{ position: "relative", width: 240 }}>
          <Search className="w-3.5 h-3.5 absolute" style={{ right: 10, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.2)" }} />
          <input placeholder="بحث CWE..." style={{ ...inputStyle, paddingRight: 32 }} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "#ff5555" }} /></div>
      ) : !filtered.length ? (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا يوجد نتائج</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-6">
          {filtered.map(cwe => {
            const sev = cwe.severity ?? "MEDIUM";
            const color = SEV_COLOR[sev] ?? "#888";
            const rgb = SEV_RGB[sev] ?? "136,136,136";
            return (
              <div key={cwe.id} className="rounded-xl p-4 space-y-2 transition-all group"
                style={{ background: "rgba(8,0,18,0.8)", border: `1px solid rgba(${rgb},0.12)`, borderRadius: 14 }}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-black font-mono text-[11px] px-2 py-0.5 rounded"
                    style={{ color: "#4488ff", background: "rgba(68,136,255,0.1)", border: "1px solid rgba(68,136,255,0.2)" }}>
                    {cwe.id}
                  </span>
                  {cwe.severity && (
                    <span className="text-[8px] font-black font-mono px-1.5 py-0.5 rounded"
                      style={{ color, background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.25)` }}>
                      {cwe.severity}
                    </span>
                  )}
                </div>
                <h3 className="font-black text-sm leading-snug" style={{ color: "rgba(255,255,255,0.8)" }}>{cwe.name}</h3>
                <p className="text-[9px] font-mono line-clamp-3 leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>{cwe.description}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
