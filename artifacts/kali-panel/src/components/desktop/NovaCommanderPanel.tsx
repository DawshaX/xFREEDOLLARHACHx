/**
 * Nova Commander — نسخة طبق الأصل من تبويب KALI AI في LiveAgentPanel
 * كل الصلاحيات مفتوحة — تنفيذ أي أمر على الجهاز المتصل بدون قيود
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal, Brain, Zap, Activity, RefreshCw, Trash2,
  ChevronRight, Loader2, X, Search, Download, Camera,
  Skull, Monitor, ChevronDown, Wifi, WifiOff, Radio,
  Folder, FolderOpen, FolderUp, FileCode, Play,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = (p: string) => `/api${p}`;

// ── Types ──────────────────────────────────────────────────────────────────────
type KaliPhase = "idle" | "thinking" | "planning" | "writing" | "executing" | "analyzing";
type DolphinRole = "user" | "assistant" | "system" | "tool_result" | "plan";

interface DolphinLine {
  role: DolphinRole;
  text: string;
  isError?: boolean;
  awaitingApproval?: boolean;
}

interface KaliTask {
  id: string;
  title: string;
  description: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  command?: string;
  result?: string;
  error?: string;
  type?: string;
  risk?: string;
  agentId?: string;
  createdAt: number;
}

interface AgentInfo {
  id: string;
  hostname: string;
  platform: string;
  user: string;
  connectedAt: number;
  capabilities?: string[];
}

interface RemoteLine {
  kind: "cmd" | "stdout" | "stderr" | "system" | "error";
  text: string;
  ts: number;
}

interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mode?: string;
}

interface KaliMemory {
  id: string;
  memoryType: string;
  key: string;
  content: string;
  tags?: string;
}

// ── Quick Mission buttons ──────────────────────────────────────────────────────
const MISSIONS = [
  { label: "☠ هويتي", prompt: "من أنا؟ اجمع كل المعلومات: [AGENT_EXEC: id && whoami && uname -a && hostname && ip addr show 2>/dev/null | head -30] وحلّل النتائج بالتفصيل" },
  { label: "🌐 Nmap", prompt: "نفّذ مسح nmap شامل: [AGENT_EXEC: nmap -sV -sC -T4 --top-ports 1000 localhost 2>&1 | tail -50]" },
  { label: "🔍 PrivEsc", prompt: "فحص رفع الصلاحيات: [AGENT_EXEC: id && sudo -l 2>/dev/null && find / -perm -4000 -type f 2>/dev/null | head -20 && getcap -r / 2>/dev/null | head -10]" },
  { label: "💥 Web Fuzz", prompt: "فحص مسارات الويب: [AGENT_EXEC: gobuster dir -u http://localhost -w /usr/share/wordlists/dirb/common.txt -t 30 -x php,html,txt,bak 2>&1 | tail -40]" },
  { label: "🔐 Shadow", prompt: "قراءة الملفات الحساسة: [AGENT_EXEC: cat /etc/shadow 2>/dev/null | head -10 && cat /etc/passwd | grep -v nologin | head -10]" },
  { label: "📡 OSINT", prompt: "فحص OSINT: [AGENT_EXEC: whois localhost 2>&1 | head -20 && dig localhost ANY +short && ip addr show]" },
  { label: "🧠 ذاكرة", prompt: "راجع كل المعرفة المحفوظة في ذاكرتي وقدّم ملخصاً تحليلياً شاملاً: الاكتشافات، الأنماط، CVEs، التوصيات" },
  { label: "⚡ مستقل", prompt: "ابدأ وضع الاستقلالية الكاملة: قيّم النظام الآن، ابحث عن الثغرات، خطط للهجوم، نفّذ تلقائياً وأبلغني بكل خطوة" },
  { label: "📁 ملفات حساسة", prompt: "[AGENT_EXEC: find / -name '*.conf' -o -name '*.key' -o -name '*.pem' -o -name 'id_rsa' 2>/dev/null | head -20 && ls -la ~/.ssh/ 2>/dev/null]" },
  { label: "🔍 Full Recon", prompt: "نفّذ استطلاعاً كاملاً: [AGENT_EXEC: nmap -sV -sC -T4 --top-ports 1000 localhost 2>&1 | tail -50 && id && whoami && uname -a && ss -tulpn 2>/dev/null | head -20]" },
];

const QUICK_CMDS = [
  "whoami", "id", "hostname", "uname -a", "ip addr", "ss -tulpn",
  "ps aux --sort=-%cpu | head -12", "df -h", "free -h",
  "cat /etc/os-release", "netstat -tulpn 2>/dev/null",
  "nmap -sV --top-ports 20 localhost 2>&1", "which nmap nikto gobuster sqlmap hydra",
  "find / -perm -4000 -type f 2>/dev/null | head -10",
  "cat /etc/passwd | head -20", "sudo -l 2>/dev/null",
  "env", "history | tail -20", "cat /etc/hosts",
  "curl -s https://ifconfig.me",
];

// ── Main Component ─────────────────────────────────────────────────────────────
export function NovaCommanderPanel() {
  // ── Sub-tab ─────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"dolphin" | "shell" | "files" | "processes" | "screenshot" | "dashboard">("dolphin");

  // ── Agent connection ─────────────────────────────────────────────────────────
  const [agentConnected, setAgentConnected] = useState(false);
  const [agentList, setAgentList] = useState<AgentInfo[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [target, setTarget] = useState("127.0.0.1");

  // ── Dolphin AI state ─────────────────────────────────────────────────────────
  const [lines, setLines] = useState<DolphinLine[]>([
    { role: "system", text: "☠ NOVA COMMANDER — KALI AI جاهز. جميع الصلاحيات مفتوحة." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<KaliPhase>("idle");
  const [phaseLabel, setPhaseLabel] = useState("");
  const sessionId = useRef(`nova-cmd-${Date.now()}`);
  const abortRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // ── Tasks ───────────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<KaliTask[]>([]);
  const [showTasks, setShowTasks] = useState(true);

  // ── AI model / ngrok ────────────────────────────────────────────────────────
  const [aiOnline, setAiOnline] = useState(false);
  const [aiModel, setAiModel] = useState("dolphin-llama3:latest");
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);

  // ── Shell tab ───────────────────────────────────────────────────────────────
  const [shellLines, setShellLines] = useState<RemoteLine[]>([
    { kind: "system", text: "Nova Commander Shell — جاهز", ts: Date.now() },
  ]);
  const [shellInput, setShellInput] = useState("");
  const [shellBusy, setShellBusy] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const shellScrollRef = useRef<HTMLDivElement>(null);

  // ── Files tab ───────────────────────────────────────────────────────────────
  const [fsDir, setFsDir] = useState("~");
  const [fsEntries, setFsEntries] = useState<FsEntry[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FsEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // ── Processes tab ───────────────────────────────────────────────────────────
  const [processes, setProcesses] = useState<Array<{ pid: string; user: string; cpu: string; mem: string; command: string }>>([]);
  const [procsLoading, setProcsLoading] = useState(false);
  const [procSearch, setProcSearch] = useState("");

  // ── Screenshot tab ──────────────────────────────────────────────────────────
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  // ── Memory ──────────────────────────────────────────────────────────────────
  const [memories, setMemories] = useState<KaliMemory[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const [memLoading, setMemLoading] = useState(false);

  // ── CVE Search ──────────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [cveQuery, setCveQuery] = useState("");
  const [cveResult, setCveResult] = useState("");
  const [cveLoading, setCveLoading] = useState(false);

  // ── Device context ──────────────────────────────────────────────────────────
  const [showDevicePanel, setShowDevicePanel] = useState(true);
  const [deviceCtx, setDeviceCtx] = useState<Record<string, string> | null>(null);
  const [deviceCtxLoading, setDeviceCtxLoading] = useState(false);

  // ── Autonomous mode ─────────────────────────────────────────────────────────
  const [autonomous, setAutonomous] = useState(false);
  const [autoLog, setAutoLog] = useState<Array<{ ts: number; title: string; result?: string; error?: string }>>([]);
  const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Kali intel ──────────────────────────────────────────────────────────────
  const [intel, setIntel] = useState<Record<string, unknown> | null>(null);

  // ── Polling: agent status + AI status ──────────────────────────────────────
  useEffect(() => {
    const pollAgent = async () => {
      try {
        const r = await fetch(API("/local-agent/status"));
        if (r.ok) {
          const d = await r.json() as { connected: boolean; agents: AgentInfo[] };
          setAgentConnected(d.connected);
          setAgentList(d.agents ?? []);
          if (d.agents?.length > 0) {
            setSelectedAgentId(prev => prev ?? d.agents[0].id);
          } else {
            setSelectedAgentId(null);
          }
        }
      } catch { /* ignore */ }
    };
    const pollAI = async () => {
      try {
        const r = await fetch(API("/kali-command/system"));
        if (r.ok) {
          const d = await r.json() as { agentCount: number; knowledgeCount: number; server: Record<string, string>; agents: AgentInfo[] };
          setAiOnline(true);
          setIntel(d as unknown as Record<string, unknown>);
        }
      } catch { setAiOnline(false); }
    };
    const pollTasks = async () => {
      try {
        const r = await fetch(API("/kali-command/tasks"));
        if (r.ok) setTasks(await r.json() as KaliTask[]);
      } catch { /* ignore */ }
    };
    void pollAgent();
    void pollAI();
    void pollTasks();
    const t1 = setInterval(pollAgent, 5_000);
    const t2 = setInterval(pollAI, 30_000);
    const t3 = setInterval(pollTasks, 5_000);
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); };
  }, []);

  // ── Fetch AI models ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(API("/ollama/models")).then(r => r.ok ? r.json() : null).then(d => {
      if (Array.isArray(d?.models)) setAiModels(d.models.map((m: { name: string }) => m.name));
    }).catch(() => {});
  }, []);

  // ── Auto-scroll chat ─────────────────────────────────────────────────────────
  useEffect(() => {
    setTimeout(() => chatScrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);
  }, [lines, busy]);

  useEffect(() => {
    setTimeout(() => shellScrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);
  }, [shellLines]);

  // ── Send to KALI AI (Dolphin) ───────────────────────────────────────────────
  const sendToAI = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setLines(prev => [...prev, { role: "user", text }]);
    setInput("");
    setBusy(true);
    setPhase("thinking");
    setPhaseLabel("يتواصل مع Dolphin...");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const resp = await fetch(API("/kali-command/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message: text }),
        signal: abortRef.current.signal,
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let asstBuf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const ls = part.trim().split("\n");
          let evt = "message", dataStr = "";
          for (const l of ls) {
            if (l.startsWith("event: ")) evt = l.slice(7).trim();
            else if (l.startsWith("data: ")) dataStr = l.slice(6).trim();
          }
          if (!dataStr) continue;
          try {
            const d = JSON.parse(dataStr) as Record<string, unknown>;
            if (evt === "phase") {
              const ph = String(d.phase ?? "");
              if (ph === "thinking") setPhase("thinking");
              else if (ph === "writing") setPhase("writing");
              else if (ph === "executing") setPhase("executing");
              else if (ph === "analyzing") setPhase("analyzing");
              else if (ph === "probing") setPhase("thinking");
              setPhaseLabel(String(d.label ?? ""));
            } else if (evt === "delta") {
              asstBuf += String(d.text ?? "");
              setLines(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") return [...prev.slice(0, -1), { ...last, text: asstBuf }];
                return [...prev, { role: "assistant", text: asstBuf }];
              });
            } else if (evt === "exec_stream") {
              const streamData = String(d.data ?? "");
              const cmd = String(d.command ?? "").slice(0, 60);
              setPhase("executing");
              setPhaseLabel(`▶ ${cmd}`);
              setLines(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "tool_result") {
                  return [...prev.slice(0, -1), { ...last, text: last.text + streamData }];
                }
                return [...prev, { role: "tool_result", text: streamData }];
              });
            } else if (evt === "exec_result") {
              const result = String(d.result ?? "");
              const isErr = Boolean(d.isError);
              const cmd = String(d.command ?? "").slice(0, 50);
              setPhase("analyzing");
              setPhaseLabel("يحلل النتيجة...");
              setLines(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "tool_result") {
                  return [...prev.slice(0, -1), { role: "tool_result", text: result.slice(0, 3000), isError: isErr }];
                }
                return [...prev, { role: "tool_result", text: result.slice(0, 3000), isError: isErr }];
              });
              if (!isErr) {
                setShellLines(prev => [
                  ...prev,
                  { kind: "cmd", text: `[KALI AI] ${cmd}`, ts: Date.now() },
                  { kind: "stdout", text: result.slice(0, 2000), ts: Date.now() },
                ]);
              }
            } else if (evt === "agent_error") {
              setLines(prev => [...prev, { role: "system", text: String(d.error ?? "خطأ في الوكيل"), isError: true }]);
            } else if (evt === "search_result") {
              setLines(prev => [...prev, { role: "tool_result", text: `🔍 ${String(d.result ?? "").slice(0, 1000)}` }]);
            } else if (evt === "task_created") {
              void fetch(API("/kali-command/tasks")).then(r => r.json()).then(d => setTasks(d as KaliTask[])).catch(() => {});
            } else if (evt === "done") {
              setPhase("idle");
              setPhaseLabel("");
              setLines(prev => [...prev, { role: "system", text: "✓ اكتمل التنفيذ" }]);
            } else if (evt === "error") {
              setLines(prev => [...prev, { role: "system", text: `⚠ ${String(d.error ?? "خطأ")}`, isError: true }]);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setLines(prev => [...prev, { role: "system", text: `خطأ: ${e instanceof Error ? e.message : "غير معروف"}`, isError: true }]);
      }
    } finally {
      setBusy(false);
      setPhase("idle");
      setPhaseLabel("");
      abortRef.current = null;
    }
  }, [busy]);

  // ── Execute on Kali shell (streaming) ─────────────────────────────────────
  const execOnKali = useCallback((cmd: string, targetId?: string) => {
    if (shellBusy) return;
    const agentId = targetId ?? selectedAgentId;
    setShellBusy(true);
    setShellLines(prev => [...prev, { kind: "cmd", text: cmd, ts: Date.now() }]);
    setCmdHistory(prev => [cmd, ...prev.filter(c => c !== cmd)].slice(0, 100));
    setHistIdx(-1);

    (async () => {
      try {
        const resp = await fetch(API("/local-agent/exec-stream"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd, agentId, timeout: 300_000 }),
        });
        if (!resp.ok || !resp.body) {
          const err = await resp.text().catch(() => `HTTP ${resp.status}`);
          setShellLines(prev => [...prev, { kind: "error", text: `فشل: ${err}`, ts: Date.now() }]);
          setShellBusy(false);
          return;
        }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const dataLine = part.split("\n").find(l => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const d = JSON.parse(dataLine.slice(6)) as { type: string; text?: string; exitCode?: number; durationMs?: number };
              if (d.type === "stdout" && d.text) {
                setShellLines(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.kind === "stdout") return [...prev.slice(0, -1), { ...last, text: last.text + d.text }];
                  return [...prev, { kind: "stdout", text: d.text!, ts: Date.now() }];
                });
              } else if (d.type === "stderr" && d.text) {
                setShellLines(prev => [...prev, { kind: "stderr", text: d.text!, ts: Date.now() }]);
              } else if (d.type === "done") {
                setShellLines(prev => [...prev, { kind: "system", text: `[exit ${d.exitCode ?? 0}] ${d.durationMs ?? 0}ms`, ts: Date.now() }]);
                setShellBusy(false);
              } else if (d.type === "error") {
                setShellLines(prev => [...prev, { kind: "error", text: d.text ?? "خطأ", ts: Date.now() }]);
                setShellBusy(false);
              }
            } catch { /* ignore */ }
          }
        }
      } catch (e) {
        setShellLines(prev => [...prev, { kind: "error", text: String(e), ts: Date.now() }]);
        setShellBusy(false);
      }
    })();
  }, [shellBusy, selectedAgentId]);

  // ── Load device context ─────────────────────────────────────────────────────
  const loadDeviceCtx = useCallback(() => {
    if (!agentConnected) return;
    setDeviceCtxLoading(true);
    fetch(API("/kali-command/device-context"))
      .then(r => r.json() as Promise<{ connected: boolean; agent?: AgentInfo; context?: Record<string, string> }>)
      .then(d => { if (d.connected && d.agent) setDeviceCtx({ hostname: d.agent.hostname, user: d.agent.user, platform: d.agent.platform, ...d.context }); })
      .catch(() => {})
      .finally(() => setDeviceCtxLoading(false));
  }, [agentConnected]);

  useEffect(() => { if (agentConnected) loadDeviceCtx(); }, [agentConnected, loadDeviceCtx]);

  // ── Load memories ───────────────────────────────────────────────────────────
  const loadMemories = useCallback(() => {
    setMemLoading(true);
    fetch(API("/memory?limit=30"))
      .then(r => r.json() as Promise<KaliMemory[]>)
      .then(setMemories)
      .catch(() => {})
      .finally(() => setMemLoading(false));
  }, []);

  // ── Load FS ─────────────────────────────────────────────────────────────────
  const loadFs = useCallback((dir: string) => {
    if (!selectedAgentId) return;
    setFsLoading(true);
    fetch(API(`/local-agent/fs/list?agentId=${selectedAgentId}&dir=${encodeURIComponent(dir)}`))
      .then(r => r.json() as Promise<{ dir?: string; items?: FsEntry[] }>)
      .then(d => { if (d.items) { setFsEntries(d.items); setFsDir(d.dir ?? dir); setSelectedFile(null); setFileContent(null); } })
      .catch(() => {})
      .finally(() => setFsLoading(false));
  }, [selectedAgentId]);

  // ── Load processes ───────────────────────────────────────────────────────────
  const loadProcesses = useCallback(() => {
    if (!selectedAgentId) return;
    setProcsLoading(true);
    fetch(API(`/local-agent/processes?agentId=${selectedAgentId}`))
      .then(r => r.json() as Promise<{ processes?: typeof processes }>)
      .then(d => { if (d.processes) setProcesses(d.processes); })
      .catch(() => {})
      .finally(() => setProcsLoading(false));
  }, [selectedAgentId]);

  // ── CVE search ──────────────────────────────────────────────────────────────
  const doCveSearch = useCallback(async (q: string) => {
    if (!q.trim() || cveLoading) return;
    setCveLoading(true);
    setCveResult("");
    try {
      const r = await fetch(API(`/kali-command/search?q=${encodeURIComponent(q.trim())}`));
      const d = await r.json() as { result: string };
      setCveResult(d.result ?? "لا نتائج");
    } catch { setCveResult("خطأ في البحث"); }
    setCveLoading(false);
  }, [cveLoading]);

  // ── Screenshot ──────────────────────────────────────────────────────────────
  const takeScreenshot = useCallback(() => {
    if (!selectedAgentId || screenshotLoading) return;
    setScreenshotLoading(true);
    setScreenshotError(null);
    fetch(API(`/local-agent/screenshot?agentId=${selectedAgentId}`))
      .then(r => r.json() as Promise<{ data?: string; error?: string; format?: string }>)
      .then(d => {
        if (d.data) setScreenshot(`data:image/${d.format ?? "png"};base64,${d.data}`);
        else setScreenshotError(d.error ?? "فشل الالتقاط");
      })
      .catch(e => setScreenshotError(String(e)))
      .finally(() => setScreenshotLoading(false));
  }, [selectedAgentId, screenshotLoading]);

  // ── Autonomous mode ─────────────────────────────────────────────────────────
  const toggleAutonomous = useCallback(async () => {
    if (autonomous) {
      setAutonomous(false);
      if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
      await fetch(API("/kali-command/autonomous/stop"), { method: "POST" }).catch(() => {});
    } else {
      setAutonomous(true);
      const runOp = async () => {
        const ops = [
          { title: "فحص النظام", cmd: "id && whoami && uname -a && ip addr show 2>/dev/null | head -15 && ss -tulpn 2>/dev/null | head -10" },
          { title: "فحص العمليات", cmd: "ps aux --sort=-%cpu | head -12" },
          { title: "فحص الصلاحيات", cmd: "sudo -l 2>/dev/null && find / -perm -4000 -type f 2>/dev/null | head -10" },
          { title: "فحص الشبكة", cmd: "arp -a 2>/dev/null | head -10 && netstat -tulpn 2>/dev/null | head -10" },
        ];
        const op = ops[Math.floor(Math.random() * ops.length)];
        try {
          const r = await fetch(API("/local-agent/exec"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: op.cmd, agentId: selectedAgentId, timeout: 30_000 }),
          });
          const d = await r.json() as { stdout?: string; stderr?: string };
          setAutoLog(prev => [...prev.slice(-9), { ts: Date.now(), title: op.title, result: (d.stdout ?? "").slice(0, 100) }]);
        } catch (e) {
          setAutoLog(prev => [...prev.slice(-9), { ts: Date.now(), title: op.title, error: String(e) }]);
        }
      };
      void runOp();
      autoIntervalRef.current = setInterval(runOp, 60_000);
    }
  }, [autonomous, selectedAgentId]);

  useEffect(() => () => { if (autoIntervalRef.current) clearInterval(autoIntervalRef.current); }, []);

  // ── Phase colors ─────────────────────────────────────────────────────────────
  const PHASE_LABELS: Record<string, string> = { thinking: "🤔 تفكير", planning: "📋 تخطيط", writing: "✍ إجابة", executing: "⚡ تنفيذ", analyzing: "🧠 تحليل" };
  const PHASE_COLORS: Record<string, string> = { thinking: "#a78bfa", planning: "#fbbf24", writing: "#4ade80", executing: "#f87171", analyzing: "#60a5fa" };
  const PHASE_ORDER = ["thinking", "planning", "writing", "executing", "analyzing"];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "rgba(2,0,4,0.98)", fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace" }}>

      {/* ── TOP HEADER ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-2 border-b border-rose-900/40 flex items-center gap-2" style={{ background: "rgba(8,0,12,0.97)" }}>
        <div className="w-7 h-7 rounded flex items-center justify-center shrink-0" style={{ background: "rgba(200,0,0,0.25)", border: "1px solid rgba(255,50,50,0.4)" }}>
          <Skull className="w-4 h-4" style={{ color: "#ff4444" }} />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-black tracking-widest" style={{ color: "#ff4444" }}>NOVA COMMANDER</span>
            <span className="text-[7px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,50,50,0.12)", border: "1px solid rgba(255,50,50,0.3)", color: "rgba(255,150,150,0.8)" }}>KALI AI v4</span>
            {autonomous && <span className="text-[7px] font-mono px-1 rounded animate-pulse" style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.3)" }}>AUTO</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[7px] font-mono flex items-center gap-1 ${aiOnline ? "text-violet-300" : "text-rose-900"}`}>
              <span className={`w-1 h-1 rounded-full ${aiOnline ? "bg-violet-400 animate-pulse" : "bg-rose-900"}`} />
              {aiOnline ? aiModel.replace(":latest", "") : "AI offline"}
            </span>
            <span className={`text-[7px] font-mono flex items-center gap-1 ${agentConnected ? "text-green-300" : "text-rose-900"}`}>
              {agentConnected ? <Wifi className="w-2 h-2" /> : <WifiOff className="w-2 h-2" />}
              {agentConnected ? `${agentList.length} جهاز` : "لا جهاز"}
            </span>
          </div>
        </div>
        <div className="ms-auto flex items-center gap-1.5">
          <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>هدف:</span>
          <input value={target} onChange={e => setTarget(e.target.value)}
            className="text-[9px] font-mono bg-black/60 border border-rose-900/40 text-rose-300 px-1.5 py-0.5 rounded w-24 outline-none focus:border-rose-500/60"
            placeholder="127.0.0.1" />
          <button onClick={toggleAutonomous} title={autonomous ? "إيقاف وضع المستقل" : "تشغيل وضع المستقل"}
            className="text-[7px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 transition-all"
            style={autonomous ? { border: "1px solid rgba(251,146,60,0.5)", color: "#fb923c", background: "rgba(251,146,60,0.1)" } : { border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.25)" }}>
            <Zap className="w-2 h-2" /> AUTO
          </button>
          <button onClick={() => { setShowTasks(v => !v); }}
            className="text-[7px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 transition-all"
            style={showTasks ? { border: "1px solid rgba(255,50,50,0.4)", color: "#ff6666", background: "rgba(255,30,30,0.1)" } : { border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
            <Activity className="w-2 h-2" />
            {tasks.filter(t => t.status === "running").length > 0 && (
              <span className="w-3.5 h-3.5 rounded-full text-[6px] font-black flex items-center justify-center" style={{ background: "#ff4444", color: "#fff" }}>
                {tasks.filter(t => t.status === "running").length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── AGENT SELECTOR (when multiple) ─────────────────────────────────────── */}
      {agentList.length > 1 && (
        <div className="shrink-0 px-2 py-1 border-b border-rose-900/30 flex items-center gap-1.5 overflow-x-auto" style={{ background: "rgba(6,0,10,0.9)" }}>
          <span className="text-[8px] text-rose-700 font-mono shrink-0">وكيل:</span>
          {agentList.map(a => (
            <button key={a.id} onClick={() => setSelectedAgentId(a.id)}
              className={`text-[8px] font-mono px-2 py-0.5 rounded border transition-all shrink-0 ${selectedAgentId === a.id ? "border-rose-400/60 text-rose-200 bg-rose-500/15" : "border-rose-900/40 text-rose-700 hover:border-rose-700/50"}`}>
              {a.user}@{a.hostname}
            </button>
          ))}
        </div>
      )}

      {/* ── SUB-TAB BAR ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex border-b border-rose-900/40 overflow-x-auto" style={{ background: "rgba(6,0,10,0.9)" }}>
        {([
          { id: "dolphin", label: "AI", icon: Brain, color: "violet" },
          { id: "shell", label: "Shell", icon: Terminal, color: "rose" },
          { id: "dashboard", label: "لوحة", icon: Activity, color: "rose" },
          { id: "files", label: "ملفات", icon: Folder, color: "amber" },
          { id: "processes", label: "عمليات", icon: Activity, color: "cyan" },
          { id: "screenshot", label: "شاشة", icon: Camera, color: "green" },
        ] as const).map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id}
              onClick={() => {
                setTab(t.id as typeof tab);
                if (t.id === "files" && agentConnected && selectedAgentId && fsEntries.length === 0) loadFs("~");
                if (t.id === "processes" && agentConnected) loadProcesses();
              }}
              className={`text-[9px] font-mono px-2.5 py-1.5 border-b-2 transition-all flex items-center gap-1 shrink-0 ${active ? `border-${t.color}-400 text-${t.color}-300 bg-${t.color}-500/10` : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Icon className="w-2.5 h-2.5" />
              {t.label}
              {t.id === "dolphin" && aiOnline && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
              {t.id === "shell" && agentConnected && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />}
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* ── DOLPHIN AI TAB ─────────────────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {tab === "dolphin" && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Phase indicator */}
          {busy && (
            <div className="shrink-0 px-2 py-1 flex items-center gap-2 border-b border-rose-900/30" style={{ background: "rgba(8,0,16,0.98)" }}>
              {PHASE_ORDER.map((p) => {
                const active = phase === p;
                const passed = PHASE_ORDER.indexOf(phase) > PHASE_ORDER.indexOf(p);
                return (
                  <div key={p} className="flex items-center gap-1">
                    <div className={`w-1.5 h-1.5 rounded-full transition-all ${active ? "animate-pulse scale-125" : ""}`}
                      style={{ background: active ? PHASE_COLORS[p] : passed ? PHASE_COLORS[p] : "rgba(255,255,255,0.1)" }} />
                    <span className="text-[7px] font-mono" style={{ color: active ? PHASE_COLORS[p] : passed ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)" }}>
                      {PHASE_LABELS[p]}
                    </span>
                    {p !== "analyzing" && <span className="text-[7px]" style={{ color: "rgba(255,255,255,0.1)" }}>›</span>}
                  </div>
                );
              })}
              {phaseLabel && <span className="ms-auto text-[7px] font-mono animate-pulse" style={{ color: "rgba(255,100,100,0.6)" }}>{phaseLabel}</span>}
            </div>
          )}

          {/* Device context panel */}
          {agentConnected && showDevicePanel && (
            <div className="shrink-0 border-b" style={{ borderColor: "rgba(68,255,136,0.12)", background: "rgba(0,10,4,0.98)" }}>
              <div className="px-2 py-1.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[7px] font-black tracking-widest" style={{ color: "rgba(68,255,136,0.7)" }}>DEVICE CONTEXT</span>
                  {deviceCtxLoading && <Loader2 className="w-2 h-2 animate-spin" style={{ color: "rgba(68,255,136,0.5)" }} />}
                  {deviceCtx && <span className="text-[7px] font-mono font-bold" style={{ color: "rgba(68,255,136,0.9)" }}>{deviceCtx.user}@{deviceCtx.hostname}</span>}
                  <button onClick={loadDeviceCtx} className="ms-auto text-green-800 hover:text-green-400 transition"><RefreshCw className="w-2.5 h-2.5" /></button>
                  <button onClick={() => setShowDevicePanel(false)} className="text-green-900 hover:text-green-500 transition"><X className="w-2.5 h-2.5" /></button>
                </div>
                {deviceCtx ? (
                  <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[7px] font-mono">
                    {[["🖥", "OS", deviceCtx.platform], ["🐧", "Kernel", deviceCtx.kernel ?? "N/A"], ["💾", "RAM", deviceCtx.mem ?? "N/A"], ["💿", "Disk", deviceCtx.disk ?? "N/A"], ["🌐", "IP", deviceCtx.ip ?? "N/A"], ["⏱", "Uptime", deviceCtx.uptime ?? "N/A"]].map(([icon, k, v]) => (
                      <div key={k as string} className="flex items-center gap-1 overflow-hidden">
                        <span>{icon}</span>
                        <span style={{ color: "rgba(68,255,136,0.35)" }}>{k}:</span>
                        <span className="truncate" style={{ color: "rgba(180,255,200,0.7)" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-1.5 flex-wrap">
                    {agentList.map(a => (
                      <span key={a.id} className="text-[7px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.08)", color: "rgba(68,255,136,0.6)", border: "1px solid rgba(68,255,136,0.15)" }}>
                        {a.user}@{a.hostname} · {a.platform}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {[
                    { label: "🔍 PrivEsc", cmd: "فحص رفع الصلاحيات: [AGENT_EXEC: id && sudo -l 2>/dev/null && find / -perm -4000 -type f 2>/dev/null | head -15]" },
                    { label: "🌐 شبكة", cmd: "[AGENT_EXEC: ip addr && ip route && ss -tulpn 2>/dev/null | head -15]" },
                    { label: "👁 مراقبة", cmd: "[AGENT_EXEC: ps aux --sort=-%cpu | head -15 && last -n 5 && w]" },
                    { label: "📁 ملفات", cmd: "[AGENT_EXEC: find / -name '*.conf' -o -name '*.key' -o -name 'id_rsa' 2>/dev/null | head -12]" },
                  ].map(item => (
                    <button key={item.label} onClick={() => void sendToAI(item.cmd)} disabled={busy}
                      className="text-[7px] font-mono px-1.5 py-0.5 rounded border transition disabled:opacity-30 shrink-0"
                      style={{ border: "1px solid rgba(68,255,136,0.2)", color: "rgba(68,255,136,0.65)", background: "rgba(68,255,136,0.04)" }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CVE Search panel */}
          {showSearch && (
            <div className="shrink-0 border-b" style={{ borderColor: "rgba(96,165,250,0.15)", background: "rgba(0,4,14,0.99)" }}>
              <div className="px-2 py-1.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Search className="w-2.5 h-2.5" style={{ color: "rgba(96,165,250,0.6)" }} />
                  <span className="text-[7px] font-black tracking-widest" style={{ color: "rgba(96,165,250,0.6)" }}>INTEL SEARCH — CVE / EXPLOIT</span>
                  <button onClick={() => setShowSearch(false)} className="ms-auto text-blue-900 hover:text-blue-400"><X className="w-2.5 h-2.5" /></button>
                </div>
                <form onSubmit={e => { e.preventDefault(); void doCveSearch(cveQuery); }}>
                  <div className="flex gap-1 mb-1.5">
                    <input value={cveQuery} onChange={e => setCveQuery(e.target.value)}
                      placeholder="CVE-2024-xxxx أو exploit rce أو اسم أداة..."
                      className="flex-1 bg-black/60 border border-blue-900/40 text-blue-200 text-[9px] font-mono px-2 py-1 rounded outline-none focus:border-blue-500/50" />
                    <button type="submit" disabled={cveLoading || !cveQuery.trim()}
                      className="px-2 py-1 rounded text-[8px] font-mono transition disabled:opacity-40"
                      style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)", color: "#60a5fa" }}>
                      {cveLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "بحث"}
                    </button>
                    <button type="button" onClick={() => { if (cveResult) void sendToAI(`حلّل نتيجة البحث وقدّم توصيات:\n${cveResult.slice(0, 600)}`); }}
                      disabled={!cveResult || busy}
                      className="px-2 py-1 rounded text-[8px] font-mono transition disabled:opacity-30"
                      style={{ background: "rgba(255,50,50,0.1)", border: "1px solid rgba(255,50,50,0.3)", color: "#f87171" }}>
                      <Brain className="w-3 h-3" />
                    </button>
                  </div>
                </form>
                <div className="flex gap-1 flex-wrap mb-1.5">
                  {["CVE-2024-3400", "CVE-2021-44228 log4j", "RCE critical 2024", "privilege escalation linux", "SQL injection bypass"].map(q => (
                    <button key={q} onClick={() => setCveQuery(q)}
                      className="text-[7px] font-mono px-1.5 py-0.5 rounded border text-blue-800 border-blue-900/40 hover:text-blue-400 hover:border-blue-700/50 transition shrink-0">
                      {q.slice(0, 26)}
                    </button>
                  ))}
                </div>
                {cveResult && (
                  <pre className="text-[7.5px] font-mono leading-relaxed p-2 rounded max-h-28 overflow-y-auto whitespace-pre-wrap break-words"
                    style={{ background: "rgba(0,0,20,0.8)", border: "1px solid rgba(96,165,250,0.1)", color: "rgba(180,210,255,0.85)", scrollbarWidth: "thin" }}>
                    {cveResult}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Quick attack buttons */}
          <div className="shrink-0 border-b border-rose-900/30 overflow-x-auto" style={{ background: "rgba(6,0,12,0.98)" }}>
            <div className="flex gap-1 px-2 py-1.5" style={{ scrollbarWidth: "thin" }}>
              {MISSIONS.map(item => (
                <button key={item.label}
                  onClick={() => void sendToAI(item.prompt.replace(/localhost/g, target))}
                  disabled={busy}
                  className="text-[7px] font-mono px-2 py-0.5 rounded border shrink-0 transition-all disabled:opacity-30"
                  style={{ border: "1px solid rgba(255,50,50,0.25)", color: "rgba(255,120,120,0.8)", background: "rgba(255,20,20,0.06)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,30,30,0.15)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,20,20,0.06)"; }}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Main area: chat + tasks */}
          <div className="flex-1 flex min-h-0">
            {/* Chat */}
            <div className="flex-1 flex flex-col min-h-0">
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0"
                style={{ background: "rgba(3,0,8,0.99)", scrollbarWidth: "thin", scrollbarColor: "rgba(255,30,30,0.15) transparent" }}>
                {lines.map((line, i) => {
                  if (line.role === "user") return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[88%] rounded-xl px-2.5 py-1.5 text-[9px] break-words"
                        style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,50,50,0.2)", color: "rgba(255,200,200,0.9)" }}>
                        {line.text}
                      </div>
                    </div>
                  );
                  if (line.role === "assistant") return (
                    <div key={i} className="max-w-[96%]">
                      <div className="text-[7px] mb-0.5 flex items-center gap-1" style={{ color: "rgba(255,50,50,0.5)" }}>
                        <Skull className="w-2 h-2" style={{ color: "#ff4444" }} /> KALI AI
                      </div>
                      <div className="rounded-xl px-2.5 py-1.5 text-[9px] whitespace-pre-wrap break-words leading-relaxed"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(220,255,220,0.9)" }}>
                        {line.text || <span className="opacity-40 animate-pulse">▍</span>}
                      </div>
                    </div>
                  );
                  if (line.role === "tool_result") return (
                    <div key={i} className="rounded-xl px-2 py-1.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${line.isError ? "rgba(255,100,100,0.2)" : "rgba(68,255,136,0.15)"}` }}>
                      <div className="text-[7px] mb-0.5 flex items-center gap-1" style={{ color: line.isError ? "rgba(255,100,100,0.5)" : "rgba(68,255,136,0.5)" }}>
                        <Terminal className="w-2 h-2" /> نتيجة تنفيذ
                      </div>
                      <pre className="whitespace-pre-wrap break-all text-[8px] leading-relaxed" style={{ color: line.isError ? "rgba(255,120,120,0.85)" : "rgba(68,255,136,0.85)", maxHeight: "140px", overflow: "auto", scrollbarWidth: "thin" }}>{line.text}</pre>
                    </div>
                  );
                  if (line.role === "plan") return (
                    <div key={i} className="rounded-xl px-2.5 py-2" style={{ background: "rgba(255,170,0,0.05)", border: "1px solid rgba(255,170,0,0.3)" }}>
                      <div className="text-[7px] mb-1 font-bold" style={{ color: "#ffaa00" }}>🎯 خطة مقترحة من KALI AI</div>
                      <pre className="whitespace-pre-wrap text-[8px] leading-relaxed" style={{ color: "rgba(255,200,100,0.85)" }}>{line.text}</pre>
                      {line.awaitingApproval && (
                        <div className="flex gap-1.5 mt-2">
                          <button onClick={() => void sendToAI("موافق، نفّذ الخطة")}
                            className="text-[8px] font-mono px-2.5 py-1 rounded-lg font-bold"
                            style={{ background: "rgba(68,255,136,0.15)", border: "1px solid rgba(68,255,136,0.4)", color: "#44ff88" }}>
                            ✓ موافق نفّذ
                          </button>
                          <button onClick={() => setLines(prev => prev.map((l, j) => j === i ? { ...l, awaitingApproval: false } : l))}
                            className="text-[8px] font-mono px-2.5 py-1 rounded-lg"
                            style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                            عدّل
                          </button>
                        </div>
                      )}
                    </div>
                  );
                  if (line.role === "system") return (
                    <div key={i} className={`text-[7px] font-mono text-center py-0.5 ${line.isError ? "text-rose-500" : "text-rose-900"}`}>{line.text}</div>
                  );
                  return null;
                })}
                {busy && (
                  <div className="flex items-center gap-2 px-1 py-0.5 rounded-lg" style={{ background: "rgba(255,30,30,0.05)", border: "1px solid rgba(255,30,30,0.1)" }}>
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: "#ff4444" }} />
                    <div className="flex items-center gap-1">
                      {PHASE_ORDER.map(p => {
                        const phaseIdx = PHASE_ORDER.indexOf(phase);
                        const pIdx = PHASE_ORDER.indexOf(p);
                        const active = phase === p;
                        const icons: Record<string, string> = { thinking: "🤔", planning: "📋", writing: "✍", executing: "⚡", analyzing: "🧠" };
                        return (
                          <span key={p} className={`text-[7px] font-mono transition-all ${active ? "opacity-100 animate-pulse font-bold" : pIdx < phaseIdx ? "opacity-30" : "opacity-10"}`}
                            style={{ color: active ? "#ff8888" : "rgba(255,255,255,0.3)" }}>
                            {icons[p]}
                          </span>
                        );
                      })}
                    </div>
                    <span className="text-[7px] font-mono" style={{ color: "rgba(255,80,80,0.5)" }}>{phaseLabel || "يعالج..."}</span>
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="shrink-0 border-t" style={{ borderColor: "rgba(255,30,30,0.15)", background: "rgba(4,0,8,0.99)" }}>
                <form onSubmit={e => { e.preventDefault(); const t = input.trim(); if (!t || busy) return; void sendToAI(t); }}>
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <Skull className="w-3 h-3 shrink-0" style={{ color: "rgba(255,50,50,0.5)" }} />
                    <input value={input} onChange={e => setInput(e.target.value)}
                      placeholder="اطلب مهمة — KALI AI يفكر ويخطط وينفّذ..."
                      disabled={busy}
                      className="flex-1 bg-transparent outline-none text-[10px] disabled:opacity-40"
                      style={{ color: "rgba(220,180,180,0.9)", caretColor: "#ff4444" }} />
                    {busy ? (
                      <button type="button" onClick={() => { abortRef.current?.abort(); setBusy(false); setPhase("idle"); }}
                        className="text-[7px] font-mono px-1.5 py-0.5 rounded" style={{ border: "1px solid rgba(255,50,50,0.4)", color: "#ff5555" }}>⏹</button>
                    ) : (
                      <button type="submit" disabled={!input.trim()} className="disabled:opacity-20 transition" style={{ color: "rgba(255,80,80,0.7)" }}>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </form>
                <div className="px-2 pb-1.5 flex items-center gap-1.5 flex-wrap">
                  {agentConnected && (
                    <button onClick={() => setShowDevicePanel(v => !v)}
                      className="text-[7px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 transition"
                      style={showDevicePanel ? { border: "1px solid rgba(68,255,136,0.4)", color: "rgba(68,255,136,0.7)", background: "rgba(68,255,136,0.08)" } : { border: "1px solid rgba(68,255,136,0.15)", color: "rgba(68,255,136,0.3)" }}>
                      <Monitor className="w-2 h-2" />
                      {deviceCtx?.hostname?.slice(0, 10) ?? "جهاز"}
                    </button>
                  )}
                  <button onClick={() => setShowSearch(v => !v)}
                    className="text-[7px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 transition"
                    style={showSearch ? { border: "1px solid rgba(96,165,250,0.5)", color: "rgba(96,165,250,0.8)", background: "rgba(96,165,250,0.1)" } : { border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.25)" }}>
                    <Search className="w-2 h-2" /> CVE
                  </button>
                  <button onClick={() => { setShowMemory(v => !v); if (!memories.length) loadMemories(); }}
                    className="text-[7px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 transition"
                    style={showMemory ? { border: "1px solid rgba(167,139,250,0.5)", color: "rgba(167,139,250,0.8)", background: "rgba(167,139,250,0.1)" } : { border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.25)" }}>
                    <Brain className="w-2 h-2" /> ذاكرة
                  </button>
                  {/* Model picker */}
                  <div className="relative">
                    <button onClick={() => setShowModelPicker(v => !v)}
                      className="text-[7px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 transition"
                      style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
                      <span className="max-w-[70px] truncate">{aiModel}</span>
                      <ChevronDown className="w-2 h-2" />
                    </button>
                    {showModelPicker && aiModels.length > 0 && (
                      <>
                        <div className="fixed inset-0 z-[998]" onClick={() => setShowModelPicker(false)} />
                        <div className="absolute bottom-full mb-1 left-0 z-[999] min-w-[160px] bg-[#050a15]/98 backdrop-blur-xl border border-violet-400/30 rounded-xl shadow-xl p-1">
                          {aiModels.map(m => (
                            <button key={m} onClick={() => { setAiModel(m); setShowModelPicker(false); }}
                              className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-mono transition-all ${m === aiModel ? "bg-violet-500/20 text-violet-200 border border-violet-400/30" : "text-white/60 hover:bg-white/5 hover:text-white/90"}`}>
                              {m === aiModel && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
                              <span className="truncate">{m}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <button onClick={() => { sessionId.current = `nova-cmd-${Date.now()}`; setLines([{ role: "system", text: "☠ جلسة جديدة — الذاكرة محفوظة" }]); setTasks([]); }}
                    className="text-[7px] font-mono px-1.5 py-0.5 rounded border border-rose-900/30 text-rose-900 hover:text-rose-500 transition">
                    جديد
                  </button>
                  {!aiOnline && <span className="text-[7px] text-rose-800">⚠ AI غير متصل</span>}
                  <span className="text-[7px] ms-auto font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>
                    {lines.filter(l => l.role === "user").length} رسائل
                  </span>
                </div>
                {/* Memory panel */}
                {showMemory && (
                  <div className="border-t border-violet-900/30 p-2" style={{ background: "rgba(2,0,6,0.98)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[7px] font-black tracking-widest" style={{ color: "rgba(167,139,250,0.5)" }}>AI MEMORY ({memories.length})</span>
                      <div className="flex items-center gap-1">
                        <button onClick={loadMemories} disabled={memLoading} className="text-violet-800 hover:text-violet-400 transition">
                          <RefreshCw className={`w-2.5 h-2.5 ${memLoading ? "animate-spin" : ""}`} />
                        </button>
                        <button onClick={() => setShowMemory(false)} className="text-violet-900 hover:text-violet-500 transition"><X className="w-2.5 h-2.5" /></button>
                      </div>
                    </div>
                    {memLoading ? (
                      <div className="flex items-center justify-center py-2"><Loader2 className="w-3 h-3 animate-spin text-violet-500" /></div>
                    ) : memories.length === 0 ? (
                      <div className="text-[7px] font-mono text-center py-2" style={{ color: "rgba(167,139,250,0.3)" }}>لا ذاكرة بعد</div>
                    ) : (
                      <div className="space-y-1 max-h-32 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                        {memories.slice(0, 12).map(m => (
                          <div key={m.id} className="rounded px-1.5 py-1 cursor-pointer hover:bg-violet-500/10 transition"
                            onClick={() => void sendToAI(`راجع الذاكرة: [${m.memoryType}] ${m.key}: ${m.content.slice(0, 100)}`)}
                            style={{ background: "rgba(138,43,226,0.06)", border: "1px solid rgba(138,43,226,0.1)" }}>
                            <div className="flex items-center gap-1 mb-0.5">
                              <span className="text-[6px] font-mono px-1 rounded" style={{ background: "rgba(138,43,226,0.2)", color: "rgba(167,139,250,0.8)" }}>{m.memoryType}</span>
                              <span className="text-[6px] font-mono truncate" style={{ color: "rgba(167,139,250,0.4)" }}>{m.key}</span>
                            </div>
                            <div className="text-[7px] font-mono leading-relaxed" style={{ color: "rgba(220,200,255,0.7)" }}>{m.content.slice(0, 80)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Tasks panel */}
            {showTasks && (
              <div className="w-44 shrink-0 flex flex-col border-l overflow-hidden" style={{ borderColor: "rgba(255,30,30,0.15)", background: "rgba(5,0,10,0.99)" }}>
                <div className="shrink-0 px-2 py-1.5 border-b flex items-center justify-between" style={{ borderColor: "rgba(255,30,30,0.15)" }}>
                  <span className="text-[7px] font-black tracking-widest" style={{ color: "rgba(255,50,50,0.6)" }}>LIVE TASKS</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[7px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{tasks.filter(t => t.status === "done").length}/{tasks.length}</span>
                    <button onClick={() => fetch(API("/kali-command/tasks"), { method: "DELETE" }).then(() => setTasks([]))}
                      className="text-[6px] font-mono px-1 py-0.5 rounded" style={{ border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)" }}>CLS</button>
                  </div>
                </div>
                {intel && (
                  <div className="shrink-0 px-2 py-1 border-b text-[6px] font-mono space-y-0.5" style={{ borderColor: "rgba(255,30,30,0.08)", background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.25)" }}>
                    <div>🖥 {String((intel as any).server?.hostname ?? "N/A")}</div>
                    <div>📊 {String((intel as any).server?.loadAvg ?? "").split(",")[0]?.trim()} load</div>
                    <div>💾 {String((intel as any).server?.memUsage ?? "N/A")}</div>
                    {(intel as any).agentCount > 0 && <div className="font-bold" style={{ color: "rgba(68,255,136,0.5)" }}>🟢 {(intel as any).agents?.[0]?.hostname}</div>}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-1 space-y-1 min-h-0" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,30,30,0.1) transparent" }}>
                  {tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-1 opacity-40">
                      <Activity className="w-4 h-4" style={{ color: "rgba(255,50,50,0.4)" }} />
                      <span className="text-[7px] font-mono text-center" style={{ color: "rgba(255,100,100,0.5)" }}>لا مهام بعد</span>
                    </div>
                  ) : (
                    [...tasks].reverse().map(task => {
                      const sc = task.status === "done" ? "#44ff88" : task.status === "running" ? "#ffaa00" : task.status === "failed" ? "#ff4444" : "rgba(255,255,255,0.3)";
                      const si = task.status === "done" ? "✓" : task.status === "running" ? "⟳" : task.status === "failed" ? "✗" : "◌";
                      return (
                        <div key={task.id} className="rounded-lg px-1.5 py-1" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${sc}22` }}>
                          <div className="flex items-start gap-1">
                            <span className={`text-[8px] shrink-0 mt-0.5 ${task.status === "running" ? "animate-spin" : ""}`} style={{ color: sc }}>{si}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[7px] font-mono leading-tight break-words" style={{ color: "rgba(255,255,255,0.6)" }}>{task.title.slice(0, 60)}</div>
                              <div className="flex gap-1 mt-0.5 flex-wrap">
                                {task.type && <span className="text-[5px] font-mono px-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>{task.type}</span>}
                                {task.agentId && <span className="text-[5px] font-mono px-0.5 rounded" style={{ background: "rgba(68,255,136,0.08)", color: "rgba(68,255,136,0.5)" }}>🖥️</span>}
                              </div>
                              {task.status === "running" && (
                                <div className="mt-1 h-0.5 rounded overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                                  <div className="h-full rounded animate-pulse" style={{ width: `${task.progress}%`, background: "#ffaa00" }} />
                                </div>
                              )}
                              {task.result && task.status === "done" && (
                                <div className="text-[6px] mt-0.5 font-mono" style={{ color: "rgba(68,255,136,0.5)" }}>{task.result.slice(0, 60)}</div>
                              )}
                              {task.error && <div className="text-[6px] mt-0.5 font-mono" style={{ color: "rgba(255,100,100,0.6)" }}>⚠ {task.error.slice(0, 50)}</div>}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="shrink-0 px-2 py-1 border-t grid grid-cols-4 gap-0.5" style={{ borderColor: "rgba(255,30,30,0.1)" }}>
                  {[{ label: "⟳", val: tasks.filter(t => t.status === "running").length, color: "#ffaa00" }, { label: "✓", val: tasks.filter(t => t.status === "done").length, color: "#44ff88" }, { label: "✗", val: tasks.filter(t => t.status === "failed").length, color: "#ff4444" }, { label: "◌", val: tasks.filter(t => t.status === "queued").length, color: "rgba(255,255,255,0.3)" }].map(s => (
                    <div key={s.label} className="flex flex-col items-center">
                      <span className="text-[8px]" style={{ color: s.color }}>{s.label}</span>
                      <span className="text-[7px] font-mono font-bold" style={{ color: s.color }}>{s.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* ── SHELL TAB ───────────────────────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {tab === "shell" && (
        <div className="flex-1 flex flex-col min-h-0">
          {!agentConnected ? (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              <div className="rounded-xl border border-emerald-700/50 bg-emerald-950/20 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-300">Nova Agent — الاتصال بجهاز كالي</span>
                </div>
                <div className="space-y-2 text-[9px] font-mono">
                  <div className="bg-black/70 border border-emerald-900/60 rounded px-2 py-2">
                    <div className="text-emerald-700 mb-1 text-[8px]"># تحميل + تشغيل في أمر واحد</div>
                    <div className="select-all text-emerald-200 font-bold break-all leading-relaxed">{`curl -sL "${window.location.origin}/api/local-agent/download-nova-agent" -o nova-agent.js && node nova-agent.js wss://${window.location.host}/api/local-agent/ws`}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    {[
                      { label: "تحميل nova-agent.js", cmd: `curl -sL "${window.location.origin}/api/local-agent/download-nova-agent" -o nova-agent.js` },
                      { label: "تشغيل الوكيل", cmd: `node nova-agent.js wss://${window.location.host}/api/local-agent/ws` },
                      { label: "تثبيت Node.js", cmd: "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs" },
                      { label: "تشغيل مع pm2", cmd: `npm i -g pm2 && pm2 start nova-agent.js -- wss://${window.location.host}/api/local-agent/ws` },
                    ].map(item => (
                      <button key={item.label}
                        onClick={() => { navigator.clipboard.writeText(item.cmd).catch(() => {}); }}
                        className="text-[7px] font-mono px-2 py-1 rounded border border-emerald-900/40 text-emerald-700 hover:text-emerald-300 hover:bg-emerald-900/20 transition text-right break-all">
                        📋 {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              {agentList.length > 1 && (
                <div className="shrink-0 px-2 py-1.5 border-b border-rose-900/30 flex items-center gap-1.5 overflow-x-auto" style={{ background: "rgba(6,0,10,0.9)" }}>
                  {agentList.map(a => (
                    <button key={a.id} onClick={() => setSelectedAgentId(a.id)}
                      className={`text-[8px] font-mono px-2 py-0.5 rounded border transition-all shrink-0 ${selectedAgentId === a.id ? "border-rose-400/60 text-rose-200 bg-rose-500/15" : "border-rose-900/40 text-rose-700"}`}>
                      {a.user}@{a.hostname}
                    </button>
                  ))}
                </div>
              )}
              <div ref={shellScrollRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0" style={{ background: "rgba(0,2,0,0.99)" }}>
                {shellLines.map((line, i) => {
                  if (line.kind === "cmd") return (
                    <div key={i} className="flex items-start gap-1.5 mt-1.5">
                      <span className="text-rose-700 shrink-0 text-[9px] select-none">{agentList.find(a => a.id === selectedAgentId)?.user ?? "kali"}@{agentList.find(a => a.id === selectedAgentId)?.hostname ?? "local"}:~$</span>
                      <span className="text-rose-200 font-bold break-all text-[9px]">{line.text}</span>
                    </div>
                  );
                  if (line.kind === "stdout") return <pre key={i} className="text-rose-400/80 whitespace-pre-wrap break-all pl-2 border-l-2 border-rose-900 text-[9px] leading-relaxed">{line.text}</pre>;
                  if (line.kind === "stderr") return <pre key={i} className="text-amber-400/80 whitespace-pre-wrap break-all pl-2 border-l-2 border-amber-900 text-[9px] leading-relaxed">{line.text}</pre>;
                  if (line.kind === "error") return <div key={i} className="text-rose-500 font-bold text-[9px]">⚠ {line.text}</div>;
                  if (line.kind === "system") return <div key={i} className="text-rose-900 text-[8px] select-none">// {line.text}</div>;
                  return null;
                })}
                {shellBusy && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Loader2 className="w-3 h-3 text-rose-500 animate-spin" />
                    <span className="text-rose-700 text-[9px]">تنفيذ...</span>
                  </div>
                )}
              </div>
              {/* Quick commands */}
              <div className="shrink-0 px-2 py-1 flex gap-1 flex-wrap border-t border-rose-900/40 max-h-16 overflow-y-auto" style={{ background: "rgba(4,0,6,0.9)" }}>
                {QUICK_CMDS.map(cmd => (
                  <button key={cmd} onClick={() => execOnKali(cmd)} disabled={shellBusy}
                    className="text-[8px] px-1.5 py-0.5 rounded bg-black/40 border border-rose-900/50 text-rose-700 hover:text-rose-300 hover:bg-rose-900/30 transition disabled:opacity-40 shrink-0">
                    {cmd}
                  </button>
                ))}
              </div>
              {/* Command input */}
              <div className="shrink-0 border-t border-rose-900/50" style={{ background: "rgba(3,0,5,0.99)" }}>
                <form onSubmit={e => { e.preventDefault(); const cmd = shellInput.trim(); if (!cmd || shellBusy) return; setShellInput(""); execOnKali(cmd); }}>
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <span className="text-rose-600 text-[11px] shrink-0 select-none font-bold">$</span>
                    <input value={shellInput}
                      onChange={e => { setShellInput(e.target.value); setHistIdx(-1); }}
                      onKeyDown={e => {
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          const nextIdx = Math.min(histIdx + 1, cmdHistory.length - 1);
                          setHistIdx(nextIdx);
                          if (cmdHistory[nextIdx]) setShellInput(cmdHistory[nextIdx]);
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          const nextIdx = Math.max(histIdx - 1, -1);
                          setHistIdx(nextIdx);
                          setShellInput(nextIdx === -1 ? "" : cmdHistory[nextIdx]);
                        }
                      }}
                      placeholder={`أمر على ${agentList.find(a => a.id === selectedAgentId)?.hostname ?? "كالي"}... (↑↓ للتاريخ)`}
                      disabled={shellBusy}
                      className="flex-1 bg-transparent outline-none text-rose-300 text-[10px] placeholder:text-rose-900 disabled:opacity-40"
                      style={{ caretColor: "#ff4444" }} />
                    <button type="submit" disabled={shellBusy || !shellInput.trim()} className="text-rose-600 hover:text-rose-300 disabled:opacity-20 transition">
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </form>
                <div className="px-2 pb-1.5 flex items-center gap-1.5">
                  <button onClick={() => void sendToAI("نفّذ تشخيص سريع: [AGENT_EXEC: id && whoami && uname -a]")}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/30 text-violet-300 hover:bg-violet-500/20 transition flex items-center gap-1">
                    <Brain className="w-2.5 h-2.5" /> KALI AI
                  </button>
                  <button onClick={() => setShellLines([{ kind: "system", text: `Terminal cleared — ${new Date().toLocaleTimeString()}`, ts: Date.now() }])}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/30 border border-rose-900/30 text-rose-800 hover:text-rose-500 transition">CLS</button>
                  <span className="text-[8px] text-rose-900 ms-auto">{shellLines.filter(l => l.kind === "cmd").length} أوامر</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* ── DASHBOARD TAB ───────────────────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {tab === "dashboard" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0" style={{ background: "rgba(2,0,6,0.99)", scrollbarWidth: "thin" }}>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "AI Model", val: aiOnline ? aiModel.replace(":latest", "") : "offline", color: aiOnline ? "#a78bfa" : "#ff4444", dot: aiOnline },
              { label: "كالي جهاز", val: agentConnected ? `${agentList[0]?.user}@${agentList[0]?.hostname}` : "غير متصل", color: agentConnected ? "#44ff88" : "#ff6666", dot: agentConnected },
              { label: "المهام نشطة", val: `${tasks.filter(t => t.status === "running").length}/${tasks.length}`, color: "#38bdf8", dot: tasks.filter(t => t.status === "running").length > 0 },
              { label: "وضع مستقل", val: autonomous ? "نشط ⚡" : "موقوف", color: autonomous ? "#fb923c" : "rgba(255,255,255,0.2)", dot: autonomous },
            ].map(s => (
              <div key={s.label} className="rounded-lg px-2 py-1.5 flex flex-col" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,50,50,0.1)" }}>
                <div className="flex items-center gap-1 mb-0.5">
                  {s.dot && <span className="w-1 h-1 rounded-full animate-pulse shrink-0" style={{ background: s.color }} />}
                  <span className="text-[7px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{s.label}</span>
                </div>
                <span className="text-[9px] font-mono font-bold truncate" style={{ color: s.color }}>{s.val}</span>
              </div>
            ))}
          </div>
          {/* Autonomous log */}
          {autonomous && autoLog.length > 0 && (
            <div className="rounded-lg p-2" style={{ background: "rgba(251,146,60,0.04)", border: "1px solid rgba(251,146,60,0.15)" }}>
              <div className="text-[7px] font-black tracking-widest mb-1.5" style={{ color: "rgba(251,146,60,0.5)" }}>AUTO LOG</div>
              <div className="space-y-0.5 max-h-28 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {autoLog.slice(-8).reverse().map((e, i) => (
                  <div key={i} className="text-[7px] font-mono flex items-start gap-1.5" style={{ color: e.error ? "#ff6666" : "rgba(251,146,60,0.6)" }}>
                    <span className="shrink-0 opacity-50">{new Date(e.ts).toLocaleTimeString("ar")}</span>
                    <span className="font-bold shrink-0">{e.title}:</span>
                    <span className="truncate">{(e.result || e.error || "").slice(0, 60)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Tasks list */}
          {tasks.length > 0 && (
            <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,50,50,0.1)" }}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[7px] font-black tracking-widest" style={{ color: "rgba(255,80,80,0.5)" }}>TASKS ({tasks.length})</div>
                <button onClick={() => fetch(API("/kali-command/tasks"), { method: "DELETE" }).then(() => setTasks([]))}
                  className="text-[6px] font-mono text-rose-900 hover:text-rose-500 transition">CLS</button>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {[...tasks].reverse().map(t => {
                  const sc = t.status === "done" ? "#44ff88" : t.status === "running" ? "#ffaa00" : t.status === "failed" ? "#ff4444" : "rgba(255,255,255,0.3)";
                  return (
                    <div key={t.id} className="rounded px-1.5 py-1" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${sc}22` }}>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[8px] ${t.status === "running" ? "animate-spin" : ""}`} style={{ color: sc }}>
                          {t.status === "done" ? "✓" : t.status === "running" ? "⟳" : t.status === "failed" ? "✗" : "◌"}
                        </span>
                        <span className="text-[7px] font-mono flex-1 truncate" style={{ color: "rgba(255,255,255,0.6)" }}>{t.title}</span>
                        <span className="text-[6px] font-mono" style={{ color: sc }}>{t.status}</span>
                      </div>
                      {t.status === "running" && (
                        <div className="mt-1 h-0.5 rounded overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                          <div className="h-full rounded animate-pulse" style={{ width: `${t.progress}%`, background: "#ffaa00" }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Mission launcher */}
          <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,50,50,0.1)" }}>
            <div className="text-[7px] font-black tracking-widest mb-1.5" style={{ color: "rgba(255,80,80,0.5)" }}>MISSION LAUNCHER</div>
            <div className="grid grid-cols-2 gap-1">
              {MISSIONS.slice(0, 6).map(m => (
                <button key={m.label} onClick={() => { setTab("dolphin"); void sendToAI(m.prompt.replace(/localhost/g, target)); }}
                  disabled={busy}
                  className="text-[7px] font-mono px-2 py-1.5 rounded-lg text-right transition-all disabled:opacity-30"
                  style={{ background: "rgba(255,20,20,0.05)", border: "1px solid rgba(255,50,50,0.15)", color: "rgba(255,150,150,0.8)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,30,30,0.12)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,20,20,0.05)"; }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* ── FILES TAB ───────────────────────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {tab === "files" && (
        <div className="flex-1 flex flex-col min-h-0">
          {!agentConnected ? (
            <div className="flex-1 flex items-center justify-center text-center p-6">
              <div>
                <Folder className="w-8 h-8 text-amber-900 mx-auto mb-2" />
                <div className="text-[10px] text-amber-800">لا يوجد اتصال — وصّل Nova Agent أولاً</div>
              </div>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-2 py-1.5 border-b border-amber-900/30 flex items-center gap-2" style={{ background: "rgba(6,4,0,0.9)" }}>
                <FolderOpen className="w-3 h-3 text-amber-600 shrink-0" />
                <span className="text-[9px] font-mono text-amber-400 flex-1 truncate">{fsDir}</span>
                <button onClick={() => { const parent = fsDir.split("/").slice(0, -1).join("/") || "/"; loadFs(parent); }} className="text-[8px] text-amber-700 hover:text-amber-400 transition flex items-center gap-0.5">
                  <FolderUp className="w-2.5 h-2.5" /> أعلى
                </button>
                <button onClick={() => loadFs(fsDir)} className="text-amber-700 hover:text-amber-400 transition">
                  <RefreshCw className={`w-2.5 h-2.5 ${fsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="flex-1 flex min-h-0">
                <div className={`${fileContent !== null ? "w-1/2" : "w-full"} flex flex-col border-r border-amber-900/20 overflow-y-auto`}>
                  {fsLoading ? (
                    <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 text-amber-600 animate-spin" /></div>
                  ) : fsEntries.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-[9px] text-amber-900">مجلد فارغ</div>
                  ) : (
                    <div className="p-1 space-y-0.5">
                      {fsEntries.sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0)).map(entry => (
                        <button key={entry.path} onClick={() => {
                          if (entry.isDir) { loadFs(entry.path); }
                          else {
                            setSelectedFile(entry); setFileContent(null); setFileLoading(true);
                            fetch(API(`/local-agent/fs/read?agentId=${selectedAgentId}&path=${encodeURIComponent(entry.path)}`))
                              .then(r => r.json() as Promise<{ content?: string; error?: string }>)
                              .then(d => setFileContent(d.content ?? d.error ?? ""))
                              .finally(() => setFileLoading(false));
                          }
                        }}
                          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all ${selectedFile?.path === entry.path ? "bg-amber-500/20 border border-amber-600/30" : "hover:bg-amber-900/20 border border-transparent"}`}>
                          {entry.isDir ? <Folder className="w-3 h-3 text-amber-500 shrink-0" /> : <FileCode className="w-3 h-3 text-amber-800 shrink-0" />}
                          <span className={`text-[9px] font-mono flex-1 truncate ${entry.isDir ? "text-amber-300 font-bold" : "text-amber-600"}`}>{entry.name}</span>
                          {!entry.isDir && <span className="text-[7px] text-amber-900 shrink-0">{entry.size > 1024 ? `${(entry.size / 1024).toFixed(1)}k` : `${entry.size}b`}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {fileContent !== null && (
                  <div className="w-1/2 flex flex-col">
                    <div className="shrink-0 px-2 py-1 border-b border-amber-900/20 flex items-center gap-1 bg-black/30">
                      <span className="text-[8px] font-mono text-amber-600 flex-1 truncate">{selectedFile?.name}</span>
                      <button onClick={() => { void sendToAI(`حلّل الملف "${selectedFile?.name}":\n\`\`\`\n${fileContent.slice(0, 2000)}\n\`\`\``); setTab("dolphin"); }}
                        className="text-[7px] text-violet-700 hover:text-violet-400 transition"><Brain className="w-2.5 h-2.5" /></button>
                      <button onClick={() => { setFileContent(null); setSelectedFile(null); }} className="text-amber-800 hover:text-amber-400"><X className="w-2.5 h-2.5" /></button>
                    </div>
                    {fileLoading ? (
                      <div className="flex-1 flex items-center justify-center"><Loader2 className="w-4 h-4 text-amber-600 animate-spin" /></div>
                    ) : (
                      <pre className="flex-1 overflow-auto p-2 text-[8px] font-mono text-amber-400/80 whitespace-pre-wrap break-all leading-relaxed" style={{ background: "rgba(4,2,0,0.98)" }}>{fileContent}</pre>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* ── PROCESSES TAB ───────────────────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {tab === "processes" && (
        <div className="flex-1 flex flex-col min-h-0">
          {!agentConnected ? (
            <div className="flex-1 flex items-center justify-center text-center p-6">
              <div><Activity className="w-8 h-8 text-cyan-900 mx-auto mb-2" /><div className="text-[10px] text-cyan-800">لا يوجد اتصال</div></div>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-2 py-1.5 border-b border-cyan-900/30 flex items-center gap-2" style={{ background: "rgba(0,6,8,0.9)" }}>
                <div className="flex items-center gap-2 bg-black/60 border border-cyan-900/40 rounded px-2 py-0.5 flex-1">
                  <Search className="w-2.5 h-2.5 text-cyan-700" />
                  <input value={procSearch} onChange={e => setProcSearch(e.target.value)} placeholder="ابحث..." className="bg-transparent text-[9px] text-cyan-300 outline-none placeholder:text-cyan-900 flex-1 font-mono" />
                  {procSearch && <button onClick={() => setProcSearch("")}><X className="w-2 h-2 text-cyan-700" /></button>}
                </div>
                <button onClick={loadProcesses} className="text-cyan-700 hover:text-cyan-400 transition">
                  <RefreshCw className={`w-3 h-3 ${procsLoading ? "animate-spin" : ""}`} />
                </button>
                <span className="text-[8px] text-cyan-800 font-mono">{processes.length} عملية</span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {procsLoading && processes.length === 0 ? (
                  <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 text-cyan-600 animate-spin" /></div>
                ) : (
                  <table className="w-full text-[8px] font-mono">
                    <thead className="sticky top-0 bg-[#000a0c]/95 border-b border-cyan-900/30">
                      <tr>
                        <th className="text-left px-2 py-1 text-cyan-700">PID</th>
                        <th className="text-left px-2 py-1 text-cyan-700">المستخدم</th>
                        <th className="text-left px-2 py-1 text-cyan-700">CPU%</th>
                        <th className="text-left px-2 py-1 text-cyan-700">MEM%</th>
                        <th className="text-left px-2 py-1 text-cyan-700 flex-1">الأمر</th>
                        <th className="px-2 py-1 text-cyan-700">⛔</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processes
                        .filter(p => !procSearch || p.command.toLowerCase().includes(procSearch.toLowerCase()) || p.pid.includes(procSearch) || p.user.toLowerCase().includes(procSearch.toLowerCase()))
                        .map(proc => (
                          <tr key={proc.pid} className="border-b border-cyan-900/10 hover:bg-cyan-900/10 transition-colors">
                            <td className="px-2 py-0.5 text-cyan-400">{proc.pid}</td>
                            <td className="px-2 py-0.5 text-cyan-600">{proc.user}</td>
                            <td className="px-2 py-0.5 text-emerald-500">{proc.cpu}</td>
                            <td className="px-2 py-0.5 text-amber-500">{proc.mem}</td>
                            <td className="px-2 py-0.5 text-cyan-300 max-w-[120px] truncate">{proc.command}</td>
                            <td className="px-2 py-0.5">
                              <button onClick={() => {
                                if (!selectedAgentId) return;
                                fetch(API(`/local-agent/kill-process?agentId=${selectedAgentId}&pid=${proc.pid}`), { method: "POST" })
                                  .then(() => setProcesses(prev => prev.filter(p => p.pid !== proc.pid)))
                                  .catch(() => {});
                              }} className="text-rose-700 hover:text-rose-400 transition"><X className="w-2.5 h-2.5" /></button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* ── SCREENSHOT TAB ──────────────────────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {tab === "screenshot" && (
        <div className="flex-1 flex flex-col min-h-0">
          {!agentConnected ? (
            <div className="flex-1 flex items-center justify-center text-center p-6">
              <div><Camera className="w-8 h-8 text-green-900 mx-auto mb-2" /><div className="text-[10px] text-green-800">لا يوجد اتصال</div></div>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-2 py-2 border-b border-green-900/30 flex items-center gap-2" style={{ background: "rgba(0,6,2,0.9)" }}>
                <Camera className="w-3 h-3 text-green-600" />
                <span className="text-[9px] text-green-400 font-mono flex-1">لقطة شاشة الجهاز المتصل</span>
                <button onClick={takeScreenshot} disabled={screenshotLoading}
                  className="text-[9px] font-mono px-3 py-1 rounded-lg bg-green-900/40 border border-green-700/40 text-green-300 hover:bg-green-800/50 transition disabled:opacity-40 flex items-center gap-1.5">
                  {screenshotLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                  التقاط الآن
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 flex flex-col items-center justify-center min-h-0">
                {screenshotLoading ? (
                  <div className="flex flex-col items-center gap-2 text-green-700">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-[9px] font-mono">جاري الالتقاط...</span>
                  </div>
                ) : screenshotError ? (
                  <div className="text-center">
                    <Camera className="w-6 h-6 text-rose-900 mx-auto mb-2" />
                    <div className="text-[9px] text-rose-600 font-mono">{screenshotError}</div>
                    <code className="text-[7px] text-rose-800 block mt-1">apt-get install -y scrot</code>
                  </div>
                ) : screenshot ? (
                  <div className="w-full">
                    <img src={screenshot} alt="Screenshot" className="w-full rounded-lg border border-green-900/40 object-contain max-h-[400px]" />
                    <div className="flex items-center justify-center gap-2 mt-2">
                      <a href={screenshot} download="nova-screenshot.png"
                        className="text-[8px] font-mono px-2 py-0.5 rounded border border-green-800/40 text-green-600 hover:text-green-300 hover:bg-green-900/30 transition flex items-center gap-1">
                        <Download className="w-2.5 h-2.5" /> تحميل
                      </a>
                      <button onClick={() => void sendToAI("حلّل لقطة الشاشة: ماذا ترى؟ أي تطبيقات/نوافذ/بيانات مرئية؟")}
                        className="text-[8px] font-mono px-2 py-0.5 rounded border border-violet-800/40 text-violet-600 hover:text-violet-300 hover:bg-violet-900/30 transition flex items-center gap-1">
                        <Brain className="w-2.5 h-2.5" /> تحليل AI
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground">
                    <Camera className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <div className="text-[10px]">اضغط "التقاط الآن"</div>
                    <div className="text-[8px] mt-1 opacity-60">يستخدم scrot أو import (ImageMagick)</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
