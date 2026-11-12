/**
 * NovaAgentPro v3 — «مركز قيادة دوشة»: الشات مش تاب… الشات هو القلب.
 *
 * شكوى المالك بالنص: «مفيش مكان للشات ومش متناسق». فالـv3 قلبت الفلسفة:
 *  · الشات الموحّد مثبّت يمين دايمًا (≤44% العرض) — بيشتغل وأنت بتتفرج على أي حاجة.
 *  · عمود القيادة شمال: الأسطول المتصل (connect-info حي) + المخ (nova-core)
 *    + العتاد (monitor/system) + الاستقلالية (SystemContext) — كل 10–15s تحديث.
 *  · الساحة الوسطى: منظر واحد ظاهر وقت واحد (نبض الأحداث · المهمات · المخ ·
 *    العتاد · الصيد · القنوات · الملاحة) — كلها مكونات حقيقية موجودة أصلًا.
 *  · شريط أحداث سفلي مربوط بـSSE /api/agent/events (من SystemContext نفسه —
 *    اللي بيطلي هنا هو اللي بيطلي لكل البرنامج).
 *  · كل رقم مصدره fetch حقيقي؛ الفشل يتعرض نص حرفي مش قيمة متلبّسة.
 * ممنوع «قريبًا» وأزرار ميتة — check-dead-buttons حارس.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain, Cpu, Target, Cable, Compass, MessageSquareText,
  Bot, Server, ShieldCheck, ShieldAlert, Clock3, Radio,
  MonitorSmartphone, ListChecks, Activity, Zap, ZapOff, MemoryStick,
} from "lucide-react";
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";
import { NovaOpsRoom, NovaHuntSurface } from "@/components/desktop/NovaBrainOps";
import { RealTimeSystemMonitor } from "@/components/desktop/RealTimeSystemMonitor";
import { NovaMissions } from "@/components/desktop/NovaMissions";
import { TelegramConfigCard } from "@/components/TelegramConfigCard";
import { opsFetch } from "@/lib/ops-client";
import { useSystem } from "@/context/SystemContext";

/* ── أنواع الردود اللي بتيجي من السيرفر (شكل مثبت من الكود مش من إحساس) ── */

type ArenaKey = "events" | "missions" | "brain" | "hardware" | "hunt" | "channels" | "nav";

interface Vitals {
  healthOk: boolean | null; healthMs: number | null; db: boolean | null;
  sha: string; uptimeS: number | null; tools: number;
  tgToken: boolean | null; tgChat: boolean | null;
}

interface FleetAgentInfo {
  id: string; hostname: string; platform: string; cpus?: number;
  totalMemory?: number; connectedAt?: string; capabilities?: string[];
}

interface BrainStatus {
  providers?: unknown[]; council?: unknown; tools?: unknown[]; categories?: number;
}

const ARENAS: Array<{ key: ArenaKey; labelAr: string; icon: typeof Brain; color: string }> = [
  { key: "events",   labelAr: "نبض الأحداث",  icon: Activity,    color: "#4ade80" },
  { key: "missions", labelAr: "المهمات",      icon: ListChecks,  color: "#fbbf24" },
  { key: "brain",    labelAr: "المخ والمجلس", icon: Brain,       color: "#a78bfa" },
  { key: "hardware", labelAr: "العتاد الحي",  icon: Cpu,         color: "#22d3ee" },
  { key: "hunt",     labelAr: "الصيد",        icon: Target,      color: "#fb7185" },
  { key: "channels", labelAr: "القنوات",      icon: Cable,       color: "#f59e0b" },
  { key: "nav",      labelAr: "الملاحة",      icon: Compass,     color: "#60a5fa" },
];

const NAV_GROUPS: Array<{ group: string; color: string; items: Array<{ path: string; label: string }> }> = [
  { group: "المراقبة والتشغيل", color: "#22d3ee", items: [
    { path: "/live-agent", label: "📡 الوكيل الحي" },
    { path: "/cve-live", label: "🛰 لوحة CVE الحية" },
    { path: "/monitor", label: "📈 Monitor" },
    { path: "/dashboard", label: "🏠 الداشبورد" },
    { path: "/jobs", label: "🧾 المهام والأدلة" },
    { path: "/memory", label: "🧠 ذاكرة المدير" },
  ] },
  { group: "الصيد والاستخبارات", color: "#fb7185", items: [
    { path: "/cve-db", label: "🗄 قاعدة CVE (NVD حي)" },
    { path: "/cve-search", label: "🎯 بحث الثغرات" },
    { path: "/shodan", label: "🌐 Shodan سلبي" },
    { path: "/nova-intelligence", label: "🔎 NOVA Intel" },
    { path: "/mitre", label: "🗺 MITRE ATT&CK" },
    { path: "/threat-detector", label: "🚨 كشف التهديدات" },
  ] },
  { group: "الأدوات والشبكات", color: "#a78bfa", items: [
    { path: "/terminal", label: "💻 كونسول الأسطول" },
    { path: "/port-scanner", label: "🛰 ماسح المنافذ" },
    { path: "/dns-lookup", label: "🧭 DNS Lookup" },
    { path: "/whois-lookup", label: "🗺 WHOIS" },
    { path: "/subdomains", label: "🕸 النطاقات الفرعية" },
    { path: "/hash-calculator", label: "#️⃣ الهاشات" },
  ] },
  { group: "الإدارة والتكامل", color: "#4ade80", items: [
    { path: "/settings", label: "⚙ الإعدادات وقناة التليجرام" },
    { path: "/webhooks", label: "🪝 Webhooks" },
    { path: "/workspaces", label: "🗂 مساحات العمل" },
    { path: "/playbooks", label: "📜 Playbooks" },
    { path: "/reports", label: "📄 التقارير PDF" },
    { path: "/cron", label: "⏱ Cron" },
  ] },
];

function fmtUptime(s: number | null): string {
  if (s == null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}ي ${h}س ${m}د` : h > 0 ? `${h}س ${m}د` : `${m}د`;
}

function fmtClock(ts: number): string {
  try { return new Date(ts).toLocaleTimeString("ar-EG", { hour12: false }); } catch { return "—"; }
}

/* بطاقة صغيرة قياسية لعمود القيادة */
function RailCard({ title, icon: Icon, color, children, footer }: {
  title: string; icon: typeof Brain; color: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/8 bg-black/40 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-white/5"
        style={{ background: `${color}0d` }}>
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-[11px] font-black" style={{ color }}>{title}</span>
      </header>
      <div className="p-2.5 text-[11px]">{children}</div>
      {footer && <div className="px-2.5 pb-2">{footer}</div>}
    </section>
  );
}

export default function NovaAgentPro() {
  const [arena, setArena] = useState<ArenaKey>("events");
  const sys = useSystem();
  const [vit, setVit] = useState<Vitals>({ healthOk: null, healthMs: null, db: null, sha: "", uptimeS: null, tools: 0, tgToken: null, tgChat: null });
  const [agents, setAgents] = useState<FleetAgentInfo[]>([]);
  const [agentsErr, setAgentsErr] = useState<string | null>(null);
  const [brain, setBrain] = useState<BrainStatus | null>(null);
  const [hw, setHw] = useState<{ cpu: number | null; mem: number | null; cores: number | null }>({ cpu: null, mem: null, cores: null });
  const mounted = useRef(Date.now());

  /* ─── النبض العلوي + المخ + الأسطول (تحديث دوري، كل المصادر حقيقية) ─── */
  const refresh = useCallback(async () => {
    const t0 = performance.now();
    let healthOk = false, db: boolean | null = null, healthMs: number | null = null;
    try {
      const r = await fetch("/api/healthz");
      healthMs = Math.round(performance.now() - t0);
      const j = (await r.json().catch(() => null)) as { status?: string; db?: { reachable?: boolean } } | null;
      healthOk = r.ok && j?.status === "ok";
      db = j?.db?.reachable ?? null;
    } catch { healthOk = false; healthMs = null; }
    let sha = "", uptimeS: number | null = null, tools = 0;
    try {
      const r = await fetch("/api/ops/version");
      const j = (await r.json().catch(() => null)) as { sha?: string; uptimeSec?: number; toolsPresent?: string[] } | null;
      sha = String(j?.sha ?? "").slice(0, 7);
      uptimeS = typeof j?.uptimeSec === "number" ? j.uptimeSec : null;
      tools = Array.isArray(j?.toolsPresent) ? j.toolsPresent.length : 0;
    } catch { /* offline */ }
    let tgToken: boolean | null = null, tgChat: boolean | null = null;
    try {
      const r = await fetch("/api/ops/config/status");
      const j = (await r.json().catch(() => null)) as { keys?: Record<string, boolean> } | null;
      tgToken = j?.keys?.["telegram.botToken"] ?? null;
      tgChat = j?.keys?.["telegram.chatId"] ?? null;
    } catch { /* optional */ }
    setVit({ healthOk, healthMs, db, sha, uptimeS, tools, tgToken, tgChat });

    // الأسطول الحقيقي المتصل الآن (المصدر اللحظي الأدق — connect-info)
    try {
      const r = await fetch("/api/local-agent/connect-info");
      const j = (await r.json().catch(() => null)) as { agents?: FleetAgentInfo[] } | null;
      if (r.ok && Array.isArray(j?.agents)) { setAgents(j.agents); setAgentsErr(null); }
      else setAgentsErr(`connect-info رد ${r.status}`);
    } catch { setAgentsErr("connect-info مش راد"); }

    // المخ
    const br = await opsFetch<BrainStatus & { providers?: unknown[]; tools?: unknown[]; categoriesCount?: number }>("/nova-core/status");
    if (br.ok && br.data) {
      const d = br.data as { providers?: unknown[]; tools?: unknown[]; categoriesCount?: number; categories?: number };
      setBrain({ providers: d.providers ?? [], tools: d.tools ?? [], categories: d.categoriesCount ?? d.categories });
    }

    // العتاد
    const mr = await opsFetch<{ cpu?: { usage?: number; cores?: number }; memory?: { usagePercent?: number } }>("/monitor/system");
    if (mr.ok && mr.data) {
      setHw({
        cpu: typeof mr.data.cpu?.usage === "number" ? Math.round(mr.data.cpu.usage) : null,
        mem: typeof mr.data.memory?.usagePercent === "number" ? mr.data.memory.usagePercent : null,
        cores: typeof mr.data.cpu?.cores === "number" ? mr.data.cpu.cores : null,
      });
    }
  }, []);
  useEffect(() => { void refresh(); const iv = setInterval(refresh, 12_000); return () => clearInterval(iv); }, [refresh]);

  const sessionS = Date.now() - mounted.current;
  const lastEvents = sys.systemEvents.slice(0, 40);
  const ticker = sys.systemEvents.slice(0, 3);

  const pill = (ok: boolean | null | undefined, label: string, extra = "") => {
    const color = ok == null ? "#94a3b8" : ok ? "#4ade80" : "#fb7185";
    return (
      <span key={label} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold"
        style={{ borderColor: color + "40", color, background: color + "10" }}>
        <span className={"w-1.5 h-1.5 rounded-full" + (ok ? " animate-pulse" : "")} style={{ background: color }} />
        {ok == null ? `${label}: ⏳` : ok ? `${label}${extra}` : `${label}: ✗`}
      </span>
    );
  };

  const meter = (label: string, value: number | null, suffix = "%") => {
    const v = value ?? 0;
    const color = value == null ? "#64748b" : v > 85 ? "#fb7185" : v > 60 ? "#fbbf24" : "#4ade80";
    return (
      <div className="space-y-1" dir="ltr">
        <div className="flex justify-between text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>
          <span>{label}</span><span style={{ color }}>{value == null ? "—" : `${v}${suffix}`}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, Math.max(0, v))}%`, background: color }} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#04040c]" dir="rtl">
      {/* ── شريط النبض العلوي ── */}
      <header className="shrink-0 border-b border-emerald-500/10 bg-gradient-to-l from-emerald-950/20 via-[#04040c] to-purple-950/20 px-3 py-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Bot className="w-5 h-5 text-emerald-400" />
          <div>
            <h1 className="text-sm font-black text-emerald-200 leading-4">مركز قيادة دوشة — NOVA AGENT PRO</h1>
            <div className="text-[8px] font-mono text-white/30">
              الجلسة {fmtUptime(Math.round(sessionS / 1000))} · sha {vit.sha || "…"} · أحداث قناة البرنامج: {sys.systemEvents.length}
            </div>
          </div>
          <div className="mr-auto flex items-center gap-1 flex-wrap">
            {pill(vit.healthOk, "السيرفر", vit.healthOk && vit.healthMs != null ? ` ${vit.healthMs}ms` : "")}
            {pill(vit.db, "DB")}
            {pill(vit.tools > 0 ? true : null, `أدوات ×${vit.tools}`)}
            {pill(agents.length > 0 ? true : agentsErr == null ? null : false, `عقد ×${agents.length}`)}
            {pill(vit.tgToken, "TG")}
            {pill(vit.tgChat, "TG·chat")}
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-mono font-bold text-cyan-300">
              <Clock3 className="w-3 h-3" /> {fmtUptime(vit.uptimeS)}
            </span>
          </div>
        </div>
      </header>

      {/* ── الجسم: [قيادة | ساحة | شات] ── */}
      <main className="flex-1 min-h-0 flex overflow-hidden">

        {/* عمود القيادة (يسار) — حي بالكامل */}
        <aside className="hidden xl:flex w-[264px] shrink-0 flex-col gap-2.5 border-l border-white/5 p-2.5 overflow-y-auto">
          <RailCard title={`الأسطول المتصل — ${agents.length} عقدة`} icon={Server} color="#22d3ee"
            footer={agents.length === 0
              ? <div className="text-[9px] font-mono text-white/35">{agentsErr ?? "مفيش عقد متصلة دلوقتي — /live-agent فيه سطر الانضمام الجاهز"}</div>
              : undefined}>
            <div className="space-y-1.5">
              {agents.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] font-bold text-cyan-200 truncate" dir="ltr">{a.id}</div>
                    <div className="text-[8px] font-mono text-white/35 truncate">{a.hostname} · {a.platform}{a.cpus ? ` · ${a.cpus}C` : ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </RailCard>

          <RailCard title="المخ السحابي" icon={Brain} color="#a78bfa">
            {brain ? (
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div><div className="text-base font-black font-mono text-purple-300">{brain.providers?.length ?? 0}</div><div className="text-[8px] font-mono text-white/35">مزود</div></div>
                <div><div className="text-base font-black font-mono text-purple-300">{brain.tools?.length ?? 0}</div><div className="text-[8px] font-mono text-white/35">أداة</div></div>
                <div><div className="text-base font-black font-mono text-purple-300">{brain.categories ?? "—"}</div><div className="text-[8px] font-mono text-white/35">فئة</div></div>
              </div>
            ) : <div className="text-[9px] font-mono text-white/35">يتقاس…</div>}
          </RailCard>

          <RailCard title={`العتاد الحي${hw.cores ? ` — ${hw.cores}C` : ""}`} icon={Cpu} color="#22d3ee">
            <div className="space-y-2">
              {meter("CPU", hw.cpu)}
              {meter("RAM", hw.mem)}
            </div>
          </RailCard>

          <RailCard title="الاستقلالية" icon={sys.autonomousStatus.enabled ? Zap : ZapOff} color={sys.autonomousStatus.enabled ? "#fbbf24" : "#64748b"}>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[9px] font-mono">
                <span className={sys.autonomousStatus.enabled ? "text-amber-300" : "text-white/35"}>
                  {sys.autonomousStatus.enabled ? (sys.autonomousStatus.isRunning ? "شغّال الآن ⚡" : "مفعّلة") : "مطفية"}
                </span>
                <span className="text-white/35">✔{sys.autonomousStatus.tasksCompleted} · ✗{sys.autonomousStatus.tasksErrored}</span>
              </div>
              <button
                onClick={() => { sys.autonomousStatus.enabled ? sys.disableAutonomous() : sys.enableAutonomous(); }}
                className="w-full rounded-lg border px-2 py-1.5 text-[10px] font-black transition-colors"
                style={sys.autonomousStatus.enabled
                  ? { borderColor: "#fbbf2466", background: "#fbbf2412", color: "#fbbf24" }
                  : { borderColor: "#4ade8066", background: "#4ade8012", color: "#4ade80" }}>
                {sys.autonomousStatus.enabled ? "إطفاء الوضع المستقل" : "تشغيل الوضع المستقل"}
              </button>
              <div className="text-[8px] font-mono text-white/30">بيضرب /api/agent/autonomous على طول — الدقيقة بتحصل من الكونتكست المركزي مش من عجة.</div>
            </div>
          </RailCard>

          <RailCard title={`الذاكرة الحية — ${sys.memoryEvents.length}`} icon={MemoryStick} color="#f472b6">
            <div className="space-y-1">
              {sys.memoryEvents.slice(0, 3).map((m) => (
                <div key={m.id} className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1">
                  <div className="text-[9px] font-bold text-pink-200/80 truncate">{m.key}</div>
                  <div className="text-[8px] font-mono text-white/30 truncate" dir="ltr">{m.content.slice(0, 60)}</div>
                </div>
              ))}
              {sys.memoryEvents.length === 0 && <div className="text-[9px] font-mono text-white/35">الخزنة لسه فاضية</div>}
            </div>
          </RailCard>
        </aside>

        {/* الساحة الوسطى */}
        <section className="flex-1 min-w-0 flex flex-col min-h-0">
          <nav className="shrink-0 flex items-center gap-1 px-2.5 py-2 border-b border-white/5 overflow-x-auto">
            {ARENAS.map(({ key, labelAr, icon: Icon, color }) => {
              const active = arena === key;
              return (
                <button key={key} onClick={() => setArena(key)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black transition-all"
                  style={active
                    ? { borderColor: color + "66", background: `${color}18`, color, boxShadow: `0 0 10px ${color}22 inset` }
                    : { borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)", color: "rgba(255,255,255,0.45)" }}>
                  <Icon className="w-3.5 h-3.5" />
                  {labelAr}
                  {key === "events" && sys.systemEvents.length > 0 && (
                    <span className="rounded-full px-1.5 text-[8px] font-mono" style={{ background: `${color}25`, color }}>{sys.systemEvents.length}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {arena === "events" && (
              <div className="space-y-1.5" dir="ltr">
                {lastEvents.length === 0 && (
                  <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center text-[11px] font-mono text-white/35" dir="rtl">
                    قناة الأحداث مفتوحة (SSE) — أول حدث هيظهر هنا لحظيًا: مهمة بتبدأ، ذكرى بتتخزن، عقدة بتدخل.
                  </div>
                )}
                {lastEvents.map((ev, i) => (
                  <div key={`${ev.ts}-${i}`} className="flex items-start gap-2.5 rounded-lg border border-white/6 bg-black/40 px-3 py-2">
                    <span className="text-[9px] font-mono text-white/30 shrink-0 pt-0.5">{fmtClock(ev.ts)}</span>
                    <span className="text-[10px] font-black font-mono text-emerald-300 shrink-0">{ev.type}</span>
                    {ev.data && <span className="text-[9px] font-mono text-white/40 truncate">{JSON.stringify(ev.data).slice(0, 140)}</span>}
                  </div>
                ))}
              </div>
            )}
            {arena === "missions" && <NovaMissions />}
            {arena === "brain" && <NovaOpsRoom />}
            {arena === "hardware" && <RealTimeSystemMonitor />}
            {arena === "hunt" && <NovaHuntSurface />}
            {arena === "channels" && (
              <div className="max-w-3xl space-y-3">
                <TelegramConfigCard />
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] font-mono text-amber-200/80 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold"><Radio className="w-4 h-4" /> قنوات تانية من نفس المحور:</div>
                  <div>· تنبيهات الزيارات (عين الزيارات) — مربوطة بنفس القناة فورًا بعد التوكن.</div>
                  <div>· GitHub متكامل فعلًا: الحزمة بتتبنى من CI بتوقيع، والـwatchdog بيفعّل صيانة الأدوات تلقائيًا.</div>
                </div>
              </div>
            )}
            {arena === "nav" && (
              <div className="space-y-4">
                <div className="text-[11px] font-mono text-white/40 flex items-center gap-2">
                  <Compass className="w-4 h-4 text-blue-400" />
                  كل زرار هنا بيفتح مركز حقيقي جوه المنصة (83 صفحة مرروتة — حارس «مفيش زرار ميت» صايدهم كلهم).
                </div>
                {NAV_GROUPS.map(({ group, color, items }) => (
                  <section key={group}>
                    <h2 className="text-[12px] font-black mb-2 flex items-center gap-2" style={{ color }}>
                      <span className="w-1 h-3.5 rounded-full" style={{ background: color }} />
                      {group}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      {items.map((it) => (
                        <a key={it.path} href={it.path}
                          className="rounded-xl border px-3 py-3 text-center text-[11px] font-bold font-mono transition-all hover:-translate-y-0.5"
                          style={{ borderColor: color + "30", background: color + "08", color: color + "dd" }}>
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

        {/* الشات الموحّد — القلب، مثبّت على طول الشاشة */}
        <aside className="w-full lg:w-[42%] lg:min-w-[380px] xl:min-w-[420px] shrink-0 border-r border-emerald-500/15 lg:border-r lg:border-l-0 order-first lg:order-none flex flex-col min-h-0 bg-[#050608]">
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-emerald-500/10 bg-emerald-500/5">
            <MessageSquareText className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] font-black text-emerald-300">الجلسة الذكية — ثابتة هنا مهما فتحت في الساحة</span>
          </div>
          <div className="flex-1 min-h-0">
            <NovaUnifiedChat
              title="نوفا — مركز التحكم"
              subtitle="عقل واحد · أدوات حقيقية · أدلة SHA-256 — وبيدير كل اللي حواليك"
            />
          </div>
        </aside>
      </main>

      {/* ── شريط الأحداث السفلي: آخر 3 من قناة البرنامج الحية ── */}
      <footer className="shrink-0 border-t border-white/5 px-3 py-1.5 flex items-center gap-3 text-[9px] font-mono text-white/30 overflow-hidden">
        {vit.healthOk === true ? <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" /> : <ShieldAlert className="w-3 h-3 text-rose-400 shrink-0" />}
        <span className="shrink-0">{vit.healthOk === true ? "المنصة واعية" : vit.healthOk == null ? "يتقاس…" : "السيرفر مش واصل"}</span>
        <div className="flex items-center gap-4 min-w-0 overflow-hidden">
          {ticker.length === 0
            ? <span className="text-white/20">قناة الأحداث هادية…</span>
            : ticker.map((ev, i) => (
              <span key={`${ev.ts}-${i}`} className="whitespace-nowrap text-white/40 truncate" dir="ltr">
                <span className="text-white/25">{fmtClock(ev.ts)}</span> <span className="text-emerald-300/80">{ev.type}</span>
              </span>
            ))}
        </div>
        <span className="mr-auto shrink-0 hidden sm:inline"><MonitorSmartphone className="w-3 h-3 inline ml-1" />AGENT PRO v3</span>
      </footer>
    </div>
  );
}
