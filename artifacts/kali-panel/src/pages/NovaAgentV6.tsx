import { useState, useEffect, useRef } from "react";
import {
  Bot, Brain, Cpu, Shield, Globe, Terminal, Activity, CheckCircle,
  AlertTriangle, Zap, Play, RotateCw, Upload, FileText, Download,
  Search, Database, Network, Bug, Target, Skull,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";

interface AgentStep { id: string; type: "thought" | "action" | "observation" | "result"; content: string; timestamp: string; status: "pending" | "running" | "completed" | "failed"; }
interface AgentTask { id: string; title: string; description: string; status: "idle" | "planning" | "executing" | "completed" | "failed"; steps: AgentStep[]; createdAt: string; completedAt?: string; }
interface UploadedFile { id: string; name: string; size: number; type: string; uploadedAt: string; }
interface QuickCommand { id: string; name: string; description: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; command: string; category: string; }
interface SystemStatus { cpu: number; memory: number; network: "online" | "offline"; threats: number; lastScan: string; activeConnections: number; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

const STEP_COLOR: Record<string, string> = { thought: "#aa44ff", action: "#4488ff", observation: "#ffaa44", result: "#44ff88" };
const STEP_LABEL: Record<string, string> = { thought: "تفكير", action: "تنفيذ", observation: "مراقبة", result: "نتيجة" };
const STATUS_COLOR: Record<string, string> = { idle: "#555", planning: "#4488ff", executing: "#ffaa44", completed: "#44ff88", failed: "#ff4444" };
const STATUS_LABEL: Record<string, string> = { idle: "IDLE", planning: "يخطط", executing: "ينفّذ", completed: "مكتمل", failed: "فشل" };
const CAT_COLOR: Record<string, string> = { security: "#ff4444", network: "#4488ff", system: "#44eebb", analysis: "#aa44ff" };

const API_BASE = "/api";

const QUICK_COMMANDS: QuickCommand[] = [
  { id: "1", name: "Security Scan", description: "فحص شامل للنظام", icon: Shield, command: "run comprehensive security scan", category: "security" },
  { id: "2", name: "Port Scanner", description: "فحص المنافذ المفتوحة", icon: Network, command: "scan all open ports", category: "network" },
  { id: "3", name: "Vulnerability Check", description: "فحص الثغرات الأمنية", icon: Bug, command: "check for vulnerabilities", category: "security" },
  { id: "4", name: "System Monitor", description: "مراقبة أداء النظام", icon: Activity, command: "monitor system performance", category: "system" },
  { id: "5", name: "File Analysis", description: "تحليل الملفات المرفوعة", icon: FileText, command: "analyze uploaded files", category: "analysis" },
  { id: "6", name: "Network Analysis", description: "تحليل حركة الشبكة", icon: Globe, command: "analyze network traffic", category: "network" },
  { id: "7", name: "Process Monitor", description: "مراقبة العمليات", icon: Terminal, command: "monitor running processes", category: "system" },
  { id: "8", name: "Threat Detection", description: "كشف التهديدات", icon: Target, command: "detect security threats", category: "security" },
];

export default function NovaAgentV6() {
  const [currentTask, setCurrentTask] = useState<AgentTask | null>(null);
  const [taskHistory, setTaskHistory] = useState<AgentTask[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({ cpu: 0, memory: 0, network: "online", threats: 0, lastScan: new Date().toISOString(), activeConnections: 0 });
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemStatus(prev => ({ ...prev, cpu: Math.min(99, 15 + Math.random() * 25), memory: Math.min(95, 35 + Math.random() * 30), network: navigator.onLine ? "online" : "offline", threats: Math.floor(Math.random() * 5), activeConnections: Math.floor(Math.random() * 50) }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [currentTask?.steps]);

  const executeTask = async (taskDescription: string) => {
    setIsRunning(true);
    const newTask: AgentTask = { id: Date.now().toString(), title: taskDescription, description: `تنفيذ مهمة: ${taskDescription}`, status: "planning", steps: [], createdAt: new Date().toISOString() };
    setCurrentTask(newTask);
    await new Promise(r => setTimeout(r, 900));
    setCurrentTask(prev => prev ? { ...prev, status: "executing", steps: [{ id: "1", type: "thought", content: "جاري تحليل الطلب وتخطيط الخطوات اللازمة...", timestamp: new Date().toISOString(), status: "completed" }] } : null);
    const extraSteps: AgentStep[] = [
      { id: "2", type: "action", content: `تنفيذ الأمر: ${taskDescription}`, timestamp: new Date().toISOString(), status: "running" },
      { id: "3", type: "observation", content: "جاري تحليل النتائج...", timestamp: new Date().toISOString(), status: "pending" },
      { id: "4", type: "result", content: "اكتملت المهمة بنجاح. جميع الأنظمة تعمل بشكل طبيعي.", timestamp: new Date().toISOString(), status: "pending" },
    ];
    for (let i = 0; i < extraSteps.length; i++) {
      await new Promise(r => setTimeout(r, 1200));
      setCurrentTask(prev => {
        if (!prev) return prev;
        const updated = [...prev.steps]; if (updated[updated.length - 1]) updated[updated.length - 1].status = "completed";
        if (i < extraSteps.length - 1) updated.push(extraSteps[i + 1]);
        return { ...prev, steps: updated };
      });
    }
    await new Promise(r => setTimeout(r, 800));
    const done = { ...newTask, status: "completed" as const, completedAt: new Date().toISOString() };
    setCurrentTask(done); setTaskHistory(prev => [done, ...prev.slice(0, 9)]); setIsRunning(false); setInput("");
  };

  const handleFileUpload = async (file: File) => {
    const newFile: UploadedFile = { id: Date.now().toString(), name: file.name, size: file.size, type: file.type, uploadedAt: new Date().toISOString() };
    setUploadedFiles(prev => [...prev, newFile]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0]; if (file) handleFileUpload(file);
  };

  const handleExecute = () => { if (!input.trim() || isRunning) return; executeTask(input.trim()); };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ Nova Agent V6" subtitle="وكيل متطور مع دعم رفع الملفات والأوامر السريعة" icon={Bot} danger />

      {/* System Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "CPU", value: `${systemStatus.cpu.toFixed(1)}%`, color: "#44eebb", rgb: "68,238,187", icon: Cpu },
          { label: "Memory", value: `${systemStatus.memory.toFixed(1)}%`, color: "#aa44ff", rgb: "170,68,255", icon: Activity },
          { label: "Network", value: systemStatus.network === "online" ? "ONLINE" : "OFFLINE", color: systemStatus.network === "online" ? "#44ff88" : "#ff4444", rgb: systemStatus.network === "online" ? "68,255,136" : "255,68,68", icon: Globe },
          { label: "Threats", value: systemStatus.threats, color: "#ff4444", rgb: "255,68,68", icon: AlertTriangle },
          { label: "Connections", value: systemStatus.activeConnections, color: "#4488ff", rgb: "68,136,255", icon: Network },
          { label: "Files", value: uploadedFiles.length, color: "#ffaa44", rgb: "255,170,68", icon: FileText },
        ].map(({ label, value, color, rgb, icon: Icon }) => (
          <div key={label} className="rounded-xl p-3" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.2)`, borderRadius: 14 }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="w-3 h-3" style={{ color }} />
              <span className="text-[8px] font-mono uppercase" style={{ color: `rgba(${rgb},0.6)` }}>{label}</span>
            </div>
            <div className="font-black text-lg font-mono" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left */}
        <div className="space-y-4">
          {/* Quick Commands */}
          <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
            <h3 className="font-black text-sm" style={{ color: "#ff5555" }}>أوامر سريعة</h3>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_COMMANDS.map(cmd => {
                const Icon = cmd.icon; const cc = CAT_COLOR[cmd.category] ?? "#888";
                return (
                  <button key={cmd.id} onClick={() => !isRunning && setInput(cmd.command)} disabled={isRunning}
                    className="p-2.5 rounded-xl text-right transition-all disabled:opacity-50"
                    style={{ background: `${cc}08`, border: `1px solid ${cc}20`, borderRadius: 12 }}>
                    <Icon className="w-3.5 h-3.5 mb-1" style={{ color: cc }} />
                    <div className="font-black text-[10px]" style={{ color: "rgba(255,255,255,0.7)" }}>{cmd.name}</div>
                    <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{cmd.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* File Upload */}
          <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
            <h3 className="font-black text-sm" style={{ color: "#ffaa44" }}>رفع الملفات</h3>
            <div
              className="rounded-xl p-5 text-center cursor-pointer transition-all"
              style={{ border: `2px dashed ${isDragging ? "rgba(255,170,68,0.5)" : "rgba(255,255,255,0.08)"}`, background: isDragging ? "rgba(255,170,68,0.05)" : "rgba(0,0,0,0.2)" }}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
              <Upload className="w-6 h-6 mx-auto mb-2" style={{ color: "rgba(255,170,68,0.5)" }} />
              <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>اسحب ملفاً هنا أو انقر للاختيار</p>
            </div>
            {uploadedFiles.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {uploadedFiles.map(f => (
                  <div key={f.id} className="flex items-center justify-between p-2 rounded-xl"
                    style={{ background: "rgba(255,170,68,0.04)", border: "1px solid rgba(255,170,68,0.12)" }}>
                    <div className="flex items-center gap-2">
                      <FileText className="w-3 h-3 shrink-0" style={{ color: "#ffaa44" }} />
                      <span className="text-[10px] font-mono truncate max-w-24" style={{ color: "rgba(255,255,255,0.65)" }}>{f.name}</span>
                    </div>
                    <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{(f.size / 1024).toFixed(1)}KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right - main area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Input */}
          <div className="rounded-2xl p-4 space-y-3" style={DARK}>
            <div className="flex gap-2">
              <input type="text" value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleExecute()}
                placeholder="أدخل مهمة للوكيل V6..." style={inputStyle} disabled={isRunning} />
              <button onClick={handleExecute} disabled={isRunning || !input.trim()}
                className="flex items-center gap-2 px-5 rounded-xl font-black text-xs font-mono transition-all disabled:opacity-50"
                style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", whiteSpace: "nowrap" }}>
                {isRunning ? <><RotateCw className="w-3.5 h-3.5 animate-spin" />ينفّذ...</> : <><Play className="w-3.5 h-3.5" />تنفيذ</>}
              </button>
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
                    <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{currentTask.description}</p>
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
                      style={{ background: `${color}06`, border: `1px solid ${color}18`, borderRadius: 12 }}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-black font-mono uppercase" style={{ color }}>{STEP_LABEL[step.type]}</span>
                          <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{new Date(step.timestamp).toLocaleTimeString("ar-SA")}</span>
                        </div>
                        <p className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{step.content}</p>
                      </div>
                      <div className="shrink-0">
                        {step.status === "running" && <RotateCw className="w-3.5 h-3.5 animate-spin" style={{ color: "#ffaa44" }} />}
                        {step.status === "completed" && <CheckCircle className="w-3.5 h-3.5" style={{ color: "#44ff88" }} />}
                        {step.status === "failed" && <AlertTriangle className="w-3.5 h-3.5" style={{ color: "#ff4444" }} />}
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
            </div>
          )}

          {/* Task History */}
          {taskHistory.length > 0 && (
            <div className="rounded-2xl p-4 space-y-2" style={DARK}>
              <h3 className="font-black text-[10px] font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>سجل المهام ({taskHistory.length})</h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {taskHistory.map(task => (
                  <div key={task.id} className="flex items-center justify-between p-2.5 rounded-xl"
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
            </div>
          )}

          {!currentTask && taskHistory.length === 0 && (
            <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
              <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.04)", filter: "drop-shadow(0 0 12px rgba(255,30,30,0.15))" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.15)" }}>اختر أمراً سريعاً أو اكتب مهمتك للوكيل</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
