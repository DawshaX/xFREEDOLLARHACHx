/**
 * NovaAgentPro v5 — «دولاب دوشة»: الزخرفة السايبرية ترجع، بالتنظيم اللي طلبه.
 *
 * تجميع الملاحظات اللي جت بالسكرين والنص:
 *  · «رجّع الشكل القديم وحط زخارف وألوان ودِلع الدنيا» — النيون راجع:
 *    هيدر متوهّج، بلاط ملوّن، والجمجمة نفسها خلفية حية بتتنفّس (نفس أصول
 *    صفحة الدخول — daw-skull.jpg).
 *  · «مفيش مكان أتكلم فيه» — الشات قلب ثابت يمين بمساحة مريحة (430px)،
 *    بدون شريطه الجانبي المزخرف (hideRail): مساحة الكلام طلقت.
 *  · «البلاط عايز يتفصص لمكانه الصح» — الـ24 سلاح من LiveAgentPanel بقوا
 *    قاذفة منظمة في 4 مجموعات داخل عرض «التحكم السريع» الافتراضي.
 *    السلوك حقيقي 1:1: بلاط النافذة يفتح نافذة الديسكتوب الرسمية، وبلاط
 *    البرومبت يحشي صندوق الشات عبر حدث DOM (جسر nova:qa-prompt في
 *    LiveAgentPanel) — التعبئة فقط، الإرسال بيدك دايمًا (الهدف ناقص).
 *  · «شوف الكرون والمخ» — عرض «الجدولة» يقرأ /api/nova/cron/jobs حي
 *    (6 مهام فعلية على waifly) + Trigger فوري + تشغيل/إطفاء حقيقيين.
 * كل رقم fetch مقاس؛ الفشل يتكتب نص مش يتلبّس قيمة.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity, MonitorSmartphone, ListChecks, Brain, Cpu, Target, Cable, Compass,
  Server, Zap, ZapOff, Clock3, Sparkles, Globe, Skull, ScanLine, Shield,
  Terminal as TerminalIcon, Search, Folder, BookOpen, Network, FlaskConical,
  Crosshair, Swords, FileCode, Wifi, CalendarClock, Play, PowerCircle,
} from "lucide-react";
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";
import { NovaOpsRoom, NovaHuntSurface } from "@/components/desktop/NovaBrainOps";
import { RealTimeSystemMonitor } from "@/components/desktop/RealTimeSystemMonitor";
import { NovaMissions } from "@/components/desktop/NovaMissions";
import { KaliTerminal } from "@/components/desktop/KaliTerminal";
import { AdvancedFileManager } from "@/components/desktop/AdvancedFileManager";
import { TelegramConfigCard } from "@/components/TelegramConfigCard";
import { opsFetch, novaAuthHeaders } from "@/lib/ops-client";
import { useSystem } from "@/context/SystemContext";

/* ─── أنواع ─── */
type ArenaKey = "launch" | "events" | "cron" | "desktop" | "missions" | "brain" | "hardware" | "hunt" | "channels" | "nav";

interface FleetAgentInfo {
  id: string; hostname: string; platform: string; user?: string; cpus?: number; connectedAt?: string;
}
interface CronJob {
  id: string; name: string; cronExpr: string; enabled: boolean;
  runCount: number; errorCount: number; lastRun?: string; nextRun?: string; lastResult?: string;
}

/* ─── قاذفة الأفعال: 24 سلاح × سلوك حقيقي (نفس تعريفات LiveAgentPanel) ─── */
type LaunchAction =
  | { kind: "prompt"; text: string }        // يحشي الشات — الإرسال بيدك
  | { kind: "win"; win: string }            // يفتح نافذة الديسكتوب الرسمية
  | { kind: "arena"; arena: ArenaKey };     // يقفز لعرض داخلي

interface Tile { id: string; label: string; hint: string; icon: typeof Globe; hue: string; action: LaunchAction; }

const LAUNCH_GROUPS: Array<{ group: string; color: string; tiles: Tile[] }> = [
  { group: "⚔ الاستكشاف والهجوم", color: "#fb7185", tiles: [
    { id: "recon",    label: "Recon",       hint: "whois + dns + subdomains + ports", icon: Globe,       hue: "from-cyan-500/25 to-blue-700/10 border-cyan-400/40 text-cyan-300", action: { kind: "prompt", text: "ابدأ recon كامل (whois + dns + subdomains + ports) على الهدف: " } },
    { id: "pentest",  label: "Pentest",     hint: "playbook اختراق كامل",            icon: Skull,       hue: "from-rose-500/25 to-red-700/10 border-rose-400/40 text-rose-300", action: { kind: "prompt", text: "نفّذ playbook pentest على الهدف (افتح scanner + جمع ثغرات NVD/EPSS): " } },
    { id: "nmap",     label: "Nmap سريع",   hint: "منافذ وخدمات",                   icon: Network,     hue: "from-teal-500/25 to-emerald-700/10 border-teal-400/40 text-teal-300", action: { kind: "prompt", text: "افحص الهدف بـ nmap (-sV -sC -T4 --top-ports 1000) وباينلي الخدمات: " } },
    { id: "nikto",    label: "Nikto",       hint: "فحص ثغرات ويب",                  icon: FlaskConical,hue: "from-indigo-500/25 to-blue-800/10 border-indigo-400/40 text-indigo-300", action: { kind: "prompt", text: "شغّل Nikto على URL الهدف وفصّللي الموجود: " } },
    { id: "sqlmap",   label: "SQLMap",      hint: "SQL Injection",                  icon: FileCode,    hue: "from-amber-500/25 to-yellow-700/10 border-amber-400/40 text-amber-300", action: { kind: "prompt", text: "شغّل sqlmap على رابط فيه parameters ووثّق النتيجة: " } },
    { id: "hydra",    label: "Hydra",       hint: "Brute Force مصرّح",              icon: Swords,      hue: "from-red-500/25 to-rose-800/10 border-red-400/40 text-red-300", action: { kind: "prompt", text: "شغّل hydra على خدمة مصرّح بيها — اطلب الهدف والخدمة واليوزرات: " } },
    { id: "gobuster", label: "Gobuster",    hint: "Dir Brute Force",                icon: Folder,      hue: "from-lime-500/25 to-green-800/10 border-lime-400/40 text-lime-300", action: { kind: "prompt", text: "شغّل gobuster dir على الهدف بwordlist حقيقية ولخص المسارات: " } },
    { id: "linpeas",  label: "LinPEAS",     hint: "تصعيد صلاحيات لينكس",            icon: Crosshair,   hue: "from-green-500/25 to-emerald-800/10 border-green-400/40 text-green-300", action: { kind: "prompt", text: "نزّل وشغّل LinPEAS على الجهاز المتصل وطلّعلي خطوط التصعيد بس: " } },
  ] },
  { group: "🕸 أدوات الويب والاستغلال", color: "#22d3ee", tiles: [
    { id: "scan",    label: "Scanner",    hint: "فحص أمني",         icon: ScanLine,    hue: "from-fuchsia-500/25 to-purple-700/10 border-fuchsia-400/40 text-fuchsia-300", action: { kind: "win", win: "scanner" } },
    { id: "zap",     label: "OWASP ZAP",  hint: "Spider + Active",  icon: Wifi,        hue: "from-violet-500/25 to-purple-800/10 border-violet-400/40 text-violet-300", action: { kind: "win", win: "scanner" } },
    { id: "burp",    label: "Burp Suite", hint: "وكيل HTTP",        icon: Search,      hue: "from-orange-500/25 to-amber-800/10 border-orange-400/40 text-orange-300", action: { kind: "prompt", text: "جهز بيئة Burp على الجهاز (java/الأدوات) وقوللي جاهزيتها الحقيقية: " } },
    { id: "exploit", label: "Exploit-DB", hint: "بحث استغلالات",   icon: Shield,      hue: "from-yellow-500/25 to-amber-700/10 border-yellow-400/40 text-yellow-300", action: { kind: "win", win: "exploit-db" } },
    { id: "cve",     label: "CVE بحث",    hint: "ثغرات حية 331K",   icon: Target,      hue: "from-rose-500/25 to-pink-800/10 border-rose-400/40 text-rose-300", action: { kind: "win", win: "cve-live" } },
    { id: "browser", label: "متصفح",      hint: "تصفح داخلي",      icon: Globe,       hue: "from-sky-500/25 to-blue-800/10 border-sky-400/40 text-sky-300", action: { kind: "win", win: "browser" } },
  ] },
  { group: "🖥 النظام ومحطات العمل", color: "#34d399", tiles: [
    { id: "shell",   label: "Terminal",   hint: "نفّذ أمرًا",       icon: TerminalIcon,hue: "from-gray-500/25 to-zinc-700/10 border-gray-400/40 text-gray-300", action: { kind: "win", win: "terminal" } },
    { id: "files",   label: "ملفات",      hint: "مدير الملفات",    icon: Folder,      hue: "from-blue-500/25 to-indigo-800/10 border-blue-400/40 text-blue-300", action: { kind: "win", win: "files" } },
    { id: "monitor", label: "Dashboard",  hint: "مراقبة حية",      icon: Activity,    hue: "from-emerald-500/25 to-teal-700/10 border-emerald-400/40 text-emerald-300", action: { kind: "win", win: "monitor" } },
    { id: "nodes",   label: "Nodes",      hint: "خوادم SSH",       icon: Server,      hue: "from-cyan-500/25 to-sky-800/10 border-cyan-400/40 text-cyan-300", action: { kind: "win", win: "nodes" } },
    { id: "sysmon",  label: "نظام",       hint: "CPU/RAM/Network", icon: Cpu,         hue: "from-teal-500/25 to-cyan-800/10 border-teal-400/40 text-teal-300", action: { kind: "arena", arena: "hardware" } },
    { id: "sysstate",label: "حالة",       hint: "الحالة الكاملة",  icon: Zap,         hue: "from-amber-500/25 to-orange-800/10 border-amber-400/40 text-amber-300", action: { kind: "prompt", text: "استخدم get_system_state وجيبلي الحالة الكاملة للنظام الآن وأهم الملاحظات: " } },
  ] },
  { group: "🧠 الذكاء والإدارة", color: "#a78bfa", tiles: [
    { id: "memory",    label: "ذاكرة",    hint: "ما تعلّمته",     icon: Brain,        hue: "from-violet-500/25 to-purple-700/10 border-violet-400/40 text-violet-300", action: { kind: "prompt", text: "استعرض ذاكرتك وما تعلّمته من الجلسات السابقة — أهم الدروس بس: " } },
    { id: "knowledge", label: "معرفة",    hint: "OWASP/checklists", icon: BookOpen,   hue: "from-pink-500/25 to-fuchsia-800/10 border-pink-400/40 text-pink-300", action: { kind: "win", win: "knowledge" } },
    { id: "playbooks", label: "Playbooks",hint: "وصفات جاهزة",    icon: ListChecks,   hue: "from-indigo-500/25 to-violet-800/10 border-indigo-400/40 text-indigo-300", action: { kind: "win", win: "playbooks" } },
    { id: "cron",      label: "Cron",     hint: "مهام مجدولة",    icon: CalendarClock,hue: "from-emerald-500/25 to-green-800/10 border-emerald-400/40 text-emerald-300", action: { kind: "arena", arena: "cron" } },
  ] },
];

const ARENAS: Array<{ key: ArenaKey; labelAr: string; icon: typeof Brain; color: string }> = [
  { key: "launch",   labelAr: "التحكم السريع", icon: Sparkles,    color: "#fb7185" },
  { key: "cron",     labelAr: "الجدولة",       icon: CalendarClock, color: "#34d399" },
  { key: "events",   labelAr: "نبض الأحداث",   icon: Activity,    color: "#4ade80" },
  { key: "desktop",  labelAr: "سطح المكتب",    icon: MonitorSmartphone, color: "#22d3ee" },
  { key: "missions", labelAr: "المهمات",       icon: ListChecks,  color: "#fbbf24" },
  { key: "brain",    labelAr: "المخ والمجلس",  icon: Brain,       color: "#a78bfa" },
  { key: "hardware", labelAr: "العتاد الحي",   icon: Cpu,         color: "#38bdf8" },
  { key: "hunt",     labelAr: "الصيد",         icon: Target,      color: "#f43f5e" },
  { key: "channels", labelAr: "القنوات",       icon: Cable,       color: "#f59e0b" },
  { key: "nav",      labelAr: "كل الأقسام",    icon: Compass,     color: "#60a5fa" },
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

/* ─── أدوات تنسيق ─── */
const fmtUptime = (s: number | null): string => {
  if (s == null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}ي ${h}س ${m}د` : h > 0 ? `${h}س ${m}د` : `${m}د`;
};
const fmtClock = (ts: string | number): string => {
  try { return new Date(ts).toLocaleTimeString("ar-EG", { hour12: false }); } catch { return "—"; }
};
const fmtDay = (iso?: string): string => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("ar-EG", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
};

function NeonCard({ title, icon: Icon, color, children }: { title: string; icon: typeof Brain; color: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border overflow-hidden"
      style={{ borderColor: color + "30", background: `linear-gradient(160deg, ${color}12, rgba(4,4,10,0.9) 45%)`, boxShadow: `0 0 24px ${color}0d inset` }}>
      <header className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: color + "1f", background: color + "14" }}>
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-[11px] font-black" style={{ color }}>{title}</span>
      </header>
      <div className="p-2.5">{children}</div>
    </section>
  );
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = value == null ? "#64748b" : v > 85 ? "#fb7185" : v > 60 ? "#fbbf24" : "#34d399";
  return (
    <div className="space-y-1" dir="ltr">
      <div className="flex justify-between text-[9px] font-mono text-white/45"><span>{label}</span><span style={{ color }}>{value == null ? "—" : `${v}%`}</span></div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, Math.max(0, v))}%`, background: `linear-gradient(90deg, ${color}88, ${color})`, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

const DOT: Record<string, string> = { ok: "#34d399", bad: "#fb7185", wait: "#64748b" };

export default function NovaAgentPro() {
  const [arena, setArena] = useState<ArenaKey>("launch");
  const [, navigate] = useLocation();
  const sys = useSystem();
  const [vit, setVit] = useState<{ ok: boolean | null; ms: number | null; db: boolean | null; sha: string; up: number | null; tools: number }>({ ok: null, ms: null, db: null, sha: "", up: null, tools: 0 });
  const [agents, setAgents] = useState<FleetAgentInfo[]>([]);
  const [agentsErr, setAgentsErr] = useState<string | null>(null);
  const [brain, setBrain] = useState<{ providers: number; tools: number; council: number } | null>(null);
  const [hw, setHw] = useState<{ cpu: number | null; mem: number | null; cores: number | null }>({ cpu: null, mem: null, cores: null });
  const [vault, setVault] = useState<number | null>(null);
  const [corpus, setCorpus] = useState<{ total: number | null; kev: number | null }>({ total: null, kev: null });
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronErr, setCronErr] = useState<string | null>(null);
  const [cronBusy, setCronBusy] = useState<string | null>(null);
  const mounted = useRef(Date.now());

  const refreshCron = useCallback(async () => {
    const r = await opsFetch<{ jobs?: CronJob[] }>("/nova/cron/jobs");
    if (r.ok && r.data?.jobs) { setCronJobs(r.data.jobs); setCronErr(null); }
    else setCronErr(r.denial || r.error || "تعذّر الجلب");
  }, []);

  const cronTrigger = useCallback(async (id: string) => {
    setCronBusy(id + "▶");
    try { await fetch(`/api/nova/cron/jobs/${encodeURIComponent(id)}/trigger`, { method: "POST", headers: novaAuthHeaders({}) }); } catch { /* الفشل يبان في runCount */ }
    await refreshCron(); setCronBusy(null);
  }, [refreshCron]);

  const cronToggle = useCallback(async (id: string, enabled: boolean) => {
    setCronBusy(id + (enabled ? "⏻" : "⏼"));
    try {
      await fetch(`/api/nova/cron/jobs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ enabled: !enabled }),
      });
    } catch { /* يبان في الحالة */ }
    await refreshCron(); setCronBusy(null);
  }, [refreshCron]);

  const launch = useCallback((a: LaunchAction) => {
    if (a.kind === "win") navigate(`/desktop?open=${encodeURIComponent(a.win)}`);
    else if (a.kind === "arena") setArena(a.arena);
    else window.dispatchEvent(new CustomEvent("nova:qa-prompt", { detail: { text: a.text } }));
  }, [navigate]);

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
      const r = await fetch("/api/local-agent/connect-info");
      const j = (await r.json().catch(() => null)) as { agents?: FleetAgentInfo[] } | null;
      if (r.ok && Array.isArray(j?.agents)) { setAgents(j.agents); setAgentsErr(null); }
      else setAgentsErr(`connect-info ${r.status}`);
    } catch { setAgentsErr("connect-info مش راد"); }

    const br = await opsFetch<{ providers?: unknown[]; tools?: number | unknown[]; council?: { members?: unknown[] } }>("/nova-core/status");
    if (br.ok && br.data) setBrain({
      providers: Array.isArray(br.data.providers) ? br.data.providers.length : 0,
      tools: Array.isArray(br.data.tools) ? br.data.tools.length : typeof br.data.tools === "number" ? br.data.tools : 0,
      council: Array.isArray(br.data.council?.members) ? br.data.council.members.length : 0,
    });
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
    void refreshCron();
  }, [refreshCron]);
  useEffect(() => { void refresh(); const iv = setInterval(refresh, 12_000); return () => clearInterval(iv); }, [refresh]);

  const lastEvents = sys.systemEvents.slice(0, 36);
  const ticker = sys.systemEvents.slice(0, 2);
  const a0 = agents.find((a) => a.id === "self-node") ?? agents[0];
  const sessionS = Math.round((Date.now() - mounted.current) / 1000);
  const dayName = new Intl.DateTimeFormat("ar-EG", { weekday: "long" }).format(new Date());

  const pill = (ok: boolean | null | undefined, label: string, extra = "") => {
    const color = ok == null ? "#64748b" : ok ? "#34d399" : "#fb7185";
    return (
      <span key={label} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold"
        style={{ borderColor: color + "50", color, background: color + "12", boxShadow: ok ? `0 0 10px ${color}30` : "none" }}>
        <span className={"w-1.5 h-1.5 rounded-full" + (ok ? " animate-pulse" : "")} style={{ background: color }} />
        {ok == null ? `${label}: …` : ok ? `${label}${extra}` : `${label}: ✗`}
      </span>
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#050208] text-white" dir="rtl">
      {/* ── خلفية الجمجمة الحية — بتتنفّس + سكان لاينز ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-[-5%] bg-center bg-cover opacity-[0.16]"
          style={{ backgroundImage: "url(\"data/daw-skull.jpg\")", animation: "agentProBreathe 11s ease-in-out infinite" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 30%, transparent 0%, rgba(5,2,8,.72) 55%, rgba(5,2,8,.96) 100%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ background: "repeating-linear-gradient(0deg, transparent 0 2px, #000 2px 4px)" }} />
      </div>
      <style>{`@keyframes agentProBreathe{0%,100%{transform:scale(1.02);opacity:.14}50%{transform:scale(1.06);opacity:.19}}`}</style>

      {/* ── الهيدر النيوني ── */}
      <header className="relative z-10 shrink-0 border-b border-rose-500/15 bg-gradient-to-l from-rose-950/25 via-[#070309] to-violet-950/25 px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full border-2 border-rose-500/70 bg-cover bg-center shrink-0"
            style={{ backgroundImage: "url(\"data/daw-skull.jpg\")", boxShadow: "0 0 18px rgba(239,68,68,.5)" }} />
          <div>
            <h1 className="text-sm font-black leading-4 text-rose-100">دولاب دوشة — مركز التحكم الكلي</h1>
            <div className="text-[8px] font-mono text-white/35">{dayName} · الجلسة {fmtUptime(sessionS)} · sha {vit.sha || "…"}</div>
          </div>
          <div className="mr-auto flex items-center gap-1.5 flex-wrap">
            {pill(vit.ok, "السيرفر", vit.ok && vit.ms != null ? ` ${vit.ms}ms` : "")}
            {pill(vit.db, "DB")}
            {pill(agents.length > 0 ? true : agentsErr == null ? null : false, `عُقد ×${agents.length}`)}
            {pill(vit.tools > 0 ? true : null, `أدوات ×${vit.tools}`)}
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-mono font-bold text-cyan-300">
              <Clock3 className="w-3 h-3" /> {fmtUptime(vit.up)}
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {/* ── عمود القيادة (شمال) ── */}
        <aside className="hidden xl:flex w-[252px] shrink-0 flex-col gap-2.5 border-l border-white/5 p-2.5 overflow-y-auto">
          <NeonCard title={`الأسطول — ${agents.length} عقدة`} icon={Server} color="#22d3ee">
            <div className="space-y-1.5">
              {agents.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-cyan-400/10 bg-cyan-400/[0.04] px-2 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" style={{ boxShadow: "0 0 8px #34d399" }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] font-bold text-cyan-200 truncate" dir="ltr">{a.id}</div>
                    <div className="text-[8px] font-mono text-white/35 truncate">{a.hostname} · {a.platform}{a.cpus ? ` · ${a.cpus}C` : ""}</div>
                  </div>
                </div>
              ))}
              {agents.length === 0 && <div className="text-[9px] font-mono text-white/35">{agentsErr ?? "مفيش عقد — سطر الانضمام في /live-agent"}</div>}
            </div>
          </NeonCard>

          <NeonCard title={`العتاد${hw.cores ? ` — ${hw.cores}C` : ""}`} icon={Cpu} color="#38bdf8">
            <div className="space-y-2"><Meter label="CPU" value={hw.cpu} /><Meter label="RAM" value={hw.mem} /></div>
          </NeonCard>

          <NeonCard title="الخزنة + الكوربوس" icon={Target} color="#fb7185">
            <div className="grid grid-cols-3 gap-1 text-center font-mono">
              <div><div className="text-sm font-black text-rose-300">{vault ?? "—"}</div><div className="text-[7px] text-white/35">نتيجة مؤكدة</div></div>
              <div><div className="text-sm font-black text-rose-300">{corpus.total != null ? corpus.total.toLocaleString("en") : "—"}</div><div className="text-[7px] text-white/35">CVE مقاسة</div></div>
              <div><div className="text-sm font-black text-rose-300">{corpus.kev != null ? corpus.kev.toLocaleString("en") : "—"}</div><div className="text-[7px] text-white/35">KEV</div></div>
            </div>
            {vault === 0 && <div className="mt-1.5 text-[8px] font-mono text-rose-200/55 border-t border-white/5 pt-1.5">الخزنة بتملى من نتيجة مؤكدة مش رقم معروض — شوف عرض «الصيد».</div>}
          </NeonCard>

          <NeonCard title="المخ والمجلس" icon={Brain} color="#a78bfa">
            {brain ? (
              <div className="grid grid-cols-3 gap-1 text-center font-mono">
                <div><div className="text-sm font-black text-violet-300">{brain.providers}</div><div className="text-[7px] text-white/35">مزود</div></div>
                <div><div className="text-sm font-black text-violet-300">{brain.tools}</div><div className="text-[7px] text-white/35">أداة</div></div>
                <div><div className="text-sm font-black text-violet-300">{brain.council}</div><div className="text-[7px] text-white/35">عضو مجلس</div></div>
              </div>
            ) : <div className="text-[9px] font-mono text-white/35">يتقاس…</div>}
          </NeonCard>

          <NeonCard title="الاستقلالية" icon={sys.autonomousStatus.enabled ? Zap : ZapOff} color={sys.autonomousStatus.enabled ? "#fbbf24" : "#64748b"}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold" style={{ color: sys.autonomousStatus.enabled ? "#fbbf24" : "#94a3b8" }}>
                {sys.autonomousStatus.enabled ? (sys.autonomousStatus.isRunning ? "شغّالة الآن ⚡" : "مفعّلة") : "مطفية"}
              </span>
              <span className="text-[9px] font-mono text-white/35">✔{sys.autonomousStatus.tasksCompleted} · ✗{sys.autonomousStatus.tasksErrored}</span>
            </div>
            <button onClick={() => { sys.autonomousStatus.enabled ? sys.disableAutonomous() : sys.enableAutonomous(); }}
              className="mt-1.5 w-full rounded-lg border px-2 py-1.5 text-[10px] font-black transition-all"
              style={sys.autonomousStatus.enabled
                ? { borderColor: "#fbbf2450", background: "#fbbf2414", color: "#fbbf24" }
                : { borderColor: "#34d39950", background: "#34d39914", color: "#34d399" }}>
              {sys.autonomousStatus.enabled ? "إطفاء الوضع المستقل" : "تشغيل الوضع المستقل"}
            </button>
          </NeonCard>

          <NeonCard title={`الجدولة السريعة — ${cronJobs.filter(j => j.enabled).length}/${cronJobs.length} شغال`} icon={CalendarClock} color="#34d399">
            <div className="space-y-1">
              {cronJobs.slice(0, 4).map((j) => (
                <div key={j.id} className="flex items-center gap-1.5 text-[9px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: j.enabled ? DOT.ok : "#475569", boxShadow: j.enabled ? "0 0 6px #34d399" : "none" }} />
                  <span className="text-white/60 truncate flex-1">{j.name}</span>
                  <span className="text-white/30" dir="ltr">{j.cronExpr}</span>
                </div>
              ))}
              {cronErr && <div className="text-[8px] font-mono text-rose-300/70">{cronErr}</div>}
            </div>
          </NeonCard>
        </aside>

        {/* ── منضدة العمل ── */}
        <section className="flex min-w-0 flex-1 flex-col min-h-0">
          <nav className="shrink-0 flex items-center gap-1 px-2.5 py-2 border-b border-white/5 overflow-x-auto bg-[#070309]/60">
            {ARENAS.map(({ key, labelAr, icon: Icon, color }) => {
              const active = arena === key;
              return (
                <button key={key} onClick={() => setArena(key)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black transition-all"
                  style={active
                    ? { borderColor: color + "70", background: `${color}1c`, color, boxShadow: `0 0 14px ${color}30 inset, 0 0 8px ${color}20` }
                    : { borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.45)" }}>
                  <Icon className="w-3.5 h-3.5" />
                  {labelAr}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {arena === "launch" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.04] px-3.5 py-2 text-[10px] font-mono text-rose-200/70">
                  بلاط النافذة يفتح نافذة الديسكتوب الرسمية · بلاط الأمر يحشي الشات يمين وإنت تكمل الهدف وتبعت — مفيش حاجة بتتنفذ من وراك.
                </div>
                {LAUNCH_GROUPS.map(({ group, color, tiles }) => (
                  <section key={group}>
                    <h2 className="text-[12px] font-black mb-2 flex items-center gap-2" style={{ color }}>
                      <span className="w-1 h-3.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                      {group}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {tiles.map(({ id, label, hint, icon: Icon, hue, action }) => (
                        <button key={id} onClick={() => launch(action)}
                          className={`group rounded-xl border bg-gradient-to-br px-3 py-3 text-right transition-all hover:-translate-y-0.5 hover:shadow-lg ${hue}`}
                          style={{ boxShadow: "0 4px 18px rgba(0,0,0,.4)" }}>
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="text-[11px] font-black font-mono" dir="ltr">{label}</span>
                          </div>
                          <div className="mt-1 text-[8px] font-mono opacity-60">{hint}</div>
                          <div className="mt-1 text-[7px] font-mono opacity-40">
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
                <div className="text-[10px] font-mono text-white/40 mb-1">
                  {cronJobs.length} مهمة من /api/nova/cron/jobs — Trigger فوري وتشغيل/إطفاء حقيقيان{vit.ok === false ? " · السيرفر مش واصل" : ""}.
                </div>
                {cronErr && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-mono text-rose-200">{cronErr}</div>}
                {cronJobs.map((j) => (
                  <div key={j.id} className="rounded-xl border px-3 py-2.5 flex items-center gap-3 flex-wrap"
                    style={{ borderColor: j.enabled ? "#34d39930" : "#ffffff12", background: j.enabled ? "#34d39908" : "rgba(255,255,255,0.015)" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: j.enabled ? DOT.ok : "#475569", boxShadow: j.enabled ? "0 0 10px #34d399" : "none" }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-black text-white/85">{j.name}</span>
                        <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] font-mono text-white/50" dir="ltr">{j.cronExpr}</span>
                        <span className="rounded border px-1.5 py-0.5 text-[8px] font-mono" style={{ borderColor: j.enabled ? "#34d39940" : "#64748b40", color: j.enabled ? "#34d399" : "#94a3b8" }}>{j.enabled ? "شغّالة" : "مطفية"}</span>
                        {j.errorCount > 0 && <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[8px] font-mono text-rose-300">أخطاء ×{j.errorCount}</span>}
                      </div>
                      <div className="mt-1 text-[9px] font-mono text-white/35">
                        تشغيلات ×{j.runCount}{j.lastRun ? ` · آخر ${fmtDay(j.lastRun)}` : ""}{j.nextRun ? ` · تالي ${fmtDay(j.nextRun)}` : ""}
                      </div>
                      {j.lastResult && <div className="mt-0.5 text-[9px] font-mono text-white/45 truncate" dir="rtl">↳ {j.lastResult}</div>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => void cronTrigger(j.id)} disabled={cronBusy !== null}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[9px] font-black text-emerald-300 hover:bg-emerald-500/20 transition disabled:opacity-40">
                        <Play className="w-3 h-3" /> فوري
                      </button>
                      <button onClick={() => void cronToggle(j.id, j.enabled)} disabled={cronBusy !== null}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[9px] font-black transition disabled:opacity-40 ${j.enabled ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}>
                        <PowerCircle className="w-3 h-3" /> {j.enabled ? "إطفاء" : "تشغيل"}
                      </button>
                    </div>
                  </div>
                ))}
                {cronJobs.length === 0 && !cronErr && <div className="text-center text-[11px] font-mono text-white/35 py-6">يتقاس…</div>}
              </div>
            )}

            {arena === "events" && (
              <div className="space-y-1" dir="ltr">
                {lastEvents.length === 0 && (
                  <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center text-[11px] font-mono text-white/35" dir="rtl">
                    قناة الأحداث مفتوحة (SSE) — أول حدث هيظهر هنا لحظيًا: مهمة بتبدأ، ذكرى بتتخزن، عقدة بتدخل.
                  </div>
                )}
                {lastEvents.map((ev, i) => (
                  <div key={`${ev.ts}-${i}`} className="flex items-baseline gap-3 rounded-lg border border-emerald-400/10 bg-black/40 px-2.5 py-1.5">
                    <span className="shrink-0 font-mono text-[9px] text-white/30">{fmtClock(ev.ts)}</span>
                    <span className="shrink-0 font-mono text-[10px] font-bold text-emerald-300">{ev.type}</span>
                    {ev.data && <span className="truncate font-mono text-[9px] text-white/40">{JSON.stringify(ev.data).slice(0, 140)}</span>}
                  </div>
                ))}
              </div>
            )}

            {arena === "desktop" && (
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                <div className="flex min-h-[430px] flex-col overflow-hidden rounded-xl border border-emerald-400/15 bg-black/50" style={{ boxShadow: "0 0 24px rgba(52,211,153,.06) inset" }}>
                  <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/5 px-3 bg-emerald-500/5">
                    <span className="text-[10px] font-black text-emerald-300">تيرمنال كالي الحي</span>
                    <span className="font-mono text-[9px] text-white/35" dir="ltr">{a0 ? `${a0.hostname} · ${a0.user ?? "—"}` : "ينتظر عقدة…"}</span>
                  </div>
                  <div className="min-h-[380px] flex-1" dir="ltr">
                    <KaliTerminal agentConnected={agents.length > 0} agentHostname={a0?.hostname ?? ""} agentUser={a0?.user ?? ""} />
                  </div>
                </div>
                <div className="flex min-h-[430px] flex-col overflow-hidden rounded-xl border border-cyan-400/15 bg-black/50" style={{ boxShadow: "0 0 24px rgba(34,211,238,.06) inset" }}>
                  <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/5 px-3 bg-cyan-500/5">
                    <span className="text-[10px] font-black text-cyan-300">مدير ملفات العقدة</span>
                    <span className="font-mono text-[9px] text-white/35" dir="ltr">/api/files · عمليات حقيقية</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <AdvancedFileManager />
                  </div>
                </div>
              </div>
            )}

            {arena === "missions" && <NovaMissions />}
            {arena === "brain" && <NovaOpsRoom />}
            {arena === "hardware" && <RealTimeSystemMonitor />}
            {arena === "hunt" && <NovaHuntSurface />}
            {arena === "channels" && (
              <div className="max-w-3xl space-y-3">
                <TelegramConfigCard />
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] font-mono text-amber-200/80 space-y-1.5">
                  <div className="font-bold">قنوات من نفس المحور:</div>
                  <div>· تنبيهات الزيارات مربوطة بنفس القناة فور التوكن.</div>
                  <div>· GitHub: الحزمة بتتبنى بتوقيع من CI، والـwatchdog بيفعّل صيانة الأدوات تلقائيًا.</div>
                  <div>· مهمة «tg_pulse» المطفية بقبضة الجدولة فوق — شغّلها لو عايز نبضة تليجرام كل ساعة.</div>
                </div>
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
                        <a key={it.path} href={it.path}
                          className="rounded-xl border px-3 py-3 text-center text-[11px] font-bold transition-all hover:-translate-y-0.5"
                          style={{ borderColor: color + "30", background: color + "0a", color: color + "dd", boxShadow: `0 0 12px ${color}08 inset` }}>
                          {it.label}
                        </a>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── الشات — القلب، مساحة مريحة ── */}
        <aside className="w-full lg:w-[430px] shrink-0 border-r border-rose-500/20 lg:border-r lg:border-l-0 flex flex-col min-h-0 bg-[#060309]">
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-rose-500/15 bg-gradient-to-l from-rose-600/15 to-violet-600/10">
            <Sparkles className="w-3.5 h-3.5 text-rose-300" />
            <span className="text-[10px] font-black text-rose-200">الجلسة الذكية — اكتب براحتك، المكان دايمًا محجوز</span>
          </div>
          <div className="flex-1 min-h-0">
            <NovaUnifiedChat
              title="نوفا — مركز التحكم"
              subtitle="عقل واحد · أدوات حقيقية · أدلة SHA-256"
              hideRail
            />
          </div>
        </aside>
      </main>

      {/* ── الفوتر: التيكر الحي ── */}
      <footer className="relative z-10 shrink-0 border-t border-white/5 px-3 py-1.5 flex items-center gap-3 text-[9px] font-mono text-white/30 overflow-hidden bg-[#070309]/80">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: vit.ok ? DOT.ok : vit.ok == null ? DOT.wait : DOT.bad }} />
        <span className="shrink-0">{vit.ok === true ? "المنصة واعية" : vit.ok == null ? "يتقاس…" : "السيرفر مش واصل"}</span>
        {ticker.map((ev, i) => (
          <span key={`${ev.ts}-${i}`} className="truncate text-white/40" dir="ltr">
            <span className="text-white/25">{fmtClock(ev.ts)}</span> <span className="text-emerald-300/80">{ev.type}</span>
          </span>
        ))}
        {ticker.length === 0 && <span className="text-white/20">القناة هادية…</span>}
        <span className="mr-auto shrink-0 text-rose-300/50">DAWSHA DECK v5</span>
      </footer>
    </div>
  );
}
