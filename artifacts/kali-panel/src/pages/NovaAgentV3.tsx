import { useState, useEffect, useRef } from "react";
import { Bot, Brain, Cpu, Shield, Globe, Activity, CheckCircle, AlertTriangle, Zap, Play, RotateCw, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";

interface AgentStep { id: string; type: "thought" | "action" | "observation" | "result"; content: string; timestamp: string; status: "pending" | "running" | "completed" | "failed"; }
interface AgentTask { id: string; title: string; description: string; status: "idle" | "planning" | "executing" | "completed" | "failed"; steps: AgentStep[]; createdAt: string; completedAt?: string; }
interface SystemStatus { cpu: number; memory: number; network: "online" | "offline"; threats: number; lastScan: string; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

const STEP_COLOR: Record<string, string> = { thought: "#aa44ff", action: "#4488ff", observation: "#ffaa44", result: "#44ff88" };
const STEP_LABEL: Record<string, string> = { thought: "تفكير", action: "تنفيذ", observation: "مراقبة", result: "نتيجة" };
const STATUS_COLOR: Record<string, string> = { idle: "#555", planning: "#4488ff", executing: "#ffaa44", completed: "#44ff88", failed: "#ff4444" };
const STATUS_LABEL: Record<string, string> = { idle: "IDLE", planning: "يخطط", executing: "ينفّذ", completed: "مكتمل", failed: "فشل" };

const QUICK = ["فحص المنافذ المفتوحة على localhost", "تحليل الثغرات الأمنية في النظام", "مراقبة الشبكة والاتصالات", "بحث عن CVEs حديثة", "فحص صحة النظام"];
const API = "/api";

export default function NovaAgentV3() {
  const [currentTask, setCurrentTask] = useState<AgentTask | null>(null);
  const [taskHistory, setTaskHistory] = useState<AgentTask[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({ cpu: 0, memory: 0, network: "online", threats: 0, lastScan: new Date().toISOString() });
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemStatus(prev => ({ ...prev, cpu: Math.min(99, 15 + Math.random() * 25), memory: Math.min(95, 35 + Math.random() * 30), network: navigator.onLine ? "online" : "offline", threats: Math.floor(Math.random() * 5) }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [currentTask?.steps]);

  const executeTask = async (taskDescription: string) => {
    setIsRunning(true);
    const newTask: AgentTask = { id: Date.now().toString(), title: taskDescription, description: `تنفيذ مهمة: ${taskDescription}`, status: "executing", steps: [], createdAt: new Date().toISOString() };
    setCurrentTask(newTask);
    try {
      const response = await fetch(`${API}/nova-agent-v3/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: taskDescription }) });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const reader = response.body?.getReader(); if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            setCurrentTask(prev => {
              if (!prev) return prev;
              const updatedSteps = [...prev.steps];
              if (["thought","action","observation","result","final","error"].includes(data.type)) {
                updatedSteps.push({ id: Math.random().toString(), type: data.type === "final" ? "result" : data.type === "error" ? "observation" : data.type, content: data.content, timestamp: new Date().toISOString(), status: data.type === "error" ? "failed" : "completed" });
              }
              return { ...prev, status: data.type === "final" ? "completed" : data.type === "error" ? "failed" : "executing", steps: updatedSteps };
            });
          } catch {}
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      setCurrentTask(prev => prev ? { ...prev, status: "failed", steps: [...prev.steps, { id: "error", type: "observation", content: `خطأ: ${msg}`, timestamp: new Date().toISOString(), status: "failed" }] } : null);
    } finally { setIsRunning(false); setInput(""); }
  };

  const handleExecute = () => { if (!input.trim() || isRunning) return; executeTask(input.trim()); };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ Nova Agent V3" subtitle="وكيل ذكي متقدم مع قدرات التفكير والتنفيذ الذاتي" icon={Bot} danger />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "CPU", value: `${systemStatus.cpu.toFixed(1)}%`, color: "#44eebb", rgb: "68,238,187", icon: Cpu },
          { label: "Memory", value: `${systemStatus.memory.toFixed(1)}%`, color: "#aa44ff", rgb: "170,68,255", icon: Activity },
          { label: "Network", value: systemStatus.network === "online" ? "ONLINE" : "OFFLINE", color: systemStatus.network === "online" ? "#44ff88" : "#ff4444", rgb: systemStatus.network === "online" ? "68,255,136" : "255,68,68", icon: Globe },
          { label: "Threats", value: systemStatus.threats, color: "#ffaa44", rgb: "255,170,68", icon: Shield },
        ].map(({ label, value, color, rgb, icon: Icon }) => (
          <div key={label} className="rounded-xl p-4" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.2)`, borderRadius: 16 }}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-3.5 h-3.5" style={{ color }} />
              <span className="text-[9px] font-mono uppercase" style={{ color: `rgba(${rgb},0.6)` }}>{label}</span>
            </div>
            <div className="font-black text-xl font-mono" style={{ color, textShadow: `0 0 10px rgba(${rgb},0.4)` }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Agent Control */}
      <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
        <h3 className="font-black text-sm" style={{ color: "#ff5555" }}>تحكم الوكيل</h3>
        <div className="flex gap-2">
          <input type="text" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleExecute()}
            placeholder="أدخل مهمة للوكيل الذكي..." style={inputStyle} disabled={isRunning} />
          <button onClick={handleExecute} disabled={isRunning || !input.trim()}
            className="flex items-center gap-2 px-5 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50"
            style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", whiteSpace: "nowrap" }}>
            {isRunning ? <><RotateCw className="w-3.5 h-3.5 animate-spin" />ينفّذ...</> : <><Play className="w-3.5 h-3.5" />تنفيذ</>}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK.map(q => (
            <button key={q} onClick={() => !isRunning && setInput(q)} disabled={isRunning}
              className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Current Task */}
      {currentTask && (
        <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className="w-5 h-5" style={{ color: STATUS_COLOR[currentTask.status] }} />
              <div>
                <h3 className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{currentTask.title}</h3>
                <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{currentTask.description}</p>
              </div>
            </div>
            <span className="font-black text-[10px] font-mono px-2 py-1 rounded-xl"
              style={{ color: STATUS_COLOR[currentTask.status], background: `${STATUS_COLOR[currentTask.status]}12`, border: `1px solid ${STATUS_COLOR[currentTask.status]}35` }}>
              {STATUS_LABEL[currentTask.status]}
            </span>
          </div>
          <div className="space-y-2">
            {currentTask.steps.map(step => {
              const color = STEP_COLOR[step.type] ?? "#888";
              return (
                <div key={step.id} className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: `${color}08`, border: `1px solid ${color}20`, borderRadius: 12 }}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-black font-mono uppercase" style={{ color }}>{STEP_LABEL[step.type]}</span>
                      <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{new Date(step.timestamp).toLocaleTimeString("ar-SA")}</span>
                    </div>
                    <p className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.65)" }}>{step.content}</p>
                  </div>
                  <div className="shrink-0">
                    {step.status === "running" && <RotateCw className="w-3.5 h-3.5 animate-spin" style={{ color: "#ffaa44" }} />}
                    {step.status === "completed" && <CheckCircle className="w-3.5 h-3.5" style={{ color: "#44ff88" }} />}
                    {step.status === "failed" && <AlertTriangle className="w-3.5 h-3.5" style={{ color: "#ff4444" }} />}
                  </div>
                </div>
              );
            })}
          </div>
          <div ref={endRef} />
        </div>
      )}

      {/* Task History */}
      {taskHistory.length > 0 && (
        <div className="rounded-2xl p-5 space-y-3" style={DARK}>
          <h3 className="font-black text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>سجل المهام</h3>
          {taskHistory.map(task => (
            <div key={task.id} className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div>
                <div className="font-black text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>{task.title}</div>
                <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{new Date(task.createdAt).toLocaleString("ar-EG")}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" style={{ color: "#44ff88" }} />
                <span className="text-[10px] font-black font-mono" style={{ color: "#44ff88" }}>مكتمل</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
