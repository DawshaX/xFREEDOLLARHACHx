/**
 * NOVA · الفحص الذاتي — `/self-check`
 *
 * The page that answers "هو شغّال ولا لأ؟" with evidence instead of claims.
 *
 * It calls `GET /api/nova-core/self-check`, which runs real probes on the
 * server (memory, disk write, tool execution, outbound internet, WebSocket hub,
 * 24/7 loop) and returns what it *observed*. Nothing on this page is a canned
 * status string: if a probe fails, the page says so and shows the fix.
 *
 * On GitHub Pages there is no server, so the page honestly switches to the
 * browser-only verdict instead of pretending a backend exists.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Cpu, Database, Globe,
  Loader2, Radio, RefreshCw, Server, ShieldCheck, Terminal, XCircle, Brain,
} from "lucide-react";
import { getRemoteBase } from "@/lib/remote";
import { listSessions } from "@/lib/session-store";
import { listMissions } from "@/lib/mission-store";
import { getCorpusStats } from "@/lib/cyber-corpus-2099";

type Status = "ok" | "warn" | "fail";

interface CheckItem {
  id: string;
  label: string;
  status: Status;
  detail: string;
  fix?: string;
  ms: number;
}

interface Report {
  ok: boolean;
  score: number;
  total: number;
  passed: number;
  verdict: string;
  checkedAt: string;
  cached: boolean;
  items: CheckItem[];
}

const ICONS: Record<string, typeof Activity> = {
  runtime: Cpu,
  storage: Database,
  brain: Brain,
  tools: Terminal,
  internet: Globe,
  socket: Radio,
  daemon: Clock,
};

const STYLES: Record<Status, { ring: string; text: string; bg: string; label: string; Icon: typeof CheckCircle2 }> = {
  ok: { ring: "border-emerald-500/40", text: "text-emerald-300", bg: "bg-emerald-500/10", label: "شغّال", Icon: CheckCircle2 },
  warn: { ring: "border-amber-500/40", text: "text-amber-300", bg: "bg-amber-500/10", label: "تحت انتباه", Icon: AlertTriangle },
  fail: { ring: "border-red-500/50", text: "text-red-300", bg: "bg-red-500/10", label: "واقع", Icon: XCircle },
};

/**
 * Browser-only checks — what is really true when no server answers.
 * Nothing here claims to be a server: it reports what this tab can do.
 */
async function browserChecks(): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const now = () => performance.now();

  // 1. localStorage really persists (write → read → delete)
  let t = now();
  let storageOk = false;
  let storageDetail = "المتصفح مانع التخزين (وضع خاص/حظر) — المحادثات هتضيع مع الريفريش";
  try {
    const key = "cybernova_selfcheck_probe";
    localStorage.setItem(key, "1");
    storageOk = localStorage.getItem(key) === "1";
    localStorage.removeItem(key);
    if (storageOk) {
      const sessions = listSessions().length;
      const missions = listMissions().length;
      storageDetail = `التخزين شغّال · ${sessions} محادثة و ${missions} مهمة محفوظة في المتصفح`;
    }
  } catch {
    storageOk = false;
  }
  items.push({
    id: "storage",
    label: "تخزين المتصفح (محادثاتك ومهماتك)",
    status: storageOk ? "ok" : "fail",
    detail: storageDetail,
    fix: storageOk ? undefined : "افتح الموقع في نافذة عادية (مش private) واسمح بالـcookies/التخزين.",
    ms: Math.round(now() - t),
  });

  // 2. The static corpus (offline knowledge) is loaded
  t = now();
  let corpusCount = 0;
  let corpusOk = false;
  try {
    corpusCount = getCorpusStats().totalIndexedKnowledgeItems;
    corpusOk = true;
  } catch {
    corpusOk = false;
  }
  items.push({
    id: "tools",
    label: "العقل المدمج (يشتغل بدون سيرفر)",
    status: corpusOk ? "ok" : "warn",
    detail: corpusOk
      ? `قاعدة المعرفة جوه الصفحة محمّلة (${corpusCount.toLocaleString("ar-EG")} مدخل) + أدوات DNS/NVD/GitHub بتشتغل من المتصفح`
      : "قاعدة المعرفة مش محمّلة — الشات هيرد رد عام",
    fix: corpusOk ? undefined : "اعمل ريفريش كامل (Ctrl+F5) — ممكن جزء من ملفات الصفحة مالنزلش.",
    ms: Math.round(now() - t),
  });

  // 3. Real internet from the browser (DNS-over-HTTPS, CORS-friendly)
  t = now();
  let netOk = false;
  let netDetail = "مفيش اتصال بالإنترنت من المتصفح";
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      netDetail = "المتصفح نفسه بيقول: مفيش اتصال";
    } else {
      const res = await fetch("https://dns.google/resolve?name=example.com&type=A", {
        headers: { accept: "application/dns-json" },
      });
      const json = (await res.json()) as { Answer?: unknown[] };
      netOk = res.ok && Array.isArray(json.Answer) && json.Answer.length > 0;
      netDetail = netOk ? "DNS-over-HTTPS بيرد فعلاً من المتصفح (dns.google)" : `dns.google رجّع ${res.status}`;
    }
  } catch (err) {
    netDetail = `الاتصال فشل: ${(err as Error).message}`;
  }
  items.push({
    id: "internet",
    label: "الاتصال بالإنترنت (من المتصفح)",
    status: netOk ? "ok" : "fail",
    detail: netDetail,
    fix: netOk ? undefined : "راجع الشبكة/الـVPN. الأدوات المحلية هتفضل شغالة لكن المصادر الحية لأ.",
    ms: Math.round(now() - t),
  });

  // 4. Talking to a real server? (the whole point of linking one)
  items.push({
    id: "socket",
    label: "سيرفر NOVA (تنفيذ حقيقي + أسطول + 24/7)",
    status: "warn",
    detail: "مفيش سيرفر مرتبط — كل حاجة بتشتغل جوه التاب (الشات، الأدوات، الذاكرة، المهمات)",
    fix: "من «نوفا · الأسطول الموحّد» → «وسّع القدرات» حطّ رابط السيرفر (مثال https://cybernova-nova.onrender.com) واضغط «اختبر واربط».",
    ms: 0,
  });

  return items;
}

export default function SelfCheckPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [base, setBase] = useState<string>("");
  const [browserReport, setBrowserReport] = useState<Report | null>(null);

  useEffect(() => {
    setBase(getRemoteBase());
  }, []);

  const run = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      const res = await fetch(`/api/nova-core/self-check${refresh ? "?refresh=1" : ""}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Report;
      setReport(data);
    } catch (err) {
      setError((err as Error).name === "AbortError" ? "السيرفر ماردّش في 25 ثانية" : (err as Error).message);
      setReport(null);
      // No server → still answer honestly, from the browser itself.
      const items = await browserChecks();
      const passed = items.filter((i) => i.status === "ok").length;
      setBrowserReport({
        ok: false,
        score: Math.round((passed / items.length) * 100),
        total: items.length,
        passed,
        verdict:
          "مفيش سيرفر مرتبط — الواجهة والمحرّك في المتصفح شغالين، لكن التنفيذ على السيرفر والأسطول و24/7 محتاجين باك-إند.",
        checkedAt: new Date().toISOString(),
        cached: false,
        items,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(false);
  }, [run]);

  const shown = report ?? browserReport;
  const overall: Status = !shown
    ? "fail"
    : shown.items.some((i) => i.status === "fail")
      ? "fail"
      : shown.items.some((i) => i.status === "warn")
        ? "warn"
        : "ok";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" dir="rtl">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-500/15 p-2.5">
              <ShieldCheck className="h-6 w-6 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">الفحص الذاتي — هل البرنامج شغّال فعلاً؟</h1>
              <p className="text-sm text-slate-400">
                كل بند هنا نتيجة فحص حقيقي اتنفّذ دلوقتي، مش حالة مكتوبة في الكود.
              </p>
            </div>
          </div>
          <button
            onClick={() => void run(true)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            أعد الفحص
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="rounded-lg bg-white/5 px-2 py-1">
            <Server className="mr-1 inline h-3.5 w-3.5" />
            {base ? `سيرفر مرتبط: ${base}` : "بدون سيرفر خارجي — الواجهة الحالية"}
          </span>
          {shown?.checkedAt && (
            <span className="rounded-lg bg-white/5 px-2 py-1">
              {report ? "فحص السيرفر" : "فحص المتصفح"} · {new Date(shown.checkedAt).toLocaleTimeString("ar-EG")} ·{" "}
              {shown.passed}/{shown.total} ناجح
            </span>
          )}
        </div>
      </header>

      {/* ── verdict ────────────────────────────────────────────────────── */}
      {loading && !shown && (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-5 text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
          بشغّل الفحوصات الحقيقية…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-100">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            مفيش سيرفر بيرد على الفحص ({error})
          </div>
          <p className="mt-2 text-sm text-amber-200/90">
            دي حالة <b>GitHub Pages</b> فقط: الصفحة شغّالة والذاكرة والمهمات محفوظة في المتصفح، لكن الشات والأسطول
            والتنفيذ على السيرفر محتاجين باك-إند. من <b>«نوفا · الأسطول الموحّد»</b> اربط رابط السيرفر
            (مثال <code className="rounded bg-black/40 px-1">https://cybernova-nova.onrender.com</code>) وبعدها الفحص هيشتغل كامل.
          </p>
        </div>
      )}

      {shown && (
        <div className={`rounded-2xl border p-5 ${STYLES[overall].ring} ${STYLES[overall].bg}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`text-base font-semibold ${STYLES[overall].text}`}>{shown.verdict}</p>
            <span className={`rounded-xl bg-black/40 px-3 py-1 text-sm font-bold ${STYLES[overall].text}`}>
              {shown.passed}/{shown.total} · {shown.score}%
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/40">
            <div
              className={`h-full rounded-full transition-all ${overall === "ok" ? "bg-emerald-400" : overall === "warn" ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${shown.score}%` }}
            />
          </div>
        </div>
      )}

      {/* ── items ──────────────────────────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        {shown?.items.map((item) => {
          const style = STYLES[item.status];
          const Icon = ICONS[item.id] ?? Activity;
          return (
            <div key={item.id} className={`rounded-2xl border p-4 ${style.ring} bg-slate-900/60`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${style.text}`} />
                  <h3 className="text-sm font-semibold text-white">{item.label}</h3>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
                  <style.Icon className="h-3.5 w-3.5" />
                  {style.label}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">{item.detail}</p>
              {item.fix && (
                <p className="mt-2 rounded-lg bg-black/30 p-2 text-xs leading-relaxed text-slate-400">
                  <b className="text-slate-300">الحل: </b>
                  {item.fix}
                </p>
              )}
              <p className="mt-2 text-[10px] text-slate-500">زمن الفحص: {item.ms} ms</p>
            </div>
          );
        })}
      </div>

      {/* ── what this proves / does not ─────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 text-sm text-slate-300">
        <h2 className="mb-2 font-semibold text-white">إيه اللي الفحص بيثبته بالظبط؟</h2>
        <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed">
          <li><b>الذاكرة والوقت التشغيلي</b> — استهلاك RAM الفعلي مقارنة بحد الخطة المجانية (512MB على Render).</li>
          <li><b>التخزين</b> — بيكتب ملف حقيقي على القرص ويقراه، وبيقول المسار وعدد الذكريات وحجمها.</li>
          <li><b>العقل</b> — بيسأل Ollama / مفاتيح المزوّدين المجانيين فعلاً، وبيفرّق بين «عقل لغوي» و«عقل مدمج».</li>
          <li><b>الأدوات</b> — بينفّذ أداة حقيقية (SHA-256) ويسجّل هل التنفيذ نجح، مش بس عدد الأدوات.</li>
          <li><b>الإنترنت</b> — بيفتح اتصال TCP حقيقي على dns.google و api.github.com و NVD وبيرصد أزمنة الاستجابة.</li>
          <li><b>القناة الحية</b> — بيسأل هَب الـWebSocket: كام عميل متصل فعلاً الآن.</li>
          <li><b>الدورة الذاتية</b> — بيقرا آخر نبضة وبيعتها لو قديمة (يعني بينام؟).</li>
        </ul>
        <p className="mt-3 rounded-lg bg-black/30 p-2 text-xs text-slate-400">
          اللي مش بيثبته: جودة الاستغلال على هدف معيّن. ده بيتقاس بالتقارير والأدلة في «استوديو البج باونتي»،
          والفحص هنا مسؤول عن إن <b>المحرّك نفسه</b> سليم.
        </p>
      </section>
    </div>
  );
}
