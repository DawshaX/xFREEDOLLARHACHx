import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Edit3,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest, sseStream } from "@/lib/sse";

interface AgentStep {
  id: number;
  taskId: number;
  orderIndex: number;
  title: string;
  description: string;
  status: string;
  output: string;
}

interface AgentTask {
  id: number;
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

interface AgentTaskWithSteps extends AgentTask {
  steps: AgentStep[];
}

interface ChatMsg {
  role: "user" | "agent";
  text: string;
  ts: number;
}

const QUICK_REPLIES = [
  { label: "كمل ✓", value: "كمل تنفيذ كل الخطوات الباقية بالترتيب" },
  { label: "وقف ✕", value: "stop" },
  { label: "أعد التخطيط 🔄", value: "replan" },
];

export default function Agent() {
  const [goal, setGoal] = useState("");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [active, setActive] = useState<AgentTaskWithSteps | null>(null);
  const [creating, setCreating] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [busyStep, setBusyStep] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", description: "" });
  const stopRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const pushChat = (role: ChatMsg["role"], text: string) => {
    setChat((arr) => [...arr, { role, text, ts: Date.now() }]);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const loadTasks = async () => {
    setTasks(await jsonRequest<AgentTask[]>("/agent/tasks"));
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const openTask = async (id: number) => {
    try {
      const t = await jsonRequest<AgentTaskWithSteps>(`/agent/tasks/${id}`);
      setActive(t);
      setChat([
        {
          role: "agent",
          text: `تم تحميل المهمة: ${t.title}\nعدد الخطوات: ${t.steps.length}`,
          ts: Date.now(),
        },
      ]);
    } catch {
      setActive(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;
    setCreating(true);
    pushChat("user", goal);
    try {
      const t = await jsonRequest<AgentTaskWithSteps>("/agent/tasks", {
        method: "POST",
        body: JSON.stringify({ goal }),
      });
      setActive(t);
      pushChat(
        "agent",
        `جهّزت لك خطة من ${t.steps.length} خطوات:\n${t.steps
          .map((s, i) => `${i + 1}. ${s.title}`)
          .join("\n")}\n\nقولّي "كمل" لتنفيذ الكل، أو وافق/تخطّى/عدّل كل خطوة لوحدها.`,
      );
      setGoal("");
      await loadTasks();
    } finally {
      setCreating(false);
    }
  };

  const refreshActive = async () => {
    if (!active) return;
    const t = await jsonRequest<AgentTaskWithSteps>(`/agent/tasks/${active.id}`);
    setActive(t);
    return t;
  };

  const runStep = async (stepId: number): Promise<boolean> => {
    if (!active) return false;
    setBusyStep(stepId);
    let success = false;
    let buf = "";
    try {
      await sseStream(
        `/agent/tasks/${active.id}/steps/${stepId}/run`,
        { method: "POST" },
        (e) => {
          const d = e.data as Record<string, unknown>;
          if (e.event === "step_started") {
            const title = String(d.title || "");
            pushChat("agent", `▶ بدأت خطوة: ${title}`);
          } else if (e.event === "step_delta") {
            buf += String(d.text || "");
            setActive((prev) =>
              prev
                ? {
                    ...prev,
                    steps: prev.steps.map((s) =>
                      s.id === stepId
                        ? { ...s, status: "running", output: buf }
                        : s,
                    ),
                  }
                : prev,
            );
          } else if (e.event === "step_completed") {
            success = true;
            pushChat("agent", "✓ تمّت الخطوة بنجاح");
          } else if (e.event === "task_completed") {
            pushChat("agent", "🎉 خلصت كل الخطوات. المهمة مكتملة 100%");
          } else if (e.event === "error") {
            pushChat("agent", `⚠ خطأ في الخطوة: ${String(d.error)}`);
          }
        },
      );
    } catch (e) {
      pushChat(
        "agent",
        `⚠ فشل التنفيذ: ${e instanceof Error ? e.message : "خطأ غير معروف"}`,
      );
    } finally {
      setBusyStep(null);
      await refreshActive();
    }
    return success;
  };

  const skipStep = async (stepId: number) => {
    if (!active) return;
    await jsonRequest(`/agent/tasks/${active.id}/steps/${stepId}/skip`, {
      method: "POST",
    });
    pushChat("agent", "⏭ تم التخطّي");
    await refreshActive();
  };

  const saveEdit = async () => {
    if (!active || editingStep === null) return;
    await jsonRequest(`/agent/tasks/${active.id}/steps/${editingStep}`, {
      method: "PATCH",
      body: JSON.stringify(editDraft),
    });
    pushChat("agent", "✏ تم تعديل الخطوة");
    setEditingStep(null);
    await refreshActive();
  };

  const replan = async (feedback?: string) => {
    if (!active) return;
    pushChat("agent", "🔄 جاري إعادة التخطيط...");
    const t = await jsonRequest<AgentTaskWithSteps>(
      `/agent/tasks/${active.id}/replan`,
      {
        method: "POST",
        body: JSON.stringify({ feedback: feedback || "" }),
      },
    );
    setActive(t);
    pushChat(
      "agent",
      `جاهز خطة جديدة بـ ${t.steps.filter((s) => s.status === "pending").length} خطوات قابلة للتنفيذ.`,
    );
  };

  const runAllRemaining = async () => {
    stopRef.current = false;
    if (!active) return;
    let task: AgentTaskWithSteps | null | undefined = active;
    while (!stopRef.current && task) {
      const next = task.steps.find((s) => s.status === "pending");
      if (!next) {
        pushChat("agent", "✓ لا توجد خطوات قيد الانتظار");
        break;
      }
      const ok = await runStep(next.id);
      if (!ok) {
        pushChat("agent", "🛑 توقفت بسبب فشل خطوة. عدّلها أو اطلب إعادة التخطيط.");
        break;
      }
      task = await refreshActive();
    }
    if (stopRef.current) pushChat("agent", "🛑 تم الإيقاف بطلبك");
  };

  const handleChatSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    pushChat("user", text);

    if (!active) {
      pushChat("agent", "اعمل مهمة الأول من الفورم فوق وبعدين كلّمني عنها.");
      return;
    }

    const t = text.toLowerCase();
    if (t === "stop" || /(وقف|إيقاف|توقف|stop)/.test(t)) {
      stopRef.current = true;
      pushChat("agent", "🛑 سأتوقف بعد الخطوة الحالية");
      return;
    }
    if (
      /(كمل|نفذ كل|run all|continue|complete)/i.test(t) &&
      !/(لا|don'?t|no )/i.test(t)
    ) {
      pushChat("agent", "تمام، هكمّل الخطوات الباقية.");
      await runAllRemaining();
      return;
    }
    if (t === "replan" || /(أعد|اعد).*خط|replan/i.test(t)) {
      await replan(text);
      return;
    }
    // Otherwise treat as feedback → replan with that feedback
    await replan(text);
  };

  const remove = async (id: number) => {
    await jsonRequest(`/agent/tasks/${id}`, { method: "DELETE" });
    if (active?.id === id) {
      setActive(null);
      setChat([]);
    }
    await loadTasks();
  };

  const stepsList = active?.steps ?? [];
  const completed = stepsList.filter((s) => s.status === "completed").length;
  const pendingCount = stepsList.filter((s) => s.status === "pending").length;
  const progress = stepsList.length
    ? Math.round((completed / stepsList.length) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI Agent v3 — تفاعلي"
        subtitle="خطّط، وافق/ارفض كل خطوة، أو خلّيه يكمّل لوحده"
        icon={Bot}
      />

      <form onSubmit={create} className="glow-card rounded-xl p-3 flex gap-3">
        <Sparkles className="w-5 h-5 text-primary shrink-0 mt-2.5" />
        <textarea
          data-testid="input-agent-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="صف الهدف بالتفصيل... سيقوم الوكيل بالتخطيط وعرضه عليك للموافقة"
          rows={2}
          className="flex-1 bg-input border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 resize-none"
        />
        <button
          type="submit"
          disabled={creating}
          data-testid="btn-create-task"
          className="px-5 bg-primary text-primary-foreground rounded-lg font-bold hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {creating ? "تخطيط..." : "أنشئ مهمة"}
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: tasks list */}
        <div className="lg:col-span-3 glow-card rounded-xl p-3 max-h-[75vh] overflow-y-auto">
          <h3 className="font-bold text-sm mb-3 px-2 neon-text">المهام</h3>
          {tasks.length === 0 && (
            <div className="text-center py-8 text-xs text-muted-foreground font-mono">
              لا مهام بعد
            </div>
          )}
          <div className="space-y-1.5" data-testid="agent-task-list">
            {tasks.map((t) => (
              <div
                key={t.id}
                onClick={() => openTask(t.id)}
                className={`group p-2.5 rounded-lg cursor-pointer border transition ${
                  active?.id === t.id
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/40 hover:border-primary/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-medium truncate flex-1">
                    {t.title}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(t.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <span
                  className={`mt-1 inline-block text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    t.status === "completed"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : t.status === "running"
                        ? "bg-amber-500/20 text-amber-300 animate-pulse"
                        : t.status === "failed"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-primary/20 text-primary"
                  }`}
                >
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Middle: steps */}
        <div className="lg:col-span-5 glow-card rounded-xl p-4 max-h-[75vh] overflow-y-auto">
          {active ? (
            <>
              <div className="flex items-start justify-between mb-3 gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold neon-text truncate">
                    {active.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {active.description}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <label className="flex items-center gap-1.5 text-[10px] font-mono cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoMode}
                      onChange={(e) => setAutoMode(e.target.checked)}
                      className="accent-primary"
                    />
                    وضع تلقائي
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => replan()}
                      className="px-2 py-1 text-[10px] bg-card border border-border/60 rounded hover:border-primary/60 flex items-center gap-1"
                      data-testid="btn-replan"
                    >
                      <RefreshCw className="w-3 h-3" /> أعد التخطيط
                    </button>
                    <button
                      onClick={runAllRemaining}
                      disabled={!pendingCount || busyStep !== null}
                      className="px-2 py-1 text-[10px] bg-primary/20 border border-primary/40 text-primary rounded hover:bg-primary/30 disabled:opacity-50 flex items-center gap-1"
                      data-testid="btn-run-all"
                    >
                      <Zap className="w-3 h-3" /> نفّذ الباقي ({pendingCount})
                    </button>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1 bg-border/40 rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-muted-foreground mb-3">
                {completed}/{stepsList.length} مكتمل · {progress}%
              </div>

              <div className="space-y-2.5" data-testid="agent-steps">
                {stepsList.map((s) => {
                  const isEditing = editingStep === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`border rounded-lg p-3 ${
                        s.status === "running"
                          ? "border-amber-500/50 bg-amber-500/5"
                          : s.status === "completed"
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : s.status === "skipped"
                              ? "border-muted bg-muted/10 opacity-60"
                              : s.status === "failed"
                                ? "border-red-500/40 bg-red-500/5"
                                : "border-border/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-bold shrink-0 ${
                            s.status === "completed"
                              ? "bg-emerald-500/30 text-emerald-300"
                              : s.status === "running"
                                ? "bg-amber-500/30 text-amber-300 animate-pulse"
                                : s.status === "skipped"
                                  ? "bg-muted text-muted-foreground"
                                  : s.status === "failed"
                                    ? "bg-red-500/30 text-red-300"
                                    : "bg-primary/20 text-primary"
                          }`}
                        >
                          {s.orderIndex + 1}
                        </div>
                        {isEditing ? (
                          <input
                            value={editDraft.title}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, title: e.target.value })
                            }
                            className="flex-1 text-xs bg-input border border-border/60 rounded px-2 py-1"
                          />
                        ) : (
                          <div className="font-bold text-xs flex-1 truncate">
                            {s.title}
                          </div>
                        )}
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                            s.status === "completed"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : s.status === "running"
                                ? "bg-amber-500/20 text-amber-300"
                                : s.status === "skipped"
                                  ? "bg-muted text-muted-foreground"
                                  : s.status === "failed"
                                    ? "bg-red-500/20 text-red-300"
                                    : "bg-primary/20 text-primary"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      {isEditing ? (
                        <textarea
                          value={editDraft.description}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              description: e.target.value,
                            })
                          }
                          rows={3}
                          className="w-full text-xs bg-input border border-border/60 rounded p-2 ms-8"
                        />
                      ) : (
                        <p className="text-[11px] text-muted-foreground mb-1.5 ps-8">
                          {s.description}
                        </p>
                      )}
                      {s.output && !isEditing && (
                        <pre className="bg-input/40 border border-border/40 rounded p-2 text-[10px] whitespace-pre-wrap font-mono overflow-x-auto ms-8 max-h-40 overflow-y-auto text-foreground/90">
                          {s.output}
                        </pre>
                      )}
                      {/* Action row */}
                      {s.status === "pending" && !isEditing && (
                        <div className="flex gap-1.5 mt-2 ms-8">
                          <button
                            onClick={() => runStep(s.id)}
                            disabled={busyStep !== null}
                            className="px-2 py-1 text-[10px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded hover:bg-emerald-500/30 disabled:opacity-50 flex items-center gap-1"
                            data-testid={`btn-run-step-${s.id}`}
                          >
                            <Play className="w-3 h-3" /> نفّذ
                          </button>
                          <button
                            onClick={() => skipStep(s.id)}
                            disabled={busyStep !== null}
                            className="px-2 py-1 text-[10px] bg-card border border-border/60 rounded hover:border-amber-500/60 disabled:opacity-50 flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> تخطّى
                          </button>
                          <button
                            onClick={() => {
                              setEditingStep(s.id);
                              setEditDraft({
                                title: s.title,
                                description: s.description,
                              });
                            }}
                            className="px-2 py-1 text-[10px] bg-card border border-border/60 rounded hover:border-primary/60 flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" /> عدّل
                          </button>
                        </div>
                      )}
                      {isEditing && (
                        <div className="flex gap-1.5 mt-2 ms-8">
                          <button
                            onClick={saveEdit}
                            className="px-2 py-1 text-[10px] bg-primary/20 border border-primary/40 text-primary rounded flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" /> حفظ
                          </button>
                          <button
                            onClick={() => setEditingStep(null)}
                            className="px-2 py-1 text-[10px] bg-card border border-border/60 rounded flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> إلغاء
                          </button>
                        </div>
                      )}
                      {s.status === "failed" && (
                        <div className="flex gap-1.5 mt-2 ms-8">
                          <button
                            onClick={() => runStep(s.id)}
                            className="px-2 py-1 text-[10px] bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> أعد المحاولة
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              <Bot className="w-12 h-12 mx-auto mb-3 text-primary/40" />
              <p className="font-mono text-sm">
                اختر مهمة من القائمة أو أنشئ مهمة جديدة
              </p>
            </div>
          )}
        </div>

        {/* Right: chat */}
        <div className="lg:col-span-4 glow-card rounded-xl p-3 max-h-[75vh] flex flex-col">
          <h3 className="font-bold text-sm mb-2 px-1 neon-text flex items-center gap-2">
            <Bot className="w-4 h-4" />
            محادثة الوكيل
          </h3>
          <div className="flex-1 overflow-y-auto space-y-2 mb-2">
            {chat.length === 0 && (
              <div className="text-center py-10 text-xs text-muted-foreground font-mono">
                ابدأ بإنشاء مهمة أو افتح واحدة قائمة، ثم كلّمني هنا.
              </div>
            )}
            {chat.map((m, i) => (
              <div
                key={i}
                className={`text-xs px-3 py-2 rounded-xl whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "ml-4 bg-primary/15 border border-primary/30"
                    : "mr-4 bg-card/60 border border-border/40 text-foreground"
                }`}
              >
                {m.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="flex gap-1 mb-2 flex-wrap">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q.label}
                onClick={() => setChatInput(q.value)}
                className="text-[10px] px-2 py-1 bg-card border border-border/60 rounded hover:border-primary/60"
              >
                {q.label}
              </button>
            ))}
          </div>
          <form onSubmit={handleChatSend} className="flex gap-1.5">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder='قولّي: "كمل" / "وقف" / "أعد التخطيط مع التركيز على ..."'
              className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary/60"
              data-testid="input-agent-chat"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="px-3 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          {autoMode && pendingCount > 0 && busyStep === null && (
            <button
              onClick={runAllRemaining}
              className="mt-2 text-[10px] px-2 py-1 bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 rounded flex items-center gap-1 justify-center"
            >
              <Zap className="w-3 h-3" /> الوضع التلقائي مفعّل — نفّذ كل الباقي
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
