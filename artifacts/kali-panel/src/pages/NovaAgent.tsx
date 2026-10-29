import { useState, useEffect } from "react";
import { Bot, Activity, Zap, Cpu, Network, AlertTriangle, CheckCircle, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";

interface AgentStatus { status: "idle" | "thinking" | "acting" | "observing" | "complete"; currentTask?: string; lastAction?: string; uptime: string; tasksCompleted: number; }
interface SystemMetrics { cpu: number; ram: number; network: "online" | "offline"; threats: number; }

const DARK = { background: "rgba(5,0,12,0.85)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

const STATUS_COLOR: Record<string, string> = { idle: "#555", thinking: "#4488ff", acting: "#ffaa44", observing: "#aa44ff", complete: "#44ff88" };
const STATUS_LABEL: Record<string, string> = { idle: "خامل", thinking: "يفكر", acting: "ينفّذ", observing: "يراقب", complete: "اكتمل" };

export default function NovaAgent() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ status: "idle", uptime: "00:00:00", tasksCompleted: 0 });
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({ cpu: 0, ram: 0, network: "online", threats: 0 });
  const [logs, setLogs] = useState<string[]>(["[00:00:00] Nova Agent initialized", "[00:00:01] System scan complete", "[00:00:02] All services operational"]);
  const [input, setInput] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemMetrics(prev => ({ ...prev, cpu: Math.min(99, 20 + Math.floor(Math.random() * 30)), ram: Math.min(96, 30 + Math.floor(Math.random() * 40)), threats: Math.floor(Math.random() * 5) }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const cmd = input; setInput("");
    setAgentStatus(s => ({ ...s, status: "thinking", currentTask: cmd }));
    const ts = new Date().toTimeString().slice(0, 8);
    setLogs(l => [...l, `[${ts}] User: ${cmd}`, `[${ts}] Nova: Processing command...`]);
    await new Promise(r => setTimeout(r, 800));
    setAgentStatus(s => ({ ...s, status: "acting", lastAction: cmd }));
    await new Promise(r => setTimeout(r, 1200));
    setAgentStatus(s => ({ ...s, status: "complete", tasksCompleted: s.tasksCompleted + 1 }));
    const ts2 = new Date().toTimeString().slice(0, 8);
    setLogs(l => [...l, `[${ts2}] Nova: Task completed successfully`, `[${ts2}] System: Ready for next command`]);
    setTimeout(() => setAgentStatus(s => ({ ...s, status: "idle" })), 2000);
  };

  const sc = STATUS_COLOR[agentStatus.status];

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ Nova Agent" subtitle="وكيل ذكاء اصطناعي أمني ذاتي التعلم" icon={Bot} danger />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "حالة الوكيل", value: STATUS_LABEL[agentStatus.status], color: sc, icon: Bot },
          { label: "المهام المنجزة", value: agentStatus.tasksCompleted, color: "#44ff88", icon: CheckCircle },
          { label: "التهديدات المرصودة", value: systemMetrics.threats, color: "#ff4444", icon: AlertTriangle },
          { label: "الشبكة", value: systemMetrics.network === "online" ? "متصل" : "منقطع", color: systemMetrics.network === "online" ? "#44ff88" : "#ff4444", icon: Network },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl p-4 space-y-2" style={{ background: `${color}08`, border: `1px solid ${color}25`, borderRadius: 16 }}>
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4" style={{ color }} />
              <span className="text-[9px] font-black font-mono uppercase" style={{ color: `${color}70` }}>{label}</span>
            </div>
            <div className="font-black text-xl font-mono" style={{ color, textShadow: `0 0 10px ${color}50` }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-3">
          <div className="rounded-2xl p-4 space-y-4" style={NEON_CARD}>
            <div className="flex items-center gap-2 mb-1">
              <Skull className="w-4 h-4" style={{ color: "#ff5555" }} />
              <span className="font-black text-sm" style={{ color: "#ff5555" }}>مقاييس النظام</span>
            </div>
            {[
              { label: "CPU", value: systemMetrics.cpu, color: systemMetrics.cpu > 80 ? "#ff4444" : "#44ff88", icon: Cpu },
              { label: "RAM", value: systemMetrics.ram, color: systemMetrics.ram > 85 ? "#ff4444" : "#4488ff", icon: Activity },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                    <span className="text-[10px] font-black font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
                  </div>
                  <span className="font-black font-mono text-sm" style={{ color }}>{value}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: `linear-gradient(90deg,${color}60,${color})` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl p-4" style={NEON_CARD}>
            <div className="font-black text-[9px] font-mono uppercase mb-3" style={{ color: "rgba(255,255,255,0.25)" }}>حالة الوكيل الحالية</div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: sc, boxShadow: `0 0 8px ${sc}` }} />
              <span className="font-black text-base font-mono" style={{ color: sc }}>{STATUS_LABEL[agentStatus.status]}</span>
            </div>
            {agentStatus.currentTask && (
              <div className="mt-2 p-2 rounded-xl text-[10px] font-mono" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.4)" }}>المهمة: {agentStatus.currentTask}</div>
            )}
          </div>
        </div>
        <div className="lg:col-span-2 rounded-2xl flex flex-col min-h-80" style={DARK}>
          <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-[11px]" style={{ scrollbarWidth: "thin" }}>
            {logs.map((line, i) => {
              const isNova = line.includes("Nova:"); const isSys = line.includes("System:");
              return <div key={i} style={{ color: isNova ? "#44ff88" : isSys ? "#4488ff" : "rgba(255,255,255,0.35)" }}>{line}</div>;
            })}
          </div>
          <form onSubmit={handleSend} className="p-3 flex gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="أعطِ أمراً للوكيل..." style={inputStyle} />
            <button type="submit" disabled={!input.trim()}
              className="px-4 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", whiteSpace: "nowrap" }}>
              <Zap className="w-3.5 h-3.5" />تنفيذ
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
