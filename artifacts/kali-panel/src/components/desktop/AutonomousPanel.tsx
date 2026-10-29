/**
 * AutonomousPanel — مركز التحكم في الوضع الذاتي.
 * Nova تدير نفسها وتعمل حتى عندما لا تكون موجوداً.
 */
import { useState, useCallback, useEffect } from "react";
import { Bot, Play, Plus, Trash2, ToggleLeft, ToggleRight, Clock, CheckCircle2, AlertCircle, Activity, Zap, Shield, Brain, RefreshCw, ChevronDown, ChevronRight, Send } from "lucide-react";
import { useSystem, type SystemEvent } from "@/context/SystemContext";
import { jsonRequest } from "@/lib/sse";

const BASE = "/api";

interface CronTask {
  id: number;
  name: string;
  cronExpression: string;
  description: string;
  prompt: string;
  isEnabled: string;
  lastRunAt: string | null;
  lastStatus: string;
  runCount: number;
  createdAt: string;
}

const PRESET_TASKS = [
  { name: "مراقبة CVE اليومية", cron: "0 8 * * *", prompt: "ابحث عن أحدث 10 ثغرات CVE حرجة اليوم من NVD، لخصها، واحفظ الأهم في الذاكرة.", desc: "يجلب CVE الجديدة يومياً" },
  { name: "فحص صحة النظام", cron: "*/30 * * * *", prompt: "نفّذ فحص صحة النظام: تحقق من مساحة القرص والذاكرة والعمليات النشطة، وأبلّغ بأي مشكلة.", desc: "كل 30 دقيقة" },
  { name: "تنظيف الذاكرة القديمة", cron: "0 3 * * *", prompt: "راجع الذاكرة المحفوظة، احذف المعلومات القديمة أو المكررة، وأبقِ على الأهم.", desc: "تنظيف يومي الساعة 3 صباحاً" },
  { name: "تقرير أمني أسبوعي", cron: "0 9 * * 1", prompt: "أعدّ تقريراً أمنياً أسبوعياً: أبرز الثغرات المكتشفة، الفحوصات المنجزة، التوصيات.", desc: "كل إثنين الساعة 9 صباحاً" },
];

export function AutonomousPanel() {
  const { autonomousStatus, systemEvents, enableAutonomous, disableAutonomous, runAutonomousTask, refreshAll } = useSystem();
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [quickPrompt, setQuickPrompt] = useState("");
  const [runningQuick, setRunningQuick] = useState(false);
  const [newTask, setNewTask] = useState({ name: "", cron: "*/60 * * * *", prompt: "", description: "" });
  const [expandedEvents, setExpandedEvents] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await jsonRequest<CronTask[]>("/autonomous/tasks");
      setTasks(rows || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const toggleDaemon = async () => {
    if (autonomousStatus?.enabled) await disableAutonomous();
    else await enableAutonomous();
    refreshAll();
  };

  const toggleTask = async (id: number) => {
    try {
      await fetch(`${BASE}/autonomous/tasks/${id}/toggle`, { method: "PATCH", headers: { "Content-Type": "application/json" } });
      await loadTasks();
    } catch {}
  };

  const deleteTask = async (id: number) => {
    try {
      await fetch(`${BASE}/autonomous/tasks/${id}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {}
  };

  const addTask = async () => {
    if (!newTask.name || !newTask.prompt) return;
    try {
      await fetch(`${BASE}/autonomous/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTask.name, cronExpression: newTask.cron, prompt: newTask.prompt, description: newTask.description }),
      });
      setNewTask({ name: "", cron: "*/60 * * * *", prompt: "", description: "" });
      setShowAddTask(false);
      await loadTasks();
    } catch {}
  };

  const addPreset = async (p: (typeof PRESET_TASKS)[0]) => {
    await fetch(`${BASE}/autonomous/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: p.name, cronExpression: p.cron, prompt: p.prompt, description: p.desc }),
    });
    await loadTasks();
  };

  const runQuick = async () => {
    if (!quickPrompt.trim()) return;
    setRunningQuick(true);
    await runAutonomousTask(quickPrompt);
    setQuickPrompt("");
    setRunningQuick(false);
  };

  const recentEvents = systemEvents.slice(0, expandedEvents ? 30 : 8);

  const eventIcon = (type: string) => {
    if (type === "task_done") return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
    if (type === "task_error") return <AlertCircle className="w-3 h-3 text-red-400" />;
    if (type === "task_started") return <Activity className="w-3 h-3 text-blue-400 animate-pulse" />;
    if (type === "memory_saved") return <Brain className="w-3 h-3 text-purple-400" />;
    return <Zap className="w-3 h-3 text-slate-400" />;
  };

  return (
    <div className="flex flex-col h-full bg-black/90 text-white overflow-auto" dir="rtl" style={{ fontFamily: "monospace" }}>

      {/* Header */}
      <div className="px-4 py-3 border-b border-emerald-500/20 bg-black/60">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${autonomousStatus?.enabled ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-slate-500/10 border border-slate-500/20"}`}>
            <Bot className={`w-5 h-5 ${autonomousStatus?.enabled ? "text-emerald-400" : "text-slate-500"}`} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Nova Autonomous Daemon</div>
            <div className="text-[10px] text-slate-500">
              {autonomousStatus?.enabled ? "🟢 يعمل ويراقب النظام" : "⚫ في وضع الاستعداد"}
              {autonomousStatus?.tasksCompleted ? ` · ${autonomousStatus.tasksCompleted} مهمة منجزة` : ""}
            </div>
          </div>
          <button
            onClick={toggleDaemon}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${autonomousStatus?.enabled ? "bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30" : "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"}`}
          >
            {autonomousStatus?.enabled ? <><ToggleRight className="w-4 h-4" /> إيقاف</> : <><ToggleLeft className="w-4 h-4" /> تفعيل</>}
          </button>
        </div>

        {/* Stats row */}
        {autonomousStatus && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              { label: "منجزة", value: autonomousStatus.tasksCompleted, color: "text-emerald-300" },
              { label: "أخطاء", value: autonomousStatus.tasksErrored, color: "text-red-300" },
              { label: "مهام", value: tasks.length, color: "text-cyan-300" },
            ].map((s) => (
              <div key={s.label} className="bg-white/3 rounded border border-white/5 p-2 text-center">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[9px] text-slate-600">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Run */}
      <div className="px-3 py-2 border-b border-white/5">
        <div className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-500" /> تشغيل سريع</div>
        <div className="flex gap-2">
          <input
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runQuick()}
            placeholder='مثلاً: "افحص أحدث CVE وأبلّغني"'
            className="flex-1 bg-black/40 border border-emerald-500/20 rounded px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
          />
          <button
            onClick={() => void runQuick()}
            disabled={runningQuick || !quickPrompt.trim()}
            className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded text-xs hover:bg-emerald-500/30 disabled:opacity-40 transition-all flex items-center gap-1"
          >
            {runningQuick ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Scheduled Tasks */}
      <div className="px-3 py-2 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3 text-blue-400" /> المهام المجدولة ({tasks.length})</div>
          <button onClick={() => setShowAddTask(!showAddTask)} className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
            <Plus className="w-3 h-3" /> إضافة
          </button>
        </div>

        {showAddTask && (
          <div className="mb-3 bg-white/3 border border-emerald-500/20 rounded-lg p-3 space-y-2">
            <div className="text-[10px] text-slate-400 font-bold mb-2">مهمة جديدة</div>
            <input value={newTask.name} onChange={(e) => setNewTask((p) => ({ ...p, name: e.target.value }))} placeholder="الاسم" className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs outline-none" />
            <input value={newTask.cron} onChange={(e) => setNewTask((p) => ({ ...p, cron: e.target.value }))} placeholder="Cron (*/60 * * * *)" className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs outline-none font-mono" />
            <textarea value={newTask.prompt} onChange={(e) => setNewTask((p) => ({ ...p, prompt: e.target.value }))} placeholder="ماذا تريد من Nova أن تفعل؟" rows={2} className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => void addTask()} className="flex-1 py-1 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded text-xs hover:bg-emerald-500/30">
                إضافة المهمة
              </button>
              <button onClick={() => setShowAddTask(false)} className="px-3 py-1 bg-white/5 border border-white/10 text-slate-400 rounded text-xs hover:bg-white/10">
                إلغاء
              </button>
            </div>
            {/* Presets */}
            <div className="pt-1 border-t border-white/5">
              <div className="text-[9px] text-slate-500 mb-1">قوالب جاهزة:</div>
              <div className="grid grid-cols-2 gap-1">
                {PRESET_TASKS.map((p) => (
                  <button key={p.name} onClick={() => void addPreset(p)} className="text-[9px] text-left p-1.5 bg-black/30 border border-white/5 rounded hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all text-slate-400 hover:text-emerald-300">
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {tasks.length === 0 && (
            <div className="text-[11px] text-slate-600 text-center py-4">لا توجد مهام مجدولة</div>
          )}
          {tasks.map((task) => (
            <div key={task.id} className={`flex items-start gap-2 p-2 rounded border transition-all ${task.isEnabled === "true" ? "bg-emerald-500/5 border-emerald-500/15" : "bg-white/3 border-white/5 opacity-60"}`}>
              <button onClick={() => void toggleTask(task.id)} className="mt-0.5 shrink-0">
                {task.isEnabled === "true"
                  ? <ToggleRight className="w-4 h-4 text-emerald-400" />
                  : <ToggleLeft className="w-4 h-4 text-slate-600" />
                }
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-white">{task.name}</div>
                <div className="text-[9px] text-slate-500 flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-cyan-500/70">{task.cronExpression}</span>
                  {task.runCount > 0 && <span>· {task.runCount} مرة</span>}
                  {task.lastStatus && <span className={task.lastStatus === "ok" ? "text-emerald-500" : "text-red-400"}>· {task.lastStatus}</span>}
                </div>
              </div>
              <button onClick={() => void deleteTask(task.id)} className="text-red-400/40 hover:text-red-400 p-0.5">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Events Log */}
      <div className="flex-1 overflow-hidden flex flex-col px-3 py-2">
        <button
          onClick={() => setExpandedEvents(!expandedEvents)}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 mb-2"
        >
          {expandedEvents ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          سجل الأحداث ({systemEvents.length})
        </button>
        <div className="flex-1 overflow-auto space-y-1">
          {systemEvents.length === 0 && (
            <div className="text-[11px] text-slate-600 text-center py-4">لا توجد أحداث بعد</div>
          )}
          {recentEvents.map((ev: SystemEvent, i: number) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] text-slate-400">
              {eventIcon(ev.type)}
              <span className="text-slate-600 shrink-0">{new Date(ev.ts).toLocaleTimeString("ar-SA")}</span>
              <span className="truncate">
                {ev.type === "memory_saved" ? `حفظ ذاكرة: ${(ev.data as any)?.key || ""}` :
                 ev.type === "task_started" ? `بدأت مهمة: ${(ev.data as any)?.prompt || ""}` :
                 ev.type === "task_done" ? "مهمة مكتملة ✓" :
                 ev.type === "task_error" ? `خطأ: ${(ev.data as any)?.error || ""}` :
                 ev.type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
