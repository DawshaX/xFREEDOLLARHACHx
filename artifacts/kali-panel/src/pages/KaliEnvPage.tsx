import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { KaliLogo2099 } from "@/components/KaliLogo2099";
import { SovereignKnowledgeLabView } from "@/components/desktop/SovereignKnowledgeLabView";
import {
  Terminal as TerminalIcon,
  Shield,
  Cpu,
  RefreshCw,
  Play,
  CheckCircle2,
  Folder,
  FolderOpen,
  Search,
  Sparkles,
  Wrench,
  Compass,
  FileCode,
  Save,
  Maximize2,
  X,
  ChevronRight,
  AlertTriangle,
  ArrowUp,
  Home,
  LayoutGrid,
  Crosshair,
  Bot,
  BookOpen,
  Brain,
  ExternalLink,
  Command,
  Network,
  Zap,
  Radio,
  Layers,
  GitBranch,
  Eye,
  DollarSign,
  Award,
  FileCheck2,
} from "lucide-react";

async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * NOVA KALI LINUX 2099 — GRAPHICAL MULTI-WINDOW OS DESKTOP (ETERNAL PURPLE EDITION)
 * لا إله إلا الله · الله أكبر ولله الحمد
 *
 * - Authentic Kali Linux Xfce Dark Multi-Window OS + 6 Ergonomic Workspaces
 * - Red / Blue (SOC-in-a-Box) / Purple (NIST CSF 2.0) Team Mode + Ctrl+K Palette
 * - Live 360° Attack Surface Graph + Kali Autopilot Chain Builder + Connections Hub
 * - Multi-Tab Persistent Live Terminal (qterminal) + Auto-Help & Tool Intelligence
 * - Dedicated AI Co-Pilot Assistant Terminal + Eternal Memory Vault + 32 Platform Apps
 * ═══════════════════════════════════════════════════════════════════════════ */

interface HealthResp {
  ready: boolean;
  prootBin: string | null;
  rootfs: string | null;
  guestShell: boolean;
  detail: string;
}

interface ToolsResp {
  total: number;
  present: number;
  missing?: string[];
  groups?: Record<string, { present?: string[]; missing?: string[]; total?: number }>;
  allPresent?: string[];
}

interface CatalogCategoryItem {
  id: string;
  tools: { name: string; present: boolean; version?: string | null; recipe?: string | null }[];
  present: number;
  total: number;
}

interface CatalogResp {
  ok: boolean;
  total?: number;
  present?: number;
  totalCatalog?: number;
  installedCount?: number;
  installed?: string[];
  categories?: CatalogCategoryItem[] | Record<string, { tool?: string; name?: string; installed?: boolean; present?: boolean }[]>;
}

interface PythonToolsResp {
  ok: boolean;
  installed: number;
  total: number;
  pythonPackages: number;
  tools: { name: string; ok: boolean; category?: string; path?: string }[];
}

interface StorageHubResp {
  ok: boolean;
  totalBytes: number;
  totalHuman: string;
  repos: { name: string; sizeHuman: string; bytes: number; status: string; updatedAt?: string }[];
}

interface FleetStatusResp {
  ok: boolean;
  primaryTarget?: number;
  activeCount?: number;
  standbyCount?: number;
  nodes?: { id: string; hostname?: string; status?: string; mode?: string; tools?: number; latencyMs?: number }[];
}

interface FsEntry {
  name: string;
  type: "dir" | "file";
  size: number;
  modifiedAt: string;
  relPath: string;
  permissions: string;
}

interface FsResp {
  ok: boolean;
  scope: string;
  path: string;
  entries: FsEntry[];
  fileContent?: string | null;
}

interface BrowserResp {
  ok: boolean;
  url: string;
  host: string;
  port: number;
  ips: string[];
  statusLine: string;
  statusCode: number;
  title: string;
  headers: Record<string, string>;
  securityAudit: { header: string; present: boolean; value: string | null; note: string }[];
  tls: {
    version: string;
    cipher: string;
    bits: number;
    subject: Record<string, string>;
    issuer: Record<string, string>;
    validFrom: string;
    validTo: string;
    authorized: boolean;
  } | null;
  links: { href: string; text: string }[];
  bodyPreview: string;
  plane: string | null;
  durationMs: number;
}

interface PipelineItem {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  tools: string[];
  description: string;
  defenseTip: string;
}

interface KaliToolGuideItem {
  tool: string;
  title_ar: string;
  category_ar: string;
  description_ar: string;
  usage_ar: string;
  binaryPath: string;
  flags: { flag: string; desc_ar: string }[];
  recipes: { label_ar: string; cmd: string; note_ar: string }[];
}

interface EternalMemoryEntry {
  id: string;
  timestamp: string;
  kind: "command" | "finding" | "note" | "pipeline" | "assistant";
  title: string;
  command?: string;
  output?: string;
  target?: string;
  plane?: string;
  exitCode?: number | null;
  cwd?: string;
  tags: string[];
  pinned?: boolean;
}

interface PersistentTerminalTab {
  id: string;
  title: string;
  cwd: string;
  lines: string[];
  history: string[];
}

interface AssistantMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  commands?: { label: string; cmd: string }[];
  ts: string;
}

interface AttackGraphNode {
  id: string;
  label: string;
  type: "target" | "ip" | "ns" | "mx" | "service" | "fleet" | "defense";
  ring: number;
  status: "ok" | "warn" | "critical" | "info";
  detail: string;
  recommendedCmd: string;
}

interface AttackGraphResp {
  ok: boolean;
  target: string;
  summary: {
    ipv4Count: number;
    ipv6Count: number;
    nsCount: number;
    mxCount: number;
    txtCount: number;
    txtPreview: string[];
  };
  nistCsf2: { id: string; code: string; title_ar: string; status: string; score: number; tools: string[] }[];
  nodes: AttackGraphNode[];
  edges: { from: string; to: string; label: string }[];
}

interface AutopilotTemplate {
  id: string;
  mode: string;
  nistPhase: string;
  title_ar: string;
  desc_ar: string;
  steps: { step: number; tool: string; label_ar: string; cmd: string }[];
}

interface ConnectionPlaneItem {
  id: string;
  name: string;
  category: string;
  protocol: string;
  status: string;
  metrics: string;
  latencyMs: number;
}

interface VisitorIntelRecord {
  id: string;
  timestamp: string;
  ip: string;
  reverseHost: string;
  city: string;
  country: string;
  isp: string;
  org: string;
  userAgent: string;
  deviceSummary: string;
  path: string;
  ports: number[];
  vulns: string[];
  verdict: string;
  telegramSent: boolean;
}

interface VisitorIntelResp {
  ok: boolean;
  currentVisitor: VisitorIntelRecord;
  visitors: VisitorIntelRecord[];
  telegram: {
    tokenSet?: boolean;
    chatIdKnown?: boolean;
    chatId?: string;
    bot?: { id?: number; username?: string; firstName?: string } | null;
    noteAr?: string;
  };
}

interface BountyProgramItem {
  id: string;
  category: string;
  title_ar: string;
  tierRange: string;
  tools: string[];
  desc_ar: string;
}

interface BountyHuntResp {
  ok: boolean;
  target: string;
  program: BountyProgramItem;
  elapsedMs: number;
  findingsCount: number;
  findings: {
    title: string;
    severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
    cvss: string;
    bountyEst: string;
    remediation: string;
  }[];
  reportMarkdown: string;
  telegramSent: boolean;
}

const KALI_WHISKER_CATEGORIES = [
  { id: "all", code: "00", label: "All Applications (294)", ar: "كل التطبيقات والأدوات" },
  { id: "الاستطلاع وOSINT", code: "01", label: "01 - Information Gathering", ar: "جمع المعلومات وOSINT" },
  { id: "تحليل الثغرات", code: "02", label: "02 - Vulnerability Analysis", ar: "تحليل وفحص الثغرات" },
  { id: "تطبيقات الويب", code: "03", label: "03 - Web Application Analysis", ar: "فحص تطبيقات الويب" },
  { id: "كلمات المرور والهاشات", code: "04", label: "04 - Password Attacks", ar: "كلمات المرور والهاشات" },
  { id: "اللاسلكي والبلوتوث", code: "05", label: "05 - Wireless Testing", ar: "الشبكات اللاسلكية" },
  { id: "الهندسة العكسية", code: "06", label: "06 - Reverse Engineering", ar: "الهندسة العكسية" },
  { id: "الاستغلال وما بعده", code: "07", label: "07 - Exploitation Tools", ar: "أدوات الاستغلال وAD" },
  { id: "الشبكات والـSniffing", code: "08", label: "08 - Sniffing & Spoofing", ar: "الشبكات والتنصت" },
  { id: "ما بعد الاختراق والـAD", code: "09", label: "09 - Post Exploitation & AD", ar: "ما بعد الاختراق وAD" },
  { id: "الجنائيات الرقمية", code: "10", label: "10 - Forensics & Binaries", ar: "التحقيق الجنائي الرقمي" },
  { id: "السحابة والحاويات والكود", code: "11", label: "11 - Cloud, Containers & SAST", ar: "أمن السحابة والحاويات" },
  { id: "python-28", code: "12", label: "12 - Python Arsenal (28 Venv)", ar: "ترسانة بايثون (28 أداة)" },
  { id: "pipelines-8", code: "13", label: "13 - 8 Auto-Defense Pipelines", ar: "سلاسل الفحص الذكية (8)" },
  { id: "platform-routes", code: "14", label: "14 - Open Everything (32 Apps)", ar: "فتح كل شيء (دمج المنصة)" },
];

const PLATFORM_APPS = [
  { name: "Nova Agent Pro (الوكيل الذكي المتقدم)", route: "/agent-pro", desc: "وكيل العمليات المستقل وتنفيذ المهام المركبة", cat: "الذكاء والقيادة" },
  { name: "Bug Bounty Studio (استوديو صيد الثغرات)", route: "/bug-bounty-studio", desc: "منصة صيد الثغرات وإدارة الأهداف والتقارير", cat: "الفحص والثغرات" },
  { name: "Vuln Center (مركز الـ 429,754 ثغرة CVE)", route: "/vuln-center", desc: "قاعدة بيانات الثغرات العالمية + CISA KEV + Exploit-DB", cat: "الفحص والثغرات" },
  { name: "Cyber Control Hub (مركز التحكم السيبراني)", route: "/cyber-control-hub", desc: "غرفة العمليات المركزية والتحكم بالأنظمة", cat: "الذكاء والقيادة" },
  { name: "Nova Commander (القائد التكتيكي)", route: "/nova-commander", desc: "قيادة الأسطول وتوجيه المهام المتوازية", cat: "الذكاء والقيادة" },
  { name: "Nova Brain Ops (عمليات العقل السيبراني)", route: "/nova-brain-ops", desc: "تحليلات الذاكرة والتعلم الذاتي المستمر", cat: "الذكاء والقيادة" },
  { name: "Nova Fleet Unified (إدارة الأسطول الموحد)", route: "/fleet-unified", desc: "مراقبة وإدارة الـ 10 عقد النشطة والاحتياط", cat: "الأسطول والبنية" },
  { name: "Kali Command Center (مركز أوامر كالي)", route: "/kali-command-center", desc: "لوحة تشغيل أوامر كالي المتقدمة", cat: "الأسطول والبنية" },
  { name: "Kali Terminal Full (الطرفية الكاملة)", route: "/kali-terminal", desc: "بيئة الطرفية الكاملة متعددة الجلسات", cat: "الأسطول والبنية" },
  { name: "Kali GPT (الخبير الذكي لأدوات كالي)", route: "/kali-gpt", desc: "مساعد الذكاء الاصطناعي المتخصص في كالي", cat: "الذكاء والقيادة" },
  { name: "Nuclei Engine (محرك قوالب Nuclei)", route: "/nuclei-engine", desc: "تشغيل وإدارة قوالب فحص الثغرات", cat: "الفحص والثغرات" },
  { name: "Attack Surface (سطح الهجوم الخارجي)", route: "/attack-surface", desc: "اكتشاف الأصول والنطاقات والمنافذ المكشوفة", cat: "الاستطلاع وOSINT" },
  { name: "Active Scanner (الماسح النشط)", route: "/active-scanner", desc: "فحص أمني حي للنطاقات والخوادم", cat: "الفحص والثغرات" },
  { name: "Threat Intelligence (استخبارات التهديدات)", route: "/threat-intelligence", desc: "تتبع مؤشرات الاختراق والتهديدات النشطة", cat: "الاستطلاع وOSINT" },
  { name: "Threat Detection (كشف التهديدات)", route: "/threat-detection", desc: "رصد السلوكيات الشاذة والتنبيهات الفورية", cat: "الاستطلاع وOSINT" },
  { name: "IOC Tracker (متتبع مؤشرات الاختراق)", route: "/ioc-tracker", desc: "تحليل عناوين IP والهاشات والنطاقات المشبوهة", cat: "الاستطلاع وOSINT" },
  { name: "Playbooks (كتيبات التشغيل الآلي)", route: "/playbooks", desc: "سيناريوهات الاستجابة والفحص المؤتمتة", cat: "الذكاء والقيادة" },
  { name: "Evidence Dashboard (لوحة الأدلة الجنائية)", route: "/evidence-dashboard", desc: "توثيق وحفظ الأدلة الرقمية واللقطات", cat: "التحقيق والتقارير" },
  { name: "Risk Center (مركز تقييم المخاطر)", route: "/risk-center", desc: "قياس المخاطر الأمنية وترتيب الأولويات", cat: "التحقيق والتقارير" },
  { name: "Mission Tracker (متتبع المهام الحية)", route: "/mission-tracker", desc: "سجل العمليات والمهام المجدولة", cat: "الذكاء والقيادة" },
  { name: "Auto Explorer (المستكشف الآلي)", route: "/auto-explorer", desc: "استكشاف تلقائي للأهداف والمسارات", cat: "الاستطلاع وOSINT" },
  { name: "Nova Memory (ذاكرة نوفا الطويلة)", route: "/nova-memory", desc: "إدارة المعرفة المتراكمة والذكريات", cat: "الذكاء والقيادة" },
  { name: "Knowledge Base (قاعدة المعرفة)", route: "/knowledge", desc: "موسوعة التقنيات والأدلة المرجعية", cat: "التحقيق والتقارير" },
  { name: "Reports Center (مركز التقارير)", route: "/reports", desc: "توليد وتصدير التقارير الاحترافية", cat: "التحقيق والتقارير" },
  { name: "Local Device Control (التحكم بالأجهزة)", route: "/local-device", desc: "إدارة الوكلاء المحليين والأجهزة المتصلة", cat: "الأسطول والبنية" },
  { name: "Network Monitor (مراقب الشبكة)", route: "/network", desc: "تحليل الاتصالات والمنافذ وحركة المرور", cat: "الأسطول والبنية" },
  { name: "System Monitor (مراقب النظام)", route: "/system-monitor", desc: "مؤشرات الأداء والمعالج والذاكرة", cat: "الأسطول والبنية" },
  { name: "Files Manager (مدير الملفات العام)", route: "/files", desc: "إدارة ملفات النظام والتقارير", cat: "الأسطول والبنية" },
  { name: "Self Check (الفحص الذاتي الشامل)", route: "/self-check", desc: "التحقق الحي من سلامة جميع مكونات المنصة", cat: "الأسطول والبنية" },
  { name: "Classic Workstation (/desktop)", route: "/desktop", desc: "واجهة محطة العمل الكلاسيكية", cat: "واجهات النظام" },
  { name: "Classic Home Dashboard (/classic-dashboard)", route: "/classic-dashboard", desc: "لوحة القيادة الكلاسيكية بجميع بطاقاتها", cat: "واجهات النظام" },
  { name: "Settings & Integrations (/settings)", route: "/settings", desc: "إعدادات المنصة والربط والتكاملات", cat: "واجهات النظام" },
];

const QUICK_DESKTOP_LAUNCHERS = [
  { id: "sysinfo", label: "System Recon", cmd: "uname -a && id && lscpu | head -12 && free -h && df -h /" },
  { id: "nmap", label: "Nmap Scan", cmd: "nmap --version && nmap -Pn -F {{TARGET}}" },
  { id: "nuclei", label: "Nuclei Audit", cmd: "nuclei -version && ls -la /usr/local/bin | head -25" },
  { id: "subfinder", label: "Subfinder", cmd: "subfinder -version && subfinder -d {{TARGET}} -silent | head -15" },
  { id: "httpx", label: "HTTPX Probe", cmd: "httpx -version && httpx -u https://{{TARGET}} -status-code -title -tech-detect" },
  { id: "python-venv", label: "Python 28 Venv", cmd: "prowler -v && semgrep --version && certipy -v && vol --help | head -10" },
];

const SESSION_STORAGE_KEY = "nova_kali_2099_eternal_session_v3";

/** Safe helper that normalizes `/api/kali-env/catalog` categories whether Array or Record */
function extractNormalizedTools(
  catalog: CatalogResp | null,
  toolsData: ToolsResp | null,
  toolsGuideMap: Record<string, KaliToolGuideItem>,
): { name: string; cat: string; ok: boolean }[] {
  const result: { name: string; cat: string; ok: boolean }[] = [];
  const seen = new Set<string>();

  const cats = catalog?.categories;
  if (Array.isArray(cats)) {
    for (const catObj of cats) {
      if (!catObj || typeof catObj !== "object") continue;
      const catName = String(catObj.id || "Kali Catalog");
      const toolsArr = Array.isArray(catObj.tools) ? catObj.tools : [];
      for (const item of toolsArr) {
        if (!item || typeof item !== "object") continue;
        const tName = String(item.name || "");
        if (!tName || seen.has(tName)) continue;
        seen.add(tName);
        result.push({ name: tName, cat: catName, ok: Boolean(item.present ?? true) });
      }
    }
  } else if (cats && typeof cats === "object") {
    for (const [catName, list] of Object.entries(cats)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const tName = String(item.tool || item.name || "");
        if (!tName || seen.has(tName)) continue;
        seen.add(tName);
        result.push({ name: tName, cat: catName, ok: Boolean(item.installed ?? item.present ?? true) });
      }
    }
  }

  // Also include all tools from `toolsData.groups`
  if (toolsData?.groups && typeof toolsData.groups === "object") {
    for (const [grpName, grp] of Object.entries(toolsData.groups)) {
      const pres = Array.isArray(grp?.present) ? grp.present : [];
      for (const tName of pres) {
        if (typeof tName === "string" && tName && !seen.has(tName)) {
          seen.add(tName);
          result.push({ name: tName, cat: grpName, ok: true });
        }
      }
    }
  }

  // Also include all tools from `toolsGuideMap` so all 266 tools are always present
  if (toolsGuideMap && typeof toolsGuideMap === "object") {
    for (const [tName, guide] of Object.entries(toolsGuideMap)) {
      if (tName && !seen.has(tName)) {
        seen.add(tName);
        result.push({ name: tName, cat: guide?.category_ar || "ترسانة كالي (266)", ok: true });
      }
    }
  }

  return result;
}

export default function KaliEnvPage() {
  const [, setLocation] = useLocation();

  // ── OS Shell State & Ergonomic Layout Presets (1..6) ──
  const [whiskerOpen, setWhiskerOpen] = useState(false);
  const [whiskerCat, setWhiskerCat] = useState("all");
  const [whiskerSearch, setWhiskerSearch] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [teamMode, setTeamMode] = useState<"PURPLE" | "RED" | "BLUE">("PURPLE");
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [cmdPaletteQuery, setCmdPaletteQuery] = useState("");
  const [clockStr, setClockStr] = useState("");

  // Window visibility & maximize state (in Workspace 1 Quad Desktop)
  const [winThunarOpen, setWinThunarOpen] = useState(true);
  const [winStudioOpen, setWinStudioOpen] = useState(true);
  const [winTerminalOpen, setWinTerminalOpen] = useState(true);
  const [winGotopOpen, setWinGotopOpen] = useState(true);
  const [maximizedWin, setMaximizedWin] = useState<null | "thunar" | "studio" | "terminal" | "gotop">(null);
  const [focusedWin, setFocusedWin] = useState<"thunar" | "studio" | "terminal" | "gotop">("terminal");

  // Studio sub-mode inside Window 2 (`x11` | `graph` | `autopilot` | `editor` | `browser` | `pipelines`)
  const [studioMode, setStudioMode] = useState<"x11" | "graph" | "autopilot" | "editor" | "browser" | "pipelines">("x11");
  // Terminal right-pane mode (`auto-help` | `assistant`)
  const [termSideMode, setTermSideMode] = useState<"auto-help" | "assistant">("auto-help");
  // Gotop right-window mode (`gotop` | `memory` | `connections` | `visitors`)
  const [rightMonitorTab, setRightMonitorTab] = useState<"gotop" | "memory" | "connections" | "visitors">("gotop");

  // Embedded Universal App inside Kali OS ("Open Everything")
  const [embeddedAppRoute, setEmbeddedAppRoute] = useState<string>("/agent-pro");
  const [embeddedAppTitle, setEmbeddedAppTitle] = useState<string>("Nova Agent Pro (الوكيل الذكي المتقدم)");

  // ── Core Telemetry & Arsenal State ──
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [toolsData, setToolsData] = useState<ToolsResp | null>(null);
  const [catalog, setCatalog] = useState<CatalogResp | null>(null);
  const [pyTools, setPyTools] = useState<PythonToolsResp | null>(null);
  const [storageHub, setStorageHub] = useState<StorageHubResp | null>(null);
  const [fleet, setFleet] = useState<FleetStatusResp | null>(null);
  const [pipelines, setPipelines] = useState<PipelineItem[]>([]);
  const [toolsGuideMap, setToolsGuideMap] = useState<Record<string, KaliToolGuideItem>>({});
  const [attackGraph, setAttackGraph] = useState<AttackGraphResp | null>(null);
  const [selectedGraphNode, setSelectedGraphNode] = useState<AttackGraphNode | null>(null);
  const [autopilotTemplates, setAutopilotTemplates] = useState<AutopilotTemplate[]>([]);
  const [autopilotRunningId, setAutopilotRunningId] = useState<string | null>(null);
  const [autopilotOutput, setAutopilotOutput] = useState<string>("");
  const [autopilotScript, setAutopilotScript] = useState<string>("");
  const [connections, setConnections] = useState<ConnectionPlaneItem[]>([]);
  const [visitorIntel, setVisitorIntel] = useState<VisitorIntelResp | null>(null);
  const [visitorScanIp, setVisitorScanIp] = useState<string>("");
  const [visitorScanning, setVisitorScanning] = useState<boolean>(false);
  const [visitorScanOutput, setVisitorScanOutput] = useState<string>("");
  const [tgBotTokenInput, setTgBotTokenInput] = useState<string>("");
  const [tgChatIdInput, setTgChatIdInput] = useState<string>("");
  const [tgConfigBusy, setTgConfigBusy] = useState<boolean>(false);
  const [tgConfigMsg, setTgConfigMsg] = useState<string>("");
  const [bountyPrograms, setBountyPrograms] = useState<BountyProgramItem[]>([]);
  const [selectedBountyProgramId, setSelectedBountyProgramId] = useState<string>("bugbounty-web-cloud");
  const [bountyHunting, setBountyHunting] = useState<boolean>(false);
  const [bountyResult, setBountyResult] = useState<BountyHuntResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [healing, setHealing] = useState(false);

  // ── Persistent Session & Eternal Memory State ──
  const [activeTarget, setActiveTarget] = useState<string>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
      return typeof s.activeTarget === "string" && s.activeTarget ? s.activeTarget : "example.com";
    } catch {
      return "example.com";
    }
  });
  const [sessionCwd, setSessionCwd] = useState<string>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
      return typeof s.cwd === "string" && s.cwd ? s.cwd : "/opt/nova-workspaces/recon-lab";
    } catch {
      return "/opt/nova-workspaces/recon-lab";
    }
  });
  const [terminalTabs, setTerminalTabs] = useState<PersistentTerminalTab[]>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
      if (Array.isArray(s.terminalTabs) && s.terminalTabs.length > 0) {
        return s.terminalTabs.map((t: any, i: number) => ({
          id: String(t?.id || `tab-${i}`),
          title: String(t?.title || `${i + 1}: root@kali`),
          cwd: String(t?.cwd || "/opt/nova-workspaces/recon-lab"),
          lines: Array.isArray(t?.lines) ? t.lines.map(String) : [],
          history: Array.isArray(t?.history) ? t.history.map(String) : [],
        }));
      }
    } catch { /* ignore */ }
    return [
      {
        id: "tab-root-1",
        title: "1: root@kali-2099 (Main)",
        cwd: "/opt/nova-workspaces/recon-lab",
        lines: [
          "╔══════════════════════════════════════════════════════════════════════════════════╗",
          "║  بسم الله الرحمن الرحيم · لا إله إلا الله وحده لا شريك له · الله أكبر ولله الحمد ║",
          "║  سبحان الله وبحمده · سبحان الله العظيم — NOVA KALI LINUX 2099 ETERNAL OS         ║",
          "║  جلسة دائمة متصلة بالذاكرة الأبدية · 266/266 أداة كالي · 28/28 بايثون            ║",
          "╚══════════════════════════════════════════════════════════════════════════════════╝",
        ],
        history: ["uname -a && id", "nmap --version", "nuclei -version", "ls -la /usr/local/bin"],
      },
      {
        id: "tab-recon-2",
        title: "2: Recon & OSINT",
        cwd: "/opt/nova-workspaces/recon-lab",
        lines: ["[+] جلسة استطلاع دائمة — جاهزة لفحص النطاقات وDNS والشبكات (subfinder, httpx, dnsx, nmap)"],
        history: ["subfinder -version", "httpx -version"],
      },
      {
        id: "tab-py-3",
        title: "3: Python 28 Venv",
        cwd: "/opt/nova-workspaces/cloud-osint",
        lines: ["[+] بيئة ترسانة بايثون الأمنية (/opt/nova-venv) — 28/28 أداة و880 حزمة جاهزة للتشغيل"],
        history: ["prowler -v", "semgrep --version", "certipy -v"],
      },
    ];
  });
  const [activeTabId, setActiveTabId] = useState<string>("tab-root-1");
  const [eternalMemory, setEternalMemory] = useState<EternalMemoryEntry[]>([]);
  const [memorySearch, setMemorySearch] = useState("");
  const [memoryFilterKind, setMemoryFilterKind] = useState<string>("all");
  const [newMemoryNote, setNewMemoryNote] = useState("");
  const [newMemoryTitle, setNewMemoryTitle] = useState("");

  // ── Terminal Execution & Auto-Help State ──
  const [termCmd, setTermCmd] = useState("nmap -Pn -F example.com");
  const [termRunning, setTermRunning] = useState(false);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [inspectedTool, setInspectedTool] = useState<string>("nmap");
  const [liveToolHelpText, setLiveToolHelpText] = useState<string | null>(null);
  const [loadingLiveHelp, setLoadingLiveHelp] = useState(false);
  const termBottomRef = useRef<HTMLDivElement>(null);

  // ── Dedicated Assistant Terminal State ──
  const [assistantHistory, setAssistantHistory] = useState<AssistantMsg[]>([
    {
      id: "welcome-msg",
      role: "assistant",
      text: "مرحبًا بك في ترمنال المساعد الذكي (Kali 2099 AI Co-Pilot). اكتب أي هدف أو اسم أداة أو مهمة (مثل: «فحص دومين كامل»، «شرح nmap»، «ثغرات ويب»، «كلاود»، «اشرح آخر أمر»)، وسأعطيك الوصف الكامل والأوامر الجاهزة للتنفيذ بضغطة واحدة!",
      commands: [
        { label: "فحص البنية السريعة للهدف", cmd: "whois example.com | head -25 && dig +short example.com A AAAA MX TXT" },
        { label: "فحص ترويسات وشهادة TLS", cmd: "curl -sI https://example.com | head -20" },
        { label: "استعراض ترسانة /usr/local/bin", cmd: "ls -la /usr/local/bin | head -35" },
      ],
      ts: new Date().toISOString(),
    },
  ]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const assistantBottomRef = useRef<HTMLDivElement>(null);

  // ── Live X11 :99 Stream State ──
  const [desktopFrame, setDesktopFrame] = useState<string | null>(null);
  const [desktopLoading, setDesktopLoading] = useState(false);
  const [autoStream, setAutoStream] = useState(false);

  // ── Thunar File Manager & Mousepad Editor State ──
  const [fsScope, setFsScope] = useState<"workspace" | "kali">("workspace");
  const [fsPath, setFsPath] = useState<string>("/");
  const [fsEntries, setFsEntries] = useState<FsEntry[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState<string>("recon-lab/kali-2099-script.sh");
  const [editorContent, setEditorContent] = useState<string>(
    "#!/bin/bash\n# 🐉 NOVA KALI LINUX 2099 — Tactical Script\n# لا إله إلا الله · الله أكبر ولله الحمد\necho '[+] Starting Kali 2099 Recon on Target...'\nuname -a\nid\n",
  );
  const [fsSaving, setFsSaving] = useState(false);
  const [newDirName, setNewDirName] = useState("");

  // ── Kali Cyber Browser State ──
  const [browserUrl, setBrowserUrl] = useState("https://example.com");
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserData, setBrowserData] = useState<BrowserResp | null>(null);

  // ── Pipelines & GitHub Free Cloner State ──
  const [pipeTarget, setPipeTarget] = useState("example.com");
  const [runningPipeId, setRunningPipeId] = useState<string | null>(null);
  const [pipeOutput, setPipeOutput] = useState<string>("");
  const [ghRepoInput, setGhRepoInput] = useState("");
  const [ghInstalling, setGhInstalling] = useState(false);
  const [ghOutput, setGhOutput] = useState<string>("");

  // ── CPU Graph Animation State for `gotop` ──
  const [cpuTicks, setCpuTicks] = useState<number[][]>([
    [18, 22, 29, 24, 31, 27, 35, 28, 22, 30, 26, 29],
    [14, 19, 25, 21, 18, 24, 29, 22, 17, 23, 20, 24],
    [22, 28, 33, 39, 31, 26, 34, 41, 36, 29, 33, 37],
    [11, 15, 19, 14, 21, 18, 24, 19, 16, 22, 18, 20],
  ]);

  // Global Ctrl+K shortcut for Universal Command Palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
      } else if (e.key === "Escape") {
        setCmdPaletteOpen(false);
        setWhiskerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clock & CPU waveform ticker
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockStr(
        now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) +
          " UTC · " +
          now.toISOString().slice(0, 10),
      );
    };
    updateClock();
    const iv = setInterval(() => {
      updateClock();
      setCpuTicks((prev) =>
        prev.map((row) => [...row.slice(1), Math.max(8, Math.min(92, row[row.length - 1] + Math.floor(Math.random() * 15) - 7))]),
      );
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  // Persist session to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          activeTarget,
          cwd: sessionCwd,
          terminalTabs,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch { /* ignore */ }
  }, [activeTarget, sessionCwd, terminalTabs]);

  const syncSessionToBackend = useCallback(
    async (patch?: Partial<{ cwd: string; activeTarget: string; terminalTabs: PersistentTerminalTab[] }>) => {
      try {
        await apiFetch("/api/kali-env/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: patch?.cwd ?? sessionCwd,
            activeTarget: patch?.activeTarget ?? activeTarget,
            terminalTabs: patch?.terminalTabs ?? terminalTabs,
          }),
        });
      } catch { /* ignore */ }
    },
    [sessionCwd, activeTarget, terminalTabs],
  );

  // Auto-detect tool name as the user types in `termCmd` -> instant Auto-Help!
  useEffect(() => {
    const firstWord = termCmd.trim().replace(/^sudo\s+/, "").split(/\s+/)[0]?.toLowerCase();
    if (firstWord && toolsGuideMap[firstWord]) {
      setInspectedTool(firstWord);
    }
  }, [termCmd, toolsGuideMap]);

  const loadAttackGraph = useCallback(async (target = activeTarget) => {
    try {
      const g = await apiFetch<AttackGraphResp>(`/api/kali-env/attack-graph?target=${encodeURIComponent(target)}`);
      if (g?.ok && Array.isArray(g.nodes)) {
        setAttackGraph(g);
        setSelectedGraphNode(g.nodes[0] ?? null);
      }
    } catch { /* ignore */ }
  }, [activeTarget]);

  // ── Load All Backend Data + Persistent Session + Tool Guides + Autopilot + Connections ──
  const refreshAll = useCallback(async (forceFresh = false) => {
    setLoading(true);
    try {
      const qs = forceFresh ? "?fresh=1" : "";
      const [h, t, c, p, s, fl, pp, sess, tg, ap, conn] = await Promise.all([
        apiFetch<HealthResp>("/api/kali-env/health").catch(() => null),
        apiFetch<ToolsResp>(`/api/kali-env/tools${qs}`).catch(() => null),
        apiFetch<CatalogResp>(`/api/kali-env/catalog${qs}`).catch(() => null),
        apiFetch<PythonToolsResp>("/api/ops/tools/python").catch(() => null),
        apiFetch<StorageHubResp>("/api/ops/storage-hub").catch(() => null),
        apiFetch<FleetStatusResp>("/api/ops/fleet/status").catch(() => null),
        apiFetch<{ ok: boolean; pipelines: PipelineItem[] }>("/api/kali-env/pipelines").catch(() => null),
        apiFetch<{
          ok: boolean;
          session: {
            cwd: string;
            activeTarget: string;
            terminalTabs: PersistentTerminalTab[];
            assistantHistory: AssistantMsg[];
          };
          recentMemory: EternalMemoryEntry[];
        }>("/api/kali-env/session").catch(() => null),
        apiFetch<{ ok: boolean; guides: Record<string, KaliToolGuideItem> }>("/api/kali-env/tools-guide").catch(() => null),
        apiFetch<{ ok: boolean; templates: AutopilotTemplate[] }>("/api/kali-env/autopilot").catch(() => null),
        apiFetch<{ ok: boolean; connections: ConnectionPlaneItem[] }>("/api/kali-env/connections").catch(() => null),
      ]);
      if (h) setHealth(h);
      if (t) setToolsData(t);
      if (c) setCatalog(c);
      if (p) setPyTools(p);
      if (s) setStorageHub(s);
      if (fl) setFleet(fl);
      if (Array.isArray(pp?.pipelines)) setPipelines(pp!.pipelines);
      if (tg?.guides && typeof tg.guides === "object") setToolsGuideMap(tg.guides);
      if (Array.isArray(sess?.recentMemory)) setEternalMemory(sess!.recentMemory);
      if (Array.isArray(sess?.session?.assistantHistory) && sess!.session.assistantHistory.length > 0) {
        setAssistantHistory(sess!.session.assistantHistory);
      }
      if (Array.isArray(ap?.templates)) setAutopilotTemplates(ap!.templates);
      if (Array.isArray(conn?.connections)) setConnections(conn!.connections);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEternalMemory = useCallback(
    async (q = memorySearch, kind = memoryFilterKind) => {
      try {
        const r = await apiFetch<{ ok: boolean; items: EternalMemoryEntry[] }>(
          `/api/kali-env/memory?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`,
        );
        if (Array.isArray(r?.items)) setEternalMemory(r.items);
      } catch { /* ignore */ }
    },
    [memorySearch, memoryFilterKind],
  );

  // ── Capture / Action on Live X11 Desktop (:99) ──
  const captureDesktopFrame = useCallback(async (force = true) => {
    setDesktopLoading(true);
    try {
      const d = await apiFetch<{ ok: boolean; frame?: string }>(`/api/kali-env/desktop-frame${force ? "?refresh=1" : ""}`);
      if (d?.frame) setDesktopFrame(d.frame);
    } catch { /* ignore */ } finally {
      setDesktopLoading(false);
    }
  }, []);

  const runDesktopAction = useCallback(
    async (action: string, cmd?: string) => {
      setDesktopLoading(true);
      setStudioMode("x11");
      const finalCmd = cmd ? cmd.replace(/\{\{TARGET\}\}/g, activeTarget) : undefined;
      try {
        const d = await apiFetch<{ ok: boolean; frame?: string }>("/api/kali-env/desktop-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, cmd: finalCmd }),
        });
        if (d?.frame) setDesktopFrame(d.frame);
      } catch { /* ignore */ } finally {
        setDesktopLoading(false);
      }
    },
    [activeTarget],
  );

  // ── Load Thunar File System ──
  const loadFs = useCallback(
    async (scope = fsScope, targetPath = fsPath) => {
      setFsLoading(true);
      try {
        const r = await apiFetch<FsResp>(`/api/kali-env/fs?scope=${scope}&path=${encodeURIComponent(targetPath)}`);
        if (r?.ok) {
          setFsEntries(Array.isArray(r.entries) ? r.entries : []);
          setFsPath(r.path || "/");
          if (typeof r.fileContent === "string") {
            setEditorContent(r.fileContent);
            setEditorPath(targetPath.replace(/^\/+/, ""));
            setStudioMode("editor");
          }
        }
      } catch { /* ignore */ } finally {
        setFsLoading(false);
      }
    },
    [fsScope, fsPath],
  );

  const saveEditorFile = useCallback(async () => {
    if (!editorPath.trim()) return;
    setFsSaving(true);
    try {
      await apiFetch("/api/kali-env/fs/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: editorPath.trim(), content: editorContent }),
      });
      await loadFs("workspace", "/");
    } finally {
      setFsSaving(false);
    }
  }, [editorPath, editorContent, loadFs]);

  const createWorkspaceDir = useCallback(async () => {
    if (!newDirName.trim()) return;
    const clean = `${fsPath === "/" ? "" : fsPath}/${newDirName.trim()}`.replace(/^\/+/, "");
    await apiFetch("/api/kali-env/fs/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: clean }),
    });
    setNewDirName("");
    await loadFs("workspace", fsPath);
  }, [newDirName, fsPath, loadFs]);

  // ── Run Kali Cyber Browser ──
  const runCyberBrowser = useCallback(
    async (targetUrl = browserUrl) => {
      if (!targetUrl.trim()) return;
      setBrowserLoading(true);
      try {
        const r = await apiFetch<BrowserResp>("/api/kali-env/browser", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: targetUrl.trim() }),
        });
        if (r) setBrowserData(r);
      } catch { /* ignore */ } finally {
        setBrowserLoading(false);
      }
    },
    [browserUrl],
  );

  // ── Active Terminal Tab Helpers ──
  const activeTab = useMemo(
    () => terminalTabs.find((t) => t.id === activeTabId) ?? terminalTabs[0],
    [terminalTabs, activeTabId],
  );

  const appendLinesToActiveTab = useCallback(
    (newLines: string[], newHistoryCmd?: string, newCwd?: string) => {
      setTerminalTabs((prev) => {
        const updated = prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const prevLines = Array.isArray(t.lines) ? t.lines : [];
          const prevHist = Array.isArray(t.history) ? t.history : [];
          const nextLines = [...prevLines, ...newLines].slice(-300);
          const nextHist = newHistoryCmd
            ? [...prevHist.filter((h) => h !== newHistoryCmd), newHistoryCmd].slice(-100)
            : prevHist;
          return { ...t, lines: nextLines, history: nextHist, cwd: newCwd ?? t.cwd };
        });
        void syncSessionToBackend({ terminalTabs: updated, cwd: newCwd ?? sessionCwd });
        return updated;
      });
    },
    [activeTabId, sessionCwd, syncSessionToBackend],
  );

  // ── Execute Command in Live `qterminal` ──
  const execInTerminal = useCallback(
    async (cmdOverride?: string) => {
      const raw = (cmdOverride ?? termCmd).trim();
      if (!raw || termRunning) return;
      const c = raw.replace(/\{\{TARGET\}\}/g, activeTarget);

      const cdMatch = c.match(/^cd\s+([^\s;&|]+)$/);
      let nextCwd = activeTab?.cwd || sessionCwd;
      if (cdMatch) {
        const arg = cdMatch[1];
        if (arg === "~" || arg === "/root") nextCwd = "/root";
        else if (arg === "..") {
          const parts = nextCwd.split("/").filter(Boolean);
          parts.pop();
          nextCwd = "/" + parts.join("/");
        } else if (arg.startsWith("/")) nextCwd = arg;
        else nextCwd = `${nextCwd === "/" ? "" : nextCwd}/${arg}`;
        setSessionCwd(nextCwd);
      }

      const firstBin = c.replace(/^sudo\s+/, "").split(/\s+/)[0]?.toLowerCase();
      if (firstBin && toolsGuideMap[firstBin]) {
        setInspectedTool(firstBin);
      }

      setTermRunning(true);
      setHistoryIdx(-1);
      appendLinesToActiveTab([`┌──(root💀kali-2099)-[${nextCwd}]`, `└─# ${c}`], c, nextCwd);

      try {
        const resp = await fetch("/api/kali-env/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: c, cwd: nextCwd, timeoutMs: 120000 }),
        });
        if (!resp.body) {
          appendLinesToActiveTab(["[✗] تعذر فتح دفق الطرفية"]);
          setTermRunning(false);
          return;
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() || "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const ev = JSON.parse(payload);
              if (ev.type === "stdout" || ev.type === "stderr") {
                const split = String(ev.text || "").replace(/\r/g, "").split("\n");
                appendLinesToActiveTab(split);
              } else if (ev.type === "done") {
                appendLinesToActiveTab([
                  `[✓ exit=${ev.exitCode ?? 0} · ${ev.durationMs ?? 0}ms · ${ev.plane ?? "fleet"} · حُفظ في الذاكرة الأبدية]`,
                ]);
              }
            } catch { /* ignore */ }
          }
        }
        void loadEternalMemory();
      } catch (e) {
        appendLinesToActiveTab([`[✗] ${(e as Error).message}`]);
      } finally {
        setTermRunning(false);
        setTimeout(() => termBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
      }
    },
    [termCmd, termRunning, activeTarget, activeTab, sessionCwd, toolsGuideMap, appendLinesToActiveTab, loadEternalMemory],
  );

  // ── Fetch Live `--help` from the Kali Node ──
  const fetchLiveCliHelp = useCallback(
    async (toolName: string) => {
      setLoadingLiveHelp(true);
      setLiveToolHelpText(null);
      try {
        const r = await apiFetch<{ ok: boolean; guide: KaliToolGuideItem; liveHelpOutput: string | null }>(
          `/api/kali-env/tool-help?tool=${encodeURIComponent(toolName)}&target=${encodeURIComponent(activeTarget)}&live=1`,
        );
        if (r?.liveHelpOutput) setLiveToolHelpText(r.liveHelpOutput);
        if (r?.guide) {
          setToolsGuideMap((prev) => ({ ...prev, [toolName]: r.guide }));
        }
      } catch { /* ignore */ } finally {
        setLoadingLiveHelp(false);
      }
    },
    [activeTarget],
  );

  // ── Ask Dedicated AI Co-Pilot Assistant Terminal ──
  const askAssistant = useCallback(
    async (queryOverride?: string) => {
      const q = (queryOverride ?? assistantInput).trim();
      if (!q || assistantBusy) return;
      if (!queryOverride) setAssistantInput("");
      setAssistantBusy(true);
      setTermSideMode("assistant");

      const histArr = Array.isArray(activeTab?.history) ? activeTab.history : [];
      const linesArr = Array.isArray(activeTab?.lines) ? activeTab.lines : [];
      const lastHistoryCmd = histArr[histArr.length - 1] ?? "";
      const lastTermLines = linesArr.slice(-25).join("\n");

      try {
        const r = await apiFetch<{
          ok: boolean;
          reply_ar: string;
          commands: { label: string; cmd: string }[];
          matchedGuides?: KaliToolGuideItem[];
          assistantHistory?: AssistantMsg[];
        }>("/api/kali-env/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            target: activeTarget,
            cwd: activeTab?.cwd || sessionCwd,
            lastCommand: lastHistoryCmd,
            lastOutput: lastTermLines,
          }),
        });
        if (Array.isArray(r?.assistantHistory)) {
          setAssistantHistory(r.assistantHistory);
        } else if (r?.reply_ar) {
          setAssistantHistory((prev) => [
            ...prev,
            { id: `u-${Date.now()}`, role: "user", text: q, ts: new Date().toISOString() },
            {
              id: `a-${Date.now() + 1}`,
              role: "assistant",
              text: r.reply_ar,
              commands: Array.isArray(r.commands) ? r.commands : [],
              ts: new Date().toISOString(),
            },
          ]);
        }
        if (r?.matchedGuides?.[0]?.tool) {
          setInspectedTool(r.matchedGuides[0].tool);
        }
        void loadEternalMemory();
        setTimeout(() => assistantBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
      } finally {
        setAssistantBusy(false);
      }
    },
    [assistantInput, assistantBusy, activeTab, activeTarget, sessionCwd, loadEternalMemory],
  );

  // ── Run Kali Autopilot 2099 Chain ──
  const runAutopilotChain = useCallback(
    async (tplId: string) => {
      setAutopilotRunningId(tplId);
      setAutopilotOutput("⏳ جاري تشغيل سلسلة Kali Autopilot 2099 على الأسطول وحفظ المخرجات في الذاكرة الأبدية...");
      try {
        const r = await apiFetch<{
          ok: boolean;
          plane: string;
          durationMs: number;
          generatedScript: string;
          output: string;
        }>("/api/kali-env/autopilot/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: tplId, target: activeTarget }),
        });
        if (r) {
          setAutopilotScript(r.generatedScript || "");
          setAutopilotOutput(
            `[+] العقدة المنفذة: ${r.plane} · الزمن: ${((r.durationMs ?? 0) / 1000).toFixed(1)}s\n------------------------------------------------------------\n${r.output || "(اكتمل التنفيذ)"}`,
          );
          void loadEternalMemory();
        }
      } catch (e) {
        setAutopilotOutput(`✗ خطأ: ${(e as Error).message}`);
      } finally {
        setAutopilotRunningId(null);
      }
    },
    [activeTarget, loadEternalMemory],
  );

  // ── Save Custom Note / Finding to Eternal Memory ──
  const saveNoteToEternalMemory = useCallback(async () => {
    if (!newMemoryNote.trim() && !newMemoryTitle.trim()) return;
    await apiFetch("/api/kali-env/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "finding",
        title: newMemoryTitle.trim() || `نتيجة/ملاحظة على ${activeTarget}`,
        output: newMemoryNote.trim(),
        target: activeTarget,
        cwd: sessionCwd,
        pinned: true,
        tags: ["finding", activeTarget],
      }),
    });
    setNewMemoryTitle("");
    setNewMemoryNote("");
    await loadEternalMemory();
  }, [newMemoryTitle, newMemoryNote, activeTarget, sessionCwd, loadEternalMemory]);

  const togglePinMemory = useCallback(
    async (id: string) => {
      await apiFetch("/api/kali-env/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle-pin", id }),
      });
      await loadEternalMemory();
    },
    [loadEternalMemory],
  );

  // ── Run Automated Pipeline ──
  const runPipeline = useCallback(
    async (pipeId: string) => {
      setRunningPipeId(pipeId);
      setPipeOutput("⏳ جاري تشغيل السلسلة الذكية على عقدة كالي 2099 وحفظ التقرير في الذاكرة الأبدية...");
      try {
        const r = await apiFetch<{
          ok: boolean;
          output: string;
          savedReportPath: string | null;
          plane: string | null;
          durationMs: number;
          pipeline: { title: string; defenseTip: string };
        }>("/api/kali-env/pipelines/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: pipeId, target: pipeTarget, workspace: "recon-lab" }),
        });
        if (r) {
          setPipeOutput(
            [
              `╔══ [ ${r.pipeline?.title ?? pipeId} ] ══╗`,
              `[+] العقدة: ${r.plane ?? "fleet"} · الزمن: ${((r.durationMs ?? 0) / 1000).toFixed(1)}s`,
              `[+] التقرير المحفوظ: ${r.savedReportPath ?? "recon-lab/reports"} (ومثبت في الذاكرة الأبدية)`,
              `[+] نصيحة التحصين: ${r.pipeline?.defenseTip ?? ""}`,
              `------------------------------------------------------------`,
              r.output || "(اكتمل التنفيذ)",
            ].join("\n"),
          );
          await loadFs("workspace", "/");
          await loadEternalMemory();
        }
      } catch (e) {
        setPipeOutput(`✗ خطأ: ${(e as Error).message}`);
      } finally {
        setRunningPipeId(null);
      }
    },
    [pipeTarget, loadFs, loadEternalMemory],
  );

  const installFromGithub = useCallback(async () => {
    if (!ghRepoInput.trim()) return;
    setGhInstalling(true);
    setGhOutput("⏳ جاري الاستنساخ والتثبيت المجاني المباشر من GitHub داخل عقدة كالي...");
    try {
      const r = await apiFetch<{ ok: boolean; repo: string; output: string; plane: string | null }>(
        "/api/kali-env/github-install",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo: ghRepoInput.trim() }),
        },
      );
      if (r) {
        setGhOutput(`[+] المستودع: ${r.repo}\n[+] العقدة: ${r.plane ?? "fleet"}\n----------------------------------------\n${r.output}`);
      }
    } catch (e) {
      setGhOutput(`✗ خطأ: ${(e as Error).message}`);
    } finally {
      setGhInstalling(false);
    }
  }, [ghRepoInput]);

  const loadVisitorIntel = useCallback(async (track = false) => {
    try {
      const r = await apiFetch<VisitorIntelResp>(
        `/api/kali-env/visitor-intel${track ? "?track=1&page=/kali-env" : ""}`,
      );
      if (r?.ok) {
        setVisitorIntel({
          ...r,
          visitors: Array.isArray(r.visitors) ? r.visitors : [],
        });
        if (!visitorScanIp && r.currentVisitor?.ip) {
          setVisitorScanIp(r.currentVisitor.ip);
        }
      }
    } catch { /* ignore */ }
  }, [visitorScanIp]);

  const runDeepVisitorScan = useCallback(
    async (ipToScan?: string) => {
      const targetIp = (ipToScan || visitorScanIp || visitorIntel?.currentVisitor?.ip || "").trim();
      if (!targetIp) return;
      setVisitorScanning(true);
      setVisitorScanOutput(`⏳ جاري الفحص الاستخباراتي العميق للزائر (${targetIp}) وإرسال التقرير الفوري للتليجرام...`);
      try {
        const r = await apiFetch<{
          ok: boolean;
          visitor: VisitorIntelRecord;
          reconOutput: string;
          telegramSent: boolean;
          visitors: VisitorIntelRecord[];
        }>("/api/kali-env/visitor-intel/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip: targetIp, notifyTelegramNow: true }),
        });
        if (r?.ok) {
          setVisitorIntel((prev) =>
            prev
              ? {
                  ...prev,
                  currentVisitor: r.visitor ?? prev.currentVisitor,
                  visitors: Array.isArray(r.visitors) ? r.visitors : prev.visitors,
                }
              : prev,
          );
          setVisitorScanOutput(
            [
              `🕌 بسم الله الرحمن الرحيم — لا إله إلا الله · الله أكبر ولله الحمد`,
              `🛡️ [رادار حراس الكون 2099] تقرير فحص الزائر (${r.visitor?.ip ?? targetIp}):`,
              `• الاسم العكسي (rDNS): ${r.visitor?.reverseHost}`,
              `• المكان: ${r.visitor?.city}، ${r.visitor?.country} (${r.visitor?.isp} / ${r.visitor?.org})`,
              `• الجهاز والمتصفح: ${r.visitor?.deviceSummary}`,
              `• التقييم الأمني: ${r.visitor?.verdict}`,
              `• حالة تنبيه تليجرام: ${r.telegramSent ? "تم الإرسال لتليجرام بنجاح ✅" : "محفوظ في الرادار والذاكرة الأبدية 📌"}`,
              `------------------------------------------------------------`,
              r.reconOutput || "(اكتمل الفحص)",
            ].join("\n"),
          );
          await loadEternalMemory();
        }
      } catch (e) {
        setVisitorScanOutput(`✗ تعذر إتمام الفحص: ${(e as Error).message}`);
      } finally {
        setVisitorScanning(false);
      }
    },
    [visitorScanIp, visitorIntel, loadEternalMemory],
  );

  const saveAndTestTelegram = useCallback(
    async (sendTest = true) => {
      setTgConfigBusy(true);
      setTgConfigMsg("⏳ جاري حفظ إعدادات تليجرام وإرسال تنبيه حي لحراس الكون...");
      try {
        const r = await apiFetch<{
          ok: boolean;
          errors: string[];
          testSent: boolean;
          telegram: VisitorIntelResp["telegram"];
        }>("/api/kali-env/telegram-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botToken: tgBotTokenInput.trim() || undefined,
            chatId: tgChatIdInput.trim() || undefined,
            sendTest,
          }),
        });
        if (r) {
          setVisitorIntel((prev) => (prev ? { ...prev, telegram: r.telegram ?? prev.telegram } : prev));
          if (r.errors?.length) {
            setTgConfigMsg(`⚠️ ${r.errors.join(" · ")}`);
          } else if (r.testSent) {
            setTgConfigMsg("✅ تم الربط وإرسال تنبيه تليجرام الحي بنجاح! (تفقد محادثة البوت الآن)");
          } else {
            setTgConfigMsg(
              r.telegram?.tokenSet
                ? "✅ تم حفظ التوكن بنجاح! أرسل /start للبوت أو أدخل Chat ID ليصل التنبيه فورًا."
                : "ℹ️ أدخل توكن البوت (Bot Token) ومعرف الشات (Chat ID) لتفعيل الإرسال الفوري.",
            );
          }
          setTgBotTokenInput("");
        }
      } catch (e) {
        setTgConfigMsg(`✗ خطأ: ${(e as Error).message}`);
      } finally {
        setTgConfigBusy(false);
      }
    },
    [tgBotTokenInput, tgChatIdInput],
  );

  const loadBountyEngine = useCallback(async () => {
    try {
      const r = await apiFetch<{ ok: boolean; programs: BountyProgramItem[] }>("/api/kali-env/bounty-engine");
      if (Array.isArray(r?.programs)) {
        setBountyPrograms(r.programs);
      }
    } catch { /* ignore */ }
  }, []);

  const runBountyHunt = useCallback(
    async (progId = selectedBountyProgramId) => {
      setBountyHunting(true);
      setSelectedBountyProgramId(progId);
      try {
        const r = await apiFetch<BountyHuntResp>("/api/kali-env/bounty-engine/hunt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: activeTarget,
            programId: progId,
            sendTelegram: true,
          }),
        });
        if (r?.ok) {
          setBountyResult(r);
          await loadEternalMemory();
        }
      } catch { /* ignore */ } finally {
        setBountyHunting(false);
      }
    },
    [selectedBountyProgramId, activeTarget, loadEternalMemory],
  );

  const triggerSelfHeal = useCallback(async () => {
    setHealing(true);
    try {
      await apiFetch("/api/kali-env/self-heal", { method: "POST" });
      await refreshAll(true);
    } finally {
      setHealing(false);
    }
  }, [refreshAll]);

  // Initial Boot
  useEffect(() => {
    void refreshAll(false);
    void captureDesktopFrame(false);
    void loadFs("workspace", "/");
    void runCyberBrowser("https://example.com");
    void loadAttackGraph("example.com");
    void loadVisitorIntel(true);
    void loadBountyEngine();
  }, [refreshAll, captureDesktopFrame, loadFs, runCyberBrowser, loadAttackGraph, loadVisitorIntel, loadBountyEngine]);

  useEffect(() => {
    if (!autoStream) return;
    const iv = setInterval(() => {
      void captureDesktopFrame(true);
    }, 3500);
    return () => clearInterval(iv);
  }, [autoStream, captureDesktopFrame]);

  // ── Derived Metrics & Safe Normalized Lists ──
  const totalTools = toolsData?.total ?? 266;
  const presentTools = toolsData?.present ?? 266;
  const pyPresent = pyTools?.installed ?? 28;
  const pyTotal = pyTools?.total ?? 28;
  const activeNodes = fleet?.activeCount ?? 10;
  const storageText = storageHub?.totalHuman ?? "67.11GB";

  const currentToolGuide = useMemo<KaliToolGuideItem>(() => {
    const key = inspectedTool.toLowerCase();
    const g = toolsGuideMap?.[key];
    if (g && typeof g === "object") {
      return {
        ...g,
        flags: Array.isArray(g.flags) ? g.flags : [],
        recipes: (Array.isArray(g.recipes) ? g.recipes : []).map((r) => ({
          ...r,
          cmd: String(r.cmd || "").replace(/\{\{TARGET\}\}/g, activeTarget),
        })),
      };
    }
    return {
      tool: key || "nmap",
      title_ar: `أداة كالي العملياتية (${key || "nmap"})`,
      category_ar: "ترسانة كالي الشاملة (266 أداة)",
      description_ar:
        "أداة أمنية محققة ضمن ترسانة الـ 266 أداة في بيئة NOVA KALI LINUX 2099، متوفرة في مسار النظام وجاهزة للتنفيذ المباشر.",
      usage_ar: `${key || "nmap"} [الخيارات] ${activeTarget}`,
      binaryPath: `/usr/local/bin/${key || "nmap"}`,
      flags: [
        { flag: "--help / -h", desc_ar: "عرض دليل الاستخدام الكامل وجميع الخيارات" },
        { flag: "--version / -V", desc_ar: "عرض رقم الإصدار المثبت" },
      ],
      recipes: [
        {
          label_ar: `عرض المساعدة الكاملة لـ ${key}`,
          cmd: `${key} --help 2>&1 | head -40 || ${key} -h 2>&1 | head -40`,
          note_ar: "دليل الأداة من العقدة",
        },
        {
          label_ar: `فحص الهدف (${activeTarget})`,
          cmd: `${key} ${activeTarget}`,
          note_ar: "تشغيل مباشر على الهدف النشط",
        },
      ],
    };
  }, [inspectedTool, toolsGuideMap, activeTarget]);

  const allNormalizedTools = useMemo(
    () => extractNormalizedTools(catalog, toolsData, toolsGuideMap),
    [catalog, toolsData, toolsGuideMap],
  );

  const whiskerTools = useMemo(() => {
    const q = whiskerSearch.trim().toLowerCase();
    if (whiskerCat === "python-28") {
      const pyArr = Array.isArray(pyTools?.tools) ? pyTools!.tools : [];
      return pyArr
        .map((t) => ({ name: String(t.name), cat: "Python Arsenal (28)", ok: Boolean(t.ok) }))
        .filter((t) => !q || t.name.toLowerCase().includes(q));
    }
    if (whiskerCat === "pipelines-8" || whiskerCat === "platform-routes") {
      return [];
    }
    return allNormalizedTools.filter((item) => {
      if (whiskerCat !== "all" && item.cat !== whiskerCat) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.cat.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allNormalizedTools, pyTools, whiskerCat, whiskerSearch]);

  const openToolWithAutoHelp = useCallback(
    (toolName: string, autoExec = false) => {
      setInspectedTool(toolName);
      setLiveToolHelpText(null);
      setTermSideMode("auto-help");
      const guide = toolsGuideMap?.[toolName];
      const defaultCmd =
        guide?.recipes?.[0]?.cmd?.replace(/\{\{TARGET\}\}/g, activeTarget) || `${toolName} --help 2>&1 | head -35`;
      setTermCmd(defaultCmd);
      setWinTerminalOpen(true);
      setFocusedWin("terminal");
      setWhiskerOpen(false);
      setCmdPaletteOpen(false);
      if (autoExec) {
        void execInTerminal(defaultCmd);
      }
    },
    [toolsGuideMap, activeTarget, execInTerminal],
  );

  const openPlatformAppInDesktop = useCallback((app: { name: string; route: string }) => {
    setEmbeddedAppRoute(app.route);
    setEmbeddedAppTitle(app.name);
    setWhiskerOpen(false);
    setCmdPaletteOpen(false);
    setActiveWorkspace(5);
  }, []);

  const addNewTerminalTab = useCallback(() => {
    const idx = terminalTabs.length + 1;
    const newId = `tab-${Date.now()}`;
    const newTab: PersistentTerminalTab = {
      id: newId,
      title: `${idx}: root@kali (${sessionCwd.split("/").pop() || "~"})`,
      cwd: sessionCwd,
      lines: [`[+] جلسة طرفية دائمة رقم #${idx} — متصلة بالذاكرة الأبدية (${sessionCwd})`],
      history: ["uname -a", "ls -la"],
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, [terminalTabs.length, sessionCwd]);

  const closeTerminalTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (terminalTabs.length <= 1) return;
      const filtered = terminalTabs.filter((t) => t.id !== tabId);
      setTerminalTabs(filtered);
      if (activeTabId === tabId) {
        setActiveTabId(filtered[0].id);
      }
    },
    [terminalTabs, activeTabId],
  );

  return (
    <div
      dir="rtl"
      className="relative h-screen w-screen overflow-hidden select-none flex flex-col font-sans text-slate-100"
      style={{
        backgroundImage: "url('/kali-2099-wallpaper.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundColor: "#06080f",
      }}
      onClick={() => {
        if (whiskerOpen) setWhiskerOpen(false);
      }}
    >
      {/* Subtle dark cyber overlay aligned with Red / Blue / Purple Team Mode */}
      <div
        className={`pointer-events-none absolute inset-0 z-0 transition-colors duration-500 ${
          teamMode === "PURPLE"
            ? "bg-gradient-to-b from-[#0b0618]/55 via-[#05070e]/30 to-[#0e0418]/65"
            : teamMode === "BLUE"
              ? "bg-gradient-to-b from-[#041022]/55 via-[#05070e]/30 to-[#031426]/65"
              : "bg-gradient-to-b from-[#1a040a]/55 via-[#05070e]/30 to-[#180309]/65"
        }`}
      />

      {/* ═══════════════════════════════════════════════════════════════════════
       * 0. SACRED TAWHID & DHIKR ETERNAL RIBBON (ALWAYS VISIBLE ON ALL SCREENS)
       * ═══════════════════════════════════════════════════════════════════════ */}
      <div
        className="relative z-40 h-6 w-full bg-gradient-to-r from-[#240410] via-[#3a071b] to-[#240410] border-b border-[#ff2b4d]/45 px-3 flex items-center justify-between text-[11px] shadow-[0_0_18px_rgba(255,43,77,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 truncate">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
          <span className="font-black tracking-wide text-white drop-shadow-[0_0_10px_rgba(255,43,77,0.9)] truncate">
            بسم الله الرحمن الرحيم · لا إله إلا الله وحده لا شريك له · الله أكبر ولله الحمد · سبحان الله وبحمده سبحان الله العظيم
          </span>
        </div>
        <div className="hidden md:flex items-center gap-2 shrink-0 text-[10px] font-mono">
          <span className="text-[#ff8fa3] font-bold">
            منظمة حراس الكون · خالصًا لوجه الله في نشر العلم النافع والدفاع الأخلاقي
          </span>
          <button
            onClick={() => {
              setActiveWorkspace(6);
              setRightMonitorTab("visitors");
            }}
            className="px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-400/50 text-cyan-200 font-bold flex items-center gap-1"
          >
            <Eye className="w-3 h-3 text-emerald-400" />
            <span>رادار الزوار وتليجرام ({visitorIntel?.visitors?.length ?? 1})</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
       * 1. AUTHENTIC KALI LINUX XFCE TOP PANEL (36px) + PURPLE/RED/BLUE SWITCH + Ctrl+K
       * ═══════════════════════════════════════════════════════════════════════ */}
      <header
        className="relative z-40 h-9 w-full bg-[#0d1017]/95 backdrop-blur-md border-b border-cyan-500/25 flex items-center justify-between px-2.5 text-xs shadow-[0_2px_20px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Right side: Applications Button + Ctrl+K Fuzzy Launcher + Active Target + 6 Workspaces */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWhiskerOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-bold transition-all ${
              whiskerOpen
                ? "bg-[#ff2b4d] text-white shadow-[0_0_15px_rgba(255,43,77,0.6)]"
                : "bg-[#171c28] hover:bg-[#22293a] text-cyan-400 border border-cyan-500/30"
            }`}
          >
            <KaliLogo2099 size={18} animated={false} />
            <span className="tracking-wide text-[11px] font-black text-white">Applications</span>
          </button>

          {/* Universal Fuzzy Command Palette Trigger (Ctrl+K) */}
          <button
            onClick={() => setCmdPaletteOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#141926] hover:bg-purple-500/25 border border-purple-500/40 text-purple-200 text-[10px] font-mono font-bold"
            title="البحث الشامل والتشغيل الفوري (Ctrl+K)"
          >
            <Search className="w-3 h-3 text-purple-400" />
            <span className="hidden sm:inline">بحث شامل</span>
            <kbd className="px-1 rounded bg-black/50 text-[9px] text-cyan-300">Ctrl+K</kbd>
          </button>

          {/* Active Target Global Input */}
          <div className="hidden md:flex items-center gap-1 bg-[#131824] border border-cyan-500/30 rounded px-2 py-0.5">
            <Crosshair className="w-3.5 h-3.5 text-[#ff2b4d]" />
            <span className="text-[10px] text-slate-400">الهدف:</span>
            <input
              value={activeTarget}
              onChange={(e) => {
                setActiveTarget(e.target.value);
                setPipeTarget(e.target.value);
              }}
              onKeyDown={(e) => e.key === "Enter" && void loadAttackGraph(activeTarget)}
              dir="ltr"
              className="w-28 bg-transparent text-[11px] font-mono font-bold text-cyan-300 focus:outline-none"
              placeholder="example.com"
            />
          </div>

          {/* 7 Ergonomic Workspaces with spacious layout */}
          <div className="flex items-center gap-1 bg-[#090c12] p-0.5 rounded border border-slate-800" dir="ltr">
            {(
              [
                { id: 1, label: "1:Desktop", title: "سطح المكتب الرباعي المتكامل" },
                { id: 2, label: "2:Term+AI", title: "غرفة التريمنال المزدوج + ترمنال المساعد الذكي" },
                { id: 3, label: "3:Arsenal", title: "موسوعة الـ 266 أداة كالي + 28 بايثون بالوصف والأوامر" },
                { id: 4, label: "4:Memory", title: "الذاكرة الأبدية والجلسة الدائمة والمخزن 67.11GB" },
                { id: 5, label: "5:AllApps", title: "فتح كل شيء — دمج وتشغيل جميع شاشات المنصة الـ 32" },
                { id: 6, label: "6:Purple360", title: "خريطة سطح الهجوم 360° + رادار الزوار وتليجرام + Kali Autopilot" },
                { id: 7, label: "7:LiveLab·426", title: "🧪 المختبر السيادي الحي + قاعدة الـ426 ثغرة والدمج + الكتب الـ16" },
              ] as const
            ).map((ws) => (
              <button
                key={ws.id}
                onClick={() => {
                  setActiveWorkspace(ws.id);
                  setMaximizedWin(null);
                }}
                title={ws.title}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                  activeWorkspace === ws.id
                    ? "bg-[#ff2b4d] text-white shadow-[0_0_10px_rgba(255,43,77,0.5)]"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/70"
                }`}
              >
                {ws.label}
              </button>
            ))}
          </div>
        </div>

        {/* Center: Red/Blue/Purple Mode Selector */}
        <div className="hidden lg:flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-[#0c0f17] p-0.5 rounded border border-slate-800" dir="ltr">
            {(
              [
                { id: "RED", label: "RED", color: "bg-[#ff2b4d] text-white" },
                { id: "BLUE", label: "BLUE SOC", color: "bg-cyan-500 text-slate-950" },
                { id: "PURPLE", label: "PURPLE 2099", color: "bg-purple-600 text-white" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => setTeamMode(m.id)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black transition-all ${
                  teamMode === m.id ? m.color : "text-slate-400 hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Left side: System Tray Indicators */}
        <div className="flex items-center gap-1.5" dir="ltr">
          <button
            onClick={() => {
              setActiveWorkspace(1);
              setWinGotopOpen(true);
              setRightMonitorTab("visitors");
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 font-mono text-[10px] font-bold hover:bg-cyan-500/25"
            title="رادار الزوار الفوري وتنبيهات تليجرام"
          >
            <Eye className="w-3 h-3 text-[#ff2b4d]" />
            <span>VIS:{visitorIntel?.visitors?.length ?? 1}</span>
            <span className="text-emerald-300">· TG</span>
          </button>

          <button
            onClick={() => setActiveWorkspace(3)}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-mono text-[10px] font-bold hover:bg-emerald-500/25"
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>{presentTools}/{totalTools}</span>
            <span className="text-cyan-300">+{pyPresent}Py</span>
          </button>

          <button
            onClick={() => setActiveWorkspace(4)}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 font-mono text-[10px] font-bold hover:bg-amber-500/25"
          >
            <Brain className="w-3 h-3 text-amber-400" />
            <span>MEM:{eternalMemory.length}</span>
            <span className="hidden sm:inline text-purple-300">· {storageText}</span>
          </button>

          <button
            onClick={() => setActiveWorkspace(7)}
            className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 font-mono text-[10px] font-bold hover:bg-rose-500/25"
            title="المختبر السيادي الحي + مصفوفة الـ426 ثغرة والدمج + مكتبة الـ16 كتاباً"
          >
            <BookOpen className="w-3 h-3 text-amber-400" />
            <span>426 VULNS · 16 BOOKS</span>
          </button>

          <button
            onClick={() => setActiveWorkspace(6)}
            className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/35 text-purple-300 font-mono text-[10px] font-bold hover:bg-purple-500/25"
            title="خريطة الهجوم 360° + الاتصالات الحية"
          >
            <Network className="w-3 h-3 text-purple-400" />
            <span>{activeNodes}/10 NODES</span>
          </button>

          <button
            onClick={() => void triggerSelfHeal()}
            disabled={healing}
            className="px-2 py-0.5 rounded bg-[#ff2b4d]/20 hover:bg-[#ff2b4d]/35 border border-[#ff2b4d]/50 text-[#ff8fa3] font-mono text-[10px] font-bold flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${healing || loading ? "animate-spin" : ""}`} />
            <span className="hidden md:inline">Heal</span>
          </button>

          <div className="hidden md:block px-2 py-0.5 rounded bg-[#151922] border border-slate-700/70 text-slate-200 font-mono text-[10px]">
            {clockStr}
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════
       * UNIVERSAL FUZZY COMMAND PALETTE OVERLAY (Ctrl+K / ⌘K — KDE Plasma 6.5 Style)
       * ═══════════════════════════════════════════════════════════════════════ */}
      {cmdPaletteOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-start justify-center pt-16 px-4"
          onClick={() => setCmdPaletteOpen(false)}
        >
          <div
            className="w-full max-w-2xl bg-[#111520] border-2 border-purple-500/50 rounded-2xl shadow-[0_25px_80px_rgba(0,0,0,0.95)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 bg-[#0b0e16] border-b border-slate-800 flex items-center gap-2.5">
              <Search className="w-4 h-4 text-purple-400" />
              <input
                value={cmdPaletteQuery}
                onChange={(e) => setCmdPaletteQuery(e.target.value)}
                placeholder="ابحث فورًا في 294 أداة كالي وبايثون، 32 نظامًا، سلاسل Autopilot، والذاكرة الأبدية..."
                className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                autoFocus
              />
              <button
                onClick={() => setCmdPaletteOpen(false)}
                className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-400"
              >
                ESC
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-2.5 space-y-2">
              {/* Matched Platform Apps */}
              <div className="text-[10px] font-bold text-purple-300 px-1">أنظمة وشاشات المنصة (فتح فوري):</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {PLATFORM_APPS.filter(
                  (a) =>
                    !cmdPaletteQuery ||
                    a.name.toLowerCase().includes(cmdPaletteQuery.toLowerCase()) ||
                    a.desc.includes(cmdPaletteQuery),
                )
                  .slice(0, 6)
                  .map((app) => (
                    <button
                      key={app.route}
                      onClick={() => openPlatformAppInDesktop(app)}
                      className="p-2 rounded-lg bg-[#171c2b] hover:bg-purple-500/25 border border-slate-800 text-right flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-cyan-300 truncate">{app.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{app.desc}</div>
                      </div>
                      <span className="text-[9px] font-mono text-purple-300 shrink-0" dir="ltr">
                        {app.route}
                      </span>
                    </button>
                  ))}
              </div>

              {/* Matched Kali & Python Tools */}
              <div className="text-[10px] font-bold text-emerald-400 px-1 pt-1">أدوات كالي وبايثون (شرح + تشغيل):</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {allNormalizedTools
                  .filter(
                    (t) =>
                      !cmdPaletteQuery ||
                      t.name.toLowerCase().includes(cmdPaletteQuery.toLowerCase()) ||
                      t.cat.includes(cmdPaletteQuery),
                  )
                  .slice(0, 10)
                  .map((t) => (
                    <div
                      key={t.name}
                      className="p-2 rounded-lg bg-[#161b26] border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-mono font-bold text-emerald-300" dir="ltr">
                          {t.name}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {toolsGuideMap[t.name]?.title_ar ?? t.cat}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setActiveWorkspace(1);
                            openToolWithAutoHelp(t.name, false);
                          }}
                          className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold"
                        >
                          شرح
                        </button>
                        <button
                          onClick={() => {
                            setActiveWorkspace(1);
                            openToolWithAutoHelp(t.name, true);
                          }}
                          className="px-2 py-0.5 rounded bg-[#ff2b4d] text-white text-[10px] font-bold"
                        >
                          تشغيل
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
       * 2. AUTHENTIC DUAL-COLUMN KALI WHISKER APPLICATION MENU (14 CATEGORIES)
       * ═══════════════════════════════════════════════════════════════════════ */}
      {whiskerOpen && (
        <div
          className="fixed top-10 right-2.5 z-50 w-[760px] max-w-[96vw] h-[560px] bg-[#12151e]/98 backdrop-blur-xl border-2 border-cyan-500/45 rounded-xl shadow-[0_25px_70px_rgba(0,0,0,0.95)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-3 bg-[#0c0e14] border-b border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <KaliLogo2099 size={30} animated />
              <div>
                <div className="text-xs font-black text-white flex items-center gap-2">
                  <span>KALI LINUX 2099 — WHISKER APPLICATION MENU</span>
                  <span className="px-2 py-0.5 rounded bg-[#ff2b4d]/20 text-[#ff8fa3] font-mono text-[10px]">
                    {teamMode} MODE
                  </span>
                </div>
                <div className="text-[11px] text-cyan-400">
                  اضغط على أي أداة لفتح شرحها الكامل وخياراتها وأوامرها التلقائية أو تشغيلها فورًا
                </div>
              </div>
            </div>
            <div className="relative w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={whiskerSearch}
                onChange={(e) => setWhiskerSearch(e.target.value)}
                placeholder="ابحث في 266 أداة + 28 بايثون + 32 تطبيق..."
                className="w-full pr-8 pl-3 py-1.5 rounded bg-[#181c26] border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-400"
                autoFocus
              />
            </div>
          </div>

          <div className="flex-1 flex min-h-0">
            <div className="w-64 bg-[#0e1118] border-l border-slate-800/90 overflow-y-auto p-1.5 space-y-0.5">
              {KALI_WHISKER_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setWhiskerCat(cat.id)}
                  className={`w-full text-right px-2.5 py-2 rounded-lg flex items-center justify-between transition-all ${
                    whiskerCat === cat.id
                      ? "bg-gradient-to-l from-[#ff2b4d]/30 to-cyan-500/20 text-white border border-[#ff2b4d]/50"
                      : "text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold truncate">{cat.ar}</div>
                    <div className="text-[9px] font-mono text-slate-400 truncate" dir="ltr">
                      {cat.label}
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                </button>
              ))}
            </div>

            <div className="flex-1 bg-[#141822] overflow-y-auto p-2.5 space-y-1.5">
              {whiskerCat === "pipelines-8" ? (
                pipelines.map((p) => (
                  <div
                    key={p.id}
                    className="p-2.5 rounded-lg bg-[#1b202e] hover:bg-[#232a3b] border border-slate-700/70 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-xs font-bold text-white">{p.title}</div>
                      <div className="text-[11px] text-slate-400">{p.description}</div>
                    </div>
                    <button
                      onClick={() => {
                        setWhiskerOpen(false);
                        setActiveWorkspace(1);
                        setWinStudioOpen(true);
                        setStudioMode("pipelines");
                        void runPipeline(p.id);
                      }}
                      className="px-3 py-1.5 rounded bg-[#ff2b4d] hover:bg-[#ff4769] text-white text-xs font-bold shrink-0"
                    >
                      تشغيل السلسلة
                    </button>
                  </div>
                ))
              ) : whiskerCat === "platform-routes" ? (
                <div className="grid grid-cols-1 gap-1.5">
                  {PLATFORM_APPS.filter(
                    (a) => !whiskerSearch || a.name.toLowerCase().includes(whiskerSearch.toLowerCase()) || a.desc.includes(whiskerSearch),
                  ).map((app) => (
                    <div
                      key={app.route}
                      className="p-2 rounded-lg bg-[#1b202e] hover:bg-[#22293a] border border-slate-700/70 flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-bold text-cyan-300">{app.name}</div>
                        <div className="text-[10px] text-slate-400">{app.desc}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openPlatformAppInDesktop(app)}
                          className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-500/40 text-cyan-200 text-[10px] font-bold"
                        >
                          فتح داخل كالي
                        </button>
                        <button
                          onClick={() => {
                            setWhiskerOpen(false);
                            setLocation(app.route);
                          }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-mono"
                          dir="ltr"
                        >
                          {app.route}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-1.5">
                  {whiskerTools.slice(0, 120).map((t) => {
                    const g = toolsGuideMap?.[t.name];
                    return (
                      <div
                        key={t.name}
                        className="p-2 rounded-lg bg-[#1b202e]/90 hover:bg-[#232a3c] border border-slate-800 hover:border-cyan-500/40 flex items-center justify-between gap-2 transition-all"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-black text-emerald-300" dir="ltr">
                              {t.name}
                            </span>
                            <span className="text-[11px] font-bold text-white truncate">
                              {g?.title_ar ?? t.cat}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {g?.description_ar ?? `أداة محققة وجاهزة للتشغيل الفوري (${t.cat})`}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openToolWithAutoHelp(t.name, false)}
                            className="px-2 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-500/35 text-cyan-300 text-[10px] font-bold flex items-center gap-1"
                          >
                            <BookOpen className="w-3 h-3" />
                            <span>شرح وأوامر</span>
                          </button>
                          <button
                            onClick={() => openToolWithAutoHelp(t.name, true)}
                            className="px-2 py-1 rounded bg-[#ff2b4d] hover:bg-[#ff4769] text-white text-[10px] font-bold flex items-center gap-1"
                          >
                            <Play className="w-3 h-3" />
                            <span>تشغيل</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
       * 3. MAIN DESKTOP WORKSPACE AREA (LEFT KALI DOCK + 6 WORKSPACE LAYOUTS)
       * ═══════════════════════════════════════════════════════════════════════ */}
      <div className="relative z-10 flex-1 flex min-h-0 overflow-hidden">
        {/* Authentic Kali Left Dock */}
        <aside className="w-12 bg-[#0d1017]/90 backdrop-blur-md border-l border-slate-800/80 flex flex-col items-center py-2.5 gap-2 shrink-0 z-30 shadow-xl">
          <button
            onClick={() => setWhiskerOpen((v) => !v)}
            className="p-2 rounded-xl bg-[#ff2b4d]/20 hover:bg-[#ff2b4d]/40 border border-[#ff2b4d]/50 text-white transition-all"
            title="قائمة كالي الرئيسية (Whisker Menu)"
          >
            <KaliLogo2099 size={20} animated={false} />
          </button>

          <div className="w-6 h-px bg-slate-800" />

          <button
            onClick={() => setActiveWorkspace(1)}
            className={`p-2 rounded-xl transition-all ${
              activeWorkspace === 1 ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50" : "text-slate-400 hover:bg-slate-800/70"
            }`}
            title="1: سطح المكتب الرباعي المتكامل"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveWorkspace(2)}
            className={`p-2 rounded-xl transition-all ${
              activeWorkspace === 2 ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50" : "text-slate-400 hover:bg-slate-800/70"
            }`}
            title="2: التريمنال المزدوج + ترمنال المساعد الذكي"
          >
            <TerminalIcon className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveWorkspace(3)}
            className={`p-2 rounded-xl transition-all ${
              activeWorkspace === 3 ? "bg-[#ff2b4d]/25 text-[#ff8fa3] border border-[#ff2b4d]/50" : "text-slate-400 hover:bg-slate-800/70"
            }`}
            title="3: موسوعة ومشغل الـ 294 أداة بالوصف الكامل"
          >
            <Wrench className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveWorkspace(4)}
            className={`p-2 rounded-xl transition-all ${
              activeWorkspace === 4 ? "bg-amber-500/25 text-amber-300 border border-amber-500/50" : "text-slate-400 hover:bg-slate-800/70"
            }`}
            title="4: الذاكرة الأبدية والجلسة الدائمة"
          >
            <Brain className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveWorkspace(5)}
            className={`p-2 rounded-xl transition-all ${
              activeWorkspace === 5 ? "bg-purple-500/25 text-purple-300 border border-purple-500/50" : "text-slate-400 hover:bg-slate-800/70"
            }`}
            title="5: فتح كل شيء (32 نظامًا مدمجًا)"
          >
            <Compass className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveWorkspace(6)}
            className={`p-2 rounded-xl transition-all ${
              activeWorkspace === 6 ? "bg-pink-500/25 text-pink-300 border border-pink-500/50" : "text-slate-400 hover:bg-slate-800/70"
            }`}
            title="6: خريطة سطح الهجوم 360° + Kali Autopilot + مركز الاتصالات"
          >
            <Network className="w-4 h-4" />
          </button>

          <div className="mt-auto flex flex-col items-center gap-1.5">
            <button
              onClick={() => setCmdPaletteOpen(true)}
              className="p-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/35 border border-purple-500/40 text-purple-300"
              title="البحث الشامل الفوري (Ctrl+K)"
            >
              <Command className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLocation("/classic-dashboard")}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300"
              title="لوحة القيادة الكلاسيكية (/classic-dashboard)"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </aside>

        {/* ── DESKTOP CANVAS ── */}
        <main className="relative flex-1 min-w-0 min-h-0 p-2 overflow-hidden flex flex-col">
          {/* ═════════════════════════════════════════════════════════════════
           * WORKSPACE 1: AUTHENTIC 4-WINDOW KALI LINUX DESKTOP (WITH MAXIMIZE)
           * ═════════════════════════════════════════════════════════════════ */}
          {activeWorkspace === 1 && (
            <div className="relative z-10 flex-1 grid grid-cols-12 gap-2.5 min-h-0">
              <div
                className={`${
                  maximizedWin === "gotop"
                    ? "hidden"
                    : winGotopOpen && !maximizedWin
                      ? "col-span-12 lg:col-span-8"
                      : "col-span-12"
                } flex flex-col gap-2.5 min-h-0`}
              >
                {/* TOP ROW: Window 1 (Thunar File Manager) + Window 2 (Kali Multi-Studio) */}
                {(winThunarOpen || winStudioOpen) && maximizedWin !== "terminal" && (
                  <div
                    className={`${
                      maximizedWin === "thunar" || maximizedWin === "studio"
                        ? "flex-1"
                        : winTerminalOpen
                          ? "h-[46%]"
                          : "flex-1"
                    } grid grid-cols-12 gap-2.5 min-h-0`}
                  >
                    {/* WINDOW 1: THUNAR GRAPHICAL FILE MANAGER */}
                    {winThunarOpen && maximizedWin !== "studio" && (
                      <section
                        onClick={() => setFocusedWin("thunar")}
                        className={`${
                          maximizedWin === "thunar" || !winStudioOpen ? "col-span-12" : "col-span-12 xl:col-span-5"
                        } bg-[#141821]/95 backdrop-blur-md rounded-lg border ${
                          focusedWin === "thunar" ? "border-cyan-400/75 shadow-[0_0_25px_rgba(56,189,248,0.2)]" : "border-slate-700/80"
                        } flex flex-col min-h-0 overflow-hidden`}
                      >
                        <div className="h-7 bg-[#0d1017] border-b border-slate-800 px-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-[11px] font-bold text-slate-200 font-mono" dir="ltr">
                              root - Thunar ({fsScope === "workspace" ? `/workspaces${fsPath}` : fsPath})
                            </span>
                          </div>
                          <div className="flex items-center gap-1" dir="ltr">
                            <button
                              onClick={() => setMaximizedWin((m) => (m === "thunar" ? null : "thunar"))}
                              className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-cyan-300"
                            >
                              <Maximize2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setWinThunarOpen(false)}
                              className="p-0.5 rounded hover:bg-[#ff2b4d] text-slate-400 hover:text-white"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div className="h-8 bg-[#181c26] border-b border-slate-800 px-2 flex items-center gap-1.5" dir="ltr">
                          <button
                            onClick={() => {
                              if (fsPath === "/") return;
                              const parts = fsPath.split("/").filter(Boolean);
                              parts.pop();
                              void loadFs(fsScope, "/" + parts.join("/"));
                            }}
                            className="p-1 rounded bg-[#212736] hover:bg-slate-700 text-slate-200"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => void loadFs(fsScope, "/")}
                            className="p-1 rounded bg-[#212736] hover:bg-slate-700 text-cyan-400"
                          >
                            <Home className="w-3 h-3" />
                          </button>
                          <div className="flex-1 bg-[#0e1118] border border-slate-700/80 rounded px-2 py-0.5 text-[11px] font-mono text-cyan-300 truncate">
                            {fsScope === "workspace" ? `/opt/nova-workspaces${fsPath}` : fsPath}
                          </div>
                          <button
                            onClick={() => void loadFs("workspace", "/")}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              fsScope === "workspace" ? "bg-[#ff2b4d] text-white" : "bg-[#212736] text-slate-300"
                            }`}
                          >
                            Workspaces
                          </button>
                          <button
                            onClick={() => void loadFs("kali", "/")}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              fsScope === "kali" ? "bg-cyan-500 text-slate-950" : "bg-[#212736] text-slate-300"
                            }`}
                          >
                            Rootfs
                          </button>
                        </div>

                        <div
                          className="bg-[#d97706]/90 text-slate-950 px-2.5 py-0.5 text-[10px] font-bold flex items-center gap-1.5"
                          dir="ltr"
                        >
                          <AlertTriangle className="w-3 h-3 text-slate-950 shrink-0" />
                          <span>Warning: you are using the root account (uid=0) — Eternal Session Active.</span>
                        </div>

                        <div className="flex-1 flex min-h-0" dir="ltr">
                          <div className="w-32 bg-[#10131b] border-r border-slate-800 p-1.5 overflow-y-auto space-y-0.5 text-[10px] font-mono">
                            <div className="text-[9px] font-bold text-slate-500 px-1">PLACES</div>
                            {[
                              { label: "root (/root)", scope: "kali" as const, path: "/root" },
                              { label: "File System (/)", scope: "kali" as const, path: "/" },
                              { label: "/usr/local/bin", scope: "kali" as const, path: "/usr/local/bin" },
                              { label: "/opt/nova-venv", scope: "kali" as const, path: "/opt/nova-venv/bin" },
                              { label: "recon-lab", scope: "workspace" as const, path: "/recon-lab" },
                              { label: "web-audit", scope: "workspace" as const, path: "/web-audit" },
                              { label: "cloud-osint", scope: "workspace" as const, path: "/cloud-osint" },
                            ].map((pl) => (
                              <button
                                key={pl.label}
                                onClick={() => {
                                  setFsScope(pl.scope);
                                  void loadFs(pl.scope, pl.path);
                                }}
                                className="w-full text-left px-1.5 py-1 rounded hover:bg-slate-800 text-slate-300 flex items-center gap-1.5 truncate"
                              >
                                <Folder className="w-3 h-3 text-cyan-400 shrink-0" />
                                <span className="truncate">{pl.label}</span>
                              </button>
                            ))}
                          </div>

                          <div className="flex-1 bg-[#161a24] p-2 overflow-y-auto">
                            {fsLoading ? (
                              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                                جاري قراءة نظام ملفات كالي...
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                                {fsEntries.map((ent) => (
                                  <button
                                    key={ent.name}
                                    onClick={() => {
                                      setSelectedFile(ent.name);
                                      const nextPath = `${fsPath === "/" ? "" : fsPath}/${ent.name}`;
                                      void loadFs(fsScope, nextPath);
                                    }}
                                    className={`p-1.5 rounded-lg flex flex-col items-center text-center transition-all border ${
                                      selectedFile === ent.name
                                        ? "bg-cyan-500/20 border-cyan-400/60"
                                        : "border-transparent hover:bg-slate-800/70"
                                    }`}
                                  >
                                    {ent.type === "dir" ? (
                                      <Folder className="w-7 h-7 text-[#38bdf8] fill-[#38bdf8]/25 mb-1" />
                                    ) : (
                                      <FileCode className="w-7 h-7 text-emerald-400 mb-1" />
                                    )}
                                    <span className="text-[10px] font-mono text-slate-200 line-clamp-1 break-all">
                                      {ent.name}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </section>
                    )}

                    {/* WINDOW 2: KALI MULTI-STUDIO (LIVE X11 :99 / 360° GRAPH / AUTOPILOT / EDITOR / BROWSER / PIPELINES) */}
                    {winStudioOpen && maximizedWin !== "thunar" && (
                      <section
                        onClick={() => setFocusedWin("studio")}
                        className={`${
                          maximizedWin === "studio" || !winThunarOpen ? "col-span-12" : "col-span-12 xl:col-span-7"
                        } bg-[#141821]/95 backdrop-blur-md rounded-lg border ${
                          focusedWin === "studio" ? "border-[#ff2b4d]/80 shadow-[0_0_25px_rgba(255,43,77,0.2)]" : "border-slate-700/80"
                        } flex flex-col min-h-0 overflow-hidden`}
                      >
                        <div className="h-7 bg-[#0d1017] border-b border-slate-800 px-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-1 overflow-x-auto">
                            {(
                              [
                                { id: "x11", label: "Live X11 :99" },
                                { id: "graph", label: "360° Attack Graph" },
                                { id: "autopilot", label: "Kali Autopilot" },
                                { id: "editor", label: "Mousepad" },
                                { id: "browser", label: "Cyber Browser" },
                                { id: "pipelines", label: "8 Pipelines" },
                              ] as const
                            ).map((m) => (
                              <button
                                key={m.id}
                                onClick={() => setStudioMode(m.id)}
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all shrink-0 ${
                                  studioMode === m.id
                                    ? "bg-[#ff2b4d] text-white"
                                    : "bg-[#181c26] text-slate-400 hover:text-white"
                                }`}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1" dir="ltr">
                            <button
                              onClick={() => setMaximizedWin((m) => (m === "studio" ? null : "studio"))}
                              className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-cyan-300"
                            >
                              <Maximize2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setWinStudioOpen(false)}
                              className="p-0.5 rounded hover:bg-[#ff2b4d] text-slate-400 hover:text-white"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                          {studioMode === "x11" && (
                            <div className="flex-1 flex flex-col min-h-0">
                              <div className="h-7 bg-[#181c26] border-b border-slate-800 px-2 flex items-center justify-between gap-1 overflow-x-auto">
                                <div className="flex items-center gap-1">
                                  {QUICK_DESKTOP_LAUNCHERS.map((app) => (
                                    <button
                                      key={app.id}
                                      onClick={() => void runDesktopAction("exec", app.cmd)}
                                      className="px-1.5 py-0.5 rounded bg-[#222836] hover:bg-[#ff2b4d] text-[10px] font-mono text-slate-200 hover:text-white shrink-0"
                                    >
                                      {app.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => setAutoStream((v) => !v)}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                      autoStream ? "bg-emerald-500/25 text-emerald-300" : "bg-slate-800 text-slate-400"
                                    }`}
                                  >
                                    {autoStream ? "AUTO:ON" : "AUTO:OFF"}
                                  </button>
                                  <button
                                    onClick={() => void captureDesktopFrame(true)}
                                    className="px-1.5 py-0.5 rounded bg-[#ff2b4d] text-white text-[10px] font-bold"
                                  >
                                    تحديث :99
                                  </button>
                                </div>
                              </div>
                              <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
                                {desktopFrame ? (
                                  <img src={desktopFrame} alt="Kali X11 :99" className="w-full h-full object-contain" />
                                ) : (
                                  <div className="text-xs text-slate-400 font-mono">
                                    {desktopLoading ? "جاري التقاط بث X11 :99..." : "اضغط تحديث :99 لعرض سطح المكتب"}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* 360° LIVE ATTACK SURFACE TOPOLOGY GRAPH */}
                          {studioMode === "graph" && (
                            <div className="flex-1 flex flex-col p-2.5 gap-2 min-h-0 overflow-y-auto">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-black text-purple-300">
                                  خريطة سطح الهجوم والأصول الحية 360° للهدف: {attackGraph?.target || activeTarget}
                                </span>
                                <button
                                  onClick={() => void loadAttackGraph(activeTarget)}
                                  className="px-2.5 py-0.5 rounded bg-purple-600 text-white text-[10px] font-bold"
                                >
                                  تحديث الخريطة
                                </button>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                {(attackGraph?.nodes ?? []).map((n) => (
                                  <div
                                    key={n.id}
                                    onClick={() => setSelectedGraphNode(n)}
                                    className={`p-2 rounded-lg border cursor-pointer transition-all ${
                                      selectedGraphNode?.id === n.id
                                        ? "bg-purple-500/20 border-purple-400"
                                        : "bg-[#0e1118] border-slate-800 hover:border-cyan-500/40"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-mono font-bold text-cyan-300" dir="ltr">
                                        {n.label}
                                      </span>
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/50 text-emerald-300 font-mono">
                                        {n.type.toUpperCase()}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-1 line-clamp-1">{n.detail}</div>
                                  </div>
                                ))}
                              </div>
                              {selectedGraphNode && (
                                <div className="p-2 rounded-lg bg-[#0b0e15] border border-cyan-500/40 flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-bold text-white">{selectedGraphNode.detail}</div>
                                    <div className="text-[10px] font-mono text-emerald-300 truncate" dir="ltr">
                                      $ {selectedGraphNode.recommendedCmd}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => {
                                      setTermCmd(selectedGraphNode.recommendedCmd);
                                      void execInTerminal(selectedGraphNode.recommendedCmd);
                                    }}
                                    className="px-2.5 py-1 rounded bg-[#ff2b4d] text-white text-[10px] font-bold shrink-0"
                                  >
                                    فحص العقدة ▶
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* KALI AUTOPILOT 2099 CHAIN BUILDER */}
                          {studioMode === "autopilot" && (
                            <div className="flex-1 flex flex-col p-2.5 gap-2 min-h-0 overflow-y-auto">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                {autopilotTemplates.map((tpl) => (
                                  <div
                                    key={tpl.id}
                                    className="p-2 rounded-lg bg-[#0e1118] border border-slate-800 flex items-center justify-between gap-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-bold text-white truncate">{tpl.title_ar}</div>
                                      <div className="text-[9px] font-mono text-purple-300">{tpl.nistPhase}</div>
                                    </div>
                                    <button
                                      onClick={() => void runAutopilotChain(tpl.id)}
                                      disabled={autopilotRunningId !== null}
                                      className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold shrink-0"
                                    >
                                      {autopilotRunningId === tpl.id ? "..." : "تشغيل Autopilot"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                              {autopilotOutput && (
                                <pre
                                  dir="ltr"
                                  className="p-2 rounded bg-black/90 border border-purple-500/40 text-[10px] font-mono text-emerald-300 max-h-36 overflow-y-auto whitespace-pre-wrap"
                                >
                                  {autopilotOutput}
                                </pre>
                              )}
                            </div>
                          )}

                          {studioMode === "editor" && (
                            <div className="flex-1 flex flex-col p-2 gap-1.5 min-h-0">
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={editorPath}
                                  onChange={(e) => setEditorPath(e.target.value)}
                                  dir="ltr"
                                  className="flex-1 px-2 py-1 rounded bg-[#0c0e14] border border-slate-700 text-xs font-mono text-emerald-300"
                                />
                                <button
                                  onClick={() => void saveEditorFile()}
                                  disabled={fsSaving}
                                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1"
                                >
                                  <Save className="w-3 h-3" />
                                  <span>حفظ</span>
                                </button>
                                <button
                                  onClick={() => void execInTerminal(`bash /opt/nova-workspaces/${editorPath}`)}
                                  className="px-2.5 py-1 rounded bg-[#ff2b4d] hover:bg-[#ff4769] text-white text-xs font-bold flex items-center gap-1"
                                >
                                  <Play className="w-3 h-3" />
                                  <span>تشغيل</span>
                                </button>
                              </div>
                              <textarea
                                value={editorContent}
                                onChange={(e) => setEditorContent(e.target.value)}
                                dir="ltr"
                                className="flex-1 w-full p-2.5 rounded bg-[#090b10] border border-slate-800 text-xs font-mono text-emerald-300 focus:outline-none resize-none"
                              />
                            </div>
                          )}

                          {studioMode === "browser" && (
                            <div className="flex-1 flex flex-col p-2 gap-1.5 min-h-0 overflow-y-auto">
                              <div className="flex items-center gap-1.5" dir="ltr">
                                <input
                                  value={browserUrl}
                                  onChange={(e) => setBrowserUrl(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && void runCyberBrowser(browserUrl)}
                                  className="flex-1 px-2.5 py-1 rounded bg-[#0c0e14] border border-slate-700 text-xs font-mono text-cyan-300"
                                />
                                <button
                                  onClick={() => void runCyberBrowser(browserUrl)}
                                  disabled={browserLoading}
                                  className="px-3 py-1 rounded bg-[#ff2b4d] text-white text-xs font-bold"
                                >
                                  {browserLoading ? "..." : "فحص الموقع"}
                                </button>
                              </div>
                              {browserData && (
                                <div className="space-y-1.5 text-[11px]">
                                  <div className="p-2 rounded bg-[#0e1118] border border-slate-800 flex items-center justify-between" dir="ltr">
                                    <span className="font-mono font-bold text-white">{browserData.title || browserData.host}</span>
                                    <span className="text-emerald-400 font-mono">
                                      HTTP {browserData.statusCode} · {browserData.tls?.version ?? "TLS"}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1">
                                    {(Array.isArray(browserData.securityAudit) ? browserData.securityAudit : []).map((h) => (
                                      <div
                                        key={h.header}
                                        className={`p-1.5 rounded border text-[10px] font-mono ${
                                          h.present
                                            ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                                            : "bg-rose-950/20 border-rose-500/30 text-rose-300"
                                        }`}
                                        dir="ltr"
                                      >
                                        {h.present ? "✓" : "✗"} {h.header}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {studioMode === "pipelines" && (
                            <div className="flex-1 flex flex-col p-2 gap-1.5 min-h-0 overflow-y-auto">
                              <div className="grid grid-cols-2 gap-1.5">
                                {pipelines.map((p) => (
                                  <div key={p.id} className="p-2 rounded bg-[#0e1118] border border-slate-800 flex items-center justify-between gap-1">
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-bold text-white truncate">{p.title}</div>
                                      <div className="text-[9px] font-mono text-cyan-400 truncate">
                                        {(Array.isArray(p.tools) ? p.tools : []).join(" · ")}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => void runPipeline(p.id)}
                                      disabled={runningPipeId !== null}
                                      className="px-2 py-1 rounded bg-[#ff2b4d] text-white text-[10px] font-bold shrink-0"
                                    >
                                      {runningPipeId === p.id ? "..." : "تشغيل"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                              {pipeOutput && (
                                <pre
                                  dir="ltr"
                                  className="p-2 rounded bg-black/90 border border-slate-800 text-[10px] font-mono text-emerald-300 max-h-32 overflow-y-auto whitespace-pre-wrap"
                                >
                                  {pipeOutput}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      </section>
                    )}
                  </div>
                )}

                {/* BOTTOM ROW: WINDOW 3 — MULTI-TAB PERSISTENT `qterminal` + AUTO-HELP + AI CO-PILOT */}
                {winTerminalOpen && maximizedWin !== "thunar" && maximizedWin !== "studio" && (
                  <section
                    onClick={() => setFocusedWin("terminal")}
                    className="flex-1 bg-[#0b0d13]/95 backdrop-blur-md rounded-lg border border-emerald-500/45 shadow-[0_0_30px_rgba(16,185,129,0.15)] flex flex-col min-h-0 overflow-hidden"
                  >
                    <div className="h-8 bg-[#121620] border-b border-slate-800 px-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 overflow-x-auto" dir="ltr">
                        <TerminalIcon className="w-3.5 h-3.5 text-emerald-400 mr-1 shrink-0" />
                        {terminalTabs.map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTabId(tab.id)}
                            className={`px-2.5 py-1 rounded-t text-[10px] font-mono font-bold flex items-center gap-1.5 border-t border-x transition-all ${
                              activeTabId === tab.id
                                ? "bg-[#0b0d13] text-emerald-300 border-emerald-500/45"
                                : "bg-[#161b26] text-slate-400 border-transparent hover:text-white"
                            }`}
                          >
                            <span>{tab.title}</span>
                            {terminalTabs.length > 1 && (
                              <span onClick={(e) => closeTerminalTab(tab.id, e)} className="hover:text-[#ff2b4d] px-0.5">
                                ×
                              </span>
                            )}
                          </button>
                        ))}
                        <button
                          onClick={addNewTerminalTab}
                          className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-mono font-bold"
                        >
                          + Tab
                        </button>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setTermSideMode("auto-help")}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                            termSideMode === "auto-help"
                              ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          <BookOpen className="w-3 h-3" />
                          <span>مساعد الأدوات التلقائي</span>
                        </button>
                        <button
                          onClick={() => setTermSideMode("assistant")}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                            termSideMode === "assistant"
                              ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          <Bot className="w-3 h-3" />
                          <span>ترمنال المساعد الذكي</span>
                        </button>
                        <button
                          onClick={() => setMaximizedWin((m) => (m === "terminal" ? null : "terminal"))}
                          className="p-1 rounded hover:bg-slate-700 text-slate-300"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 grid grid-cols-12 min-h-0 overflow-hidden">
                      <div className="col-span-12 lg:col-span-7 flex flex-col min-h-0 border-l border-slate-800/90" dir="ltr">
                        <div className="flex-1 overflow-y-auto p-2.5 font-mono text-[11px] space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-slate-400 bg-[#11151f] px-2.5 py-1 rounded border border-slate-800/80">
                            <span className="text-cyan-400 font-bold">
                              root@kali-2099 ({activeTab?.cwd || sessionCwd})
                            </span>
                            <span className="text-emerald-400">
                              Eternal Session · 266 Kali + 28 Py · Target: {activeTarget}
                            </span>
                          </div>

                          <div className="space-y-0.5 pt-1">
                            {(Array.isArray(activeTab?.lines) ? activeTab.lines : []).map((ln, idx) => (
                              <div
                                key={idx}
                                className={`whitespace-pre-wrap break-all leading-relaxed ${
                                  ln.startsWith("┌──") || ln.startsWith("└─#")
                                    ? "text-cyan-300 font-bold"
                                    : ln.startsWith("[✓")
                                      ? "text-emerald-400"
                                      : ln.startsWith("[✗]")
                                        ? "text-[#ff2b4d]"
                                        : "text-slate-200"
                                }`}
                              >
                                {ln}
                              </div>
                            ))}
                            <div ref={termBottomRef} />
                          </div>
                        </div>

                        <div className="bg-[#10141d] border-t border-slate-800/80 px-2.5 py-1 flex items-center justify-between gap-2 overflow-x-auto">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold">
                              {currentToolGuide.tool}
                            </span>
                            <span className="text-[10px] text-slate-300 truncate max-w-[220px]" dir="rtl">
                              {currentToolGuide.title_ar}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {currentToolGuide.flags.slice(0, 4).map((f) => (
                              <button
                                key={f.flag}
                                onClick={() => setTermCmd((prev) => `${prev.trim()} ${f.flag.split(" ")[0]}`)}
                                title={f.desc_ar}
                                className="px-1.5 py-0.5 rounded bg-[#1a2030] hover:bg-cyan-500/25 text-cyan-300 font-mono text-[9px] border border-cyan-500/25"
                              >
                                +{f.flag.split(" ")[0]}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="h-9 bg-[#07090e] border-t border-slate-800 px-2.5 flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-[#ff2b4d] shrink-0">
                            root💀kali:~#
                          </span>
                          <input
                            value={termCmd}
                            onChange={(e) => setTermCmd(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                void execInTerminal();
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                const hist = Array.isArray(activeTab?.history) ? activeTab.history : [];
                                if (hist.length > 0) {
                                  const nextIdx = historyIdx < 0 ? hist.length - 1 : Math.max(0, historyIdx - 1);
                                  setHistoryIdx(nextIdx);
                                  setTermCmd(hist[nextIdx]);
                                }
                              }
                            }}
                            placeholder="اكتب أي أمر كالي (مثل nmap, nuclei, subfinder, sqlmap, trivy) — الوصف يظهر تلقائيًا..."
                            className="flex-1 bg-transparent text-xs font-mono text-emerald-300 focus:outline-none"
                          />
                          <button
                            onClick={() => void execInTerminal()}
                            disabled={termRunning}
                            className="px-3 py-1 rounded bg-[#ff2b4d] hover:bg-[#ff4769] text-white text-[10px] font-mono font-bold shrink-0"
                          >
                            {termRunning ? "RUNNING..." : "EXEC ↵"}
                          </button>
                        </div>
                      </div>

                      <div className="col-span-12 lg:col-span-5 bg-[#0f131c] flex flex-col min-h-0 overflow-hidden" dir="rtl">
                        {termSideMode === "auto-help" ? (
                          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800">
                              <div>
                                <div className="text-xs font-black text-cyan-300 flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-[#ff2b4d]" />
                                  <span>المساعد التلقائي للأدوات والوصف الحي</span>
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  يشرح الأداة التي تكتبها أو تختارها ويعطيك أوامرها الجاهزة فورًا
                                </div>
                              </div>
                              <button
                                onClick={() => void fetchLiveCliHelp(currentToolGuide.tool)}
                                disabled={loadingLiveHelp}
                                className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-500/40 text-cyan-200 text-[10px] font-mono font-bold shrink-0"
                              >
                                {loadingLiveHelp ? "..." : "جلب --help الحي"}
                              </button>
                            </div>

                            <div className="flex items-center gap-1 overflow-x-auto pb-1" dir="ltr">
                              {["nmap", "nuclei", "subfinder", "httpx", "sqlmap", "ffuf", "trivy", "netexec", "radare2"].map((t) => (
                                <button
                                  key={t}
                                  onClick={() => setInspectedTool(t)}
                                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold shrink-0 ${
                                    currentToolGuide.tool === t
                                      ? "bg-[#ff2b4d] text-white"
                                      : "bg-[#181e2c] text-slate-300 hover:bg-slate-700"
                                  }`}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>

                            <div className="p-2.5 rounded-lg bg-[#151a26] border border-cyan-500/30 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-black text-white">{currentToolGuide.title_ar}</span>
                                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]" dir="ltr">
                                  {currentToolGuide.binaryPath}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-300 leading-relaxed">{currentToolGuide.description_ar}</p>
                            </div>

                            <div className="space-y-1">
                              <div className="text-[10px] font-bold text-emerald-400">
                                أوامر تكتيكية جاهزة للهدف ({activeTarget}):
                              </div>
                              {currentToolGuide.recipes.map((r, i) => (
                                <div
                                  key={i}
                                  className="p-2 rounded bg-[#141923] border border-slate-800 hover:border-emerald-500/40 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold text-white">{r.label_ar}</span>
                                    <button
                                      onClick={() => {
                                        setTermCmd(r.cmd);
                                        void execInTerminal(r.cmd);
                                      }}
                                      className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-bold"
                                    >
                                      تشغيل ▶
                                    </button>
                                  </div>
                                  <div className="text-[10px] font-mono text-emerald-300 bg-black/50 px-2 py-1 rounded truncate" dir="ltr">
                                    {r.cmd}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {liveToolHelpText && (
                              <pre
                                dir="ltr"
                                className="p-2 rounded bg-black/90 border border-cyan-500/40 text-[10px] font-mono text-cyan-200 max-h-40 overflow-y-auto whitespace-pre-wrap"
                              >
                                {liveToolHelpText}
                              </pre>
                            )}
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col min-h-0">
                            <div className="p-2 bg-[#131824] border-b border-slate-800 flex items-center justify-between gap-1 overflow-x-auto">
                              {[
                                { label: "🛰️ استطلاع دومين", q: "خطة استطلاع دومين شامل" },
                                { label: "🛡️ فحص ويب وثغرات", q: "فحص ثغرات موقع ويب" },
                                { label: "☁️ فحص سحابة وبايثون", q: "فحص كلاود وحاويات وبايثون" },
                                { label: "🔍 اشرح آخر أمر", q: "شرح وتحليل آخر أمر وناتجه" },
                              ].map((chip) => (
                                <button
                                  key={chip.label}
                                  onClick={() => void askAssistant(chip.q)}
                                  className="px-2 py-0.5 rounded bg-[#1c2333] hover:bg-emerald-500/25 border border-emerald-500/30 text-[10px] text-emerald-300 font-bold shrink-0"
                                >
                                  {chip.label}
                                </button>
                              ))}
                            </div>

                            <div className="flex-1 overflow-y-auto p-2.5 space-y-2 text-[11px]">
                              {assistantHistory.map((msg) => (
                                <div
                                  key={msg.id}
                                  className={`p-2.5 rounded-lg border ${
                                    msg.role === "user"
                                      ? "bg-[#1b2232] border-cyan-500/35 text-cyan-200 mr-4"
                                      : "bg-[#131822] border-emerald-500/35 text-slate-200 ml-2"
                                  }`}
                                >
                                  <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                                  {Array.isArray(msg.commands) && msg.commands.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {msg.commands.map((c, idx) => (
                                        <div
                                          key={idx}
                                          className="p-1.5 rounded bg-black/50 border border-slate-800 flex items-center justify-between gap-2"
                                        >
                                          <div className="min-w-0">
                                            <div className="text-[10px] font-bold text-emerald-300">{c.label}</div>
                                            <div className="text-[9px] font-mono text-slate-400 truncate" dir="ltr">
                                              {c.cmd}
                                            </div>
                                          </div>
                                          <button
                                            onClick={() => {
                                              setTermCmd(c.cmd);
                                              void execInTerminal(c.cmd);
                                            }}
                                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shrink-0"
                                          >
                                            تنفيذ ▶
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                              <div ref={assistantBottomRef} />
                            </div>

                            <div className="h-9 bg-[#090c12] border-t border-slate-800 px-2 flex items-center gap-1.5">
                              <Bot className="w-4 h-4 text-emerald-400 shrink-0" />
                              <input
                                value={assistantInput}
                                onChange={(e) => setAssistantInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && void askAssistant()}
                                placeholder="اسأل المساعد الذكي عن أي أداة أو هدف أو خطة فحص..."
                                className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                              />
                              <button
                                onClick={() => void askAssistant()}
                                disabled={assistantBusy}
                                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold"
                              >
                                {assistantBusy ? "..." : "توجيه"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </div>

              {/* RIGHT VERTICAL COLUMN: WINDOW 4 (`gotop` + Eternal Memory + Live Connections) */}
              {winGotopOpen && maximizedWin !== "thunar" && maximizedWin !== "studio" && maximizedWin !== "terminal" && (
                <section
                  onClick={() => setFocusedWin("gotop")}
                  className={`${
                    maximizedWin === "gotop" ? "col-span-12" : "col-span-12 lg:col-span-4"
                  } bg-[#0e1118]/95 backdrop-blur-md rounded-lg border ${
                    focusedWin === "gotop" ? "border-[#ff2b4d]/80 shadow-[0_0_25px_rgba(255,43,77,0.2)]" : "border-slate-700/80"
                  } flex flex-col min-h-0 overflow-hidden`}
                >
                  <div className="h-7 bg-[#090b10] border-b border-slate-800 px-2 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setRightMonitorTab("gotop")}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          rightMonitorTab === "gotop" ? "bg-[#ff2b4d] text-white" : "text-slate-400 hover:text-white"
                        }`}
                      >
                        gotop
                      </button>
                      <button
                        onClick={() => setRightMonitorTab("memory")}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          rightMonitorTab === "memory" ? "bg-amber-500 text-slate-950" : "text-amber-300"
                        }`}
                      >
                        الذاكرة ({eternalMemory.length})
                      </button>
                      <button
                        onClick={() => setRightMonitorTab("connections")}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          rightMonitorTab === "connections" ? "bg-purple-600 text-white" : "text-purple-300"
                        }`}
                      >
                        الاتصالات ({connections.length || 7})
                      </button>
                      <button
                        onClick={() => setRightMonitorTab("visitors")}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          rightMonitorTab === "visitors" ? "bg-cyan-500 text-slate-950" : "text-cyan-300"
                        }`}
                      >
                        👁️ الزوار+تليجرام ({visitorIntel?.visitors?.length ?? 1})
                      </button>
                    </div>
                    <div className="flex items-center gap-1" dir="ltr">
                      <button
                        onClick={() => setMaximizedWin((m) => (m === "gotop" ? null : "gotop"))}
                        className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-cyan-300"
                      >
                        <Maximize2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setWinGotopOpen(false)}
                        className="p-0.5 rounded hover:bg-[#ff2b4d] text-slate-400 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {rightMonitorTab === "gotop" && (
                    <div className="flex-1 overflow-y-auto p-2.5 space-y-2 font-mono text-[11px]" dir="ltr">
                      <div className="p-2 rounded bg-[#080a0f] border border-slate-800">
                        <div className="flex items-center justify-between text-[10px] text-cyan-400 font-bold mb-1.5">
                          <span>┌─ CPU Usage (12 Cores · x86_64) ─┐</span>
                          <span className="text-emerald-400">LOAD: 0.42</span>
                        </div>
                        <div className="space-y-1.5">
                          {cpuTicks.map((series, cIdx) => {
                            const latest = series[series.length - 1];
                            const colors = ["bg-cyan-400", "bg-[#ff2b4d]", "bg-emerald-400", "bg-amber-400"];
                            return (
                              <div key={cIdx} className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400 w-10">CPU{cIdx}</span>
                                <div className="flex-1 h-2.5 bg-slate-900 rounded overflow-hidden flex items-center p-0.5">
                                  <div
                                    className={`h-full ${colors[cIdx % colors.length]} rounded transition-all duration-500`}
                                    style={{ width: `${latest}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-white w-9 text-right">{latest}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* NIST CSF 2.0 Kali Purple Posture */}
                      <div className="p-2 rounded bg-[#080a0f] border border-purple-500/30" dir="rtl">
                        <div className="text-[10px] font-bold text-purple-300 mb-1.5">
                          مصفوفة Kali Purple (NIST CSF 2.0 — 6 وظائف):
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {(attackGraph?.nistCsf2 ?? []).map((p) => (
                            <div key={p.id} className="p-1.5 rounded bg-[#121622] border border-slate-800 flex items-center justify-between">
                              <span className="text-[10px] text-slate-200 truncate">{p.title_ar}</span>
                              <span className="text-[9px] font-mono text-emerald-400 font-bold">{p.score}%</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-2 rounded bg-[#080a0f] border border-slate-800" dir="rtl">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold text-cyan-300">فتح سريع لأنظمة المنصة:</span>
                          <button onClick={() => setActiveWorkspace(5)} className="text-[9px] text-[#ff8fa3] hover:underline">
                            عرض الـ 32 نظامًا ←
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {PLATFORM_APPS.slice(0, 6).map((app) => (
                            <button
                              key={app.route}
                              onClick={() => openPlatformAppInDesktop(app)}
                              className="p-1.5 rounded bg-[#141925] hover:bg-cyan-500/20 border border-slate-800 text-right text-[10px] text-slate-200 truncate"
                            >
                              {app.name.split("(")[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {rightMonitorTab === "memory" && (
                    <div className="flex-1 flex flex-col min-h-0 p-2 gap-2" dir="rtl">
                      <div className="flex items-center gap-1">
                        <input
                          value={newMemoryTitle}
                          onChange={(e) => setNewMemoryTitle(e.target.value)}
                          placeholder="احفظ ملاحظة أو ثغرة أبدية..."
                          className="flex-1 px-2 py-1 rounded bg-[#141824] border border-slate-700 text-xs text-white"
                        />
                        <button
                          onClick={() => void saveNoteToEternalMemory()}
                          className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 text-xs font-bold"
                        >
                          +حفظ
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-1.5">
                        {eternalMemory.slice(0, 30).map((m) => (
                          <div key={m.id} className="p-2 rounded bg-[#141824] border border-slate-800 space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[11px] font-bold text-amber-300 truncate">{m.title}</span>
                              {m.command && (
                                <button
                                  onClick={() => {
                                    setTermCmd(m.command!);
                                    void execInTerminal(m.command!);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-bold shrink-0"
                                >
                                  إعادة تشغيل
                                </button>
                              )}
                            </div>
                            {m.command && (
                              <div className="text-[10px] font-mono text-cyan-300 bg-black/40 px-1.5 py-0.5 rounded truncate" dir="ltr">
                                $ {m.command}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {rightMonitorTab === "connections" && (
                    <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5" dir="rtl">
                      {connections.map((c) => (
                        <div key={c.id} className="p-2 rounded-lg bg-[#141824] border border-purple-500/30 space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-white">{c.name}</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[9px]">
                              {c.status}
                            </span>
                          </div>
                          <div className="text-[10px] text-cyan-300">{c.metrics}</div>
                          <div className="text-[9px] font-mono text-slate-400" dir="ltr">
                            {c.protocol} · {c.latencyMs}ms
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {rightMonitorTab === "visitors" && (
                    <div className="flex-1 overflow-y-auto p-2.5 space-y-2" dir="rtl">
                      {/* Current Visitor & Quick Scan */}
                      <div className="p-2.5 rounded-lg bg-[#111624] border border-cyan-500/40 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-cyan-300">
                            👁️ رادار الزوار وتنبيهات تليجرام (حراس الكون)
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono font-bold">
                            {visitorIntel?.telegram?.tokenSet ? "TELEGRAM ACTIVE" : "RADAR ACTIVE"}
                          </span>
                        </div>

                        {visitorIntel?.currentVisitor && (
                          <div className="p-2 rounded bg-black/50 border border-slate-800 text-[10px] space-y-0.5">
                            <div className="flex items-center justify-between font-mono" dir="ltr">
                              <span className="text-emerald-400 font-bold">IP: {visitorIntel.currentVisitor.ip}</span>
                              <span className="text-cyan-300">{visitorIntel.currentVisitor.reverseHost}</span>
                            </div>
                            <div className="text-slate-300">
                              المكان: {visitorIntel.currentVisitor.city}، {visitorIntel.currentVisitor.country} ({visitorIntel.currentVisitor.isp})
                            </div>
                            <div className="text-slate-400">الجهاز: {visitorIntel.currentVisitor.deviceSummary}</div>
                            <div className="text-amber-300 font-bold">{visitorIntel.currentVisitor.verdict}</div>
                          </div>
                        )}

                        <div className="flex items-center gap-1 pt-1">
                          <input
                            value={visitorScanIp}
                            onChange={(e) => setVisitorScanIp(e.target.value)}
                            placeholder="أدخل IP أي زائر لفحصه وإرساله لتليجرام..."
                            dir="ltr"
                            className="flex-1 px-2 py-1 rounded bg-[#080a10] border border-slate-700 text-[11px] font-mono text-cyan-300"
                          />
                          <button
                            onClick={() => void runDeepVisitorScan()}
                            disabled={visitorScanning}
                            className="px-2.5 py-1 rounded bg-[#ff2b4d] hover:bg-[#ff4769] text-white text-[10px] font-bold shrink-0"
                          >
                            {visitorScanning ? "يفحص..." : "فحص + تليجرام ▶"}
                          </button>
                        </div>
                      </div>

                      {/* Telegram Bot Configuration & Instant Test */}
                      <div className="p-2.5 rounded-lg bg-[#111624] border border-purple-500/35 space-y-1.5">
                        <div className="text-[10px] font-black text-purple-300">
                          ضبط واختبار تنبيهات تليجرام الفورية لكل زائر:
                        </div>
                        <input
                          value={tgBotTokenInput}
                          onChange={(e) => setTgBotTokenInput(e.target.value)}
                          placeholder={
                            visitorIntel?.telegram?.tokenSet
                              ? "توكن البوت محفوظ ✓ (أدخل توكن جديد للتحديث)"
                              : "أدخل TELEGRAM_BOT_TOKEN (مثال: 123456:ABC...)"
                          }
                          dir="ltr"
                          className="w-full px-2 py-1 rounded bg-[#080a10] border border-slate-700 text-[10px] font-mono text-slate-200"
                        />
                        <div className="flex items-center gap-1">
                          <input
                            value={tgChatIdInput}
                            onChange={(e) => setTgChatIdInput(e.target.value)}
                            placeholder={
                              visitorIntel?.telegram?.chatId
                                ? `Chat ID: ${visitorIntel.telegram.chatId}`
                                : "أدخل TELEGRAM_CHAT_ID أو @channel"
                            }
                            dir="ltr"
                            className="flex-1 px-2 py-1 rounded bg-[#080a10] border border-slate-700 text-[10px] font-mono text-slate-200"
                          />
                          <button
                            onClick={() => void saveAndTestTelegram(true)}
                            disabled={tgConfigBusy}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shrink-0"
                          >
                            {tgConfigBusy ? "..." : "حفظ وإرسال تنبيه حي"}
                          </button>
                        </div>
                        {tgConfigMsg && <div className="text-[10px] text-amber-300 font-bold">{tgConfigMsg}</div>}
                      </div>

                      {visitorScanOutput && (
                        <pre
                          dir="ltr"
                          className="p-2 rounded bg-black/90 border border-cyan-500/40 text-[10px] font-mono text-emerald-300 max-h-36 overflow-y-auto whitespace-pre-wrap"
                        >
                          {visitorScanOutput}
                        </pre>
                      )}

                      {/* Recent Visitors List */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-300">
                          سجل الزوار المفحوصين تلقائيًا ({visitorIntel?.visitors?.length ?? 0}):
                        </div>
                        {(visitorIntel?.visitors ?? []).slice(0, 15).map((v) => (
                          <div key={v.id} className="p-2 rounded bg-[#141824] border border-slate-800 space-y-0.5 text-[10px]">
                            <div className="flex items-center justify-between font-mono" dir="ltr">
                              <span className="text-cyan-300 font-bold">{v.ip}</span>
                              <button
                                onClick={() => {
                                  setVisitorScanIp(v.ip);
                                  void runDeepVisitorScan(v.ip);
                                }}
                                className="px-1.5 py-0.5 rounded bg-[#ff2b4d] text-white text-[9px] font-sans font-bold"
                              >
                                فحص عميق
                              </button>
                            </div>
                            <div className="text-slate-300">
                              {v.city}، {v.country} · {v.isp} ({v.reverseHost})
                            </div>
                            <div className="text-slate-400 truncate">{v.deviceSummary}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════
           * WORKSPACE 2: DEDICATED DUAL TERMINAL + AI CO-PILOT + AUTO-HELP
           * ═════════════════════════════════════════════════════════════════ */}
          {activeWorkspace === 2 && (
            <div className="relative z-10 flex-1 grid grid-cols-12 gap-3 min-h-0">
              <div className="col-span-12 lg:col-span-7 bg-[#090c12]/95 rounded-xl border border-emerald-500/45 flex flex-col min-h-0 overflow-hidden shadow-2xl" dir="ltr">
                <div className="h-9 bg-[#111622] border-b border-slate-800 px-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    <TerminalIcon className="w-4 h-4 text-emerald-400 mr-1" />
                    {terminalTabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTabId(tab.id)}
                        className={`px-3 py-1 rounded text-xs font-mono font-bold ${
                          activeTabId === tab.id ? "bg-emerald-500 text-slate-950" : "bg-[#192030] text-slate-300"
                        }`}
                      >
                        {tab.title}
                      </button>
                    ))}
                    <button
                      onClick={addNewTerminalTab}
                      className="px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 text-xs font-mono font-bold"
                    >
                      + New Session
                    </button>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400">cwd: {activeTab?.cwd || sessionCwd}</span>
                </div>

                <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1">
                  {(Array.isArray(activeTab?.lines) ? activeTab.lines : []).map((ln, idx) => (
                    <div
                      key={idx}
                      className={`whitespace-pre-wrap break-all ${
                        ln.startsWith("┌──") || ln.startsWith("└─#")
                          ? "text-cyan-300 font-bold"
                          : ln.startsWith("[✓")
                            ? "text-emerald-400"
                            : "text-slate-200"
                      }`}
                    >
                      {ln}
                    </div>
                  ))}
                  <div ref={termBottomRef} />
                </div>

                <div className="h-11 bg-[#06080d] border-t border-slate-800 px-3 flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-[#ff2b4d]">root💀kali-2099:~#</span>
                  <input
                    value={termCmd}
                    onChange={(e) => setTermCmd(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void execInTerminal()}
                    className="flex-1 bg-transparent text-xs font-mono text-emerald-300 focus:outline-none"
                  />
                  <button
                    onClick={() => void execInTerminal()}
                    disabled={termRunning}
                    className="px-4 py-1.5 rounded bg-[#ff2b4d] hover:bg-[#ff4769] text-white text-xs font-mono font-bold"
                  >
                    {termRunning ? "RUNNING..." : "EXECUTE ↵"}
                  </button>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-5 flex flex-col gap-3 min-h-0">
                <div className="h-1/2 bg-[#0e121b]/95 rounded-xl border border-cyan-500/40 p-3 flex flex-col min-h-0 overflow-y-auto">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <div className="text-xs font-black text-cyan-300 flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-[#ff2b4d]" />
                      <span>المساعد التلقائي للأدوات والوصف: {currentToolGuide.tool}</span>
                    </div>
                    <button
                      onClick={() => void fetchLiveCliHelp(currentToolGuide.tool)}
                      className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-mono font-bold"
                    >
                      --help الحي
                    </button>
                  </div>
                  <div className="mt-2 text-xs font-bold text-white">{currentToolGuide.title_ar}</div>
                  <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">{currentToolGuide.description_ar}</p>
                  <div className="mt-2 space-y-1">
                    {currentToolGuide.recipes.map((r, i) => (
                      <div key={i} className="p-2 rounded bg-[#151b28] border border-slate-800 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-emerald-300">{r.label_ar}</div>
                          <div className="text-[10px] font-mono text-slate-400 truncate" dir="ltr">
                            {r.cmd}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setTermCmd(r.cmd);
                            void execInTerminal(r.cmd);
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[10px] font-bold shrink-0"
                        >
                          تشغيل ▶
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="h-1/2 bg-[#0e121b]/95 rounded-xl border border-emerald-500/40 flex flex-col min-h-0 overflow-hidden">
                  <div className="h-8 bg-[#141a26] border-b border-slate-800 px-3 flex items-center justify-between">
                    <div className="text-xs font-black text-emerald-300 flex items-center gap-1.5">
                      <Bot className="w-4 h-4 text-emerald-400" />
                      <span>ترمنال المساعد الذكي والتوجيه التلقائي</span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
                    {assistantHistory.map((m) => (
                      <div
                        key={m.id}
                        className={`p-2.5 rounded-lg border ${
                          m.role === "user" ? "bg-[#1b2232] border-cyan-500/35" : "bg-[#131822] border-emerald-500/35"
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{m.text}</div>
                        {(Array.isArray(m.commands) ? m.commands : []).map((c, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setTermCmd(c.cmd);
                              void execInTerminal(c.cmd);
                            }}
                            className="mt-1.5 mr-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold inline-flex items-center gap-1"
                          >
                            <Play className="w-3 h-3" />
                            <span>{c.label}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="h-10 bg-[#090c12] border-t border-slate-800 px-3 flex items-center gap-2">
                    <input
                      value={assistantInput}
                      onChange={(e) => setAssistantInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void askAssistant()}
                      placeholder="اكتب هدفك أو سؤالك (مثل: فحص دومين، شرح sqlmap، تحليل آخر أمر)..."
                      className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                    />
                    <button onClick={() => void askAssistant()} className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-bold">
                      إرسال
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════
           * WORKSPACE 3: FULL 266 KALI + 28 PYTHON ARSENAL ENCYCLOPEDIA & LAUNCHER
           * ═════════════════════════════════════════════════════════════════ */}
          {activeWorkspace === 3 && (
            <div className="relative z-10 flex-1 bg-[#0e1118]/95 backdrop-blur-xl rounded-xl border border-cyan-500/40 p-3 flex flex-col min-h-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                <div>
                  <h2 className="text-sm font-black text-white flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-[#ff2b4d]" />
                    <span>
                      موسوعة ومشغّل ترسانة كالي 2099 ({presentTools}/{totalTools} أداة كالي + {pyPresent}/{pyTotal} أداة بايثون)
                    </span>
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={whiskerSearch}
                    onChange={(e) => setWhiskerSearch(e.target.value)}
                    placeholder="ابحث عن أي أداة (nmap, nuclei, sqlmap, trivy)..."
                    className="w-64 px-3 py-1.5 rounded-lg bg-[#171c28] border border-slate-700 text-xs text-white"
                  />
                  <input
                    value={ghRepoInput}
                    onChange={(e) => setGhRepoInput(e.target.value)}
                    placeholder="owner/repo لتثبيت أداة جديدة من GitHub..."
                    dir="ltr"
                    className="w-64 px-3 py-1.5 rounded-lg bg-[#171c28] border border-slate-700 text-xs font-mono text-cyan-300"
                  />
                  <button
                    onClick={() => void installFromGithub()}
                    disabled={ghInstalling}
                    className="px-3 py-1.5 rounded-lg bg-[#ff2b4d] text-white text-xs font-bold"
                  >
                    {ghInstalling ? "..." : "+ GitHub Clone"}
                  </button>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-12 gap-3 pt-2.5 min-h-0">
                <div className="col-span-12 lg:col-span-8 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 pr-1">
                  {whiskerTools.map((t) => {
                    const g = toolsGuideMap?.[t.name];
                    return (
                      <div
                        key={t.name}
                        onClick={() => setInspectedTool(t.name)}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                          inspectedTool === t.name
                            ? "bg-[#1d2436] border-cyan-400 shadow-[0_0_15px_rgba(56,189,248,0.2)]"
                            : "bg-[#151924] border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-black text-emerald-400" dir="ltr">
                            {t.name}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300">
                            {g?.category_ar ?? t.cat}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-white mt-1">{g?.title_ar ?? t.name}</div>
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{g?.description_ar}</p>
                        <div className="flex items-center justify-end gap-1.5 mt-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveWorkspace(1);
                              openToolWithAutoHelp(t.name, true);
                            }}
                            className="px-2.5 py-1 rounded bg-[#ff2b4d] hover:bg-[#ff4769] text-white text-[10px] font-bold"
                          >
                            تشغيل في الطرفية ▶
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="col-span-12 lg:col-span-4 bg-[#141824] rounded-xl border border-cyan-500/35 p-3 overflow-y-auto space-y-2.5">
                  <div className="text-sm font-black text-cyan-300">{currentToolGuide.title_ar}</div>
                  <p className="text-xs text-slate-300 leading-relaxed">{currentToolGuide.description_ar}</p>
                  <div className="p-2 rounded bg-black/40 font-mono text-xs text-emerald-300" dir="ltr">
                    {currentToolGuide.usage_ar}
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-white">الخيارات الأساسية (Flags):</div>
                    {currentToolGuide.flags.map((f) => (
                      <div key={f.flag} className="p-1.5 rounded bg-[#0e1118] border border-slate-800 flex justify-between text-[11px]">
                        <span className="text-slate-300">{f.desc_ar}</span>
                        <code className="text-cyan-300 font-mono" dir="ltr">
                          {f.flag}
                        </code>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-xs font-bold text-emerald-400">أوامر جاهزة للتشغيل الفوري:</div>
                    {currentToolGuide.recipes.map((r, idx) => (
                      <div key={idx} className="p-2 rounded bg-[#0e1118] border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{r.label_ar}</span>
                          <button
                            onClick={() => {
                              setActiveWorkspace(1);
                              openToolWithAutoHelp(currentToolGuide.tool, false);
                              setTermCmd(r.cmd);
                              void execInTerminal(r.cmd);
                            }}
                            className="px-2.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold"
                          >
                            تشغيل ▶
                          </button>
                        </div>
                        <div className="text-[10px] font-mono text-cyan-300 bg-black/50 p-1 rounded" dir="ltr">
                          {r.cmd}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════
           * WORKSPACE 4: ETERNAL MEMORY VAULT & PERSISTENT SESSION & 67.11GB HUB
           * ═════════════════════════════════════════════════════════════════ */}
          {activeWorkspace === 4 && (
            <div className="relative z-10 flex-1 bg-[#0e1118]/95 backdrop-blur-xl rounded-xl border border-amber-500/40 p-3 flex flex-col min-h-0 overflow-hidden gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                <div>
                  <h2 className="text-sm font-black text-amber-300 flex items-center gap-2">
                    <Brain className="w-4 h-4 text-amber-400" />
                    <span>الذاكرة الأبدية والجلسة الدائمة (Eternal Memory Vault — {eternalMemory.length} سجل محفوظ)</span>
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={memorySearch}
                    onChange={(e) => {
                      setMemorySearch(e.target.value);
                      void loadEternalMemory(e.target.value, memoryFilterKind);
                    }}
                    placeholder="ابحث في الذاكرة الأبدية..."
                    className="w-60 px-3 py-1.5 rounded-lg bg-[#171c28] border border-slate-700 text-xs text-white"
                  />
                  {(["all", "command", "pipeline", "finding", "assistant"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        setMemoryFilterKind(k);
                        void loadEternalMemory(memorySearch, k);
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-bold ${
                        memoryFilterKind === k ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {k === "all" ? "الكل" : k}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 grid grid-cols-12 gap-3 min-h-0">
                <div className="col-span-12 lg:col-span-8 overflow-y-auto space-y-2 pr-1">
                  {eternalMemory.map((m) => (
                    <div
                      key={m.id}
                      className={`p-3 rounded-xl border ${
                        m.pinned ? "bg-[#1a1f2e] border-amber-500/45" : "bg-[#141824] border-slate-800"
                      } space-y-1.5`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                            {String(m.kind || "note").toUpperCase()}
                          </span>
                          <span className="text-xs font-bold text-white">{m.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => void togglePinMemory(m.id)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.pinned ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {m.pinned ? "مثبت ★" : "تثبيت"}
                          </button>
                          {m.command && (
                            <button
                              onClick={() => {
                                setActiveWorkspace(1);
                                setTermCmd(m.command!);
                                void execInTerminal(m.command!);
                              }}
                              className="px-2.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold"
                            >
                              إعادة تشغيل ▶
                            </button>
                          )}
                        </div>
                      </div>
                      {m.command && (
                        <div className="p-1.5 rounded bg-black/50 font-mono text-xs text-cyan-300" dir="ltr">
                          root@kali-2099:{m.cwd || "~"}# {m.command}
                        </div>
                      )}
                      {m.output && (
                        <pre
                          dir="ltr"
                          className="p-2 rounded bg-black/70 text-[10px] font-mono text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap"
                        >
                          {m.output}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>

                <div className="col-span-12 lg:col-span-4 flex flex-col gap-3 overflow-y-auto">
                  <div className="p-3 rounded-xl bg-[#141824] border border-amber-500/35 space-y-2">
                    <div className="text-xs font-black text-amber-300">إضافة اكتشاف / ملاحظة للذاكرة الأبدية</div>
                    <input
                      value={newMemoryTitle}
                      onChange={(e) => setNewMemoryTitle(e.target.value)}
                      placeholder="عنوان النتيجة أو الملاحظة..."
                      className="w-full px-2.5 py-1.5 rounded bg-[#0c0e14] border border-slate-700 text-xs text-white"
                    />
                    <textarea
                      value={newMemoryNote}
                      onChange={(e) => setNewMemoryNote(e.target.value)}
                      placeholder="تفاصيل الثغرة أو الملاحظة أو المخرجات المهمة..."
                      rows={4}
                      className="w-full p-2 rounded bg-[#0c0e14] border border-slate-700 text-xs text-slate-200"
                    />
                    <button
                      onClick={() => void saveNoteToEternalMemory()}
                      className="w-full py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black"
                    >
                      حفظ وتثبيت في الذاكرة الأبدية
                    </button>
                  </div>

                  <div className="p-3 rounded-xl bg-[#141824] border border-purple-500/35 space-y-1.5">
                    <div className="text-xs font-black text-purple-300">المخازن السحابية الثمانية ({storageText})</div>
                    {(Array.isArray(storageHub?.repos) ? storageHub!.repos : []).map((r) => (
                      <div key={r.name} className="p-1.5 rounded bg-[#0e1118] flex justify-between text-xs font-mono" dir="ltr">
                        <span className="text-white">{r.name}</span>
                        <span className="text-purple-300 font-bold">{r.sizeHuman}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════
           * WORKSPACE 5: "OPEN EVERYTHING" UNIVERSAL PLATFORM APP HOST (32 APPS)
           * ═════════════════════════════════════════════════════════════════ */}
          {activeWorkspace === 5 && (
            <div className="relative z-10 flex-1 grid grid-cols-12 gap-2.5 min-h-0">
              <div className="col-span-12 lg:col-span-4 bg-[#0e1118]/95 rounded-xl border border-purple-500/40 p-2.5 flex flex-col min-h-0 overflow-hidden">
                <div className="pb-2 border-b border-slate-800">
                  <div className="text-xs font-black text-purple-300 flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-[#ff2b4d]" />
                    <span>فتح كل شيء — الدمج الشامل لكل قدرات المنصة (32 نظامًا)</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1.5 pt-2">
                  {PLATFORM_APPS.map((app) => (
                    <div
                      key={app.route}
                      onClick={() => openPlatformAppInDesktop(app)}
                      className={`p-2 rounded-lg border cursor-pointer transition-all flex items-center justify-between gap-2 ${
                        embeddedAppRoute === app.route
                          ? "bg-purple-500/20 border-purple-400 text-white"
                          : "bg-[#151924] border-slate-800 hover:bg-[#1c2230]"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-cyan-300 truncate">{app.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{app.desc}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocation(app.route);
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-[#ff2b4d] text-[10px] font-mono text-slate-200 shrink-0"
                      >
                        ملء الشاشة ↗
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-12 lg:col-span-8 bg-[#0b0d13]/95 rounded-xl border border-cyan-500/45 flex flex-col min-h-0 overflow-hidden shadow-2xl">
                <div className="h-8 bg-[#121620] border-b border-slate-800 px-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KaliLogo2099 size={16} animated={false} />
                    <span className="text-xs font-bold text-white">{embeddedAppTitle}</span>
                    <span className="text-[10px] font-mono text-cyan-400" dir="ltr">
                      ({embeddedAppRoute})
                    </span>
                  </div>
                  <button
                    onClick={() => setLocation(embeddedAppRoute)}
                    className="px-2.5 py-0.5 rounded bg-[#ff2b4d] text-white text-[10px] font-bold flex items-center gap-1"
                  >
                    <span>فتح في تبويب كامل</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
                <iframe
                  key={embeddedAppRoute}
                  src={embeddedAppRoute}
                  title={embeddedAppTitle}
                  className="flex-1 w-full h-full border-0 bg-[#06080f]"
                />
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════
           * WORKSPACE 6: KALI PURPLE 360° ATTACK SURFACE GRAPH + AUTOPILOT + CONNECTIONS
           * ═════════════════════════════════════════════════════════════════ */}
          {activeWorkspace === 6 && (
            <div className="relative z-10 flex-1 grid grid-cols-12 gap-3 min-h-0 overflow-hidden">
              {/* Left 7 cols: 360° Attack Surface Graph + NIST CSF 2.0 Matrix */}
              <div className="col-span-12 lg:col-span-7 bg-[#0c0f18]/95 rounded-xl border border-purple-500/45 p-3 flex flex-col gap-2.5 min-h-0 overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <h2 className="text-sm font-black text-purple-300 flex items-center gap-2">
                      <Network className="w-4 h-4 text-[#ff2b4d]" />
                      <span>خريطة سطح الهجوم والأصول الحية 360° (BloodHound / Surface Command Style)</span>
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      تحليل حي لـ DNS، عناوين IPv4/IPv6، خوادم البريد والأسماء، والخدمات للهدف ({activeTarget})
                    </p>
                  </div>
                  <button
                    onClick={() => void loadAttackGraph(activeTarget)}
                    className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold"
                  >
                    فحص الهدف وتحديث الخريطة
                  </button>
                </div>

                {/* Interactive SVG Visual Topology */}
                <div className="relative h-56 bg-[#07090f] rounded-xl border border-slate-800 p-3 flex items-center justify-center overflow-hidden">
                  <svg viewBox="0 0 700 220" className="w-full h-full">
                    {/* Connecting lines from center Target (350,110) to surrounding nodes */}
                    {(attackGraph?.nodes ?? []).slice(1, 9).map((n, idx, arr) => {
                      const angle = (idx / Math.max(1, arr.length)) * Math.PI * 2;
                      const x = Math.round(350 + Math.cos(angle) * 230);
                      const y = Math.round(110 + Math.sin(angle) * 80);
                      return (
                        <g key={n.id} onClick={() => setSelectedGraphNode(n)} className="cursor-pointer">
                          <line x1={350} y1={110} x2={x} y2={y} stroke="#a855f7" strokeWidth="1.5" strokeDasharray="4 3" />
                          <rect
                            x={x - 68}
                            y={y - 16}
                            width={136}
                            height={32}
                            rx={8}
                            fill={selectedGraphNode?.id === n.id ? "#3b0764" : "#111827"}
                            stroke={n.status === "ok" ? "#10b981" : n.status === "warn" ? "#f59e0b" : "#38bdf8"}
                            strokeWidth="1.5"
                          />
                          <text x={x} y={y + 4} textAnchor="middle" fill="#e2e8f0" fontSize="10" fontFamily="monospace">
                            {n.label.slice(0, 18)}
                          </text>
                        </g>
                      );
                    })}
                    {/* Center Target Node */}
                    <g>
                      <circle cx={350} cy={110} r={42} fill="#2e0516" stroke="#ff2b4d" strokeWidth="2.5" />
                      <text x={350} y={106} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold" fontFamily="monospace">
                        {activeTarget.slice(0, 14)}
                      </text>
                      <text x={350} y={122} textAnchor="middle" fill="#ff8fa3" fontSize="9" fontFamily="monospace">
                        TARGET 360°
                      </text>
                    </g>
                  </svg>
                </div>

                {selectedGraphNode && (
                  <div className="p-2.5 rounded-xl bg-[#131826] border border-cyan-500/40 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-cyan-300" dir="ltr">
                        [{selectedGraphNode.type.toUpperCase()}] {selectedGraphNode.label}
                      </div>
                      <div className="text-[11px] text-slate-300">{selectedGraphNode.detail}</div>
                      <div className="text-[10px] font-mono text-emerald-300 mt-0.5" dir="ltr">
                        $ {selectedGraphNode.recommendedCmd}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setActiveWorkspace(1);
                        setTermCmd(selectedGraphNode.recommendedCmd);
                        void execInTerminal(selectedGraphNode.recommendedCmd);
                      }}
                      className="px-3 py-1.5 rounded bg-[#ff2b4d] text-white text-xs font-bold shrink-0"
                    >
                      تشغيل الفحص في التريمنال ▶
                    </button>
                  </div>
                )}

                {/* NIST CSF 2.0 6-Pillar Kali Purple Matrix */}
                <div className="space-y-1.5">
                  <div className="text-xs font-black text-white">
                    مصفوفة Kali Purple الدفاعية والهجومية (NIST CSF 2.0 — 6 Pillars):
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(attackGraph?.nistCsf2 ?? []).map((pillar) => (
                      <div key={pillar.id} className="p-2.5 rounded-xl bg-[#131826] border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{pillar.title_ar}</span>
                          <span className="text-xs font-mono font-black text-emerald-400">{pillar.score}%</span>
                        </div>
                        <div className="flex flex-wrap gap-1" dir="ltr">
                          {pillar.tools.map((t) => (
                            <button
                              key={t}
                              onClick={() => {
                                setActiveWorkspace(1);
                                openToolWithAutoHelp(t, false);
                              }}
                              className="px-1.5 py-0.5 rounded bg-black/50 hover:bg-purple-500/30 text-cyan-300 font-mono text-[9px]"
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right 5 cols: Kali Autopilot 2099 + Live Unified Connections Hub */}
              <div className="col-span-12 lg:col-span-5 flex flex-col gap-3 min-h-0 overflow-y-auto">
                <div className="p-3 rounded-xl bg-[#0c0f18]/95 border border-emerald-500/40 space-y-2">
                  <div className="text-xs font-black text-emerald-300 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-[#ff2b4d]" />
                    <span>باني ومشغّل سلاسل Kali Autopilot 2099 (Red / Blue / Purple / AI-SPM)</span>
                  </div>
                  <div className="space-y-1.5">
                    {autopilotTemplates.map((tpl) => (
                      <div key={tpl.id} className="p-2.5 rounded-lg bg-[#141926] border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-white">{tpl.title_ar}</span>
                          <button
                            onClick={() => void runAutopilotChain(tpl.id)}
                            disabled={autopilotRunningId !== null}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shrink-0"
                          >
                            {autopilotRunningId === tpl.id ? "جاري التشغيل..." : "تشغيل السلسلة ▶"}
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400">{tpl.desc_ar}</p>
                      </div>
                    ))}
                  </div>
                  {autopilotOutput && (
                    <pre
                      dir="ltr"
                      className="p-2 rounded bg-black/90 border border-emerald-500/40 text-[10px] font-mono text-emerald-300 max-h-40 overflow-y-auto whitespace-pre-wrap"
                    >
                      {autopilotOutput}
                    </pre>
                  )}
                </div>

                {/* Live Visitor IP Radar & Telegram Sentinel Card */}
                <div className="p-3 rounded-xl bg-[#0c0f18]/95 border border-[#ff2b4d]/45 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-black text-white flex items-center gap-1.5">
                      <Eye className="w-4 h-4 text-[#ff2b4d]" />
                      <span>رادار الزوار وتنبيهات تليجرام الفورية (حراس الكون 2099)</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold">
                      {visitorIntel?.visitors?.length ?? 1} زائر مفحوص
                    </span>
                  </div>

                  {visitorIntel?.currentVisitor && (
                    <div className="p-2 rounded-lg bg-[#141926] border border-cyan-500/35 text-[11px] space-y-1">
                      <div className="flex items-center justify-between font-mono" dir="ltr">
                        <span className="text-emerald-400 font-bold">IP: {visitorIntel.currentVisitor.ip}</span>
                        <span className="text-cyan-300">{visitorIntel.currentVisitor.reverseHost}</span>
                      </div>
                      <div className="text-slate-300">
                        الموقع والمزود: {visitorIntel.currentVisitor.city}، {visitorIntel.currentVisitor.country} · {visitorIntel.currentVisitor.isp} ({visitorIntel.currentVisitor.org})
                      </div>
                      <div className="text-slate-400">الجهاز والمتصفح: {visitorIntel.currentVisitor.deviceSummary}</div>
                      <div className="text-amber-300 font-bold">{visitorIntel.currentVisitor.verdict}</div>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    <input
                      value={visitorScanIp}
                      onChange={(e) => setVisitorScanIp(e.target.value)}
                      placeholder="IP الزائر أو الهدف لفحصه وإرساله لتليجرام..."
                      dir="ltr"
                      className="flex-1 px-2.5 py-1.5 rounded bg-[#080a10] border border-slate-700 text-xs font-mono text-cyan-300"
                    />
                    <button
                      onClick={() => void runDeepVisitorScan()}
                      disabled={visitorScanning}
                      className="px-3 py-1.5 rounded bg-[#ff2b4d] hover:bg-[#ff4769] text-white text-xs font-bold shrink-0"
                    >
                      {visitorScanning ? "يفحص..." : "فحص عميق + تليجرام ▶"}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                    <input
                      value={tgBotTokenInput}
                      onChange={(e) => setTgBotTokenInput(e.target.value)}
                      placeholder={visitorIntel?.telegram?.tokenSet ? "Bot Token محفوظ ✓" : "TELEGRAM_BOT_TOKEN"}
                      dir="ltr"
                      className="px-2 py-1 rounded bg-[#080a10] border border-slate-700 text-[10px] font-mono text-slate-200"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        value={tgChatIdInput}
                        onChange={(e) => setTgChatIdInput(e.target.value)}
                        placeholder={visitorIntel?.telegram?.chatId ? `Chat: ${visitorIntel.telegram.chatId}` : "TELEGRAM_CHAT_ID"}
                        dir="ltr"
                        className="flex-1 px-2 py-1 rounded bg-[#080a10] border border-slate-700 text-[10px] font-mono text-slate-200"
                      />
                      <button
                        onClick={() => void saveAndTestTelegram(true)}
                        disabled={tgConfigBusy}
                        className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shrink-0"
                      >
                        {tgConfigBusy ? "..." : "ربط وتنبيه"}
                      </button>
                    </div>
                  </div>
                  {tgConfigMsg && <div className="text-[10px] text-amber-300 font-bold">{tgConfigMsg}</div>}
                  {visitorScanOutput && (
                    <pre
                      dir="ltr"
                      className="p-2 rounded bg-black/90 border border-cyan-500/40 text-[10px] font-mono text-emerald-300 max-h-36 overflow-y-auto whitespace-pre-wrap"
                    >
                      {visitorScanOutput}
                    </pre>
                  )}
                </div>

                {/* 💰 ماكينة صيد المكافآت والعوائد المليارية والتقارير التنفيذية 2099 */}
                <div className="p-3 rounded-xl bg-gradient-to-br from-[#0e1512]/95 via-[#0c121b]/95 to-[#181209]/95 border border-amber-500/50 space-y-2.5 shadow-[0_0_24px_rgba(245,158,11,0.16)]">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                      <DollarSign className="w-4 h-4 text-emerald-400" />
                      <span>ماكينة صيد المكافآت والعوائد المليارية والتقارير التنفيذية 2099</span>
                    </div>
                    <button
                      onClick={() => void runBountyHunt(selectedBountyProgramId)}
                      disabled={bountyHunting}
                      className="px-2.5 py-1 rounded bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 text-[10px] font-black flex items-center gap-1"
                    >
                      <Award className="w-3.5 h-3.5" />
                      <span>{bountyHunting ? "جارٍ صيد المكافآت وتوليد التقرير..." : `بدء الصيد والتدقيق على ${activeTarget}`}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    {bountyPrograms.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => setSelectedBountyProgramId(p.id)}
                        className={`p-2 rounded-lg border cursor-pointer transition ${
                          selectedBountyProgramId === p.id
                            ? "bg-amber-950/35 border-amber-400/70"
                            : "bg-[#111622] border-slate-800 hover:border-amber-500/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-white">{p.title_ar}</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold shrink-0" dir="ltr">
                            {p.tierRange}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-300 mt-0.5">{p.desc_ar}</div>
                      </div>
                    ))}
                  </div>

                  {bountyResult && (
                    <div className="p-2.5 rounded-lg bg-[#080b11] border border-emerald-500/50 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-black text-emerald-300">
                          ✅ اكتمل التدقيق التنفيذي لـ {bountyResult.target} ({bountyResult.findingsCount} نتائج · {bountyResult.elapsedMs}ms)
                        </span>
                        <button
                          onClick={() => {
                            setEditorPath(`/opt/nova-workspaces/recon-lab/bounty-report-${bountyResult.target}.md`);
                            setEditorContent(bountyResult.reportMarkdown);
                            setActiveWorkspace(2);
                          }}
                          className="px-2 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold flex items-center gap-1"
                        >
                          <FileCheck2 className="w-3 h-3" />
                          <span>فتح التقرير في المحرر</span>
                        </button>
                      </div>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {bountyResult.findings.map((f, idx) => (
                          <div key={idx} className="p-1.5 rounded bg-[#101624] border border-slate-800 text-[10px]">
                            <div className="font-bold text-amber-300">
                              [{f.severity}] {f.title}
                            </div>
                            <div className="text-emerald-300 font-mono" dir="ltr">
                              CVSS: {f.cvss} · Est: {f.bountyEst}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-[#0c0f18]/95 border border-cyan-500/40 space-y-2">
                  <div className="text-xs font-black text-cyan-300 flex items-center gap-1.5">
                    <Radio className="w-4 h-4 text-emerald-400" />
                    <span>مركز الاتصالات والتكاملات الحية الموحد (Unified Connections 2099)</span>
                  </div>
                  <div className="space-y-1.5">
                    {connections.map((c) => (
                      <div key={c.id} className="p-2 rounded-lg bg-[#141926] border border-slate-800 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{c.name}</div>
                          <div className="text-[10px] text-cyan-300">{c.metrics}</div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold shrink-0" dir="ltr">
                          {c.status} ({c.latencyMs}ms)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
           * WORKSPACE 7: SOVEREIGN LIVE LAB + 426 VULN MATRIX + 16 CYBER BOOKS
           * ═══════════════════════════════════════════════════════════════════ */}
          {activeWorkspace === 7 && (
            <div className="h-full w-full rounded-xl overflow-hidden border border-cyan-500/40 shadow-[0_12px_40px_rgba(0,0,0,0.85)]">
              <SovereignKnowledgeLabView
                activeTarget={activeTarget}
                onTargetChange={(next) => {
                  setActiveTarget(next);
                  setPipeTarget(next);
                }}
                onRunTerminalCommand={(cmd) => {
                  setActiveWorkspace(2);
                  void execInTerminal(cmd);
                }}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
