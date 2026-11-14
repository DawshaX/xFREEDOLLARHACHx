/**
 * NovaAgentPro v8 — «دولاب دوشة»: غرفة عمليات الهاكر الأخلاقي (Cyber-Horror Neon HUD).
 *
 * · نقل كل بطاقات القيادة الستة (الأسطول، العتاد، الخزنة+الكوربوس، المخ والمجلس،
 *   الاستقلالية 24/7، الجدولة السريعة) من الجنب إلى شريط HUD علوي مضغوط وقابل للطيّ
 *   لإفساح كامل العرض للشات وساحات العمل.
 * · ثيم نيون + هاكر أخلاقي + جماجم + رعب مع أصل جمجمة دوشة المستورد مباشرة عبر Vite (DAW_SKULL)
 *   لضمان عدم انكسارها أبداً كدائرة فارغة في أي مسار.
 * · قراءة الأرقام الحقيقية من /api/nova-core/status (brain.cloudProviders + council.members)
 *   ومن /api/autonomous/status + /api/nova-core/nexus + /api/nova/cron/jobs.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity, MonitorSmartphone, ListChecks, Brain, Cpu, Target, Cable, Compass,
  Server, Zap, ZapOff, Sparkles, Globe, ScanLine, Shield,
  Terminal as TerminalIcon, Search, Folder, BookOpen, Network, FlaskConical,
  Crosshair, Swords, FileCode, Wifi, CalendarClock, Play, PowerCircle,
  Command, Eye, EyeOff, MessageSquare, Skull, ArrowLeft, RotateCcw, Radar, Bell, Trash2, Pin,
  ChevronUp, ChevronDown, Flame, Radio,
} from "lucide-react";
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";
import { AgentWorkCockpit } from "@/components/desktop/AgentWorkCockpit";
import { NovaOpsRoom, NovaHuntSurface } from "@/components/desktop/NovaBrainOps";
import { RealTimeSystemMonitor } from "@/components/desktop/RealTimeSystemMonitor";
import { NovaMissions } from "@/components/desktop/NovaMissions";
import { ServerTasks } from "@/components/desktop/ServerTasks";
import { KaliTerminal } from "@/components/desktop/KaliTerminal";
import { AdvancedFileManager } from "@/components/desktop/AdvancedFileManager";
import { TelegramConfigCard } from "@/components/TelegramConfigCard";
import { opsFetch, novaAuthHeaders } from "@/lib/ops-client";
import { DAW_SKULL } from "@/lib/skull";
import { useSystem } from "@/context/SystemContext";
import ErrorIsland from "@/components/ErrorIsland";

/* ─── أنواع ─── */
type ArenaKey = "cockpit" | "launch" | "chat" | "events" | "cron" | "work" | "missions" | "brain" | "nexus" | "alerts" | "notes" | "hardware" | "hunt" | "channels" | "nav";

interface FleetAgentInfo {
  id: string; hostname: string; platform: string; user?: string; cpus?: number; connectedAt?: string;
}
interface CronJob {
  id: string; name: string; cronExpr: string; enabled: boolean;
  runCount: number; errorCount: number; lastRun?: string; nextRun?: string; lastResult?: string;
}

/* ─── قاذفة الأفعال: 24 سلاح × سلوك حقيقي ─── */
type LaunchAction =
  | { kind: "prompt"; text: string }
  | { kind: "win"; win: string }
  | { kind: "arena"; arena: ArenaKey };

interface Tile { id: string; label: string; hint: string; icon: typeof Globe; hue: string; action: LaunchAction; }

const LAUNCH_GROUPS: Array<{ group: string; color: string; tiles: Tile[] }> = [
  { group: "☠ الاستكشاف والهجوم الأخلاقي", color: "#ff2e63", tiles: [
    { id: "recon",    label: "Recon",       hint: "whois + dns + subdomains + ports", icon: Globe,       hue: "from-cyan-500/20 to-blue-900/20 border-cyan-400/45 text-cyan-200", action: { kind: "prompt", text: "ابدأ recon كامل (whois + dns + subdomains + ports) على الهدف: " } },
    { id: "pentest",  label: "Pentest",     hint: "playbook اختراق أخلاقي شامل",      icon: Skull,       hue: "from-rose-600/25 to-red-950/30 border-rose-500/55 text-rose-200", action: { kind: "prompt", text: "نفّذ playbook pentest على الهدف (افتح scanner + جمع ثغرات NVD/EPSS): " } },
    { id: "nmap",     label: "Nmap سريع",   hint: "منافذ وخدمات",                   icon: Network,     hue: "from-teal-500/20 to-emerald-950/25 border-teal-400/45 text-teal-200", action: { kind: "prompt", text: "افحص الهدف بـ nmap (-sV -sC -T4 --top-ports 1000) وباينلي الخدمات: " } },
    { id: "nikto",    label: "Nikto",       hint: "فحص ثغرات ويب",                  icon: FlaskConical,hue: "from-indigo-500/20 to-blue-950/25 border-indigo-400/45 text-indigo-200", action: { kind: "prompt", text: "شغّل Nikto على URL الهدف وفصّللي الموجود: " } },
    { id: "sqlmap",   label: "SQLMap",      hint: "SQL Injection",                  icon: FileCode,    hue: "from-amber-500/20 to-yellow-950/25 border-amber-400/45 text-amber-200", action: { kind: "prompt", text: "شغّل sqlmap على رابط فيه parameters ووثّق النتيجة: " } },
    { id: "hydra",    label: "Hydra",       hint: "Brute Force مصرّح",              icon: Swords,      hue: "from-red-600/25 to-rose-950/30 border-red-500/50 text-red-200", action: { kind: "prompt", text: "شغّل hydra على خدمة مصرّح بيها — اطلب الهدف والخدمة واليوزرات: " } },
    { id: "gobuster", label: "Gobuster",    hint: "Dir Brute Force",                icon: Folder,      hue: "from-lime-500/20 to-green-950/25 border-lime-400/45 text-lime-200", action: { kind: "prompt", text: "شغّل gobuster dir على الهدف بwordlist حقيقية ولخص المسارات: " } },
    { id: "linpeas",  label: "LinPEAS",     hint: "تصعيد صلاحيات لينكس",            icon: Crosshair,   hue: "from-emerald-500/20 to-green-950/25 border-emerald-400/45 text-emerald-200", action: { kind: "prompt", text: "نزّل وشغّل LinPEAS على الجهاز المتصل وطلّعلي خطوط التصعيد بس: " } },
  ] },
  { group: "🕸 أدوات الويب والاستغلال", color: "#22d3ee", tiles: [
    { id: "scan",    label: "Scanner",    hint: "فحص أمني",         icon: ScanLine,    hue: "from-fuchsia-500/20 to-purple-950/25 border-fuchsia-400/45 text-fuchsia-200", action: { kind: "win", win: "scanner" } },
    { id: "zap",     label: "OWASP ZAP",  hint: "Spider + Active",  icon: Wifi,        hue: "from-violet-500/20 to-purple-950/25 border-violet-400/45 text-violet-200", action: { kind: "win", win: "scanner" } },
    { id: "burp",    label: "Burp Suite", hint: "وكيل HTTP",        icon: Search,      hue: "from-orange-500/20 to-amber-950/25 border-orange-400/45 text-orange-200", action: { kind: "prompt", text: "جهز بيئة Burp على الجهاز (java/الأدوات) وقوللي جاهزيتها الحقيقية: " } },
    { id: "exploit", label: "Exploit-DB", hint: "بحث استغلالات",   icon: Shield,      hue: "from-yellow-500/20 to-amber-950/25 border-yellow-400/45 text-yellow-200", action: { kind: "win", win: "exploit-db" } },
    { id: "cve",     label: "CVE بحث",    hint: "ثغرات حية 332K",   icon: Target,      hue: "from-rose-500/20 to-pink-950/25 border-rose-400/45 text-rose-200", action: { kind: "win", win: "cve-live" } },
    { id: "browser", label: "متصفح",      hint: "تصفح داخلي",      icon: Globe,       hue: "from-sky-500/20 to-blue-950/25 border-sky-400/45 text-sky-200", action: { kind: "win", win: "browser" } },
  ] },
  { group: "🖥 النظام ومحطات العمل", color: "#34d399", tiles: [
    { id: "shell",   label: "Terminal",   hint: "نفّذ أمرًا",       icon: TerminalIcon,hue: "from-zinc-500/20 to-zinc-950/25 border-zinc-400/40 text-zinc-200", action: { kind: "win", win: "terminal" } },
    { id: "files",   label: "ملفات",      hint: "مدير الملفات",    icon: Folder,      hue: "from-blue-500/20 to-indigo-950/25 border-blue-400/45 text-blue-200", action: { kind: "win", win: "files" } },
    { id: "monitor", label: "Dashboard",  hint: "مراقبة حية",      icon: Activity,    hue: "from-emerald-500/20 to-teal-950/25 border-emerald-400/45 text-emerald-200", action: { kind: "win", win: "monitor" } },
    { id: "nodes",   label: "Nodes",      hint: "خوادم SSH",       icon: Server,      hue: "from-cyan-500/20 to-sky-950/25 border-cyan-400/45 text-cyan-200", action: { kind: "win", win: "nodes" } },
    { id: "sysmon",  label: "نظام",       hint: "CPU/RAM/Network", icon: Cpu,         hue: "from-teal-500/20 to-cyan-950/25 border-teal-400/45 text-teal-200", action: { kind: "arena", arena: "hardware" } },
    { id: "sysstate",label: "حالة",       hint: "الحالة الكاملة",  icon: Zap,         hue: "from-amber-500/20 to-orange-950/25 border-amber-400/45 text-amber-200", action: { kind: "prompt", text: "استخدم get_system_state وجيبلي الحالة الكاملة للنظام الآن وأهم الملاحظات: " } },
  ] },
  { group: "🧠 الذكاء والإدارة", color: "#a78bfa", tiles: [
    { id: "memory",    label: "ذاكرة",    hint: "ما تعلّمته",     icon: Brain,        hue: "from-violet-500/20 to-purple-950/25 border-violet-400/45 text-violet-200", action: { kind: "prompt", text: "استعرض ذاكرتك وما تعلّمته من الجلسات السابقة — أهم الدروس بس: " } },
    { id: "knowledge", label: "معرفة",    hint: "OWASP/checklists", icon: BookOpen,   hue: "from-pink-500/20 to-fuchsia-950/25 border-pink-400/45 text-pink-200", action: { kind: "win", win: "knowledge" } },
    { id: "playbooks", label: "Playbooks",hint: "وصفات جاهزة",    icon: ListChecks,   hue: "from-indigo-500/20 to-violet-950/25 border-indigo-400/45 text-indigo-200", action: { kind: "win", win: "playbooks" } },
    { id: "cron",      label: "Cron",     hint: "مهام مجدولة",    icon: CalendarClock,hue: "from-emerald-500/20 to-green-950/25 border-emerald-400/45 text-emerald-200", action: { kind: "arena", arena: "cron" } },
  ] },
];

const ARENAS: Array<{ key: ArenaKey; labelAr: string; icon: typeof Brain; color: string }> = [
  { key: "cockpit",  labelAr: "⚡ الشغل والشات الحي", icon: Sparkles,          color: "#ff2e63" },
  { key: "launch",   labelAr: "التحكم السريع",       icon: Flame,             color: "#fb7185" },
  { key: "chat",     labelAr: "الشات الكامل",        icon: MessageSquare,     color: "#22d3ee" },
  { key: "work",     labelAr: "مكان الشغل",          icon: MonitorSmartphone, color: "#14b8a6" },
  { key: "cron",     labelAr: "الجدولة",             icon: CalendarClock,     color: "#34d399" },
  { key: "events",   labelAr: "نبض الأحداث",         icon: Activity,          color: "#4ade80" },
  { key: "missions", labelAr: "المهمات",             icon: ListChecks,        color: "#fbbf24" },
  { key: "brain",    labelAr: "المخ والمجلس",        icon: Brain,             color: "#a78bfa" },
  { key: "nexus",    labelAr: "الخلفية ٢٤/٧",        icon: Radar,             color: "#2dd4bf" },
  { key: "alerts",   labelAr: "الإشعارات 🔔",          icon: Bell,              color: "#fb923c" },
  { key: "notes",    labelAr: "الدفاتر 📓",            icon: BookOpen,          color: "#fde047" },
  { key: "hardware", labelAr: "العتاد الحي",         icon: Cpu,               color: "#38bdf8" },
  { key: "hunt",     labelAr: "الصيد",               icon: Crosshair,         color: "#f43f5e" },
  { key: "channels", labelAr: "القنوات",             icon: Cable,             color: "#f59e0b" },
  { key: "nav",      labelAr: "كل الأقسام",          icon: Compass,           color: "#60a5fa" },
];

const NAV_GROUPS: Array<{ group: string; color: string; items: Array<{ path: string; label: string }> }> = [
  { group: "المراقبة والتشغيل", color: "#22d3ee", items: [
    { path: "/live-agent", label: "الوكيل الحي" }, { path: "/cve-live", label: "لوحة CVE" },
    { path: "/monitor", label: "Monitor" }, { path: "/dashboard", label: "الداشبورد" },
    { path: "/jobs", label: "المهام والأدلة" }, { path: "/memory", label: "ذاكرة المدير" },
  ] },
  { group: "الصيد والاستخبارات", color: "#fb7185", items: [
    { path: "/cve-db", label: "قاعدة CVE" }, { path: "/cve-search", label: "بحث الثغرات" },
    { path: "/shodan", label: "Shodan" }, { path: "/nova-intelligence", label: "NOVA Intel" },
    { path: "/mitre", label: "MITRE ATT&CK" }, { path: "/threat-detector", label: "كشف التهديدات" },
  ] },
  { group: "الأدوات والشبكات", color: "#a78bfa", items: [
    { path: "/terminal", label: "كونسول الأسطول" }, { path: "/port-scanner", label: "ماسح المنافذ" },
    { path: "/dns-lookup", label: "DNS" }, { path: "/whois-lookup", label: "WHOIS" },
    { path: "/subdomains", label: "النطاقات الفرعية" }, { path: "/hash-calculator", label: "الهاشات" },
  ] },
  { group: "الإدارة", color: "#4ade80", items: [
    { path: "/settings", label: "الإعدادات" }, { path: "/webhooks", label: "Webhooks" },
    { path: "/workspaces", label: "مساحات العمل" }, { path: "/playbooks", label: "Playbooks" },
    { path: "/reports", label: "التقارير" }, { path: "/cron", label: "صفحة Cron" },
  ] },
];

const CRON_LINKS: Record<string, { path: string; label: string }> = {
  cve_hunt:       { path: "/cve-live", label: "لوحة CVE" },
  mem_consolidate:{ path: "/memory", label: "الذاكرة" },
  self_heal:      { path: "/status", label: "حالة النظام" },
  sys_watchdog:   { path: "/monitor", label: "المراقبة" },
  tg_pulse:       { path: "/webhooks", label: "القنوات" },
  nova_learn:     { path: "/nova-memory", label: "تعلم نوفا" },
};

/* ─── بطاقات القيادة العلوية القابلة للإخفاء والطي ─── */
type HudCardId = "fleet" | "hw" | "vault" | "brain" | "autonomy" | "cronmini";
const HUD_DEFS: Array<{ id: HudCardId; title: string }> = [
  { id: "fleet",    title: "الأسطول" },
  { id: "hw",       title: "العتاد" },
  { id: "vault",    title: "الخزنة + CVE" },
  { id: "brain",    title: "المخ والمجلس" },
  { id: "autonomy", title: "الاستقلالية" },
  { id: "cronmini", title: "الجدولة" },
];

const fmtUptime = (s: number | null): string => {
  if (s == null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}ي ${h}س ${m}د` : h > 0 ? `${h}س ${m}د` : `${m}د`;
};
const fmtClock = (ts: string | number): string => {
  try { return new Date(ts).toLocaleTimeString("ar-EG", { hour12: false }); } catch { return "—"; }
};
const ago = (iso: string | undefined, now: number): string => {
  if (!iso) return "—";
  const t = Date.parse(iso); if (Number.isNaN(t)) return "—";
  const diffMin = Math.round((t - now) / 60000);
  const a = Math.abs(diffMin);
  const words = a < 1 ? "لحظات" : a < 60 ? `${a}د` : a < 1440 ? `${Math.floor(a / 60)}س ${a % 60}د` : `${Math.floor(a / 1440)}ي`;
  return diffMin >= 0 ? `بعد ${words}` : `من ${words}`;
};

function HudCard({
  title, icon: Icon, color, badge, onClick, children,
}: {
  title: string; icon: typeof Brain; color: string; badge?: string; onClick?: () => void; children: React.ReactNode;
}) {
  const Tag = onClick ? "button" : "section";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className="group relative flex flex-col justify-between rounded-xl border p-2 text-right transition-all hover:-translate-y-0.5 overflow-hidden"
      style={{
        borderColor: color + "45",
        background: `linear-gradient(155deg, ${color}16 0%, rgba(7,3,13,0.95) 60%)`,
        boxShadow: `0 0 18px ${color}14, inset 0 1px 0 ${color}30`,
      }}
    >
      <div className="flex items-center justify-between gap-1.5 mb-1.5 w-full">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-black truncate" style={{ color }}>
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{title}</span>
        </span>
        {badge && (
          <span className="shrink-0 rounded border px-1 py-0.2 text-[8px] font-mono font-bold" dir="ltr"
            style={{ borderColor: color + "45", color, background: color + "14" }}>
            {badge}
          </span>
        )}
      </div>
      <div className="w-full">{children}</div>
    </Tag>
  );
}

function MeterCompact({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = value == null ? "#64748b" : v > 85 ? "#ff2e63" : v > 60 ? "#fbbf24" : "#22d3ee";
  return (
    <div className="space-y-0.5" dir="ltr">
      <div className="flex justify-between text-[8px] font-mono text-white/55">
        <span>{label}</span>
        <span style={{ color }}>{value == null ? "—" : `${v}%`}</span>
      </div>
      <div className="h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, Math.max(0, v))}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    </div>
  );
}

const DOT: Record<string, string> = { ok: "#34d399", bad: "#ff2e63", wait: "#64748b" };

const LS_KEY = "daw.agentPro.v9";
interface Prefs { hiddenHud: HudCardId[]; hudOpen: boolean; chatOpen: boolean; chatWide?: boolean; autonomyMode?: "autonomous" | "assist" | "off"; offensivePosture?: boolean; rootSessionId?: string; }
const loadPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Prefs>;
      return {
        hiddenHud: Array.isArray(j.hiddenHud) ? (j.hiddenHud as HudCardId[]) : [],
        hudOpen: j.hudOpen === true,
        chatOpen: j.chatOpen !== false,
        chatWide: Boolean(j.chatWide),
        autonomyMode: ((j as Record<string, unknown>).autonomyMode as Prefs["autonomyMode"]) ?? "autonomous",
        offensivePosture: (j as Record<string, unknown>).offensivePosture !== false,
        rootSessionId: typeof (j as Record<string, unknown>).rootSessionId === "string" ? (j as Record<string, unknown>).rootSessionId as string : "nova-root",
      };
    }
  } catch { /* تفضيلات أول مرة */ }
  return { hiddenHud: [], hudOpen: false, chatOpen: true, chatWide: false, autonomyMode: "autonomous" as const, offensivePosture: true, rootSessionId: "nova-root" };
};

export default function NovaAgentPro() {
  const [arena, setArena] = useState<ArenaKey>("cockpit");
  const [, navigate] = useLocation();
  const sys = useSystem();
  const [vit, setVit] = useState<{ ok: boolean | null; ms: number | null; db: boolean | null; sha: string; up: number | null; tools: number }>({ ok: null, ms: null, db: null, sha: "", up: null, tools: 0 });
  const [agents, setAgents] = useState<FleetAgentInfo[]>([]);
  const [agentsErr, setAgentsErr] = useState<string | null>(null);
  const [brain, setBrain] = useState<{ providers: number; tools: number; council: number; cloud: number; ollamaOnline: boolean } | null>(null);
  const [hw, setHw] = useState<{ cpu: number | null; mem: number | null; cores: number | null }>({ cpu: null, mem: null, cores: null });
  const [vault, setVault] = useState<number | null>(null);
  const [corpus, setCorpus] = useState<{ total: number | null; kev: number | null }>({ total: null, kev: null });
  const [autoState, setAutoState] = useState<{ enabled: boolean; running: boolean; cycles: number; level: string }>({
    enabled: false, running: false, cycles: 0, level: "off",
  });
  const [autoBusy, setAutoBusy] = useState(false);
  const [nexus, setNexus] = useState<{
    rootSessionId: string;
    totalSessions: number;
    rootMessageCount: number;
    backgroundFeedCount: number;
    learnedInsightsCount: number;
    memoryTotal: number;
    rootDigest: string;
    recentBackground: Array<{ id: string; at?: number | string; ts?: string; kind: string; title: string; detail: string; source: string }>;
    learnedInsights: Array<{ id?: string; title?: string; detail?: string; ts?: string }>;
    sessions: Array<{ id: string; title: string; isRoot?: boolean; messageCount?: number; backgroundLinked?: boolean }>;
  } | null>(null);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronErr, setCronErr] = useState<string | null>(null);
  const [cronBusy, setCronBusy] = useState<string | null>(null);

  const [flash, setFlash] = useState<string | null>(null);
  const [notifs, setNotifs] = useState<Array<{ id: string; title: string; body?: string; kind?: string; read?: boolean; createdAt?: string; source?: string }>>([]);
  const [novaNotes, setNovaNotes] = useState<Array<{ id: string; title: string; body: string; pinned: boolean; createdAt: string }>>([]);
  const [noteDraft, setNoteDraft] = useState<{ title: string; body: string }>({ title: "", body: "" });
  const [noteBusy, setNoteBusy] = useState(false);
  const prefsHydrated = useRef(false);
  const [now, setNow] = useState(Date.now());
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === "undefined" ? { hiddenHud: [], hudOpen: false, chatOpen: true } : loadPrefs()));
  const [notes, setNotes] = useState<string>(() => { try { return localStorage.getItem("daw.agentPro.notes") ?? ""; } catch { return ""; } });
  const [notesSaved, setNotesSaved] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palQuery, setPalQuery] = useState("");
  const [palIdx, setPalIdx] = useState(0);
  const palInputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(Date.now());

  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(iv); }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* */ }
    // التفضيلات بقت محفوظة على السيرفر كمان — لو البراوزر اتمسح، المرة الجاية ترجع.
    // بس مش قبل ما السيرفر يحمّي أول قراءة (والإا هيبعت إعدادات متصفح قديمة تستبدل pin المالك).
    if (!prefsHydrated.current) return;
    const t = setTimeout(() => {
      void fetch("/api/panel/prefs", {
        method: "PUT",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefs: { chatOpen: prefs.chatOpen, chatWide: prefs.chatWide, hudOpen: prefs.hudOpen, hiddenHud: prefs.hiddenHud, autonomyMode: prefs.autonomyMode ?? "autonomous", offensivePosture: prefs.offensivePosture ?? true, rootSessionId: prefs.rootSessionId ?? "nova-root" }, by: "owner" }),
      }).catch(() => { /* بعيد عن الأنترنت — من localStorage مش ضايع */ });
    }, 300);
    return () => clearTimeout(t);
  }, [prefs]);

  // واكتب الأرينا الحالية — الصفحة تفتح فين ما سابتها مش من cockpit كل مرة.
  useEffect(() => {
    if (!prefsHydrated.current) return;
    const t = setTimeout(() => {
      void fetch("/api/panel/prefs", {
        method: "PUT",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefs: { arenaDefault: arena }, by: "owner" }),
      }).catch(() => { /* */ });
    }, 400);
    return () => clearTimeout(t);
  }, [arena]);

  // أول تفتّح: بقراءة التفضيلات من السيرفر لو فيه — السيرفر هو الأصل، الـlocal fallback.
  useEffect(() => {
    let alive = true;
    const fallbackHydrate = setTimeout(() => { prefsHydrated.current = true; }, 8000);
    void opsFetch<{ prefs?: Partial<Prefs> & Record<string, unknown> }>("/panel/prefs").then((r) => {
      prefsHydrated.current = true;
      if (!alive || !r.ok || !r.data?.prefs) return;
      const arenaDef = (r.data.prefs as Record<string, unknown>).arenaDefault;
      if (typeof arenaDef === "string" && ARENAS.some((a) => a.key === arenaDef) && arenaDef !== "cockpit") setArena(arenaDef as ArenaKey);
      const sp = r.data.prefs as Partial<Prefs> & { autonomyMode?: string; offensivePosture?: boolean; rootSessionId?: string };
      setPrefs((p) => ({
        ...p,
        hiddenHud: Array.isArray(sp.hiddenHud) ? (sp.hiddenHud as HudCardId[]) : p.hiddenHud,
        hudOpen: typeof sp.hudOpen === "boolean" ? sp.hudOpen : p.hudOpen,
        chatOpen: typeof sp.chatOpen === "boolean" ? sp.chatOpen : p.chatOpen,
        chatWide: typeof sp.chatWide === "boolean" ? sp.chatWide : p.chatWide,
        autonomyMode: (sp.autonomyMode === "autonomous" || sp.autonomyMode === "assist" || sp.autonomyMode === "off") ? sp.autonomyMode : "autonomous",
        offensivePosture: typeof sp.offensivePosture === "boolean" ? sp.offensivePosture : true,
        rootSessionId: typeof sp.rootSessionId === "string" && sp.rootSessionId ? sp.rootSessionId : "nova-root",
      }));
    });
    return () => { alive = false; clearTimeout(fallbackHydrate); };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem("daw.agentPro.notes", notes); setNotesSaved(true); } catch { /* */ } }, 400);
    return () => clearTimeout(t);
  }, [notes]);

  const flashSay = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? null : f)), 5500);
  }, []);

  const refreshCron = useCallback(async () => {
    const r = await opsFetch<{ jobs?: CronJob[] }>("/nova/cron/jobs");
    if (r.ok && r.data?.jobs) { setCronJobs(r.data.jobs); setCronErr(null); }
    else setCronErr(r.denial || r.error || "تعذّر الجلب");
  }, []);

  const cronTrigger = useCallback(async (id: string) => {
    setCronBusy(id);
    try {
      const r = await fetch(`/api/nova/cron/jobs/${encodeURIComponent(id)}/trigger`, { method: "POST", headers: novaAuthHeaders({}) });
      const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (r.ok && j?.ok !== false) flashSay("⚡ اتشغّلت فوري — النتيجة هتظهر في السجل خلال لحظات");
      else flashSay(`⚠ السيرفر ردّ ${r.status}`);
    } catch { flashSay("⚠ الطلب لم يصل للخادم"); }
    await refreshCron(); setCronBusy(null);
  }, [refreshCron, flashSay]);

  const cronToggle = useCallback(async (id: string, enabled: boolean) => {
    setCronBusy(id);
    try {
      const r = await fetch(`/api/nova/cron/jobs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (r.ok) flashSay(enabled ? "⏸ اتوقفت" : "▶ اترجعت تشغّل");
    } catch { flashSay("⚠ مفيش رد"); }
    await refreshCron(); setCronBusy(null);
  }, [refreshCron, flashSay]);

  const toggleAutonomyReal = useCallback(async () => {
    setAutoBusy(true);
    try {
      const targetOn = !autoState.enabled;
      const endpoint = targetOn ? "/api/autonomous/enable" : "/api/autonomous/disable";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: targetOn ? JSON.stringify({ level: "active" }) : undefined,
      });
      if (r.ok) {
        if (targetOn) sys.enableAutonomous(); else sys.disableAutonomous();
        flashSay(targetOn ? "⚡ تم تفعيل الاستقلالية 24/7 على السيرفر" : "⏸ تم إيقاف الاستقلالية");
      } else {
        flashSay(`⚠ الخادم رد ${r.status} عند تبديل الاستقلالية`);
      }
    } catch {
      flashSay("⚠ تعذر الوصول لمسار الاستقلالية");
    } finally {
      setAutoBusy(false);
    }
  }, [autoState.enabled, flashSay, sys]);

  const tickAutonomyNow = useCallback(async () => {
    setAutoBusy(true);
    try {
      const r = await fetch("/api/autonomous/tick", {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; cycle?: number; skipped?: boolean; reason?: string } | null;
      if (r.ok && d?.ok !== false) {
        flashSay(d?.skipped ? `ℹ نبضة: ${d.reason || "تم التخطي"}` : `⚡ دورة استقلالية فورية #${d?.cycle ?? ""}`);
      } else {
        flashSay(`⚠ تعذرت النبضة (${r.status})`);
      }
    } catch {
      flashSay("⚠ فشل الاتصال بنبضة الاستقلالية");
    } finally {
      setAutoBusy(false);
    }
  }, [flashSay]);

  const noteCreate = useCallback(async () => {
    if (!noteDraft.body.trim()) return;
    setNoteBusy(true);
    try {
      const r = await fetch("/api/nova/notes", { method: "POST", headers: novaAuthHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(noteDraft) });
      const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (r.ok && j?.ok) { setNoteDraft({ title: "", body: "" }); flashSay("📓 اتخزن في دفاتر نوفا — حاضر في كل جلسة"); }
    } catch { /* الفشل يبان */ }
    const nt = await opsFetch<{ notes?: Array<{ id: string; title: string; body: string; pinned: boolean; createdAt: string }> }>("/nova/notes");
    if (nt.ok && Array.isArray(nt.data?.notes)) setNovaNotes(nt.data.notes);
    setNoteBusy(false);
  }, [noteDraft, flashSay]);

  const noteDelete = useCallback(async (id: string) => {
    await fetch(`/api/nova/notes/${encodeURIComponent(id)}`, { method: "DELETE", headers: novaAuthHeaders({}) });
    setNovaNotes((arr) => arr.filter((n) => n.id !== id));
  }, []);

  const notePin = useCallback(async (id: string, pinned: boolean) => {
    await fetch(`/api/nova/notes/${encodeURIComponent(id)}`, { method: "PATCH", headers: novaAuthHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ pinned: !pinned }) });
    const nt = await opsFetch<{ notes?: Array<{ id: string; title: string; body: string; pinned: boolean; createdAt: string }> }>("/nova/notes");
    if (nt.ok && Array.isArray(nt.data?.notes)) setNovaNotes(nt.data.notes);
  }, []);

  const notifRead = useCallback(async (id: string) => {
    await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST", headers: novaAuthHeaders({}) });
    setNotifs((arr) => arr.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const launch = useCallback((a: LaunchAction) => {
    if (a.kind === "win") navigate(`/desktop?open=${encodeURIComponent(a.win)}`);
    else if (a.kind === "arena") setArena(a.arena);
    else {
      if (!prefs.chatOpen && arena !== "chat" && arena !== "cockpit") setPrefs((p) => ({ ...p, chatOpen: true }));
      window.dispatchEvent(new CustomEvent("nova:qa-prompt", { detail: { text: a.text } }));
    }
  }, [navigate, prefs.chatOpen, arena]);

  interface PalCmd { id: string; label: string; sub: string; color: string; run: () => void; }
  const allCmds = useMemo<PalCmd[]>(() => {
    const cmds: PalCmd[] = [];
    for (const a of ARENAS) cmds.push({ id: "arena:" + a.key, label: "قسم — " + a.labelAr, sub: "اقفز لساحة العرض", color: a.color, run: () => setArena(a.key) });
    for (const g of LAUNCH_GROUPS) for (const t of g.tiles) cmds.push({ id: "tile:" + t.id, label: t.label, sub: `${g.group} · ${t.hint}`, color: g.color, run: () => launch(t.action) });
    for (const j of cronJobs) cmds.push({ id: "cron:" + j.id, label: "⚡ شغّل فوري: " + j.name, sub: `cron ${j.cronExpr} · تشغيلات ×${j.runCount}`, color: "#34d399", run: () => void cronTrigger(j.id) });
    for (const g of NAV_GROUPS) for (const it of g.items) cmds.push({ id: "nav:" + it.path, label: it.label, sub: g.group + " · " + it.path, color: g.color, run: () => navigate(it.path) });
    return cmds;
  }, [cronJobs, launch, navigate, cronTrigger]);

  const palList = useMemo(() => {
    const q = palQuery.trim().toLowerCase();
    if (!q) return allCmds.slice(0, 24);
    return allCmds.filter((c) => (c.label + " " + c.sub).toLowerCase().includes(q)).slice(0, 24);
  }, [allCmds, palQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); setPalQuery(""); setPalIdx(0); }
      else if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (paletteOpen) setTimeout(() => palInputRef.current?.focus(), 30); }, [paletteOpen]);
  const runCmd = useCallback((c: PalCmd | undefined) => { if (!c) return; setPaletteOpen(false); c.run(); }, []);

  const refresh = useCallback(async () => {
    const t0 = performance.now();
    let ok = false, db: boolean | null = null, ms: number | null = null;
    try {
      const r = await fetch("/api/healthz");
      ms = Math.round(performance.now() - t0);
      const j = (await r.json().catch(() => null)) as { status?: string; db?: { reachable?: boolean } } | null;
      ok = r.ok && j?.status === "ok"; db = j?.db?.reachable ?? null;
    } catch { ok = false; ms = null; }
    let sha = "", up: number | null = null, tools = 0;
    try {
      const r = await fetch("/api/ops/version");
      const j = (await r.json().catch(() => null)) as { sha?: string; uptimeSec?: number; toolsPresent?: string[] } | null;
      sha = String(j?.sha ?? "").slice(0, 7);
      up = typeof j?.uptimeSec === "number" ? j.uptimeSec : null;
      tools = Array.isArray(j?.toolsPresent) ? j.toolsPresent.length : 0;
    } catch { /* offline */ }
    setVit({ ok, ms, db, sha, up, tools });

    try {
      const r = await fetch("/api/local-agent/connect-info", { headers: novaAuthHeaders() });
      const j = (await r.json().catch(() => null)) as { agents?: FleetAgentInfo[] } | null;
      if (r.ok && Array.isArray(j?.agents)) { setAgents(j.agents); setAgentsErr(null); }
      else setAgentsErr(`connect-info ${r.status}`);
    } catch { setAgentsErr("connect-info مش راد"); }

    const br = await opsFetch<{
      providers?: unknown[];
      tools?: number | unknown[];
      council?: { members?: unknown[] };
      cloudProviders?: unknown[];
      brain?: { ollamaOnline?: boolean; cloudProviders?: unknown[] };
    }>("/nova-core/status");
    let councilCount = 0;
    if (br.ok && br.data) {
      const cloudList = Array.isArray(br.data.brain?.cloudProviders)
        ? br.data.brain.cloudProviders
        : Array.isArray(br.data.cloudProviders)
          ? br.data.cloudProviders
          : [];
      const ollamaOnline = Boolean(br.data.brain?.ollamaOnline);
      councilCount = Array.isArray(br.data.council?.members) ? br.data.council.members.length : 0;
      const topProviders = Array.isArray(br.data.providers) ? br.data.providers.length : 0;
      const measuredProviders = topProviders || (cloudList.length + (ollamaOnline ? 1 : 0));
      setBrain({
        providers: measuredProviders,
        tools: Array.isArray(br.data.tools) ? br.data.tools.length : typeof br.data.tools === "number" ? br.data.tools : 0,
        council: councilCount,
        cloud: cloudList.length,
        ollamaOnline,
      });
    }
    if (councilCount === 0) {
      const cc = await opsFetch<{ members?: unknown[] }>("/nova-core/council");
      if (cc.ok && Array.isArray(cc.data?.members)) {
        setBrain((prev) => prev ? { ...prev, council: cc.data!.members!.length } : prev);
      }
    }

    const au = await opsFetch<{
      enabled?: boolean; active?: boolean; level?: string;
      daemon?: { running?: boolean; cycles?: number };
    }>("/autonomous/status");
    if (au.ok && au.data) {
      const isEnabled = Boolean(au.data.enabled ?? au.data.active ?? (au.data.level && au.data.level !== "off"));
      setAutoState({
        enabled: isEnabled,
        running: Boolean(au.data.daemon?.running ?? isEnabled),
        cycles: Number(au.data.daemon?.cycles ?? 0),
        level: String(au.data.level ?? (isEnabled ? "active" : "off")),
      });
    }

    const mr = await opsFetch<{ cpu?: { usage?: number; cores?: number }; memory?: { usagePercent?: number } }>("/monitor/system");
    if (mr.ok && mr.data) setHw({
      cpu: typeof mr.data.cpu?.usage === "number" ? Math.round(mr.data.cpu.usage) : null,
      mem: typeof mr.data.memory?.usagePercent === "number" ? mr.data.memory.usagePercent : null,
      cores: typeof mr.data.cpu?.cores === "number" ? mr.data.cpu.cores : null,
    });

    const fr = await opsFetch<{ total?: number; counts?: { total?: number } }>("/ops/findings/status");
    if (fr.ok && fr.data) setVault(typeof fr.data.counts?.total === "number" ? fr.data.counts.total : typeof fr.data.total === "number" ? fr.data.total : null);

    const cr = await opsFetch<{ total?: number; kev?: number }>("/ops/corpus");
    if (cr.ok && cr.data) setCorpus({
      total: typeof cr.data.total === "number" ? cr.data.total : null,
      kev: typeof cr.data.kev === "number" ? cr.data.kev : null,
    });

    const nx = await opsFetch<{
      ok?: boolean;
      rootSessionId?: string;
      totalSessions?: number;
      rootMessageCount?: number;
      backgroundFeedCount?: number;
      learnedInsightsCount?: number;
      memoryTotal?: number;
      rootDigest?: string;
      recentBackground?: Array<{ id: string; at?: number | string; ts?: string; kind: string; title: string; detail: string; source: string }>;
      learnedInsights?: Array<{ id?: string; title?: string; detail?: string; ts?: string }>;
      sessions?: Array<{ id: string; title: string; isRoot?: boolean; messageCount?: number; backgroundLinked?: boolean }>;
    }>("/nova-core/nexus");
    if (nx.ok && nx.data?.rootSessionId) {
      setNexus({
        rootSessionId: nx.data.rootSessionId,
        totalSessions: nx.data.totalSessions ?? 1,
        rootMessageCount: nx.data.rootMessageCount ?? 0,
        backgroundFeedCount: nx.data.backgroundFeedCount ?? 0,
        learnedInsightsCount: nx.data.learnedInsightsCount ?? 0,
        memoryTotal: nx.data.memoryTotal ?? 0,
        rootDigest: nx.data.rootDigest ?? "",
        recentBackground: Array.isArray(nx.data.recentBackground) ? nx.data.recentBackground : [],
        learnedInsights: Array.isArray(nx.data.learnedInsights) ? nx.data.learnedInsights : [],
        sessions: Array.isArray(nx.data.sessions) ? nx.data.sessions : [],
      });
    }
    const nf = await opsFetch<Array<Record<string, unknown>>>("/notifications");
    if (nf.ok && Array.isArray(nf.data)) setNotifs(nf.data as typeof notifs);
    const nt = await opsFetch<{ notes?: Array<{ id: string; title: string; body: string; pinned: boolean; createdAt: string }> }>("/nova/notes");
    if (nt.ok && Array.isArray(nt.data?.notes)) setNovaNotes(nt.data.notes);
    void refreshCron();
  }, [refreshCron]);

  useEffect(() => { void refresh(); const iv = setInterval(refresh, 12_000); return () => clearInterval(iv); }, [refresh]);

  const lastEvents = sys.systemEvents.slice(0, 36);
  const ticker = sys.systemEvents.slice(0, 2);
  const a0 = agents.find((a) => a.id === "self-node") ?? agents[0];
  const sessionS = Math.round((Date.now() - mounted.current) / 1000);
  const dayName = new Intl.DateTimeFormat("ar-EG", { weekday: "long" }).format(new Date());
  const cronOn = cronJobs.filter((j) => j.enabled).length;
  const visibleHudCount = HUD_DEFS.filter((d) => !prefs.hiddenHud.includes(d.id)).length;
  const autoEffectiveOn = autoState.enabled || sys.autonomousStatus.enabled;
  const autoEffectiveCycles = Math.max(autoState.cycles, sys.autonomousStatus.tasksCompleted);

  const toggleHudCard = (id: HudCardId) => setPrefs((p) => ({
    ...p,
    hiddenHud: p.hiddenHud.includes(id) ? p.hiddenHud.filter((x) => x !== id) : [...p.hiddenHud, id],
  }));

  const pill = (ok: boolean | null | undefined, label: string, extra = "") => {
    const color = ok == null ? "#64748b" : ok ? "#34d399" : "#ff2e63";
    return (
      <span key={label} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold"
        style={{ borderColor: color + "55", color, background: color + "14", boxShadow: ok ? `0 0 10px ${color}35` : "none" }}>
        <span className={"w-1.5 h-1.5 rounded-full" + (ok ? " animate-pulse" : "")} style={{ background: color }} />
        {ok == null ? `${label}: …` : ok ? `${label}${extra}` : `${label}: ✗`}
      </span>
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#040107] text-white" dir="rtl">
      {/* ── خلفية الجمجمة السايبرية + شبكة الهاكر الأخلاقي ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div
          className="absolute inset-[-4%] bg-center bg-cover opacity-[0.18]"
          style={{ backgroundImage: `url("${DAW_SKULL}")`, animation: "agentProBreathe 11s ease-in-out infinite" }}
        />
        <div className="absolute inset-0 cyber-hud-grid opacity-70" />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 25%, rgba(255,20,70,0.08) 0%, rgba(5,2,10,0.78) 55%, rgba(4,1,7,0.97) 100%)" }}
        />
        <div className="absolute inset-0 opacity-[0.06]" style={{ background: "repeating-linear-gradient(0deg, transparent 0 2px, #000 2px 4px)" }} />
      </div>
      <style>{`@keyframes agentProBreathe{0%,100%{transform:scale(1.02);opacity:.15}50%{transform:scale(1.06);opacity:.22}}`}</style>

      {/* ── لوحة الأوامر Ctrl+K ── */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-start justify-center pt-[12vh]" onClick={() => setPaletteOpen(false)}>
          <div className="w-[min(640px,92vw)] rounded-2xl border border-rose-500/45 bg-[#09030e] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 0 60px rgba(255,30,80,.35)" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-rose-500/20">
              <Command className="w-4 h-4 text-rose-400" />
              <input
                ref={palInputRef}
                value={palQuery}
                onChange={(e) => { setPalQuery(e.target.value); setPalIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setPalIdx((i) => Math.min(i + 1, palList.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setPalIdx((i) => Math.max(i - 1, 0)); }
                  else if (e.key === "Enter") runCmd(palList[palIdx]);
                }}
                placeholder="ابحث: قسم، سلاح، مهمة كرون، صفحة…"
                className="flex-1 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30"
              />
              <span className="text-[9px] font-mono text-white/30 border border-white/10 rounded px-1.5 py-0.5" dir="ltr">Esc</span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-1.5">
              {palList.length === 0 && <div className="text-center text-[11px] font-mono text-white/35 py-6">مفيش نتايج</div>}
              {palList.map((c, i) => (
                <button key={c.id} onClick={() => runCmd(c)}
                  onMouseEnter={() => setPalIdx(i)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-right transition ${i === palIdx ? "bg-rose-500/15" : "hover:bg-white/5"}`}>
                  <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold text-white/90 truncate">{c.label}</div>
                    <div className="text-[9px] font-mono text-white/35 truncate">{c.sub}</div>
                  </div>
                  <ArrowLeft className="w-3 h-3 text-white/25 shrink-0" />
                </button>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-white/10 text-[9px] font-mono text-white/30 flex gap-3">
              <span>↑↓ تنقل</span><span>Enter تنفيذ</span><span className="mr-auto">{palList.length} أمر متاح</span>
            </div>
          </div>
        </div>
      )}

      {/* ── الهيدر السايبري العلوي ── */}
      <header className="relative z-10 shrink-0 cyber-top-sweep border-b border-rose-500/25 bg-gradient-to-l from-rose-950/35 via-[#07020b]/95 to-cyan-950/25 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative shrink-0">
            <img
              src={DAW_SKULL}
              alt="Dawsha Skull"
              className="w-10 h-10 rounded-full object-cover ring-2 ring-rose-500/85 skull-halo"
            />
            <span className="absolute -bottom-0.5 -left-0.5 text-[10px] leading-none">☠</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-black leading-4 text-transparent bg-clip-text bg-gradient-to-l from-rose-300 via-white to-cyan-300 flex items-center gap-1.5">
              <span>دولاب دوشة — مركز التحكم الكلي</span>
              <span className="rounded border border-rose-500/45 bg-rose-500/15 px-1.5 py-0.5 text-[8px] font-mono text-rose-200">ETHICAL RED-OPS</span>
            </h1>
            <div className="text-[8px] font-mono text-cyan-200/50 mt-0.5">
              {dayName} · الجلسة {fmtUptime(sessionS)} · sha {vit.sha || "…"} · التشغيل {fmtUptime(vit.up)}
            </div>
          </div>
          <div className="mr-auto flex items-center gap-1.5 flex-wrap">
            {pill(vit.ok, "السيرفر", vit.ok && vit.ms != null ? ` ${vit.ms}ms` : "")}
            {pill(vit.db, "DB")}
            {pill(agents.length > 0 ? true : agentsErr == null ? null : false, `عُقد ×${agents.length}`)}
            {pill(vit.tools > 0 ? true : null, `أدوات ×${vit.tools}`)}
            {pill(cronOn > 0 ? true : null, `كرون ${cronOn}/${cronJobs.length}`)}
            {nexus && pill(true, "الجذر 24/7", ` · خلفية ×${nexus.backgroundFeedCount} · تعلم ×${nexus.learnedInsightsCount}`)}
            <button onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/45 bg-rose-500/15 px-2.5 py-1 text-[10px] font-black text-rose-200 hover:bg-rose-500/25 transition shadow-[0_0_12px_rgba(255,46,99,0.2)]">
              <Command className="w-3 h-3" /> Ctrl+K
            </button>
            {arena !== "chat" && arena !== "cockpit" && (
              <button onClick={() => setPrefs((p) => ({ ...p, chatOpen: !p.chatOpen }))}
                title={prefs.chatOpen ? "إخفاء الشات الجانبي" : "إظهار الشات الجانبي"}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-black transition ${prefs.chatOpen ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200" : "border-white/15 bg-white/5 text-white/50"}`}>
                {prefs.chatOpen ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} <MessageSquare className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        {flash && <div className="mt-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-[10px] font-mono text-emerald-200">{flash}</div>}
      </header>

      {/* ── شريط القيادة العلوي الموحّد (نُقل من الجنب للأعلى) ── */}
      <section className="relative z-10 shrink-0 border-b border-rose-500/20 bg-[#06020b]/90 px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPrefs((p) => ({ ...p, hudOpen: !p.hudOpen }))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-200 hover:bg-rose-500/20 transition"
          >
            <Skull className="w-3 h-3 text-rose-400" />
            <span>لوحة القياسات HUD</span>
            <span className="text-[8px] font-mono text-rose-300/70" dir="ltr">({visibleHudCount}/6)</span>
            {prefs.hudOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <div className="flex items-center gap-1 flex-wrap">
            {HUD_DEFS.map((r) => {
              const hidden = prefs.hiddenHud.includes(r.id);
              return (
                <button key={r.id} type="button" onClick={() => toggleHudCard(r.id)}
                  className={`rounded-md border px-2 py-0.5 text-[9px] font-bold transition ${
                    hidden
                      ? "border-white/10 bg-white/[0.02] text-white/30 line-through"
                      : "border-cyan-400/35 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400/60"
                  }`}>
                  {r.title}
                </button>
              );
            })}
            {prefs.hiddenHud.length > 0 && (
              <button type="button" onClick={() => setPrefs((p) => ({ ...p, hiddenHud: [] }))}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[8px] font-bold text-white/60 hover:text-white">
                <RotateCcw className="w-2.5 h-2.5" /> الكل
              </button>
            )}
          </div>

          <span className="mr-auto hidden sm:inline-flex items-center gap-1 text-[9px] font-mono text-rose-300/60">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            ميثاق دوشة: اختبارات أخلاقية مصرّح بها فقط
          </span>
        </div>

        {prefs.hudOpen && visibleHudCount > 0 && (
          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            {!prefs.hiddenHud.includes("fleet") && (
              <HudCard
                title="الأسطول الحي"
                icon={Server}
                color="#22d3ee"
                badge={`${agents.length} عقدة`}
                onClick={() => navigate("/desktop?open=nodes")}
              >
                {agents.length > 0 ? (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" style={{ boxShadow: "0 0 8px #34d399" }} />
                      <span className="font-mono text-[10px] font-black text-cyan-100 truncate" dir="ltr">{a0?.id}</span>
                    </div>
                    <div className="text-[8px] font-mono text-white/45 truncate" dir="ltr">
                      {a0?.hostname} · {a0?.platform}{a0?.cpus ? ` · ${a0.cpus}C` : ""}
                    </div>
                  </div>
                ) : (
                  <div className="text-[9px] font-mono text-white/40 truncate">{agentsErr ?? "ينتظر انضمام عقدة"}</div>
                )}
              </HudCard>
            )}

            {!prefs.hiddenHud.includes("hw") && (
              <HudCard
                title="العتاد الحي"
                icon={Cpu}
                color="#38bdf8"
                badge={hw.cores ? `${hw.cores}C` : "—"}
                onClick={() => setArena("hardware")}
              >
                <div className="space-y-1">
                  <MeterCompact label="CPU" value={hw.cpu} />
                  <MeterCompact label="RAM" value={hw.mem} />
                </div>
              </HudCard>
            )}

            {!prefs.hiddenHud.includes("vault") && (
              <HudCard
                title="الخزنة + الكوربوس"
                icon={Target}
                color="#ff2e63"
                badge="NVD/KEV"
                onClick={() => navigate("/cve-live")}
              >
                <div className="grid grid-cols-3 gap-1 text-center font-mono">
                  <div>
                    <div className="text-xs font-black text-rose-300">{vault ?? "—"}</div>
                    <div className="text-[7px] text-white/45">مؤكدة</div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-rose-200">{corpus.total != null ? `${Math.round(corpus.total / 1000)}K` : "—"}</div>
                    <div className="text-[7px] text-white/45">CVE</div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-amber-300">{corpus.kev != null ? corpus.kev.toLocaleString("en") : "—"}</div>
                    <div className="text-[7px] text-white/45">KEV</div>
                  </div>
                </div>
              </HudCard>
            )}

            {!prefs.hiddenHud.includes("brain") && (
              <HudCard
                title="المخ والمجلس"
                icon={Brain}
                color="#a78bfa"
                badge={brain ? `${brain.tools} أداة` : "…"}
                onClick={() => setArena("brain")}
              >
                {brain ? (
                  <div className="grid grid-cols-4 gap-1 text-center font-mono">
                    <div>
                      <div className="text-xs font-black text-violet-200">{brain.providers}</div>
                      <div className="text-[7px] text-white/45">مزود</div>
                    </div>
                    <div>
                      <div className="text-xs font-black text-cyan-300">{brain.cloud}</div>
                      <div className="text-[7px] text-white/45">سحابي</div>
                    </div>
                    <div>
                      <div className="text-xs font-black text-emerald-300">{brain.tools}</div>
                      <div className="text-[7px] text-white/45">أداة</div>
                    </div>
                    <div>
                      <div className="text-xs font-black text-rose-300">{brain.council}</div>
                      <div className="text-[7px] text-white/45">مقعد</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-[9px] font-mono text-white/40">جاري القياس…</div>
                )}
              </HudCard>
            )}

            {!prefs.hiddenHud.includes("autonomy") && (
              <HudCard
                title="الاستقلالية 24/7"
                icon={autoEffectiveOn ? Zap : ZapOff}
                color={autoEffectiveOn ? "#34d399" : "#fbbf24"}
                badge={autoEffectiveOn ? `⚡ ×${autoEffectiveCycles}` : "OFF"}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[9px] font-mono truncate" style={{ color: autoEffectiveOn ? "#34d399" : "#fbbf24" }}>
                    {autoEffectiveOn ? (autoState.running ? "نشط 24/7" : "مفعّل") : "موقوف مؤقتاً"}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={autoBusy}
                      onClick={() => void toggleAutonomyReal()}
                      className="rounded border px-1.5 py-0.5 text-[8px] font-black transition disabled:opacity-40"
                      style={autoEffectiveOn
                        ? { borderColor: "#fbbf2460", background: "#fbbf2418", color: "#fbbf24" }
                        : { borderColor: "#34d39960", background: "#34d39918", color: "#34d399" }}
                    >
                      {autoEffectiveOn ? "إيقاف" : "تشغيل"}
                    </button>
                    <button
                      type="button"
                      disabled={autoBusy}
                      onClick={() => void tickAutonomyNow()}
                      title="تشغيل دورة نبض فورية"
                      className="rounded border border-cyan-400/45 bg-cyan-500/15 px-1.5 py-0.5 text-[8px] font-black text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40"
                    >
                      نبضة
                    </button>
                  </div>
                </div>
              </HudCard>
            )}

            {!prefs.hiddenHud.includes("cronmini") && (
              <HudCard
                title="الجدولة + الجذر"
                icon={CalendarClock}
                color="#34d399"
                badge={`${cronOn}/${cronJobs.length}`}
                onClick={() => setArena("cron")}
              >
                {cronJobs.length > 0 ? (
                  <div className="space-y-0.5">
                    {cronJobs.slice(0, 2).map((j) => (
                      <div key={j.id} className="flex items-center gap-1.5 text-[8px] font-mono">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: j.enabled ? DOT.ok : "#475569" }} />
                        <span className="text-white/70 truncate flex-1">{j.name}</span>
                        <span className="text-white/35 shrink-0">{ago(j.nextRun, now)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[8px] font-mono text-rose-300/70 truncate">{cronErr ?? "جاري التحميل…"}</div>
                )}
              </HudCard>
            )}
          </div>
        )}
      </section>

      {/* ── جسم المنصة: المنضدة الكاملة + الشات الجانبي القابل للطيّ ── */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col min-h-0">
          <nav className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 border-b border-rose-500/15 overflow-x-auto bg-[#07020b]/85">
            {ARENAS.map(({ key, labelAr, icon: Icon, color }) => {
              const active = arena === key;
              const badge = key === "cron" && cronJobs.length > 0 ? `${cronOn}/${cronJobs.length}` : null;
              return (
                <button key={key} onClick={() => setArena(key)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-black transition-all"
                  style={active
                    ? { borderColor: color + "80", background: `${color}22`, color, boxShadow: `0 0 16px ${color}35 inset, 0 0 10px ${color}25` }
                    : { borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.55)" }}>
                  <Icon className="w-3.5 h-3.5" />
                  {labelAr}
                  {badge && <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-1.5 text-[8px] text-emerald-300 font-mono" dir="ltr">{badge}</span>}
                </button>
              );
            })}
          </nav>

          <div className={`min-h-0 flex-1 ${arena === "cockpit" ? "flex flex-col overflow-hidden p-0" : arena === "chat" ? "flex flex-col overflow-hidden p-2" : "overflow-y-auto p-3"}`}>
            <ErrorIsland title={arena}>
            {arena === "cockpit" && <AgentWorkCockpit />}
            {arena === "launch" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-rose-500/30 bg-gradient-to-l from-rose-500/10 via-black/40 to-cyan-500/10 px-3.5 py-2 text-[10px] font-mono text-rose-100/80 flex flex-wrap items-center gap-2">
                  <span>☠ Ctrl+K يفتح لوحة الأوامر السريعة · بلاط النافذة يفتح أداة الديسكتوب · بلاط الأمر يجهّز البرومبت في الشات بدون تنفيذ مخفي.</span>
                </div>
                {LAUNCH_GROUPS.map(({ group, color, tiles }) => (
                  <section key={group}>
                    <h2 className="text-[12px] font-black mb-2 flex items-center gap-2" style={{ color, textShadow: `0 0 12px ${color}55` }}>
                      <span className="w-1.5 h-4 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
                      {group}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {tiles.map(({ id, label, hint, icon: Icon, hue, action }) => (
                        <button key={id} onClick={() => launch(action)}
                          className={`rounded-xl border bg-gradient-to-br px-3 py-2.5 text-right transition-all hover:-translate-y-0.5 hover:shadow-lg ${hue}`}
                          style={{ boxShadow: "0 4px 18px rgba(0,0,0,.45)" }}>
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="text-[11px] font-black font-mono" dir="ltr">{label}</span>
                          </div>
                          <div className="mt-1 text-[8px] font-mono opacity-70 truncate">{hint}</div>
                          <div className="mt-1 text-[7px] font-mono opacity-45">
                            {action.kind === "win" ? "↗ نافذة" : action.kind === "arena" ? "⇄ قفزة" : "✎ يحشي الشات"}
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {arena === "cron" && (
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-white/45 mb-1">
                  {cronJobs.length} مهمة حية — Trigger فوري وتشغيل/إطفاء حقيقيان، والنتايج موصولة بساحتها.
                </div>
                {cronErr && <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[10px] font-mono text-rose-200">{cronErr}</div>}
                {cronJobs.map((j) => {
                  const link = CRON_LINKS[j.id];
                  const busyThis = cronBusy === j.id;
                  return (
                    <div key={j.id} className="rounded-xl border px-3 py-2.5 flex items-center gap-3 flex-wrap"
                      style={{ borderColor: j.enabled ? "#34d39940" : "#ffffff14", background: j.enabled ? "#34d3990a" : "rgba(255,255,255,0.02)" }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: j.enabled ? DOT.ok : "#475569", boxShadow: j.enabled ? "0 0 10px #34d399" : "none" }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-black text-white/90">{j.name}</span>
                          <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[8px] font-mono text-white/60" dir="ltr">{j.cronExpr}</span>
                          <span className="rounded border px-1.5 py-0.5 text-[8px] font-mono" style={{ borderColor: j.enabled ? "#34d39945" : "#64748b45", color: j.enabled ? "#34d399" : "#94a3b8" }}>{j.enabled ? "شغّالة" : "مطفية"}</span>
                          {j.errorCount > 0 && <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[8px] font-mono text-rose-300">أخطاء ×{j.errorCount}</span>}
                        </div>
                        <div className="mt-1 text-[9px] font-mono text-white/40">
                          تشغيلات ×{j.runCount} · آخر: {ago(j.lastRun, now)}{j.nextRun ? ` · تالي: ${ago(j.nextRun, now)}` : ""}
                        </div>
                        {j.lastResult && (
                          <div className="mt-1 rounded-lg border border-white/[0.08] bg-black/40 px-2 py-1 text-[9px] font-mono text-emerald-100/80 leading-4 break-words">
                            ↳ {j.lastResult}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {link && (
                          <button onClick={() => navigate(link.path)}
                            className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[9px] font-black text-sky-300 hover:bg-sky-500/20 transition">
                            <ArrowLeft className="w-3 h-3" /> {link.label}
                          </button>
                        )}
                        <button onClick={() => void cronTrigger(j.id)} disabled={busyThis}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[9px] font-black text-emerald-300 hover:bg-emerald-500/20 transition disabled:opacity-40">
                          <Play className="w-3 h-3" /> {busyThis ? "شغّال…" : "فوري"}
                        </button>
                        <button onClick={() => void cronToggle(j.id, j.enabled)} disabled={busyThis}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[9px] font-black transition disabled:opacity-40 ${j.enabled ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}>
                          <PowerCircle className="w-3 h-3" /> {j.enabled ? "إطفاء" : "تشغيل"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {cronJobs.length === 0 && !cronErr && <div className="text-center text-[11px] font-mono text-white/35 py-6">يتقاس…</div>}
              </div>
            )}

            {arena === "chat" && (
              <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border border-rose-500/35 bg-[#06020a]"
                style={{ boxShadow: "0 0 36px rgba(255,30,80,.14) inset, 0 0 24px rgba(34,211,238,.08)" }}>
                <NovaUnifiedChat title="نوفا — الشات الكامل" subtitle="nova-root 24/7" hideRail compact />
              </div>
            )}

            {arena === "nexus" && (
              <div className="space-y-3">
                <div className="text-[10px] font-mono text-teal-100/50">
                  الجذر الدائم (nova-root) — كل حاجة في البرنامج بتتحدث هنا: الجلسات، النبض الخلفي، والتعلم. الأعداد من /api/nova-core/nexus عيش.
                </div>
                {!nexus && <div className="text-center text-[11px] font-mono text-white/35 py-6">يتقاس…</div>}
                {nexus && (<>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { v: nexus.totalSessions ?? 0, l: "جلسة", c: "#2dd4bf" },
                      { v: nexus.backgroundFeedCount ?? 0, l: "نبض خلفي", c: "#34d399" },
                      { v: nexus.learnedInsightsCount ?? 0, l: "رؤية متعلمة", c: "#a78bfa" },
                      { v: nexus.memoryTotal ?? 0, l: "ذكرى محفوظة", c: "#fb7185" },
                    ].map((x) => (
                      <div key={x.l} className="rounded-xl border text-center py-3" style={{ borderColor: x.c + "30", background: x.c + "08" }}>
                        <div className="text-lg font-black font-mono" style={{ color: x.c }}>{x.v}</div>
                        <div className="text-[8px] font-mono text-white/40">{x.l}</div>
                      </div>
                    ))}
                  </div>
                  {nexus.rootDigest && (
                    <div className="rounded-xl border border-teal-400/25 bg-teal-500/[0.06] px-4 py-3 text-[11px] font-bold text-teal-100/90 leading-5">
                      🧠 خلاصة الجذر: {nexus.rootDigest}
                    </div>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <section className="rounded-xl border border-emerald-400/20 bg-black/40 overflow-hidden">
                      <header className="px-3 py-2 border-b border-emerald-400/15 bg-emerald-500/[0.07] text-[10px] font-black text-emerald-300">النبض الخلفي (المراقبون · الحصاد · الأحداث)</header>
                      <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
                        {(nexus.recentBackground ?? []).length === 0 && <div className="text-[9px] font-mono text-white/30 px-2 py-3">النبض هادي — أول حدث هيظهر هنا فورًا (المراقبون بتنبض كل 5 دقائق)</div>}
                        {(nexus.recentBackground ?? []).slice(0, 20).map((ev) => (
                          <div key={ev.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className="rounded border border-emerald-400/30 bg-emerald-500/10 px-1 text-[8px] font-mono text-emerald-300" dir="ltr">{ev.kind}</span>
                              <span className="text-[10px] font-bold text-white/75 flex-1 truncate">{ev.title}</span>
                              <span className="text-[8px] font-mono text-white/30 shrink-0">{ago(ev.ts, now)}</span>
                            </div>
                            <div className="mt-0.5 text-[9px] font-mono text-white/45 leading-4">{ev.detail}</div>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="rounded-xl border border-violet-400/20 bg-black/40 overflow-hidden">
                      <header className="px-3 py-2 border-b border-violet-400/15 bg-violet-500/[0.07] text-[10px] font-black text-violet-300">الجلسات المتصلة بالجذر</header>
                      <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
                        {(nexus.sessions ?? []).map((sess) => (
                          <div key={sess.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sess.isRoot ? "#fb7185" : "#2dd4bf", boxShadow: `0 0 6px ${sess.isRoot ? "#fb7185" : "#2dd4bf"}` }} />
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-bold text-white/80 truncate">{sess.title}</div>
                              <div className="text-[8px] font-mono text-white/35">{sess.id} · رسايل {sess.messageCount ?? 0}{sess.backgroundLinked ? " · مربوطة بالخلفية 🔗" : ""}</div>
                            </div>
                            {sess.isRoot && <span className="text-[8px] font-black text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-1 py-0.5">الجذر</span>}
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                  {(nexus.learnedInsights ?? []).length > 0 && (
                    <section className="rounded-xl border border-violet-400/20 bg-violet-500/[0.05] px-3 py-2.5">
                      <div className="text-[10px] font-black text-violet-300 mb-1.5">رؤى متعلمة (auto-dream)</div>
                      {(nexus.learnedInsights ?? []).slice(0, 8).map((li, i) => (
                        <div key={li.id ?? i} className="text-[9px] font-mono text-white/55 py-0.5 border-b border-white/[0.04] last:border-0">💡 {li.title ?? li.detail ?? JSON.stringify(li).slice(0, 120)}</div>
                      ))}
                    </section>
                  )}
                </>)}
              </div>
            )}

            {arena === "events" && (
              <div className="space-y-3">
                {nexus && nexus.recentBackground.length > 0 && (
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.05] p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] font-black text-cyan-200">
                      <span>🧠 ذاكرة الخلفية 24/7 — محفوظة في الجذر الدائم ({nexus.rootSessionId})</span>
                      <span className="font-mono text-[9px] text-cyan-300/75">خلفية ×{nexus.backgroundFeedCount} · تعلم ×{nexus.learnedInsightsCount}</span>
                    </div>
                    <div className="space-y-1 max-h-44 overflow-y-auto">
                      {nexus.recentBackground.map((b) => (
                        <div key={b.id} className="flex items-baseline gap-2 rounded-lg border border-cyan-400/15 bg-black/45 px-2.5 py-1.5 text-[10px]">
                          <span className="shrink-0 font-mono text-[9px] text-white/35">{fmtClock(b.at ?? b.ts ?? Date.now())}</span>
                          <span className="shrink-0 font-mono text-[9px] font-bold text-cyan-300 uppercase">[{b.source || b.kind}]</span>
                          <span className="text-white/85 truncate flex-1">{b.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-1" dir="ltr">
                  {lastEvents.length === 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-[11px] font-mono text-white/40" dir="rtl">
                      قناة الأحداث مفتوحة (SSE) — أول حدث هيظهر هنا لحظيًا: مهمة بتبدأ، ذكرى بتتخزن، عقدة بتدخل.
                    </div>
                  )}
                  {lastEvents.map((ev, i) => (
                    <div key={`${ev.ts}-${i}`} className="flex items-baseline gap-3 rounded-lg border border-emerald-400/15 bg-black/45 px-2.5 py-1.5">
                      <span className="shrink-0 font-mono text-[9px] text-white/35">{fmtClock(ev.ts)}</span>
                      <span className="shrink-0 font-mono text-[10px] font-bold text-emerald-300">{ev.type}</span>
                      {ev.data && <span className="truncate font-mono text-[9px] text-white/45">{JSON.stringify(ev.data).slice(0, 140)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {arena === "work" && (
              <div className="space-y-3">
                <div className="text-[10px] font-mono text-teal-100/60">منضدة حقيقية: تيرمنال + ملفات + نوتك — كلهم جنب بعض ومفيش حاجة مستخبية.</div>
                <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                  <div className="flex min-h-[430px] flex-col overflow-hidden rounded-xl border border-emerald-400/20 bg-black/55" style={{ boxShadow: "0 0 24px rgba(52,211,153,.08) inset" }}>
                    <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/5 px-3 bg-emerald-500/10">
                      <span className="text-[10px] font-black text-emerald-300">تيرمنال كالي الحي</span>
                      <span className="font-mono text-[9px] text-white/40" dir="ltr">{a0 ? `${a0.hostname} · ${a0.user ?? "—"}` : "ينتظر عقدة…"}</span>
                    </div>
                    <div className="min-h-[380px] flex-1" dir="ltr">
                      <KaliTerminal agentConnected={agents.length > 0} agentHostname={a0?.hostname ?? ""} agentUser={a0?.user ?? ""} />
                    </div>
                  </div>
                  <div className="flex min-h-[430px] flex-col overflow-hidden rounded-xl border border-cyan-400/20 bg-black/55" style={{ boxShadow: "0 0 24px rgba(34,211,238,.08) inset" }}>
                    <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/5 px-3 bg-cyan-500/10">
                      <span className="text-[10px] font-black text-cyan-300">مدير ملفات العقدة</span>
                      <span className="font-mono text-[9px] text-white/40" dir="ltr">/api/files · عمليات حقيقية</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <AdvancedFileManager />
                    </div>
                  </div>
                </div>
                <section className="rounded-xl border border-teal-400/25 bg-teal-500/[0.04] overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-teal-400/20 bg-teal-500/[0.08]">
                    <FileCode className="w-3.5 h-3.5 text-teal-300" />
                    <span className="text-[10px] font-black text-teal-200">دفتر العملية — ملاحظات، أهداف، نتايج سريعة</span>
                    <span className="mr-auto text-[8px] font-mono text-teal-200/50">{notesSaved ? "✓ محفوظ" : "…"} · محليًا في متصفحك</span>
                  </div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="الهدف: …\nالمنافذ المفتوحة: …\nالملاحظات: …"
                    className="w-full h-36 bg-transparent p-3 text-[12px] font-mono text-white/85 placeholder:text-white/25 outline-none resize-y leading-5"
                    dir="auto"
                  />
                </section>
              </div>
            )}

            {arena === "missions" && (
              <div className="space-y-3 min-w-0">
                <NovaMissions />
                {/* TEST9: مهمات السيرفر الحقيقية بفروع ودوينات — «وكل الي عملو
                    وبيعملو وهيعلمو» في قسم واحد تحت مهمات الجهاز مباشرة. */}
                <ServerTasks />
              </div>
            )}
            {arena === "brain" && <NovaOpsRoom />}
            {arena === "hardware" && <RealTimeSystemMonitor />}
            {arena === "hunt" && <NovaHuntSurface />}
            {arena === "channels" && (
              <div className="max-w-3xl space-y-3">
                <TelegramConfigCard />
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-[11px] font-mono text-amber-200/85 space-y-1.5">
                  <div className="font-bold">قنوات من نفس المحور:</div>
                  <div>· تنبيهات الزيارات مربوطة بنفس القناة فور التوكن.</div>
                  <div>· GitHub: الحزمة بتتبنى بتوقيع من CI، والـwatchdog بيفعّل صيانة الأدوات تلقائيًا.</div>
                  <div>· مهمة «tg_pulse» في الجدولة — شغّلها لو عايز نبضة تليجرام كل ساعة.</div>
                </div>
              </div>
            )}
            {arena === "alerts" && (
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-orange-100/50">مركز الإشعارات — متصل بكل المصادر: الكرون، المراقبون، الصيد، حصاد الخزنة، الجلسات. ({notifs.length} إشعار)</div>
                {notifs.length === 0 && <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center text-[11px] font-mono text-white/35">لسه هادي — أول نبضة من الكرون/المراقبين هتبان هنا فورًا.</div>}
                {notifs.slice(0, 60).map((n) => (
                  <div key={n.id} className={`rounded-xl border px-3 py-2 flex items-center gap-3 ${n.read ? "opacity-50" : ""}`}
                    style={{ borderColor: "#fb923c22", background: n.read ? "transparent" : "#fb923c0a" }}>
                    <Bell className="w-3.5 h-3.5 text-orange-300 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-white/85 truncate">{n.title}</div>
                      {n.body && <div className="text-[9px] font-mono text-white/45 leading-4 break-words">{n.body}</div>}
                      <div className="text-[8px] font-mono text-white/30 mt-0.5">{n.kind ? `[${n.kind}] ` : ""}{n.createdAt ? ago(n.createdAt, now) : ""}{n.source ? ` · ${n.source}` : ""}</div>
                    </div>
                    {!n.read && (
                      <button onClick={() => void notifRead(n.id)} className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[8px] font-bold text-white/50 hover:text-white/85 transition">قرأتها</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {arena === "notes" && (
              <div className="space-y-3">
                <div className="text-[10px] font-mono text-yellow-100/50">دفاتر نوفا — ملاحظات بتتحفظ على السيرفر (state/nova-notes.json) وتفضل مع الأجينت في كل الجلسات والخلفية.</div>
                <div className="rounded-xl border border-yellow-400/25 bg-yellow-500/[0.05] p-3 space-y-2">
                  <input value={noteDraft.title} onChange={(e) => setNoteDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="عنوان الملاحظة (اختياري)" className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-[12px] font-bold text-white/85 placeholder:text-white/25 outline-none" />
                  <textarea value={noteDraft.body} onChange={(e) => setNoteDraft((d) => ({ ...d, body: e.target.value }))}
                    placeholder="اكتب الملاحظة… هدف، أمر مهم، نتيجة حصلت— الأجينت هيشوفها معاك دايمًا"
                    className="w-full h-24 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-[12px] font-mono text-white/85 placeholder:text-white/25 outline-none resize-y leading-5" />
                  <button onClick={() => void noteCreate()} disabled={noteBusy || !noteDraft.body.trim()}
                    className="rounded-lg border border-yellow-400/40 bg-yellow-500/15 px-4 py-2 text-[11px] font-black text-yellow-200 hover:bg-yellow-500/25 transition disabled:opacity-40">
                    {noteBusy ? "بيتحفظ…" : "📓 حفّظها في دفاتر نوفا"}
                  </button>
                </div>
                {novaNotes.length === 0 && <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center text-[11px] font-mono text-white/35">لسه فاضية — أول ملاحظة هتنزل هنا وتفضل صاحبة الأجينت.</div>}
                {novaNotes.map((n) => (
                  <div key={n.id} className="rounded-xl border px-3 py-2.5" style={{ borderColor: n.pinned ? "#fde04745" : "#ffffff12", background: n.pinned ? "#fde04708" : "rgba(255,255,255,0.015)" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-black text-yellow-100/90 flex-1 truncate">{n.pinned ? "📌 " : ""}{n.title}</span>
                      <span className="text-[8px] font-mono text-white/30 shrink-0">{ago(n.createdAt, now)}</span>
                      <button onClick={() => void notePin(n.id, n.pinned)} title={n.pinned ? "شيل التثبيت" : "ثبّتها"} className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-white/40 hover:text-yellow-200 transition"><Pin className="w-3 h-3" /></button>
                      <button onClick={() => void noteDelete(n.id)} title="امسحها" className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-white/40 hover:text-rose-300 transition"><Trash2 className="w-3 h-3" /></button>
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-white/65 whitespace-pre-wrap leading-5">{n.body}</div>
                  </div>
                ))}
              </div>
            )}

            {arena === "nav" && (
              <div className="space-y-4">
                {NAV_GROUPS.map(({ group, color, items }) => (
                  <section key={group}>
                    <h2 className="text-[11px] font-black mb-2 flex items-center gap-2" style={{ color }}>
                      <span className="w-1 h-3.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                      {group}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                      {items.map((it) => (
                        <button key={it.path} type="button" onClick={() => navigate(it.path)}
                          className="rounded-xl border px-3 py-3 text-center text-[11px] font-bold transition-all hover:-translate-y-0.5 cursor-pointer"
                          style={{ borderColor: color + "35", background: color + "0e", color: color + "ee", boxShadow: `0 0 12px ${color}12 inset` }}>
                          {it.label}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            </ErrorIsland>
          </div>
        </section>

        {/* ── الشات الجانبي بتحكم إظهار/إخفاء كامل ── */}
        {prefs.chatOpen && arena !== "chat" && arena !== "cockpit" && (
          <aside className={`w-full h-[46vh] lg:h-auto ${prefs.chatWide ? "lg:w-[560px] xl:w-[620px]" : "lg:w-[450px] xl:w-[480px]"} shrink-0 border-t lg:border-t-0 lg:border-r border-rose-500/25 flex flex-col min-h-0 bg-[#050209] transition-all duration-200`}>
            <div className="shrink-0 flex items-center gap-1.5 px-3 py-1 border-b border-rose-500/20 bg-gradient-to-l from-rose-900/25 to-cyan-950/20">
              <Sparkles className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-[10px] font-black text-rose-100 flex-1 truncate">☠ جلسة الجذر الذكية — nova-root</span>
              <button
                onClick={() => setPrefs((p) => ({ ...p, chatWide: !p.chatWide }))}
                title={prefs.chatWide ? "ضبط العرض القياسي" : "توسيع الشات"}
                className="hidden lg:inline-flex rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-mono text-cyan-200 hover:bg-cyan-500/20 transition"
              >
                {prefs.chatWide ? "⇄ ضيق" : "⇄ وسّع"}
              </button>
              <button onClick={() => setPrefs((p) => ({ ...p, chatOpen: false }))} title="إخفاء الشات"
                className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-white/50 hover:text-white transition">
                <EyeOff className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <NovaUnifiedChat title="نوفا — مركز التحكم" subtitle="nova-root 24/7" hideRail compact />
            </div>
          </aside>
        )}
        {!prefs.chatOpen && arena !== "chat" && arena !== "cockpit" && (
          <button onClick={() => setPrefs((p) => ({ ...p, chatOpen: true }))}
            className="shrink-0 flex lg:flex-col items-center justify-center gap-2 h-9 lg:h-auto lg:w-10 border-t lg:border-t-0 lg:border-r border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 transition text-rose-200"
            title="إظهار الشات">
            <MessageSquare className="w-4 h-4" />
            <span className="text-[8px] font-black hidden lg:inline" style={{ writingMode: "vertical-rl" }}>الشات</span>
            <span className="text-[10px] font-black lg:hidden">إظهار الشات ☠</span>
          </button>
        )}
      </main>

      {/* ── الفوتر: التيكر الحي ── */}
      <footer className="relative z-10 shrink-0 border-t border-rose-500/15 px-3 py-1 flex items-center gap-3 text-[9px] font-mono text-white/35 overflow-hidden bg-[#07020b]/90">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: vit.ok ? DOT.ok : vit.ok == null ? DOT.wait : DOT.bad }} />
        <span className="shrink-0">{vit.ok === true ? "المنصة واعية" : vit.ok == null ? "يتقاس…" : "السيرفر مش واصل"}</span>
        {ticker.map((ev, i) => (
          <span key={`${ev.ts}-${i}`} className="truncate text-white/45" dir="ltr">
            <span className="text-white/25">{fmtClock(ev.ts)}</span> <span className="text-emerald-300/80">{ev.type}</span>
          </span>
        ))}
        {ticker.length === 0 && <span className="text-white/25">القناة هادية…</span>}
        <span className="mr-auto shrink-0 text-rose-300/60">DAWSHA CYBER-OPS v8</span>
      </footer>
    </div>
  );
}
