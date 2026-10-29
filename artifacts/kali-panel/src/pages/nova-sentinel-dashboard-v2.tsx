import { useState, useEffect } from "react";
import { AlertCircle, Zap, Shield, Activity, Brain, Radar, Skull, Send, Loader2 } from "lucide-react";
import { streamOllamaViaServer } from "@/lib/ollama-browser";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DARK = { background: "rgba(5,0,12,0.85)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };

export default function NovaSentinelDashboardV2() {
  const [agentThoughts, setAgentThoughts] = useState<string[]>([]);
  const [systemMetrics, setSystemMetrics] = useState({ cpu: 0, ram: 0, ollama: "OFFLINE" });
  const [threats, setThreats] = useState<Array<{ severity: string; message: string }>>([]);
  const [commandInput, setCommandInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemMetrics({ cpu: Math.random() * 100, ram: Math.random() * 100, ollama: Math.random() > 0.1 ? "ONLINE" : "OFFLINE" });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleCommand = async () => {
    if (!commandInput.trim()) return;
    const cmd = commandInput;
    setIsExecuting(true);
    setAgentThoughts([`🤖 بدأت معالجة الأمر: "${cmd}"...`]);
    let buf = "";
    try {
      await streamOllamaViaServer({
        messages: [{ role: "user", content: cmd }],
        onToken: (token) => {
          buf += token;
          setAgentThoughts(prev => {
            const copy = [...prev];
            const lastIdx = copy.length - 1;
            if (lastIdx >= 0 && copy[lastIdx].startsWith("🤖 بدأت") || copy[lastIdx].startsWith("💬")) {
              copy[lastIdx] = `💬 ${buf}`;
            } else {
              copy.push(`💬 ${buf}`);
            }
            return copy;
          });
        },
      });
    } catch (error) { setAgentThoughts(prev => [...prev, `❌ خطأ: ${error}`]); }
    setIsExecuting(false); setCommandInput("");
  };

  const ollamaOnline = systemMetrics.ollama === "ONLINE";

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Radar className="w-7 h-7 animate-spin" style={{ color: "#4488ff", animationDuration: "3s" }} />
          <h1 className="font-black text-xl font-mono" style={{ background: "linear-gradient(90deg,#4488ff,#aa44ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Nova Sentinel V2
          </h1>
          <span className="text-[10px] font-black font-mono px-2.5 py-1 rounded-xl"
            style={{ background: ollamaOnline ? "rgba(68,255,136,0.1)" : "rgba(255,68,68,0.1)", border: `1px solid ${ollamaOnline ? "rgba(68,255,136,0.3)" : "rgba(255,68,68,0.3)"}`, color: ollamaOnline ? "#44ff88" : "#ff4444" }}>
            {systemMetrics.ollama}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "CPU Usage", value: `${systemMetrics.cpu.toFixed(1)}%`, color: "#44eebb", rgb: "68,238,187", icon: Activity },
          { label: "RAM Usage", value: `${systemMetrics.ram.toFixed(1)}%`, color: "#aa44ff", rgb: "170,68,255", icon: Zap },
          { label: "Threats", value: threats.length, color: "#ff8844", rgb: "255,136,68", icon: AlertCircle },
          { label: "Status", value: "Active", color: "#44ff88", rgb: "68,255,136", icon: Shield },
        ].map(({ label, value, color, rgb, icon: Icon }) => (
          <div key={label} className="rounded-xl p-4" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.2)`, borderRadius: 16 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono uppercase" style={{ color: `rgba(${rgb},0.6)` }}>{label}</span>
              <Icon className="w-3.5 h-3.5" style={{ color }} />
            </div>
            <div className="font-black text-xl font-mono" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Thought Stream */}
        <div className="lg:col-span-2 rounded-2xl p-5 space-y-3" style={DARK}>
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" style={{ color: "#4488ff" }} />
            <h2 className="font-black text-sm" style={{ color: "#4488ff" }}>Thought Stream</h2>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {agentThoughts.map((thought, i) => (
              <div key={i} className="text-[11px] font-mono p-3 rounded-xl"
                style={{ background: "rgba(68,136,255,0.04)", border: "1px solid rgba(68,136,255,0.15)", borderRight: "3px solid rgba(68,136,255,0.4)", color: "rgba(200,220,255,0.8)" }}>
                {thought}
              </div>
            ))}
            {agentThoughts.length === 0 && <div className="text-center py-6 font-mono text-xs" style={{ color: "rgba(255,255,255,0.15)" }}>أفكار الوكيل ستظهر هنا...</div>}
          </div>
        </div>

        {/* Command Center */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: "rgba(170,68,255,0.04)", border: "1px solid rgba(170,68,255,0.2)", borderRadius: 16 }}>
          <h2 className="font-black text-sm" style={{ color: "#aa44ff" }}>Command Center</h2>
          <textarea value={commandInput} onChange={e => setCommandInput(e.target.value)}
            placeholder="أدخل أمر سيبراني... مثال: افحص example.com"
            style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(170,68,255,0.2)", borderRadius: 10, color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "monospace", padding: "10px 12px", outline: "none", width: "100%", resize: "vertical", minHeight: 100 }} rows={4} />
          <button onClick={handleCommand} disabled={isExecuting || !commandInput.trim()}
            className="w-full py-2.5 rounded-xl font-black text-sm font-mono flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,rgba(170,68,255,0.2),rgba(68,136,255,0.2))", border: "1px solid rgba(170,68,255,0.4)", color: "#aa44ff" }}>
            {isExecuting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />جاري التنفيذ...</> : <><Send className="w-3.5 h-3.5" />تنفيذ الأمر</>}
          </button>
        </div>
      </div>

      {threats.length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.3)", borderRadius: 16 }}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff4444" }}>
            <AlertCircle className="w-4 h-4" />🚨 تنبيهات أمنية
          </h3>
          {threats.map((threat, i) => (
            <p key={i} className="text-[11px] font-mono" style={{ color: "#ff8888" }}>{threat.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
