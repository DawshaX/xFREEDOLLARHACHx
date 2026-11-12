/**
 * NovaAgentPro v6 — «دولاب دوشة»: تحكم كامل بإيد المالك.
 *
 * المطالب (ردود المالك حرفيًا):
 *  · «كل حاجة عايزة تظبيط» — تنسيق أعمق: تبويبات مثبتة، منطقة عمل تتمدد
 *    لما تقفل الشات، روس زمنية حية.
 *  · «أنا ليا التحكم أظهر أو لا» — كل بطاقة في عمود القيادة والشات نفسه
 *    وشريط القسم بزر إخفاء/إظهار حقيقي محفوظ في localStorage.
 *  · «تبويبات والتحكم في كل شيء» — لوحة أوامر Ctrl+K: الأقسام + الـ24
 *    سلاح + مهام الكرون (تشغيل فوري) + الصفحات الحية — كلها من مكان واحد.
 *  · «اتصال أكتر» — نتايج الكرون تتقرأ آدمي (آخر نتيجة + من كام دقيقة +
 *    زر يوصلك لصفحة النتايج)، البطاقات الإحصائية قابلة للضغط وتوصلك،
 *    الإطار حي (نبض SSE + زمن نسبي بيتحدث لوحده).
 * الجمجمة خلفية حية متنفّسة (هوية DAWSHA) — أصل مضمّن base64 ما ينزلش
 * من الباندل أبدًا (درس v5.1).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity, MonitorSmartphone, ListChecks, Brain, Cpu, Target, Cable, Compass,
  Server, Zap, ZapOff, Clock3, Sparkles, Globe, ScanLine, Shield,
  Terminal as TerminalIcon, Search, Folder, BookOpen, Network, FlaskConical,
  Crosshair, Swords, FileCode, Wifi, CalendarClock, Play, PowerCircle,
  Command, Eye, EyeOff, MessageSquare, Skull, ArrowLeft, RotateCcw,
} from "lucide-react";
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";
import { NovaOpsRoom, NovaHuntSurface } from "@/components/desktop/NovaBrainOps";
import { RealTimeSystemMonitor } from "@/components/desktop/RealTimeSystemMonitor";
import { NovaMissions } from "@/components/desktop/NovaMissions";
import { KaliTerminal } from "@/components/desktop/KaliTerminal";
import { AdvancedFileManager } from "@/components/desktop/AdvancedFileManager";
import { TelegramConfigCard } from "@/components/TelegramConfigCard";
import { opsFetch, novaAuthHeaders } from "@/lib/ops-client";
import { DAW_SKULL } from "@/lib/skull";
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

/* ─── قاذفة الأفعال: 24 سلاح × سلوك حقيقي ─── */
type LaunchAction =
  | { kind: "prompt"; text: string }
  | { kind: "win"; win: string }
  | { kind: "arena"; arena: ArenaKey };

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

/* لينكات متحقق منها ضد App.tsx — كلها صفحات حقيقية (لا placeholders) */
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

/* كل مهمة كرون موصولة بساحة نتايجها — زر «النتايج» حقيقي */
const CRON_LINKS: Record<string, { path: string; label: string }> = {
  cve_hunt:       { path: "/cve-live", label: "لوحة CVE" },
  mem_consolidate:{ path: "/memory", label: "الذاكرة" },
  self_heal:      { path: "/status", label: "حالة النظام" },
  sys_watchdog:   { path: "/monitor", label: "المراقبة" },
  tg_pulse:       { path: "/webhooks", label: "القنوات" },
  nova_learn:     { path: "/nova-memory", label: "تعلم نوفا" },
};

/* ─── بطاقات القيادة القابلة للإخفاء (تحكم المالك الكامل) ─── */
type RailId = "fleet" | "hw" | "vault" | "brain" | "autonomy" | "cronmini";
const RAIL_DEFS: Array<{ id: RailId; title: string }> = [
  { id: "fleet",    title: "الأسطول" },
  { id: "hw",       title: "العتاد" },
  { id: "vault",    title: "الخزنة + الكوربوس" },
  { id: "brain",    title: "المخ والمجلس" },
  { id: "autonomy", title: "الاستقلالية" },
  { id: "cronmini", title: "الجدولة السريعة" },
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
/* زمن نسبي عربي: «من 3د» / «بعد 25د» */
const ago = (iso: string | undefined, now: number): string => {
  if (!iso) return "—";
  const t = Date.parse(iso); if (Number.isNaN(t)) return "—";
  const diffMin = Math.round((t - now) / 60000);
  const a = Math.abs(diffMin);
  const words = a < 1 ? "لحظات" : a < 60 ? `${a}د` : a < 1440 ? `${Math.floor(a / 60)}س ${a % 60}د` : `${Math.floor(a / 1440)}ي`;
  return diffMin >= 0 ? `بعد ${words}` : `من ${words}`;
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

/* تفضيلات المالك — محفوظة محليًا */
const LS_KEY = "daw.agentPro.v6";
interface Prefs { hiddenRails: RailId[]; chatOpen: boolean; }
const loadPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const j = JSON.parse(raw) as Partial<Prefs>; return { hiddenRails: Array.isArray(j.hiddenRails) ? j.hiddenRails as RailId[] : [], chatOpen: j.chatOpen !== false }; }
  } catch { /* تفضيلات أول مرة */ }
  return { hiddenRails: [], chatOpen: true };
};

export default function NovaAgentPro() {
  const [arena, setArena] = useState<ArenaKey>("launch");
  const [, navigate] = useLocation();
  const sys = useSystem();
  const [vit, setVit] = useState<{ ok: boolean | null; ms: number | null; db: boolean | null; sha: string; up: number | null; tools: number }>({ ok: null, ms: null, db: null, sha: "", up: null, tools: 0 });
  const [agents, setAgents] = useState<FleetAgentInfo[]>([]);
  const [agentsErr, setAgentsErr] = useState<string | null>(null);
  const [brain, setBrain] = useState<{ providers: number; tools: number; council: number; cloud: number } | null>(null);
  const [hw, setHw] = useState<{ cpu: number | null; mem: number | null; cores: number | null }>({ cpu: null, mem: null, cores: null });
  const [vault, setVault] = useState<number | null>(null);
  const [corpus, setCorpus] = useState<{ total: number | null; kev: number | null }>({ total: null, kev: null });
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronErr, setCronErr] = useState<string | null>(null);
  const [cronBusy, setCronBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === "undefined" ? { hiddenRails: [], chatOpen: true } : loadPrefs()));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palQuery, setPalQuery] = useState("");
  const [palIdx, setPalIdx] = useState(0);
  const palInputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(Date.now());

  /* زمن حي: الأزمنة النسبية بتتحدث كل 20 ثانية */
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(iv); }, []);
  /* حفظ التفضيلات */
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* تخزين ممتلئ — مش مانع */ } }, [prefs]);

  const flashSay = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? null : f)), 6000);
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
      if (r.ok && j?.ok !== false) flashSay(`⚡ اتشغّلت فوري — النتيجة هتظهر في السجل خلال لحظات`);
      else flashSay(`⚠ السيرفر ردّ ${r.status} — شوف السجل`);
    } catch { flashSay("⚠ الطلب مات في الطريق"); }
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

  const launch = useCallback((a: LaunchAction) => {
    if (a.kind === "win") navigate(`/desktop?open=${encodeURIComponent(a.win)}`);
    else if (a.kind === "arena") setArena(a.arena);
    else {
      if (!prefs.chatOpen) setPrefs((p) => ({ ...p, chatOpen: true }));
      window.dispatchEvent(new CustomEvent("nova:qa-prompt", { detail: { text: a.text } }));
    }
  }, [navigate, prefs.chatOpen]);

  /* ── لوحة الأوامر: كل حاجة من مكان واحد ── */
  interface PalCmd { id: string; label: string; sub: string; color: string; run: () => void; }
  const allCmds = useMemo<PalCmd[]>(() => {
    const cmds: PalCmd[] = [];
    for (const a of ARENAS) cmds.push({ id: "arena:" + a.key, label: "قسم — " + a.labelAr, sub: "اقفز لساحة العرض", color: a.color, run: () => setArena(a.key) });
    for (const g of LAUNCH_GROUPS) for (const t of g.tiles) cmds.push({ id: "tile:" + t.id, label: t.label, sub: `${g.group} · ${t.hint}`, color: g.color, run: () => launch(t.action) });
    for (const j of cronJobs) cmds.push({ id: "cron:" + j.id, label: "⚡ شغّل فوري: " + j.name, sub: `cron ${j.cronExpr} · تشغيلات ×${j.runCount}`, color: "#34d399", run: () => void cronTrigger(j.id) });
    for (const g of NAV_GROUPS) for (const it of g.items) cmds.push({ id: "nav:" + it.path, label: it.label, sub: g.group + " · " + it.path, color: g.color, run: () => navigate(it.path) });
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const r = await fetch("/api/local-agent/connect-info");
      const j = (await r.json().catch(() => null)) as { agents?: FleetAgentInfo[] } | null;
      if (r.ok && Array.isArray(j?.agents)) { setAgents(j.agents); setAgentsErr(null); }
      else setAgentsErr(`connect-info ${r.status}`);
    } catch { setAgentsErr("connect-info مش راد"); }

    const br = await opsFetch<{ providers?: unknown[]; tools?: number | unknown[]; council?: { members?: unknown[] }; cloudProviders?: unknown[] }>("/nova-core/status");
    if (br.ok && br.data) setBrain({
      providers: Array.isArray(br.data.providers) ? br.data.providers.length : 0,
      tools: Array.isArray(br.data.tools) ? br.data.tools.length : typeof br.data.tools === "number" ? br.data.tools : 0,
      council: Array.isArray(br.data.council?.members) ? br.data.council.members.length : 0,
      cloud: Array.isArray(br.data.cloudProviders) ? br.data.cloudProviders.length : 0,
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
  const shownRails = RAIL_DEFS.filter((r) => !prefs.hiddenRails.includes(r.id));
  const cronOn = cronJobs.filter((j) => j.enabled).length;

  const toggleRail = (id: RailId) => setPrefs((p) => ({
    ...p,
    hiddenRails: p.hiddenRails.includes(id) ? p.hiddenRails.filter((x) => x !== id) : [...p.hiddenRails, id],
  }));

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
      {/* ── خلفية الجمجمة الحية ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-[-5%] bg-center bg-cover opacity-[0.16]"
          style={{ backgroundImage: `url("${DAW_SKULL}")`, animation: "agentProBreathe 11s ease-in-out infinite" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 30%, transparent 0%, rgba(5,2,8,.72) 55%, rgba(5,2,8,.96) 100%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ background: "repeating-linear-gradient(0deg, transparent 0 2px, #000 2px 4px)" }} />
      </div>
      <style>{`@keyframes agentProBreathe{0%,100%{transform:scale(1.02);opacity:.14}50%{transform:scale(1.06);opacity:.19}}`}</style>

      {/* ── لوحة الأوامر Ctrl+K ── */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[12vh]" onClick={() => setPaletteOpen(false)}>
          <div className="w-[min(640px,92vw)] rounded-2xl border border-rose-500/30 bg-[#0a0510] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 0 60px rgba(244,63,94,.25)" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
              <Command className="w-4 h-4 text-rose-300" />
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
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-right transition ${i === palIdx ? "bg-white/10" : "hover:bg-white/5"}`}>
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

      {/* ── الهيدر ── */}
      <header className="relative z-10 shrink-0 border-b border-rose-500/15 bg-gradient-to-l from-rose-950/25 via-[#070309] to-violet-950/25 px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full border-2 border-rose-500/70 bg-cover bg-center shrink-0"
            style={{ backgroundImage: `url("${DAW_SKULL}")`, boxShadow: "0 0 18px rgba(239,68,68,.5)" }} />
          <div>
            <h1 className="text-sm font-black leading-4 text-rose-100">دولاب دوشة — مركز التحكم الكلي</h1>
            <div className="text-[8px] font-mono text-white/35">{dayName} · الجلسة {fmtUptime(sessionS)} · sha {vit.sha || "…"}</div>
          </div>
          <div className="mr-auto flex items-center gap-1.5 flex-wrap">
            {pill(vit.ok, "السيرفر", vit.ok && vit.ms != null ? ` ${vit.ms}ms` : "")}
            {pill(vit.db, "DB")}
            {pill(agents.length > 0 ? true : agentsErr == null ? null : false, `عُقد ×${agents.length}`)}
            {pill(vit.tools > 0 ? true : null, `أدوات ×${vit.tools}`)}
            {pill(cronOn > 0 ? true : null, `كرون ${cronOn}/${cronJobs.length}`)}
            <button onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-200 hover:bg-rose-500/20 transition">
              <Command className="w-3 h-3" /> Ctrl+K
            </button>
            <button onClick={() => setPrefs((p) => ({ ...p, chatOpen: !p.chatOpen }))}
              title={prefs.chatOpen ? "إخفاء الشات" : "إظهار الشات"}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-black transition ${prefs.chatOpen ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/15 bg-white/5 text-white/50"}`}>
              {prefs.chatOpen ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} <MessageSquare className="w-3 h-3" />
            </button>
          </div>
        </div>
        {flash && <div className="mt-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-mono text-emerald-200 animate-pulse">{flash}</div>}
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {/* ── عمود القيادة — كل بطاقة بتحكم إظهار/إخفاء ── */}
        <aside className="hidden xl:flex w-[252px] shrink-0 flex-col gap-2.5 border-l border-white/5 p-2.5 overflow-y-auto">
          <div className="space-y-2.5">
            {!prefs.hiddenRails.includes("fleet") && (
              <NeonCard title={`الأسطول — ${agents.length} عقدة`} icon={Server} color="#22d3ee">
                <div className="space-y-1.5">
                  {agents.slice(0, 6).map((a) => (
                    <button key={a.id} onClick={() => navigate("/desktop?open=nodes")}
                      className="w-full flex items-center gap-2 rounded-lg border border-cyan-400/10 bg-cyan-400/[0.04] px-2 py-1.5 hover:bg-cyan-400/10 transition text-right">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" style={{ boxShadow: "0 0 8px #34d399" }} />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[10px] font-bold text-cyan-200 truncate" dir="ltr">{a.id}</div>
                        <div className="text-[8px] font-mono text-white/35 truncate">{a.hostname} · {a.platform}{a.cpus ? ` · ${a.cpus}C` : ""}</div>
                      </div>
                      <ArrowLeft className="w-3 h-3 text-white/20 shrink-0" />
                    </button>
                  ))}
                  {agents.length === 0 && <div className="text-[9px] font-mono text-white/35">{agentsErr ?? "مفيش عقد — سطر الانضمام في /live-agent"}</div>}
                </div>
              </NeonCard>
            )}

            {!prefs.hiddenRails.includes("hw") && (
              <NeonCard title={`العتاد${hw.cores ? ` — ${hw.cores}C` : ""}`} icon={Cpu} color="#38bdf8">
                <div className="space-y-2"><Meter label="CPU" value={hw.cpu} /><Meter label="RAM" value={hw.mem} /></div>
              </NeonCard>
            )}

            {!prefs.hiddenRails.includes("vault") && (
              <NeonCard title="الخزنة + الكوربوس" icon={Target} color="#fb7185">
                <button onClick={() => navigate("/cve-live")} className="w-full grid grid-cols-3 gap-1 text-center font-mono hover:bg-white/[0.03] rounded-lg py-1 transition">
                  <div><div className="text-sm font-black text-rose-300">{vault ?? "—"}</div><div className="text-[7px] text-white/35">نتيجة مؤكدة</div></div>
                  <div><div className="text-sm font-black text-rose-300">{corpus.total != null ? corpus.total.toLocaleString("en") : "—"}</div><div className="text-[7px] text-white/35">CVE مقاسة</div></div>
                  <div><div className="text-sm font-black text-rose-300">{corpus.kev != null ? corpus.kev.toLocaleString("en") : "—"}</div><div className="text-[7px] text-white/35">KEV</div></div>
                </button>
                {vault === 0 && <div className="mt-1.5 text-[8px] font-mono text-rose-200/55 border-t border-white/5 pt-1.5">الخزنة بتملى من نتيجة مؤكدة — مرحلة الحصاد جاية.</div>}
              </NeonCard>
            )}

            {!prefs.hiddenRails.includes("brain") && (
              <NeonCard title="المخ والمجلس" icon={Brain} color="#a78bfa">
                <button onClick={() => setArena("brain")} className="w-full hover:bg-white/[0.03] rounded-lg py-1 transition">
                  {brain ? (
                    <div className="grid grid-cols-4 gap-1 text-center font-mono">
                      <div><div className="text-sm font-black text-violet-300">{brain.providers || brain.cloud}</div><div className="text-[7px] text-white/35">مزود</div></div>
                      <div><div className="text-sm font-black text-violet-300">{brain.cloud}</div><div className="text-[7px] text-white/35">سحابي</div></div>
                      <div><div className="text-sm font-black text-violet-300">{brain.tools}</div><div className="text-[7px] text-white/35">أداة</div></div>
                      <div><div className="text-sm font-black text-violet-300">{brain.council}</div><div className="text-[7px] text-white/35">عضو</div></div>
                    </div>
                  ) : <div className="text-[9px] font-mono text-white/35">يتقاس…</div>}
                </button>
              </NeonCard>
            )}

            {!prefs.hiddenRails.includes("autonomy") && (
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
            )}

            {!prefs.hiddenRails.includes("cronmini") && (
              <NeonCard title={`الجدولة السريعة — ${cronOn}/${cronJobs.length} شغال`} icon={CalendarClock} color="#34d399">
                <div className="space-y-1">
                  {cronJobs.slice(0, 4).map((j) => (
                    <button key={j.id} onClick={() => setArena("cron")} className="w-full flex items-center gap-1.5 text-[9px] font-mono hover:bg-white/[0.03] rounded px-1 py-0.5 transition text-right">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: j.enabled ? DOT.ok : "#475569", boxShadow: j.enabled ? "0 0 6px #34d399" : "none" }} />
                      <span className="text-white/60 truncate flex-1">{j.name}</span>
                      <span className="text-white/30 shrink-0">{ago(j.nextRun, now)}</span>
                    </button>
                  ))}
                  {cronErr && <div className="text-[8px] font-mono text-rose-300/70">{cronErr}</div>}
                </div>
              </NeonCard>
            )}
          </div>

          {/* تحكم المالك: إظهار/إخفاء البطاقات */}
          <div className="mt-auto rounded-xl border border-white/10 bg-white/[0.02] p-2.5 space-y-1.5">
            <div className="text-[9px] font-black text-white/50 flex items-center gap-1.5"><Eye className="w-3 h-3" /> تشكيل الدولاب — عرض/إخفاء</div>
            <div className="grid grid-cols-2 gap-1">
              {RAIL_DEFS.map((r) => {
                const hidden = prefs.hiddenRails.includes(r.id);
                return (
                  <button key={r.id} onClick={() => toggleRail(r.id)}
                    className={`rounded-md border px-1.5 py-1 text-[8px] font-bold transition ${hidden ? "border-white/10 bg-white/[0.02] text-white/30 line-through" : "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200/80"}`}>
                    {r.title}
                  </button>
                );
              })}
            </div>
            {prefs.hiddenRails.length > 0 && (
              <button onClick={() => setPrefs((p) => ({ ...p, hiddenRails: [] }))}
                className="w-full inline-flex items-center justify-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-1 text-[8px] font-bold text-white/50 hover:text-white/80 transition">
                <RotateCcw className="w-2.5 h-2.5" /> إظهار الكل
              </button>
            )}
          </div>
        </aside>

        {/* ── منضدة العمل ── */}
        <section className="flex min-w-0 flex-1 flex-col min-h-0">
          <nav className="shrink-0 flex items-center gap-1 px-2.5 py-2 border-b border-white/5 overflow-x-auto bg-[#070309]/60">
            {ARENAS.map(({ key, labelAr, icon: Icon, color }) => {
              const active = arena === key;
              const badge = key === "cron" && cronJobs.length > 0 ? `${cronOn}/${cronJobs.length}` : null;
              return (
                <button key={key} onClick={() => setArena(key)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black transition-all"
                  style={active
                    ? { borderColor: color + "70", background: `${color}1c`, color, boxShadow: `0 0 14px ${color}30 inset, 0 0 8px ${color}20` }
                    : { borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.45)" }}>
                  <Icon className="w-3.5 h-3.5" />
                  {labelAr}
                  {badge && <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-1.5 text-[8px] text-emerald-300 font-mono" dir="ltr">{badge}</span>}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {arena === "launch" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.04] px-3.5 py-2 text-[10px] font-mono text-rose-200/70">
                  Ctrl+K يوصّلك لأي حاجة · بلاط النافذة يفتح نافذة الديسكتوب الرسمية · بلاط الأمر يحشي الشات وإنت تكمل الهدف وتبعت — مفيش حاجة بتتنفذ من وراك.
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
                          className={`rounded-xl border bg-gradient-to-br px-3 py-3 text-right transition-all hover:-translate-y-0.5 hover:shadow-lg ${hue}`}
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
                  {cronJobs.length} مهمة حية — Trigger فوري وتشغيل/إطفاء حقيقيان، والنتايج موصولة بساحتها.
                </div>
                {cronErr && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-mono text-rose-200">{cronErr}</div>}
                {cronJobs.map((j) => {
                  const link = CRON_LINKS[j.id];
                  const busyThis = cronBusy === j.id;
                  return (
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
                          تشغيلات ×{j.runCount} · آخر: {ago(j.lastRun, now)}{j.nextRun ? ` · تالي: ${ago(j.nextRun, now)}` : ""}
                        </div>
                        {j.lastResult && (
                          <div className="mt-1 rounded-lg border border-white/[0.06] bg-black/30 px-2 py-1 text-[9px] font-mono text-emerald-100/70 leading-4 break-words">
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

        {/* ── الشات — بتحكم إظهار/إخفاء كامل ── */}
        {prefs.chatOpen && (
          <aside className="w-full lg:w-[430px] shrink-0 border-r border-rose-500/20 lg:border-r lg:border-l-0 flex flex-col min-h-0 bg-[#060309]">
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-rose-500/15 bg-gradient-to-l from-rose-600/15 to-violet-600/10">
              <Sparkles className="w-3.5 h-3.5 text-rose-300" />
              <span className="text-[10px] font-black text-rose-200 flex-1">الجلسة الذكية — اكتب براحتك</span>
              <button onClick={() => setPrefs((p) => ({ ...p, chatOpen: false }))} title="إخفاء الشات"
                className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-white/40 hover:text-white/80 transition">
                <EyeOff className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <NovaUnifiedChat
                title="نوفا — مركز التحكم"
                subtitle="عقل واحد · أدوات حقيقية · أدلة SHA-256"
                hideRail
              />
            </div>
          </aside>
        )}
        {!prefs.chatOpen && (
          <button onClick={() => setPrefs((p) => ({ ...p, chatOpen: true }))}
            className="shrink-0 flex flex-col items-center justify-center gap-2 w-10 border-r border-rose-500/20 bg-rose-500/[0.06] hover:bg-rose-500/15 transition text-rose-300"
            title="إظهار الشات">
            <MessageSquare className="w-4 h-4" />
            <span className="text-[8px] font-black" style={{ writingMode: "vertical-rl" }}>الشات</span>
          </button>
        )}
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
        <span className="mr-auto shrink-0 text-rose-300/50">DAWSHA DECK v6</span>
      </footer>
    </div>
  );
}
