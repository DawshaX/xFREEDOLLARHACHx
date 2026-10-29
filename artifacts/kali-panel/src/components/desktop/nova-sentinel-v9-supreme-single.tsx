import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamOllamaViaServer } from "@/lib/ollama-browser";
import {
  Bot,
  Send,
  Sparkles,
  Skull,
  ScanLine,
  Activity,
  Globe,
  Terminal as TerminalIcon,
  Cpu,
  Database,
  ChevronRight,
  Loader2,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Paperclip,
  Download,
  ListChecks,
  Check,
  X,
  FileText,
  History,
  RefreshCw,
  BarChart3,
  Languages,
  Bell,
  Hash,
  Brain,
  Lightbulb,
  TrendingUp,
  AlertTriangle,
  Zap,
  Target,
  Layers,
  ShieldAlert,
  Radar,
  EyeOff,
  Map as MapIcon,
  ShieldCheck,
  SearchCode,
  // 🚀 NEW ICONS INTEGRATED
  Eye,
  Play,
  Pause,
  RotateCw,
  AlertCircle,
  Settings,
  Terminal
} from "lucide-react";
import type { ClientToolEvent } from "./AgentWindow";

// ============================================================
// 🧠 SYSTEME DE SELF-LEARNING & INTELLIGENCE ARTIFICIELLE
// ============================================================

interface LearningPattern {
  id: string;
  pattern: RegExp;
  solution: string;
  successCount: number;
  failureCount: number;
  lastUsed: number;
  tags: string[];
}

interface ReasoningStep {
  step: number;
  thought: string;
  action: string;
  expectedOutcome: string;
  confidence: number;
  alternatives?: string[];
}

interface MemoryEntry {
  id: string;
  query: string;
  response: string;
  toolsUsed: string[];
  success: boolean;
  timestamp: number;
  feedback?: string;
  embedding?: number[]; // ✨ NEW: Integrated Vector Support
}

interface PerformanceMetrics {
  avgResponseTime: number;
  successRate: number;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  toolsUsedCount: Record<string, number>;
  commonPatterns: string[];
  lastOptimization: number;
}

// --- START OF EXTREME EVOLUTION V8 (EXTENSIONS) ---
interface ThreatForecast {
  id: string;
  threatType: string;
  probability: number;
  impact: string;
  timestamp: number;
}

interface AttackNode {
  id: string;
  type: 'agent' | 'target' | 'proxy';
  label: string;
  status: 'active' | 'idle' | 'compromised';
  pos: { x: number, y: number };
}

interface AttackLink {
  from: string;
  to: string;
  type: 'recon' | 'exploit' | 'data';
}
// --- END OF EXTREME EVOLUTION V8 ---

// ============================================================
// 🚀 V9 SUPREME INTEGRATED INTERFACES
// ============================================================

interface OllamaConfig {
  baseUrl: string;
  model: string;
  enabled: boolean;
}

interface ScreenAnalysis {
  text: string;
  elements: string[];
  timestamp: number;
}

const STORAGE_KEYS = {
  HISTORY: "nova_sentinel_history",
  LEARNED_PATTERNS: "nova_learned_patterns",
  LONG_TERM_MEMORY: "nova_long_term_memory",
  PERFORMANCE: "nova_performance_metrics",
  REASONING_CACHE: "nova_reasoning_cache",
  THREAT_FORECAST: "nova_threat_forecast",
  OLLAMA_CONFIG: "nova_ollama_config",
  VECTOR_MEMORY: "nova_vector_memory"
};

// أنماط تعلم ذاتي مبدئية
const DEFAULT_PATTERNS: LearningPattern[] = [
  {
    id: "recon_pattern",
    pattern: /(recon|استكشاف|discover|scan\s+target)/i,
    solution: "ابدأ بـ reconnaissance شامل: whois, dns enumeration, subdomain discovery, port scanning ثم سجل النتائج.",
    successCount: 5,
    failureCount: 0,
    lastUsed: Date.now(),
    tags: ["recon", "scanning", "discovery"]
  },
  {
    id: "vuln_pattern",
    pattern: /(ثغرة|vulnerability|cve|exploit)/i,
    solution: "ابحث في قاعدة الثغرات NVD، حلل CVSS score، تحقق من EPSS، ثم اقترح إصلاحات.",
    successCount: 4,
    failureCount: 1,
    lastUsed: Date.now(),
    tags: ["vulnerability", "cve", "security"]
  },
  {
    id: "pentest_pattern",
    pattern: /(اختبار اختراق|pentest|penetration\s+test)/i,
    solution: "نفّذ منهجية PTES: استطلاع ← فحص ← استغلال ← ما بعد الاستغلال ← تقرير.",
    successCount: 3,
    failureCount: 0,
    lastUsed: Date.now(),
    tags: ["pentest", "exploitation"]
  },
  {
    id: "error_recovery",
    pattern: /(خطأ|error|fail|فشل)/i,
    solution: "حلل الخطأ، جرّب بدائل، ارجع إلى الخطوة السابقة، غيّر المدخلات إذا لزم الأمر.",
    successCount: 7,
    failureCount: 2,
    lastUsed: Date.now(),
    tags: ["error", "recovery", "debug"]
  }
];

const KEYWORD_PATTERNS = [/ip[:\s]+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/gi, /target[:\s]+([a-z0-9.-]+)/gi, /cve-\d{4}-\d+/gi];

type ToolStat = { name: string; count: number; success: number; avgDuration?: number };

const STORAGE_KEY = "nova_sentinel_history";

// Types pour la reconnaissance vocale
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const API_BASE = "/api";

interface QuickAction {
  id: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  hue: string;
  prompt: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "recon",
    label: "Recon",
    hint: "استكشاف هدف",
    icon: Globe,
    hue: "from-cyan-500/30 to-blue-600/10 border-cyan-400/40",
    prompt: "ابدأ recon كامل (whois + dns + subdomains + ports) على الهدف:",
  },
  {
    id: "pentest",
    label: "Pentest",
    hint: "اختبار اختراق",
    icon: Skull,
    hue: "from-rose-500/30 to-red-700/10 border-rose-400/40",
    prompt: "نفّذ playbook pentest على الهدف (افتح scanner + جمع ثغرات NVD/EPSS):",
  },
  {
    id: "scan",
    label: "Scanner",
    hint: "فحص أمني",
    icon: ScanLine,
    hue: "from-fuchsia-500/30 to-purple-700/10 border-fuchsia-400/40",
    prompt: "افتح Scanner وافحص الهدف الآن:",
  },
  {
    id: "monitor",
    label: "Dashboard",
    hint: "مراقبة حية",
    icon: Activity,
    hue: "from-emerald-500/30 to-teal-700/10 border-emerald-400/40",
    prompt: "اعرض dashboard المراقبة الحي للنظام والعمليات.",
  },
  // ✨ V9 INTEGRATED QUICK ACTIONS
  {
    id: "ai_think",
    label: "AI Think",
    hint: "تفكير محلي",
    icon: Brain,
    hue: "from-purple-500/30 to-pink-600/10 border-purple-400/40",
    prompt: "!think فكر في أفضل خطوة تالية",
  },
  {
    id: "screen_analyze",
    label: "Vision",
    hint: "تحليل الشاشة",
    icon: Eye,
    hue: "from-amber-500/30 to-orange-600/10 border-amber-400/40",
    prompt: "!screen حلل الشاشة الحالية",
  },
];

interface ChatLine {
  role: "user" | "assistant" | "tool" | "tool_result" | "system" | "plan";
  text: string;
  toolName?: string;
  isError?: boolean;
  awaitingApproval?: boolean;
  reasoning?: ReasoningStep[];
  confidence?: number;
}

interface SessionFile {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  progress?: number;
}

interface ProviderStatus {
  provider: string;
  configured: boolean;
  lastError?: string;
}

interface BotStatus {
  status: string;
  availableTools: number;
  cronJobs: { enabled: number };
  alerts: { unread: number };
}

export function LiveAgentPanel({
  onClientTool,
  onOpenAgentWindow,
}: {
  onClientTool: (e: ClientToolEvent) => void;
  onOpenAgentWindow: () => void;
}) {
  // ========== STATES EXISTANTS (V8) ==========
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [currentTool, setCurrentTool] = useState<{
    name: string;
    input: string;
    startedAt: number;
  } | null>(null);
  const [toolHistory, setToolHistory] = useState<string[]>([]);
  const [stepCount, setStepCount] = useState(0);
  const [thinkingPhase, setThinkingPhase] = useState<
    "idle" | "thinking" | "tool" | "writing" | "reasoning"
  >("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  // ========== 🧠 IA STATES (V8) ==========
  const [learnedPatterns, setLearnedPatterns] = useState<LearningPattern[]>(DEFAULT_PATTERNS);
  const [longTermMemory, setLongTermMemory] = useState<MemoryEntry[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>({
    avgResponseTime: 0,
    successRate: 0,
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    toolsUsedCount: {},
    commonPatterns: [],
    lastOptimization: Date.now()
  });
  const [currentReasoning, setCurrentReasoning] = useState<ReasoningStep[]>([]);
  const [showReasoning, setShowReasoning] = useState(false);
  const [learningEnabled, setLearningEnabled] = useState(true);
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(true);
  
  // ========== V8 EXTREME STATES ==========
  const [threatForecasts, setThreatForecasts] = useState<ThreatForecast[]>([]);
  const [stealthLevel, setStealthLevel] = useState(100);
  const [panicMode, setPanicMode] = useState(false);
  const [attackNodes, setAttackNodes] = useState<AttackNode[]>([
    { id: 'agent', type: 'agent', label: 'NOVA-CORE', status: 'active', pos: { x: 50, y: 50 } }
  ]);
  const [attackLinks, setAttackLinks] = useState<AttackLink[]>([]);
  const [networkTraffic, setNetworkTraffic] = useState<number[]>(Array(20).fill(0));

  // ============================================================
  // 🚀 V9 SUPREME INTEGRATED STATES
  // ============================================================
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>({
    baseUrl: "http://127.0.0.1:11434",
    model: "dolphin-llama3",
    enabled: true
  });
  const [autoModeEnabled, setAutoModeEnabled] = useState(false);
  const [screenAnalysis, setScreenAnalysis] = useState<ScreenAnalysis | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [commandLog, setCommandLog] = useState<string[]>([]);

  // ========== OTHER V8 STATES ==========
  const [toolStats, setToolStats] = useState<Record<string, ToolStat>>({});
  const [keywords, setKeywords] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [lastFailedMsg, setLastFailedMsg] = useState<string | null>(null);
  const [voiceLang, setVoiceLang] = useState("ar-SA");
  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const lastSpokenLenRef = useRef(0);
  const [planMode, setPlanMode] = useState(false);
  const [sessionFiles, setSessionFiles] = useState<SessionFile[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<SessionFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // 🚀 V9 INTEGRATED LOGIC FUNCTIONS
  // ============================================================

  /**
   * Integrated Ollama Caller
   */
  const callOllama = async (prompt: string): Promise<string> => {
    setAiThinking(true);
    let result = "";
    try {
      await streamOllamaViaServer({
        messages: [{ role: "user", content: prompt }],
        model: ollamaConfig.model,
        onToken: (token) => { result += token; },
      });
      setAiThinking(false);
      return result || "No response";
    } catch (e) {
      setAiThinking(false);
      return `Ollama Error: ${e instanceof Error ? e.message : "Connection failed"}`;
    }
  };

  /**
   * Integrated System Command Executor
   */
  const runSystemCmd = async (cmd: string) => {
    setCommandLog(prev => [...prev, `> ${cmd}`]);
    try {
      const res = await fetch("/api/system/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd })
      });
      const data = await res.json();
      setLines(arr => [...arr, { role: "tool_result", text: `Command Output:\n${data.output || "Success"}` }]);
    } catch (e) {
      setLines(arr => [...arr, { role: "tool_result", text: `Execution Failed`, isError: true }]);
    }
  };

  /**
   * Integrated Screen Analyzer
   */
  const analyzeScreen = async () => {
    setLines(arr => [...arr, { role: "system", text: "👁️ Analyzing screen content..." }]);
    try {
      const res = await fetch("/api/system/screenshot");
      const blob = await res.blob();
      // Placeholder for OCR - In real env this calls a backend OCR service
      const analysis = await callOllama("Based on this screen capture, what should be the next step?");
      setLines(arr => [...arr, { role: "assistant", text: `Screen Analysis Result:\n${analysis}` }]);
    } catch (e) {
      setLines(arr => [...arr, { role: "system", text: "Screen capture failed", isError: true }]);
    }
  };

  /**
   * Semantic Vector Search Placeholder
   */
  const semanticSearch = async (query: string) => {
    const results = longTermMemory.filter(m => m.query.includes(query));
    if (results.length > 0) {
      setLines(arr => [...arr, { role: "system", text: `🔍 Found in memory:\n${results.map(r => `- ${r.query}`).join("\n")}` }]);
    }
  };

  // ============================================================
  // 🧠 ORIGINAL V8 FUNCTIONS (PRESERVED 100%)
  // ============================================================

  const generateReasoningChain = useCallback(
    async (userQuery: string, context: string[]): Promise<ReasoningStep[]> => {
      const steps: ReasoningStep[] = [];
      const words = userQuery.match(/\b\w+\b/g) || [];

      for (let i = 0; i < Math.min(3, words.length); i++) {
        const word = words[i];
        const matchedPattern = learnedPatterns.find((p) => p.pattern.test(word));

        steps.push({
          step: i + 1,
          thought: matchedPattern ? `Pattern found: ${matchedPattern.id}` : `Analyzing: ${word}`,
          action: matchedPattern ? matchedPattern.solution.slice(0, 50) : "Continue",
          expectedOutcome: "Refinement",
          confidence: matchedPattern ? 0.9 : 0.5,
        });
      }
      return steps;
    },
    [learnedPatterns]
  );

  const triggerPanic = () => {
    setPanicMode(!panicMode);
    setLines(arr => [...arr, { role: "system", text: panicMode ? "🛡️ Panic OFF" : "🔒 Panic ON" }]);
  };

  const updatePerformanceMetrics = useCallback((success: boolean, tool?: string, duration?: number) => {
    setPerformanceMetrics(prev => {
      const next = { ...prev };
      next.totalTasks += 1;
      if (success) next.successfulTasks += 1;
      else next.failedTasks += 1;
      next.successRate = (next.successfulTasks / next.totalTasks) * 100;
      if (tool) next.toolsUsedCount[tool] = (next.toolsUsedCount[tool] || 0) + 1;
      if (duration) next.avgResponseTime = (next.avgResponseTime + duration) / 2;
      return next;
    });
  }, []);

  // ========== V8 PERSISTENCE & INITIALIZATION ==========
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (saved) { try { const p = JSON.parse(saved); if (Array.isArray(p)) setLines(p); } catch (e) {} }
    
    const savedPatterns = localStorage.getItem(STORAGE_KEYS.LEARNED_PATTERNS);
    if (savedPatterns) { try { const p = JSON.parse(savedPatterns); if (Array.isArray(p)) setLearnedPatterns(p); } catch (e) {} }

    const savedPerf = localStorage.getItem(STORAGE_KEYS.PERFORMANCE);
    if (savedPerf) { try { const p = JSON.parse(savedPerf); setPerformanceMetrics(p); } catch (e) {} }
    
    // V9 Supreme Config
    const savedOllama = localStorage.getItem(STORAGE_KEYS.OLLAMA_CONFIG);
    if (savedOllama) { try { setOllamaConfig(JSON.parse(savedOllama)); } catch (e) {} }

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(lines.slice(-50)));
    localStorage.setItem(STORAGE_KEYS.LEARNED_PATTERNS, JSON.stringify(learnedPatterns));
    localStorage.setItem(STORAGE_KEYS.PERFORMANCE, JSON.stringify(performanceMetrics));
    localStorage.setItem(STORAGE_KEYS.OLLAMA_CONFIG, JSON.stringify(ollamaConfig));
  }, [lines, learnedPatterns, performanceMetrics, ollamaConfig]);

  // ========== V8 CORE LOGIC ==========
  const notify = (title: string, body: string) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  };

  const extractKeywords = (text: string) => {
    KEYWORD_PATTERNS.forEach(p => {
      const m = text.match(p);
      if (m) setKeywords(prev => Array.from(new Set([...prev, ...m])).slice(-10));
    });
  };

  const refreshFiles = async (sid: number) => {
    try {
      const r = await fetch(`${API_BASE}/live-agent/sessions/${sid}/files`);
      if (r.ok) setSessionFiles(await r.json());
    } catch {}
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const r = await fetch(`${API_BASE}/live-agent/sessions/${sessionId}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, mimeType: file.type, contentBase64: base64 })
        });
        if (r.ok) {
          const meta = await r.json();
          setPendingAttachments(a => [...a, meta]);
          setLines(a => [...a, { role: "system", text: `📎 Attached: ${file.name}` }]);
        }
      };
      reader.readAsDataURL(file);
    } catch {}
  };

  const speak = (text: string) => {
    if (!voiceOn || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voiceLang;
    window.speechSynthesis.speak(u);
  };

  const startListening = () => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = voiceLang;
    rec.onresult = (e: any) => setInput(e.results[0][0].transcript);
    rec.onend = () => { setListening(false); if (input) send(input); };
    rec.start();
    setListening(true);
  };

  // bootstrap
  useEffect(() => {
    fetch(`${API_BASE}/live-agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nova Session" })
    }).then(r => r.json()).then(s => { setSessionId(s.id); refreshFiles(s.id); }).catch(() => {});
  }, []);

  // auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, busy, currentTool]);

  // ========== V9 INTEGRATED SEND LOGIC ==========
  const send = async (explicitText?: string) => {
    const text = explicitText ?? input;
    if (!text.trim() || !sessionId) return;
    if (!explicitText) setInput("");

    const start = Date.now();
    setBusy(true);
    setThinkingPhase("reasoning");
    setLines(arr => [...arr, { role: "user", text }]);

    // ✨ V9 COMMANDS INTERCEPTION
    if (text.startsWith("!think")) {
      const res = await callOllama(text.replace("!think", ""));
      setLines(arr => [...arr, { role: "assistant", text: `🧠 AI Thought:\n${res}` }]);
      setBusy(false);
      return;
    }
    if (text.startsWith("!cmd") || text.startsWith("!open")) {
      await runSystemCmd(text.replace(/!cmd|!open/g, "").trim());
      setBusy(false);
      return;
    }
    if (text.startsWith("!screen")) {
      await analyzeScreen();
      setBusy(false);
      return;
    }
    if (text.startsWith("!search")) {
      await semanticSearch(text.replace("!search", "").trim());
      setBusy(false);
      return;
    }

    // V8 Reasoning
    const chain = await generateReasoningChain(text, lines.slice(-3).map(l => l.text));
    setCurrentReasoning(chain);
    
    setThinkingPhase("thinking");

    try {
      const r = await fetch(`${API_BASE}/live-agent/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, planMode })
      });
      if (!r.ok) throw new Error(`API ${r.status}`);

      const reader = r.body?.getReader();
      if (!reader) throw new Error("No stream");

      let buf = ""; let pendingEvent: string | null = null;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        const parts = new TextDecoder().decode(value).split("\n");
        for (const p of parts) {
          if (!p.trim()) continue;
          if (p.startsWith("event: ")) { pendingEvent = p.slice(7).trim(); continue; }
          if (p.startsWith("data: ")) {
            const ds = p.slice(6).trim(); if (!ds) continue;
            try {
              const d = JSON.parse(ds) as Record<string, unknown>;
              if (pendingEvent === "delta") {
                buf += String(d["text"] ?? "");
                setThinkingPhase("writing");
                setLines(a => {
                  const last = a[a.length - 1];
                  if (last?.role === "assistant") return [...a.slice(0, -1), { ...last, text: buf }];
                  return [...a, { role: "assistant", text: buf }];
                });
              } else if (pendingEvent === "tool_call") {
                setThinkingPhase("tool");
                setCurrentTool({ name: String(d["name"] ?? "tool"), input: JSON.stringify(d["input"]), startedAt: Date.now() });
                setLines(a => [...a, { role: "tool", text: `تشغيل: ${String(d["name"] ?? "")}` }]);
              } else if (pendingEvent === "tool_result") {
                setCurrentTool(null);
                setLines(a => [...a, { role: "tool_result", text: `${String(d["name"] ?? "")} اكتمل`, isError: Boolean(d["isError"]) }]);
              } else if (pendingEvent === "done") {
                if (buf) speak(buf);
                setBusy(false); setThinkingPhase("idle"); setCurrentTool(null);
                updatePerformanceMetrics(true, "api", Date.now() - start);
                setLongTermMemory(prev => [...prev, { id: `m-${Date.now()}`, query: text, response: buf, toolsUsed: [], success: true, timestamp: Date.now() }].slice(-100));
                setPendingAttachments([]);
              } else if (pendingEvent === "error") {
                setLines(a => [...a, { role: "system", text: `خطأ: ${String(d["error"] ?? "خطأ")}`, isError: true }]);
                setBusy(false); setThinkingPhase("idle");
              }
            } catch {}
            pendingEvent = null;
          }
        }
      }
    } catch {
      setLines(a => [...a, { role: "assistant", text: "Error connecting to core", isError: true }]);
      setBusy(false); setThinkingPhase("idle");
    }
  };

  return (
    <div className={`flex h-screen bg-background text-foreground overflow-hidden ${panicMode ? 'blur-2xl grayscale' : ''} transition-all duration-500`}>
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-border bg-card/30 backdrop-blur-xl flex flex-col shrink-0">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
              <Bot className="w-6 h-6 text-primary" />
            </div>
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background animate-pulse" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">NOVA SENTINEL</h1>
            <p className="text-[10px] text-muted-foreground font-mono">SUPREME-V9-ALL-IN-ONE</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4 px-2">التحكم المركزي</div>
          
          <button onClick={() => setPlanMode(false)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${!planMode ? 'bg-primary/10 text-primary border border-primary/20' : 'hover:bg-primary/5 text-muted-foreground'}`}>
            <Zap className="w-4 h-4" />
            <span className="text-xs font-medium">الاشتباك التلقائي</span>
          </button>
          
          <button onClick={() => setPlanMode(true)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${planMode ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' : 'hover:bg-primary/5 text-muted-foreground'}`}>
            <ListChecks className="w-4 h-4" />
            <span className="text-xs font-medium">وضع التخطيط</span>
          </button>

          <button onClick={() => setShowReasoning(!showReasoning)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${showReasoning ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'hover:bg-primary/5 text-muted-foreground'}`}>
            <Brain className="w-4 h-4" />
            <span className="text-xs font-medium">سجل التفكير</span>
          </button>

          {/* ✨ V9 INTEGRATED CONTROLS */}
          <div className="pt-6 border-t border-white/10 mt-4">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4 px-2">V9 Supreme Tools</div>
            
            <button onClick={() => void send("!think فكر في تحليل أمني للنظام")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-purple-500/10 text-purple-400 transition-all">
              <Sparkles className="w-4 h-4" />
              <span className="text-xs font-medium">AI Reasoning</span>
            </button>

            <button onClick={() => void send("!screen")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-cyan-500/10 text-cyan-400 transition-all">
              <Eye className="w-4 h-4" />
              <span className="text-xs font-medium">Vision Analyze</span>
            </button>

            <button onClick={() => setAutoModeEnabled(!autoModeEnabled)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${autoModeEnabled ? 'bg-green-500/10 text-green-400' : 'text-muted-foreground'}`}>
              {autoModeEnabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span className="text-xs font-medium">Autonomous</span>
            </button>
          </div>

          <div className="pt-6">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4 px-2">أدوات الجذر</div>
            <button onClick={() => onClientTool({ id: 'q-sc', name: 'ui_open_window', input: { window: 'scanner' } })} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-primary/5 text-muted-foreground transition-all">
              <ScanLine className="w-4 h-4" />
              <span className="text-xs font-medium">الماسح الضوئي</span>
            </button>
            <button onClick={triggerPanic} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-rose-500/10 text-rose-400 transition-all">
              <EyeOff className="w-4 h-4" />
              <span className="text-xs font-medium">وضع التخفي / PANIC</span>
            </button>
          </div>
        </nav>

        {/* Stats Footer */}
        <div className="p-4 border-t border-border bg-black/20">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">معدل النجاح</span>
              <span className="text-[10px] font-mono text-emerald-400">{performanceMetrics.successRate.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${performanceMetrics.successRate}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">وضع التخفي</span>
              <span className={`text-[10px] font-mono ${stealthLevel > 70 ? 'text-cyan-400' : 'text-rose-400'}`}>{stealthLevel}%</span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <div className={`h-full transition-all duration-500 ${stealthLevel > 70 ? 'bg-cyan-500' : 'bg-rose-500'}`} style={{ width: `${stealthLevel}%` }} />
            </div>
            
            {/* V9 Supreme Badge */}
            <div className="pt-2 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${aiThinking ? 'bg-purple-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-[9px] font-bold text-muted-foreground uppercase">Ollama Local AI</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative min-w-0 bg-gradient-to-br from-background to-card/20">
        {/* Top Header Bar */}
        <header className="h-16 border-b border-border flex items-center justify-between px-6 shrink-0 bg-background/50 backdrop-blur-md z-20">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-tighter">OLLAMA-{ollamaConfig.model.toUpperCase()}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-4 overflow-x-auto max-w-md scrollbar-hide">
              {keywords.map((kw, i) => (
                <span key={i} className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap border border-primary/20">
                  #{kw}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">V9 Supreme All-In-One</span>
              <span className="text-[9px] text-emerald-400 font-mono">INTEGRATED // LOCAL-LLM</span>
            </div>
            <button onClick={() => setVoiceOn(!voiceOn)} className={`p-2 rounded-xl transition-all ${voiceOn ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground hover:text-primary'}`}>
              {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Dashboard Panels */}
        <div className="flex-1 flex overflow-hidden p-6 gap-6">
          {/* Left: Chat & Reasoning */}
          <div className="flex-1 flex flex-col gap-6 min-w-0">
            {/* Chat Thread */}
            <div className="flex-1 bg-card/20 border border-border rounded-3xl flex flex-col overflow-hidden shadow-inner shadow-black/40">
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar scroll-smooth">
                {lines.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-40">
                    <div className="relative">
                      <Radar className="w-20 h-20 text-primary animate-spin-slow" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <ShieldCheck className="w-8 h-8 text-primary" />
                      </div>
                    </div>
                    <div className="max-w-sm">
                      <h3 className="text-lg font-bold text-foreground">المنظومة المتكاملة V9 جاهزة</h3>
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                        تم دمج جميع التقنيات في هذا الملف:
                        <br/> • !think [سؤال] - تفكير AI محلي
                        <br/> • !cmd [أمر] - تنفيذ أوامر نظام
                        <br/> • !screen - تحليل الشاشة
                        <br/> • !search [كلمة] - بحث في الذاكرة
                      </p>
                    </div>
                  </div>
                )}
                
                {lines.map((l, i) => (
                  <div key={i} className={`flex flex-col ${l.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}>
                    <div className={`max-w-[85%] rounded-3xl px-5 py-4 ${
                      l.role === 'user' 
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 rounded-tr-none' 
                        : l.role === 'tool' || l.role === 'tool_result'
                        ? 'bg-black/40 border border-white/5 font-mono text-[10px] text-cyan-400 rounded-tl-none'
                        : l.role === 'system'
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-tl-none mx-auto'
                        : 'bg-card border border-border shadow-xl rounded-tl-none'
                    }`}>
                      <div className="prose prose-invert prose-xs max-w-none prose-p:leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{l.text}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}

                {busy && (
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">
                      {thinkingPhase === 'reasoning' && 'التفكير...'}
                      {thinkingPhase === 'thinking' && 'جاري المعالجة...'}
                      {thinkingPhase === 'tool' && `تشغيل أداة: ${currentTool?.name}...`}
                      {thinkingPhase === 'writing' && 'كتابة الرد...'}
                    </span>
                  </div>
                )}
              </div>

              {/* Input Area */}
              <div className="border-t border-border p-4 bg-background/50 backdrop-blur-sm">
                <div className="flex gap-3">
                  <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary">
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <input ref={fileInputRef} type="file" onChange={onPickFile} className="hidden" />
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void send()}
                    placeholder="اكتب أمرك هنا... (!think, !cmd, !screen, !search)"
                    className="flex-1 bg-card/50 border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    disabled={busy}
                  />
                  <button onClick={() => void send()} disabled={busy || !input.trim()} className="p-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground">
                    <Send className="w-5 h-5" />
                  </button>
                  <button onClick={listening ? () => {} : startListening} className={`p-2 rounded-lg transition-colors ${listening ? 'bg-rose-500/20 text-rose-400' : 'hover:bg-primary/10 text-muted-foreground'}`}>
                    {listening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Integrated Logs */}
          <div className="w-80 flex flex-col gap-6 min-w-0">
            {/* Command Log */}
            <div className="bg-card/20 border border-border rounded-3xl p-4 overflow-hidden flex flex-col max-h-[300px]">
              <div className="flex items-center gap-2 mb-3">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold text-cyan-400 uppercase">System Logs</h3>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
                {commandLog.map((log, i) => (
                  <div key={i} className="text-[9px] font-mono text-muted-foreground break-all">{log}</div>
                ))}
                {commandLog.length === 0 && <div className="text-[9px] text-muted-foreground italic">No system activity...</div>}
              </div>
            </div>

            {/* Reasoning Display */}
            {showReasoning && currentReasoning.length > 0 && (
              <div className="bg-card/20 border border-border rounded-3xl p-4 overflow-y-auto max-h-64 custom-scrollbar">
                <h3 className="text-xs font-bold text-primary mb-3 uppercase">سلسلة التفكير</h3>
                <div className="space-y-2">
                  {currentReasoning.map((step) => (
                    <div key={step.step} className="text-[10px] space-y-1 p-2 bg-black/20 rounded border border-white/5">
                      <div className="text-amber-400 font-mono">Step {step.step}</div>
                      <div className="text-muted-foreground">{step.thought}</div>
                      <div className="text-primary">{step.action}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-card/20 border border-border rounded-3xl p-4">
              <h3 className="text-xs font-bold text-primary mb-3 uppercase">إجراءات سريعة</h3>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => void send(action.prompt)}
                    className={`p-3 rounded-xl text-[10px] font-bold transition-all border bg-gradient-to-br ${action.hue} hover:shadow-lg`}
                    title={action.hint}
                  >
                    <action.icon className="w-4 h-4 mx-auto mb-1" />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
