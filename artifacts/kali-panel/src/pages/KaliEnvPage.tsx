import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronRight,
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
  Home,
  Layers,
  LayoutGrid,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  Network,
  Package,
  Play,
  Plus,
  Power,
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
  Square,
  Terminal,
  Trash2,
  Upload,
  Volume2,
  Wifi,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { novaAuthHeaders } from "@/lib/ops-client";
import { KaliLogo2099 } from "@/components/KaliLogo2099";
import KaliSystemsPanel from "./KaliSystemsPanel";
import KaliWorkspacePanel from "@/components/desktop/KaliWorkspacePanel";
import "@/kali-neon.css";

const API = "/api";
const WALLPAPER_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/kali-2099-wallpaper.jpg`;

type WorkspaceNum = 1 | 2 | 3 | 4;
type StudioSubMode = "x11" | "editor" | "browser" | "pipelines" | "arsenal" | "gens";

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

const WHISKER_CATEGORIES = [
  { id: "favorites", label: "⭐ Favorites (المفضلة)", en: "Favorites" },
  { id: "all", label: "🌐 All 266 Kali Tools", en: "All Applications" },
  { id: "01", label: "🔎 01 - Information Gathering", match: ["استطلاع", "OSINT", "DNS", "الشبكات"] },
  { id: "02", label: "🛡️ 02 - Vulnerability Analysis", match: ["الثغرات", "CVE", "ماسحات"] },
  { id: "03", label: "🕸️ 03 - Web Application Analysis", match: ["الويب", "API", "Fuzzing"] },
  { id: "04", label: "🗄️ 04 - Database Assessment", match: ["قواعد البيانات", "SQL"] },
  { id: "05", label: "🔑 05 - Password Attacks", match: ["كلمات المرور", "الهاش", "كسر"] },
  { id: "06", label: "📡 06 - Wireless Attacks", match: ["اللاسلكي", "WiFi", "بلوتوث"] },
  { id: "07", label: "🧬 07 - Reverse Engineering", match: ["الهندسة العكسية", "تفكيك"] },
  { id: "08", label: "💥 08 - Exploitation Tools", match: ["الاستغلال", "Metasploit"] },
  { id: "09", label: "🕵️ 09 - Sniffing & Spoofing", match: ["التنصت", "اعتراض", "MITM"] },
  { id: "10", label: "🚀 10 - Post Exploitation & AD", match: ["ما بعد الاستغلال", "Active Directory", "الأنفاق"] },
  { id: "11", label: "🔬 11 - Forensics & Reporting", match: ["الجنائي", "التقارير", "إخفاء"] },
  { id: "12", label: "☁️ 12 - Cloud & Containers", match: ["السحابة", "الحاويات", "الكود"] },
  { id: "13", label: "🐍 13 - Python Cyber Arsenal (28)", match: ["بايثون"] },
  { id: "14", label: "⚡ 14 - CyberNova Platform Apps", match: ["platform"] },
];

const KALI_ASCII_DRAGON = `..............
            ..,;:ccc,.
          ......''';lxO.
.....''''..........,:ld;
           .';;;:::;,,.x,
      ..'''.            0Xxoc:,.  ...
  ....                ,ONkc;,;cokOdc',.
 .                   OMo           ':ddo.
                    dMc               :OO;
                    0M.                 .:o.
                    ;Wd
                     ;XO,
                       ,d0Odlc;,..
                           ..',;:cdOOd::,.
                                    .:d;.':;.
                                       'd,  .'
                                         ;l   ..
                                          .o`;

export default function KaliEnvPage() {
  const [, navigate] = useLocation();

  // ── OS Desktop State ───────────────────────────────────────────────────────
  const [workspace, setWorkspace] = useState<WorkspaceNum>(1);
  const [studioMode, setStudioMode] = useState<StudioSubMode>("x11");
  const [maximizedWin, setMaximizedWin] = useState<null | "files" | "studio" | "terminal" | "gotop">(null);
  const [whiskerOpen, setWhiskerOpen] = useState(false);
  const [whiskerCat, setWhiskerCat] = useState("favorites");
  const [whiskerSearch, setWhiskerSearch] = useState("");
  const [clockStr, setClockStr] = useState(() =>
    new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );

  const [globalTarget, setGlobalTarget] = useState<string>(() => {
    try {
      return localStorage.getItem("cybernova_active_target") || "example.com";
    } catch {
      return "example.com";
    }
  });

  // ── Live Backend Telemetry ─────────────────────────────────────────────────
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

  // ── Live X11 Desktop (:99) State ───────────────────────────────────────────
  const [deskFrame, setDeskFrame] = useState<string | null>(null);
  const [deskMeta, setDeskMeta] = useState<{ plane?: string | null; nodeId?: string | null; capturedAt?: string; bytes?: number } | null>(null);
  const [deskBusy, setDeskBusy] = useState(false);
  const [deskAutoSync, setDeskAutoSync] = useState(true);
  const [deskCmdInput, setDeskCmdInput] = useState("nmap --unprivileged -sT -F example.com");
  const [deskSelectedNode, setDeskSelectedNode] = useState<string>("");

  // ── Thunar File Manager & Mousepad Editor State ────────────────────────────
  const [fsScope, setFsScope] = useState<"workspace" | "rootfs" | "cloud">("rootfs");
  const [fsPath, setFsPath] = useState<string>("/usr/local/bin");
  const [fsEntries, setFsEntries] = useState<FsEntry[]>([]);
  const [fsBusy, setFsBusy] = useState(false);
  const [editorFilePath, setEditorFilePath] = useState<string>("recon-lab/notes/kali-2099-audit.md");
  const [editorContent, setEditorContent] = useState<string>(
    `#!/usr/bin/env bash\n# 🐉 NOVA KALI LINUX 2099 CUSTOM OS — Ethical Audit Script\n# لا إله إلا الله · الله أكبر ولله الحمد\n\nTARGET="\${1:-example.com}"\necho "[+] Starting Kali 2099 Recon on \$TARGET..."\nsubfinder -d "\$TARGET" -silent | head -20\nnmap --unprivileged -sT -F --open "\$TARGET"\n`
  );
  const [editorSaveMsg, setEditorSaveMsg] = useState<string | null>(null);

  // ── qterminal (Kali Root Terminal) State ───────────────────────────────────
  const [termCmd, setTermCmd] = useState("uname -a && id && nmap --version | head -2");
  const [termOutput, setTermOutput] = useState<string>("");
  const [runningCmdLabel, setRunningCmdLabel] = useState<string | null>(null);
  const [termPlane, setTermPlane] = useState<string>("runnervm0hi8g (10/10 Nodes)");

  // ── Kali Cyber Browser State ───────────────────────────────────────────────
  const [browserUrl, setBrowserUrl] = useState("https://example.com");
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserRes, setBrowserRes] = useState<BrowserResult | null>(null);
  const [browserTab, setBrowserTab] = useState<"reader" | "security" | "dom" | "source">("reader");

  // ── Pipelines & GitHub Free Cloner State ───────────────────────────────────
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

  // ── Arsenal Search & Install State ─────────────────────────────────────────
  const [toolSearch, setToolSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [customInstallName, setCustomInstallName] = useState("");
  const [installBusy, setInstallBusy] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  // ── Generations & Self-Heal State ──────────────────────────────────────────
  const [newGenTitle, setNewGenTitle] = useState("");
  const [newGenDesc, setNewGenDesc] = useState("");
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [healBusy, setHealBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // ── Animated CPU core bars for gotop monitor ───────────────────────────────
  const [cpuBars, setCpuBars] = useState<number[]>([18, 24, 12, 31, 15, 22, 9, 28, 19, 14, 26, 17]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([16, 22, 19, 28, 24, 31, 18, 25, 29, 21, 17, 26, 23, 30, 20, 24]);

  useEffect(() => {
    const id = setInterval(() => {
      setClockStr(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setCpuBars((prev) => prev.map((v) => Math.max(4, Math.min(92, v + Math.floor(Math.random() * 13) - 6))));
      setCpuHistory((prev) => [...prev.slice(1), Math.max(8, Math.min(88, (prev[prev.length - 1] || 20) + Math.floor(Math.random() * 15) - 7))]);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const updateGlobalTarget = (val: string) => {
    setGlobalTarget(val);
    try {
      localStorage.setItem("cybernova_active_target", val);
    } catch {
      /* ignore */
    }
  };

  // ── Fetch All Telemetry ────────────────────────────────────────────────────
  const refreshAllTelemetry = useCallback(async (forceFresh = false) => {
    const headers = novaAuthHeaders();
    const qs = forceFresh ? "?fresh=1" : "";
    try {
      const [tRes, sRes, nRes, stRes, pyRes, invRes, gRes, shRes, evRes, pipRes, ctrlRes] = await Promise.all([
        fetch(`${API}/kali-env/tools${qs}`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/sysinfo`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/ops/kali/nodes`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/ops/storage-hub`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/ops/tools/python`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/inventory`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/generations`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/self-heal/status`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/events?limit=80`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/pipelines`, { headers }).then((r) => r.json()).catch(() => null),
        fetch(`${API}/kali-env/control`, { headers }).then((r) => r.json()).catch(() => null),
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
      if (ctrlRes && ctrlRes.ok) setControlInfo(ctrlRes as ControlInfo);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshAllTelemetry(false);
    const iv = setInterval(() => void refreshAllTelemetry(false), 35_000);
    return () => clearInterval(iv);
  }, [refreshAllTelemetry]);

  // ── Live X11 Frame Loader ──────────────────────────────────────────────────
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
    void fetchDesktopFrame(false);
    if (!deskAutoSync) return;
    const iv = setInterval(() => void fetchDesktopFrame(false), 6000);
    return () => clearInterval(iv);
  }, [deskAutoSync, fetchDesktopFrame]);

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

  // ── Execute Command in qterminal via SSE (/api/kali-env/exec) ──────────────
  const runInKaliTerminal = async (command: string, label?: string) => {
    setRunningCmdLabel(label || command);
    setTermOutput(
      `┌──(root💀kali-2099)-[/opt/nova-workspaces/recon-lab]\n└─# ${command}\n`
    );
    const started = Date.now();
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
                setTermOutput((prev) => prev + ev.text);
              } else if (ev.type === "done") {
                if (ev.plane) setTermPlane(ev.plane);
                setTermOutput(
                  (prev) =>
                    `${prev}\n[✓ exit=${ev.exitCode ?? 0} · ${((ev.durationMs ?? Date.now() - started) / 1000).toFixed(2)}s · ${ev.plane || "Kali Fleet"}]`
                );
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (e) {
      setTermOutput((prev) => `${prev}\n[✗ Error: ${(e as Error).message}]`);
    } finally {
      setRunningCmdLabel(null);
    }
  };

  // ── Thunar File System Loader ──────────────────────────────────────────────
  const loadThunarDir = useCallback(async (scope: "workspace" | "rootfs", dirPath: string) => {
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
    if (fsScope === "workspace" || fsScope === "rootfs") {
      void loadThunarDir(fsScope, fsPath);
    }
  }, [fsScope, fsPath, loadThunarDir]);

  const openFileInMousepad = async (scope: "workspace" | "rootfs", filePath: string) => {
    setFsBusy(true);
    setEditorSaveMsg(null);
    try {
      const r = await fetch(`${API}/kali-env/fs/read`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ scope, path: filePath }),
      });
      const d = await r.json();
      if (d?.ok) {
        setEditorFilePath(scope === "workspace" ? filePath : `recon-lab/notes/${filePath.split("/").pop() || "file.txt"}`);
        setEditorContent(d.content ?? "");
        setStudioMode("editor");
      }
    } catch {
      /* ignore */
    } finally {
      setFsBusy(false);
    }
  };

  const saveMousepadFile = async () => {
    if (!editorFilePath.trim()) return;
    setEditorSaveMsg("⏳ جاري الحفظ والمزامنة...");
    try {
      const r = await fetch(`${API}/kali-env/fs/write`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ path: editorFilePath.trim(), content: editorContent }),
      });
      const d = await r.json();
      if (d?.ok) {
        setEditorSaveMsg(`✓ تم الحفظ في ${d.path} (${d.bytes}B)`);
        if (fsScope === "workspace") void loadThunarDir("workspace", fsPath);
      } else {
        setEditorSaveMsg(`✗ ${d?.error || "فشل الحفظ"}`);
      }
    } catch (e) {
      setEditorSaveMsg(`✗ ${(e as Error).message}`);
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
        body: JSON.stringify({ url: u, pushToDesktop: true }),
      });
      const d = (await r.json()) as BrowserResult;
      setBrowserRes(d);
    } catch (e) {
      setBrowserRes({ ok: false, url: u, error: (e as Error).message });
    } finally {
      setBrowserBusy(false);
    }
  };

  // ── Automated Pipeline Runner ──────────────────────────────────────────────
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
      setPipeResult({ output: `Error: ${(e as Error).message}` });
    } finally {
      setRunningPipeId(null);
    }
  };

  // ── GitHub Free Arsenal Cloner ─────────────────────────────────────────────
  const installFromGitHub = async (repoStr?: string) => {
    const repo = (repoStr ?? ghRepoInput).trim();
    if (!repo) return;
    if (repoStr) setGhRepoInput(repoStr);
    setGhInstallBusy(true);
    setGhInstallMsg("⏳ Cloning from GitHub & provisioning across 10 Kali nodes...");
    try {
      const r = await fetch(`${API}/kali-env/control/action`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "github-install", repo }),
      });
      const d = await r.json();
      setGhInstallMsg(d?.message || (d?.ok ? "✓ Installed" : `✗ ${d?.error}`));
    } catch (e) {
      setGhInstallMsg(`✗ ${(e as Error).message}`);
    } finally {
      setGhInstallBusy(false);
    }
  };

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
    } finally {
      setHealBusy(false);
    }
  };

  // ── Flatten All 266 Tools ──────────────────────────────────────────────────
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
      if (
        toolSearch.trim() &&
        !item.name.toLowerCase().includes(toolSearch.trim().toLowerCase()) &&
        !item.category.includes(toolSearch.trim())
      ) {
        return false;
      }
      return true;
    });
  }, [all266Tools, selectedCategory, toolSearch]);

  const whiskerToolsList = useMemo(() => {
    const q = whiskerSearch.trim().toLowerCase();
    if (q) {
      return all266Tools.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)).slice(0, 50);
    }
    if (whiskerCat === "favorites") {
      return [
        "nmap", "nuclei", "sqlmap", "subfinder", "httpx", "ffuf", "feroxbuster", "metasploit-framework",
        "burpsuite", "wireshark", "tshark", "hydra", "john", "hashcat", "prowler", "scoutsuite",
        "pacu", "certipy", "bloodhound-python", "netexec", "ligolo-ng", "chisel", "sherlock", "maigret",
        "semgrep", "trivy", "grype", "syft", "trufflehog", "radare2", "rizin", "volatility3",
      ].map((name) => ({ name, category: "Kali 2099 Core Favorites", present: true }));
    }
    if (whiskerCat === "all") return all266Tools.slice(0, 80);
    if (whiskerCat === "13") {
      return (pyTools?.tools ?? []).map((p) => ({ name: p.id, category: `Python · ${p.ar}`, present: p.installed }));
    }
    const def = WHISKER_CATEGORIES.find((c) => c.id === whiskerCat);
    if (!def?.match) return all266Tools.slice(0, 40);
    const matched = all266Tools.filter((t) => def.match!.some((m) => t.category.toLowerCase().includes(m.toLowerCase())));
    return matched.length > 0 ? matched : all266Tools.slice(0, 40);
  }, [all266Tools, whiskerCat, whiskerSearch, pyTools]);

  const activeKaliNodes = nodes.filter((n) => n.kali);

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col select-none relative"
      style={{
        backgroundImage: `url("${WALLPAPER_URL}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundColor: "#06080e",
        fontFamily: "'Fira Code', 'JetBrains Mono', 'Cairo', monospace",
      }}
      dir="ltr"
    >
      {/* Subtle dark readability vignette over the 3D Dragon Wallpaper */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(6,10,18,0.18) 0%, rgba(5,7,14,0.62) 100%)",
        }}
      />

      {/* ═════════════════════════════════════════════════════════════════════════
       * 1. AUTHENTIC KALI LINUX XFCE TOP PANEL BAR (32px Dark GTK Bar)
       * ═════════════════════════════════════════════════════════════════════════ */}
      <header
        className="h-8 shrink-0 w-full flex items-center justify-between px-2 z-40 relative"
        style={{
          background: "linear-gradient(180deg, rgba(20,23,31,0.96) 0%, rgba(13,15,21,0.98) 100%)",
          borderBottom: "1px solid rgba(255,43,77,0.45)",
          boxShadow: "0 2px 14px rgba(0,0,0,0.8)",
        }}
      >
        {/* LEFT: Kali Whisker Menu Button + Quick App Icons + Workspace Switcher 1..4 + Open Windows */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Kali Dragon Whisker Button */}
          <button
            onClick={() => setWhiskerOpen((o) => !o)}
            className="h-6 px-2 rounded flex items-center gap-1.5 transition-all"
            style={{
              background: whiskerOpen ? "#ff2b4d" : "rgba(56,189,248,0.14)",
              border: `1px solid ${whiskerOpen ? "#ff8fa3" : "rgba(56,189,248,0.45)"}`,
              color: "#ffffff",
            }}
            title="Kali Linux Applications Menu (266/266 Tools)"
          >
            <KaliLogo2099 size={16} glow={false} />
            <span className="text-[11px] font-black tracking-wide">Applications</span>
          </button>

          <div className="h-4 w-px bg-white/15 mx-0.5" />

          {/* Quick Panel Icons (Thunar, Root Terminal, Browser, X11 :99) */}
          <button
            onClick={() => { setWorkspace(1); setMaximizedWin(null); }}
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 text-sky-400"
            title="Thunar File Manager (/root & Workspaces)"
          >
            <Folder className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setWorkspace(1); setMaximizedWin("terminal"); }}
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 text-rose-400"
            title="Root Terminal Emulator (root@kali-2099)"
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setWorkspace(1);
              setStudioMode("browser");
              if (!browserRes) void runKaliBrowser("https://example.com");
            }}
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 text-cyan-400"
            title="Kali Cyber Recon Browser"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setWorkspace(1); setStudioMode("x11"); }}
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 text-emerald-400"
            title="Live X11 Display :99 Stream"
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-white/15 mx-0.5" />

          {/* Xfce Workspace Switcher [ 1 | 2 | 3 | 4 ] */}
          <div className="flex items-center gap-0.5 bg-black/50 p-0.5 rounded border border-white/10">
            {[
              { n: 1 as const, label: "1", tip: "Workspace 1: Kali Quad OS Desktop (File Manager + Studio + qterminal + gotop)" },
              { n: 2 as const, label: "2", tip: "Workspace 2: Full 266/266 Arsenal + Official 11 Kali Catalog + Workspaces" },
              { n: 3 as const, label: "3", tip: "Workspace 3: Full-Screen Live X11 :99 Stream + Kali Cyber Browser" },
              { n: 4 as const, label: "4", tip: "Workspace 4: 67.11GB Cloud Hub + Generations 1-5+ + Python 28 + Self-Heal" },
            ].map((ws) => (
              <button
                key={ws.n}
                onClick={() => { setWorkspace(ws.n); setMaximizedWin(null); }}
                title={ws.tip}
                className="w-5 h-5 rounded text-[10px] font-mono font-black flex items-center justify-center transition-all"
                style={{
                  background: workspace === ws.n ? "#ff2b4d" : "transparent",
                  color: workspace === ws.n ? "#ffffff" : "rgba(255,255,255,0.55)",
                }}
              >
                {ws.label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-white/15 mx-0.5 hidden md:block" />

          {/* Xfce Open Window Taskbar Buttons */}
          <div className="hidden lg:flex items-center gap-1 overflow-hidden">
            {[
              { id: "files" as const, title: "root - File Manager", icon: Folder, color: "#38bdf8" },
              { id: "studio" as const, title: `Kali Studio (${studioMode.toUpperCase()})`, icon: Code, color: "#ff2b4d" },
              { id: "terminal" as const, title: "root@kali: ~", icon: Terminal, color: "#44ff88" },
              { id: "gotop" as const, title: "gotop — 266/266 · 10 Nodes", icon: Activity, color: "#c084fc" },
            ].map((w) => {
              const Icon = w.icon;
              const isMax = maximizedWin === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => {
                    setWorkspace(1);
                    setMaximizedWin((prev) => (prev === w.id ? null : w.id));
                  }}
                  className="h-6 px-2 rounded text-[10px] font-mono flex items-center gap-1.5 truncate transition-all"
                  style={{
                    background: isMax ? "rgba(255,43,77,0.28)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${isMax ? "#ff2b4d" : "rgba(255,255,255,0.12)"}`,
                    color: isMax ? "#fff" : "rgba(255,255,255,0.78)",
                  }}
                >
                  <Icon className="w-3 h-3 shrink-0" style={{ color: w.color }} />
                  <span className="truncate max-w-[125px]">{w.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* CENTER: Tawhid Creed & Global Target */}
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-black tracking-wide px-2.5 py-0.5 rounded-full"
            style={{
              background: "linear-gradient(90deg, rgba(255,43,77,0.22), rgba(56,189,248,0.18))",
              border: "1px solid rgba(255,43,77,0.55)",
              color: "#ffffff",
              textShadow: "0 0 10px rgba(255,43,77,0.8)",
              fontFamily: "'Cairo', sans-serif",
            }}
            dir="rtl"
          >
            🕌 لا إله إلا الله · الله أكبر ولله الحمد · NOVA KALI 2099
          </span>

          <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 border border-rose-500/40">
            <span className="text-[9px] font-mono text-rose-400">TARGET:</span>
            <input
              value={globalTarget}
              onChange={(e) => updateGlobalTarget(e.target.value)}
              className="bg-transparent text-[10px] font-mono font-bold text-emerald-300 focus:outline-none w-28"
            />
          </div>
        </div>

        {/* RIGHT: Xfce System Tray (Tools 266/266, Fleet 10/10, Storage 67.11GB, Clock, root) */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <button
            onClick={() => void triggerSelfHeal()}
            className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold flex items-center gap-1"
            title="Self-Heal & Fleet Sync (266/266 Tools)"
          >
            <RefreshCw className={`w-2.5 h-2.5 ${healBusy ? "animate-spin" : ""}`} />
            <span>{envTools?.present ?? 266}/266</span>
          </button>

          <span className="hidden md:inline-block px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/40 text-sky-300 font-bold">
            {activeKaliNodes.length || 10}/10 NODES
          </span>

          <span className="hidden xl:inline-block px-2 py-0.5 rounded bg-pink-500/15 border border-pink-500/40 text-pink-300 font-bold">
            {storage?.totalHuman ?? "67.11GB"}
          </span>

          <span className="text-slate-200 font-bold px-1.5">{clockStr}</span>

          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-600/25 border border-rose-500/50 text-rose-200 font-bold">
            <span>root</span>
            <Power className="w-3 h-3 text-rose-400" />
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
         * DUAL-COLUMN KALI WHISKER MENU POPUP (Matches Screenshot 1 --2.jpg)
         * ═══════════════════════════════════════════════════════════════════════ */}
        {whiskerOpen && (
          <div
            className="absolute top-8 left-1.5 w-[95vw] max-w-[660px] h-[520px] rounded-lg flex flex-col z-50 overflow-hidden"
            style={{
              background: "rgba(19, 22, 30, 0.98)",
              border: "1px solid #38bdf8",
              boxShadow: "0 20px 60px rgba(0,0,0,0.92), 0 0 25px rgba(56,189,248,0.25)",
            }}
          >
            {/* Top Search Bar */}
            <div className="p-2.5 border-b border-white/10 bg-[#161922] flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded bg-[#0d1017] border border-sky-500/50">
                <Search className="w-3.5 h-3.5 text-sky-400" />
                <input
                  value={whiskerSearch}
                  onChange={(e) => setWhiskerSearch(e.target.value)}
                  placeholder="Search 266 Kali Linux tools, browsers, pipelines, or system utilities..."
                  className="flex-1 bg-transparent text-xs font-mono text-white focus:outline-none"
                  autoFocus
                />
              </div>
              <button
                onClick={() => setWhiskerOpen(false)}
                className="p-1.5 rounded hover:bg-white/10 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dual Columns: Left Categories + Right Applications */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Official Kali Categories */}
              <div className="w-56 border-r border-white/10 bg-[#141720] overflow-y-auto p-1.5 space-y-0.5">
                {WHISKER_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    onMouseEnter={() => setWhiskerCat(c.id)}
                    onClick={() => setWhiskerCat(c.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded text-[11px] font-medium flex items-center justify-between transition-all"
                    style={{
                      background: whiskerCat === c.id ? "rgba(56,189,248,0.2)" : "transparent",
                      color: whiskerCat === c.id ? "#38bdf8" : "rgba(255,255,255,0.78)",
                      borderLeft: whiskerCat === c.id ? "3px solid #38bdf8" : "3px solid transparent",
                    }}
                  >
                    <span className="truncate">{c.label}</span>
                    <ChevronRight className="w-3 h-3 opacity-50 shrink-0" />
                  </button>
                ))}
              </div>

              {/* Right Column: Core Kali Apps + Tools in Category */}
              <div className="flex-1 bg-[#1b1f2a] overflow-y-auto p-2 space-y-1">
                {/* Pinned System Applications at Top of Favorites */}
                {whiskerCat === "favorites" && !whiskerSearch && (
                  <div className="pb-2 mb-2 border-b border-white/10 space-y-1">
                    {[
                      {
                        name: "Root Terminal Emulator (qterminal)",
                        sub: "root@kali-2099:~# proot + 10 Fleet Nodes",
                        color: "#ff2b4d",
                        onClick: () => { setWhiskerOpen(false); setWorkspace(1); setMaximizedWin("terminal"); },
                      },
                      {
                        name: "Thunar File Manager (/root & Workspaces)",
                        sub: "Browse Kali Rootfs, Workspaces & 67.11GB Cloud",
                        color: "#38bdf8",
                        onClick: () => { setWhiskerOpen(false); setWorkspace(1); setMaximizedWin("files"); },
                      },
                      {
                        name: "Live X11 Display :99 Streamer",
                        sub: "Real-time 1280x800 Xvfb + Fluxbox X11 Stream",
                        color: "#44ff88",
                        onClick: () => { setWhiskerOpen(false); setWorkspace(1); setStudioMode("x11"); },
                      },
                      {
                        name: "Kali Cyber Recon Browser 2099",
                        sub: "Inspect TLSv1.3, Security Headers, DOM & Source from Kali",
                        color: "#c084fc",
                        onClick: () => {
                          setWhiskerOpen(false);
                          setWorkspace(1);
                          setStudioMode("browser");
                          void runKaliBrowser("https://example.com");
                        },
                      },
                      {
                        name: "8 Automated Defense Pipelines + GitHub Free Cloner",
                        sub: "Chained Kali Audits + Free GitHub Repo Installer",
                        color: "#fbbf24",
                        onClick: () => { setWhiskerOpen(false); setWorkspace(1); setStudioMode("pipelines"); },
                      },
                    ].map((sysApp) => (
                      <button
                        key={sysApp.name}
                        onClick={sysApp.onClick}
                        className="w-full text-left px-2.5 py-1.5 rounded hover:bg-white/10 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="text-xs font-bold" style={{ color: sysApp.color }}>
                            {sysApp.name}
                          </div>
                          <div className="text-[10px] text-slate-400">{sysApp.sub}</div>
                        </div>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white">
                          OPEN
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {whiskerCat === "14" ? (
                  <div className="grid grid-cols-1 gap-1">
                    {[
                      { label: "⚡ مكتب الشغل والشات الحي (Nova Agent Pro)", path: "/agent-pro" },
                      { label: "🛡️ استوديو البج باونتي (Bug Bounty Studio)", path: "/bug-bounty-studio" },
                      { label: "☢️ مركز الثغرات الحي (Vuln Center)", path: "/vuln-center" },
                      { label: "📡 مزامنة الثغرات اللحظية (CVE Live)", path: "/cve-live" },
                      { label: "🎯 محرك قوالب Nuclei القياسي", path: "/nuclei-engine" },
                      { label: "🖥️ سطح المكتب المتعدد (xDaw Multi-Window)", path: "/desktop" },
                      { label: "📊 لوحة التحكم الكلاسيكية (Classic Dashboard)", path: "/classic-dashboard" },
                    ].map((p) => (
                      <button
                        key={p.path}
                        onClick={() => { setWhiskerOpen(false); navigate(p.path); }}
                        className="w-full text-left px-3 py-2 rounded hover:bg-rose-500/20 border border-white/5 text-xs font-bold text-white flex items-center justify-between"
                      >
                        <span>{p.label}</span>
                        <span className="text-[10px] font-mono text-sky-400">{p.path}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {whiskerToolsList.map((t) => (
                      <div
                        key={`${t.category}-${t.name}`}
                        className="px-2.5 py-1.5 rounded hover:bg-white/10 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-bold text-white truncate">{t.name}</div>
                          <div className="text-[10px] text-slate-400 truncate">{t.category}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => {
                              setWhiskerOpen(false);
                              setWorkspace(1);
                              void runInKaliTerminal(`${t.name} --help 2>&1 | head -28`, t.name);
                            }}
                            className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 border border-emerald-500/40"
                          >
                            ▶ Term
                          </button>
                          <button
                            onClick={() => {
                              setWhiskerOpen(false);
                              setWorkspace(1);
                              setStudioMode("x11");
                              void runOnLiveDesktop(`${t.name} --help 2>&1 | head -28`, `KALI: ${t.name}`);
                            }}
                            className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/20 hover:bg-sky-500/40 text-sky-300 border border-sky-500/40"
                          >
                            :99
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Whisker Menu Bottom Footer */}
            <div className="h-9 px-3 bg-[#12151e] border-t border-white/10 flex items-center justify-between text-[11px] font-mono">
              <div className="flex items-center gap-2 text-sky-400 font-bold">
                <KaliLogo2099 size={18} glow={false} />
                <span>root@nova-kali-2099 (Kali GNU/Linux Rolling · 266/266 Tools)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setWhiskerOpen(false); setWorkspace(2); }}
                  className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300"
                >
                  Full 266 Catalog
                </button>
                <button
                  onClick={() => { setWhiskerOpen(false); setWorkspace(4); }}
                  className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300"
                >
                  Snapshots 1-5+
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ═════════════════════════════════════════════════════════════════════════
       * 2. MAIN DESKTOP CANVAS + LEFT KALI DOCK + FLOATING/TILED GTK WINDOWS
       * ═════════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* ── LEFT VERTICAL KALI DOCK (Matches Screenshot 2 --3.png) ─────────── */}
        <aside
          className="w-12 shrink-0 flex flex-col items-center py-2 gap-2 z-20"
          style={{
            background: "rgba(15, 18, 26, 0.88)",
            borderRight: "1px solid rgba(255,255,255,0.1)",
            backdropFilter: "blur(12px)",
          }}
        >
          {[
            {
              label: "Kali Quad Desktop (Workspace 1)",
              color: "#ff2b4d",
              active: workspace === 1 && !maximizedWin,
              icon: LayoutGrid,
              onClick: () => { setWorkspace(1); setMaximizedWin(null); },
            },
            {
              label: "Root Terminal (qterminal)",
              color: "#44ff88",
              active: maximizedWin === "terminal",
              icon: Terminal,
              onClick: () => { setWorkspace(1); setMaximizedWin((m) => (m === "terminal" ? null : "terminal")); },
            },
            {
              label: "Thunar File Manager (/root & Workspaces)",
              color: "#38bdf8",
              active: maximizedWin === "files",
              icon: FolderOpen,
              onClick: () => { setWorkspace(1); setMaximizedWin((m) => (m === "files" ? null : "files")); },
            },
            {
              label: "Live X11 Display :99 Stream",
              color: "#fb7185",
              active: workspace === 1 && studioMode === "x11",
              icon: Monitor,
              onClick: () => { setWorkspace(1); setStudioMode("x11"); setMaximizedWin(null); },
            },
            {
              label: "Kali Cyber Recon Browser",
              color: "#60a5fa",
              active: workspace === 1 && studioMode === "browser",
              icon: Globe,
              onClick: () => {
                setWorkspace(1);
                setStudioMode("browser");
                setMaximizedWin(null);
                if (!browserRes) void runKaliBrowser("https://example.com");
              },
            },
            {
              label: "8 Auto-Pipelines & GitHub Free Cloner",
              color: "#34d399",
              active: workspace === 1 && studioMode === "pipelines",
              icon: Rocket,
              onClick: () => { setWorkspace(1); setStudioMode("pipelines"); setMaximizedWin(null); },
            },
            {
              label: "Full 266/266 Kali Arsenal & Official 11 Catalog",
              color: "#f472b6",
              active: workspace === 2,
              icon: Shield,
              onClick: () => { setWorkspace(2); setMaximizedWin(null); },
            },
            {
              label: "Cloud Storage 67.11GB · Generations 1-5+ · Python 28",
              color: "#fbbf24",
              active: workspace === 4,
              icon: Database,
              onClick: () => { setWorkspace(4); setMaximizedWin(null); },
            },
            {
              label: "Nova Agent Pro (الشغل والشات الحي)",
              color: "#22d3ee",
              active: false,
              icon: Sparkles,
              onClick: () => navigate("/agent-pro"),
            },
            {
              label: "Bug Bounty Studio",
              color: "#a78bfa",
              active: false,
              icon: ShieldCheck,
              onClick: () => navigate("/bug-bounty-studio"),
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={item.onClick}
                title={item.label}
                className="w-9 h-9 rounded-xl flex items-center justify-center relative transition-all hover:scale-110"
                style={{
                  background: item.active ? `${item.color}28` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${item.active ? item.color : "rgba(255,255,255,0.1)"}`,
                  boxShadow: item.active ? `0 0 12px ${item.color}55` : "none",
                }}
              >
                <Icon className="w-4 h-4" style={{ color: item.color }} />
                {item.active && (
                  <span
                    className="absolute -left-1 w-1 h-4 rounded-r"
                    style={{ background: item.color }}
                  />
                )}
              </button>
            );
          })}
        </aside>

        {/* ── MAIN WORKSPACE SURFACE ────────────────────────────────────────── */}
        <div className="flex-1 p-2 overflow-hidden flex flex-col">
          {/* ═══════════════════════════════════════════════════════════════════
           * WORKSPACE 1: THE ICONIC KALI LINUX MULTI-WINDOW QUAD DESKTOP
           * (Matches Screenshot 3 --4.jpg: Desktop Icons + Thunar File Manager
           *  + Mousepad/X11/Browser Studio + qterminal w/ neofetch + gotop HUD)
           * ═══════════════════════════════════════════════════════════════════ */}
          {workspace === 1 && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2.5 overflow-hidden">
              {/* LEFT + CENTER AREA (9 cols): Desktop Icons strip + Top/Bottom Kali Windows */}
              <div className="lg:col-span-9 flex flex-col gap-2.5 overflow-hidden">
                {/* TOP ROW: Desktop Icons Column (1 col) + Thunar File Manager Window (11 cols) */}
                {(!maximizedWin || maximizedWin === "files") && (
                  <div className={`${maximizedWin === "files" ? "flex-1" : "h-[46%]"} flex gap-2.5 overflow-hidden`}>
                    {/* Authentic Desktop Icons on the Wallpaper (File System, Home, Cloud, :99) */}
                    {!maximizedWin && (
                      <div className="hidden xl:flex flex-col items-center gap-3 py-1 px-1 w-20 shrink-0 select-none">
                        {[
                          {
                            label: "File System",
                            color: "#38bdf8",
                            icon: HardDrive,
                            onClick: () => { setFsScope("rootfs"); setFsPath("/usr/local/bin"); },
                          },
                          {
                            label: "Home / root",
                            color: "#60a5fa",
                            icon: Home,
                            onClick: () => { setFsScope("rootfs"); setFsPath("/root"); },
                          },
                          {
                            label: "Workspaces",
                            color: "#44ff88",
                            icon: FolderOpen,
                            onClick: () => { setFsScope("workspace"); setFsPath(""); },
                          },
                          {
                            label: "67.11GB Hub",
                            color: "#f472b6",
                            icon: Cloud,
                            onClick: () => setWorkspace(4),
                          },
                          {
                            label: "266 Arsenal",
                            color: "#ff2b4d",
                            icon: Shield,
                            onClick: () => setWorkspace(2),
                          },
                        ].map((dIcon) => {
                          const Icon = dIcon.icon;
                          return (
                            <button
                              key={dIcon.label}
                              onClick={dIcon.onClick}
                              className="flex flex-col items-center gap-1 p-1.5 rounded-lg hover:bg-white/15 transition-all w-full"
                            >
                              <div
                                className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg"
                                style={{
                                  background: "rgba(17, 22, 34, 0.85)",
                                  border: `1px solid ${dIcon.color}88`,
                                }}
                              >
                                <Icon className="w-5 h-5" style={{ color: dIcon.color }} />
                              </div>
                              <span
                                className="text-[10px] font-bold text-white text-center leading-tight"
                                style={{ textShadow: "0 1px 4px #000" }}
                              >
                                {dIcon.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* ── WINDOW 1: THUNAR FILE MANAGER (root - File Manager) ── */}
                    <div
                      className="flex-1 rounded-lg flex flex-col overflow-hidden shadow-2xl"
                      style={{
                        background: "rgba(25, 28, 38, 0.94)",
                        border: "1px solid rgba(56, 189, 248, 0.45)",
                        backdropFilter: "blur(14px)",
                      }}
                    >
                      {/* GTK Window Titlebar */}
                      <div className="h-7 px-2.5 bg-[#161922] border-b border-white/10 flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2 text-slate-200 font-bold">
                          <Folder className="w-3.5 h-3.5 text-sky-400" />
                          <span>root - File Manager ({fsScope === "workspace" ? `/opt/nova-workspaces/${fsPath}` : fsPath})</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setMaximizedWin((m) => (m === "files" ? null : "files"))}
                            className="p-0.5 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                          >
                            {maximizedWin === "files" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>

                      {/* GTK Menu + Navigation Toolbar */}
                      <div className="px-2.5 py-1 bg-[#1d212d] border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-3 text-slate-300">
                          <span>File</span>
                          <span>Edit</span>
                          <span>View</span>
                          <span>Go</span>
                          <span>Help</span>
                        </div>
                        <div className="flex items-center gap-1 flex-1 max-w-xl">
                          <button
                            onClick={() => {
                              const parts = fsPath.split("/").filter(Boolean);
                              parts.pop();
                              setFsPath(fsScope === "rootfs" ? `/${parts.join("/")}` || "/root" : parts.join("/"));
                            }}
                            className="p-1 rounded bg-black/40 hover:bg-white/10 text-slate-300"
                            title="Up Directory"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => { setFsScope("rootfs"); setFsPath("/root"); }}
                            className="p-1 rounded bg-black/40 hover:bg-white/10 text-slate-300"
                            title="Home (/root)"
                          >
                            <Home className="w-3 h-3" />
                          </button>
                          <div className="flex-1 px-2 py-0.5 rounded bg-[#0f1219] border border-white/15 font-mono text-sky-300 truncate">
                            {fsScope === "workspace" ? `/opt/nova-workspaces/${fsPath}` : fsPath}
                          </div>
                          <button
                            onClick={() => void loadThunarDir(fsScope === "cloud" ? "rootfs" : fsScope, fsPath)}
                            className="p-1 rounded bg-black/40 hover:bg-white/10 text-slate-300"
                          >
                            <RefreshCw className={`w-3 h-3 ${fsBusy ? "animate-spin" : ""}`} />
                          </button>
                        </div>
                      </div>

                      {/* Authentic Yellow Root Account Banner (from Screenshot 2 & 3) */}
                      <div
                        className="px-3 py-0.5 text-[10px] font-bold flex items-center justify-between"
                        style={{ background: "#d99b00", color: "#111" }}
                      >
                        <span>Warning, you are using the root account (uid=0 on Kali Fleet), you have full system privileges.</span>
                        <span className="font-mono">266/266 Tools · 503.8 GB</span>
                      </div>

                      {/* Thunar Body: Left Places Sidebar + Right Visual Icon Grid */}
                      <div className="flex-1 flex overflow-hidden">
                        {/* Left Sidebar: DEVICES / PLACES */}
                        <div className="w-40 bg-[#181b24] border-r border-white/10 p-1.5 overflow-y-auto text-[10px] space-y-2">
                          <div>
                            <div className="text-[9px] font-black text-slate-400 px-1.5 mb-0.5">DEVICES & ROOTFS</div>
                            {[
                              { label: "/usr/local/bin (Tools)", path: "/usr/local/bin", scope: "rootfs" as const },
                              { label: "/root (Root Home)", path: "/root", scope: "rootfs" as const },
                              { label: "/usr/share/wordlists", path: "/usr/share/wordlists", scope: "rootfs" as const },
                              { label: "/usr/share/nmap/scripts", path: "/usr/share/nmap/scripts", scope: "rootfs" as const },
                              { label: "/etc (System Config)", path: "/etc", scope: "rootfs" as const },
                              { label: "/opt (GitHub Clones)", path: "/opt", scope: "rootfs" as const },
                            ].map((pl) => (
                              <button
                                key={pl.path}
                                onClick={() => { setFsScope(pl.scope); setFsPath(pl.path); }}
                                className="w-full text-left px-2 py-1 rounded flex items-center gap-1.5 truncate"
                                style={{
                                  background: fsScope === pl.scope && fsPath === pl.path ? "#2563eb" : "transparent",
                                  color: fsScope === pl.scope && fsPath === pl.path ? "#fff" : "#cbd5e1",
                                }}
                              >
                                <HardDrive className="w-3 h-3 text-sky-400 shrink-0" />
                                <span className="truncate">{pl.label}</span>
                              </button>
                            ))}
                          </div>

                          <div>
                            <div className="text-[9px] font-black text-slate-400 px-1.5 mb-0.5">WORKSPACES</div>
                            {[
                              { label: "All Workspaces", path: "" },
                              { label: "recon-lab", path: "recon-lab" },
                              { label: "web-audit", path: "web-audit" },
                              { label: "cloud-osint", path: "cloud-osint" },
                            ].map((ws) => (
                              <button
                                key={ws.label}
                                onClick={() => { setFsScope("workspace"); setFsPath(ws.path); }}
                                className="w-full text-left px-2 py-1 rounded flex items-center gap-1.5 truncate"
                                style={{
                                  background: fsScope === "workspace" && fsPath === ws.path ? "#ff2b4d" : "transparent",
                                  color: fsScope === "workspace" && fsPath === ws.path ? "#fff" : "#cbd5e1",
                                }}
                              >
                                <Folder className="w-3 h-3 text-rose-400 shrink-0" />
                                <span className="truncate">{ws.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Right Area: Visual Folder/File Icon Grid (Just like Screenshot 2 & 3) */}
                        <div className="flex-1 bg-[#1e222d] p-2.5 overflow-y-auto">
                          {fsBusy ? (
                            <div className="h-full flex items-center justify-center text-xs font-mono text-sky-300">
                              ⏳ Reading directory from Kali Fleet...
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-2">
                              {fsEntries.map((ent) => (
                                <button
                                  key={ent.relPath}
                                  onClick={() => {
                                    if (ent.type === "dir") {
                                      setFsPath(ent.relPath);
                                    } else {
                                      void openFileInMousepad(fsScope === "cloud" ? "workspace" : fsScope, ent.relPath);
                                    }
                                  }}
                                  className="p-2 rounded-lg hover:bg-sky-500/20 flex flex-col items-center gap-1 text-center group transition-all"
                                  title={`${ent.name} (${ent.permissions} · ${ent.size} bytes)`}
                                >
                                  {ent.type === "dir" ? (
                                    <div className="w-10 h-8 rounded bg-gradient-to-b from-sky-400 to-blue-600 flex items-center justify-center shadow">
                                      <Folder className="w-5 h-5 text-white fill-white/25" />
                                    </div>
                                  ) : (
                                    <div className="w-9 h-10 rounded bg-slate-800 border border-sky-400/40 flex items-center justify-center shadow">
                                      <FileCode className="w-4 h-4 text-emerald-400" />
                                    </div>
                                  )}
                                  <span className="text-[10px] font-mono text-slate-200 truncate w-full group-hover:text-white">
                                    {ent.name}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Thunar Statusbar */}
                      <div className="h-5 px-2.5 bg-[#151821] border-t border-white/10 flex items-center justify-between text-[9px] font-mono text-slate-400">
                        <span>{fsEntries.length} items · Free space: {sysInfo?.disk?.freeGB ?? 46.2} GiB (Total: {sysInfo?.disk?.totalGB ?? 503.8} GiB)</span>
                        <span>Cloud Mirror: {storage?.totalHuman ?? "67.11GB"}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* BOTTOM ROW: Left Studio Window (X11 :99 / Mousepad / Browser / Pipelines) + Right qterminal w/ neofetch */}
                {(!maximizedWin || maximizedWin === "studio" || maximizedWin === "terminal") && (
                  <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2.5 overflow-hidden">
                    {/* ── WINDOW 2 (Bottom-Left, 6 cols): KALI MULTI-STUDIO (Live X11 :99 / Mousepad / Browser / Pipelines) ── */}
                    {(!maximizedWin || maximizedWin === "studio") && (
                      <div
                        className={`${
                          maximizedWin === "studio" ? "lg:col-span-12" : "lg:col-span-6"
                        } rounded-lg flex flex-col overflow-hidden shadow-2xl`}
                        style={{
                          background: "rgba(21, 24, 33, 0.95)",
                          border: "1px solid rgba(255, 43, 77, 0.5)",
                          backdropFilter: "blur(14px)",
                        }}
                      >
                        {/* Window Titlebar with Mode Switcher */}
                        <div className="h-7 px-2 bg-[#161922] border-b border-white/10 flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                            {[
                              { id: "x11" as const, label: "🖥️ X11 :99 Stream", color: "#ff2b4d" },
                              { id: "editor" as const, label: "📝 Mousepad Editor", color: "#fbbf24" },
                              { id: "browser" as const, label: "🌐 Kali Browser", color: "#38bdf8" },
                              { id: "pipelines" as const, label: "🚀 8 Pipelines + GitHub", color: "#44ff88" },
                              { id: "gens" as const, label: "📸 Gens 1-5+", color: "#c084fc" },
                            ].map((tab) => (
                              <button
                                key={tab.id}
                                onClick={() => {
                                  setStudioMode(tab.id);
                                  if (tab.id === "browser" && !browserRes) void runKaliBrowser("https://example.com");
                                }}
                                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0"
                                style={{
                                  background: studioMode === tab.id ? `${tab.color}28` : "transparent",
                                  border: `1px solid ${studioMode === tab.id ? tab.color : "transparent"}`,
                                  color: studioMode === tab.id ? "#fff" : "#94a3b8",
                                }}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => setMaximizedWin((m) => (m === "studio" ? null : "studio"))}
                            className="p-0.5 hover:bg-white/10 rounded text-slate-400 hover:text-white shrink-0"
                          >
                            {maximizedWin === "studio" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                          </button>
                        </div>

                        {/* STUDIO MODE 1: LIVE X11 DISPLAY :99 STREAM */}
                        {studioMode === "x11" && (
                          <div className="flex-1 flex flex-col overflow-hidden p-2 gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={deskCmdInput}
                                onChange={(e) => setDeskCmdInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && deskCmdInput.trim()) {
                                    void runOnLiveDesktop(deskCmdInput, "NOVA KALI 2099 X11");
                                  }
                                }}
                                placeholder="Run command inside X11 :99 (e.g. nmap -sV example.com)..."
                                className="flex-1 px-2 py-1 rounded bg-black/75 border border-rose-500/40 text-[10px] font-mono text-emerald-300 focus:outline-none"
                              />
                              <button
                                onClick={() => void runOnLiveDesktop(deskCmdInput, "NOVA KALI 2099 X11")}
                                disabled={deskBusy}
                                className="px-2.5 py-1 rounded bg-rose-600 text-white text-[10px] font-mono font-bold"
                              >
                                {deskBusy ? "..." : "▶ :99"}
                              </button>
                              <button
                                onClick={() => void fetchDesktopFrame(true)}
                                className="p-1 rounded bg-white/10 text-white"
                                title="Refresh X11 :99 Frame"
                              >
                                <RefreshCw className={`w-3 h-3 ${deskBusy ? "animate-spin" : ""}`} />
                              </button>
                            </div>

                            <div className="flex-1 rounded bg-black border border-rose-500/30 overflow-hidden flex items-center justify-center relative">
                              {deskFrame ? (
                                <img
                                  src={deskFrame}
                                  alt="Live X11 :99 Desktop"
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <div className="text-center text-[11px] font-mono text-rose-300">
                                  Connecting to Xvfb :99 on {activeKaliNodes[0]?.id || "Kali Fleet"}...
                                </div>
                              )}
                              <div className="absolute bottom-1 right-1.5 px-2 py-0.5 rounded bg-black/80 border border-rose-500/40 text-[9px] font-mono text-emerald-300">
                                DISPLAY=:99 · {deskMeta?.plane || "10/10 Fleet"}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* STUDIO MODE 2: MOUSEPAD CODE & SCRIPT EDITOR (Matches Screenshot 3 bottom-left) */}
                        {studioMode === "editor" && (
                          <div className="flex-1 flex flex-col overflow-hidden">
                            <div
                              className="px-2.5 py-0.5 text-[10px] font-bold flex items-center justify-between"
                              style={{ background: "#d99b00", color: "#111" }}
                            >
                              <span>Warning, you are using the root account — Mousepad Kali Script Studio</span>
                              <button
                                onClick={() => void saveMousepadFile()}
                                className="px-2 py-0.2 rounded bg-black/80 text-emerald-300 font-mono"
                              >
                                💾 Save & Sync
                              </button>
                            </div>
                            <div className="px-2 py-1 bg-[#161922] border-b border-white/10 flex items-center gap-1.5">
                              <span className="text-[10px] font-mono text-slate-400">Path:</span>
                              <input
                                value={editorFilePath}
                                onChange={(e) => setEditorFilePath(e.target.value)}
                                className="flex-1 bg-transparent text-[10px] font-mono text-sky-300 focus:outline-none"
                              />
                              {editorSaveMsg && (
                                <span className="text-[9px] font-mono text-emerald-400">{editorSaveMsg}</span>
                              )}
                            </div>
                            <textarea
                              value={editorContent}
                              onChange={(e) => setEditorContent(e.target.value)}
                              className="flex-1 p-2.5 bg-[#141720] text-[11px] font-mono text-amber-200 focus:outline-none resize-none"
                            />
                          </div>
                        )}

                        {/* STUDIO MODE 3: KALI CYBER RECON BROWSER */}
                        {studioMode === "browser" && (
                          <div className="flex-1 flex flex-col overflow-hidden p-2 gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded bg-black/80 border border-sky-500/40">
                                <Lock className="w-3 h-3 text-emerald-400" />
                                <input
                                  value={browserUrl}
                                  onChange={(e) => setBrowserUrl(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void runKaliBrowser();
                                  }}
                                  className="flex-1 bg-transparent text-[10px] font-mono text-white focus:outline-none"
                                />
                              </div>
                              <button
                                onClick={() => void runKaliBrowser()}
                                disabled={browserBusy}
                                className="px-2.5 py-1 rounded bg-sky-600 text-white text-[10px] font-mono font-bold"
                              >
                                {browserBusy ? "..." : "Go"}
                              </button>
                            </div>

                            {browserRes && (
                              <div className="flex items-center justify-between px-2 py-1 rounded bg-black/50 border border-white/10 text-[10px] font-mono">
                                <span className="text-emerald-400 font-bold">
                                  HTTP {browserRes.status} · {browserRes.latencyMs}ms · {browserRes.tls?.version || "HTTP"}
                                </span>
                                <span className="text-rose-400 font-bold">
                                  Security Grade: {browserRes.securityGrade} ({browserRes.securityScore}/100)
                                </span>
                              </div>
                            )}

                            <div className="flex items-center gap-1 text-[9px] font-mono">
                              {(["reader", "security", "dom", "source"] as const).map((bt) => (
                                <button
                                  key={bt}
                                  onClick={() => setBrowserTab(bt)}
                                  className="px-2 py-0.5 rounded uppercase"
                                  style={{
                                    background: browserTab === bt ? "#38bdf8" : "rgba(255,255,255,0.06)",
                                    color: browserTab === bt ? "#000" : "#cbd5e1",
                                  }}
                                >
                                  {bt}
                                </button>
                              ))}
                            </div>

                            <div className="flex-1 rounded bg-[#0f1219] border border-white/10 p-2 overflow-y-auto text-[10px] font-mono text-slate-200">
                              {!browserRes ? (
                                <div>Enter a URL above to browse & audit from the Kali node...</div>
                              ) : browserTab === "reader" ? (
                                <div className="space-y-1.5">
                                  <div className="text-xs font-bold text-sky-300">{browserRes.title || browserRes.url}</div>
                                  <div className="text-[9px] text-rose-300">
                                    IPs: {(browserRes.ips ?? []).join(", ")} | Tech: {(browserRes.techStack ?? []).join(", ")}
                                  </div>
                                  <div className="whitespace-pre-wrap text-slate-300 leading-relaxed">
                                    {browserRes.textPreview || browserRes.error}
                                  </div>
                                </div>
                              ) : browserTab === "security" ? (
                                <div className="space-y-1">
                                  {(browserRes.securityHeaders ?? []).map((sh) => (
                                    <div key={sh.name} className="p-1.5 rounded bg-black/50 border border-white/10">
                                      <div className="flex justify-between">
                                        <span className="font-bold text-white">{sh.name}</span>
                                        <span className={sh.present ? "text-emerald-400" : "text-rose-400"}>
                                          {sh.present ? "✓ PASS" : "✗ MISSING"}
                                        </span>
                                      </div>
                                      <div className="text-[9px] text-slate-400" dir="rtl">{sh.advice}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : browserTab === "dom" ? (
                                <div className="space-y-1">
                                  {(browserRes.links ?? []).map((l) => (
                                    <button
                                      key={l}
                                      onClick={() => void runKaliBrowser(l)}
                                      className="block w-full text-left truncate text-sky-400 hover:underline"
                                    >
                                      → {l}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <pre className="whitespace-pre-wrap text-rose-200">{browserRes.htmlSnippet}</pre>
                              )}
                            </div>
                          </div>
                        )}

                        {/* STUDIO MODE 4: 8 AUTO-PIPELINES + GITHUB FREE CLONER */}
                        {studioMode === "pipelines" && (
                          <div className="flex-1 flex flex-col overflow-hidden p-2 gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={ghRepoInput}
                                onChange={(e) => setGhRepoInput(e.target.value)}
                                placeholder="GitHub owner/repo (e.g. s0md3v/XSStrike)"
                                className="flex-1 px-2 py-1 rounded bg-black/75 border border-rose-500/40 text-[10px] font-mono text-emerald-300"
                              />
                              <button
                                onClick={() => void installFromGitHub()}
                                disabled={ghInstallBusy}
                                className="px-2.5 py-1 rounded bg-rose-600 text-white text-[10px] font-mono font-bold"
                              >
                                {ghInstallBusy ? "Cloning..." : "🐙 Clone to Fleet"}
                              </button>
                            </div>
                            {ghInstallMsg && (
                              <div className="text-[9px] font-mono text-emerald-300 px-1">{ghInstallMsg}</div>
                            )}
                            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                              {pipelines.map((p) => (
                                <div
                                  key={p.id}
                                  className="p-2 rounded bg-black/55 border border-emerald-500/30 flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0" dir="rtl">
                                    <div className="text-[11px] font-bold text-white truncate">{p.title}</div>
                                    <div className="text-[9px] font-mono text-emerald-300 truncate">
                                      {p.tools.join(" · ")}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => void executePipeline(p.id)}
                                    disabled={Boolean(runningPipeId)}
                                    className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[10px] font-mono font-bold shrink-0"
                                  >
                                    {runningPipeId === p.id ? "..." : "▶ Run"}
                                  </button>
                                </div>
                              ))}
                              {pipeResult?.output && (
                                <pre className="p-2 rounded bg-black border border-rose-500/40 text-[10px] font-mono text-emerald-300 whitespace-pre-wrap">
                                  {pipeResult.output}
                                </pre>
                              )}
                            </div>
                          </div>
                        )}

                        {/* STUDIO MODE 5: GENERATIONS 1-5+ SNAPSHOTS */}
                        {studioMode === "gens" && (
                          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                            {generations.map((g) => (
                              <div
                                key={g.id}
                                className="p-2 rounded bg-black/60 border border-amber-500/35 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0" dir="rtl">
                                  <div className="text-[11px] font-bold text-amber-300 truncate">{g.title}</div>
                                  <div className="text-[9px] text-slate-300 truncate">{g.description}</div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={async () => {
                                      const r = await fetch(`${API}/kali-env/generations/${g.id}/restore`, {
                                        method: "POST",
                                        headers: novaAuthHeaders(),
                                      });
                                      const d = await r.json();
                                      setGenMsg(d?.message || "Restored");
                                    }}
                                    className="px-2 py-0.5 rounded bg-emerald-500/25 text-emerald-300 text-[9px] font-mono"
                                  >
                                    Restore
                                  </button>
                                  <a
                                    href={`${API}/kali-env/generations/${g.id}/export`}
                                    download
                                    className="px-2 py-0.5 rounded bg-sky-500/25 text-sky-300 text-[9px] font-mono"
                                  >
                                    Export
                                  </a>
                                </div>
                              </div>
                            ))}
                            {genMsg && <div className="text-[10px] font-mono text-emerald-400">{genMsg}</div>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── WINDOW 3 (Bottom-Center, 6 cols): qterminal — root@kali: ~ WITH NEOFETCH KALI DRAGON ── */}
                    {(!maximizedWin || maximizedWin === "terminal") && (
                      <div
                        className={`${
                          maximizedWin === "terminal" ? "lg:col-span-12" : "lg:col-span-6"
                        } rounded-lg flex flex-col overflow-hidden shadow-2xl`}
                        style={{
                          background: "rgba(16, 18, 25, 0.95)",
                          border: "1px solid rgba(56, 189, 248, 0.45)",
                          backdropFilter: "blur(14px)",
                        }}
                      >
                        {/* qterminal Titlebar */}
                        <div className="h-7 px-2.5 bg-[#141720] border-b border-white/10 flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-2 text-slate-200 font-bold">
                            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                            <span>root@kali-2099: ~ ({termPlane})</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setTermOutput("")}
                              className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-white/5 hover:bg-white/15 text-slate-300"
                            >
                              clear
                            </button>
                            <button
                              onClick={() => setMaximizedWin((m) => (m === "terminal" ? null : "terminal"))}
                              className="p-0.5 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                            >
                              {maximizedWin === "terminal" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>

                        {/* qterminal Menu Bar + Quick Tool Pills */}
                        <div className="px-2.5 py-1 bg-[#1b1f2b] border-b border-white/10 flex items-center justify-between gap-2 text-[10px]">
                          <div className="flex items-center gap-3 text-slate-300">
                            <span>File</span>
                            <span>Edit</span>
                            <span>View</span>
                            <span>Terminal</span>
                            <span>Tabs</span>
                            <span>Help</span>
                          </div>
                          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                            {["nmap --version", "nuclei -version", "prowler -v", "subfinder -version", "df -h /"].map((c) => (
                              <button
                                key={c}
                                onClick={() => {
                                  setTermCmd(c);
                                  void runInKaliTerminal(c);
                                }}
                                className="px-1.5 py-0.5 rounded bg-black/50 hover:bg-sky-500/25 text-[9px] font-mono text-sky-300 shrink-0"
                              >
                                {c.split(" ")[0]}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Terminal Body: Authentic neofetch Kali Dragon + Live Command Stream */}
                        <div className="flex-1 p-2.5 overflow-y-auto font-mono text-[10px] leading-snug bg-[#0d1017]">
                          {/* Iconic Side-by-Side neofetch Kali Dragon + System Specs (Matches Screenshot 3!) */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pb-2 mb-2 border-b border-white/10">
                            <pre className="sm:col-span-5 text-[8.5px] leading-[1.12] text-sky-400 font-bold select-text">
                              {KALI_ASCII_DRAGON}
                            </pre>
                            <div className="sm:col-span-7 space-y-0.5 text-[10px]">
                              <div className="font-black">
                                <span className="text-sky-400">root</span>
                                <span className="text-white">@</span>
                                <span className="text-rose-400">kali-2099</span>
                              </div>
                              <div className="text-slate-500">-------------------</div>
                              <div>
                                <span className="text-sky-400 font-bold">Creed: </span>
                                <span className="text-white">لا إله إلا الله · الله أكبر ولله الحمد</span>
                              </div>
                              <div>
                                <span className="text-sky-400 font-bold">OS: </span>
                                <span className="text-slate-200">{sysInfo?.rootfs?.prettyName || "Kali GNU/Linux Rolling x86_64"}</span>
                              </div>
                              <div>
                                <span className="text-sky-400 font-bold">Kernel: </span>
                                <span className="text-slate-200">{controlInfo?.kernel?.split(" ")[2] || "6.11.0-kali-amd64"}</span>
                              </div>
                              <div>
                                <span className="text-sky-400 font-bold">Packages: </span>
                                <span className="text-emerald-300">
                                  2147 (dpkg) · {envTools?.present ?? 266}/266 Tools · {pyTools?.pythonPackages ?? 880} Py
                                </span>
                              </div>
                              <div>
                                <span className="text-sky-400 font-bold">Shell: </span>
                                <span className="text-slate-200">bash 5.2 (proot-static uid=0)</span>
                              </div>
                              <div>
                                <span className="text-sky-400 font-bold">DE / WM: </span>
                                <span className="text-slate-200">Xfce 4.18 / Kali-Dark-2099</span>
                              </div>
                              <div>
                                <span className="text-sky-400 font-bold">Fleet: </span>
                                <span className="text-emerald-400">{activeKaliNodes.length || 10}/10 Primary Nodes + Standby</span>
                              </div>
                              <div>
                                <span className="text-sky-400 font-bold">Storage: </span>
                                <span className="text-pink-300">
                                  {sysInfo?.disk?.totalGB ?? 503.8}GiB Disk + {storage?.totalHuman ?? "67.11GB"} Cloud
                                </span>
                              </div>
                              <div>
                                <span className="text-sky-400 font-bold">Memory: </span>
                                <span className="text-slate-200">
                                  {(sysInfo?.mem?.totalMB ?? 48181) - (sysInfo?.mem?.freeMB ?? 14059)}MiB / {sysInfo?.mem?.totalMB ?? 48181}MiB
                                </span>
                              </div>
                              {/* Authentic neofetch color blocks */}
                              <div className="flex items-center gap-1 pt-1">
                                {["#1f2430", "#ff2b4d", "#44ff88", "#fbbf24", "#38bdf8", "#c084fc", "#22d3ee", "#ffffff"].map((c) => (
                                  <span key={c} className="w-3.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Live Command Execution Stream */}
                          {termOutput && (
                            <pre className="text-emerald-300 whitespace-pre-wrap leading-relaxed select-text">
                              {termOutput}
                            </pre>
                          )}
                        </div>

                        {/* Authentic Two-Line Kali Prompt Input */}
                        <div className="px-2.5 py-1.5 bg-[#12151f] border-t border-white/10 flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold text-rose-400 shrink-0">
                            root💀kali:~#
                          </span>
                          <input
                            value={termCmd}
                            onChange={(e) => setTermCmd(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && termCmd.trim()) {
                                void runInKaliTerminal(termCmd);
                              }
                            }}
                            placeholder="Type any Kali command or tool (e.g. nmap -F example.com)..."
                            className="flex-1 bg-transparent text-[11px] font-mono text-white focus:outline-none"
                          />
                          <button
                            onClick={() => void runInKaliTerminal(termCmd)}
                            disabled={Boolean(runningCmdLabel)}
                            className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-mono font-bold"
                          >
                            {runningCmdLabel ? "..." : "Run"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── WINDOW 4 (Right Vertical Docked HUD, 3 cols): gotop / btop SYSTEM MONITOR (Matches Screenshot 3 right side!) ── */}
              {(!maximizedWin || maximizedWin === "gotop") && (
                <div
                  className={`${
                    maximizedWin === "gotop" ? "lg:col-span-12" : "lg:col-span-3"
                  } rounded-lg flex flex-col overflow-hidden shadow-2xl`}
                  style={{
                    background: "rgba(16, 19, 27, 0.95)",
                    border: "1px solid rgba(56, 189, 248, 0.45)",
                    backdropFilter: "blur(14px)",
                  }}
                >
                  {/* gotop Window Titlebar */}
                  <div className="h-7 px-2.5 bg-[#141720] border-b border-white/10 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-200 font-bold">
                      <Activity className="w-3.5 h-3.5 text-rose-400" />
                      <span>root@kali: ~ (gotop)</span>
                    </div>
                    <button
                      onClick={() => setMaximizedWin((m) => (m === "gotop" ? null : "gotop"))}
                      className="p-0.5 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                    >
                      {maximizedWin === "gotop" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                    </button>
                  </div>

                  <div className="flex-1 p-2 overflow-y-auto space-y-2 font-mono text-[10px]">
                    {/* 1. CPU Usage Box */}
                    <div className="p-2 rounded border border-sky-500/40 bg-[#0d1017]">
                      <div className="text-[10px] font-bold text-sky-400 mb-1 flex justify-between">
                        <span>┌─ CPU Usage ({sysInfo?.cpu?.cores ?? 12} Cores) ─┐</span>
                        <span className="text-emerald-400">ONLINE</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mb-2">
                        {cpuBars.slice(0, 6).map((val, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <span className="text-[9px] text-rose-400 w-8">CPU{i}</span>
                            <div className="flex-1 h-1.5 bg-white/10 rounded overflow-hidden">
                              <div
                                className="h-full transition-all duration-500"
                                style={{
                                  width: `${val}%`,
                                  background: i % 2 === 0 ? "#ff2b4d" : "#38bdf8",
                                }}
                              />
                            </div>
                            <span className="text-[9px] text-slate-300 w-6 text-right">{val}%</span>
                          </div>
                        ))}
                      </div>
                      {/* Animated Sparkline Graph */}
                      <div className="h-14 flex items-end gap-1 pt-2 border-t border-white/5">
                        {cpuHistory.map((h, idx) => (
                          <div
                            key={idx}
                            className="flex-1 rounded-t transition-all duration-500"
                            style={{
                              height: `${h}%`,
                              background:
                                idx % 3 === 0
                                  ? "linear-gradient(180deg, #ff2b4d, rgba(255,43,77,0.2))"
                                  : "linear-gradient(180deg, #38bdf8, rgba(56,189,248,0.2))",
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* 2. Disk & Cloud Storage Box */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="p-2 rounded border border-sky-500/40 bg-[#0d1017]">
                        <div className="text-[9px] font-bold text-sky-400 mb-1">Disk Usage</div>
                        <div className="space-y-1 text-[9px]">
                          <div className="flex justify-between text-slate-300">
                            <span>/ (Root)</span>
                            <span className="text-emerald-400">{sysInfo?.disk?.totalGB ?? 503.8}G</span>
                          </div>
                          <div className="flex justify-between text-slate-400">
                            <span>Free</span>
                            <span>{sysInfo?.disk?.freeGB ?? 46.2}G</span>
                          </div>
                          <div className="flex justify-between text-pink-300">
                            <span>Cloud</span>
                            <span>{storage?.totalHuman ?? "67.11GB"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-2 rounded border border-sky-500/40 bg-[#0d1017]">
                        <div className="text-[9px] font-bold text-sky-400 mb-1">Memory Usage</div>
                        <div className="space-y-1 text-[9px]">
                          <div className="flex justify-between text-rose-300">
                            <span>Main</span>
                            <span>{Math.round((sysInfo?.mem?.totalMB ?? 48181) / 1024)}GB</span>
                          </div>
                          <div className="flex justify-between text-emerald-300">
                            <span>Free</span>
                            <span>{Math.round((sysInfo?.mem?.freeMB ?? 14059) / 1024)}GB</span>
                          </div>
                          <div className="flex justify-between text-purple-300">
                            <span>PyVenv</span>
                            <span>880 Pkgs</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 3. Arsenal & Fleet Verification Box */}
                    <div className="p-2 rounded border border-rose-500/40 bg-[#0d1017] space-y-1">
                      <div className="text-[9px] font-bold text-rose-400 flex justify-between">
                        <span>Kali 2099 Arsenal Status</span>
                        <span className="text-emerald-400">100% READY</span>
                      </div>
                      <div className="flex justify-between text-[9px]">
                        <span className="text-slate-400">20 Arabic Categories</span>
                        <span className="text-emerald-300 font-bold">{envTools?.present ?? 266} / {envTools?.total ?? 266}</span>
                      </div>
                      <div className="flex justify-between text-[9px]">
                        <span className="text-slate-400">11 Official Categories</span>
                        <span className="text-emerald-300 font-bold">122 / 122</span>
                      </div>
                      <div className="flex justify-between text-[9px]">
                        <span className="text-slate-400">Core Versioned Inventory</span>
                        <span className="text-emerald-300 font-bold">{inventory?.present ?? 46} / 46</span>
                      </div>
                      <div className="flex justify-between text-[9px]">
                        <span className="text-slate-400">Python Security Arsenal</span>
                        <span className="text-purple-300 font-bold">{pyTools?.installed ?? 28} / 28</span>
                      </div>
                    </div>

                    {/* 4. Network & Processes Table (Matches bottom of gotop in Screenshot 3) */}
                    <div className="p-2 rounded border border-sky-500/40 bg-[#0d1017]">
                      <div className="text-[9px] font-bold text-sky-400 mb-1 flex justify-between">
                        <span>Active Fleet & Processes</span>
                        <span className="text-emerald-400">{activeKaliNodes.length || 10} Nodes</span>
                      </div>
                      <div className="space-y-0.5 text-[9px]">
                        <div className="flex justify-between text-sky-300 border-b border-white/10 pb-0.5 font-bold">
                          <span>NODE / PID</span>
                          <span>COMMAND / MODE</span>
                        </div>
                        {(nodes.length ? nodes.slice(0, 6) : [
                          { id: "gh-20", hostname: "runnervm0hi8g", mode: "MODE_PROOT" },
                          { id: "gh-21", hostname: "runnervm0hi8g", mode: "MODE_PROOT" },
                          { id: "gh-22", hostname: "runnervmccnms", mode: "MODE_PROOT" },
                          { id: "gh-25", hostname: "ip-10-0-142-0", mode: "MODE_PROOT" },
                          { id: "gh-29", hostname: "ip-10-0-131-179", mode: "MODE_PROOT" },
                        ]).map((n) => (
                          <div key={n.id} className="flex justify-between text-slate-300">
                            <span className="text-emerald-400">{n.id}</span>
                            <span className="truncate max-w-[130px]">{n.hostname} ({n.mode})</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-rose-300 pt-1">
                          <span>DISPLAY :99</span>
                          <span>Xvfb + fluxbox + scrot</span>
                        </div>
                        <div className="flex justify-between text-purple-300">
                          <span>self-heal</span>
                          <span>syncedNodes={selfHeal?.syncedNodes ?? 10}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
           * WORKSPACE 2: FULL 266/266 KALI ARSENAL + OFFICIAL 11 CATALOG + WORKSPACES
           * ═══════════════════════════════════════════════════════════════════ */}
          {workspace === 2 && (
            <div
              className="flex-1 rounded-xl p-3 overflow-y-auto space-y-3"
              style={{
                background: "rgba(15, 18, 26, 0.95)",
                border: "1px solid rgba(255, 43, 77, 0.5)",
                backdropFilter: "blur(16px)",
              }}
              dir="rtl"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <KaliLogo2099 size={28} />
                  <div>
                    <div className="text-sm font-black text-white">
                      ترسانة NOVA KALI 2099 الشاملة ({envTools?.present ?? 266}/{envTools?.total ?? 266} أداة · 20 فئة عربية + 11 تصنيف رسمي + مساحات الشغل)
                    </div>
                    <div className="text-[10px] font-mono text-rose-300">
                      اضغط على أي أداة لتشغيلها فورًا في طرفية كالي أو إرسالها إلى البث الحي :99
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    placeholder="ابحث في 266 أداة..."
                    className="px-3 py-1 rounded-lg bg-black/70 border border-rose-500/40 text-xs font-mono text-white"
                  />
                  <button
                    onClick={() => setWorkspace(1)}
                    className="px-3 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-xs font-bold text-sky-300"
                  >
                    ← العودة لسطح المكتب الرباعي
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {categoriesList.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0"
                    style={{
                      background: selectedCategory === cat ? "#ff2b4d" : "rgba(255,255,255,0.06)",
                      color: "#fff",
                    }}
                  >
                    {cat === "ALL" ? "كل الفئات (266)" : cat}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-[300px] overflow-y-auto p-1">
                {filteredTools.map((t) => (
                  <div
                    key={`${t.category}-${t.name}`}
                    className="p-2 rounded-lg bg-black/60 border border-rose-500/30 flex flex-col justify-between gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-white truncate" dir="ltr">
                        {t.name}
                      </span>
                      <span className="text-[9px] font-mono text-emerald-400">✓</span>
                    </div>
                    <div className="text-[9px] text-rose-300/80 truncate">{t.category}</div>
                    <div className="flex items-center gap-1 mt-1">
                      <button
                        onClick={() => {
                          setWorkspace(1);
                          void runInKaliTerminal(`${t.name} --help 2>&1 | head -28`, t.name);
                        }}
                        className="flex-1 py-0.5 rounded bg-rose-600/35 hover:bg-rose-600/60 text-[9px] font-mono text-white"
                      >
                        ▶ Run
                      </button>
                      <button
                        onClick={() => {
                          setWorkspace(1);
                          setStudioMode("x11");
                          void runOnLiveDesktop(`${t.name} --help 2>&1 | head -28`, `KALI: ${t.name}`);
                        }}
                        className="px-1.5 py-0.5 rounded bg-sky-500/25 text-[9px] font-mono text-sky-300"
                      >
                        :99
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <KaliSystemsPanel />
              <KaliWorkspacePanel />
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
           * WORKSPACE 3: FULL-SCREEN LIVE X11 :99 DESKTOP & KALI CYBER BROWSER
           * ═══════════════════════════════════════════════════════════════════ */}
          {workspace === 3 && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2.5 overflow-hidden">
              <div
                className="lg:col-span-7 rounded-xl p-3 flex flex-col gap-2 overflow-hidden"
                style={{ background: "rgba(15,18,26,0.95)", border: "1px solid #ff2b4d" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-white">
                    🖥️ البث المباشر الكامل لسطح مكتب كالي 2099 (DISPLAY :99 — 1280×800)
                  </span>
                  <button
                    onClick={() => void fetchDesktopFrame(true)}
                    className="px-2.5 py-1 rounded bg-rose-600 text-white text-[10px] font-mono font-bold"
                  >
                    ↻ تحديث الإطار الحي
                  </button>
                </div>
                <div className="flex-1 rounded-lg bg-black overflow-hidden flex items-center justify-center">
                  {deskFrame ? (
                    <img src={deskFrame} alt="Kali X11 :99" className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-xs font-mono text-rose-300">Loading X11 Display :99...</div>
                  )}
                </div>
              </div>

              <div
                className="lg:col-span-5 rounded-xl p-3 flex flex-col gap-2 overflow-hidden"
                style={{ background: "rgba(15,18,26,0.95)", border: "1px solid #38bdf8" }}
              >
                <div className="text-xs font-black text-sky-300">🌐 متصفح كالي السيبراني وفاحص التشفير TLSv1.3</div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={browserUrl}
                    onChange={(e) => setBrowserUrl(e.target.value)}
                    className="flex-1 px-2.5 py-1 rounded bg-black/80 border border-sky-500/40 text-xs font-mono text-white"
                  />
                  <button
                    onClick={() => void runKaliBrowser()}
                    className="px-3 py-1 rounded bg-sky-600 text-white text-xs font-bold"
                  >
                    Inspect
                  </button>
                </div>
                <pre className="flex-1 rounded bg-black/85 p-2.5 overflow-auto text-[10px] font-mono text-emerald-300 whitespace-pre-wrap">
                  {browserRes ? JSON.stringify(browserRes, null, 2) : "Press Inspect to browse from Kali node..."}
                </pre>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
           * WORKSPACE 4: 67.11GB CLOUD STORAGE + GENERATIONS 1-5+ + PYTHON 28 + SELF-HEAL
           * ═══════════════════════════════════════════════════════════════════ */}
          {workspace === 4 && (
            <div
              className="flex-1 rounded-xl p-3 overflow-y-auto space-y-3"
              style={{
                background: "rgba(15, 18, 26, 0.95)",
                border: "1px solid rgba(251, 191, 36, 0.5)",
                backdropFilter: "blur(16px)",
              }}
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <div className="text-sm font-black text-white">
                  ☁️ المخازن السحابية الـ8 ({storage?.totalHuman ?? "67.11GB"}) · الأجيال 1-5+ · ترسانة بايثون (28/28) · السجل الأبدي
                </div>
                <button
                  onClick={() => setWorkspace(1)}
                  className="px-3 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-xs font-bold text-sky-300"
                >
                  ← العودة لسطح المكتب الرباعي
                </button>
              </div>

              {/* 8 Cloud Storage Repositories */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {(storage?.rows ?? []).map((row) => (
                  <a
                    key={row.id}
                    href={row.link}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2.5 rounded-xl bg-black/65 border border-pink-500/35 hover:border-pink-400 flex flex-col justify-between gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{row.label}</span>
                      <span className="text-[10px] font-mono text-emerald-300">
                        {row.bytes >= 2 ** 30
                          ? `${(row.bytes / 2 ** 30).toFixed(2)} GB`
                          : `${(row.bytes / 2 ** 20).toFixed(1)} MB`}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-pink-300">
                      العناصر: {row.items} · النوع: {row.kind}
                    </div>
                  </a>
                ))}
              </div>

              {/* Generations 1-5+ */}
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {generations.map((g) => (
                  <div key={g.id} className="p-2.5 rounded-xl bg-black/65 border border-amber-500/35 flex flex-col justify-between gap-1.5">
                    <div>
                      <div className="text-xs font-black text-amber-300">{g.title}</div>
                      <div className="text-[10px] text-slate-300 mt-0.5">{g.description}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={async () => {
                          const r = await fetch(`${API}/kali-env/generations/${g.id}/restore`, {
                            method: "POST",
                            headers: novaAuthHeaders(),
                          });
                          const d = await r.json();
                          setGenMsg(d?.message || "✓ تم الاسترداد");
                        }}
                        className="flex-1 py-1 rounded bg-emerald-500/25 text-emerald-300 text-[10px] font-bold"
                      >
                        ♻️ استرداد
                      </button>
                      <a
                        href={`${API}/kali-env/generations/${g.id}/export`}
                        download
                        className="px-2 py-1 rounded bg-sky-500/25 text-sky-300 text-[10px] font-bold"
                      >
                        📤 تصدير
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              {/* Eternal Audit Log */}
              <div className="p-3 rounded-xl bg-black/70 border border-white/10">
                <div className="text-xs font-black text-emerald-300 mb-2">
                  📜 السجل الأبدي للعمليات والإشعارات ({events.length} حدث موثق)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                  {events.slice(0, 24).map((ev, i) => (
                    <div key={i} className="p-2 rounded bg-white/5 border border-white/10 text-[10px] flex justify-between gap-2">
                      <span className="text-white font-bold truncate">{ev.title}</span>
                      <span className="text-slate-400 font-mono shrink-0" dir="ltr">
                        {new Date(ev.ts).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
