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

export default function SelfCheckPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [base, setBase] = useState<string>("");

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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(false);
  }, [run]);

  const overall: Status = !report ? "fail" : report.ok ? (report.score === 100 ? "ok" : "warn") : "fail";

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
          {report?.checkedAt && (
            <span className="rounded-lg bg-white/5 px-2 py-1">
              آخر فحص: {new Date(report.checkedAt).toLocaleTimeString("ar-EG")} · من {report.total} فحص ·{" "}
              {report.passed} ناجح
            </span>
          )}
        </div>
      </header>

      {/* ── verdict ────────────────────────────────────────────────────── */}
      {loading && !report && (
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

      {report && (
        <div
          className={`rounded-2xl border p-5 ${STYLES[overall].ring} ${STYLES[overall].bg}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`text-base font-semibold ${STYLES[overall].text}`}>{report.verdict}</p>
            <span className={`rounded-xl bg-black/40 px-3 py-1 text-sm font-bold ${STYLES[overall].text}`}>
              {report.passed}/{report.total} · {report.score}%
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/40">
            <div
              className={`h-full rounded-full transition-all ${
                report.ok ? "bg-emerald-400" : "bg-amber-400"
              }`}
              style={{ width: `${report.score}%` }}
            />
          </div>
        </div>
      )}

      {/* ── items ──────────────────────────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        {report?.items.map((item) => {
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
