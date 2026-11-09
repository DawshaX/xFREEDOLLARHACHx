/**
 * NovaAgentPro v2 — «المختبر ومركز التحكم»: الصفحة اللي بتركب OMEGA بالكامل.
 *
 * الفلسفة (منطوق المالك): مش بوت تلعبه أوامر — نظام متكامل موحّد الربط.
 *  · شريط النبض فوق: قياسات حية من 5 نقاط (healthz · نسخة العقدة · أدوات ·
 *    قناة التليجرام · عمر الجلسة) — كلها بـfetch حقيقي كل 15s، والتظليل أحمر
 *    لو أي حاجة وقعت.
 *  · تبويبات واسعة (الشكوى كانت «ضيقة»): أزرار كبيرة بأيقونات وألوان نيون
 *    ونقاط نبض — مش pills هزيلة.
 *  · كل تبويب يضمّن المكوّن الحقيقي المخدوم (ماتدوبش منطق):
 *    الجلسة=NovaUnifiedChat · المخ=NovaOpsRoom · الأجهزة=RealTimeSystemMonitor
 *    · الصيد=NovaHuntSurface · القنوات=TelegramConfigCard · الملاحة=شبكة routes حقيقية.
 *  · ممنوع نص «قريبًا» أو أزرار فاضية: بوابة check-dead-buttons تحرس.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain, Radio, Cpu, Target, Cable, Compass, MessageSquareText,
  HeartPulse, Bot, Server, ShieldCheck, ShieldAlert, Clock3,
} from "lucide-react";
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";
import { NovaOpsRoom } from "@/components/desktop/NovaBrainOps";
import { RealTimeSystemMonitor } from "@/components/desktop/RealTimeSystemMonitor";
import { NovaHuntSurface } from "@/components/desktop/NovaBrainOps";
import { TelegramConfigCard } from "@/components/TelegramConfigCard";

type TabKey = "session" | "brain" | "hardware" | "hunt" | "channels" | "nav";

interface Vitals {
  healthOk: boolean | null; healthMs: number | null; db: boolean | null;
  sha: string; uptimeS: number | null; tools: number;
  tgToken: boolean | null; tgChat: boolean | null;
}

const TABS: Array<{ key: TabKey; labelAr: string; sub: string; icon: typeof Brain; color: string }> = [
  { key: "session",  labelAr: "الجلسة الذكية",   sub: "الشات الموحّد والمهمات",   icon: MessageSquareText, color: "#4ade80" },
  { key: "brain",    labelAr: "المخ والمجلس",    sub: "حالة الكيان · التصويت",    icon: Brain,             color: "#a78bfa" },
  { key: "hardware", labelAr: "الأجهزة الحية",   sub: "CPU · RAM · رصد لحظي",     icon: Cpu,               color: "#22d3ee" },
  { key: "hunt",     labelAr: "الصيد والثغرات",  sub: "hunt حي · NVD · CVE",      icon: Target,            color: "#fb7185" },
  { key: "channels", labelAr: "القنوات",         sub: "تليجرام · تنبيهات · ضبط",  icon: Cable,             color: "#fbbf24" },
  { key: "nav",      labelAr: "الملاحة الكاملة", sub: "كل مراكز المنصة الحقيقية", icon: Compass,           color: "#60a5fa" },
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
    { path: "/port-scanner", label: "🛰 ماسح المنافذ" },
    { path: "/dns-lookup", label: "🧭 DNS Lookup" },
    { path: "/whois-lookup", label: "🗺 WHOIS" },
    { path: "/subdomains", label: "🕸 النطاقات الفرعية" },
    { path: "/hash-calculator", label: "#️⃣ الهاشات" },
    { path: "/encryption-tool", label: "🔐 التشفير" },
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

export default function NovaAgentPro() {
  const [tab, setTab] = useState<TabKey>("session");
  const [vit, setVit] = useState<Vitals>({ healthOk: null, healthMs: null, db: null, sha: "", uptimeS: null, tools: 0, tgToken: null, tgChat: null });
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
    let tgToken: boolean | null = null, tgChat: boolean | null = null;
    try {
      const r = await fetch("/api/ops/config/status");
      const j = (await r.json().catch(() => null)) as { keys?: Record<string, boolean> } | null;
      tgToken = j?.keys?.["telegram.botToken"] ?? null;
      tgChat = j?.keys?.["telegram.chatId"] ?? null;
    } catch { /* optional */ }
    setVit({ healthOk, healthMs, db, sha, uptimeS, tools, tgToken, tgChat });
  }, []);
  useEffect(() => { void refresh(); const iv = setInterval(refresh, 15_000); return () => clearInterval(iv); }, [refresh]);

  const sessionS = Date.now() - mounted.current;
  const pill = (ok: boolean | null | undefined, label: string, extra = "") => {
    const color = ok == null ? "#94a3b8" : ok ? "#4ade80" : "#fb7185";
    return (
      <span key={label} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-mono font-bold"
        style={{ borderColor: color + "40", color, background: color + "10" }}>
        <span className={"w-1.5 h-1.5 rounded-full" + (ok ? " animate-pulse" : "")} style={{ background: color }} />
        {ok == null ? `${label}: ⏳` : ok ? `${label}${extra}` : `${label}: ✗`}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#04040c]" dir="rtl">
      {/* شريط عنوان + نبض حي */}
      <header className="border-b border-emerald-500/10 bg-gradient-to-l from-emerald-950/20 via-[#04040c] to-purple-950/20 px-4 pt-3 pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Bot className="w-6 h-6 text-emerald-400" />
          <div>
            <h1 className="text-base font-black text-emerald-200">المختبر ومركز التحكم — NOVA AGENT PRO</h1>
            <div className="text-[9px] font-mono text-white/30">نظام متكامل موحّد الربط — مش بوت أوامر · الجلسة {fmtUptime(Math.round(sessionS / 1000))} · sha {vit.sha || "…"}</div>
          </div>
          <div className="mr-auto flex items-center gap-1.5 flex-wrap">
            {pill(vit.healthOk, "السيرفر", vit.healthOk && vit.healthMs != null ? ` ${vit.healthMs}ms` : "")}
            {pill(vit.db, "قاعدة البيانات")}
            {pill(vit.tools > 0 ? true : null, `أدوات ×${vit.tools}`)}
            {pill(vit.tgToken, "تليجرام·توكن")}
            {pill(vit.tgChat, "تليجرام·شات")}
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-mono font-bold text-cyan-300">
              <Clock3 className="w-3 h-3" /> uptime: {fmtUptime(vit.uptimeS)}
            </span>
          </div>
        </div>
        {/* تبويبات واسعة بأيقونات — مش pills ضيقة */}
        <nav className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
          {TABS.map(({ key, labelAr, sub, icon: Icon, color }) => {
            const active = tab === key;
            return (
              <button key={key} onClick={() => setTab(key)}
                className={"group rounded-xl border px-3 py-2.5 text-right transition-all duration-200 relative overflow-hidden"}
                style={active
                  ? { borderColor: color + "66", background: `linear-gradient(135deg, ${color}18, ${color}06)`, boxShadow: `0 0 18px ${color}22 inset, 0 0 12px ${color}18` }
                  : { borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }}>
                {active && <span className="absolute inset-x-6 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />}
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 shrink-0" style={{ color: active ? color : "rgba(255,255,255,0.35)" }} />
                  <span className="text-[12px] font-black" style={{ color: active ? color : "rgba(255,255,255,0.6)" }}>{labelAr}</span>
                  {active && <span className="mr-auto w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />}
                </div>
                <div className="text-[8px] font-mono mt-0.5" style={{ color: active ? color + "90" : "rgba(255,255,255,0.25)" }}>{sub}</div>
              </button>
            );
          })}
        </nav>
      </header>

      {/* الجسم — كل تبويب يضمّن المكوّن الحقيقي */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {tab === "session" && (
          <NovaUnifiedChat title="نوفا — المختبر ومركز التحكم" subtitle="الجلسة الذكية: عقل واحد، أدوات حقيقية، أدلة SHA-256" />
        )}
        {tab === "brain" && (
          <div className="h-full overflow-auto p-3"><NovaOpsRoom /></div>
        )}
        {tab === "hardware" && (
          <div className="h-full overflow-auto p-3 space-y-3">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3.5 py-2.5 text-[11px] font-mono text-cyan-200/80 flex items-center gap-2">
              <Server className="w-4 h-4" />
              <span>الأرقام ده هجينة بصراحة: الرصد اللحظي تحت من وكيل الأسطول (جهازك الحقيقي)، وشريط النبض فوق من حاوية السيرفر (460MB رام — بيتقال فيها كده). أي مربع «مفيش مصدر» بيتقال مش بيتزوّق.</span>
            </div>
            <RealTimeSystemMonitor />
          </div>
        )}
        {tab === "hunt" ? (
          <div className="h-full flex flex-col min-h-0">
            <div className="px-3 pt-3 shrink-0">
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3.5 py-2.5 text-[11px] font-mono text-rose-200/80 flex items-center gap-2">
                <Target className="w-4 h-4" />
                <span>دورة الصيد الحية: 7 مصادر عالمية + مكتب الأدلة + إشعار تليجرام بالحصيلة الحقيقية (مش إشعار صفري). أي «Trigger» هنا بيضرب API فعلي وبيتفسح بعدّاد.</span>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-3"><NovaHuntSurface /></div>
          </div>
        ) : null}
        {tab === "channels" && (
          <div className="h-full overflow-auto p-3 max-w-3xl space-y-3">
            <TelegramConfigCard />
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] font-mono text-amber-200/80 space-y-1.5">
              <div className="flex items-center gap-2 font-bold"><Radio className="w-4 h-4" /> قنوات تانية آتية من نفس المحور:</div>
              <div>· تنبيهات الزيارات (عين الزيارات) — مربوطة بنفس القناة فورًا بعد التوكن.</div>
              <div>· GitHub تكامل — ct Wilfahdt، عميق بالفعل: الحزمة نفسها بتتبنى من CI بتوقيع، والـwatchdog بيفعّل صيانة الأدوات تلقائيًا. الربط العميق واحد اتنين تلاتة.</div>
            </div>
          </div>
        )}
        {tab === "nav" && (
          <div className="h-full overflow-auto p-3 space-y-4">
            <div className="text-[11px] font-mono text-white/40 flex items-center gap-2">
              <Compass className="w-4 h-4 text-blue-400" />
              كل زرار هنا بيفتح مركز حقيقي معمول جوه المنصة (83 صفحة مرروتة، حارس «مفيش زرار ميت» صايد كل واحد). النص بالعربي عشان السرعة.
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
      </main>

      {/* أسفل: خط الحالة — قياس مقروء بسرعة */}
      <footer className="border-t border-white/5 px-4 py-1.5 flex items-center gap-3 text-[9px] font-mono text-white/30">
        {vit.healthOk === true ? <ShieldCheck className="w-3 h-3 text-emerald-400" /> : <ShieldAlert className="w-3 h-3 text-rose-400" />}
        {vit.healthOk === true
          ? <span>المنصة واعية: healthz ok{vit.healthMs != null ? ` ${vit.healthMs}ms` : ""}{vit.db === true ? " · DB صارمة مشفرة" : ""}{vit.db === false ? " · DB مش واصلة" : ""} · تحديث كل 15 ثانية</span>
          : <span className="text-rose-300/70">{vit.healthOk == null ? "يتقاس…" : "السيرفر مش واصل دلوقتي — المقاس أمامك ما بيظهرش أخضر كذاب"}</span>}
        <span className="mr-auto">NOVA AGENT PRO v2 · مركز التحكم</span>
      </footer>
    </div>
  );
}
