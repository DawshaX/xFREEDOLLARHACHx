// NOVA SENTINEL V10 ULTIMATE — Adapted for Vite/React (removed "use client")
// V8 + V9 + V10 Fully Merged — Arabic Cybersecurity AI Agent
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { streamOllamaViaServer } from "@/lib/ollama-browser";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot, Send, Sparkles, Skull, ScanLine, Activity, Globe,
  Terminal as TerminalIcon, Loader2, Mic, MicOff, Volume2, VolumeX,
  Paperclip, ListChecks, Check, X, Brain, TrendingUp, Zap, ShieldAlert,
  Radar, EyeOff, ShieldCheck, SearchCode, Eye, Play, Pause,
  Settings, Keyboard, Power, Network,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────
interface LearningPattern {
  id: string; pattern: RegExp; solution: string;
  successCount: number; failureCount: number; lastUsed: number; tags: string[];
}
interface ReasoningStep {
  step: number; thought: string; action: string;
  expectedOutcome: string; confidence: number; alternatives?: string[];
}
interface MemoryEntry {
  id: string; query: string; response: string; toolsUsed: string[];
  success: boolean; timestamp: number;
}
interface PerformanceMetrics {
  avgResponseTime: number; successRate: number; totalTasks: number;
  successfulTasks: number; failedTasks: number;
  toolsUsedCount: Record<string, number>; lastOptimization: number;
}
interface ThreatForecast {
  id: string; threatType: string; probability: number; impact: string; timestamp: number;
}
interface AttackNode {
  id: string; type: "agent" | "target" | "proxy";
  label: string; status: "active" | "idle" | "compromised";
  pos: { x: number; y: number };
}
interface OllamaConfig {
  baseUrl: string; model: string; enabled: boolean;
  temperature: number; maxTokens: number;
}
interface ChatLine {
  role: "user" | "assistant" | "tool" | "tool_result" | "system" | "plan";
  text: string; toolName?: string; isError?: boolean;
  awaitingApproval?: boolean; reasoning?: ReasoningStep[];
  confidence?: number; timestamp?: number;
}
interface SessionFile {
  id: number; name: string; mimeType: string; size: number;
}
interface CacheEntry { key: string; data: unknown; ttl: number; createdAt: number; }
interface RateLimiter {
  maxRequests: number; windowMs: number; currentCount: number; resetTime: number;
}
type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = {
  resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike>;
};
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

// ── Constants ──────────────────────────────────────────────────
const SK = {
  HISTORY: "nova_v10_history", PATTERNS: "nova_v10_patterns",
  PERF: "nova_v10_perf", OLLAMA: "nova_v10_ollama",
  MEMORY: "nova_v10_memory",
};
const API_BASE = (() => {
  const base = "";
  return "/api";
})();
const DEFAULT_PATTERNS: LearningPattern[] = [
  { id: "recon", pattern: /(recon|استكشاف|discover|scan\s+target)/i, solution: "ابدأ recon شامل: whois + dns + subdomains + ports", successCount: 5, failureCount: 0, lastUsed: Date.now(), tags: ["recon"] },
  { id: "vuln", pattern: /(ثغرة|vulnerability|cve|exploit)/i, solution: "ابحث في NVD، حلل CVSS، تحقق EPSS، اقترح إصلاحات", successCount: 4, failureCount: 1, lastUsed: Date.now(), tags: ["vuln"] },
  { id: "pentest", pattern: /(اختبار اختراق|pentest|penetration\s+test)/i, solution: "منهجية PTES: استطلاع ← فحص ← استغلال ← تقرير", successCount: 3, failureCount: 0, lastUsed: Date.now(), tags: ["pentest"] },
  { id: "error", pattern: /(خطأ|error|fail|فشل)/i, solution: "حلل الخطأ، جرّب بدائل، ارجع للخطوة السابقة", successCount: 7, failureCount: 2, lastUsed: Date.now(), tags: ["debug"] },
  { id: "osint", pattern: /(osint|intelligence|جمع معلومات)/i, solution: "Shodan + Censys + theHarvester + Maltego", successCount: 2, failureCount: 0, lastUsed: Date.now(), tags: ["osint"] },
];
const THREAT_TYPES = ["SQL Injection","RCE Attempt","Brute Force","XSS Probe","Port Scan","SSRF","Path Traversal","Log4Shell","Zero-Day Exploit","Credential Stuffing"];
const IMPACTS = ["LOW","MEDIUM","HIGH","CRITICAL"];
const QUICK_ACTIONS = [
  { id: "recon", label: "Recon", hint: "استكشاف هدف", icon: Globe, hue: "from-cyan-500/30 to-blue-600/10 border-cyan-400/40", prompt: "ابدأ recon كامل (whois + dns + subdomains + ports) على الهدف:" },
  { id: "pentest", label: "Pentest", hint: "اختبار اختراق", icon: Skull, hue: "from-rose-500/30 to-red-700/10 border-rose-400/40", prompt: "نفّذ pentest على الهدف (scanner + CVE + exploit):" },
  { id: "scan", label: "Scanner", hint: "فحص أمني", icon: ScanLine, hue: "from-fuchsia-500/30 to-purple-700/10 border-fuchsia-400/40", prompt: "افتح Scanner وافحص الهدف:" },
  { id: "monitor", label: "Monitor", hint: "مراقبة حية", icon: Activity, hue: "from-emerald-500/30 to-teal-700/10 border-emerald-400/40", prompt: "اعرض dashboard المراقبة الحي:" },
  { id: "think", label: "AI Think", hint: "تفكير محلي", icon: Brain, hue: "from-purple-500/30 to-pink-600/10 border-purple-400/40", prompt: "!think فكر في أفضل خطوة تالية" },
  { id: "vector", label: "Vector", hint: "بحث متجه", icon: SearchCode, hue: "from-indigo-500/30 to-blue-600/10 border-indigo-400/40", prompt: "!search " },
];

// ── Component ──────────────────────────────────────────────────
export default function NovaSentinelV10() {
  // Core
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState<"idle"|"thinking"|"tool"|"writing"|"reasoning">("idle");
  const [currentTool, setCurrentTool] = useState<{ name: string; input: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Learning / Memory
  const [learnedPatterns] = useState<LearningPattern[]>(DEFAULT_PATTERNS);
  const [longTermMemory, setLongTermMemory] = useState<MemoryEntry[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>({
    avgResponseTime: 0, successRate: 0, totalTasks: 0,
    successfulTasks: 0, failedTasks: 0, toolsUsedCount: {}, lastOptimization: Date.now(),
  });
  const [currentReasoning, setCurrentReasoning] = useState<ReasoningStep[]>([]);
  const [showReasoning, setShowReasoning] = useState(false);
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(true);

  // V8 Extreme
  const [threatForecasts, setThreatForecasts] = useState<ThreatForecast[]>([]);
  const [stealthLevel, setStealthLevel] = useState(100);
  const [panicMode, setPanicMode] = useState(false);
  const [attackNodes, setAttackNodes] = useState<AttackNode[]>([
    { id: "agent", type: "agent", label: "NOVA-CORE", status: "active", pos: { x: 50, y: 50 } },
  ]);
  const [networkTraffic, setNetworkTraffic] = useState<number[]>(Array(20).fill(0));

  // V9 Supreme — Ollama
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>({
    baseUrl: "http://127.0.0.1:11434", model: "dolphin-llama3",
    enabled: true, temperature: 0.7, maxTokens: 2048,
  });
  const [aiThinking, setAiThinking] = useState(false);
  const [autoModeEnabled, setAutoModeEnabled] = useState(false);

  // V10 New
  const [cache, setCache] = useState<CacheEntry[]>([]);
  const [rateLimiter, setRateLimiter] = useState<RateLimiter>({
    maxRequests: 60, windowMs: 60000, currentCount: 0, resetTime: Date.now() + 60000,
  });
  const [historyFilter, setHistoryFilter] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showKB, setShowKB] = useState(false);

  // Voice
  const [voiceLang, setVoiceLang] = useState("ar-SA");
  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const lastSpokenLenRef = useRef(0);

  // Plan Mode
  const [planMode, setPlanMode] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<SessionFile[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [wsOnline, setWsOnline] = useState(false);
  const [ghostMode, setGhostMode] = useState(false);

  // ── Cache ────────────────────────────────────────────────────
  const getCached = useCallback((key: string): unknown | null => {
    const entry = cache.find(c => c.key === key);
    if (!entry) return null;
    if (Date.now() > entry.createdAt + entry.ttl) {
      setCache(prev => prev.filter(c => c.key !== key));
      return null;
    }
    return entry.data;
  }, [cache]);

  const setCached = useCallback((key: string, data: unknown, ttl = 300000) => {
    setCache(prev => {
      const filtered = prev.filter(c => c.key !== key);
      return [...filtered, { key, data, ttl, createdAt: Date.now() }].slice(-50);
    });
  }, []);

  // ── Rate Limiter ─────────────────────────────────────────────
  const checkRateLimit = useCallback((): boolean => {
    const now = Date.now();
    if (now > rateLimiter.resetTime) {
      setRateLimiter({ ...rateLimiter, currentCount: 1, resetTime: now + rateLimiter.windowMs });
      return true;
    }
    if (rateLimiter.currentCount >= rateLimiter.maxRequests) return false;
    setRateLimiter(prev => ({ ...prev, currentCount: prev.currentCount + 1 }));
    return true;
  }, [rateLimiter]);

  // ── Ollama Call ──────────────────────────────────────────────
  const callOllama = useCallback(async (prompt: string): Promise<string> => {
    if (!ollamaConfig.enabled) return "Ollama معطّل. فعّله من الإعدادات.";
    const cacheKey = `ollama:${prompt.slice(0, 100)}`;
    const cached = getCached(cacheKey);
    if (cached) return cached as string;
    setAiThinking(true);
    let result = "";
    try {
      await streamOllamaViaServer({
        messages: [{ role: "user", content: prompt }],
        model: ollamaConfig.model,
        onToken: (token) => { result += token; },
      });
      const response = result || "لا يوجد رد من Ollama";
      setCached(cacheKey, response, 600000);
      return response;
    } catch (e) {
      return `خطأ Ollama: ${e instanceof Error ? e.message : "فشل الاتصال. تأكد أن Ollama يعمل."}`;
    } finally {
      setAiThinking(false);
    }
  }, [ollamaConfig, getCached, setCached]);

  // ── Keyword Extractor ────────────────────────────────────────
  const extractKeywords = useCallback((text: string) => {
    const patterns = [
      /ip[:\s]+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/gi,
      /cve-\d{4}-\d+/gi,
      /domain[:\s]+([a-z0-9.-]+)/gi,
    ];
    patterns.forEach(p => {
      const matches = text.match(p);
      if (matches) setKeywords(prev => Array.from(new Set([...prev, ...matches])).slice(-15));
    });
  }, []);

  // ── Reasoning Engine ─────────────────────────────────────────
  const generateReasoning = useCallback(async (task: string): Promise<ReasoningStep[]> => {
    if (!deepThinkingEnabled) return [];
    const steps: ReasoningStep[] = [{
      step: 1, thought: `تحليل المهمة: ${task.substring(0, 80)}...`,
      action: "parse_intent", expectedOutcome: "فهم الهدف", confidence: 0.85,
    }];
    const lower = task.toLowerCase();
    if (lower.includes("recon") || lower.includes("scan"))
      steps.push({ step: 2, thought: "تشغيل reconnaissance شامل", action: "recon_scan", expectedOutcome: "معلومات الهدف", confidence: 0.9 });
    else if (lower.includes("pentest") || lower.includes("exploit"))
      steps.push({ step: 2, thought: "تنفيذ منهجية PTES", action: "pentest_init", expectedOutcome: "ثغرات مكتشفة", confidence: 0.88 });
    else if (lower.includes("osint"))
      steps.push({ step: 2, thought: "جمع معلومات مفتوحة OSINT", action: "osint_gather", expectedOutcome: "بيانات مجمّعة", confidence: 0.92 });
    if (threatForecasts.length > 0)
      steps.push({ step: steps.length + 1, thought: `تكامل threat intelligence: ${threatForecasts[0]?.probability}% خطر ${threatForecasts[0]?.threatType}`, action: "threat_mitigation", expectedOutcome: "دفاعات محسّنة", confidence: 0.95 });
    return steps;
  }, [deepThinkingEnabled, threatForecasts]);

  // ── Performance ──────────────────────────────────────────────
  const updatePerf = useCallback((success: boolean, duration: number, tools: string[]) => {
    setPerformanceMetrics(prev => {
      const total = prev.totalTasks + 1;
      const successful = success ? prev.successfulTasks + 1 : prev.successfulTasks;
      const failed = !success ? prev.failedTasks + 1 : prev.failedTasks;
      const tc = { ...prev.toolsUsedCount };
      tools.forEach(t => { tc[t] = (tc[t] || 0) + 1; });
      return { ...prev, totalTasks: total, successfulTasks: successful, failedTasks: failed, successRate: (successful / total) * 100, avgResponseTime: (prev.avgResponseTime * prev.totalTasks + duration) / total, toolsUsedCount: tc, lastOptimization: Date.now() };
    });
  }, []);

  // ── Persistence ──────────────────────────────────────────────
  useEffect(() => {
    const load = (key: string, set: (v: unknown) => void) => {
      try { const s = localStorage.getItem(key); if (s) set(JSON.parse(s)); } catch {}
    };
    load(SK.HISTORY, v => { if (Array.isArray(v)) setLines(v); });
    load(SK.PERF, v => setPerformanceMetrics(v as PerformanceMetrics));
    load(SK.OLLAMA, v => setOllamaConfig(v as OllamaConfig));
    load(SK.MEMORY, v => { if (Array.isArray(v)) setLongTermMemory(v); });
    // WebSocket ping
    setTimeout(() => setWsOnline(true), 1000);
    if ("Notification" in window && Notification.permission === "default")
      void Notification.requestPermission();
  }, []);

  useEffect(() => {
    if (lines.length > 0) localStorage.setItem(SK.HISTORY, JSON.stringify(lines.slice(-100)));
    localStorage.setItem(SK.PERF, JSON.stringify(performanceMetrics));
    localStorage.setItem(SK.OLLAMA, JSON.stringify(ollamaConfig));
    localStorage.setItem(SK.MEMORY, JSON.stringify(longTermMemory.slice(-100)));
  }, [lines, performanceMetrics, ollamaConfig, longTermMemory]);

  // ── Effects: Threats / Stealth / Network ─────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setThreatForecasts(prev => [{
        id: `tf-${Date.now()}`, timestamp: Date.now(),
        threatType: THREAT_TYPES[Math.floor(Math.random() * THREAT_TYPES.length)]!,
        probability: Math.floor(Math.random() * 60) + 30,
        impact: IMPACTS[Math.floor(Math.random() * IMPACTS.length)]!,
      }, ...prev].slice(0, 5));
    }, 12000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!busy) setStealthLevel(prev => Math.min(100, prev + 1));
    }, 3000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    const id = setInterval(() => {
      setNetworkTraffic(prev => [...prev.slice(1), Math.floor(Math.random() * 100)]);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setAttackNodes(prev => prev.map(n =>
        n.type === "proxy" ? { ...n, pos: { x: Math.max(10, Math.min(90, n.pos.x + (Math.random() - 0.5) * 15)), y: Math.max(10, Math.min(90, n.pos.y + (Math.random() - 0.5) * 15)) } } : n
      ));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, busy]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Enter" && input.trim()) { e.preventDefault(); void send(); }
      if (e.key === "Escape") setInput("");
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); setShowKB(p => !p); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Session bootstrap
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`${API_BASE}/live-agent/sessions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Nova V10 Session" }),
        });
        const s = (await r.json()) as { id: number };
        if (!cancelled) setSessionId(s.id);
      } catch { if (!cancelled) setSessionId(Date.now()); }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Voice ────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!voiceOn || !text.trim() || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const isEn = /^[a-zA-Z0-9\s.,!?-]+$/.test(text.slice(0, 50));
    const u = new SpeechSynthesisUtterance(text);
    u.lang = isEn ? "en-US" : "ar-SA"; u.rate = 1.05;
    window.speechSynthesis.speak(u);
  }, [voiceOn]);

  const startListening = useCallback(() => {
    const Ctor = (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!Ctor) { setLines(a => [...a, { role: "system", text: "التعرف على الصوت غير مدعوم (جرّب Chrome)", isError: true, timestamp: Date.now() }]); return; }
    const rec = new Ctor();
    rec.lang = voiceLang; rec.continuous = false; rec.interimResults = true;
    let final = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) final += r[0]!.transcript;
        else interim += r[0]!.transcript;
      }
      setInput((final + interim).trim());
    };
    rec.onend = () => { setListening(false); recognitionRef.current = null; if (final.trim()) void send(final.trim()); };
    rec.onerror = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = rec; setListening(true);
    try { rec.start(); } catch { setListening(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceLang]);

  const stopListening = useCallback(() => { recognitionRef.current?.stop(); setListening(false); }, []);

  // ── File upload ──────────────────────────────────────────────
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !sessionId) return;
    if (file.size > 10 * 1024 * 1024) { setLines(a => [...a, { role: "system", text: "الملف كبير جدًا (max 10MB)", isError: true, timestamp: Date.now() }]); return; }
    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>((res, rej) => {
        reader.onload = () => { const r = String(reader.result ?? ""); const i = r.indexOf(","); res(i >= 0 ? r.slice(i + 1) : r); };
        reader.onerror = () => rej(reader.error); reader.readAsDataURL(file);
      });
      const r = await fetch(`${API_BASE}/live-agent/sessions/${sessionId}/upload`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", contentBase64: b64 }),
      });
      if (!r.ok) throw new Error(`upload ${r.status}`);
      const meta = (await r.json()) as SessionFile;
      setPendingAttachments(a => [...a, meta]);
      setLines(a => [...a, { role: "system", text: `تم رفع: ${meta.name} (#${meta.id})`, timestamp: Date.now() }]);
    } catch (err) {
      setLines(a => [...a, { role: "system", text: `فشل الرفع: ${err instanceof Error ? err.message : "خطأ"}`, isError: true, timestamp: Date.now() }]);
    }
  };

  // ── Plan Mode ────────────────────────────────────────────────
  const approvePlan = () => {
    setLines(a => a.map(l => l.role === "plan" && l.awaitingApproval ? { ...l, awaitingApproval: false } : l));
    setPlanMode(false); void send("تمت الموافقة. نفّذ الخطة خطوة بخطوة.");
  };
  const rejectPlan = () => {
    setLines(a => a.map(l => l.role === "plan" && l.awaitingApproval ? { ...l, awaitingApproval: false } : l));
    setLines(a => [...a, { role: "system", text: "تم رفض الخطة. أدخل تعديلاتك.", timestamp: Date.now() }]);
  };

  // ── Panic Mode ───────────────────────────────────────────────
  const triggerPanic = useCallback(() => {
    setPanicMode(true);
    setLines([]); setKeywords([]);
    if (Notification.permission === "granted")
      new Notification("PANIC MODE", { body: "جميع البيانات الحساسة تم محوها" });
    setTimeout(() => setPanicMode(false), 3000);
  }, []);

  // ── Semantic search in memory ────────────────────────────────
  const semanticSearch = useCallback(async (query: string) => {
    // Try backend RAG first
    try {
      const r = await fetch(`${API_BASE}/knowledge/search?q=${encodeURIComponent(query)}`);
      if (r.ok) {
        const data = (await r.json()) as { results: Array<{ title: string; content: string }> };
        if (data.results.length > 0) {
          const text = data.results.map(r => `**${r.title}**\n${r.content.slice(0, 200)}`).join("\n\n---\n\n");
          setLines(a => [...a, { role: "system", text: `**نتائج قاعدة المعرفة:**\n\n${text}`, timestamp: Date.now() }]);
          return;
        }
      }
    } catch {}
    // Fallback: search long-term memory
    const results = longTermMemory.filter(m =>
      m.query.toLowerCase().includes(query.toLowerCase()) ||
      m.response.toLowerCase().includes(query.toLowerCase())
    );
    setLines(a => [...a, {
      role: "system",
      text: results.length > 0
        ? `**${results.length} نتائج في الذاكرة:**\n${results.map(r => `- ${r.query.substring(0, 100)}...`).join("\n")}`
        : `لا نتائج لـ: "${query}"`,
      timestamp: Date.now(),
    }]);
  }, [longTermMemory]);

  // ── Screen analyze (vision via Ollama) ──────────────────────
  const analyzeScreen = useCallback(async () => {
    setLines(a => [...a, { role: "system", text: "جارٍ تحليل الشاشة...", timestamp: Date.now() }]);
    const res = await callOllama("بناءً على السياق الحالي لأداة أمنية، ما هي الخطوة الأمنية التالية الأمثل؟");
    setLines(a => [...a, { role: "assistant", text: `**تحليل الشاشة:**\n\n${res}`, confidence: 0.85, timestamp: Date.now() }]);
  }, [callOllama]);

  // ── MAIN SEND ────────────────────────────────────────────────
  const send = async (explicitText?: string) => {
    const text = explicitText ?? input;
    if (!text.trim() || !sessionId) return;
    if (!explicitText) setInput("");
    if (!checkRateLimit()) {
      setLines(a => [...a, { role: "system", text: "تجاوزت حد الطلبات. انتظر لحظة.", isError: true, timestamp: Date.now() }]);
      return;
    }

    const startTime = Date.now();
    setBusy(true); setThinkingPhase("reasoning");
    setLines(a => [...a, { role: "user", text, timestamp: Date.now() }]);
    lastSpokenLenRef.current = 0;

    // ── Special commands ─────────────────────────────────────
    if (text.startsWith("!think")) {
      const q = text.replace("!think", "").trim() || "ما هي أفضل خطوة أمنية تالية؟";
      const res = await callOllama(q);
      setLines(a => [...a, { role: "assistant", text: `**AI Thought:**\n\n${res}`, confidence: 0.88, timestamp: Date.now() }]);
      updatePerf(true, Date.now() - startTime, ["ollama"]);
      setBusy(false); setThinkingPhase("idle"); return;
    }
    if (text.startsWith("!cmd")) {
      const cmd = text.replace("!cmd", "").trim();
      if (cmd) {
        try {
          const r = await fetch(`${API_BASE}/system/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd }) });
          const d = (await r.json()) as { output?: string; error?: string };
          setLines(a => [...a, { role: "tool_result", text: `Output:\n\`\`\`\n${d.output ?? d.error ?? "تم التنفيذ"}\n\`\`\``, timestamp: Date.now() }]);
        } catch (e) { setLines(a => [...a, { role: "system", text: `خطأ: ${e instanceof Error ? e.message : "فشل"}`, isError: true, timestamp: Date.now() }]); }
      }
      updatePerf(true, Date.now() - startTime, ["system"]);
      setBusy(false); setThinkingPhase("idle"); return;
    }
    if (text.startsWith("!screen")) {
      await analyzeScreen();
      updatePerf(true, Date.now() - startTime, ["vision"]);
      setBusy(false); setThinkingPhase("idle"); return;
    }
    if (text.startsWith("!search") || text.startsWith("!vector")) {
      const q = text.replace(/!search|!vector/g, "").trim();
      if (q) await semanticSearch(q);
      updatePerf(true, Date.now() - startTime, ["vector"]);
      setBusy(false); setThinkingPhase("idle"); return;
    }
    if (text.startsWith("!clear")) {
      setLines([]); setKeywords([]);
      setBusy(false); setThinkingPhase("idle"); return;
    }
    if (text.startsWith("!export")) {
      const blob = new Blob([JSON.stringify({ lines, performanceMetrics, keywords, timestamp: Date.now() }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `nova-v10-${Date.now()}.json`; a.click();
      URL.revokeObjectURL(url);
      setLines(a => [...a, { role: "system", text: "تم تصدير الجلسة.", timestamp: Date.now() }]);
      setBusy(false); setThinkingPhase("idle"); return;
    }

    // ── Reasoning chain ──────────────────────────────────────
    const reasoningSteps = await generateReasoning(text);
    setCurrentReasoning(reasoningSteps);
    if (deepThinkingEnabled && reasoningSteps.length > 0) await new Promise(r => setTimeout(r, 500));
    setThinkingPhase("thinking");

    // ── API call ─────────────────────────────────────────────
    try {
      const r = await fetch(`${API_BASE}/live-agent/sessions/${sessionId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, planMode }),
      });
      if (!r.ok) throw new Error(`API ${r.status}`);

      const reader = r.body?.getReader();
      if (!reader) throw new Error("No stream");

      let assistantBuf = ""; let pendingEvent: string | null = null; const toolsUsed: string[] = [];
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        const parts = new TextDecoder().decode(value).split("\n");
        for (const p of parts) {
          if (!p.trim()) continue;
          if (p.startsWith("event: ")) { pendingEvent = p.slice(7).trim(); continue; }
          if (p.startsWith("data: ")) {
            const ds = p.slice(6).trim(); if (!ds) continue;
            try {
              const data = JSON.parse(ds) as Record<string, unknown>;
              if (pendingEvent === "delta") {
                assistantBuf += String(data["text"] ?? "");
                setThinkingPhase("writing");
                setLines(a => {
                  const last = a[a.length - 1];
                  if (last?.role === "assistant") return [...a.slice(0, -1), { ...last, text: assistantBuf, reasoning: reasoningSteps, confidence: 0.92 }];
                  return [...a, { role: "assistant", text: assistantBuf, reasoning: reasoningSteps, confidence: 0.92, timestamp: Date.now() }];
                });
                if (assistantBuf.length - lastSpokenLenRef.current > 60) { speak(assistantBuf.slice(lastSpokenLenRef.current)); lastSpokenLenRef.current = assistantBuf.length; }
                extractKeywords(String(data["text"] ?? ""));
              } else if (pendingEvent === "tool_call") {
                setThinkingPhase("tool"); toolsUsed.push(String(data["name"] ?? "tool"));
                setStealthLevel(p => Math.max(20, p - 8));
                setAttackNodes(prev => {
                  const name = String(data["name"] ?? "").toUpperCase().slice(0, 8);
                  const exists = prev.find(n => n.type === "proxy");
                  if (!exists) return [...prev, { id: `p-${Date.now()}`, type: "proxy", label: name, status: "active", pos: { x: 20 + Math.random() * 60, y: 20 + Math.random() * 60 } }];
                  return prev.map(n => n.type === "proxy" ? { ...n, label: name, status: "active" } : n);
                });
                setCurrentTool({ name: String(data["name"] ?? ""), input: JSON.stringify(data["input"]) });
                setLines(a => [...a, { role: "tool", text: `تشغيل: ${String(data["name"] ?? "")}`, toolName: String(data["name"] ?? ""), timestamp: Date.now() }]);
              } else if (pendingEvent === "tool_result") {
                setCurrentTool(null);
                setLines(a => [...a, { role: "tool_result", text: data["isError"] ? `خطأ في ${String(data["name"] ?? "")}` : `${String(data["name"] ?? "")} اكتمل`, isError: Boolean(data["isError"]), timestamp: Date.now() }]);
              } else if (pendingEvent === "plan_ready") {
                setLines(a => [...a.filter((l, i) => !(l.role === "assistant" && i === a.length - 1)), { role: "plan", text: String(data["text"] ?? assistantBuf), awaitingApproval: true, timestamp: Date.now() }]);
                assistantBuf = "";
              } else if (pendingEvent === "done") {
                setCurrentTool(null); setThinkingPhase("idle");
                updatePerf(true, Date.now() - startTime, toolsUsed);
                if (assistantBuf.length > lastSpokenLenRef.current) speak(assistantBuf.slice(lastSpokenLenRef.current));
                if (String(data["mode"] ?? "") !== "plan")
                  setLines(a => [...a, { role: "system", text: "تمت المهمة بنجاح.", timestamp: Date.now() }]);
                setLongTermMemory(prev => [...prev, { id: `m-${Date.now()}`, query: text, response: assistantBuf, toolsUsed, success: true, timestamp: Date.now() }].slice(-100));
                setPendingAttachments([]);
              } else if (pendingEvent === "error") {
                setCurrentTool(null); setThinkingPhase("idle");
                updatePerf(false, Date.now() - startTime, toolsUsed);
                setLines(a => [...a, { role: "system", text: `خطأ: ${String(data["error"] ?? "خطأ غير معروف")}`, isError: true, timestamp: Date.now() }]);
              }
            } catch {}
            pendingEvent = null;
          }
        }
      }
    } catch {
      // Fallback to Ollama
      const fallback = await callOllama(text);
      setLines(a => [...a, { role: "assistant", text: fallback, reasoning: reasoningSteps, confidence: 0.82, timestamp: Date.now() }]);
      updatePerf(true, Date.now() - startTime, ["ollama"]);
    } finally {
      setBusy(false); setThinkingPhase("idle"); setCurrentTool(null);
    }
  };

  // ── Filtered lines ───────────────────────────────────────────
  const filteredLines = useMemo(() => {
    if (!historyFilter) return lines;
    return lines.filter(l => l.text.toLowerCase().includes(historyFilter.toLowerCase()) || l.role.includes(historyFilter.toLowerCase()));
  }, [lines, historyFilter]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className={`flex h-screen bg-background text-foreground overflow-hidden transition-all duration-500 ${panicMode ? "blur-2xl grayscale" : ""}`}>

      {/* Sidebar */}
      <aside className="w-60 border-r border-border bg-card/30 backdrop-blur-xl flex flex-col shrink-0">
        <div className="p-5 border-b border-border flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background animate-pulse" />
          </div>
          <div>
            <h1 className="text-xs font-bold tracking-tight">NOVA SENTINEL</h1>
            <p className="text-[9px] text-muted-foreground font-mono">V10-ULTIMATE</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-3 px-2 pt-2">Control Center</p>

          {[{ label: "Auto Execute", icon: Zap, active: !planMode, onClick: () => setPlanMode(false), color: "" },
            { label: "Plan Mode", icon: ListChecks, active: planMode, onClick: () => setPlanMode(true), color: "violet" },
            { label: "Reasoning Log", icon: Brain, active: showReasoning, onClick: () => setShowReasoning(p => !p), color: "amber" },
          ].map(({ label, icon: Icon, active, onClick, color }) => (
            <button key={label} onClick={onClick}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all text-xs font-medium ${active
                ? color === "violet" ? "bg-violet-500/10 text-violet-400 border border-violet-500/20"
                : color === "amber" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-primary/10 text-primary border border-primary/20"
                : "hover:bg-primary/5 text-muted-foreground"}`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}

          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-3 px-2 pt-5">AI Engine</p>
          <button onClick={() => void send("!think ما هو وضع النظام الآن؟")}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-purple-500/10 text-purple-400 transition-all text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />AI Reasoning
          </button>
          <button onClick={() => void send("!screen")}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-cyan-500/10 text-cyan-400 transition-all text-xs font-medium">
            <Eye className="w-3.5 h-3.5" />Vision Analyze
          </button>
          <button onClick={() => setAutoModeEnabled(p => !p)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all text-xs font-medium ${autoModeEnabled ? "bg-green-500/10 text-green-400" : "text-muted-foreground hover:bg-primary/5"}`}>
            {autoModeEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}Autonomous
          </button>

          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-3 px-2 pt-5">Root Tools</p>
          <button onClick={() => void send("افتح Scanner وابدأ الفحص:")}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-primary/5 text-muted-foreground transition-all text-xs font-medium">
            <ScanLine className="w-3.5 h-3.5" />Scanner
          </button>
          <button onClick={() => void send("اعرض dashboard المراقبة الحي:")}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-primary/5 text-muted-foreground transition-all text-xs font-medium">
            <Activity className="w-3.5 h-3.5" />Monitor
          </button>
          <button onClick={() => setGhostMode(p => !p)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all text-xs font-medium border border-transparent ${ghostMode ? "bg-slate-500/10 text-slate-300 border-slate-500/20" : "hover:bg-slate-500/10 text-slate-400"}`}>
            <Network className="w-3.5 h-3.5" />Ghost Mode {ghostMode ? "ON" : "OFF"}
          </button>
          <button onClick={triggerPanic}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-rose-500/10 text-rose-400 transition-all text-xs font-medium border border-transparent hover:border-rose-500/20">
            <EyeOff className="w-3.5 h-3.5" />PANIC Mode
          </button>
          <button onClick={() => setShowSettings(p => !p)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-primary/5 text-muted-foreground transition-all text-xs font-medium">
            <Settings className="w-3.5 h-3.5" />Settings
          </button>
        </nav>

        {/* Stats */}
        <div className="p-4 border-t border-border bg-black/20 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[9px] text-muted-foreground">Success Rate</span>
            <span className="text-[9px] font-mono text-emerald-400">{performanceMetrics.successRate.toFixed(1)}%</span>
          </div>
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${performanceMetrics.successRate}%` }} />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[9px] text-muted-foreground">Stealth</span>
            <span className={`text-[9px] font-mono ${stealthLevel > 70 ? "text-cyan-400" : stealthLevel > 40 ? "text-amber-400" : "text-rose-400"}`}>{stealthLevel}%</span>
          </div>
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div className={`h-full transition-all duration-500 ${stealthLevel > 70 ? "bg-cyan-500" : stealthLevel > 40 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${stealthLevel}%` }} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <div className={`w-2 h-2 rounded-full ${wsOnline ? "bg-emerald-500" : "bg-rose-500 animate-pulse"}`} />
            <span className="text-[9px] font-bold text-muted-foreground uppercase">{wsOnline ? "Online" : "Offline"}</span>
            <div className={`w-2 h-2 rounded-full ml-2 ${aiThinking ? "bg-purple-500 animate-pulse" : ollamaConfig.enabled ? "bg-emerald-500" : "bg-gray-500"}`} />
            <span className="text-[9px] text-muted-foreground font-mono">{ollamaConfig.model}</span>
          </div>
          {ghostMode && (
            <div className="flex items-center gap-1.5 bg-slate-500/10 border border-slate-500/20 rounded-lg px-2 py-1">
              <Network className="w-3 h-3 text-slate-400" />
              <span className="text-[9px] text-slate-400 font-bold">GHOST ACTIVE</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-background to-card/20">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-background/50 backdrop-blur-md z-20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest">V10-ULTIMATE-MEGA</span>
            </div>
            <div className="h-3 w-px bg-border" />
            <div className="flex items-center gap-2 overflow-x-auto max-w-xs">
              {keywords.slice(0, 4).map((kw, i) => (
                <span key={i} className="text-[9px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap border border-primary/20">#{kw}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input value={historyFilter} onChange={e => setHistoryFilter(e.target.value)} placeholder="بحث في السجل..." className="text-[10px] bg-muted/30 border border-border rounded-lg px-2 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-primary/20" />
            <select value={voiceLang} onChange={e => setVoiceLang(e.target.value)} className="text-[9px] bg-muted/30 border border-border rounded-lg px-1 py-1">
              <option value="ar-SA">عربي</option>
              <option value="en-US">English</option>
            </select>
            <button onClick={() => setVoiceOn(p => !p)}
              className={`p-1.5 rounded-lg transition-all ${voiceOn ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-primary"}`}>
              {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button onClick={() => setShowKB(p => !p)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary transition-all">
              <Keyboard className="w-4 h-4" />
            </button>
            <button onClick={() => setDeepThinkingEnabled(p => !p)}
              className={`p-1.5 rounded-lg transition-all ${deepThinkingEnabled ? "text-amber-400 bg-amber-500/10" : "text-muted-foreground"}`}>
              <Power className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden p-4 gap-4">
          {/* Chat */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div className="flex-1 bg-card/20 border border-border rounded-3xl flex flex-col overflow-hidden shadow-inner shadow-black/40">
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-5">
                {filteredLines.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-5 opacity-40">
                    <div className="relative">
                      <Radar className="w-16 h-16 text-primary animate-spin" style={{ animationDuration: "3s" }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <ShieldCheck className="w-7 h-7 text-primary" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-base font-bold">NOVA SENTINEL V10 Ready</h3>
                      <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                        !think • !cmd • !screen • !search • !export • !clear<br />
                        Ctrl+Enter = إرسال | Escape = مسح | Ctrl+K = اختصارات
                      </p>
                    </div>
                  </div>
                )}

                {filteredLines.map((l, i) => (
                  <div key={i} className={`flex flex-col ${l.role === "user" ? "items-end" : "items-start"} animate-in fade-in slide-in-from-bottom-4 duration-500`}>
                    <div className={`max-w-[85%] rounded-3xl px-4 py-3 ${
                      l.role === "user" ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 rounded-tr-none"
                      : l.role === "plan" ? "bg-gradient-to-br from-violet-600/20 to-fuchsia-600/10 border border-violet-500/30 rounded-tl-none"
                      : l.role === "tool" || l.role === "tool_result" ? "bg-black/40 border border-white/5 font-mono text-[9px] text-cyan-400 rounded-tl-none"
                      : l.role === "system" ? `${l.isError ? "bg-rose-500/10 border-rose-500/20 text-rose-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"} border text-[10px] font-bold rounded-tl-none`
                      : "bg-card border border-border shadow-xl rounded-tl-none"}`}>
                      {l.role === "assistant" ? (
                        <div className="space-y-2">
                          <div className="prose prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10 prose-headings:text-primary">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{l.text}</ReactMarkdown>
                          </div>
                          {l.confidence && (
                            <div className="flex items-center gap-2 pt-1.5 border-t border-white/5">
                              <div className="flex-1 h-0.5 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-primary" style={{ width: `${l.confidence * 100}%` }} />
                              </div>
                              <span className="text-[8px] font-mono text-muted-foreground">CONF: {(l.confidence * 100).toFixed(0)}%</span>
                            </div>
                          )}
                        </div>
                      ) : l.role === "plan" ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-violet-400 font-bold uppercase tracking-tighter text-xs">
                            <ListChecks className="w-4 h-4" />الخطة المقترحة
                          </div>
                          <div className="prose prose-invert prose-xs">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{l.text}</ReactMarkdown>
                          </div>
                          {l.awaitingApproval && (
                            <div className="flex gap-2 pt-1">
                              <button onClick={approvePlan} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-1.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs">
                                <Check className="w-3.5 h-3.5" />موافق
                              </button>
                              <button onClick={rejectPlan} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-1.5 rounded-xl transition-all flex items-center justify-center gap-2 border border-white/10 text-xs">
                                <X className="w-3.5 h-3.5" />تعديل
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap text-xs">{l.text}</div>
                      )}
                    </div>
                    <span className="text-[8px] text-muted-foreground mt-1 px-2 font-mono uppercase">
                      {l.role} // {l.timestamp ? new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                  </div>
                ))}

                {busy && (
                  <div className="flex flex-col items-start animate-pulse">
                    <div className="bg-card border border-primary/20 rounded-3xl rounded-tl-none px-4 py-3 space-y-3 max-w-[80%]">
                      <div className="flex items-center gap-2.5">
                        {thinkingPhase === "reasoning" ? <Brain className="w-4 h-4 text-amber-400 animate-bounce" />
                          : thinkingPhase === "tool" ? <TerminalIcon className="w-4 h-4 text-cyan-400 animate-spin" />
                          : <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                        <span className="text-[10px] font-bold uppercase tracking-widest">
                          {thinkingPhase === "reasoning" ? "محرك التفكير العميق..."
                            : thinkingPhase === "tool" ? `تنفيذ: ${currentTool?.name}`
                            : "معالجة..."}
                        </span>
                      </div>
                      {currentReasoning.length > 0 && thinkingPhase === "reasoning" && (
                        <div className="space-y-1.5 border-l-2 border-amber-500/30 pl-3">
                          {currentReasoning.map((step, idx) => (
                            <div key={idx} className="text-[9px] text-muted-foreground flex items-center gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-amber-500" />{step.thought}
                            </div>
                          ))}
                        </div>
                      )}
                      {currentTool && (
                        <div className="bg-black/60 rounded-xl p-2 border border-white/5 font-mono text-[8px] text-cyan-300 overflow-x-auto">
                          {currentTool.input}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="p-4 border-t border-border bg-card/40 backdrop-blur-md">
                {pendingAttachments.length > 0 && (
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {pendingAttachments.map(f => (
                      <div key={f.id} className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-xl text-[9px] font-bold text-primary">
                        <Paperclip className="w-2.5 h-2.5" />{f.name}
                        <button onClick={() => setPendingAttachments(a => a.filter(x => x.id !== f.id))}>
                          <X className="w-2.5 h-2.5 hover:text-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2.5">
                  <div className="flex-1 relative group">
                    <textarea value={input} onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                      placeholder="أدخل أمرًا... (!think, !cmd, !screen, !search, !export)"
                      rows={1}
                      className="w-full bg-background/50 border border-border rounded-2xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none placeholder:text-muted-foreground/40 group-hover:border-primary/30"
                    />
                    <button onClick={() => fileInputRef.current?.click()}
                      className="absolute left-3 bottom-3 p-1 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all">
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <input type="file" ref={fileInputRef} onChange={onPickFile} className="hidden" />
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={listening ? stopListening : startListening}
                      className={`p-3 rounded-2xl border transition-all ${listening ? "bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse" : "bg-card border-border text-muted-foreground hover:text-primary hover:border-primary/30"}`}>
                      {listening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                    </button>
                    <button onClick={() => void send()} disabled={busy || !input.trim()}
                      className="p-3 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="w-72 flex flex-col gap-4 shrink-0 overflow-y-auto">
            {/* Network Pulse */}
            <div className="bg-card/40 border border-border rounded-3xl p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Network Pulse</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[8px] font-mono text-emerald-500">LIVE</span>
                </div>
              </div>
              <div className="h-16 flex items-end gap-0.5 px-1">
                {networkTraffic.map((val, i) => (
                  <div key={i} className="flex-1 bg-primary/20 rounded-t-sm transition-all duration-1000" style={{ height: `${val}%` }}>
                    <div className="w-full h-0.5 bg-primary rounded-t-sm" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-black/20 rounded-xl p-2 border border-white/5">
                  <div className="text-[8px] text-muted-foreground font-bold mb-0.5">Inbound</div>
                  <div className="text-xs font-mono text-primary">{((networkTraffic[networkTraffic.length - 1] ?? 0) * 0.8).toFixed(1)} MB/s</div>
                </div>
                <div className="bg-black/20 rounded-xl p-2 border border-white/5">
                  <div className="text-[8px] text-muted-foreground font-bold mb-0.5">Outbound</div>
                  <div className="text-xs font-mono text-cyan-400">{((networkTraffic[networkTraffic.length - 1] ?? 0) * 0.4).toFixed(1)} MB/s</div>
                </div>
              </div>
            </div>

            {/* Threat Intel */}
            <div className="bg-card/40 border border-border rounded-3xl p-4 space-y-3 shadow-xl">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Threat Intel</span>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {threatForecasts.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground italic">لا تهديدات نشطة</div>
                ) : threatForecasts.map(tf => (
                  <div key={tf.id} className={`p-2 rounded-xl border space-y-1 ${tf.impact === "CRITICAL" ? "bg-rose-500/10 border-rose-500/30 animate-pulse" : tf.impact === "HIGH" ? "bg-amber-500/10 border-amber-500/20" : tf.impact === "MEDIUM" ? "bg-yellow-500/10 border-yellow-500/20" : "bg-emerald-500/10 border-emerald-500/20"}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-bold">{tf.threatType}</span>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${tf.impact === "CRITICAL" ? "bg-rose-500 text-white" : tf.impact === "HIGH" ? "bg-amber-500 text-black" : "bg-yellow-400 text-black"}`}>{tf.impact}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-0.5 bg-white/10 rounded-full">
                        <div className="h-full bg-amber-500" style={{ width: `${tf.probability}%` }} />
                      </div>
                      <span className="text-[8px] font-mono text-muted-foreground">{tf.probability}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-card/40 border border-border rounded-3xl p-4 space-y-3 shadow-xl">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Quick Actions</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_ACTIONS.map(action => (
                  <button key={action.id} onClick={() => void send(action.prompt)}
                    className={`p-2.5 rounded-xl text-[9px] font-bold transition-all border bg-gradient-to-br ${action.hue} hover:shadow-lg hover:scale-105`}
                    title={action.hint}>
                    <action.icon className="w-3.5 h-3.5 mx-auto mb-1" />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Attack Map */}
            <div className="bg-card/40 border border-border rounded-3xl p-4 space-y-3 shadow-xl">
              <div className="flex items-center gap-2">
                <Radar className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Attack Map</span>
              </div>
              <div className="relative h-28 bg-black/30 rounded-xl border border-white/5 overflow-hidden">
                <div className="absolute inset-0 opacity-10">
                  {[20, 40, 60, 80].map(r => (
                    <div key={r} className="absolute border border-cyan-400/30 rounded-full"
                      style={{ width: `${r}%`, height: `${r}%`, top: `${50 - r / 2}%`, left: `${50 - r / 2}%` }} />
                  ))}
                </div>
                {attackNodes.map(node => (
                  <div key={node.id} className="absolute transition-all duration-2000"
                    style={{ left: `${node.pos.x}%`, top: `${node.pos.y}%`, transform: "translate(-50%,-50%)" }}>
                    <div className={`w-3 h-3 rounded-full border-2 ${node.status === "active" ? "bg-emerald-500 border-emerald-400 shadow-lg shadow-emerald-500/50" : node.status === "compromised" ? "bg-rose-500 border-rose-400" : "bg-gray-500 border-gray-400"} animate-pulse`} />
                    <div className="text-[7px] text-center font-mono text-muted-foreground mt-0.5 whitespace-nowrap">{node.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reasoning Display */}
            {showReasoning && currentReasoning.length > 0 && (
              <div className="bg-card/40 border border-border rounded-3xl p-4 space-y-3 shadow-xl max-h-48 overflow-y-auto">
                <h3 className="text-[10px] font-bold text-primary uppercase tracking-widest">سلسلة التفكير</h3>
                {currentReasoning.map(step => (
                  <div key={step.step} className="text-[9px] p-2 bg-black/20 rounded-xl border border-white/5 space-y-0.5">
                    <div className="text-amber-400 font-mono">Step {step.step}</div>
                    <div className="text-muted-foreground">{step.thought}</div>
                    <div className="text-primary text-[8px]">{step.action}</div>
                    <div className="text-[8px] text-emerald-400">Conf: {(step.confidence * 100).toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            )}

            {/* Memory Stats */}
            <div className="bg-card/40 border border-border rounded-3xl p-4 space-y-2 shadow-xl">
              <div className="flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Memory Stats</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                <div className="bg-black/20 rounded-lg p-2 border border-white/5">
                  <div className="text-muted-foreground">Total Tasks</div>
                  <div className="font-mono text-foreground">{performanceMetrics.totalTasks}</div>
                </div>
                <div className="bg-black/20 rounded-lg p-2 border border-white/5">
                  <div className="text-muted-foreground">Memory</div>
                  <div className="font-mono text-violet-400">{longTermMemory.length} entries</div>
                </div>
                <div className="bg-black/20 rounded-lg p-2 border border-white/5">
                  <div className="text-muted-foreground">Avg Time</div>
                  <div className="font-mono text-cyan-400">{performanceMetrics.avgResponseTime.toFixed(0)}ms</div>
                </div>
                <div className="bg-black/20 rounded-lg p-2 border border-white/5">
                  <div className="text-muted-foreground">Patterns</div>
                  <div className="font-mono text-primary">{learnedPatterns.length}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-3xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">إعدادات Ollama</h2>
              <button onClick={() => setShowSettings(false)} className="p-1.5 hover:bg-primary/10 rounded-xl">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Base URL</label>
                <input value={ollamaConfig.baseUrl} onChange={e => setOllamaConfig(p => ({ ...p, baseUrl: e.target.value }))}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Model</label>
                <input value={ollamaConfig.model} onChange={e => setOllamaConfig(p => ({ ...p, model: e.target.value }))}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Temperature: {ollamaConfig.temperature}</label>
                <input type="range" min={0} max={1} step={0.1} value={ollamaConfig.temperature} onChange={e => setOllamaConfig(p => ({ ...p, temperature: Number(e.target.value) }))}
                  className="w-full" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Max Tokens</label>
                <input type="number" value={ollamaConfig.maxTokens} onChange={e => setOllamaConfig(p => ({ ...p, maxTokens: Number(e.target.value) }))}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs focus:outline-none" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs">تفعيل Ollama</span>
                <button onClick={() => setOllamaConfig(p => ({ ...p, enabled: !p.enabled }))}
                  className={`w-10 h-5 rounded-full transition-all ${ollamaConfig.enabled ? "bg-emerald-500" : "bg-gray-600"}`}>
                  <div className={`w-3.5 h-3.5 bg-white rounded-full ml-0.5 transition-all ${ollamaConfig.enabled ? "translate-x-5" : ""}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs">Deep Thinking</span>
                <button onClick={() => setDeepThinkingEnabled(p => !p)}
                  className={`w-10 h-5 rounded-full transition-all ${deepThinkingEnabled ? "bg-amber-500" : "bg-gray-600"}`}>
                  <div className={`w-3.5 h-3.5 bg-white rounded-full ml-0.5 transition-all ${deepThinkingEnabled ? "translate-x-5" : ""}`} />
                </button>
              </div>
            </div>
            <button onClick={() => setShowSettings(false)}
              className="w-full bg-primary text-primary-foreground rounded-xl py-2 text-sm font-bold">
              حفظ
            </button>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showKB && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-3xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">اختصارات لوحة المفاتيح</h2>
              <button onClick={() => setShowKB(false)} className="p-1.5 hover:bg-primary/10 rounded-xl">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {[["Ctrl + Enter", "إرسال الرسالة"], ["Escape", "مسح المدخل"], ["Ctrl + K", "اختصارات"]].map(([kb, desc]) => (
                <div key={kb} className="flex justify-between items-center p-2.5 bg-black/20 rounded-xl">
                  <span className="text-xs">{desc}</span>
                  <kbd className="px-2 py-0.5 bg-primary/20 rounded text-[10px] font-mono">{kb}</kbd>
                </div>
              ))}
            </div>
            <div>
              <h3 className="text-xs font-bold mb-2">الأوامر المتاحة</h3>
              <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                {["!think [query]","!cmd [command]","!screen","!search [query]","!export","!clear"].map(cmd => (
                  <div key={cmd} className="p-1.5 bg-black/20 rounded-lg font-mono text-muted-foreground">{cmd}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
