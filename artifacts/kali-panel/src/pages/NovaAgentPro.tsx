/**
 * NovaAgentPro v4 — «كونسول دوشة»: مكتب تشغيل هادي يشتغل فيه بني آدم فعلًا.
 *
 * الشكوى المقاسة من سكرين سجل المالك للـv2: زحمة نيون وتبويبات تشيل الشات —
 * «دا مش منظر اشتغل فيه». الرد تصميمي مش تجميلي:
 *  · لون واحد مميز (زمردي) وحالة ألوان سيمانتيك بس (أخضر يشتغل/أحمر وقع) —
 *    لا تدرجات، لا ظلال نيون، لا إيموجي في رؤوس الأقسام.
 *  · الشات ثابت يمين 420px بلا الشريط الجانبي المزخرف بتاعه (hideRail) —
 *    قناة واحدة صافية تقدر تتكلم فيها وانت شايف أي عرض تاني.
 *  · سكة أيقونات 52px شمال للعروض (8 مناظر)، عمود سياق 232px بنصوص نظيفة
 *    من نفس APIs الحقيقية، وشريط حالة سفلي بسطر واحد.
 *  · كل رقم مصدره fetch مقاس؛ الفشل نص حرفي، مش قيمة متلبّسة ولا صفر مورّي.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, MonitorSmartphone, ListChecks, Brain, Cpu, Target, Cable, Compass,
  Server, ShieldCheck, Zap, ZapOff, MemoryStick, Clock3,
} from "lucide-react";
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";
import { NovaOpsRoom, NovaHuntSurface } from "@/components/desktop/NovaBrainOps";
import { RealTimeSystemMonitor } from "@/components/desktop/RealTimeSystemMonitor";
import { NovaMissions } from "@/components/desktop/NovaMissions";
import { KaliTerminal } from "@/components/desktop/KaliTerminal";
import { AdvancedFileManager } from "@/components/desktop/AdvancedFileManager";
import { TelegramConfigCard } from "@/components/TelegramConfigCard";
import { opsFetch } from "@/lib/ops-client";
import { useSystem } from "@/context/SystemContext";

type ArenaKey = "events" | "desktop" | "missions" | "brain" | "hardware" | "hunt" | "channels" | "nav";

interface Vitals {
  healthOk: boolean | null; healthMs: number | null; db: boolean | null;
  sha: string; uptimeS: number | null; tools: number;
}

interface FleetAgentInfo {
  id: string; hostname: string; platform: string; user?: string; cpus?: number;
  totalMemory?: number; connectedAt?: string; capabilities?: string[];
}

const ARENAS: Array<{ key: ArenaKey; labelAr: string; icon: typeof Brain }> = [
  { key: "events",   labelAr: "نبض الأحداث",  icon: Activity },
  { key: "desktop",  labelAr: "سطح المكتب",   icon: MonitorSmartphone },
  { key: "missions", labelAr: "المهمات",      icon: ListChecks },
  { key: "brain",    labelAr: "المخ والمجلس", icon: Brain },
  { key: "hardware", labelAr: "العتاد الحي",  icon: Cpu },
  { key: "hunt",     labelAr: "الصيد",        icon: Target },
  { key: "channels", labelAr: "القنوات",      icon: Cable },
  { key: "nav",      labelAr: "كل الأقسام",   icon: Compass },
];

const NAV_GROUPS: Array<{ group: string; items: Array<{ path: string; label: string }> }> = [
  { group: "المراقبة", items: [
    { path: "/live-agent", label: "الوكيل الحي" },
    { path: "/cve-live", label: "لوحة CVE الحية" },
    { path: "/monitor", label: "Monitor" },
    { path: "/dashboard", label: "الداشبورد" },
    { path: "/jobs", label: "المهام والأدلة" },
    { path: "/memory", label: "ذاكرة المدير" },
  ] },
  { group: "الصيد والاستخبارات", items: [
    { path: "/cve-db", label: "قاعدة CVE" },
    { path: "/cve-search", label: "بحث الثغرات" },
    { path: "/shodan", label: "Shodan سلبي" },
    { path: "/nova-intelligence", label: "NOVA Intel" },
    { path: "/mitre", label: "MITRE ATT&CK" },
    { path: "/threat-detector", label: "كشف التهديدات" },
  ] },
  { group: "الأدوات", items: [
    { path: "/terminal", label: "كونسول الأسطول" },
    { path: "/port-scanner", label: "ماسح المنافذ" },
    { path: "/dns-lookup", label: "DNS" },
    { path: "/whois-lookup", label: "WHOIS" },
    { path: "/subdomains", label: "النطاقات الفرعية" },
    { path: "/hash-calculator", label: "الهاشات" },
  ] },
  { group: "الإدارة", items: [
    { path: "/settings", label: "الإعدادات" },
    { path: "/webhooks", label: "Webhooks" },
    { path: "/workspaces", label: "مساحات العمل" },
    { path: "/playbooks", label: "Playbooks" },
    { path: "/reports", label: "التقارير" },
    { path: "/cron", label: "Cron" },
  ] },
];

const fmtUptime = (s: number | null): string => {
  if (s == null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}ي ${h}س ${m}د` : h > 0 ? `${h}س ${m}د` : `${m}د`;
};
const fmtClock = (ts: number): string => {
  try { return new Date(ts).toLocaleTimeString("ar-EG", { hour12: false }); } catch { return "—"; }
};
const fmtNum = (n: number | null): string => n == null ? "—" : n.toLocaleString("en");

/* ── مبانٍ سطحية: قسم سياق مسطّح + رقم إحصائي + زرار حالة ── */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/5 px-3 py-2.5">
      <div className="text-[9px] font-bold tracking-[0.14em] text-zinc-500 uppercase mb-1.5" dir="ltr">{label}</div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" | "busy" }) {
  const color = tone === "ok" ? "text-emerald-400" : tone === "bad" ? "text-rose-400" : tone === "busy" ? "text-amber-400" : "text-zinc-200";
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className={`text-[11px] font-mono font-bold ${color}`} dir="ltr">{value}</span>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  const color = value > 85 ? "#fb7185" : value > 60 ? "#fbbf24" : "#34d399";
  return (
    <div className="h-1 rounded bg-white/5 overflow-hidden">
      <div className="h-full transition-all duration-700" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}

const DOT: Record<string, string> = { ok: "#34d399", bad: "#fb7185", wait: "#52525b" };

export default function NovaAgentPro() {
  const [arena, setArena] = useState<ArenaKey>("events");
  const sys = useSystem();
  const [vit, setVit] = useState<Vitals>({ healthOk: null, healthMs: null, db: null, sha: "", uptimeS: null, tools: 0 });
  const [agents, setAgents] = useState<FleetAgentInfo[]>([]);
  const [agentsErr, setAgentsErr] = useState<string | null>(null);
  const [brain, setBrain] = useState<{ providers: number; tools: number; council: number } | null>(null);
  const [hw, setHw] = useState<{ cpu: number | null; mem: number | null; cores: number | null }>({ cpu: null, mem: null, cores: null });
  const [vault, setVault] = useState<{ total: number | null }>({ total: null });
  const [corpus, setCorpus] = useState<{ total: number | null; kev: number | null }>({ total: null, kev: null });
  const [sessionSec, setSessionSec] = useState(0);
  const mounted = useRef(Date.now());

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
    setVit({ healthOk, healthMs, db, sha, uptimeS, tools });

    try {
      const r = await fetch("/api/local-agent/connect-info");
      const j = (await r.json().catch(() => null)) as { agents?: FleetAgentInfo[] } | null;
      if (r.ok && Array.isArray(j?.agents)) { setAgents(j.agents); setAgentsErr(null); }
      else setAgentsErr(`connect-info ${r.status}`);
    } catch { setAgentsErr("connect-info مش راد"); }

    const br = await opsFetch<{ providers?: unknown[]; tools?: number | unknown[]; council?: { members?: unknown[] } }>("/nova-core/status");
    if (br.ok && br.data) {
      const d = br.data;
      setBrain({
        providers: Array.isArray(d.providers) ? d.providers.length : 0,
        tools: Array.isArray(d.tools) ? d.tools.length : typeof d.tools === "number" ? d.tools : 0,
        council: Array.isArray(d.council?.members) ? d.council.members.length : 0,
      });
    }
    const mr = await opsFetch<{ cpu?: { usage?: number; cores?: number }; memory?: { usagePercent?: number } }>("/monitor/system");
    if (mr.ok && mr.data) {
      setHw({
        cpu: typeof mr.data.cpu?.usage === "number" ? Math.round(mr.data.cpu.usage) : null,
        mem: typeof mr.data.memory?.usagePercent === "number" ? mr.data.memory.usagePercent : null,
        cores: typeof mr.data.cpu?.cores === "number" ? mr.data.cpu.cores : null,
      });
    }
    const fr = await opsFetch<{ present?: boolean; total?: number; counts?: { total?: number } }>("/ops/findings/status");
    if (fr.ok && fr.data) {
      const t = typeof fr.data.counts?.total === "number" ? fr.data.counts.total : typeof fr.data.total === "number" ? fr.data.total : null;
      setVault({ total: t });
    }
    const cr = await opsFetch<{ total?: number; kev?: number }>("/ops/corpus");
    if (cr.ok && cr.data) {
      setCorpus({
        total: typeof cr.data.total === "number" ? cr.data.total : null,
        kev: typeof cr.data.kev === "number" ? cr.data.kev : null,
      });
    }
  }, []);
  useEffect(() => { void refresh(); const iv = setInterval(refresh, 12_000); return () => clearInterval(iv); }, [refresh]);
  useEffect(() => { const iv = setInterval(() => setSessionSec(Math.round((Date.now() - mounted.current) / 1000)), 1000); return () => clearInterval(iv); }, []);

  const lastEvents = sys.systemEvents.slice(0, 40);
  const ticker = sys.systemEvents.slice(0, 1);
  const a0 = agents.find((a) => a.id === "self-node") ?? agents[0];

  const topDot = (ok: boolean | null | undefined): string => DOT[ok == null ? "wait" : ok ? "ok" : "bad"];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0d12] text-zinc-200" dir="rtl">
      {/* ── شريط علوي رفيع: الاسم + الذرية الأساسية بس ── */}
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-white/5 bg-[#0d1117] px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-black tracking-wide text-emerald-400">NOVA</span>
          <span className="text-[11px] font-bold text-zinc-400">مركز قيادة دوشة</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: topDot(vit.healthOk) }} />السيرفر{vit.healthMs != null ? ` ${vit.healthMs}ms` : ""}</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: topDot(vit.db) }} />DB</span>
          <span className="flex items-center gap-1.5" dir="ltr"><span className="h-1.5 w-1.5 rounded-full" style={{ background: agents.length > 0 ? DOT.ok : agentsErr ? DOT.bad : DOT.wait }} />nodes×{agents.length}</span>
          <span dir="ltr">tools×{vit.tools}</span>
          <span className="hidden md:inline text-zinc-600" dir="ltr">up {fmtUptime(vit.uptimeS)} · {vit.sha || "…"}</span>
        </div>
        <div className="mr-auto flex items-center gap-1 text-[10px] font-mono text-zinc-600" dir="ltr">
          <Clock3 className="h-3 w-3" /> session {fmtUptime(sessionSec)}
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* ── سكة الأيقونات الشمال ── */}
        <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-l border-white/5 bg-[#0c0f14] py-2.5">
          {ARENAS.map(({ key, labelAr, icon: Icon }) => {
            const active = arena === key;
            return (
              <button key={key} onClick={() => setArena(key)} title={labelAr}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${active ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-600 hover:bg-white/5 hover:text-zinc-300"}`}>
                <Icon className="h-[17px] w-[17px]" />
              </button>
            );
          })}
        </nav>

        {/* ── عمود السياق ── */}
        <aside className="hidden w-[232px] shrink-0 flex-col overflow-y-auto border-l border-white/5 bg-[#0c0f14] md:flex">
          <Section label={`nodes · ${agents.length}`}>
            {agents.slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-center gap-2 py-1">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DOT.ok }} />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[10px] font-bold text-zinc-300" dir="ltr">{a.id}</div>
                  <div className="truncate text-[9px] text-zinc-600">{a.hostname} · {a.platform}{a.cpus ? ` · ${a.cpus}C` : ""}</div>
                </div>
              </div>
            ))}
            {agents.length === 0 && <div className="text-[9px] text-zinc-600">{agentsErr ?? "مفيش عقد متصلة — سطر الانضمام في /live-agent"}</div>}
          </Section>

          <Section label={`hardware${hw.cores ? ` · ${hw.cores}C` : ""}`}>
            <div className="space-y-1.5" dir="ltr">
              <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500">
                <span>CPU</span><span className="text-zinc-300">{hw.cpu == null ? "—" : `${hw.cpu}%`}</span>
              </div>
              {hw.cpu != null && <Bar value={hw.cpu} />}
              <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500">
                <span>RAM</span><span className="text-zinc-300">{hw.mem == null ? "—" : `${hw.mem}%`}</span>
              </div>
              {hw.mem != null && <Bar value={hw.mem} />}
            </div>
          </Section>

          <Section label="vault · corpus">
            <Stat label="نتائج الخزنة" value={fmtNum(vault.total)} tone={vault.total != null && vault.total > 0 ? "ok" : undefined} />
            <Stat label="CVE مقاسة" value={fmtNum(corpus.total)} />
            <Stat label="KEV مؤكدة" value={fmtNum(corpus.kev)} />
            {vault.total === 0 && <div className="mt-1 text-[8px] leading-4 text-zinc-600">الخزنة بتملى بأول نتيجة مؤكدة من أدوات الفحص — مش بأرقام معروضة.</div>}
          </Section>

          <Section label="council brain">
            {brain == null
              ? <div className="text-[9px] text-zinc-600">يتقاس…</div>
              : (<>
                  <Stat label="مزودون" value={fmtNum(brain.providers)} />
                  <Stat label="أدوات" value={fmtNum(brain.tools)} />
                  <Stat label="أصوات المجلس" value={fmtNum(brain.council)} />
                </>)}
          </Section>

          <Section label="autonomy">
            <div className="flex items-center justify-between">
              <span className={`flex items-center gap-1.5 text-[10px] font-bold ${sys.autonomousStatus.enabled ? "text-amber-400" : "text-zinc-500"}`}>
                {sys.autonomousStatus.enabled ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                {sys.autonomousStatus.enabled ? (sys.autonomousStatus.isRunning ? "شغّال الآن" : "مفعّلة") : "مطفية"}
              </span>
              <button
                onClick={() => { sys.autonomousStatus.enabled ? sys.disableAutonomous() : sys.enableAutonomous(); }}
                className={`rounded-md border px-2 py-1 text-[9px] font-bold transition-colors ${sys.autonomousStatus.enabled ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"}`}>
                {sys.autonomousStatus.enabled ? "إطفاء" : "تشغيل"}
              </button>
            </div>
            <div className="mt-1 text-[8px] font-mono text-zinc-600" dir="ltr">✔ {sys.autonomousStatus.tasksCompleted} · ✗ {sys.autonomousStatus.tasksErrored}</div>
          </Section>

          <Section label={`memory · ${sys.memoryEvents.length}`}>
            {sys.memoryEvents.slice(0, 3).map((m) => (
              <div key={m.id} className="truncate py-0.5 text-[9px] text-zinc-500">{m.key}</div>
            ))}
            {sys.memoryEvents.length === 0 && <div className="text-[9px] text-zinc-600">فاضية</div>}
          </Section>
        </aside>

        {/* ── منضدة الشغل ── */}
        <section className="flex min-w-0 flex-1 flex-col min-h-0">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/5 bg-[#0c0f14] px-3">
            <span className="text-[11px] font-bold text-zinc-300">{ARENAS.find((x) => x.key === arena)?.labelAr}</span>
            {arena === "events" && <span className="font-mono text-[9px] text-zinc-600" dir="ltr">{sys.systemEvents.length} events</span>}
            {arena === "hunt" && <span className="font-mono text-[9px] text-zinc-600">حقيقي: trigger بيضرب API بعرض عدّاد</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {arena === "events" && (
              <div className="space-y-1" dir="ltr">
                {lastEvents.length === 0 && (
                  <div className="rounded-lg border border-white/5 bg-white/[0.02] p-5 text-center text-[11px] text-zinc-600" dir="rtl">
                    قناة الأحداث مفتوحة — أول حدث هيظهر لحظيًا: مهمة بتبدأ، ذكرى بتتخزن، عقدة بتدخل.
                  </div>
                )}
                {lastEvents.map((ev, i) => (
                  <div key={`${ev.ts}-${i}`} className="flex items-baseline gap-3 rounded-md border border-white/[0.04] bg-[#0c0f14] px-2.5 py-1.5">
                    <span className="shrink-0 font-mono text-[9px] text-zinc-600">{fmtClock(ev.ts)}</span>
                    <span className="shrink-0 font-mono text-[10px] font-bold text-emerald-400/90">{ev.type}</span>
                    {ev.data && <span className="truncate font-mono text-[9px] text-zinc-600">{JSON.stringify(ev.data).slice(0, 140)}</span>}
                  </div>
                ))}
              </div>
            )}
            {arena === "desktop" && (
              <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                <div className="flex min-h-[430px] flex-col overflow-hidden rounded-lg border border-white/8 bg-black/40">
                  <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/5 px-3">
                    <span className="text-[10px] font-bold text-zinc-400">تيرمنال كالي الحي</span>
                    <span className="font-mono text-[9px] text-zinc-600" dir="ltr">{a0 ? `${a0.hostname} · ${a0.user ?? "—"}` : "ينتظر عقدة…"}</span>
                  </div>
                  <div className="min-h-[380px] flex-1" dir="ltr">
                    <KaliTerminal agentConnected={agents.length > 0} agentHostname={a0?.hostname ?? ""} agentUser={a0?.user ?? ""} />
                  </div>
                </div>
                <div className="flex min-h-[430px] flex-col overflow-hidden rounded-lg border border-white/8 bg-black/40">
                  <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/5 px-3">
                    <span className="text-[10px] font-bold text-zinc-400">مدير ملفات العقدة</span>
                    <span className="font-mono text-[9px] text-zinc-600" dir="ltr">/api/files</span>
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
                <div className="rounded-lg border border-white/8 bg-white/[0.02] p-4 text-[11px] leading-6 text-zinc-500">
                  تنبيهات الزيارات مربوطة بنفس القناة فور التوكن. تكامل GitHub شغّال:
                  الحزمة بتتبنى بتوقيع، والـwatchdog بيفعّل صيانة الأدوات تلقائيًا.
                </div>
              </div>
            )}
            {arena === "nav" && (
              <div className="space-y-5">
                {NAV_GROUPS.map(({ group, items }) => (
                  <section key={group}>
                    <h2 className="mb-2 text-[10px] font-bold tracking-wide text-zinc-500">{group}</h2>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
                      {items.map((it) => (
                        <a key={it.path} href={it.path}
                          className="rounded-md border border-white/8 bg-[#0c0f14] px-3 py-2.5 text-center text-[11px] font-bold text-zinc-400 transition-colors hover:border-emerald-500/30 hover:text-emerald-300">
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

        {/* ── الشات الموحّد — القلب الثابت ── */}
        <aside className="order-first flex min-h-0 w-full shrink-0 flex-col border-l border-white/5 bg-[#0b0e13] md:order-none md:w-[380px] lg:w-[420px]">
          <div className="flex-1 min-h-0">
            <NovaUnifiedChat
              title="نوفا — مركز التحكم"
              subtitle="عقل واحد · أدوات حقيقية · أدلة SHA-256"
              hideRail
            />
          </div>
        </aside>
      </main>

      {/* ── شريط سفلي: آخر حدث + حالة ── */}
      <footer className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-white/5 bg-[#0c0f14] px-3 font-mono text-[9px] text-zinc-600">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: topDot(vit.healthOk) }} />
          {vit.healthOk === true ? "live" : vit.healthOk == null ? "…" : "down"}
        </span>
        {ticker.map((ev, i) => (
          <span key={`${ev.ts}-${i}`} className="truncate text-zinc-500" dir="ltr">
            <span className="text-zinc-700">{fmtClock(ev.ts)}</span> {ev.type}
          </span>
        ))}
        {ticker.length === 0 && <span className="text-zinc-700">القناة هادية</span>}
        <span className="mr-auto shrink-0 text-zinc-700" dir="ltr"><MemoryStick className="mr-1 inline h-3 w-3" />console v4</span>
      </footer>
    </div>
  );
}
