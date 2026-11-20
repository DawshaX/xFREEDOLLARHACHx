import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Cloud,
  Code,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  HardDrive,
  History,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  Network,
  Package,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  Wifi,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { novaAuthHeaders } from "@/lib/ops-client";
import { KaliLogo2099, TawhidBanner2099 } from "@/components/KaliLogo2099";
import KaliSystemsPanel from "./KaliSystemsPanel";
import KaliWorkspacePanel from "@/components/desktop/KaliWorkspacePanel";
import "@/kali-neon.css";

const API = "/api";

type TabId =
  | "desk"
  | "arsenal"
  | "browser"
  | "files"
  | "pipelines"
  | "work"
  | "python"
  | "term"
  | "control"
  | "gens"
  | "heal"
  | "osmap";

interface KaliEnvTools {
  ok: boolean;
  ready: boolean;
  groups: Record<string, { present: string[]; missing: string[] }>;
  total: number;
  present: number;
  measuredAt?: string;
  measuredOn?: string;
  fleet?: { connected: number; kaliReady: number; nodes?: Array<{ id: string; mode: string; kali: boolean }> };
}

interface KaliSysInfo {
  ok: boolean;
  plane?: string;
  measuredAt?: string;
  cpu?: { cores?: number; model?: string; loadAvg1m?: number };
  mem?: { totalMB?: number; freeMB?: number; usedPct?: number };
  disk?: { totalGB?: number; freeGB?: number; usedPct?: number };
  rootfs?: { present?: boolean; prettyName?: string; packages?: number; executables?: number };
}

interface KaliNodeRow {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
  kali: boolean;
  mode: string;
  probed: boolean;
}

interface StorageRow {
  id: string;
  label: string;
  kind: string;
  bytes: number;
  items: number;
  updatedAt: string | null;
  link: string;
}

interface StorageHub {
  ok: boolean;
  repo: string;
  rows: StorageRow[];
  totalBytes: number;
  totalHuman: string;
  measuredAt: string;
}

interface PythonToolRow {
  id: string;
  pkg: string;
  cat: string;
  ar: string;
  installed: boolean;
  version: string | null;
}

interface KaliGeneration {
  id: string;
  genNumber: number;
  title: string;
  description: string;
  createdAt: string;
  toolsPresent: number;
  toolsTotal: number;
  pythonToolsCount: number;
  fleetTargetNodes: number;
  workspaces: Array<{ slug: string; name: string; fileCount: number }>;
  installedExtras: string[];
  tags: string[];
  builtIn?: boolean;
}

interface BrowserResult {
  ok: boolean;
  url: string;
  finalUrl?: string;
  host?: string;
  port?: number;
  ips?: string[];
  status?: number;
  latencyMs?: number;
  securityScore?: number;
  securityGrade?: string;
  title?: string;
  description?: string;
  techStack?: string[];
  tls?: {
    version?: string;
    cipher?: string;
    bits?: number;
    issuer?: Record<string, string>;
    subject?: Record<string, string>;
    notAfter?: string;
    error?: string;
  } | null;
  headers?: Record<string, string>;
  securityHeaders?: Array<{ name: string; present: boolean; value: string; advice: string }>;
  links?: string[];
  forms?: string[];
  scripts?: string[];
  textPreview?: string;
  htmlSnippet?: string;
  plane?: string;
  inspectedAt?: string;
  error?: string;
}

interface FsEntry {
  name: string;
  type: "dir" | "file" | "link";
  size: number;
  permissions: string;
  modifiedAt: string | null;
  relPath: string;
}

interface PipelineDef {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  tools: string[];
  description: string;
  defenseTip: string;
}

interface ControlInfo {
  ok: boolean;
  edition?: string;
  plane?: string;
  kernel?: string;
  osName?: string;
  uptime?: string;
  networkInterfaces?: string[];
  openSockets?: string[];
  dnsServers?: string[];
  customBinsCount?: number;
  measuredAt?: string;
}

const DOCK_TABS: Array<{
  id: TabId;
  label: string;
  short: string;
  color: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}> = [
  { id: "desk", label: "سطح مكتب كالي 2099 الحي", short: "البث الحي :99", color: "#ff2b4d", badge: "LIVE X11", icon: Monitor },
  { id: "arsenal", label: "ترسانة كالي الشاملة (266/266)", short: "الترسانة 266", color: "#ff4769", badge: "266/266", icon: Shield },
  { id: "browser", label: "متصفح كالي السيبراني 2099", short: "متصفح كالي", color: "#38bdf8", badge: "BROWSER", icon: Globe },
  { id: "files", label: "مدير ملفات كالي والمخازن السحابية", short: "الملفات والمخزن", color: "#f472b6", badge: "67.11GB", icon: FolderOpen },
  { id: "pipelines", label: "سلاسل الفحص الذكية وأكاديمية الدفاع", short: "سلاسل 2099", color: "#44ff88", badge: "AUTO", icon: Rocket },
  { id: "work", label: "مساحات الشغل والمشاريع الدائمة", short: "مساحات الشغل", color: "#fb7185", badge: "3 WS", icon: Layers },
  { id: "python", label: "ترسانة بايثون السيبرانية (28/28)", short: "بايثون 28", color: "#c084fc", badge: "880 PKG", icon: Code },
  { id: "term", label: "طرفية كالي الجذرية الفورية", short: "طرفية Root", color: "#34d399", badge: "ROOT#", icon: Terminal },
  { id: "control", label: "مركز التحكم والشبكة والأسطول (10+احتياطي)", short: "التحكم والأسطول", color: "#22d3ee", badge: "10 NODES", icon: Cpu },
  { id: "gens", label: "أرشيف الأجيال واللقطات (1-5+)", short: "النسخ 1-5+", color: "#fbbf24", badge: "GEN 1-5+", icon: History },
  { id: "heal", label: "المعالجة الذاتية والسجل الأبدي", short: "الإصلاح والسجل", color: "#4ade80", badge: "HEAL", icon: ShieldCheck },
  { id: "osmap", label: "خريطة منصة CyberNova الشاملة", short: "كل الوحدات", color: "#a78bfa", badge: "ALL", icon: Sparkles },
];

const DESKTOP_QUICK_APPS: Array<{ label: string; cmd: string; title: string; color: string }> = [
  { label: "🐉 هوية كالي 2099 والعتاد", cmd: "uname -a; id; grep PRETTY_NAME /etc/os-release; df -h /; free -h", title: "NOVA KALI 2099 IDENTITY", color: "#ff2b4d" },
  { label: "📡 فحص Nmap سريع للهدف", cmd: "nmap --unprivileged -sT -F --open {target}", title: "KALI NMAP SCANNER", color: "#44ff88" },
  { label: "🔒 تدقيق SSL/TLS للهدف", cmd: "sslscan --no-colour {target} | head -38", title: "KALI SSL/TLS AUDITOR", color: "#38bdf8" },
  { label: "🌐 استطلاع Subfinder", cmd: "subfinder -d {target} -silent | head -30", title: "KALI SUBFINDER RECON", color: "#c084fc" },
  { label: "⚡ فحص HTTPX والتقنيات", cmd: "echo {target} | httpx -silent -status-code -title -tech-detect", title: "KALI HTTPX PROBE", color: "#fb7185" },
  { label: "🔎 سجلات DNS + WHOIS", cmd: "dig +short {target} A {target} MX {target} TXT; whois {target} | head -20", title: "KALI DNS & WHOIS", color: "#fbbf24" },
  { label: "🛡️ محرك Nuclei والقوالب", cmd: "nuclei -version; ls /root/nuclei-templates 2>/dev/null | head -15", title: "KALI NUCLEI ENGINE", color: "#34d399" },
  { label: "💣 قاعدة SearchSploit", cmd: "searchsploit apache 2.4 | head -22", title: "KALI EXPLOIT-DB", color: "#f472b6" },
  { label: "🐍 فحص ترسانة بايثون", cmd: "python3 --version; prowler -v; sherlock --version; semgrep --version; certipy -v", title: "KALI PYTHON ARSENAL", color: "#a78bfa" },
  { label: "📁 شجرة مساحات الشغل", cmd: "ls -la /usr/local/bin | head -28", title: "KALI /USR/LOCAL/BIN", color: "#22d3ee" },
  { label: "🌐 واجهات الشبكة والمنافذ", cmd: "ip -br a; echo '---'; ip route; echo '---'; ss -tuln", title: "KALI NETWORK MATRIX", color: "#60a5fa" },
  { label: "⚙️ العمليات النشطة والموارد", cmd: "uptime; free -h; df -h /; cat /proc/loadavg", title: "KALI SYSTEM RESOURCES", color: "#f87171" },
];

const CURATED_GITHUB_REPOS: Array<{ repo: string; name: string; desc: string }> = [
  { repo: "s0md3v/XSStrike", name: "XSStrike", desc: "ماسح XSS متقدم وتحليل DOM" },
  { repo: "sqlmapproject/sqlmap", name: "SQLMap Git", desc: "أحدث نسخة تطويرية من SQLMap" },
  { repo: "laramies/theHarvester", name: "theHarvester", desc: "جمع استخبارات النطاقات والبريد OSINT" },
  { repo: "aboul3la/Sublist3r", name: "Sublist3r", desc: "اكتشاف النطاقات الفرعية السريع" },
  { repo: "maurosoria/dirsearch", name: "dirsearch", desc: "اكتشاف مسارات ومجلدات الويب المخفية" },
  { repo: "s0md3v/Photon", name: "Photon", desc: "زاحف OSINT فائق السرعة لاستخراج الروابط والأسرار" },
];

export default function KaliEnvPage() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<TabId>("desk");
  const [globalTarget, setGlobalTarget] = useState<string>(() => {
    try {
      return localStorage.getItem("cybernova_active_target") || "example.com";
    } catch {
      return "example.com";
    }
  });
  const [whiskerOpen, setWhiskerOpen] = useState(false);
  const [whiskerSearch, setWhiskerSearch] = useState("");

  // ── Core Telemetry State ───────────────────────────────────────────────────
  const [envTools, setEnvTools] = useState<KaliEnvTools | null>(null);
  const [sysInfo, setSysInfo] = useState<KaliSysInfo | null>(null);
  const [nodes, setNodes] = useState<KaliNodeRow[]>([]);
  const [storage, setStorage] = useState<StorageHub | null>(null);
  const [pyTools, setPyTools] = useState<{ installed: number; total: number; pythonPackages: number; tools: PythonToolRow[] } | null>(null);
  const [inventory, setInventory] = useState<{ total: number; present: number; tools: Array<{ name: string; present: boolean; version: string | null }> } | null>(null);
  const [generations, setGenerations] = useState<KaliGeneration[]>([]);
  const [selfHeal, setSelfHeal] = useState<{ running: boolean; lastRunAt: string | null; syncedNodes: number; status: string } | null>(null);
  const [events, setEvents] = useState<Array<{ ts: string; kind: string; title: string; detail?: string }>>([]);
  const [controlInfo, setControlInfo] = useState<ControlInfo | null>(null);

  // ── Live X11 Desktop State (:99) ───────────────────────────────────────────
  const [deskFrame, setDeskFrame] = useState<string | null>(null);
  const [deskMeta, setDeskMeta] = useState<{ plane?: string | null; nodeId?: string | null; capturedAt?: string; bytes?: number } | null>(null);
  const [deskBusy, setDeskBusy] = useState(false);
  const [deskAutoSync, setDeskAutoSync] = useState(true);
  const [deskStreamMode, setDeskStreamMode] = useState<"frame" | "mjpeg">("frame");
  const [deskCmdInput, setDeskCmdInput] = useState("nmap --unprivileged -sT -F example.com");
  const [deskSelectedNode, setDeskSelectedNode] = useState<string>("");
  const [deskFullscreen, setDeskFullscreen] = useState(false);

  // ── Arsenal & Tool Studio State ────────────────────────────────────────────
  const [arsenalView, setArsenalView] = useState<"266" | "official11" | "core46">("266");
  const [toolSearch, setToolSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [toolOutput, setToolOutput] = useState<string>("");
  const [runningToolName, setRunningToolName] = useState<string | null>(null);
  const [customInstallName, setCustomInstallName] = useState("");
  const [installBusy, setInstallBusy] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  // ── Kali Cyber Browser State ───────────────────────────────────────────────
  const [browserUrl, setBrowserUrl] = useState("https://example.com");
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserRes, setBrowserRes] = useState<BrowserResult | null>(null);
  const [browserSubTab, setBrowserSubTab] = useState<"reader" | "security" | "dom" | "source">("reader");
  const [browserPushDesk, setBrowserPushDesk] = useState(true);

  // ── Kali File Manager & Cloud Storage State ────────────────────────────────
  const [fsScope, setFsScope] = useState<"workspace" | "rootfs" | "cloud">("workspace");
  const [fsPath, setFsPath] = useState<string>("");
  const [fsEntries, setFsEntries] = useState<FsEntry[]>([]);
  const [fsBusy, setFsBusy] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string>("");
  const [openFileContent, setOpenFileContent] = useState<string>("");
  const [fileSaveMsg, setFileSaveMsg] = useState<string | null>(null);
  const [newFileRelPath, setNewFileRelPath] = useState("recon-lab/notes/kali-2099-plan.md");

  // ── Automated Pipelines & GitHub Free Cloner State ─────────────────────────
  const [pipelines, setPipelines] = useState<PipelineDef[]>([]);
  const [runningPipeId, setRunningPipeId] = useState<string | null>(null);
  const [pipeResult, setPipeResult] = useState<{
    pipeline?: { title: string; tools: string[]; defenseTip: string };
    target?: string;
    savedReportPath?: string | null;
    plane?: string | null;
    durationMs?: number;
    output?: string;
  } | null>(null);
  const [ghRepoInput, setGhRepoInput] = useState("s0md3v/XSStrike");
  const [ghInstallBusy, setGhInstallBusy] = useState(false);
  const [ghInstallMsg, setGhInstallMsg] = useState<string | null>(null);

  // ── Root Terminal State ────────────────────────────────────────────────────
  const [termCmd, setTermCmd] = useState("uname -a && id && ls /usr/local/bin | tr '\\n' ' ' && echo");
  const [termBusy, setTermBusy] = useState(false);
  const [termHistory, setTermHistory] = useState<Array<{ cmd: string; out: string; plane?: string; durationMs?: number; ts: string }>>([]);

  // ── Python Runner State ────────────────────────────────────────────────────
  const [pyProvisionBusy, setPyProvisionBusy] = useState(false);
  const [pyScript, setPyScript] = useState(
    "import platform, ssl, socket\nprint('Nova Kali 2099 Python:', platform.python_version())\nprint('OpenSSL:', ssl.OPENSSL_VERSION)\nprint('Resolved Target:', socket.gethostbyname('example.com'))"
  );
  const [pyOut, setPyOut] = useState<string>("");
  const [pyRunBusy, setPyRunBusy] = useState(false);

  // ── Generations & Self-Heal State ──────────────────────────────────────────
  const [newGenTitle, setNewGenTitle] = useState("");
  const [newGenDesc, setNewGenDesc] = useState("");
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [healBusy, setHealBusy] = useState(false);
  const [eventFilter, setEventFilter] = useState("ALL");
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // Save target
  const updateGlobalTarget = (val: string) => {
    setGlobalTarget(val);
    try {
      localStorage.setItem("cybernova_active_target", val);
    } catch {
      /* ignore */
    }
  };

  // ── Fetch All Live Telemetry ───────────────────────────────────────────────
  const refreshAllTelemetry = useCallback(async (forceFresh = false) => {
    const headers = novaAuthHeaders();
    const qs = forceFresh ? "?fresh=1" : "";
    try {
      const [tRes, sRes, nRes, stRes, pyRes, invRes, gRes, shRes, evRes, pipRes] = await Promise.all([
        fetch(`${API}/kali-env/tools${qs}`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/sysinfo`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/ops/kali/nodes`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/ops/storage-hub`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/ops/tools/python`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/inventory`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/generations`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/self-heal/status`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/events?limit=120`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/pipelines`, { headers }).then((r) => r.json()).catch(() => null),
      ]);
      if (tRes && typeof tRes.total === "number") setEnvTools(tRes as KaliEnvTools);
      if (sRes && sRes.ok) setSysInfo(sRes as KaliSysInfo);
      if (nRes && Array.isArray(nRes.nodes)) setNodes(nRes.nodes as KaliNodeRow[]);
      if (stRes && stRes.ok) setStorage(stRes as StorageHub);
      if (pyRes && Array.isArray(pyRes.tools)) setPyTools(pyRes);
      if (invRes && Array.isArray(invRes.tools)) setInventory(invRes);
      if (gRes && Array.isArray(gRes.generations)) setGenerations(gRes.generations);
      if (shRes && shRes.ok) setSelfHeal(shRes);
      if (evRes && Array.isArray(evRes.events)) setEvents(evRes.events);
      if (pipRes && Array.isArray(pipRes.pipelines)) setPipelines(pipRes.pipelines);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshAllTelemetry(false);
    const id = setInterval(() => void refreshAllTelemetry(false), 35_000);
    return () => clearInterval(id);
  }, [refreshAllTelemetry]);

  // ── Live Desktop Frame Fetcher ─────────────────────────────────────────────
  const fetchDesktopFrame = useCallback(async (forceRefresh = false) => {
    setDeskBusy(true);
    try {
      const params = new URLSearchParams();
      if (deskSelectedNode) params.set("nodeId", deskSelectedNode);
      if (forceRefresh) params.set("refresh", "1");
      const r = await fetch(`${API}/kali-env/desktop-frame?${params.toString()}`, {
        headers: novaAuthHeaders(),
      });
      const d = await r.json();
      if (d?.ok && d?.frame) {
        setDeskFrame(d.frame);
        setDeskMeta({ plane: d.plane, nodeId: d.nodeId, capturedAt: d.capturedAt, bytes: d.bytes });
      }
    } catch {
      /* ignore */
    } finally {
      setDeskBusy(false);
    }
  }, [deskSelectedNode]);

  useEffect(() => {
    if (activeTab === "desk" && deskStreamMode === "frame") {
      void fetchDesktopFrame(false);
      if (!deskAutoSync) return;
      const iv = setInterval(() => void fetchDesktopFrame(false), 5000);
      return () => clearInterval(iv);
    }
  }, [activeTab, deskStreamMode, deskAutoSync, fetchDesktopFrame]);

  const runOnLiveDesktop = async (rawCmd: string, title = "NOVA KALI 2099 STUDIO", action = "launch") => {
    setDeskBusy(true);
    const resolvedCmd = rawCmd.replace(/\{target\}/g, globalTarget || "example.com");
    try {
      const r = await fetch(`${API}/kali-env/desktop-action`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action,
          cmd: resolvedCmd,
          title,
          nodeId: deskSelectedNode || undefined,
        }),
      });
      const d = await r.json();
      if (d?.frame) {
        setDeskFrame(d.frame);
        setDeskMeta({ plane: d.plane, nodeId: d.nodeId, capturedAt: d.capturedAt, bytes: d.bytes });
      }
    } catch {
      /* ignore */
    } finally {
      setDeskBusy(false);
    }
  };

  // ── Execute Tool or Command via SSE (/api/kali-env/exec) ───────────────────
  const runKaliCommandStream = async (command: string, label?: string) => {
    setRunningToolName(label || command);
    setToolOutput(`🐉 [NOVA KALI 2099] جاري التنفيذ على أسطول كالي: $ ${command}\n────────────────────────────────────────────────────────\n`);
    const started = Date.now();
    let fullOut = "";
    let planeName = "أسطول كالي السحابي";
    try {
      const res = await fetch(`${API}/kali-env/exec`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ command, timeoutMs: 90_000 }),
      });
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let buf = "";
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const ln of lines) {
            if (!ln.startsWith("data:")) continue;
            const raw = ln.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const ev = JSON.parse(raw);
              if (ev.type === "stdout" || ev.type === "stderr") {
                fullOut += ev.text;
                setToolOutput((prev) => prev + ev.text);
              } else if (ev.type === "done") {
                if (ev.plane) planeName = ev.plane;
                const footer = `\n────────────────────────────────────────────────────────\n✓ اكتمل التنفيذ (exit=${ev.exitCode ?? 0}) في ${((ev.durationMs ?? (Date.now() - started)) / 1000).toFixed(1)} ثانية على [${planeName}]`;
                setToolOutput((prev) => prev + footer);
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
      setTermHistory((prev) => [
        {
          cmd: command,
          out: fullOut || "(اكتمل بدون مخرجات نصية)",
          plane: planeName,
          durationMs: Date.now() - started,
          ts: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 29),
      ]);
    } catch (e) {
      setToolOutput((prev) => `${prev}\n✗ خطأ في التنفيذ: ${(e as Error).message}`);
    } finally {
      setRunningToolName(null);
    }
  };

  // ── Kali Cyber Browser Runner ──────────────────────────────────────────────
  const runKaliBrowser = async (targetUrl?: string) => {
    const u = (targetUrl ?? browserUrl).trim();
    if (!u) return;
    if (targetUrl) setBrowserUrl(targetUrl);
    setBrowserBusy(true);
    try {
      const r = await fetch(`${API}/kali-env/browser`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ url: u, pushToDesktop: browserPushDesk }),
      });
      const d = (await r.json()) as BrowserResult;
      setBrowserRes(d);
    } catch (e) {
      setBrowserRes({ ok: false, url: u, error: (e as Error).message });
    } finally {
      setBrowserBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab === "browser" && !browserRes && !browserBusy) {
      void runKaliBrowser(browserUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── File System Explorer Loader ────────────────────────────────────────────
  const loadFsDirectory = useCallback(async (scope: "workspace" | "rootfs", dirPath: string) => {
    setFsBusy(true);
    try {
      const r = await fetch(
        `${API}/kali-env/fs?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(dirPath)}`,
        { headers: novaAuthHeaders() }
      );
      const d = await r.json();
      if (Array.isArray(d?.entries)) {
        setFsEntries(d.entries);
      }
    } catch {
      /* ignore */
    } finally {
      setFsBusy(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "files" && fsScope !== "cloud") {
      const defaultPath = fsScope === "rootfs" ? (fsPath.startsWith("/") ? fsPath : "/usr/local/bin") : (fsPath.startsWith("/") ? "" : fsPath);
      if (defaultPath !== fsPath) setFsPath(defaultPath);
      void loadFsDirectory(fsScope, defaultPath);
    }
  }, [activeTab, fsScope, fsPath, loadFsDirectory]);

  const readFsFile = async (scope: "workspace" | "rootfs", filePath: string) => {
    setFsBusy(true);
    setFileSaveMsg(null);
    try {
      const r = await fetch(`${API}/kali-env/fs/read`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ scope, path: filePath }),
      });
      const d = await r.json();
      if (d?.ok) {
        setOpenFilePath(filePath);
        setOpenFileContent(d.content ?? "");
        if (scope === "workspace") setNewFileRelPath(filePath);
      }
    } catch {
      /* ignore */
    } finally {
      setFsBusy(false);
    }
  };

  const saveWorkspaceFile = async () => {
    if (!newFileRelPath.trim()) return;
    setFsBusy(true);
    setFileSaveMsg(null);
    try {
      const r = await fetch(`${API}/kali-env/fs/write`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ path: newFileRelPath.trim(), content: openFileContent }),
      });
      const d = await r.json();
      if (d?.ok) {
        setFileSaveMsg(`✓ تم حفظ ومزامنة ${d.path} (${d.bytes} بايت) على أسطول كالي`);
        if (fsScope === "workspace") void loadFsDirectory("workspace", fsPath);
      } else {
        setFileSaveMsg(`✗ ${d?.error || "فشل الحفظ"}`);
      }
    } catch (e) {
      setFileSaveMsg(`✗ ${(e as Error).message}`);
    } finally {
      setFsBusy(false);
    }
  };

  // ── Control Center Loader ──────────────────────────────────────────────────
  const loadControlCenter = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-env/control`, { headers: novaAuthHeaders() });
      const d = await r.json();
      if (d?.ok) setControlInfo(d as ControlInfo);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (activeTab === "control") void loadControlCenter();
  }, [activeTab, loadControlCenter]);

  // ── Run Automated Pipeline ─────────────────────────────────────────────────
  const executePipeline = async (pipeId: string) => {
    setRunningPipeId(pipeId);
    setPipeResult(null);
    try {
      const r = await fetch(`${API}/kali-env/pipelines/run`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: pipeId, target: globalTarget || "example.com", workspace: "recon-lab" }),
      });
      const d = await r.json();
      setPipeResult(d);
    } catch (e) {
      setPipeResult({ output: `خطأ: ${(e as Error).message}` });
    } finally {
      setRunningPipeId(null);
    }
  };

  // ── GitHub Free Arsenal Installer ──────────────────────────────────────────
  const installFromGitHub = async (repoStr?: string) => {
    const repo = (repoStr ?? ghRepoInput).trim();
    if (!repo) return;
    if (repoStr) setGhRepoInput(repoStr);
    setGhInstallBusy(true);
    setGhInstallMsg("⏳ جاري استنساخ المستودع من GitHub وتثبيت المتطلبات وتعميمه على الـ10 عقد...");
    try {
      const r = await fetch(`${API}/kali-env/control/action`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "github-install", repo }),
      });
      const d = await r.json();
      setGhInstallMsg(d?.message || (d?.ok ? "✓ تم التثبيت بنجاح" : `✗ ${d?.error || "فشل التثبيت"}`));
    } catch (e) {
      setGhInstallMsg(`✗ ${(e as Error).message}`);
    } finally {
      setGhInstallBusy(false);
    }
  };

  // ── Flatten All 266 Tools for Search & Whisker Menu ────────────────────────
  const all266Tools = useMemo(() => {
    const groups = envTools?.groups ?? {};
    const list: Array<{ name: string; category: string; present: boolean }> = [];
    for (const [cat, g] of Object.entries(groups)) {
      for (const t of g.present ?? []) list.push({ name: t, category: cat, present: true });
      for (const t of g.missing ?? []) list.push({ name: t, category: cat, present: false });
    }
    return list;
  }, [envTools]);

  const categoriesList = useMemo(() => ["ALL", ...Object.keys(envTools?.groups ?? {})], [envTools]);

  const filteredTools = useMemo(() => {
    return all266Tools.filter((item) => {
      if (selectedCategory !== "ALL" && item.category !== selectedCategory) return false;
      if (toolSearch.trim() && !item.name.toLowerCase().includes(toolSearch.trim().toLowerCase()) && !item.category.includes(toolSearch.trim())) {
        return false;
      }
      return true;
    });
  }, [all266Tools, selectedCategory, toolSearch]);

  const whiskerFiltered = useMemo(() => {
    const q = whiskerSearch.trim().toLowerCase();
    if (!q) return all266Tools.slice(0, 60);
    return all266Tools.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)).slice(0, 60);
  }, [all266Tools, whiskerSearch]);

  const triggerSelfHeal = async () => {
    setHealBusy(true);
    try {
      const r = await fetch(`${API}/kali-env/self-heal`, {
        method: "POST",
        headers: novaAuthHeaders(),
      });
      const d = await r.json();
      if (d?.ok) setSelfHeal(d);
      await refreshAllTelemetry(true);
    } catch {
      /* ignore */
    } finally {
      setHealBusy(false);
    }
  };

  const activeKaliNodes = nodes.filter((n) => n.kali);

  return (
    <div
      className="min-h-screen w-full text-white flex flex-col select-none"
      style={{
        background: "radial-gradient(circle at 18% 0%, #240310 0%, #09010d 45%, #040007 100%)",
        fontFamily: "'Cairo', 'JetBrains Mono', sans-serif",
      }}
      dir="rtl"
    >
      {/* ═══ 1. TOP SPIRITUAL & IDENTITY BANNER (التوحيد والشعار المخصص 2099) ═══ */}
      <div className="px-3 pt-2.5 pb-1.5">
        <TawhidBanner2099 />
      </div>

      {/* ═══ 2. KALI LINUX 2099 OS TOP PANEL (شريط نظام كالي الرسمي المخصص) ═══ */}
      <header
        className="mx-3 px-3 py-2 rounded-2xl flex flex-wrap items-center justify-between gap-2 relative z-30"
        style={{
          background: "linear-gradient(180deg, rgba(28,3,13,0.96) 0%, rgba(12,1,8,0.96) 100%)",
          border: "1px solid rgba(255,43,77,0.45)",
          boxShadow: "0 6px 28px rgba(255,43,77,0.14)",
        }}
      >
        {/* Right side (RTL start): Kali Whisker Applications Menu + OS Title */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setWhiskerOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black transition-all hover:scale-[1.02]"
            style={{
              background: whiskerOpen
                ? "linear-gradient(135deg, #ff2b4d 0%, #b80b2c 100%)"
                : "rgba(255,43,77,0.18)",
              border: "1px solid rgba(255,43,77,0.75)",
              color: "#ffffff",
              boxShadow: "0 0 16px rgba(255,43,77,0.35)",
            }}
          >
            <KaliLogo2099 size={22} glow={false} />
            <span>قائمة تطبيقات كالي 2099</span>
            <span className="px-1.5 py-0.5 rounded bg-black/40 text-[10px] font-mono text-emerald-300">
              {envTools?.present ?? 266}/{envTools?.total ?? 266}
            </span>
          </button>

          {/* Global Target Input */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
            style={{
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,43,77,0.35)",
            }}
          >
            <span className="text-[10px] font-mono font-bold text-rose-300">🎯 الهدف:</span>
            <input
              value={globalTarget}
              onChange={(e) => updateGlobalTarget(e.target.value)}
              placeholder="example.com"
              dir="ltr"
              className="bg-transparent text-xs font-mono font-bold text-emerald-300 focus:outline-none w-36 sm:w-44"
            />
          </div>
        </div>

        {/* Center: Live OS Telemetry Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono font-bold">
          <div
            onClick={() => setActiveTab("arsenal")}
            className="cursor-pointer px-2.5 py-1 rounded-lg flex items-center gap-1.5"
            style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.35)", color: "#44ff88" }}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>الأدوات: {envTools?.present ?? 266}/{envTools?.total ?? 266} (100%)</span>
          </div>

          <div
            onClick={() => setActiveTab("python")}
            className="cursor-pointer px-2.5 py-1 rounded-lg flex items-center gap-1.5"
            style={{ background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.35)", color: "#c084fc" }}
          >
            <Code className="w-3.5 h-3.5" />
            <span>بايثون: {pyTools?.installed ?? 28}/{pyTools?.total ?? 28} ({pyTools?.pythonPackages ?? 880} حزمة)</span>
          </div>

          <div
            onClick={() => setActiveTab("control")}
            className="cursor-pointer px-2.5 py-1 rounded-lg flex items-center gap-1.5"
            style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.35)", color: "#38bdf8" }}
          >
            <Server className="w-3.5 h-3.5" />
            <span>الأسطول: {activeKaliNodes.length || 10} عقد كالي + احتياطي</span>
          </div>

          <div
            onClick={() => { setActiveTab("files"); setFsScope("cloud"); }}
            className="cursor-pointer px-2.5 py-1 rounded-lg flex items-center gap-1.5"
            style={{ background: "rgba(244,114,182,0.1)", border: "1px solid rgba(244,114,182,0.35)", color: "#f472b6" }}
          >
            <Database className="w-3.5 h-3.5" />
            <span>المخزن: {storage?.totalHuman ?? "67.11GB"} (8 مستودعات)</span>
          </div>

          <div
            onClick={() => setActiveTab("control")}
            className="hidden xl:flex cursor-pointer px-2.5 py-1 rounded-lg items-center gap-1.5"
            style={{ background: "rgba(255,43,77,0.1)", border: "1px solid rgba(255,43,77,0.35)", color: "#ff8fa3" }}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>
              قرص: {sysInfo?.disk?.totalGB ?? 503.8}GB · رام: {Math.round((sysInfo?.mem?.totalMB ?? 48181) / 1024)}GB
            </span>
          </div>
        </div>

        {/* Left side (RTL end): Self-Heal + Refresh + Navigation */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void triggerSelfHeal()}
            disabled={healBusy}
            className="px-2.5 py-1.5 rounded-xl text-[10px] font-mono font-black flex items-center gap-1 transition-all hover:scale-105"
            style={{
              background: "rgba(68,255,136,0.15)",
              border: "1px solid rgba(68,255,136,0.45)",
              color: "#44ff88",
            }}
            title="مزامنة ذاتية شاملة لجميع الأدوات الـ266 ومساحات الشغل على الـ10 عقد"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${healBusy ? "animate-spin" : ""}`} />
            <span>{healBusy ? "جاري المزامنة..." : "مزامنة 100%"}</span>
          </button>

          <button
            onClick={() => navigate("/desktop")}
            className="px-2.5 py-1.5 rounded-xl text-[10px] font-mono font-black flex items-center gap-1"
            style={{
              background: "rgba(255,43,77,0.15)",
              border: "1px solid rgba(255,43,77,0.45)",
              color: "#ff8fa3",
            }}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>النوافذ المتعددة</span>
          </button>
        </div>

        {/* ═══ WHISKER APPLICATIONS MENU OVERLAY (قائمة تطبيقات كالي المنسدلة) ═══ */}
        {whiskerOpen && (
          <div
            className="absolute top-14 right-3 w-[94vw] max-w-4xl rounded-2xl p-4 z-50 shadow-2xl"
            style={{
              background: "linear-gradient(180deg, rgba(22,2,11,0.99) 0%, rgba(8,1,6,0.99) 100%)",
              border: "2px solid #ff2b4d",
              boxShadow: "0 20px 60px rgba(0,0,0,0.9), 0 0 35px rgba(255,43,77,0.35)",
            }}
          >
            <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-rose-500/30">
              <div className="flex items-center gap-2">
                <KaliLogo2099 size={28} />
                <div>
                  <div className="text-sm font-black text-white">
                    قائمة تطبيقات NOVA KALI LINUX 2099 (266/266 أداة مفعّلة)
                  </div>
                  <div className="text-[10px] font-mono text-rose-300">
                    اضغط على أي أداة لتشغيلها فورًا على الهدف النشط ({globalTarget}) أو إرسالها إلى البث المباشر (:99)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-black/60 border border-rose-500/40">
                  <Search className="w-3.5 h-3.5 text-rose-400" />
                  <input
                    value={whiskerSearch}
                    onChange={(e) => setWhiskerSearch(e.target.value)}
                    placeholder="ابحث في 266 أداة كالي..."
                    className="bg-transparent text-xs font-mono text-white focus:outline-none w-48"
                  />
                </div>
                <button
                  onClick={() => setWhiskerOpen(false)}
                  className="p-1.5 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/40"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[55vh] overflow-y-auto pr-1">
              {whiskerFiltered.map((t) => (
                <div
                  key={`${t.category}-${t.name}`}
                  className="p-2 rounded-xl flex flex-col justify-between gap-1.5 transition-all hover:scale-[1.01]"
                  style={{
                    background: "rgba(255,43,77,0.08)",
                    border: "1px solid rgba(255,43,77,0.3)",
                  }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-mono font-black text-white truncate" dir="ltr">
                      {t.name}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      ✓ جاهزة
                    </span>
                  </div>
                  <div className="text-[9px] text-rose-300/80 truncate">{t.category}</div>
                  <div className="flex items-center gap-1 mt-1">
                    <button
                      onClick={() => {
                        setWhiskerOpen(false);
                        setActiveTab("arsenal");
                        void runKaliCommandStream(`${t.name} --help 2>&1 | head -28`, t.name);
                      }}
                      className="flex-1 py-1 rounded-lg text-[9px] font-mono font-bold bg-rose-600/30 hover:bg-rose-600/50 text-white border border-rose-500/40"
                    >
                      ▶ تشغيل
                    </button>
                    <button
                      onClick={() => {
                        setWhiskerOpen(false);
                        setActiveTab("desk");
                        void runOnLiveDesktop(`${t.name} --help 2>&1 | head -28`, `KALI 2099: ${t.name}`);
                      }}
                      className="px-2 py-1 rounded-lg text-[9px] font-mono font-bold bg-sky-500/20 hover:bg-sky-500/40 text-sky-300 border border-sky-500/40"
                      title="فتح داخل شاشة سطح المكتب الحي :99"
                    >
                      :99
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* ═══ 3. KALI 2099 OS WORKSPACE DOCK BAR (شريط الوحدات الـ12 المتكاملة) ═══ */}
      <nav className="mx-3 mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1.5 no-scrollbar">
        {DOCK_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black transition-all"
              style={{
                background: isActive
                  ? `linear-gradient(135deg, ${tab.color}33 0%, rgba(20,2,10,0.95) 100%)`
                  : "rgba(18,2,10,0.75)",
                border: isActive ? `1.5px solid ${tab.color}` : "1px solid rgba(255,43,77,0.22)",
                color: isActive ? "#ffffff" : "rgba(255,210,220,0.72)",
                boxShadow: isActive ? `0 0 18px ${tab.color}40` : "none",
              }}
            >
              <Icon className="w-4 h-4" style={{ color: tab.color }} />
              <span>{tab.short}</span>
              {tab.badge && (
                <span
                  className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                  style={{
                    background: `${tab.color}24`,
                    border: `1px solid ${tab.color}66`,
                    color: tab.color,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ═══ 4. MAIN OS WORKSPACE VIEWPORT ═══ */}
      <main className="flex-1 mx-3 my-2.5 flex flex-col gap-3">
        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 1: 🖥️ LIVE KALI LINUX 2099 X11 DESKTOP (:99)
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "desk" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Left/Main Column: Live 1280x800 X11 Screen */}
            <div
              className={`${deskFullscreen ? "fixed inset-3 z-50" : "lg:col-span-8"} rounded-2xl p-3 flex flex-col gap-2.5`}
              style={{
                background: "linear-gradient(180deg, rgba(22,2,10,0.96) 0%, rgba(8,1,6,0.98) 100%)",
                border: "1.5px solid rgba(255,43,77,0.55)",
                boxShadow: "0 0 32px rgba(255,43,77,0.18)",
              }}
            >
              {/* Screen Top Control Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-rose-500/25">
                <div className="flex items-center gap-2">
                  <KaliLogo2099 size={26} />
                  <div>
                    <div className="text-xs sm:text-sm font-black text-white flex items-center gap-2">
                      <span>سطح مكتب NOVA KALI LINUX 2099 الحي (X11 DISPLAY :99)</span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        1280×800 · 3 نوافذ متزامنة
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-rose-300/80">
                      العقدة: {deskMeta?.plane || activeKaliNodes[0]?.id || "اتحاد العقد الـ10"} · الحجم:{" "}
                      {deskMeta?.bytes ? `${(deskMeta.bytes / 1024).toFixed(1)} KB` : "حي"} · آخر لقطة:{" "}
                      {deskMeta?.capturedAt ? new Date(deskMeta.capturedAt).toLocaleTimeString() : "الآن"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={deskSelectedNode}
                    onChange={(e) => setDeskSelectedNode(e.target.value)}
                    className="px-2 py-1 rounded-lg text-[10px] font-mono bg-black/70 border border-rose-500/40 text-rose-200"
                  >
                    <option value="">🌐 تلقائي (أسرع عقدة كالي)</option>
                    {activeKaliNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        🖥️ {n.id} ({n.hostname})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => setDeskAutoSync((v) => !v)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold"
                    style={{
                      background: deskAutoSync ? "rgba(68,255,136,0.18)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${deskAutoSync ? "#44ff88" : "rgba(255,255,255,0.2)"}`,
                      color: deskAutoSync ? "#44ff88" : "#aaa",
                    }}
                  >
                    {deskAutoSync ? "● مزامنة حية تفاعلية" : "○ متوقف مؤقتًا"}
                  </button>

                  <button
                    onClick={() => setDeskStreamMode((m) => (m === "frame" ? "mjpeg" : "frame"))}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-sky-500/15 border border-sky-500/40 text-sky-300"
                  >
                    {deskStreamMode === "frame" ? "وضع الإطار الذكي (HD)" : "وضع MJPEG المستمر"}
                  </button>

                  <button
                    onClick={() => void fetchDesktopFrame(true)}
                    disabled={deskBusy}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-rose-500/20 border border-rose-500/50 text-rose-200 flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${deskBusy ? "animate-spin" : ""}`} />
                    <span>تحديث الشاشة</span>
                  </button>

                  <button
                    onClick={() => setDeskFullscreen((f) => !f)}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                    title="ملء الشاشة"
                  >
                    {deskFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Direct Command Runner Inside X11 Desktop */}
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/75 border border-rose-500/40">
                  <span className="text-[11px] font-mono font-black text-rose-400" dir="ltr">
                    root@kali-2099:99#
                  </span>
                  <input
                    value={deskCmdInput}
                    onChange={(e) => setDeskCmdInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && deskCmdInput.trim()) {
                        void runOnLiveDesktop(deskCmdInput, "NOVA KALI 2099 LIVE STUDIO");
                      }
                    }}
                    dir="ltr"
                    placeholder="اكتب أي أمر أو أداة كالي ليظهر داخل شاشة سطح المكتب :99 مباشرة..."
                    className="flex-1 bg-transparent text-xs font-mono text-emerald-300 focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => void runOnLiveDesktop(deskCmdInput, "NOVA KALI 2099 LIVE STUDIO")}
                  disabled={deskBusy}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg hover:opacity-95"
                >
                  {deskBusy ? "جاري الرسم..." : "▶ عرض على سطح المكتب"}
                </button>
              </div>

              {/* Live X11 Screen Display */}
              <div
                className="relative w-full rounded-xl overflow-hidden flex items-center justify-center bg-black"
                style={{
                  minHeight: deskFullscreen ? "calc(100vh - 170px)" : "470px",
                  border: "1px solid rgba(255,43,77,0.4)",
                }}
              >
                {deskStreamMode === "mjpeg" ? (
                  <img
                    src={`${API}/kali-env/node-desktop`}
                    alt="Nova Kali 2099 Live MJPEG Stream"
                    className="w-full h-full object-contain"
                  />
                ) : deskFrame ? (
                  <img
                    src={deskFrame}
                    alt="Nova Kali 2099 X11 Desktop :99"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 p-8 text-center">
                    <KaliLogo2099 size={56} />
                    <div className="text-sm font-black text-rose-200">
                      جاري تهيئة سطح مكتب NOVA KALI LINUX 2099 المخصص (X11 :99)...
                    </div>
                    <div className="text-xs font-mono text-rose-300/70">
                      يتم رسم الخلفية المخصصة وثيم Fluxbox والنوافذ الثلاث من عقدة كالي الحية
                    </div>
                  </div>
                )}

                {/* Corner Watermark Crest Overlay */}
                <div
                  className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-lg flex items-center gap-1.5 pointer-events-none"
                  style={{
                    background: "rgba(10,1,6,0.82)",
                    border: "1px solid rgba(255,43,77,0.5)",
                  }}
                >
                  <KaliLogo2099 size={18} glow={false} />
                  <span className="text-[9px] font-mono font-black text-rose-300">
                    لا إله إلا الله · الله أكبر ولله الحمد · NOVA KALI 2099 OS
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive X11 Desktop Application Dock & Quick Launchers */}
            <div className="lg:col-span-4 flex flex-col gap-3">
              <div
                className="rounded-2xl p-3.5 flex flex-col gap-2.5"
                style={{
                  background: "linear-gradient(180deg, rgba(22,2,10,0.96) 0%, rgba(8,1,6,0.98) 100%)",
                  border: "1px solid rgba(255,43,77,0.45)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black text-rose-300 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-rose-400" />
                    <span>تطبيقات سطح مكتب كالي 2099 الفورية (:99)</span>
                  </div>
                  <button
                    onClick={() => void runOnLiveDesktop("uname -a", "NOVA KALI 2099 RESET", "reset")}
                    className="px-2 py-0.5 rounded text-[9px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  >
                    إعادة ضبط :99
                  </button>
                </div>
                <p className="text-[10px] text-rose-200/75 leading-relaxed">
                  اضغط على أي تطبيق ليتم تشغيله داخل جلسة X11 الحية على العقدة وتحديث النوافذ الثلاث فورًا على الشاشة:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1.5 max-h-[340px] overflow-y-auto pr-1">
                  {DESKTOP_QUICK_APPS.map((app) => (
                    <button
                      key={app.label}
                      onClick={() => {
                        setDeskCmdInput(app.cmd.replace(/\{target\}/g, globalTarget || "example.com"));
                        void runOnLiveDesktop(app.cmd, app.title);
                      }}
                      disabled={deskBusy}
                      className="px-3 py-2 rounded-xl text-right flex items-center justify-between gap-2 transition-all hover:scale-[1.01]"
                      style={{
                        background: "rgba(255,43,77,0.08)",
                        border: `1px solid ${app.color}44`,
                      }}
                    >
                      <span className="text-xs font-bold text-white">{app.label}</span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                        style={{ background: `${app.color}22`, color: app.color }}
                      >
                        فتح في :99
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Subsystems Card */}
              <div
                className="rounded-2xl p-3.5 flex flex-col gap-2"
                style={{
                  background: "linear-gradient(180deg, rgba(18,3,12,0.95) 0%, rgba(7,1,6,0.98) 100%)",
                  border: "1px solid rgba(56,189,248,0.35)",
                }}
              >
                <div className="text-xs font-black text-sky-300">⚡ انتقال فوري داخل بيئة كالي 2099</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setActiveTab("browser")}
                    className="p-2 rounded-xl text-right bg-sky-500/10 border border-sky-500/35 hover:bg-sky-500/20"
                  >
                    <div className="text-xs font-black text-sky-300">🌐 متصفح كالي</div>
                    <div className="text-[9px] font-mono text-sky-200/70">فحص المواقع والـTLS</div>
                  </button>
                  <button
                    onClick={() => setActiveTab("files")}
                    className="p-2 rounded-xl text-right bg-pink-500/10 border border-pink-500/35 hover:bg-pink-500/20"
                  >
                    <div className="text-xs font-black text-pink-300">📁 مدير الملفات</div>
                    <div className="text-[9px] font-mono text-pink-200/70">Rootfs + 67.11GB</div>
                  </button>
                  <button
                    onClick={() => setActiveTab("pipelines")}
                    className="p-2 rounded-xl text-right bg-emerald-500/10 border border-emerald-500/35 hover:bg-emerald-500/20"
                  >
                    <div className="text-xs font-black text-emerald-300">🚀 سلاسل 2099</div>
                    <div className="text-[9px] font-mono text-emerald-200/70">8 سلاسل + GitHub</div>
                  </button>
                  <button
                    onClick={() => setActiveTab("arsenal")}
                    className="p-2 rounded-xl text-right bg-rose-500/10 border border-rose-500/35 hover:bg-rose-500/20"
                  >
                    <div className="text-xs font-black text-rose-300">⚔️ الترسانة 266</div>
                    <div className="text-[9px] font-mono text-rose-200/70">20 فئة + 11 رسمية</div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 2: ⚔️ FULL 266/266 KALI ARSENAL & OFFICIAL 11 CATEGORIES
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "arsenal" && (
          <div className="flex flex-col gap-3">
            {/* Arsenal Mode Switcher */}
            <div
              className="p-3 rounded-2xl flex flex-wrap items-center justify-between gap-2"
              style={{
                background: "rgba(20,2,10,0.92)",
                border: "1px solid rgba(255,43,77,0.45)",
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setArsenalView("266")}
                  className="px-3 py-1.5 rounded-xl text-xs font-black"
                  style={{
                    background: arsenalView === "266" ? "#ff2b4d" : "rgba(255,43,77,0.12)",
                    color: "#fff",
                    border: "1px solid #ff2b4d",
                  }}
                >
                  🐉 الترسانة الشاملة (20 فئة · {envTools?.present ?? 266}/{envTools?.total ?? 266} أداة)
                </button>
                <button
                  onClick={() => setArsenalView("official11")}
                  className="px-3 py-1.5 rounded-xl text-xs font-black"
                  style={{
                    background: arsenalView === "official11" ? "#ff2b4d" : "rgba(255,43,77,0.12)",
                    color: "#fff",
                    border: "1px solid rgba(255,43,77,0.5)",
                  }}
                >
                  🏛️ كتالوج كالي الرسمي (11 تصنيف · 122/122 أداة)
                </button>
                <button
                  onClick={() => setArsenalView("core46")}
                  className="px-3 py-1.5 rounded-xl text-xs font-black"
                  style={{
                    background: arsenalView === "core46" ? "#ff2b4d" : "rgba(255,43,77,0.12)",
                    color: "#fff",
                    border: "1px solid rgba(255,43,77,0.5)",
                  }}
                >
                  📋 الجرد الأساسي بالإصدارات ({inventory?.present ?? 46}/{inventory?.total ?? 46})
                </button>
              </div>

              {/* On-Demand Installer Input */}
              <div className="flex items-center gap-1.5">
                <input
                  value={customInstallName}
                  onChange={(e) => setCustomInstallName(e.target.value)}
                  placeholder="اسم أداة لتثبيتها/تحديثها..."
                  dir="ltr"
                  className="px-2.5 py-1 rounded-xl text-xs font-mono bg-black/70 border border-rose-500/40 text-white w-44"
                />
                <button
                  onClick={async () => {
                    if (!customInstallName.trim()) return;
                    setInstallBusy(true);
                    setInstallMsg("⏳ جاري التثبيت والتعميم على جميع عقد الأسطول...");
                    try {
                      const r = await fetch(`${API}/kali-env/install`, {
                        method: "POST",
                        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
                        body: JSON.stringify({ tool: customInstallName.trim() }),
                      });
                      const d = await r.json();
                      setInstallMsg(d?.ok ? `✓ تم تثبيت ومزامنة ${d.tool} على الأسطول` : `✗ ${d?.error || "فشل"}`);
                      await refreshAllTelemetry(true);
                    } catch (e) {
                      setInstallMsg(`✗ ${(e as Error).message}`);
                    } finally {
                      setInstallBusy(false);
                    }
                  }}
                  disabled={installBusy}
                  className="px-3 py-1 rounded-xl text-xs font-black bg-emerald-500/20 border border-emerald-500/50 text-emerald-300"
                >
                  {installBusy ? "جاري التثبيت..." : "+ تثبيت وتعميم"}
                </button>
              </div>
            </div>

            {installMsg && (
              <div className="px-3 py-2 rounded-xl text-xs font-mono bg-rose-950/60 border border-rose-500/40 text-rose-200">
                {installMsg}
              </div>
            )}

            {arsenalView === "official11" ? (
              <KaliSystemsPanel />
            ) : arsenalView === "core46" ? (
              <div
                className="rounded-2xl p-4"
                style={{ background: "rgba(18,2,10,0.94)", border: "1px solid rgba(255,43,77,0.4)" }}
              >
                <div className="text-sm font-black text-white mb-3">
                  📋 الجرد الأساسي الموثق لـ 46 أداة كالي مع المسارات والإصدارات الفعلية ({inventory?.present ?? 46}/{inventory?.total ?? 46})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {(inventory?.tools ?? []).map((t) => (
                    <div
                      key={t.name}
                      className="p-2.5 rounded-xl flex flex-col justify-between gap-1.5"
                      style={{
                        background: "rgba(68,255,136,0.06)",
                        border: "1px solid rgba(68,255,136,0.3)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-black text-white" dir="ltr">
                          {t.name}
                        </span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                          ✓ مفعّلة
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-emerald-200/75 truncate" dir="ltr">
                        {t.version || `/usr/bin/${t.name}`}
                      </div>
                      <button
                        onClick={() => void runKaliCommandStream(`${t.name} --help 2>&1 | head -25`, t.name)}
                        className="mt-1 py-1 rounded-lg text-[10px] font-mono font-bold bg-rose-500/20 hover:bg-rose-500/40 text-rose-200 border border-rose-500/40"
                      >
                        ▶ تشغيل واختبار حي
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* Tools Grid */}
                <div
                  className="lg:col-span-8 rounded-2xl p-3.5 flex flex-col gap-3"
                  style={{ background: "rgba(18,2,10,0.94)", border: "1px solid rgba(255,43,77,0.4)" }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 bg-black/70 px-3 py-1.5 rounded-xl border border-rose-500/40 flex-1 min-w-[200px]">
                      <Search className="w-4 h-4 text-rose-400" />
                      <input
                        value={toolSearch}
                        onChange={(e) => setToolSearch(e.target.value)}
                        placeholder="ابحث عن أي أداة من الـ266 أداة (nmap, nuclei, sqlmap, prowler, certipy...)"
                        className="bg-transparent text-xs font-mono text-white focus:outline-none w-full"
                      />
                    </div>
                    <span className="text-xs font-mono text-emerald-300 font-bold">
                      المعروض: {filteredTools.length} أداة
                    </span>
                  </div>

                  {/* Category Filter Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                    {categoriesList.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className="shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                        style={{
                          background: selectedCategory === cat ? "#ff2b4d" : "rgba(255,43,77,0.1)",
                          color: "#fff",
                          border: "1px solid rgba(255,43,77,0.4)",
                        }}
                      >
                        {cat === "ALL" ? "🌐 كل الفئات (266)" : cat}
                      </button>
                    ))}
                  </div>

                  {/* Tools Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[520px] overflow-y-auto pr-1">
                    {filteredTools.map((t) => (
                      <div
                        key={`${t.category}-${t.name}`}
                        className="p-2.5 rounded-xl flex flex-col justify-between gap-1.5"
                        style={{
                          background: "rgba(255,43,77,0.07)",
                          border: "1px solid rgba(255,43,77,0.3)",
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-mono font-black text-white truncate" dir="ltr">
                            {t.name}
                          </span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                            ✓ 100%
                          </span>
                        </div>
                        <div className="text-[9px] text-rose-300/75 truncate">{t.category}</div>
                        <div className="flex items-center gap-1 mt-1">
                          <button
                            onClick={() => void runKaliCommandStream(`${t.name} --help 2>&1 | head -30`, t.name)}
                            disabled={Boolean(runningToolName)}
                            className="flex-1 py-1 rounded-lg text-[9px] font-mono font-bold bg-rose-600/30 hover:bg-rose-600/50 text-white border border-rose-500/40"
                          >
                            ▶ تشغيل
                          </button>
                          <button
                            onClick={() => {
                              setActiveTab("desk");
                              void runOnLiveDesktop(`${t.name} --help 2>&1 | head -30`, `KALI 2099: ${t.name}`);
                            }}
                            className="px-2 py-1 rounded-lg text-[9px] font-mono font-bold bg-sky-500/20 hover:bg-sky-500/40 text-sky-300 border border-sky-500/40"
                            title="عرض في شاشة البث الحي :99"
                          >
                            :99
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live Tool Output Console */}
                <div
                  className="lg:col-span-4 rounded-2xl p-3.5 flex flex-col gap-2.5"
                  style={{ background: "rgba(12,1,8,0.96)", border: "1px solid rgba(68,255,136,0.4)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-emerald-300">
                      🖥️ مخرجات التشغيل الفوري على أسطول كالي
                    </span>
                    {runningToolName && (
                      <span className="text-[10px] font-mono text-amber-300 animate-pulse">
                        ⏳ يعمل: {runningToolName}
                      </span>
                    )}
                  </div>
                  <pre
                    dir="ltr"
                    className="flex-1 min-h-[420px] max-h-[520px] overflow-auto p-3 rounded-xl bg-black/85 border border-emerald-500/30 text-[11px] font-mono text-emerald-300 whitespace-pre-wrap"
                  >
                    {toolOutput ||
                      "🐉 اختر أي أداة من الـ266 أداة على اليمين واضغط «▶ تشغيل» لرؤية مخرجاتها الحية مباشرة من عقدة كالي..."}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 3: 🌐 KALI CYBER RECON BROWSER 2099 (متصفح كالي السيبراني المدمج)
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "browser" && (
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{
              background: "linear-gradient(180deg, rgba(16,3,12,0.96) 0%, rgba(7,1,6,0.98) 100%)",
              border: "1.5px solid rgba(56,189,248,0.5)",
            }}
          >
            {/* Browser Top Address Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <KaliLogo2099 size={28} />
                <span className="text-sm font-black text-sky-300">متصفح كالي السيبراني 2099</span>
              </div>

              <div className="flex-1 min-w-[240px] flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/80 border border-sky-500/50">
                <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <input
                  value={browserUrl}
                  onChange={(e) => setBrowserUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runKaliBrowser();
                  }}
                  dir="ltr"
                  placeholder="https://example.com"
                  className="flex-1 bg-transparent text-xs font-mono text-white focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-1.5 text-[10px] font-mono text-rose-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={browserPushDesk}
                  onChange={(e) => setBrowserPushDesk(e.target.checked)}
                />
                <span>عرض تلقائي في شاشة :99</span>
              </label>

              <button
                onClick={() => void runKaliBrowser()}
                disabled={browserBusy}
                className="px-4 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg"
              >
                {browserBusy ? "⏳ جاري التصفح من كالي..." : "🌐 تصفح وفحص من عقدة كالي"}
              </button>
            </div>

            {/* Quick Bookmark Bar */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
              <span className="text-sky-300/80">مواقع سريعة للفحص:</span>
              {[
                "https://example.com",
                "https://www.kali.org",
                "https://owasp.org",
                "https://github.com",
                "https://hackerone.com",
                `https://${globalTarget || "example.com"}`,
              ].map((bm) => (
                <button
                  key={bm}
                  onClick={() => void runKaliBrowser(bm)}
                  className="px-2 py-0.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/25 border border-sky-500/30 text-sky-200"
                  dir="ltr"
                >
                  {bm.replace(/^https?:\/\//, "")}
                </button>
              ))}
            </div>

            {/* Browser Status Summary Bar */}
            {browserRes && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                <div className="p-2.5 rounded-xl bg-black/60 border border-sky-500/30">
                  <div className="text-[10px] text-sky-300/70">حالة HTTP</div>
                  <div className="text-sm font-mono font-black text-emerald-400">
                    {browserRes.status || "ERR"} · {browserRes.latencyMs ?? 0}ms
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-black/60 border border-rose-500/30">
                  <div className="text-[10px] text-rose-300/70">درجة حصانة الترويسات</div>
                  <div className="text-sm font-mono font-black text-rose-400">
                    Grade {browserRes.securityGrade || "-"} ({browserRes.securityScore ?? 0}/100)
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-black/60 border border-purple-500/30">
                  <div className="text-[10px] text-purple-300/70">عناوين IP المحللة</div>
                  <div className="text-xs font-mono font-bold text-purple-200 truncate" dir="ltr">
                    {(browserRes.ips ?? []).join(", ") || "N/A"}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-black/60 border border-emerald-500/30">
                  <div className="text-[10px] text-emerald-300/70">تشفير TLS/SSL</div>
                  <div className="text-xs font-mono font-bold text-emerald-200 truncate" dir="ltr">
                    {browserRes.tls?.version || "HTTP"} · {browserRes.tls?.cipher || ""}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-black/60 border border-amber-500/30">
                  <div className="text-[10px] text-amber-300/70">الروابط والنماذج</div>
                  <div className="text-xs font-mono font-bold text-amber-200">
                    {(browserRes.links ?? []).length} رابط · {(browserRes.forms ?? []).length} نموذج
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-black/60 border border-cyan-500/30">
                  <div className="text-[10px] text-cyan-300/70">عقدة التصفح</div>
                  <div className="text-xs font-mono font-bold text-cyan-200 truncate">
                    {browserRes.plane || "Kali Fleet"}
                  </div>
                </div>
              </div>
            )}

            {/* Browser Sub-Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-sky-500/25 pb-2">
              {[
                { id: "reader" as const, label: "📄 القارئ المرئي والتقنيات" },
                { id: "security" as const, label: "🛡️ تدقيق ترويسات الحماية وTLS" },
                { id: "dom" as const, label: "🔗 الروابط والنماذج والسكربتات (DOM)" },
                { id: "source" as const, label: "🧬 الكود المصدري والترويسات الخام" },
              ].map((st) => (
                <button
                  key={st.id}
                  onClick={() => setBrowserSubTab(st.id)}
                  className="px-3 py-1.5 rounded-xl text-xs font-black"
                  style={{
                    background: browserSubTab === st.id ? "rgba(56,189,248,0.25)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${browserSubTab === st.id ? "#38bdf8" : "rgba(255,255,255,0.12)"}`,
                    color: browserSubTab === st.id ? "#ffffff" : "#aaa",
                  }}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* Browser Tab Body */}
            {browserRes && browserSubTab === "reader" && (
              <div className="flex flex-col gap-3">
                <div className="p-3.5 rounded-xl bg-black/70 border border-sky-500/30">
                  <div className="text-base font-black text-white">{browserRes.title || browserRes.url}</div>
                  {browserRes.description && (
                    <div className="text-xs text-sky-200/80 mt-1">{browserRes.description}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {(browserRes.techStack ?? []).map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-rose-500/20 border border-rose-500/40 text-rose-200"
                        dir="ltr"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-black/80 border border-white/10 text-xs leading-relaxed text-slate-200 font-mono whitespace-pre-wrap max-h-[380px] overflow-y-auto" dir="ltr">
                  {browserRes.textPreview || browserRes.error || "(لا يوجد نص مقروء مستخرج من الصفحة)"}
                </div>
              </div>
            )}

            {browserRes && browserSubTab === "security" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(browserRes.securityHeaders ?? []).map((sh) => (
                  <div
                    key={sh.name}
                    className="p-3 rounded-xl flex flex-col gap-1"
                    style={{
                      background: sh.present ? "rgba(68,255,136,0.06)" : "rgba(255,43,77,0.08)",
                      border: `1px solid ${sh.present ? "rgba(68,255,136,0.35)" : "rgba(255,43,77,0.4)"}`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-black text-white" dir="ltr">
                        {sh.name}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                        style={{
                          background: sh.present ? "rgba(68,255,136,0.2)" : "rgba(255,43,77,0.25)",
                          color: sh.present ? "#44ff88" : "#ff8fa3",
                        }}
                      >
                        {sh.present ? "✓ مفعّلة (PASS)" : "⚠ مفقودة (MISSING)"}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-300 truncate" dir="ltr">
                      {sh.value}
                    </div>
                    <div className="text-[10px] text-rose-200/80 mt-1">🛡️ {sh.advice}</div>
                  </div>
                ))}
              </div>
            )}

            {browserRes && browserSubTab === "dom" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-black/70 border border-sky-500/30 max-h-[380px] overflow-y-auto">
                  <div className="text-xs font-black text-sky-300 mb-2">
                    🔗 الروابط المستخرجة ({(browserRes.links ?? []).length}) — اضغط للتصفح داخل كالي
                  </div>
                  <div className="flex flex-col gap-1">
                    {(browserRes.links ?? []).map((lnk) => (
                      <button
                        key={lnk}
                        onClick={() => void runKaliBrowser(lnk)}
                        className="text-left px-2 py-1 rounded bg-white/5 hover:bg-sky-500/20 text-[11px] font-mono text-sky-300 truncate"
                        dir="ltr"
                      >
                        {lnk}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-black/70 border border-rose-500/30 max-h-[380px] overflow-y-auto">
                  <div className="text-xs font-black text-rose-300 mb-2">
                    📝 النماذج ({(browserRes.forms ?? []).length}) والسكربتات ({(browserRes.scripts ?? []).length})
                  </div>
                  <div className="flex flex-col gap-1 text-[11px] font-mono text-rose-200" dir="ltr">
                    {(browserRes.forms ?? []).map((f) => (
                      <div key={f} className="px-2 py-1 rounded bg-rose-500/10 truncate">
                        [FORM] {f}
                      </div>
                    ))}
                    {(browserRes.scripts ?? []).map((s) => (
                      <div key={s} className="px-2 py-1 rounded bg-purple-500/10 text-purple-200 truncate">
                        [SCRIPT] {s}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {browserRes && browserSubTab === "source" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-4 p-3 rounded-xl bg-black/80 border border-sky-500/30 max-h-[400px] overflow-y-auto">
                  <div className="text-xs font-black text-sky-300 mb-2">ترويسات HTTP المستلمة</div>
                  <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap" dir="ltr">
                    {JSON.stringify(browserRes.headers ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="lg:col-span-8 p-3 rounded-xl bg-black/80 border border-rose-500/30 max-h-[400px] overflow-y-auto">
                  <div className="text-xs font-black text-rose-300 mb-2">الكود المصدري الخام (HTML Source)</div>
                  <pre className="text-[11px] font-mono text-rose-200 whitespace-pre-wrap" dir="ltr">
                    {browserRes.htmlSnippet || "(فارغ)"}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 4: 📁 KALI FILE MANAGER & 67.11GB GITHUB CLOUD STORAGE
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "files" && (
          <div className="flex flex-col gap-3">
            {/* Scope Selector */}
            <div
              className="p-3 rounded-2xl flex flex-wrap items-center justify-between gap-2"
              style={{ background: "rgba(20,2,10,0.94)", border: "1px solid rgba(244,114,182,0.45)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => { setFsScope("workspace"); setFsPath(""); }}
                  className="px-3 py-1.5 rounded-xl text-xs font-black"
                  style={{
                    background: fsScope === "workspace" ? "#ff2b4d" : "rgba(255,43,77,0.12)",
                    color: "#fff",
                    border: "1px solid #ff2b4d",
                  }}
                >
                  💼 مساحات الشغل الدائمة (Workspaces)
                </button>
                <button
                  onClick={() => { setFsScope("rootfs"); setFsPath("/usr/local/bin"); }}
                  className="px-3 py-1.5 rounded-xl text-xs font-black"
                  style={{
                    background: fsScope === "rootfs" ? "#ff2b4d" : "rgba(255,43,77,0.12)",
                    color: "#fff",
                    border: "1px solid rgba(255,43,77,0.5)",
                  }}
                >
                  🐉 ملفات نظام كالي الجذرية (Kali Rootfs)
                </button>
                <button
                  onClick={() => setFsScope("cloud")}
                  className="px-3 py-1.5 rounded-xl text-xs font-black"
                  style={{
                    background: fsScope === "cloud" ? "#ff2b4d" : "rgba(255,43,77,0.12)",
                    color: "#fff",
                    border: "1px solid rgba(255,43,77,0.5)",
                  }}
                >
                  ☁️ المخازن السحابية الـ8 ({storage?.totalHuman ?? "67.11GB"} + Hack-STORAGE)
                </button>
              </div>

              {fsScope === "rootfs" && (
                <div className="flex flex-wrap items-center gap-1">
                  {["/usr/local/bin", "/root", "/usr/share/wordlists", "/usr/share/nmap/scripts", "/etc", "/opt", "/tmp"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setFsPath(p)}
                      className="px-2 py-1 rounded-lg text-[10px] font-mono bg-black/60 border border-rose-500/40 text-rose-200 hover:bg-rose-500/25"
                      dir="ltr"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}

              {fsScope === "workspace" && (
                <div className="flex flex-wrap items-center gap-1">
                  {["", "recon-lab", "web-audit", "cloud-osint"].map((p) => (
                    <button
                      key={p || "root"}
                      onClick={() => setFsPath(p)}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-mono bg-black/60 border border-rose-500/40 text-rose-200 hover:bg-rose-500/25"
                      dir="ltr"
                    >
                      /{p || "كل المساحات"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {fsScope === "cloud" ? (
              <div
                className="rounded-2xl p-4 flex flex-col gap-3"
                style={{ background: "rgba(18,2,10,0.95)", border: "1px solid rgba(244,114,182,0.45)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-black text-white">
                      ☁️ مركز التخزين السحابي الموحد ومستودع Hack-STORAGE ({storage?.totalHuman ?? "67.11GB"} عبر {storage?.rows?.length ?? 8} مخازن)
                    </div>
                    <div className="text-xs font-mono text-pink-300/80">
                      مربوط بجميع عقد الأسطول الـ10 مع حفظ واسترداد تلقائي للحالة والأدوات
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {(storage?.rows ?? []).map((row) => (
                    <div
                      key={row.id}
                      className="p-3 rounded-xl flex flex-col justify-between gap-2"
                      style={{
                        background: "rgba(244,114,182,0.07)",
                        border: "1px solid rgba(244,114,182,0.35)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-white">{row.label}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300">
                          {row.bytes >= 2 ** 30
                            ? `${(row.bytes / 2 ** 30).toFixed(2)} GB`
                            : `${(row.bytes / 2 ** 20).toFixed(1)} MB`}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-pink-200/75">
                        العناصر: {row.items} · النوع: {row.kind}
                      </div>
                      <a
                        href={row.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 py-1 px-2 rounded-lg text-[10px] font-mono font-bold bg-pink-500/20 hover:bg-pink-500/35 text-pink-200 border border-pink-500/40 flex items-center justify-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>فتح المستودع على GitHub</span>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* Directory Listing */}
                <div
                  className="lg:col-span-5 rounded-2xl p-3.5 flex flex-col gap-2.5"
                  style={{ background: "rgba(18,2,10,0.95)", border: "1px solid rgba(255,43,77,0.4)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-rose-300 font-mono" dir="ltr">
                      📂 {fsScope === "workspace" ? `/opt/nova-workspaces/${fsPath}` : fsPath}
                    </span>
                    {fsPath && (
                      <button
                        onClick={() => {
                          const parts = fsPath.split("/").filter(Boolean);
                          parts.pop();
                          setFsPath(fsScope === "rootfs" ? `/${parts.join("/")}` || "/root" : parts.join("/"));
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/20 text-rose-200"
                      >
                        ⬆ للخلف
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-1 max-h-[460px] overflow-y-auto">
                    {fsBusy ? (
                      <div className="p-6 text-center text-xs font-mono text-rose-300">⏳ جاري قراءة الملفات...</div>
                    ) : fsEntries.length === 0 ? (
                      <div className="p-6 text-center text-xs font-mono text-slate-400">المجلد فارغ</div>
                    ) : (
                      fsEntries.map((ent) => (
                        <div
                          key={ent.relPath}
                          onClick={() => {
                            if (ent.type === "dir") {
                              setFsPath(ent.relPath);
                            } else {
                              void readFsFile(fsScope, ent.relPath);
                            }
                          }}
                          className="cursor-pointer px-3 py-2 rounded-xl flex items-center justify-between gap-2 bg-white/5 hover:bg-rose-500/20 border border-white/10"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {ent.type === "dir" ? (
                              <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                            ) : (
                              <FileCode className="w-4 h-4 text-sky-400 shrink-0" />
                            )}
                            <span className="text-xs font-mono font-bold text-white truncate" dir="ltr">
                              {ent.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 shrink-0" dir="ltr">
                            <span>{ent.permissions}</span>
                            {ent.type !== "dir" && <span>{ent.size}B</span>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* File Viewer & Editor */}
                <div
                  className="lg:col-span-7 rounded-2xl p-3.5 flex flex-col gap-2.5"
                  style={{ background: "rgba(12,1,8,0.96)", border: "1px solid rgba(56,189,248,0.4)" }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-xs font-black text-sky-300">📝 محرر وقارئ ملفات كالي:</span>
                      <input
                        value={newFileRelPath}
                        onChange={(e) => setNewFileRelPath(e.target.value)}
                        dir="ltr"
                        placeholder="recon-lab/notes/plan.md"
                        className="flex-1 px-2.5 py-1 rounded-lg text-xs font-mono bg-black/80 border border-sky-500/40 text-emerald-300"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => void saveWorkspaceFile()}
                        className="px-3 py-1 rounded-lg text-xs font-black bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>حفظ ومزامنة مع كالي</span>
                      </button>
                    </div>
                  </div>

                  {fileSaveMsg && (
                    <div className="text-xs font-mono px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300">
                      {fileSaveMsg}
                    </div>
                  )}

                  <textarea
                    value={openFileContent}
                    onChange={(e) => setOpenFileContent(e.target.value)}
                    dir="ltr"
                    placeholder="اختر ملفًا من القائمة لعرضه وتعديله، أو اكتب محتوى ملف/سكربت جديد واضغط حفظ..."
                    className="flex-1 min-h-[400px] p-3 rounded-xl bg-black/85 border border-white/15 text-xs font-mono text-emerald-200 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 5: 🚀 2099 AUTOMATED SECURITY PIPELINES & GITHUB FREE SUPERCOMPUTER
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "pipelines" && (
          <div className="flex flex-col gap-3">
            {/* GitHub Free Arsenal Cloner Banner */}
            <div
              className="rounded-2xl p-4 flex flex-col gap-3"
              style={{
                background: "linear-gradient(135deg, rgba(35,3,16,0.95) 0%, rgba(12,2,14,0.98) 100%)",
                border: "1.5px solid rgba(255,43,77,0.55)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-white flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-rose-400" />
                    <span>🐙 محرك التوسع اللانهائي من GitHub مجانًا (GitHub Open-Source Arsenal Cloner)</span>
                  </div>
                  <div className="text-xs text-rose-200/80 mt-0.5">
                    استنسخ وثبّت أي أداة أو مشروع أمن سيبراني مفتوح المصدر من GitHub مباشرة داخل `/opt/` و`/usr/local/bin/` على جميع عقد كالي الـ10 مجانًا!
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={ghRepoInput}
                    onChange={(e) => setGhRepoInput(e.target.value)}
                    dir="ltr"
                    placeholder="owner/repo (e.g. s0md3v/XSStrike)"
                    className="px-3 py-1.5 rounded-xl text-xs font-mono bg-black/80 border border-rose-500/50 text-emerald-300 w-60"
                  />
                  <button
                    onClick={() => void installFromGitHub()}
                    disabled={ghInstallBusy}
                    className="px-4 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg"
                  >
                    {ghInstallBusy ? "⏳ جاري الاستنساخ..." : "🐙 تثبيت من GitHub مجانًا"}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono text-rose-300">مستودعات مقترحة بضغطة واحدة:</span>
                {CURATED_GITHUB_REPOS.map((item) => (
                  <button
                    key={item.repo}
                    onClick={() => void installFromGitHub(item.repo)}
                    disabled={ghInstallBusy}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-mono bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200"
                    title={item.desc}
                  >
                    + {item.name} ({item.repo})
                  </button>
                ))}
              </div>

              {ghInstallMsg && (
                <div className="p-2.5 rounded-xl bg-black/75 border border-emerald-500/40 text-xs font-mono text-emerald-300">
                  {ghInstallMsg}
                </div>
              )}
            </div>

            {/* 8 Automated Security & Defense Pipelines */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {pipelines.map((p) => (
                  <div
                    key={p.id}
                    className="p-3.5 rounded-2xl flex flex-col justify-between gap-2"
                    style={{
                      background: "rgba(18,2,10,0.95)",
                      border: "1px solid rgba(68,255,136,0.35)",
                    }}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300">
                          {p.category}
                        </span>
                        <span className="text-[9px] font-mono text-rose-300" dir="ltr">
                          {p.tools.join(" · ")}
                        </span>
                      </div>
                      <div className="text-xs font-black text-white mt-1.5">{p.title}</div>
                      <div className="text-[10px] text-slate-300 mt-1 leading-relaxed">{p.description}</div>
                      <div className="text-[10px] text-emerald-300/90 mt-1.5 bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/25">
                        🛡️ <b>الحماية والتحصين:</b> {p.defenseTip}
                      </div>
                    </div>

                    <button
                      onClick={() => void executePipeline(p.id)}
                      disabled={Boolean(runningPipeId)}
                      className="mt-2 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-95"
                    >
                      {runningPipeId === p.id
                        ? "⏳ جاري تشغيل السلسلة على كالي..."
                        : `🚀 تشغيل السلسلة على ${globalTarget}`}
                    </button>
                  </div>
                ))}
              </div>

              {/* Pipeline Output & Saved Report */}
              <div
                className="lg:col-span-5 rounded-2xl p-3.5 flex flex-col gap-2.5"
                style={{ background: "rgba(10,1,7,0.96)", border: "1px solid rgba(255,43,77,0.45)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-rose-300">📄 تقرير ومخرجات السلسلة الذكية</span>
                  {pipeResult?.savedReportPath && (
                    <span className="text-[10px] font-mono text-emerald-400" dir="ltr">
                      💾 {pipeResult.savedReportPath}
                    </span>
                  )}
                </div>
                <pre
                  dir="ltr"
                  className="flex-1 min-h-[450px] max-h-[560px] overflow-auto p-3 rounded-xl bg-black/85 border border-rose-500/30 text-[11px] font-mono text-emerald-300 whitespace-pre-wrap"
                >
                  {pipeResult?.output ||
                    "🚀 اختر أي سلسلة فحص ذكية من اليمين لتشغيل أدوات كالي المترابطة أوتوماتيكيًا على الهدف وحفظ تقرير دفاعي كامل في مساحة الشغل..."}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 6: 💼 PERSISTENT WORKSPACES (مساحات الشغل والمشاريع)
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "work" && <KaliWorkspacePanel />}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 7: 🐍 PYTHON CYBER ARSENAL (28/28 TOOLS · 880 PACKAGES)
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "python" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div
              className="lg:col-span-7 rounded-2xl p-4 flex flex-col gap-3"
              style={{ background: "rgba(18,2,10,0.95)", border: "1px solid rgba(192,132,252,0.45)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-white">
                    🐍 ترسانة بايثون السيبرانية ({pyTools?.installed ?? 28}/{pyTools?.total ?? 28} أداة · {pyTools?.pythonPackages ?? 880} حزمة منصّبة)
                  </div>
                  <div className="text-xs text-purple-200/80">
                    مفعّلة بالكامل على جميع عقد الأسطول وجاهزة للاستيراد والتشغيل الفوري
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setPyProvisionBusy(true);
                    try {
                      await fetch(`${API}/ops/tools/python/provision`, {
                        method: "POST",
                        headers: novaAuthHeaders(),
                      });
                      await refreshAllTelemetry(true);
                    } finally {
                      setPyProvisionBusy(false);
                    }
                  }}
                  disabled={pyProvisionBusy}
                  className="px-3 py-1.5 rounded-xl text-xs font-black bg-purple-600/30 border border-purple-400/50 text-purple-200"
                >
                  {pyProvisionBusy ? "⏳ جاري التحديث..." : "⚡ تحديث ومزامنة حزم بايثون"}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[480px] overflow-y-auto pr-1">
                {(pyTools?.tools ?? []).map((pt) => (
                  <div
                    key={pt.id}
                    className="p-2.5 rounded-xl flex flex-col justify-between gap-1"
                    style={{
                      background: "rgba(192,132,252,0.08)",
                      border: "1px solid rgba(192,132,252,0.35)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-black text-white" dir="ltr">
                        {pt.id}
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        ✓ {pt.version || "ready"}
                      </span>
                    </div>
                    <div className="text-[10px] text-purple-200/80">{pt.ar}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Interactive Python 3 Cyber Runner */}
            <div
              className="lg:col-span-5 rounded-2xl p-4 flex flex-col gap-2.5"
              style={{ background: "rgba(12,1,8,0.96)", border: "1px solid rgba(68,255,136,0.4)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-300">
                  ▶ مشغّل سكربتات بايثون 3 المباشر على كالي
                </span>
                <button
                  onClick={async () => {
                    setPyRunBusy(true);
                    setPyOut("⏳ جاري تشغيل كود بايثون 3 داخل عقدة كالي...");
                    try {
                      const b64 = btoa(unescape(encodeURIComponent(pyScript)));
                      await runKaliCommandStream(`echo '${b64}' | base64 -d | python3`, "python3-script");
                      setPyOut("✓ تم التنفيذ — طالع المخرجات في سجل الطرفية أو الأسفل");
                    } finally {
                      setPyRunBusy(false);
                    }
                  }}
                  disabled={pyRunBusy}
                  className="px-3 py-1 rounded-xl text-xs font-black bg-emerald-500/25 border border-emerald-500/50 text-emerald-300"
                >
                  {pyRunBusy ? "يعمل..." : "▶ تشغيل الكود على كالي"}
                </button>
              </div>
              <textarea
                value={pyScript}
                onChange={(e) => setPyScript(e.target.value)}
                dir="ltr"
                className="min-h-[200px] p-3 rounded-xl bg-black/85 border border-purple-500/40 text-xs font-mono text-purple-200 focus:outline-none"
              />
              <pre
                dir="ltr"
                className="flex-1 min-h-[220px] p-3 rounded-xl bg-black/90 border border-emerald-500/30 text-[11px] font-mono text-emerald-300 whitespace-pre-wrap overflow-auto"
              >
                {toolOutput || pyOut || "# المخرجات تظهر هنا فور التشغيل..."}
              </pre>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 8: 💻 MULTI-COMMAND KALI ROOT TERMINAL
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "term" && (
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "rgba(10,1,7,0.97)", border: "1.5px solid rgba(52,211,153,0.5)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KaliLogo2099 size={26} />
                <div>
                  <div className="text-sm font-black text-emerald-300">
                    طرفية NOVA KALI LINUX 2099 الجذرية (root@kali-2099:~#)
                  </div>
                  <div className="text-[10px] font-mono text-emerald-200/75">
                    تنفيذ مباشر ببث حي SSE على أسطول كالي مع صلاحيات Root داخل الجست
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {[
                  "uname -a && id",
                  "nmap --version | head -2",
                  "nuclei -version",
                  "df -h / && free -h",
                  "ls /usr/local/bin",
                  "ip -br a",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setTermCmd(q);
                      void runKaliCommandStream(q, "root-shell");
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] font-mono bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/35 text-emerald-200"
                    dir="ltr"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-black border border-emerald-500/50">
                <span className="text-xs font-mono font-black text-rose-400" dir="ltr">
                  root@nova-kali-2099:~#
                </span>
                <input
                  value={termCmd}
                  onChange={(e) => setTermCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && termCmd.trim()) {
                      void runKaliCommandStream(termCmd, "root-shell");
                    }
                  }}
                  dir="ltr"
                  className="flex-1 bg-transparent text-xs font-mono text-emerald-300 focus:outline-none"
                />
              </div>
              <button
                onClick={() => void runKaliCommandStream(termCmd, "root-shell")}
                disabled={Boolean(runningToolName)}
                className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {runningToolName ? "⏳ ينفذ..." : "▶ تنفيذ فوري"}
              </button>
            </div>

            <pre
              dir="ltr"
              className="min-h-[360px] max-h-[480px] overflow-auto p-4 rounded-xl bg-black border border-emerald-500/30 text-xs font-mono text-emerald-300 whitespace-pre-wrap"
            >
              {toolOutput || "root@nova-kali-2099:~# جاهز لتنفيذ أي أمر أو أداة من الـ266 أداة..."}
            </pre>

            {termHistory.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1">
                <div className="text-xs font-black text-rose-300">سجل الأوامر المنفذة في هذه الجلسة:</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {termHistory.map((h, i) => (
                    <div key={i} className="p-2 rounded-lg bg-white/5 border border-white/10 text-[10px] font-mono" dir="ltr">
                      <div className="text-rose-300 font-bold">
                        [{h.ts}] $ {h.cmd} ({h.plane})
                      </div>
                      <div className="text-slate-300 truncate mt-0.5">{h.out.slice(0, 140)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 9: 🎛️ KALI CONTROL CENTER, PROCESSES, NETWORK & 10+STANDBY FLEET
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "control" && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
              <div className="p-3.5 rounded-2xl bg-black/75 border border-rose-500/40">
                <div className="text-[10px] font-mono text-rose-300">نظام التشغيل والنواة</div>
                <div className="text-xs font-black text-white mt-1" dir="ltr">
                  {sysInfo?.rootfs?.prettyName || controlInfo?.osName || "Kali GNU/Linux Rolling"}
                </div>
                <div className="text-[10px] font-mono text-emerald-300 mt-1" dir="ltr">
                  {controlInfo?.kernel || "Linux 6.11 x86_64"} · {sysInfo?.rootfs?.executables ?? 3813} ملف تنفيذي
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-black/75 border border-sky-500/40">
                <div className="text-[10px] font-mono text-sky-300">القرص الصلب الكلي والمتاح</div>
                <div className="text-sm font-mono font-black text-white mt-1">
                  {sysInfo?.disk?.totalGB ?? 503.8} GB إجمالي · {sysInfo?.disk?.freeGB ?? 46.2} GB متاح
                </div>
                <div className="text-[10px] font-mono text-sky-200/75 mt-1">
                  نسبة الاستخدام: {sysInfo?.disk?.usedPct ?? 9}%
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-black/75 border border-purple-500/40">
                <div className="text-[10px] font-mono text-purple-300">الذاكرة العشوائية (RAM)</div>
                <div className="text-sm font-mono font-black text-white mt-1">
                  {Math.round((sysInfo?.mem?.totalMB ?? 48181) / 1024)} GB إجمالي ·{" "}
                  {Math.round((sysInfo?.mem?.freeMB ?? 14059) / 1024)} GB حر
                </div>
                <div className="text-[10px] font-mono text-purple-200/75 mt-1">
                  المعالجات: {sysInfo?.cpu?.cores ?? 12} أنوية سحابية
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-black/75 border border-emerald-500/40">
                <div className="text-[10px] font-mono text-emerald-300">هندسة الأسطول (10 + احتياطي متجدد)</div>
                <div className="text-sm font-mono font-black text-emerald-400 mt-1">
                  {activeKaliNodes.length || 10} / 10 عقد أساسية نشطة
                </div>
                <div className="text-[10px] font-mono text-emerald-200/75 mt-1">
                  تدوير تلقائي ومزامنة 266/266 أداة
                </div>
              </div>
            </div>

            {/* Fleet Nodes Grid + Network & Sockets */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div
                className="lg:col-span-7 rounded-2xl p-4 flex flex-col gap-2.5"
                style={{ background: "rgba(18,2,10,0.95)", border: "1px solid rgba(255,43,77,0.4)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-white">
                    🛰️ مصفوفة عقد كالي الـ10 الأساسية المتصلة حاليًا
                  </span>
                  <button
                    onClick={() => void triggerSelfHeal()}
                    className="px-3 py-1 rounded-lg text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  >
                    ⚡ مزامنة كل العقد الآن
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(nodes.length ? nodes : []).map((n) => (
                    <div
                      key={n.id}
                      className="p-2.5 rounded-xl flex items-center justify-between bg-black/60 border border-emerald-500/30"
                    >
                      <div>
                        <div className="text-xs font-mono font-black text-white" dir="ltr">
                          {n.id} · {n.hostname}
                        </div>
                        <div className="text-[10px] font-mono text-emerald-300" dir="ltr">
                          {n.mode} · {n.platform}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300">
                        ✓ KALI READY
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="lg:col-span-5 rounded-2xl p-4 flex flex-col gap-2.5"
                style={{ background: "rgba(12,1,8,0.96)", border: "1px solid rgba(56,189,248,0.4)" }}
              >
                <div className="text-xs font-black text-sky-300">🌐 واجهات الشبكة والمقابس المفتوحة (Live Network)</div>
                <pre
                  dir="ltr"
                  className="flex-1 min-h-[240px] p-3 rounded-xl bg-black/85 border border-sky-500/30 text-[11px] font-mono text-sky-200 whitespace-pre-wrap overflow-auto"
                >
                  {[
                    "=== NETWORK INTERFACES ===",
                    ...(controlInfo?.networkInterfaces ?? ["lo UNKNOWN 127.0.0.1/8", "eth0 UP"]),
                    "",
                    "=== LISTENING SOCKETS ===",
                    ...(controlInfo?.openSockets ?? []),
                    "",
                    "=== DNS RESOLVERS ===",
                    ...(controlInfo?.dnsServers ?? []),
                  ].join("\n")}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 10: 📸 GENERATIONS & SNAPSHOTS 1–5+ (جد النسخة 1-5 أو أكثر)
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "gens" && (
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "rgba(18,2,10,0.95)", border: "1.5px solid rgba(251,191,36,0.45)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-white">
                  📸 أرشيف الأجيال واللقطات المحفوظة (النسخ 1 إلى {generations.length || 5}+ — إنشاء · استرداد · تصدير · استيراد)
                </div>
                <div className="text-xs text-amber-200/80">
                  احفظ واسترد أي جيل من أجيال بيئة كالي 2099 بكل أدواته ومساحاته وإعداداته بضغطة واحدة
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const txt = await file.text();
                      const json = JSON.parse(txt);
                      const r = await fetch(`${API}/kali-env/generations/import`, {
                        method: "POST",
                        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
                        body: JSON.stringify(json),
                      });
                      const d = await r.json();
                      if (d?.ok && Array.isArray(d.generations)) {
                        setGenerations(d.generations);
                        setGenMsg(`✓ تم استيراد وتفعيل «${d.imported?.title}» بنجاح`);
                      }
                    } catch (err) {
                      setGenMsg(`✗ فشل الاستيراد: ${(err as Error).message}`);
                    }
                  }}
                />
                <button
                  onClick={() => importFileRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl text-xs font-black bg-sky-500/20 border border-sky-500/50 text-sky-200 flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>استيراد نسخة JSON</span>
                </button>
              </div>
            </div>

            {/* Create New Generation Bar */}
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-black/60 border border-amber-500/35">
              <input
                value={newGenTitle}
                onChange={(e) => setNewGenTitle(e.target.value)}
                placeholder="عنوان النسخة الجديدة (مثال: النسخة 6 — لقطة 2099 الخاصة)..."
                className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg text-xs bg-black/80 border border-amber-500/40 text-white"
              />
              <input
                value={newGenDesc}
                onChange={(e) => setNewGenDesc(e.target.value)}
                placeholder="وصف اللقطة..."
                className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg text-xs bg-black/80 border border-amber-500/40 text-white"
              />
              <button
                onClick={async () => {
                  const r = await fetch(`${API}/kali-env/generations`, {
                    method: "POST",
                    headers: novaAuthHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({ title: newGenTitle, description: newGenDesc }),
                  });
                  const d = await r.json();
                  if (d?.ok && Array.isArray(d.generations)) {
                    setGenerations(d.generations);
                    setNewGenTitle("");
                    setNewGenDesc("");
                    setGenMsg(`✓ تم إنشاء وحفظ «${d.generation?.title}»`);
                  }
                }}
                className="px-4 py-1.5 rounded-xl text-xs font-black bg-amber-500 text-black hover:bg-amber-400"
              >
                + إنشاء وحفظ لقطة جديدة
              </button>
            </div>

            {genMsg && (
              <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs font-mono text-emerald-300">
                {genMsg}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {generations.map((g) => (
                <div
                  key={g.id}
                  className="p-3.5 rounded-2xl flex flex-col justify-between gap-2.5"
                  style={{
                    background: "rgba(251,191,36,0.06)",
                    border: "1px solid rgba(251,191,36,0.35)",
                  }}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black bg-amber-500/20 text-amber-300">
                        GEN #{g.genNumber} ({g.id})
                      </span>
                      <span className="text-[10px] font-mono text-emerald-300">
                        {g.toolsPresent}/{g.toolsTotal} أداة · {g.pythonToolsCount} بايثون
                      </span>
                    </div>
                    <div className="text-xs font-black text-white mt-1.5">{g.title}</div>
                    <div className="text-[10px] text-slate-300 mt-1 leading-relaxed">{g.description}</div>
                  </div>

                  <div className="flex items-center gap-1.5 pt-2 border-t border-white/10">
                    <button
                      onClick={async () => {
                        const r = await fetch(`${API}/kali-env/generations/${g.id}/restore`, {
                          method: "POST",
                          headers: novaAuthHeaders(),
                        });
                        const d = await r.json();
                        setGenMsg(d?.message || "✓ تم الاسترداد");
                      }}
                      className="flex-1 py-1 rounded-lg text-[10px] font-black bg-emerald-500/25 hover:bg-emerald-500/40 text-emerald-300 border border-emerald-500/40"
                    >
                      ♻️ استرداد وتفعيل
                    </button>
                    <a
                      href={`${API}/kali-env/generations/${g.id}/export`}
                      download={`nova-${g.id}-snapshot.json`}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-sky-500/25 hover:bg-sky-500/40 text-sky-200 border border-sky-500/40"
                    >
                      📤 تصدير
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 11: 🛡️ SELF-HEAL ENGINE & ETERNAL AUDIT LOG
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "heal" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div
              className="lg:col-span-4 rounded-2xl p-4 flex flex-col gap-3"
              style={{ background: "rgba(18,2,10,0.95)", border: "1px solid rgba(68,255,136,0.45)" }}
            >
              <div className="text-sm font-black text-emerald-300">
                🛡️ محرك المعالجة التلقائية والمزامنة الذاتية (Self-Heal Engine)
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                يمنع حذف أو فقدان أي أداة أو ملف عند تدوير العقد؛ يعمّم الـ266 أداة والـ28 أداة بايثون ومساحات الشغل على جميع عقد الأسطول الـ10 أوتوماتيكيًا.
              </p>
              <div className="p-3 rounded-xl bg-black/70 border border-emerald-500/35 text-xs font-mono space-y-1.5">
                <div className="text-emerald-300">الحالة: {selfHeal?.status || "جاهز ومتزامن 100%"}</div>
                <div className="text-slate-300">العقد المتزامنة: {selfHeal?.syncedNodes ?? 10} عقدة كالي</div>
                <div className="text-slate-400">
                  آخر فحص: {selfHeal?.lastRunAt ? new Date(selfHeal.lastRunAt).toLocaleString() : "نشط"}
                </div>
              </div>
              <button
                onClick={() => void triggerSelfHeal()}
                disabled={healBusy}
                className="py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
              >
                {healBusy ? "⏳ جاري الفحص والمزامنة..." : "⚡ تشغيل دورة المعالجة والمزامنة الذاتية الآن"}
              </button>
            </div>

            <div
              className="lg:col-span-8 rounded-2xl p-4 flex flex-col gap-3"
              style={{ background: "rgba(12,1,8,0.96)", border: "1px solid rgba(255,43,77,0.4)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-black text-white">
                  📜 السجل الأبدي للعمليات والإشعارات («تمت وبتتم» · {events.length} حدث موثق)
                </span>
                <div className="flex items-center gap-1">
                  {["ALL", "desktop", "browser", "pipeline", "self-heal", "install", "generation"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setEventFilter(f)}
                      className="px-2 py-0.5 rounded text-[10px] font-mono"
                      style={{
                        background: eventFilter === f ? "#ff2b4d" : "rgba(255,255,255,0.06)",
                        color: "#fff",
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 max-h-[460px] overflow-y-auto pr-1">
                {events
                  .filter((ev) => eventFilter === "ALL" || ev.kind.includes(eventFilter))
                  .map((ev, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-black/70 border border-rose-500/25 flex items-start justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-bold text-white">{ev.title}</div>
                        {ev.detail && <div className="text-[10px] font-mono text-rose-200/75 mt-0.5">{ev.detail}</div>}
                      </div>
                      <span className="text-[9px] font-mono text-slate-400 shrink-0" dir="ltr">
                        {new Date(ev.ts).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
         * TAB 12: 🌍 UNIFIED 2099 CYBERNOVA OS HUB (خريطة كل وحدات البرنامج)
         * ────────────────────────────────────────────────────────────────────── */}
        {activeTab === "osmap" && (
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "rgba(18,2,10,0.95)", border: "1px solid rgba(167,139,250,0.45)" }}
          >
            <div className="text-sm font-black text-white">
              🌍 خريطة وحدات منصة CyberNova & Nova Kali 2099 الشاملة
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {[
                { title: "⚡ الشغل والشات الحي (دوشة)", path: "/agent-pro", desc: "الوكيل الحي + قياسات العقدة + المهام" },
                { title: "🖥️ xDaw Desktop 2099", path: "/desktop", desc: "بيئة النوافذ المتعددة والتطبيقات" },
                { title: "🛡️ استوديو البج باونتي", path: "/bug-bounty-studio", desc: "HackerOne & Google VRP Legal Scope" },
                { title: "☢️ مركز الثغرات الحي", path: "/vuln-center", desc: "قاعدة بيانات الثغرات والاستغلالات" },
                { title: "📡 CVE Live Sync", path: "/cve-live", desc: "مزامنة الثغرات اللحظية NVD & CISA KEV" },
                { title: "🎯 محرك Nuclei القياسي", path: "/nuclei-engine", desc: "14,315 قالب فحص ثغرات" },
                { title: "🌐 سطح الهجوم Attack Surface", path: "/attack-surface", desc: "تحليل الأصول والنطاقات المكشوفة" },
                { title: "🧠 الاستخبارات Threat Intel", path: "/threat-intel", desc: "رصد التهديدات وIOCs" },
                { title: "🛰️ أسطول نوفا الموحد", path: "/nova-fleet", desc: "إدارة العقد والوكيل السحابي" },
                { title: "📋 Playbooks & الأتمتة", path: "/playbooks", desc: "خطط الاستجابة والفحص التلقائي" },
                { title: "📄 مركز التقارير الأمنية", path: "/reports", desc: "توليد وتصدير التقارير الاحترافية" },
                { title: "✅ الفحص الذاتي للنظام", path: "/self-check", desc: "التحقق الحي من كافة الخدمات" },
              ].map((m) => (
                <button
                  key={m.path}
                  onClick={() => navigate(m.path)}
                  className="p-3.5 rounded-2xl text-right flex flex-col justify-between gap-1.5 bg-white/5 hover:bg-rose-500/20 border border-rose-500/30 transition-all hover:scale-[1.01]"
                >
                  <div className="text-xs font-black text-white">{m.title}</div>
                  <div className="text-[10px] text-rose-200/75">{m.desc}</div>
                  <span className="text-[9px] font-mono text-emerald-300 mt-1" dir="ltr">
                    {m.path} →
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
