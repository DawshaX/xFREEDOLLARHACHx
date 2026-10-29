import { useState, useEffect } from "react";
import { Search, Loader2, Layers, Skull } from "lucide-react";

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

const TACTIC_COLORS: Record<string, string> = {
  "Initial Access": "#ff4444", "Execution": "#ff8844", "Persistence": "#ffaa44",
  "Privilege Escalation": "#aa44ff", "Defense Evasion": "#4488ff",
  "Credential Access": "#44eebb", "Discovery": "#44ff88", "Lateral Movement": "#ff44aa",
  "Collection": "#ffcc44", "Exfiltration": "#ff5588", "Impact": "#ff2222",
};

export default function Mitre() {
  const [search, setSearch] = useState("");
  const [techniques, setTechniques] = useState<any[]>([]);
  const [loading] = useState(false);

  useEffect(() => {
    setTechniques([
      { id: "T1566", name: "Phishing", tactic: "Initial Access", description: "Adversaries may send phishing messages to gain access to victim systems.", platforms: ["Windows", "macOS", "Linux"] },
      { id: "T1059", name: "Command and Scripting Interpreter", tactic: "Execution", description: "Adversaries may abuse command and script interpreters to execute commands.", platforms: ["Windows", "macOS", "Linux"] },
      { id: "T1053", name: "Scheduled Task/Job", tactic: "Persistence", description: "Adversaries may abuse task scheduling functionality to facilitate recurring execution of malicious code.", platforms: ["Windows", "macOS", "Linux"] },
      { id: "T1548", name: "Abuse Elevation Control Mechanism", tactic: "Privilege Escalation", description: "Adversaries may circumvent mechanisms designed to control elevated privileges.", platforms: ["Windows", "macOS", "Linux"] },
      { id: "T1070", name: "Indicator Removal", tactic: "Defense Evasion", description: "Adversaries may delete or modify artifacts generated within systems to remove evidence.", platforms: ["Windows", "macOS", "Linux"] },
      { id: "T1003", name: "OS Credential Dumping", tactic: "Credential Access", description: "Adversaries may attempt to dump credentials to obtain account login information.", platforms: ["Windows", "macOS", "Linux"] },
      { id: "T1046", name: "Network Service Discovery", tactic: "Discovery", description: "Adversaries may attempt to get a listing of services running on remote hosts.", platforms: ["Windows", "macOS", "Linux"] },
      { id: "T1021", name: "Remote Services", tactic: "Lateral Movement", description: "Adversaries may use Valid Accounts to log into a service specifically designed to accept remote connections.", platforms: ["Windows", "macOS", "Linux"] },
    ]);
  }, []);

  const filtered = search ? techniques.filter(t => t.id.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase())) : techniques;
  const byTactic = filtered.reduce((acc: any, tech) => { if (!acc[tech.tactic]) acc[tech.tactic] = []; acc[tech.tactic].push(tech); return acc; }, {});

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Layers className="w-6 h-6" style={{ color: "#ff5555" }} />
          <div>
            <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>MITRE ATT&CK Matrix</h1>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>مصفوفة تكتيكات وتقنيات الهجوم</p>
          </div>
        </div>
        <div style={{ position: "relative", width: 240 }}>
          <Search className="w-3.5 h-3.5 absolute" style={{ right: 10, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.2)" }} />
          <input placeholder="بحث التقنيات..." style={{ ...inputStyle, paddingRight: 32 }} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "#ff5555" }} /></div>
      ) : !filtered.length ? (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد تقنيات</p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {Object.entries(byTactic).map(([tactic, techs]: [string, any]) => {
              const color = TACTIC_COLORS[tactic] ?? "#4488ff";
              return (
                <div key={tactic} className="w-56 flex flex-col gap-2">
                  <div className="rounded-xl p-2.5 text-center sticky top-0 z-10"
                    style={{ background: `rgba(${color.replace("#","").match(/.{2}/g)?.map(h=>parseInt(h,16)).join(",")},0.12)`, border: `1px solid rgba(${color.replace("#","").match(/.{2}/g)?.map(h=>parseInt(h,16)).join(",")},0.35)`, backdropFilter: "blur(4px)" }}>
                    <div className="font-black text-[10px] font-mono" style={{ color }}>{tactic}</div>
                    <div className="text-[9px] font-mono mt-0.5" style={{ color: `rgba(255,255,255,0.3)` }}>{techs.length} تقنية</div>
                  </div>
                  <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "65vh" }}>
                    {techs.map((tech: any) => (
                      <div key={tech.id} className="group rounded-xl p-3 cursor-pointer transition-all"
                        style={{ background: "rgba(8,0,18,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 }}>
                        <div className="font-black font-mono text-[10px] mb-1" style={{ color }}>{tech.id}</div>
                        <div className="text-[11px] font-black line-clamp-2" style={{ color: "rgba(255,255,255,0.75)" }}>{tech.name}</div>
                        <div className="hidden group-hover:block mt-1.5">
                          <p className="text-[9px] font-mono line-clamp-3" style={{ color: "rgba(255,255,255,0.4)" }}>{tech.description}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {tech.platforms?.slice(0, 3).map((p: string) => (
                              <span key={p} className="text-[8px] font-black font-mono px-1 py-0.5 rounded"
                                style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>{p}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
