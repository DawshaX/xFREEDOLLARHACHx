import { useState, useEffect, useRef } from "react";
import { Send, Brain, Wrench, Loader2, Terminal, Zap, AlertTriangle, Monitor, Skull } from "lucide-react";
import { streamOllamaViaServer } from "@/lib/ollama-browser";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DARK = { background: "rgba(5,0,12,0.85)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%", resize: "vertical" };

export default function NovaSentinelDashboard() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string; type?: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [systemStats, setSystemStats] = useState({ cpu: 0, ram: 0, ollama: "offline" });
  const [processes, setProcesses] = useState<Array<{ id: string; name: string; progress: number; status: string }>>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [vulnerabilities, setVulnerabilities] = useState<Array<{ id: string; type: string; severity: string; target: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [metricsRes, probeRes] = await Promise.allSettled([
          fetch("/api/system/metrics"),
          fetch("/api/ollama/probe"),
        ]);
        const data = metricsRes.status === "fulfilled" && metricsRes.value.ok ? await metricsRes.value.json() : {};
        const probe = probeRes.status === "fulfilled" && probeRes.value.ok ? await probeRes.value.json() : {};
        setSystemStats({ cpu: data.cpu?.usage || 0, ram: data.ram?.percent || 0, ollama: probe.connected ? "online" : "offline" });
      } catch { setSystemStats({ cpu: 0, ram: 0, ollama: "offline" }); }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSend = async () => {
    if (!prompt.trim()) return;
    const userPrompt = prompt;
    setMessages(m => [...m, { role: "user", content: userPrompt }]);
    setPrompt(""); setIsLoading(true);
    let buf = "";
    try {
      setMessages(m => [...m, { role: "assistant", content: "", type: "stream" }]);
      await streamOllamaViaServer({
        messages: [{ role: "user", content: userPrompt }],
        onToken: (token) => {
          buf += token;
          setMessages(m => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", content: buf, type: "stream" };
            return copy;
          });
        },
      });
    } catch { setMessages(m => [...m, { role: "error", content: "خطأ في الاتصال بـ Ollama" }]); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)" }}>
            <Skull className="w-6 h-6" style={{ color: "#ff5555" }} />
          </div>
          <div>
            <h1 className="font-black text-xl font-mono" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>Nova Sentinel</h1>
            <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>Powered by Ollama (dolphin-llama3) | ReAct Engine</p>
          </div>
        </div>
        <span className="flex items-center gap-2 px-3 py-1.5 rounded-xl font-black text-[10px]"
          style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff5555" }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#ff5555" }} />LIVE
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Chat */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl overflow-hidden flex-1 flex flex-col min-h-80" style={DARK}>
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.3)" }}>
              <Brain className="w-4 h-4" style={{ color: "#4488ff" }} />
              <span className="text-[10px] font-black font-mono uppercase" style={{ color: "#4488ff" }}>Thought Stream</span>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2" style={{ scrollbarWidth: "thin" }}>
              {messages.map((msg, i) => (
                <div key={i} className="text-[11px] p-3 rounded-xl"
                  style={msg.role === "user" ? { background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.2)", color: "rgba(255,150,150,0.9)" }
                    : msg.role === "error" ? { background: "rgba(255,0,0,0.1)", border: "1px solid rgba(255,0,0,0.2)", color: "#ff4444" }
                    : { background: "rgba(68,255,136,0.04)", border: "1px solid rgba(68,255,136,0.15)", color: "rgba(68,255,136,0.8)" }}>
                  {msg.content}
                </div>
              ))}
              {messages.length === 0 && <div className="text-center py-8 font-mono text-xs" style={{ color: "rgba(255,255,255,0.15)" }}>أوامر Nova Sentinel تظهر هنا...</div>}
            </div>
          </div>
          <div className="flex gap-2">
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="أوامر Nova Sentinel... مثال: افحص example.com وطلعلي ثغرات XSS"
              style={{ ...inputStyle, minHeight: 72 }} rows={3} />
            <button onClick={handleSend} disabled={isLoading || !prompt.trim()}
              className="px-4 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50 flex items-center justify-center"
              style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", minWidth: 48 }}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Right panels */}
        <div className="flex flex-col gap-3">
          {/* System Status */}
          <div className="rounded-2xl p-4 space-y-3" style={DARK}>
            <h3 className="font-black text-[10px] font-mono uppercase flex items-center gap-2" style={{ color: "#ffaa44" }}>
              <Monitor className="w-3.5 h-3.5" />System Status
            </h3>
            {[
              { label: "CPU Usage", value: `${systemStats.cpu.toFixed(1)}%`, color: "#44eebb" },
              { label: "RAM Usage", value: `${systemStats.ram.toFixed(1)}%`, color: "#aa44ff" },
              { label: "Ollama Status", value: systemStats.ollama.toUpperCase(), color: systemStats.ollama === "online" ? "#44ff88" : "#ff4444" },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex justify-between items-center">
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{label}:</span>
                <span className="text-[10px] font-black font-mono" style={{ color }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Vulnerabilities */}
          {vulnerabilities.length > 0 && (
            <div className="rounded-2xl p-4 space-y-2 animate-pulse" style={{ background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.3)", borderRadius: 16 }}>
              <h3 className="font-black text-[10px] font-mono uppercase flex items-center gap-2" style={{ color: "#ff4444" }}>
                <AlertTriangle className="w-3.5 h-3.5" />VULNERABILITIES DETECTED
              </h3>
              {vulnerabilities.map(v => (
                <div key={v.id} className="flex items-center justify-between p-2 rounded-lg" style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.2)" }}>
                  <span className="text-[10px] font-black font-mono" style={{ color: "#ff8888" }}>{v.type}</span>
                  <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color: "#ff4444", background: "rgba(255,68,68,0.15)", border: "1px solid rgba(255,68,68,0.3)" }}>{v.severity}</span>
                </div>
              ))}
            </div>
          )}

          {/* Processes */}
          <div className="rounded-2xl flex flex-col flex-1 min-h-32" style={DARK}>
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <Zap className="w-3.5 h-3.5" style={{ color: "#44ff88" }} />
              <span className="text-[9px] font-black font-mono uppercase" style={{ color: "#44ff88" }}>Running Tasks</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ scrollbarWidth: "thin" }}>
              {processes.length === 0 ? (
                <div className="text-[10px] font-mono text-center py-3" style={{ color: "rgba(255,255,255,0.15)" }}>No tasks running...</div>
              ) : processes.map(p => (
                <div key={p.id} className="p-2 rounded-xl" style={{ background: "rgba(68,255,136,0.04)", border: "1px solid rgba(68,255,136,0.12)" }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-mono truncate" style={{ color: "rgba(68,255,136,0.8)" }}>{p.name}</span>
                    <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{p.status}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div className="h-full rounded-full" style={{ width: `${p.progress}%`, background: "#44ff88" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Logs */}
          <div className="rounded-2xl flex flex-col min-h-28" style={DARK}>
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <Terminal className="w-3.5 h-3.5" style={{ color: "#ffaa44" }} />
              <span className="text-[9px] font-black font-mono uppercase" style={{ color: "#ffaa44" }}>Live Logs</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-[9px]" style={{ scrollbarWidth: "thin" }}>
              {logs.length === 0 ? (
                <div className="text-center py-2" style={{ color: "rgba(255,255,255,0.1)" }}>no logs yet...</div>
              ) : logs.map((log, i) => (
                <div key={i} style={{ color: "rgba(255,255,255,0.35)" }}>{log}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
