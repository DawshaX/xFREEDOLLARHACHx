/**
 * AgentWorkCockpit — مكان مخصص للشغل والشات الحي مع الأجينت
 * ───────────────────────────────────────────────────────────────────────────
 * صُمّم ليكون ساحة عمل مريحة وواضحة بلا زحمة أشرطة:
 *   · اليمين: شات الأجينت المباشر (الجلسة الجذرية الدائمة nova-root 24/7).
 *   · اليسار: منصة المشاهدة والعمل الحي (كل خطوة تفكير، أداة، تيرمنال،
 *     ذاكرة دائمة، تعلّم ذاتي Auto-Dream، 67 أداة حقيقية، ملفات وأسطول).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Brain,
  CheckCircle2,
  Cpu,
  FolderOpen,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pin,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Terminal as TerminalIcon,
  Trash2,
  Wrench,
  XCircle,
  Zap,
  ZapOff,
} from "lucide-react";
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";
import { KaliTerminal } from "@/components/desktop/KaliTerminal";
import { AdvancedFileManager } from "@/components/desktop/AdvancedFileManager";
import { NovaMissions } from "@/components/desktop/NovaMissions";
import { novaAuthHeaders } from "@/lib/ops-client";
import { useSystem } from "@/context/SystemContext";

type StageTab = "live" | "memory" | "tools" | "files";
type SplitLayout = "balanced" | "chat-wide" | "work-wide";

interface LiveFeedEntry {
  id: string;
  ts: number;
  kind: string;
  title: string;
  detail?: string;
  ok?: boolean;
  ms?: number;
}

interface TermEntry {
  id: string;
  ts: number;
  kind: "cmd" | "stdout" | "stderr" | "info";
  text: string;
}

interface MemoryRecord {
  id: string;
  kind: "fact" | "preference" | "lesson" | "event" | "session";
  scope: string;
  title: string;
  content: string;
  tags?: string[];
  importance?: number;
  pinned?: boolean;
  source?: string;
  updatedAt?: string;
}

interface LearningSnapshot {
  ok?: boolean;
  measuredAt?: string;
  memoryStats?: {
    total?: number;
    byKind?: Record<string, number>;
    pinned?: number;
  };
  autoDreamActive?: boolean;
  autoDreamCount?: number;
  autoDreamLessons?: MemoryRecord[];
  recentMemories?: MemoryRecord[];
  nexus?: {
    rootSessionId?: string;
    totalSessions?: number;
    rootMessageCount?: number;
    backgroundFeedCount?: number;
    learnedInsightsCount?: number;
    rootDigest?: string;
    learnedInsights?: string[];
    recentBackground?: Array<{
      id: string;
      kind: string;
      title: string;
      detail: string;
      ts: string;
      source: string;
    }>;
  };
  autonomy?: {
    enabled?: boolean;
    active?: boolean;
    level?: string;
    daemon?: { running?: boolean; cycles?: number };
  };
}

interface CatalogueTool {
  name: string;
  title: string;
  category: string;
  description: string;
  risk: string;
}

interface FleetAgent {
  id: string;
  hostname: string;
  platform: string;
  user?: string;
  cpus?: number;
}

const PHASE_META: Record<string, { label: string; color: string; pulse: boolean }> = {
  idle:     { label: "جاهز للعمل",        color: "#34d399", pulse: false },
  thinking: { label: "يفكّر ويحلّل...",    color: "#22d3ee", pulse: true },
  tool:     { label: "ينفّذ أداة أمامك",   color: "#fbbf24", pulse: true },
  writing:  { label: "يكتب الخلاصة...",    color: "#e879f9", pulse: true },
};

const QUICK_STARTERS: Array<{ label: string; prompt: string; auto?: boolean }> = [
  { label: "فحص جاهزية النظام", prompt: "افحص حالة النظام الكاملة والأدوات والعقد المتصلة وملخص الذاكرة الآن.", auto: true },
  { label: "استعراض الذاكرة والتعلم", prompt: "استعرض أهم ما في ذاكرتك طويلة الأمد وما تعلّمته في auto-dream.", auto: true },
  { label: "بحث ثغرات CVE", prompt: "ابحث في قاعدة الثغرات الحية عن: " },
  { label: "استطلاع هدف", prompt: "ابدأ استطلاعاً قانونياً (DNS + WHOIS + Subdomains) للهدف: " },
];

export function AgentWorkCockpit() {
  const sys = useSystem();
  const [stageTab, setStageTab] = useState<StageTab>("live");
  const [layout, setLayout] = useState<SplitLayout>("balanced");
  const [focusFull, setFocusFull] = useState(false);

  // Live agent watch telemetry
  const [phase, setPhase] = useState<string>("idle");
  const [currentThought, setCurrentThought] = useState<string>("الجلسة الجذرية الدائمة (nova-root) متصلة — اكتب أي مهمة في الشات وستشاهد كل خطوة وتفكير وتنفيذ هنا لحظة بلحظة.");
  const [activeTool, setActiveTool] = useState<{ name: string; startedAt: number } | null>(null);
  const [liveFeed, setLiveFeed] = useState<LiveFeedEntry[]>([]);
  const [agentTermLines, setAgentTermLines] = useState<TermEntry[]>([]);
  const [memoryPulse, setMemoryPulse] = useState(false);

  // Memory & Auto-Dream learning state
  const [learning, setLearning] = useState<LearningSnapshot | null>(null);
  const [memQuery, setMemQuery] = useState("");
  const [memSearchResults, setMemSearchResults] = useState<MemoryRecord[] | null>(null);
  const [newMemKind, setNewMemKind] = useState<"fact" | "lesson" | "preference">("lesson");
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");
  const [memBusy, setMemBusy] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // 67 Tools & Fleet
  const [tools, setTools] = useState<CatalogueTool[]>([]);
  const [toolSearch, setToolSearch] = useState("");
  const [toolCat, setToolCat] = useState("all");
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description: string; risk: string }>>([]);
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [notes, setNotes] = useState<string>(() => {
    try { return localStorage.getItem("daw.agentPro.notes") ?? ""; } catch { return ""; }
  });
  const [notesSaved, setNotesSaved] = useState(false);
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const showBanner = useCallback((msg: string) => {
    setBannerMsg(msg);
    setTimeout(() => setBannerMsg((prev) => (prev === msg ? null : prev)), 4500);
  }, []);

  const fetchLearning = useCallback(async () => {
    try {
      const r = await fetch("/api/nova-core/learning", { headers: novaAuthHeaders() });
      if (r.ok) {
        const d = (await r.json()) as LearningSnapshot;
        if (d.ok !== false) setLearning(d);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchToolsAndFleet = useCallback(async () => {
    try {
      const [tr, mr, fr] = await Promise.all([
        fetch("/api/nova-core/catalogue", { headers: novaAuthHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/mcp/tools", { headers: novaAuthHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/local-agent/connect-info", { headers: novaAuthHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (tr && Array.isArray((tr as { tools?: CatalogueTool[] }).tools)) {
        setTools((tr as { tools: CatalogueTool[] }).tools);
      }
      if (mr && Array.isArray((mr as { tools?: Array<{ name: string; description: string; risk: string }> }).tools)) {
        setMcpTools((mr as { tools: Array<{ name: string; description: string; risk: string }> }).tools);
      }
      if (fr && Array.isArray((fr as { agents?: FleetAgent[] }).agents)) {
        setAgents((fr as { agents: FleetAgent[] }).agents);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void fetchLearning();
    void fetchToolsAndFleet();
    const iv = setInterval(() => {
      void fetchLearning();
      void fetchToolsAndFleet();
    }, 15_000);
    return () => clearInterval(iv);
  }, [fetchLearning, fetchToolsAndFleet]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem("daw.agentPro.notes", notes);
        setNotesSaved(true);
      } catch { /* ignore */ }
    }, 350);
    return () => clearTimeout(t);
  }, [notes]);

  // Listen to live agent activities emitted by LiveAgentPanel
  useEffect(() => {
    const pushFeed = (entry: Omit<LiveFeedEntry, "id">) => {
      setLiveFeed((prev) => [{ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }, ...prev].slice(0, 60));
    };

    const onActivity = (ev: Event) => {
      const d = (ev as CustomEvent<Record<string, unknown>>).detail || {};
      const kind = String(d.kind || "event");
      const ts = Number(d.ts || Date.now());
      if (d.phase) setPhase(String(d.phase));

      if (kind === "turn_start") {
        setCurrentThought(`تحليل الطلب: "${String(d.prompt || "").slice(0, 120)}"`);
        setActiveTool(null);
        pushFeed({ ts, kind: "turn", title: "بدء جولة جديدة", detail: String(d.prompt || ""), ok: true });
      } else if (kind === "thought") {
        setCurrentThought(String(d.text || ""));
        pushFeed({ ts, kind: "thought", title: "تفكير الأجينت", detail: String(d.text || ""), ok: true });
      } else if (kind === "plan") {
        const steps = Array.isArray(d.steps) ? (d.steps as Array<{ tool?: string }>) : [];
        const txt = steps.map((s, i) => `${i + 1}. ${s.tool || "أداة"}`).join(" ← ");
        setCurrentThought(`الخطة: ${txt}`);
        pushFeed({ ts, kind: "plan", title: `خطة من ${steps.length} خطوات`, detail: txt, ok: true });
      } else if (kind === "tool_call") {
        const name = String(d.title || d.tool || "أداة");
        setActiveTool({ name, startedAt: ts });
        setCurrentThought(`ينفّذ الأداة الآن: ${name}`);
        pushFeed({ ts, kind: "tool", title: `▶ ${name}`, detail: String(d.input || ""), ok: undefined });
      } else if (kind === "tool_result") {
        setActiveTool(null);
        const name = String(d.tool || "أداة");
        const ok = d.isError !== true;
        pushFeed({
          ts,
          kind: "result",
          title: `${ok ? "✓" : "✗"} نتيجة: ${name}`,
          detail: String(d.summary || ""),
          ok,
          ms: typeof d.ms === "number" ? d.ms : undefined,
        });
      } else if (kind === "exec_start") {
        const cmd = String(d.command || "");
        setActiveTool({ name: "shell", startedAt: ts });
        setCurrentThought(`ينفّذ على الطرفية: ${cmd}`);
        pushFeed({ ts, kind: "exec", title: `❯_ ${cmd}`, ok: undefined });
        setAgentTermLines((prev) => [...prev.slice(-120), { id: `c-${ts}`, ts, kind: "cmd", text: cmd }]);
      } else if (kind === "exec_result") {
        setActiveTool(null);
        const cmd = String(d.command || "");
        const out = String(d.output || "");
        const ok = d.success !== false;
        pushFeed({
          ts,
          kind: "exec_result",
          title: `${ok ? "✓" : "✗"} طُبّق: ${cmd.slice(0, 60)}`,
          detail: out.slice(0, 320),
          ok,
          ms: typeof d.durationMs === "number" ? d.durationMs : undefined,
        });
        setAgentTermLines((prev) => [
          ...prev.slice(-120),
          { id: `r-${ts}`, ts, kind: ok ? "stdout" : "stderr", text: out.slice(0, 1200) || "(لا مخرجات)" },
        ]);
      } else if (kind === "memory") {
        setMemoryPulse(true);
        setTimeout(() => setMemoryPulse(false), 3200);
        pushFeed({ ts, kind: "memory", title: `🧠 حفظ في الذاكرة: ${String(d.title || "معلومة جديدة")}`, ok: true });
        void fetchLearning();
      } else if (kind === "self_heal") {
        pushFeed({ ts, kind: "heal", title: `🔧 إصلاح ذاتي: ${String(d.command || "")}`, detail: String(d.text || ""), ok: true });
      } else if (kind === "done") {
        setPhase("idle");
        setActiveTool(null);
        setCurrentThought(
          `اكتملت المهمة (${String(d.provider || "nova-core")}${Number(d.toolCount) > 0 ? ` · ${d.toolCount} أداة` : ""}${Number(d.ms) > 0 ? ` · ${d.ms}ms` : ""}) — جاهز للأمر التالي.`,
        );
        pushFeed({
          ts,
          kind: "done",
          title: `انتهت الجولة (${String(d.provider || "nova-core")})`,
          ms: typeof d.ms === "number" ? d.ms : undefined,
          ok: true,
        });
        void fetchLearning();
      } else if (kind === "error") {
        setPhase("idle");
        setActiveTool(null);
        pushFeed({ ts, kind: "error", title: `⚠ خطأ`, detail: String(d.text || ""), ok: false });
      }
    };

    window.addEventListener("nova:live-activity", onActivity);
    return () => window.removeEventListener("nova:live-activity", onActivity);
  }, [fetchLearning]);

  const toggleFocusMode = () => {
    const next = !focusFull;
    setFocusFull(next);
    window.dispatchEvent(new CustomEvent("nova:focus-mode", { detail: { focus: next } }));
  };

  const runAutoDreamNow = async () => {
    setMemBusy(true);
    try {
      const r = await fetch("/api/nova-core/memory/consolidate", {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; consolidated?: number; memoryStats?: { total?: number } } | null;
      if (r.ok && d?.ok) {
        setMemoryPulse(true);
        setTimeout(() => setMemoryPulse(false), 3000);
        showBanner(`✨ تم توحيد الذاكرة واستخلاص الدروس (Auto-Dream): +${d.consolidated ?? 0} · الإجمالي ${d.memoryStats?.total ?? "—"}`);
        await fetchLearning();
      } else {
        showBanner(`⚠ تعذر توحيد الذاكرة (${r.status})`);
      }
    } catch {
      showBanner("⚠ تعذر الاتصال بمسار التوحيد");
    } finally {
      setMemBusy(false);
    }
  };

  const toggleAutonomy = async () => {
    const on = !(learning?.autonomy?.enabled || sys.autonomousStatus.enabled);
    try {
      const r = await fetch(on ? "/api/autonomous/enable" : "/api/autonomous/disable", {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: on ? JSON.stringify({ level: "active" }) : undefined,
      });
      if (r.ok) {
        if (on) sys.enableAutonomous(); else sys.disableAutonomous();
        showBanner(on ? "⚡ تم تفعيل الاستقلالية والتعلّم 24/7" : "⏸ تم إيقاف الاستقلالية مؤقتاً");
        await fetchLearning();
      } else {
        showBanner(`⚠ رفض السيرفر (${r.status})`);
      }
    } catch {
      showBanner("⚠ فشل الاتصال بوضع الاستقلالية");
    }
  };

  const runAutonomyTick = async () => {
    try {
      const r = await fetch("/api/autonomous/tick", {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; cycle?: number; skipped?: boolean; reason?: string } | null;
      showBanner(d?.skipped ? `ℹ نبضة: ${d.reason || "تم التخطي"}` : `⚡ نُفّذت نبضة استقلالية فورية #${d?.cycle ?? ""}`);
      await fetchLearning();
    } catch {
      showBanner("⚠ فشل تشغيل النبضة");
    }
  };

  const saveMemoryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemTitle.trim() || !newMemContent.trim()) return;
    setMemBusy(true);
    try {
      const r = await fetch("/api/nova-core/memory", {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          kind: newMemKind,
          title: newMemTitle.trim(),
          content: newMemContent.trim(),
          scope: "workspace",
          importance: 8,
          pinned: true,
        }),
      });
      if (r.ok) {
        setNewMemTitle("");
        setNewMemContent("");
        setMemoryPulse(true);
        setTimeout(() => setMemoryPulse(false), 3000);
        showBanner("🧠 تم حفظ القاعدة في الذاكرة الدائمة للأجينت");
        await fetchLearning();
      }
    } finally {
      setMemBusy(false);
    }
  };

  const searchMemories = async (q: string) => {
    setMemQuery(q);
    if (!q.trim()) {
      setMemSearchResults(null);
      return;
    }
    try {
      const r = await fetch(`/api/nova-core/memory/search?q=${encodeURIComponent(q.trim())}&limit=24`, {
        headers: novaAuthHeaders(),
      });
      if (r.ok) {
        const d = (await r.json()) as { hits?: MemoryRecord[] };
        setMemSearchResults(Array.isArray(d.hits) ? d.hits : []);
      }
    } catch { /* ignore */ }
  };

  const togglePinMemory = async (rec: MemoryRecord) => {
    try {
      await fetch(`/api/nova-core/memory/${encodeURIComponent(rec.id)}/pin`, {
        method: "PATCH",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ pinned: !rec.pinned }),
      });
      await fetchLearning();
      if (memQuery.trim()) void searchMemories(memQuery);
    } catch { /* ignore */ }
  };

  const deleteMemory = async (id: string) => {
    try {
      await fetch(`/api/nova-core/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: novaAuthHeaders(),
      });
      await fetchLearning();
      if (memQuery.trim()) void searchMemories(memQuery);
    } catch { /* ignore */ }
  };

  const sendToAgent = (text: string, autoSend = false) => {
    window.dispatchEvent(new CustomEvent(autoSend ? "nova:qa-send" : "nova:qa-prompt", { detail: { text, autoSend } }));
  };

  const phaseMeta = PHASE_META[phase] ?? PHASE_META.idle;
  const autoEnabled = Boolean(learning?.autonomy?.enabled || sys.autonomousStatus.enabled);
  const memTotal = learning?.memoryStats?.total ?? 0;
  const byKind = learning?.memoryStats?.byKind ?? {};
  const autoDreamCount = learning?.autoDreamCount ?? 0;
  const insights = learning?.nexus?.learnedInsights ?? [];
  const bgFeed = learning?.nexus?.recentBackground ?? [];
  const displayedMemories = memSearchResults ?? learning?.recentMemories ?? [];

  const toolCategories = useMemo(
    () => ["all", ...Array.from(new Set(tools.map((t) => t.category))).filter(Boolean)],
    [tools],
  );
  const filteredTools = useMemo(() => {
    const q = toolSearch.trim().toLowerCase();
    return tools.filter((t) => {
      if (toolCat !== "all" && t.category !== toolCat) return false;
      if (!q) return true;
      return `${t.name} ${t.title} ${t.description} ${t.category}`.toLowerCase().includes(q);
    });
  }, [tools, toolSearch, toolCat]);

  const a0 = agents.find((a) => a.id === "self-node") ?? agents[0];
  const chatWidthCls =
    layout === "chat-wide"
      ? "lg:w-[62%]"
      : layout === "work-wide"
        ? "lg:w-[36%]"
        : "lg:w-[50%]";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#040108] text-white overflow-hidden" dir="rtl">
      {/* ── شريط تحكم موحّد واحد فقط — نظيف وواضح ومباشر ── */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-rose-500/25 bg-gradient-to-l from-[#14040e] via-[#07020c] to-[#05101a]">
        {/* نبضة حالة الأجينت الحية */}
        <div
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-black font-mono"
          style={{
            borderColor: `${phaseMeta.color}60`,
            background: `${phaseMeta.color}16`,
            color: phaseMeta.color,
          }}
        >
          <span
            className={`w-2 h-2 rounded-full ${phaseMeta.pulse ? "animate-ping" : "animate-pulse"}`}
            style={{ background: phaseMeta.color }}
          />
          <span>{phaseMeta.label}</span>
          {activeTool && <span className="text-white/80">· {activeTool.name}</span>}
        </div>

        {/* مؤشر الذاكرة الدائمة + التعلّم الذاتي */}
        <button
          type="button"
          onClick={() => setStageTab("memory")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition ${
            memoryPulse
              ? "border-emerald-400 bg-emerald-500/25 text-emerald-100 scale-[1.03]"
              : "border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20"
          }`}
          title="فتح لوحة الذاكرة والتعلّم الذاتي"
        >
          <Brain className="w-3.5 h-3.5 text-violet-300" />
          <span>الذاكرة: {memTotal}</span>
          <span className="text-emerald-300/90 font-mono text-[9px]">· Auto-Dream {autoDreamCount}</span>
        </button>

        {/* زر تشغيل Auto-Dream فوراً */}
        <button
          type="button"
          disabled={memBusy}
          onClick={() => void runAutoDreamNow()}
          className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/15 px-2.5 py-1 text-[10px] font-bold text-fuchsia-200 hover:bg-fuchsia-500/25 transition disabled:opacity-45"
          title="دمج الذاكرة واستخلاص الدروس الآن"
        >
          <Sparkles className="w-3 h-3" />
          <span>{memBusy ? "يدمج…" : "تعلّم ودمج الآن"}</span>
        </button>

        {/* الاستقلالية 24/7 */}
        <button
          type="button"
          onClick={() => void toggleAutonomy()}
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition ${
            autoEnabled
              ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
              : "border-amber-400/45 bg-amber-500/15 text-amber-200"
          }`}
        >
          {autoEnabled ? <Zap className="w-3 h-3" /> : <ZapOff className="w-3 h-3" />}
          <span>{autoEnabled ? "24/7 مفعّل" : "تفعيل 24/7"}</span>
        </button>

        <button
          type="button"
          onClick={() => void runAutonomyTick()}
          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/20 transition"
          title="تنفيذ دورة استقلالية وتعلّم فورية"
        >
          <Play className="w-3 h-3" /> نبضة
        </button>

        {/* أدوات التحكم في التوزيع وملء الشاشة */}
        <div className="mr-auto flex items-center gap-1">
          {(
            [
              ["balanced", "50/50"],
              ["chat-wide", "شات أوسع"],
              ["work-wide", "مشاهدة أوسع"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLayout(id)}
              className={`hidden md:inline-flex rounded-md border px-2 py-1 text-[9px] font-mono font-bold transition ${
                layout === id
                  ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleFocusMode}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition ${
              focusFull
                ? "border-rose-400/70 bg-rose-500/25 text-rose-100"
                : "border-white/15 bg-white/5 text-white/80 hover:border-rose-400/40"
            }`}
            title={focusFull ? "إظهار القوائم الجانبية" : "ملء الشاشة (إخفاء القوائم)"}
          >
            {focusFull ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span>{focusFull ? "إظهار القوائم" : "ملء الشاشة"}</span>
          </button>
        </div>
      </div>

      {bannerMsg && (
        <div className="shrink-0 bg-emerald-500/15 border-b border-emerald-400/35 px-3 py-1.5 text-[11px] font-mono text-emerald-100 flex items-center justify-between">
          <span>{bannerMsg}</span>
          <button type="button" onClick={() => setBannerMsg(null)} className="text-white/50 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* ── جسم المكتب: الشات المباشر يميناً + منصة المشاهدة والعمل يساراً ── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* ══ العمود الأيمن: الشات المباشر الصافي ══ */}
        <section className={`flex flex-col min-h-[45vh] lg:min-h-0 h-full ${chatWidthCls} border-b lg:border-b-0 lg:border-l border-rose-500/25 bg-[#06020b] transition-all duration-200 overflow-hidden`}>
          {/* شريط أوامر سريعة رفيع بسطر واحد — غير مزاحم أبداً */}
          <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 border-b border-white/10 bg-black/40 overflow-x-auto">
            <span className="text-[9px] font-mono text-rose-300/70 shrink-0 flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> بدء سريع:
            </span>
            {QUICK_STARTERS.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => sendToAgent(q.prompt, Boolean(q.auto))}
                className="shrink-0 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold text-cyan-100 hover:bg-cyan-500/20 hover:border-cyan-400/50 transition"
              >
                {q.auto ? "⚡ " : "✎ "}{q.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <NovaUnifiedChat title="نوفا — غرفة الشغل والشات" subtitle="nova-root 24/7" hideRail compact />
          </div>
        </section>

        {/* ══ العمود الأيسر: منصة المشاهدة الحية والتنفيذ والذاكرة والتعلّم ══ */}
        <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#04020a] overflow-hidden">
          {/* ألسنة منصة العمل — 4 تبويبات صريحة وواضحة */}
          <nav className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 border-b border-white/10 bg-[#08030f] overflow-x-auto">
            {(
              [
                { id: "live",   label: "البث والتنفيذ الحي",     icon: Activity,    color: "#22d3ee", badge: liveFeed.length ? String(liveFeed.length) : "LIVE" },
                { id: "memory", label: "الذاكرة والتعلّم",       icon: Brain,       color: "#c084fc", badge: `${memTotal}` },
                { id: "tools",  label: "الأدوات والمهمات",       icon: Wrench,      color: "#fbbf24", badge: `${tools.length || 67}` },
                { id: "files",  label: "الملفات والأسطول",       icon: FolderOpen,  color: "#34d399", badge: `${agents.length}` },
              ] as const
            ).map((t) => {
              const active = stageTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setStageTab(t.id)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-black transition-all"
                  style={
                    active
                      ? { borderColor: `${t.color}85`, background: `${t.color}20`, color: t.color, boxShadow: `0 0 14px ${t.color}25 inset` }
                      : { borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.6)" }
                  }
                >
                  <t.icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                  <span className="rounded-full bg-black/40 border border-white/15 px-1.5 text-[8px] font-mono" dir="ltr">
                    {t.badge}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* محتوى منصة العمل */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            {/* ─────── تبويب 1: البث والتنفيذ الحي + التيرمنال ─────── */}
            {stageTab === "live" && (
              <div className="space-y-3">
                {/* ماذا يفعل الأجينت الآن؟ */}
                <div
                  className="rounded-xl border p-3 space-y-1.5"
                  style={{
                    borderColor: `${phaseMeta.color}45`,
                    background: `linear-gradient(135deg, ${phaseMeta.color}12 0%, rgba(5,3,12,0.95) 70%)`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span className="font-black flex items-center gap-1.5" style={{ color: phaseMeta.color }}>
                      <Radio className="w-3.5 h-3.5 animate-pulse" />
                      ما يفعله الأجينت أمامك الآن:
                    </span>
                    <span className="text-white/50 flex items-center gap-1">
                      <Cpu className="w-3 h-3 text-cyan-400" />
                      {a0 ? `العقدة: ${a0.hostname}` : "سيرفر محلي"}
                    </span>
                  </div>
                  <div className="text-[12px] font-medium text-white/90 leading-relaxed" dir="auto">
                    {currentThought}
                  </div>
                </div>

                {/* سجل الخطوات الحية + مخرجات الأجينت الفورية */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {/* العمود 1: سجل التفكير والأدوات لحظة بلحظة */}
                  <div className="rounded-xl border border-cyan-500/25 bg-black/50 flex flex-col min-h-[260px] max-h-[340px]">
                    <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10 bg-cyan-500/10">
                      <span className="text-[10px] font-black text-cyan-200 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" /> تيار الخطوات والأدوات المباشر
                      </span>
                      {liveFeed.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setLiveFeed([])}
                          className="text-[9px] font-mono text-white/45 hover:text-white"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                    <div ref={feedScrollRef} className="flex-1 overflow-y-auto p-2 space-y-1.5">
                      {liveFeed.length === 0 ? (
                        <div className="text-center py-8 text-[11px] font-mono text-white/40 space-y-1">
                          <div>لا توجد خطوات جارية بعد — أرسل أي طلب في الشات</div>
                          <div className="text-[9px] text-white/25">ستظهر هنا كل فكرة، خطة، أداة، ومخرجاتها فوراً.</div>
                        </div>
                      ) : (
                        liveFeed.map((ev) => (
                          <div
                            key={ev.id}
                            className={`rounded-lg border px-2.5 py-1.5 text-[10px] ${
                              ev.ok === false
                                ? "border-rose-500/35 bg-rose-500/10"
                                : ev.ok === true
                                  ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                                  : "border-amber-400/30 bg-amber-500/[0.07]"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 font-mono">
                              <span className="font-bold text-white/90 truncate flex items-center gap-1">
                                {ev.ok === true ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                ) : ev.ok === false ? (
                                  <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                                ) : (
                                  <RefreshCw className="w-3 h-3 text-amber-300 animate-spin shrink-0" />
                                )}
                                {ev.title}
                              </span>
                              <span className="text-[8px] text-white/40 shrink-0" dir="ltr">
                                {ev.ms ? `${ev.ms}ms · ` : ""}
                                {new Date(ev.ts).toLocaleTimeString("en-GB", { hour12: false })}
                              </span>
                            </div>
                            {ev.detail && (
                              <pre className="mt-1 text-[9px] font-mono text-white/70 whitespace-pre-wrap break-words max-h-24 overflow-y-auto bg-black/35 rounded p-1.5" dir="auto">
                                {ev.detail}
                              </pre>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* العمود 2: مخرجات أوامر الشِل التي نفذها الأجينت */}
                  <div className="rounded-xl border border-emerald-500/25 bg-black/60 flex flex-col min-h-[260px] max-h-[340px]">
                    <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10 bg-emerald-500/10">
                      <span className="text-[10px] font-black text-emerald-200 flex items-center gap-1.5">
                        <TerminalIcon className="w-3.5 h-3.5" /> أوامر الوكيل الحية (Agent Shell Log)
                      </span>
                      <span className="text-[9px] font-mono text-white/45" dir="ltr">
                        {agentTermLines.filter((l) => l.kind === "cmd").length} cmds
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2.5 font-mono text-[10px] space-y-1 bg-[#020504]" dir="ltr">
                      {agentTermLines.length === 0 ? (
                        <div className="text-center py-8 text-white/35" dir="rtl">
                          عند تشغيل الأجينت أي أمر شِل سيظهر الأمر ومخرجاته الكاملة هنا.
                        </div>
                      ) : (
                        agentTermLines.map((l) => (
                          <pre
                            key={l.id}
                            className={`whitespace-pre-wrap break-words leading-relaxed ${
                              l.kind === "cmd"
                                ? "text-cyan-300 font-bold pt-1"
                                : l.kind === "stderr"
                                  ? "text-rose-300"
                                  : "text-emerald-200/90"
                            }`}
                          >
                            {l.kind === "cmd" ? `$ ${l.text}` : l.text}
                          </pre>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* التيرمنال التفاعلي الكامل للعمل جنباً إلى جنب مع الأجينت */}
                <div className="rounded-xl border border-emerald-400/25 bg-black/65 overflow-hidden flex flex-col min-h-[300px]">
                  <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-emerald-950/35">
                    <span className="text-[10px] font-black text-emerald-200">
                      تيرمنال التشغيل المباشر (نفّذ أوامرك أو اطلب من الوكيل تنفيذها)
                    </span>
                    <span className="text-[9px] font-mono text-white/45" dir="ltr">
                      {a0 ? `${a0.hostname} (${a0.platform})` : "local-shell"}
                    </span>
                  </div>
                  <div className="h-[290px]" dir="ltr">
                    <KaliTerminal
                      agentConnected={agents.length > 0}
                      agentHostname={a0?.hostname ?? ""}
                      agentUser={a0?.user ?? ""}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ─────── تبويب 2: الذاكرة والتعلّم الذاتي (Auto-Dream) ─────── */}
            {stageTab === "memory" && (
              <div className="space-y-3">
                {/* بطاقات الإحصائيات المقاسة */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { label: "إجمالي الذاكرة", value: memTotal, color: "#c084fc" },
                    { label: "دروس متعلّمة",   value: byKind.lesson ?? 0, color: "#34d399" },
                    { label: "حقائق ونتائج",    value: byKind.fact ?? 0, color: "#22d3ee" },
                    { label: "تفضيلاتك",       value: byKind.preference ?? 0, color: "#fbbf24" },
                    { label: "خلاصات Auto-Dream", value: autoDreamCount, color: "#f472b6" },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-xl border p-2.5 bg-black/50"
                      style={{ borderColor: `${s.color}40` }}
                    >
                      <div className="text-lg font-black font-mono" style={{ color: s.color }}>{s.value}</div>
                      <div className="text-[10px] text-white/70 font-bold">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* أزرار التشغيل المباشر للتعلّم والتوحيد */}
                <div className="rounded-xl border border-fuchsia-500/35 bg-fuchsia-500/[0.06] p-3 flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[200px]">
                    <div className="text-[11px] font-black text-fuchsia-200 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> محرك التعلّم والتوحيد الذاتي (Auto-Dream + Root Nexus)
                    </div>
                    <div className="text-[10px] text-white/60 mt-0.5">
                      مفعّل ويعمل بالخلفية 24/7 — يجمع أنماط الثغرات ويوحّد الدروس تلقائياً عبر الجلسات.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={memBusy}
                    onClick={() => void runAutoDreamNow()}
                    className="rounded-lg border border-fuchsia-400/60 bg-fuchsia-500/20 px-3 py-1.5 text-[10px] font-black text-fuchsia-100 hover:bg-fuchsia-500/30 transition disabled:opacity-45"
                  >
                    ✨ تشغيل Auto-Dream الآن
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAutonomyTick()}
                    className="rounded-lg border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-[10px] font-black text-cyan-100 hover:bg-cyan-500/25 transition"
                  >
                    ⚡ نبضة تعلّم فورية
                  </button>
                </div>

                {/* نموذج تعليم الأجينت وحفظ قاعدة دائمة */}
                <form onSubmit={(e) => void saveMemoryItem(e)} className="rounded-xl border border-violet-500/30 bg-black/50 p-3 space-y-2">
                  <div className="text-[11px] font-black text-violet-200 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> علّم الأجينت قاعدة أو معلومة دائمة:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={newMemKind}
                      onChange={(e) => setNewMemKind(e.target.value as "fact" | "lesson" | "preference")}
                      className="rounded-lg border border-white/15 bg-[#0a0414] px-2.5 py-1.5 text-[10px] font-bold text-white outline-none"
                    >
                      <option value="lesson">درس متعلّم (lesson)</option>
                      <option value="fact">حقيقة / هدف (fact)</option>
                      <option value="preference">تفضيل عمل (preference)</option>
                    </select>
                    <input
                      value={newMemTitle}
                      onChange={(e) => setNewMemTitle(e.target.value)}
                      placeholder="عنوان مختصر (مثال: قواعد فحص الـ API)"
                      className="flex-1 min-w-[180px] rounded-lg border border-white/15 bg-[#0a0414] px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/35 outline-none focus:border-violet-400"
                    />
                    <button
                      type="submit"
                      disabled={memBusy || !newMemTitle.trim() || !newMemContent.trim()}
                      className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3 py-1.5 text-[10px] font-black text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
                    >
                      حفظ في الذاكرة
                    </button>
                  </div>
                  <textarea
                    value={newMemContent}
                    onChange={(e) => setNewMemContent(e.target.value)}
                    placeholder="اكتب القاعدة أو النتيجة أو المعلومة التي سيتذكرها الأجينت في كل جلسة قادمة..."
                    className="w-full h-16 rounded-lg border border-white/15 bg-[#0a0414] px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/35 outline-none focus:border-violet-400 resize-y"
                  />
                </form>

                {/* الدروس المستخلصة + نبض الخلفية */}
                {(insights.length > 0 || bgFeed.length > 0) && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-emerald-500/25 bg-black/50 p-3 space-y-1.5">
                      <div className="text-[10px] font-black text-emerald-300">✨ استنتاجات التعلّم الذاتي (Nexus Insights)</div>
                      {insights.length === 0 ? (
                        <div className="text-[10px] text-white/40">لم تتراكم استنتاجات بعد — اضغط «تعلّم ودمج الآن» أو شغّل أدوات مع الأجينت.</div>
                      ) : (
                        insights.map((ins, idx) => (
                          <div key={idx} className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-2.5 py-1.5 text-[10px] text-white/85">
                            • {ins}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="rounded-xl border border-cyan-500/25 bg-black/50 p-3 space-y-1.5">
                      <div className="text-[10px] font-black text-cyan-300">🛰 أحداث الجذر في الخلفية 24/7</div>
                      {bgFeed.length === 0 ? (
                        <div className="text-[10px] text-white/40">ستظهر نبضات المهام التلقائية في الخلفية هنا.</div>
                      ) : (
                        bgFeed.slice(0, 6).map((b) => (
                          <div key={b.id} className="rounded-lg border border-cyan-500/15 bg-cyan-500/[0.04] px-2.5 py-1.5 text-[10px]">
                            <div className="font-bold text-cyan-200">{b.title}</div>
                            <div className="text-white/60 text-[9px] truncate">{b.detail}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* سجل الذاكرة الدائمة مع البحث والتثبيت */}
                <div className="rounded-xl border border-white/10 bg-black/50 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-black text-white/90">📚 سجل الذاكرة الطويلة</span>
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="w-3.5 h-3.5 text-white/35 absolute right-2.5 top-2" />
                      <input
                        value={memQuery}
                        onChange={(e) => void searchMemories(e.target.value)}
                        placeholder="ابحث في كل الذكريات..."
                        className="w-full rounded-lg border border-white/15 bg-[#0a0414] pr-8 pl-2.5 py-1 text-[11px] text-white placeholder:text-white/35 outline-none focus:border-cyan-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void fetchLearning()}
                      className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] text-white/70 hover:text-white flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> تحديث
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                    {displayedMemories.length === 0 ? (
                      <div className="text-center py-6 text-[11px] text-white/40">لا توجد ذكريات مطابقة.</div>
                    ) : (
                      displayedMemories.map((m) => (
                        <div
                          key={m.id}
                          className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 flex items-start gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="rounded border border-violet-400/35 bg-violet-500/15 px-1.5 py-0.2 text-[8px] font-mono text-violet-200">
                                {m.kind}
                              </span>
                              {m.source === "auto-dream" && (
                                <span className="rounded border border-fuchsia-400/40 bg-fuchsia-500/15 px-1.5 py-0.2 text-[8px] font-mono text-fuchsia-200">
                                  Auto-Dream
                                </span>
                              )}
                              <span className="text-[11px] font-bold text-white/90">{m.title}</span>
                              {m.scope && <span className="text-[9px] font-mono text-white/40">({m.scope})</span>}
                            </div>
                            <div className="mt-1 text-[10px] text-white/70 whitespace-pre-wrap break-words leading-relaxed">
                              {m.content}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => void togglePinMemory(m)}
                              title={m.pinned ? "إلغاء التثبيت" : "تثبيت في الذاكرة"}
                              className={`p-1 rounded border ${m.pinned ? "border-amber-400/60 bg-amber-500/20 text-amber-300" : "border-white/10 text-white/40 hover:text-white"}`}
                            >
                              <Pin className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteMemory(m.id)}
                              title="حذف"
                              className="p-1 rounded border border-white/10 text-white/40 hover:text-rose-400 hover:border-rose-500/40"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─────── تبويب 3: الأدوات الـ 67 + MCP + المهمات ─────── */}
            {stageTab === "tools" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-white/35 absolute right-2.5 top-2" />
                    <input
                      value={toolSearch}
                      onChange={(e) => setToolSearch(e.target.value)}
                      placeholder="ابحث في 67 أداة حقيقية..."
                      className="w-full rounded-lg border border-white/15 bg-[#0a0414] pr-8 pl-2.5 py-1.5 text-[11px] text-white placeholder:text-white/35 outline-none focus:border-amber-400"
                    />
                  </div>
                  <select
                    value={toolCat}
                    onChange={(e) => setToolCat(e.target.value)}
                    className="rounded-lg border border-white/15 bg-[#0a0414] px-2.5 py-1.5 text-[10px] font-mono text-white outline-none"
                  >
                    {toolCategories.map((c) => (
                      <option key={c} value={c}>{c === "all" ? `كل الفئات (${tools.length})` : c}</option>
                    ))}
                  </select>
                </div>

                {mcpTools.length > 0 && (
                  <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-2.5">
                    <div className="text-[10px] font-black text-cyan-300 mb-1.5">🔌 أدوات MCP المتصلة ({mcpTools.length})</div>
                    <div className="flex flex-wrap gap-1.5">
                      {mcpTools.map((mt) => (
                        <button
                          key={mt.name}
                          type="button"
                          onClick={() => sendToAgent(`استخدم أداة MCP (${mt.name}) لـ: `)}
                          title={mt.description}
                          className="rounded-lg border border-cyan-500/30 bg-black/45 px-2 py-1 text-[9px] font-mono text-cyan-200 hover:bg-cyan-500/20"
                        >
                          {mt.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {filteredTools.map((t) => (
                    <div
                      key={t.name}
                      className="rounded-xl border border-white/10 bg-black/50 p-2.5 flex flex-col justify-between gap-2 hover:border-amber-400/40 transition"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-black text-amber-200">{t.title || t.name}</span>
                          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-white/15 text-white/60" dir="ltr">
                            {t.name}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-white/65 line-clamp-2">{t.description}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => sendToAgent(`استخدم الأداة ${t.name} (${t.title}) على: `)}
                          className="flex-1 rounded-md border border-white/15 bg-white/5 py-1 text-[9px] font-bold text-white/80 hover:text-white"
                        >
                          ✎ تحضير في الشات
                        </button>
                        <button
                          type="button"
                          onClick={() => sendToAgent(`شغّل الأداة ${t.name} الآن واعرض النتيجة الحقيقية.`, true)}
                          className="rounded-md border border-amber-400/45 bg-amber-500/15 px-2.5 py-1 text-[9px] font-black text-amber-200 hover:bg-amber-500/25"
                        >
                          ⚡ نفّذ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-amber-500/25 bg-black/50 p-2">
                  <NovaMissions />
                </div>
              </div>
            )}

            {/* ─────── تبويب 4: الملفات والأسطول والملاحظات ─────── */}
            {stageTab === "files" && (
              <div className="space-y-3">
                {/* العقد المتصلة */}
                <div className="rounded-xl border border-cyan-500/25 bg-black/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-cyan-200 flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5" /> العقد والأجهزة المتصلة ({agents.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => void fetchToolsAndFleet()}
                      className="text-[9px] font-mono text-white/55 hover:text-white"
                    >
                      تحديث
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {agents.map((ag) => (
                      <div key={ag.id} className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[10px] font-mono">
                        <div className="flex items-center gap-1.5 font-bold text-emerald-200" dir="ltr">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span>{ag.id}</span>
                          <span className="text-white/50 ml-auto">{ag.platform}</span>
                        </div>
                        <div className="text-white/65 mt-0.5" dir="ltr">
                          {ag.hostname} · {ag.user ?? "root"}{ag.cpus ? ` · ${ag.cpus} cores` : ""}
                        </div>
                      </div>
                    ))}
                    {agents.length === 0 && (
                      <div className="text-[10px] font-mono text-white/45">لا توجد عقدة متصلة حالياً.</div>
                    )}
                  </div>
                </div>

                {/* مدير الملفات الحقيقي */}
                <div className="rounded-xl border border-cyan-500/25 bg-black/55 overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/10 bg-cyan-500/10 flex items-center justify-between">
                    <span className="text-[10px] font-black text-cyan-200">📁 مدير ملفات مساحة العمل (عمليات حقيقية)</span>
                    <span className="text-[9px] font-mono text-white/45" dir="ltr">/api/files</span>
                  </div>
                  <div className="max-h-[380px] overflow-auto">
                    <AdvancedFileManager />
                  </div>
                </div>

                {/* دفتر العمل المحفوظ */}
                <div className="rounded-xl border border-teal-500/25 bg-black/55 overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/10 bg-teal-500/10 flex items-center justify-between">
                    <span className="text-[10px] font-black text-teal-200">📝 دفتر الشغل المشترك</span>
                    <span className="text-[9px] font-mono text-teal-200/60">{notesSaved ? "✓ محفوظ محلياً" : "…"}</span>
                  </div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="سجّل الأهداف، الملاحظات، والنتائج أثناء العمل مع الأجينت..."
                    className="w-full h-28 bg-transparent p-3 text-[11px] font-mono text-white/85 placeholder:text-white/30 outline-none resize-y"
                    dir="auto"
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
