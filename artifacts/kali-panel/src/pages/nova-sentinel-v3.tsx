import { useState, useEffect } from "react";
import { Shield, Activity, Brain, Radar, Terminal, AlertTriangle, Cpu, Database, Skull, Send, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16 };

interface ThoughtEntry { type: string; content: string; }
interface MetricEntry { time: string; cpu: number; ram: number; }

export default function NovaSentinelV3() {
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricEntry[]>([]);
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ cpu: 0, ram: 0, ollama: "ONLINE", db: "NEON-CONNECTED" });

  useEffect(() => {
    const interval = setInterval(() => {
      const m = { time: new Date().toLocaleTimeString(), cpu: Math.floor(Math.random() * 100), ram: Math.floor(Math.random() * 100) };
      setMetrics(prev => [...prev.slice(-20), m]);
      setStatus(prev => ({ ...prev, cpu: m.cpu, ram: m.ram }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const runCommand = async () => {
    if (!command.trim()) return;
    setLoading(true);
    setThoughts(prev => [...prev, { type: "system", content: `🚀 إرسال الأمر للمنظومة: ${command}` }]);
    try {
      const response = await fetch(`${BASE}/nova-agent-v3/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) });
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          const text = new TextDecoder().decode(value);
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ")) { try { const d = JSON.parse(line.slice(6)); setThoughts(prev => [...prev, d]); } catch {} }
          }
        }
      }
    } catch { setThoughts(prev => [...prev, { type: "error", content: "فشل الاتصال بالوكيل V3" }]); }
    setLoading(false); setCommand("");
  };

  const thoughtStyle = (type: string): React.CSSProperties => ({
    thought: { background: "rgba(68,136,255,0.05)", border: "1px solid rgba(68,136,255,0.2)", color: "rgba(180,210,255,0.85)" },
    alert: { background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.25)", color: "#ff8888" },
    observation: { background: "rgba(170,68,255,0.05)", border: "1px solid rgba(170,68,255,0.18)", color: "rgba(200,150,255,0.85)" },
    error: { background: "rgba(255,0,0,0.08)", border: "1px solid rgba(255,0,0,0.2)", color: "#ff4444" },
    system: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" },
  }[type] ?? { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" });

  return (
    <div className="min-h-screen p-5 space-y-5 font-mono" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Status Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "CPU LOAD", value: `${status.cpu}%`, color: "#44eebb", rgb: "68,238,187", icon: Cpu },
          { label: "RAM USAGE", value: `${status.ram}%`, color: "#aa44ff", rgb: "170,68,255", icon: Activity },
          { label: "DATABASE", value: status.db, color: "#44ff88", rgb: "68,255,136", icon: Database },
          { label: "OLLAMA STATUS", value: status.ollama, color: "#ff8844", rgb: "255,136,68", icon: Radar },
        ].map(({ label, value, color, rgb, icon: Icon }) => (
          <div key={label} className="rounded-xl p-4 flex items-center gap-3" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.2)`, borderRadius: 16 }}>
            <div className="p-2 rounded-xl shrink-0" style={{ background: `rgba(${rgb},0.12)` }}>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <div>
              <p className="text-[8px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</p>
              <p className="font-black text-sm" style={{ color }}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Thought Stream */}
        <div className="lg:col-span-8">
          <div className="rounded-2xl overflow-hidden flex flex-col h-[500px]" style={DARK}>
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4" style={{ color: "#44eebb" }} />
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#44eebb" }}>Nova Sentinel V3 — Thought Stream</span>
              </div>
              <div className="flex gap-1">
                {["#ff4444", "#ffaa44", "#44ff88"].map(c => <div key={c} className="w-2 h-2 rounded-full" style={{ background: c, opacity: 0.5 }} />)}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ scrollbarWidth: "thin" }}>
              {thoughts.map((t, i) => (
                <div key={i} className="p-3 rounded-xl" style={thoughtStyle(t.type)}>
                  <div className="text-[8px] uppercase tracking-wider mb-1 opacity-40">[{t.type}]</div>
                  <p className="text-[11px] leading-relaxed">{t.content}</p>
                </div>
              ))}
              {loading && <div className="text-[11px] animate-pulse" style={{ color: "#44eebb" }}>جاري التفكير والتنفيذ...</div>}
              {thoughts.length === 0 && !loading && <div className="text-center py-10 text-[10px]" style={{ color: "rgba(255,255,255,0.1)" }}>أدخل أمراً للبدء...</div>}
            </div>
            <div className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.3)" }}>
              <div className="flex items-center gap-2 px-3 rounded-xl" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <Terminal className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                <input value={command} onChange={e => setCommand(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runCommand()}
                  placeholder="أدخل أمر سيبراني للمنظومة..."
                  className="flex-1 bg-transparent focus:outline-none text-[12px] py-2"
                  style={{ color: "rgba(255,255,255,0.7)" }} />
                <button onClick={runCommand} disabled={loading || !command.trim()}
                  className="p-1 transition-all disabled:opacity-50" style={{ color: "#ff5555" }}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Side Panel */}
        <div className="lg:col-span-4 space-y-4">
          {/* Mini CPU chart visualization */}
          <div className="rounded-2xl p-4 space-y-3" style={DARK}>
            <h3 className="text-[9px] font-black uppercase flex items-center gap-2" style={{ color: "#aa44ff" }}>
              <Activity className="w-4 h-4" />System Metrics
            </h3>
            <div className="flex items-end gap-0.5 h-16">
              {metrics.slice(-30).map((m, i) => (
                <div key={i} className="flex-1 rounded-t transition-all duration-500"
                  style={{ height: `${m.cpu}%`, background: `rgba(68,238,187,${0.3 + (i / 30) * 0.7})`, minWidth: 2 }} />
              ))}
            </div>
            <div className="text-[9px] font-mono" style={{ color: "rgba(68,238,187,0.6)" }}>CPU — Live</div>
          </div>

          {/* Security Status */}
          <div className="rounded-2xl p-4 space-y-3" style={DARK}>
            <h3 className="text-[9px] font-black uppercase flex items-center gap-2" style={{ color: "#ff8844" }}>
              <Shield className="w-4 h-4" />Security Status
            </h3>
            {[
              { label: "Stealth Mode", value: "ACTIVE", pct: 100, color: "#44ff88" },
              { label: "Zero-Day Monitoring", value: "SYNCING", pct: 65, color: "#44eebb", pulse: true },
            ].map(({ label, value, pct, color, pulse }) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-[9px]">
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{label}</span>
                  <span className="font-black" style={{ color }}>{value}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className={`h-full rounded-full ${pulse ? "animate-pulse" : ""}`} style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            ))}
          </div>

          {/* Skull decoration */}
          <div className="rounded-2xl p-6 text-center" style={DARK}>
            <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,30,30,0.15)", filter: "drop-shadow(0 0 12px rgba(255,30,30,0.2))" }} />
            <p className="text-[9px] font-black font-mono mt-2 tracking-widest" style={{ color: "rgba(255,30,30,0.25)" }}>NOVA SENTINEL V3</p>
          </div>
        </div>
      </div>
    </div>
  );
}
