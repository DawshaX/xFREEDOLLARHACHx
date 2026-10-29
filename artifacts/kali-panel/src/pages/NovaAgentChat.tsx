/**
 * NovaAgentChat — Advanced AI Agent with:
 *  • Thinking phase: streams reasoning before answering
 *  • Planning mode: structured steps with real-time tracking + editing
 *  • Session history sidebar: load past conversations
 *  • Learning/memory: auto-saves insights after sessions
 *  • Browser-direct Ollama streaming + server-side tool execution
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Bot, Send, Plus, Trash2, History, Zap, Shield, Globe, ScanLine,
  Terminal, Search, Brain, Wifi, WifiOff, Settings, Loader2, X,
  CheckCircle2, ChevronDown, ChevronRight, Skull, Activity, Bug,
  ListChecks, Pencil, Play, RefreshCw, BookOpen, Sparkles, AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import {
  streamOllamaViaServer,
  getStoredOllamaBase,
  getStoredOllamaModel,
  saveOllamaSettings,
  type OllamaMessage,
} from "@/lib/ollama-browser";

const API_BASE = "/api";

async function apiFetch(path: string, opts?: RequestInit) {
  const r = await fetch(`${API_BASE}${path}`, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

/* ───────────────────────── Types ───────────────────────── */

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredMessage {
  id: string;
  role: string;
  content: string;
  toolName?: string | null;
  createdAt: string;
}

interface PlanStep {
  id: string;
  text: string;
  status: "pending" | "running" | "done" | "error";
}

interface ChatLine {
  id: string;
  kind: "user" | "assistant" | "thinking" | "plan" | "tool" | "tool_result" | "system";
  text: string;
  planSteps?: PlanStep[];
  toolName?: string;
  isError?: boolean;
  collapsed?: boolean;
}

/* ───────────────────────── Constants ───────────────────────── */

const QUICK_ACTIONS = [
  { label: "Recon", icon: Globe, color: "text-cyan-400", prompt: "ابدأ recon كامل على الهدف: " },
  { label: "CVE", icon: Shield, color: "text-red-400", prompt: "ابحث عن ثغرات حرجة في: " },
  { label: "Scan", icon: ScanLine, color: "text-purple-400", prompt: "افحص الهدف: " },
  { label: "Exploit", icon: Bug, color: "text-yellow-400", prompt: "ابحث في Exploit-DB عن: " },
  { label: "Terminal", icon: Terminal, color: "text-green-400", prompt: "نفّذ الأمر: " },
  { label: "OSINT", icon: Activity, color: "text-blue-400", prompt: "اجمع معلومات OSINT عن: " },
  { label: "Pentest", icon: Skull, color: "text-rose-400", prompt: "نفّذ pentest كامل على: " },
  { label: "ذاكرة", icon: Brain, color: "text-violet-400", prompt: "استعرض ذاكرتك وما تعلّمته: " },
];

const PLAN_TRIGGERS = [
  "recon", "pentest", "بنتست", "استطلاع", "فحص كامل", "exploit", "scan",
  "فحص شامل", "تحليل شامل", "osint", "ابحث في كل", "نفّذ", "هجوم",
];

const THINK_SYS = `أنت NovaAgent. فكّر بصوت عالٍ وباختصار شديد (أقل من 80 كلمة) عن أفضل نهج لحل هذه المهمة الأمنية. لا تجب على السؤال — فقط التفكير والنهج.`;

const PLAN_SYS = `أنت NovaAgent. اكتب خطة مرقمة (3-6 خطوات) لتنفيذ هذه المهمة الأمنية.
الشكل المطلوب الدقيق:
1. [الخطوة]
2. [الخطوة]
لا تضف شرحاً إضافياً — فقط الخطوات المرقمة.`;

const NOVA_SYS = `أنت "NovaAgent" — وكيل ذكاء اصطناعي متخصص في الأمن السيبراني داخل منصة CyberNova.

🎯 منهجيتك:
- اقرأ السؤال بعناية ثم نفّذ الأدوات المناسبة واحدة تلو الأخرى
- أجب دائماً بالعربية الفصحى مع مصطلحات إنجليزية تقنية بين قوسين
- استخدم Markdown مع code blocks وbash highlighting

🛡️ أدواتك المتاحة:
• فحص الأهداف: scan_target, scan_ports, scan_dns, scan_ssl, scan_headers
• البحث عن الثغرات: nvd_search, cisa_kev, epss_score, exploit_db_search
• الاستخبارات: github_search, github_advisories, fetch_url, web_search
• النظام: run_shell, read_workspace_file, list_workspace_files
• الذاكرة: memory_save, memory_search

التزم بالأخلاق المهنية — لا تساعد على اختراق بدون إذن صريح.`;

/* ───────────────────────── Helpers ───────────────────────── */

function needsPlan(text: string) {
  const lower = text.toLowerCase();
  return PLAN_TRIGGERS.some(kw => lower.includes(kw));
}

function parsePlanSteps(text: string): PlanStep[] {
  const lines = text.split("\n").filter(l => /^\d+[\.\)]\s/.test(l.trim()));
  return lines.slice(0, 8).map((l, i) => ({
    id: `step-${i}-${Date.now()}`,
    text: l.replace(/^\d+[\.\)]\s*/, "").trim(),
    status: "pending" as const,
  }));
}

/* ───────────────────────── Sub-components ───────────────────────── */

function ThinkingBlock({
  text, done, collapsed, onToggle,
}: { text: string; done: boolean; collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "rgba(70,0,180,0.07)", border: "1px solid rgba(100,0,255,0.22)" }}>
      <button onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 transition-all hover:bg-white/5 text-left">
        <div className={`w-2 h-2 rounded-full shrink-0 ${done ? "bg-purple-400" : "bg-purple-400 animate-pulse"}`} />
        <span className="text-[9px] font-black font-mono uppercase tracking-widest" style={{ color: "#9966ff" }}>
          {done ? "✓ التفكير" : "🧠 يفكّر..."}
        </span>
        {!done && (
          <span className="flex gap-0.5 ml-1">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-1 h-1 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${collapsed ? "-rotate-90" : ""}`} style={{ color: "rgba(150,100,255,0.5)" }} />
      </button>
      {!collapsed && (
        <div className="px-4 pb-3">
          <div className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap" style={{ color: "rgba(200,150,255,0.72)" }}>
            {text || <span className="animate-pulse">▍</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanBlock({
  steps, onEdit, onRerun,
}: { steps: PlanStep[]; onEdit: (steps: PlanStep[]) => void; onRerun?: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const done = steps.filter(s => s.status === "done").length;
  const total = steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const running = steps.find(s => s.status === "running");

  const commitEdit = (id: string) => {
    onEdit(steps.map(s => s.id === id ? { ...s, text: editText } : s));
    setEditingId(null);
  };

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "rgba(0,40,100,0.1)", border: "1px solid rgba(0,140,255,0.22)" }}>
      <div className="px-3 py-2 flex items-center gap-2 border-b border-white/5">
        <ListChecks className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-[9px] font-black font-mono uppercase tracking-widest text-cyan-400">خطة التنفيذ</span>
        {running && (
          <span className="text-[8px] font-mono text-cyan-300/60 animate-pulse ml-1">جارٍ التنفيذ...</span>
        )}
        <span className="ml-auto text-[9px] font-mono text-white/30">{pct}%</span>
        {onRerun && pct === 100 && (
          <button onClick={onRerun} className="ml-1 text-white/30 hover:text-cyan-400 transition-all" title="إعادة التنفيذ">
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="h-0.5 bg-white/5">
        <div className="h-full bg-gradient-to-r from-cyan-600 to-blue-500 transition-all duration-700"
          style={{ width: `${pct}%` }} />
      </div>
      <div className="px-3 py-2.5 space-y-2">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-start gap-2">
            <div className="shrink-0 mt-0.5 w-4 flex justify-center">
              {step.status === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              {step.status === "running" && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
              {step.status === "pending" && (
                <div className="w-3.5 h-3.5 rounded-full border border-white/20 flex items-center justify-center">
                  <span className="text-[7px] text-white/30">{i + 1}</span>
                </div>
              )}
              {step.status === "error" && <X className="w-3.5 h-3.5 text-red-400" />}
            </div>

            {editingId === step.id ? (
              <div className="flex-1 flex gap-1">
                <input
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") commitEdit(step.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                  className="flex-1 rounded px-2 py-0.5 text-[10px] font-mono focus:outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(0,150,255,0.3)", color: "#ccddff" }}
                />
                <button onClick={() => commitEdit(step.id)} className="text-[9px] font-mono text-cyan-400 hover:text-cyan-300">✓</button>
                <button onClick={() => setEditingId(null)} className="text-[9px] font-mono text-white/30">✕</button>
              </div>
            ) : (
              <div className="flex-1 flex items-start gap-1 group">
                <span
                  className="flex-1 text-[10px] font-mono leading-relaxed cursor-default"
                  style={{
                    color: step.status === "done" ? "rgba(255,255,255,0.35)" : step.status === "running" ? "#44ccff" : "rgba(255,255,255,0.72)",
                    textDecoration: step.status === "done" ? "line-through" : "none",
                  }}>
                  {step.text}
                </span>
                {step.status === "pending" && (
                  <button
                    onClick={() => { setEditingId(step.id); setEditText(step.text); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="تعديل">
                    <Pencil className="w-2.5 h-2.5 text-white/30 hover:text-cyan-400" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <div className="text-[8px] font-mono text-white/20 pt-0.5">مرّر على الخطوة للتعديل • حدّث الخطة قبل التنفيذ</div>
      </div>
    </div>
  );
}

function SessionSidebar({
  sessions, activeId, onSelect, onNew, onDelete, loading,
}: {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col h-full" style={{ width: 220, borderRight: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="px-3 py-2.5 flex items-center gap-2 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <History className="w-3.5 h-3.5" style={{ color: "rgba(170,100,255,0.6)" }} />
        <span className="text-[9px] font-black font-mono uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
          الجلسات
        </span>
        <button onClick={onNew}
          className="ml-auto p-1 rounded-lg transition-all hover:bg-white/10"
          style={{ color: "rgba(170,100,255,0.7)" }}
          title="جلسة جديدة">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "rgba(255,255,255,0.2)" }} />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 px-3">
            <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد جلسات</span>
          </div>
        ) : (
          sessions.map(s => (
            <div key={s.id}
              onClick={() => onSelect(s.id)}
              className="group mx-1.5 my-0.5 px-2.5 py-2 rounded-lg cursor-pointer flex items-center gap-2 transition-all"
              style={{
                background: s.id === activeId ? "rgba(100,0,255,0.12)" : "transparent",
                border: `1px solid ${s.id === activeId ? "rgba(100,0,255,0.3)" : "transparent"}`,
              }}>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono truncate"
                  style={{ color: s.id === activeId ? "#aa66ff" : "rgba(255,255,255,0.55)" }}>
                  {s.title}
                </div>
                <div className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {new Date(s.createdAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                className="opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded hover:text-red-400"
                style={{ color: "rgba(255,255,255,0.25)" }}>
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Render message lines ───────────────────────── */

function MessageLine({
  line, model, onToggleCollapse, onEditPlan,
}: {
  line: ChatLine;
  model: string;
  onToggleCollapse: (id: string) => void;
  onEditPlan: (id: string, steps: PlanStep[]) => void;
}) {
  if (line.kind === "thinking") {
    return (
      <ThinkingBlock
        text={line.text}
        done={!!line.collapsed || (line.text.length > 5 && !line.text.endsWith("▍"))}
        collapsed={!!line.collapsed}
        onToggle={() => onToggleCollapse(line.id)}
      />
    );
  }

  if (line.kind === "plan" && line.planSteps) {
    return (
      <PlanBlock
        steps={line.planSteps}
        onEdit={steps => onEditPlan(line.id, steps)}
      />
    );
  }

  if (line.kind === "tool") {
    return (
      <div className="rounded-lg px-3 py-2"
        style={{ background: "rgba(255,140,0,0.07)", border: "1px solid rgba(255,140,0,0.2)" }}>
        <div className="text-[8px] font-black font-mono uppercase text-orange-400/60 mb-1">▶ أداة</div>
        <div className="text-[10px] font-mono text-orange-300/80">{line.text}</div>
      </div>
    );
  }

  if (line.kind === "tool_result") {
    return (
      <div className="rounded-lg px-3 py-2 max-h-40 overflow-y-auto"
        style={{
          background: line.isError ? "rgba(255,0,0,0.05)" : "rgba(0,200,80,0.05)",
          border: `1px solid ${line.isError ? "rgba(255,0,0,0.18)" : "rgba(0,200,80,0.15)"}`,
        }}>
        <div className="text-[8px] font-black font-mono uppercase mb-1"
          style={{ color: line.isError ? "#ff8888" : "#66ff99", opacity: 0.7 }}>
          ◀ {line.toolName || "نتيجة"}
        </div>
        <div className="text-[10px] font-mono whitespace-pre-wrap"
          style={{ color: line.isError ? "#ff9999" : "#99ffaa" }}>
          {line.text}
        </div>
      </div>
    );
  }

  if (line.kind === "system") {
    return (
      <div className="flex items-center gap-2 text-[9px] font-mono py-0.5"
        style={{ color: line.isError ? "#ff7777" : "rgba(100,255,100,0.5)" }}>
        <ChevronRight className="w-3 h-3 shrink-0" />
        {line.text}
      </div>
    );
  }

  return (
    <div className={`flex ${line.kind === "user" ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[86%] rounded-2xl px-4 py-3 space-y-1"
        style={line.kind === "user"
          ? { background: "rgba(100,0,255,0.12)", border: "1px solid rgba(100,0,255,0.3)" }
          : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="text-[9px] font-black font-mono uppercase tracking-wider"
          style={{ color: line.kind === "user" ? "#aa66ff" : "#44ff88" }}>
          {line.kind === "user" ? "أنت" : `☠ NovaAgent · ${model}`}
        </div>
        <div className="text-[12px] font-mono leading-relaxed whitespace-pre-wrap"
          style={{ color: "rgba(255,255,255,0.84)" }}>
          {line.text || <span style={{ opacity: 0.35 }}>▍</span>}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Main Component ───────────────────────── */

export default function NovaAgentChat() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "thinking" | "planning" | "responding" | "tools">("idle");
  const [ollamaStatus, setOllamaStatus] = useState<"unknown" | "ok" | "cors" | "error">("unknown");
  const [ollamaError, setOllamaError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsBase, setSettingsBase] = useState(getStoredOllamaBase);
  const [settingsModel, setSettingsModel] = useState(getStoredOllamaModel);
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState(getStoredOllamaModel());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [lines]);

  const checkOllama = useCallback(async (base?: string) => {
    setOllamaStatus("unknown");
    const resolvedBase = (base ?? getStoredOllamaBase()).replace(/\/$/, "");
    // Try server-side probe first (no CORS required)
    try {
      const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const r = await fetch("/api/ollama/probe");
      if (r.ok) {
        const data = await r.json() as { connected: boolean; models?: string[]; error?: string };
        if (data.connected) {
          setOllamaStatus("ok");
          const models = data.models ?? [];
          setInstalledModels(models);
          if (models.length > 0 && !models.includes(getStoredOllamaModel())) {
            const best = models.find(m => m.includes("dolphin-llama3")) ?? models.find(m => m.includes("qwen")) ?? models[0];
            if (best) { setSettingsModel(best); setCurrentModel(best); saveOllamaSettings(resolvedBase, best); }
          }
          setOllamaError("");
          return;
        }
        setOllamaError(data.error ?? "Ollama غير متصل");
        setOllamaStatus("error");
        return;
      }
    } catch {
      setOllamaStatus("error");
      setOllamaError("تعذّر الوصول إلى خادم CyberNova");
    }
  }, []);

  useEffect(() => { void checkOllama(); }, [checkOllama]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const r = await apiFetch("/live-agent/sessions");
      setSessions(await r.json());
    } catch { /* ignore */ }
    finally { setSessionsLoading(false); }
  }, []);

  const createSession = useCallback(async (): Promise<string | null> => {
    try {
      const r = await apiFetch("/live-agent/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Nova · ${new Date().toLocaleTimeString("ar-SA")}` }),
      });
      const s = await r.json() as { id: string };
      return s.id;
    } catch { return null; }
  }, []);

  const loadSessionHistory = useCallback(async (id: string) => {
    try {
      const r = await apiFetch(`/live-agent/sessions/${id}`);
      const data = await r.json() as { messages: StoredMessage[] };
      const msgs = (data.messages || []).filter(m => m.role === "user" || m.role === "assistant");
      setLines(msgs.map(m => ({
        id: m.id,
        kind: m.role as "user" | "assistant",
        text: m.content,
      })));
    } catch { setLines([]); }
  }, []);

  const selectSession = useCallback(async (id: string) => {
    setSessionId(id);
    setLines([]);
    await loadSessionHistory(id);
  }, [loadSessionHistory]);

  const handleNewSession = useCallback(async () => {
    const id = await createSession();
    if (id) {
      setSessionId(id);
      setLines([]);
      await loadSessions();
    }
  }, [createSession, loadSessions]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await apiFetch(`/live-agent/sessions/${id}`, { method: "DELETE" });
      if (id === sessionId) {
        setSessionId(null);
        setLines([]);
      }
      await loadSessions();
    } catch { /* ignore */ }
  }, [sessionId, loadSessions]);

  useEffect(() => {
    void (async () => {
      await loadSessions();
      const id = await createSession();
      if (id) { setSessionId(id); await loadSessions(); }
    })();
  }, []);

  const saveSettings = async () => {
    saveOllamaSettings(settingsBase, settingsModel);
    setCurrentModel(settingsModel);
    await fetch(`${API_BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ollamaBaseUrl: settingsBase, ollamaModel: settingsModel }),
    }).catch(() => {});
    setShowSettings(false);
    await checkOllama(settingsBase);
  };

  const pickModel = (m: string) => {
    setSettingsModel(m);
    setCurrentModel(m);
    saveOllamaSettings(settingsBase, m);
    fetch(`${API_BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ollamaBaseUrl: settingsBase, ollamaModel: m }),
    }).catch(() => {});
  };

  const addLine = useCallback((l: Omit<ChatLine, "id">): string => {
    const id = `${l.kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLines(prev => [...prev, { ...l, id }]);
    return id;
  }, []);

  const updateLine = useCallback((id: string, updater: (l: ChatLine) => Partial<ChatLine>) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...updater(l) } : l));
  }, []);

  const handleToggleCollapse = useCallback((id: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, collapsed: !l.collapsed } : l));
  }, []);

  const handleEditPlan = useCallback((id: string, steps: PlanStep[]) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, planSteps: steps } : l));
  }, []);

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
    setPhase("idle");
  };

  /* ─── Main Send ─── */
  const send = async (textArg?: string) => {
    const msg = (textArg ?? input).trim();
    if (!msg || !sessionId || busy) return;
    setInput("");
    setBusy(true);
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    addLine({ kind: "user", text: msg });

    const base = getStoredOllamaBase();
    const model = getStoredOllamaModel();

    const buildHistory = (): OllamaMessage[] => {
      const h: OllamaMessage[] = [{ role: "system", content: NOVA_SYS }];
      for (const l of lines.filter(l => l.kind === "user" || l.kind === "assistant")) {
        h.push({ role: l.kind as "user" | "assistant", content: l.text });
      }
      h.push({ role: "user", content: msg });
      return h;
    };

    try {
      /* ── PHASE 1: THINK ── */
      setPhase("thinking");
      const thinkId = addLine({ kind: "thinking", text: "", collapsed: false });
      let thinkText = "";
      try {
        await streamOllamaViaServer({
          apiBase: base, model,
          messages: [
            { role: "system", content: THINK_SYS },
            { role: "user", content: msg },
          ],
          signal,
          onToken: token => {
            thinkText += token;
            updateLine(thinkId, () => ({ text: thinkText }));
          },
        });
      } catch (e) {
        if (signal.aborted) throw e;
      }
      updateLine(thinkId, () => ({ collapsed: true }));

      /* ── PHASE 2: PLAN (for complex tasks) ── */
      let planLineId = "";
      let currentPlanSteps: PlanStep[] = [];

      if (needsPlan(msg)) {
        setPhase("planning");
        let planText = "";
        try {
          await streamOllamaViaServer({
            apiBase: base, model,
            messages: [
              { role: "system", content: PLAN_SYS },
              { role: "user", content: msg },
            ],
            signal,
            onToken: token => { planText += token; },
          });
          currentPlanSteps = parsePlanSteps(planText);
          if (currentPlanSteps.length > 0) {
            planLineId = addLine({ kind: "plan", text: planText, planSteps: currentPlanSteps });
          }
        } catch (e) {
          if (signal.aborted) throw e;
        }
      }

      /* ── PHASE 3: RESPOND (browser → Ollama stream) ── */
      setPhase("responding");
      const respId = addLine({ kind: "assistant", text: "" });
      let fullResp = "";

      try {
        fullResp = await streamOllamaViaServer({
          apiBase: base, model,
          messages: buildHistory(),
          signal,
          onToken: token => {
            fullResp += token;
            updateLine(respId, () => ({ text: fullResp }));
          },
        });
        setOllamaStatus("ok");
      } catch (e) {
        if (signal.aborted) throw e;
        throw e;
      }

      /* ── PHASE 4: SERVER TOOLS (SSE) ── */
      setPhase("tools");
      let stepIdx = 0;

      try {
        const toolRes = await fetch(`${API_BASE}/live-agent/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: msg }),
          signal,
        });

        if (toolRes.ok && toolRes.body) {
          const reader = toolRes.body.getReader();
          const dec = new TextDecoder();
          let buf = "", evt: string | null = null;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const blocks = buf.split("\n\n");
            buf = blocks.pop() ?? "";

            for (const block of blocks) {
              for (const rawLine of block.split("\n")) {
                if (rawLine.startsWith("event: ")) evt = rawLine.slice(7);
                else if (rawLine.startsWith("data: ") && evt) {
                  try {
                    const data = JSON.parse(rawLine.slice(6)) as Record<string, unknown>;

                    if (evt === "tool_call") {
                      if (planLineId && currentPlanSteps[stepIdx]) {
                        const updated = currentPlanSteps.map((s, i) =>
                          i === stepIdx ? { ...s, status: "running" as const } : s);
                        updateLine(planLineId, () => ({ planSteps: updated }));
                        currentPlanSteps = updated;
                      }
                      const inputStr = JSON.stringify(data.input ?? {}).slice(0, 120);
                      addLine({ kind: "tool", toolName: String(data.name), text: `▶ ${String(data.name)}(${inputStr})` });

                    } else if (evt === "tool_result") {
                      if (planLineId && currentPlanSteps[stepIdx]) {
                        const updated = currentPlanSteps.map((s, i) =>
                          i === stepIdx ? { ...s, status: (data.isError ? "error" : "done") as PlanStep["status"] } : s);
                        updateLine(planLineId, () => ({ planSteps: updated }));
                        currentPlanSteps = updated;
                        stepIdx++;
                      }
                      const result = String(data.result || "").slice(0, 500);
                      addLine({ kind: "tool_result", toolName: String(data.name), text: result || "(تم)", isError: Boolean(data.isError) });

                    } else if (evt === "done") {
                      if (planLineId && currentPlanSteps.length > 0) {
                        const allDone = currentPlanSteps.map(s => ({ ...s, status: "done" as const }));
                        updateLine(planLineId, () => ({ planSteps: allDone }));
                      }
                      addLine({ kind: "system", text: "✓ اكتمل التنفيذ" });

                    } else if (evt === "error") {
                      addLine({ kind: "system", text: `⚙ ${String(data.error || "")}`, isError: true });
                    }
                  } catch { /* ignore parse errors */ }
                  evt = null;
                }
              }
            }
          }
        }
      } catch (e) {
        if (signal.aborted) throw e;
      }

      /* ── Save AI response to DB ── */
      await fetch(`${API_BASE}/live-agent/sessions/${sessionId}/save-ai-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantContent: fullResp }),
      }).catch(() => {});

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const errMsg = err instanceof Error ? err.message : String(err);
      setOllamaStatus("error");
      setOllamaError(errMsg);
      addLine({ kind: "system", text: `⚠ ${errMsg}`, isError: true });
    } finally {
      setBusy(false);
      setPhase("idle");
      abortRef.current = null;
      void loadSessions();
    }
  };

  const model = currentModel || getStoredOllamaModel();

  /* ───────────────────────── Render ───────────────────────── */
  return (
    <div className="h-full flex flex-col overflow-hidden"
      style={{ background: "linear-gradient(180deg,#060010 0%,#030008 100%)" }} dir="rtl">

      {/* Header */}
      <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
        <PageHeader
          title="☠ Nova Agent Chat"
          subtitle="تفكير ذكي • تخطيط تلقائي • Ollama مباشر"
          icon={Bot}
          danger
          actions={
            <div className="flex items-center gap-2">
              {/* Phase indicator — animated cyberpunk typing indicator */}
              {busy && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-lg text-[9px] font-mono"
                  style={{
                    background: phase === "thinking" ? "rgba(100,0,255,0.12)" :
                                phase === "planning"  ? "rgba(0,180,255,0.1)"  :
                                phase === "responding"? "rgba(0,255,136,0.08)" :
                                "rgba(255,200,0,0.08)",
                    border: `1px solid ${
                      phase === "thinking"  ? "rgba(100,0,255,0.3)"  :
                      phase === "planning"  ? "rgba(0,180,255,0.25)" :
                      phase === "responding"? "rgba(0,255,136,0.2)"  :
                      "rgba(255,200,0,0.2)"}`,
                  }}>
                  {/* Pulsing dot */}
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                      style={{ background: phase === "responding" ? "#44ff88" : phase === "planning" ? "#00b4ff" : "#aa66ff" }} />
                    <span className="relative inline-flex rounded-full h-2 w-2"
                      style={{ background: phase === "responding" ? "#44ff88" : phase === "planning" ? "#00b4ff" : "#aa66ff" }} />
                  </span>
                  {/* Glitch label */}
                  <span className="animate-pulse" style={{
                    color: phase === "thinking"  ? "#bb88ff" :
                           phase === "planning"  ? "#44ccff" :
                           phase === "responding"? "#44ff88" : "#ffc800",
                    letterSpacing: "0.08em",
                  }}>
                    {phase === "thinking"  ? "▌ يفكّر" :
                     phase === "planning"  ? "▌ يخطّط" :
                     phase === "responding"? "▌ يجيب"  : "▌ أدوات"}
                  </span>
                  {/* Blinking cursor */}
                  <span className="animate-pulse" style={{ color: "rgba(255,255,255,0.4)" }}>█</span>
                </div>
              )}

              {/* Ollama status */}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono cursor-pointer"
                onClick={() => void checkOllama()}
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: `1px solid ${
                    ollamaStatus === "ok" ? "rgba(68,255,136,0.3)" :
                    ollamaStatus === "cors" ? "rgba(255,200,0,0.3)" :
                    ollamaStatus === "error" ? "rgba(255,68,68,0.3)" :
                    "rgba(255,255,255,0.1)"}`,
                }}>
                {ollamaStatus === "ok"
                  ? <Wifi className="w-3 h-3 text-emerald-400" />
                  : ollamaStatus === "cors"
                    ? <AlertTriangle className="w-3 h-3 text-yellow-400" />
                    : ollamaStatus === "error"
                      ? <WifiOff className="w-3 h-3 text-red-400" />
                      : <Loader2 className="w-3 h-3 animate-spin opacity-40" />}
                <span style={{ color:
                  ollamaStatus === "ok" ? "#44ff88" :
                  ollamaStatus === "cors" ? "#ffc800" :
                  ollamaStatus === "error" ? "#ff5555" :
                  "rgba(255,255,255,0.4)" }}>
                  {ollamaStatus === "ok" ? `${model} · Online` :
                   ollamaStatus === "cors" ? "CORS مطلوب" :
                   ollamaStatus === "error" ? "Offline" : "..."}
                </span>
              </div>

              {/* Settings */}
              <button onClick={() => setShowSettings(s => !s)}
                className="p-1.5 rounded-lg transition-all hover:bg-white/10"
                style={{ color: showSettings ? "#aa66ff" : "rgba(255,255,255,0.35)" }}>
                <Settings className="w-3.5 h-3.5" />
              </button>

              {/* Sidebar toggle */}
              <button onClick={() => setSidebarOpen(s => !s)}
                className="p-1.5 rounded-lg transition-all hover:bg-white/10"
                style={{ color: sidebarOpen ? "#aa66ff" : "rgba(255,255,255,0.35)" }}>
                <History className="w-3.5 h-3.5" />
              </button>

              {/* Stop */}
              {busy ? (
                <button onClick={stop}
                  className="px-3 py-1.5 rounded-xl font-black text-[11px] font-mono flex items-center gap-1.5 transition-all"
                  style={{ background: "rgba(255,0,0,0.1)", border: "1px solid rgba(255,0,0,0.3)", color: "#ff6666" }}>
                  <X className="w-3.5 h-3.5" />إيقاف
                </button>
              ) : (
                <button onClick={handleNewSession}
                  className="px-3 py-1.5 rounded-xl font-black text-[11px] font-mono flex items-center gap-1.5 transition-all"
                  style={{ background: "rgba(100,0,255,0.12)", border: "1px solid rgba(100,0,255,0.35)", color: "#aa66ff" }}>
                  <Plus className="w-3.5 h-3.5" />جلسة جديدة
                </button>
              )}
            </div>
          }
        />

        {/* Settings panel */}
        {showSettings && (
          <div className="rounded-xl p-3 space-y-3"
            style={{ background: "rgba(100,0,255,0.06)", border: "1px solid rgba(100,0,255,0.22)" }}>
            <div className="text-[10px] font-black font-mono text-purple-400 uppercase tracking-widest">⚙ إعدادات Ollama</div>

            {/* URL + Model inputs */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>Ollama URL</label>
                <input value={settingsBase} onChange={e => setSettingsBase(e.target.value)}
                  className="w-full rounded px-2 py-1.5 text-[10px] font-mono focus:outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }}
                  placeholder="http://127.0.0.1:11434" dir="ltr" />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Model
                  {ollamaStatus === "ok" && installedModels.length > 0 && (
                    <span style={{ color: "#44ff88", marginRight: 6 }}>← اختر أدناه</span>
                  )}
                </label>
                <input value={settingsModel} onChange={e => setSettingsModel(e.target.value)}
                  className="w-full rounded px-2 py-1.5 text-[10px] font-mono focus:outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }}
                  placeholder="dolphin-llama3" dir="ltr" />
              </div>
            </div>

            {/* Installed models picker */}
            {ollamaStatus === "ok" && installedModels.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[9px] font-mono font-black uppercase tracking-widest" style={{ color: "#44ff88" }}>
                  ⚡ النماذج المثبتة ({installedModels.length}) — انقر لتحديد
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {installedModels.map(m => (
                    <button key={m} onClick={() => pickModel(m)}
                      className="px-2.5 py-1 rounded text-[10px] font-mono font-bold transition-all"
                      style={settingsModel === m
                        ? { background: "rgba(100,0,255,0.3)", border: "1px solid rgba(100,0,255,0.6)", color: "#cc88ff" }
                        : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
                      {settingsModel === m && "✓ "}
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error/guide */}
            {(ollamaStatus === "error" || ollamaStatus === "cors") && (
              <div className="text-[9px] font-mono p-2.5 rounded space-y-1.5 leading-relaxed"
                style={{
                  background: ollamaStatus === "cors" ? "rgba(255,200,0,0.05)" : "rgba(255,0,0,0.05)",
                  border: `1px solid ${ollamaStatus === "cors" ? "rgba(255,200,0,0.2)" : "rgba(255,0,0,0.18)"}`,
                  color: ollamaStatus === "cors" ? "#ffc800" : "#ff8888"
                }}>
                {ollamaStatus === "cors"
                  ? "⚠ Ollama شغّال لكن CORS مطلوب — شغّله بالأمر:"
                  : "❌ Ollama غير شغّال — شغّله بالأمر:"}
                <div className="rounded px-2 py-1 mt-1 select-all" dir="ltr"
                  style={{ background: "rgba(0,0,0,0.4)", color: "#44ff88", fontSize: 9 }}>
                  {`OLLAMA_ORIGINS="*" ollama serve`}
                </div>
                <div className="opacity-60" dir="ltr">Windows: <span style={{ color: "#44eebb" }}>set OLLAMA_ORIGINS=* && ollama serve</span></div>
                {ollamaStatus === "error" && (
                  <div className="opacity-60 mt-1">ثم نزّل النموذج: <span dir="ltr" style={{ color: "#aa88ff" }}>ollama pull dolphin-llama3</span></div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={saveSettings}
                className="px-3 py-1 rounded text-[10px] font-mono font-bold transition-all"
                style={{ background: "rgba(100,0,255,0.2)", border: "1px solid rgba(100,0,255,0.4)", color: "#aa66ff" }}>
                حفظ وفحص الاتصال
              </button>
              <button onClick={() => void checkOllama(settingsBase)}
                className="px-3 py-1 rounded text-[10px] font-mono transition-all"
                style={{ background: "rgba(0,100,255,0.1)", border: "1px solid rgba(0,100,255,0.25)", color: "#4488ff" }}>
                فحص فقط
              </button>
              <button onClick={() => setShowSettings(false)}
                className="px-3 py-1 rounded text-[10px] font-mono transition-all"
                style={{ color: "rgba(255,255,255,0.3)" }}>
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Body: sidebar + chat */}
      <div className="flex flex-1 overflow-hidden">

        {/* Session sidebar */}
        {sidebarOpen && (
          <SessionSidebar
            sessions={sessions}
            activeId={sessionId}
            onSelect={selectSession}
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
            loading={sessionsLoading}
          />
        )}

        {/* Main chat area */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Quick actions */}
          <div className="px-4 pt-1 pb-2 shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
              {QUICK_ACTIONS.map(qa => (
                <button key={qa.label} onClick={() => setInput(qa.prompt)}
                  disabled={busy}
                  className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all hover:scale-105 disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <qa.icon className={`w-3 h-3 ${qa.color}`} />
                  <span style={{ color: "rgba(255,255,255,0.65)" }}>{qa.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 space-y-2.5 pb-4"
            style={{ scrollbarWidth: "thin" }}>
            {lines.length === 0 && (
              <div className="text-center py-16 space-y-4">
                <div className="relative inline-block">
                  <Bot className="w-16 h-16 mx-auto"
                    style={{ color: "rgba(100,0,255,0.2)", filter: "drop-shadow(0 0 20px rgba(100,0,255,0.12))" }} />
                  <div className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-purple-600/20 border border-purple-500/30 flex items-center justify-center">
                    <Brain className="w-2 h-2 text-purple-400" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.22)" }}>
                    اكتب رسالتك أو اختر إجراء سريع
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    {[
                      { icon: Brain, label: "يفكّر بصوت عالٍ", color: "text-purple-400" },
                      { icon: ListChecks, label: "يضع خطة تنفيذ", color: "text-cyan-400" },
                      { icon: Zap, label: "يُنفّذ الأدوات", color: "text-yellow-400" },
                      { icon: BookOpen, label: "يتعلّم ويتذكّر", color: "text-green-400" },
                    ].map(f => (
                      <div key={f.label} className="flex items-center gap-1 text-[9px] font-mono"
                        style={{ color: "rgba(255,255,255,0.2)" }}>
                        <f.icon className={`w-3 h-3 ${f.color}`} />
                        {f.label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {lines.map(l => (
              <MessageLine
                key={l.id}
                line={l}
                model={model}
                onToggleCollapse={handleToggleCollapse}
                onEditPlan={handleEditPlan}
              />
            ))}

            {/* Typing indicator bubble */}
            {busy && (
              <div className="flex items-start gap-2 py-1">
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{
                    background: phase === "responding" ? "rgba(0,255,136,0.15)" :
                                phase === "planning"   ? "rgba(0,180,255,0.12)" : "rgba(100,0,255,0.2)",
                    border: `1px solid ${phase === "responding" ? "rgba(0,255,136,0.3)" : phase === "planning" ? "rgba(0,180,255,0.25)" : "rgba(100,0,255,0.4)"}`,
                  }}>
                  <Bot className="w-3 h-3" style={{
                    color: phase === "responding" ? "#44ff88" : phase === "planning" ? "#00b4ff" : "#aa66ff"
                  }} />
                </div>
                <div className="rounded-xl px-3 py-2 max-w-xs"
                  style={{
                    background: phase === "responding" ? "rgba(0,255,136,0.04)" :
                                phase === "planning"   ? "rgba(0,180,255,0.05)" : "rgba(100,0,255,0.08)",
                    border: `1px solid ${phase === "responding" ? "rgba(0,255,136,0.12)" : phase === "planning" ? "rgba(0,180,255,0.12)" : "rgba(100,0,255,0.18)"}`,
                  }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold" style={{
                      color: phase === "responding" ? "#44ff88" : phase === "planning" ? "#44ccff" : "#aa66ff"
                    }}>
                      Nova
                    </span>
                    <span className="text-[9px] font-mono opacity-50">·</span>
                    <span className="text-[9px] font-mono animate-pulse" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {phase === "thinking"  ? "يفكّر في الإجابة..." :
                       phase === "planning"  ? "يضع خطة التنفيذ..." :
                       phase === "responding"? "يكتب الرد..."        : "ينفّذ الأدوات..."}
                    </span>
                    {/* Animated dots */}
                    <div className="flex gap-0.5">
                      {[0,1,2].map(i => (
                        <span key={i} className="w-1 h-1 rounded-full"
                          style={{
                            background: phase === "responding" ? "#44ff88" : phase === "planning" ? "#44ccff" : "#aa66ff",
                            animation: `typing-bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
                            opacity: 0.7,
                          }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-4 pb-4 pt-2 shrink-0">
            <form onSubmit={e => { e.preventDefault(); void send(); }} className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={
                    ollamaStatus === "error"
                      ? "⚠ Ollama غير متصل — افتح الإعدادات ⚙"
                      : busy
                        ? `${phase === "thinking" ? "🧠 يفكّر..." : phase === "planning" ? "📋 يخطّط..." : phase === "responding" ? "⚡ يجيب..." : "🔧 الأدوات..."}`
                        : "اكتب سؤالاً أو مهمة أمنية..."
                  }
                  disabled={busy}
                  className="w-full rounded-xl px-4 py-3 font-mono text-[12px] focus:outline-none"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${ollamaStatus === "error" ? "rgba(255,68,68,0.35)" : busy ? "rgba(100,0,255,0.3)" : "rgba(255,255,255,0.1)"}`,
                    color: "rgba(255,255,255,0.85)",
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="px-5 rounded-xl font-black text-[12px] font-mono flex items-center gap-2 transition-all disabled:opacity-40 hover:scale-105"
                style={{ background: "rgba(100,0,255,0.18)", border: "1px solid rgba(100,0,255,0.4)", color: "#aa66ff", whiteSpace: "nowrap" }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {busy ? "..." : "إرسال"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
