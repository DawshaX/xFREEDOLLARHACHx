import { useEffect, useState } from "react";
import {
  Cpu, Wifi, HardDrive, Activity, Zap, Globe, Server, Terminal, Package,
} from "lucide-react";

/**
 * مراقبة النظام المباشرة — نسخة مقاسة.
 *
 * التاريخ التصحيحي (فحص 2026-11-05): الكومبوننت ده كان بيطلب
 * `/api/system/info` و`/api/system/kill` — والمسارين دول **مفيش أصلاً** في
 * السيرفر (system.ts فيه `/system/metrics` و`/system/run` بس). النتيجة كانت
 * اثنتين 404 كل ثانية للأبد + سكرينة «جاري التحميل…» ما بتخلصش. والأسوأ: فرع
 * النجاح كان يلفّق حرارة القرص والشبكة والعمليات بـ`Math.random()` (تعليق
 * الكود نفسه كان بيقول `// Mock temperature`) وبيعرض جدول عمليات Windows
 * مختلق (`chrome.exe`, `node.exe`, …) باسـ PID عشوائي.
 *
 * دلوقتي: كل رقم معروض إما مقاس من السيرفر أو مكتوب صراحة «لا مصدر مقاس»،
 * والجدول ده بقى يعرض الأوامر الحقيقية اللي شغالة فعلاً (ProcessRecord) بدل
 * جدول OS ملفّق. مفيش حاجة اتلغت — البطاقات سايبنة مكانها وبتقول الحقيقة.
 */

/** `/api/system/metrics` — os.totalmem/cpus/uptime/loadavg (MB في الذاكرة) */
interface ServerMetrics {
  cpu?: { usage?: number; cores?: number; model?: string; speed?: number };
  ram?: { total?: number; used?: number; free?: number; percent?: number };
  loadAvg?: number[];
  uptime?: number;
  platform?: string;
  hostname?: string;
  disk?: { present?: boolean; totalMb?: number; freeMb?: number; usedMb?: number; usedPct?: number; noteAr?: string };
  timestamp?: string;
}
/** `/api/network/interfaces` */
interface Iface {
  name: string;
  addresses: string[];
  mac: string | null;
  isUp: boolean;
}
/** `/api/processes` — سجل الأوامر الحقيقية اللي شغلتها المنصة */
interface ProcRec {
  id: string;
  command: string;
  cwd?: string;
  pid: number | null;
  status: "running" | "exited" | "killed" | "error";
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

type Source = "live" | "unreachable";

const fmtUptime = (sec?: number): string => {
  if (!Number.isFinite(sec ?? NaN)) return "غير مقاس";
  const s = Math.max(0, Math.floor(sec as number));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}ي ${h}س ${m}د` : h > 0 ? `${h}س ${m}د` : `${m}د`;
};
const mb = (n?: number): string =>
  Number.isFinite(n ?? NaN) ? `${(n as number) >= 1024 ? ((n as number) / 1024).toFixed(1) + " GB" : Math.round(n as number) + " MB"}` : "غير مقاس";

/** خانة مش مقاسة: بتقول كده صراحة بدل ما ترمي رقم عشوائي */
function Unmeasured({ why }: { why: string }) {
  return (
    <span
      title={`مفيش مصدر في السيرفر بيقيس ده: ${why}`}
      className="font-mono text-[11px] text-muted-foreground/80"
    >
      لا مصدر مقاس
    </span>
  );
}

export function RealTimeSystemMonitor() {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [ifaces, setIfaces] = useState<Iface[]>([]);
  const [procs, setProcs] = useState<ProcRec[]>([]);
  const [source, setSource] = useState<Source>("unreachable");
  const [error, setError] = useState<string | null>(null);
  const [refreshRate, setRefreshRate] = useState(5000);
  const [isExpanded, setIsExpanded] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const grab = async <T,>(path: string): Promise<T | null> => {
      try {
        const r = await fetch(path, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return null;
        return (await r.json()) as T;
      } catch {
        return null;
      }
    };
    const tick = async () => {
      const [m, n, p] = await Promise.all([
        grab<ServerMetrics>("/api/system/metrics"),
        grab<Iface[]>("/api/network/interfaces"),
        grab<ProcRec[]>("/api/processes"),
      ]);
      if (cancelled) return;
      setCheckedAt(Date.now());
      if (m) {
        setMetrics(m);
        setSource("live");
        setError(null);
      } else {
        setSource("unreachable");
        setError("مفيش رد من /api/system/metrics — الأرقام دي مش هتتعرض لحد ما المصدر يرد.");
      }
      if (n) setIfaces(Array.isArray(n) ? n : []);
      if (p) setProcs(Array.isArray(p) ? p : []);
    };
    void tick();
    const id = setInterval(tick, Math.max(2000, refreshRate));
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshRate]);

  const kill = async (id: string) => {
    try {
      const r = await fetch(`/api/processes/${encodeURIComponent(id)}/kill`, { method: "POST" });
      // مافيش تحديث وهمي لو فشل — المستخدم يشوف الرد الحقيقي
      if (!r.ok) setError(`القتل اترفض: HTTP ${r.status}`);
    } catch (e) {
      setError(`القتل فشل: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const live = source === "live" && !!metrics;
  const cpu: NonNullable<ServerMetrics["cpu"]> = metrics?.cpu ?? {};
  const ram: NonNullable<ServerMetrics["ram"]> = metrics?.ram ?? {};

  if (!checkedAt) {
    return (
      <div className="p-4 text-center">
        <Terminal className="w-8 h-8 mx-auto mb-2 text-muted-foreground animate-pulse" />
        <div className="text-sm text-muted-foreground">أول قراءة من السيرفر…</div>
      </div>
    );
  }

  return (
    <div className="bg-card/50 backdrop-blur-xl border border-primary/20 rounded-lg p-4 space-y-4">
      {/* Header — حالة المصدر ظاهرة، مش مستخبية ورا سبينر */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">مراقبة النظام المباشر</h3>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono ${
              live ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
            }`}
            title={live ? "مقاس من /api/system/metrics + /api/network/interfaces + /api/processes" : (error ?? "المصدر مش بيرد")}
          >
            {live ? "مقاس" : "مش مقاس"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={refreshRate}
            onChange={(e) => setRefreshRate(Number(e.target.value))}
            className="bg-background/60 border border-border/60 rounded px-2 py-1 text-xs font-mono text-foreground"
          >
            <option value={2000}>2 ثانية</option>
            <option value={5000}>5 ثواني</option>
            <option value={15000}>15 ثانية</option>
            <option value={60000}>دقيقة</option>
          </select>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-primary/10 transition-colors"
            title="تفاصيلواجهات الشبكة والأوامر الجارية"
          >
            <Activity className="w-4 h-4 text-primary" />
          </button>
        </div>
      </div>

      {!live && (
        <div className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/30 rounded p-2">
          {error ?? "مفيش قراية من السيرفر."} لو السيرفر مش شغال على نفس الأصل، البطاقات دي
          هتفضل «لا مصدر مقاس» — مش هنعوّضها بأرقام من عندنا.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* المعالج */}
        <div className="bg-gradient-to-br from-blue-500/10 to-indigo-600/10 border border-blue-400/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-foreground">المعالج</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الاستخدام:</span>
              {live && Number.isFinite(cpu.usage ?? NaN) ? (
                <span className={`font-mono ${(cpu.usage ?? 0) > 80 ? "text-red-400" : (cpu.usage ?? 0) > 50 ? "text-yellow-400" : "text-green-400"}`}>
                  {(cpu.usage ?? 0).toFixed(0)}%
                </span>
              ) : (
                <Unmeasured why="os.cpus() بياخد عينة لحظية" />
              )}
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">النوى:</span>
              <span className="font-mono text-foreground">{cpu.cores ?? "غير مقاس"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">حمل النظام:</span>
              <span className="font-mono text-foreground">
                {metrics?.loadAvg?.length ? metrics.loadAvg.map((n) => n.toFixed(2)).join(" / ") : "غير مقاس"}
              </span>
            </div>
            <div className="flex justify-between text-xs" title="قياس حرارة الـCPU محتاج /sys/class/thermal على الهوست — السيرفر مش بيطلعها">
              <span className="text-muted-foreground">الحرارة:</span>
              <Unmeasured why="mmap /sys/class/thermal مش متاح من المتصفح" />
            </div>
          </div>
        </div>

        {/* الذاكرة */}
        <div className="bg-gradient-to-br from-emerald-500/10 to-teal-600/10 border border-emerald-400/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-foreground">الذاكرة</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">المستخدم:</span>
              <span className="font-mono text-foreground">{mb(ram.used)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الإجمالي:</span>
              <span className="font-mono text-foreground">{mb(ram.total)}</span>
            </div>
            <div className="w-full bg-background/40 rounded-full h-2 mt-2">
              <div
                className={`h-full rounded-full transition-all ${
                  (ram.percent ?? 0) > 80 ? "bg-red-500" : (ram.percent ?? 0) > 50 ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{ width: `${Math.max(0, Math.min(100, live ? ram.percent ?? 0 : 0))}%` }}
              />
            </div>
          </div>
        </div>

        {/* الشبكة */}
        <div className="bg-gradient-to-br from-green-500/10 to-emerald-600/10 border border-green-400/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Wifi className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold text-foreground">الشبكة</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">واجهات نشطة:</span>
              <span className="font-mono text-foreground">{ifaces.length ? `${ifaces.filter((i) => i.isUp).length}/${ifaces.length}` : "غير مقاس"}</span>
            </div>
            <div className="flex justify-between text-xs" title="عداد الاتصالات بياخد netstat على الهوست — مفيش endpoint ليه">
              <span className="text-muted-foreground">الاتصالات:</span>
              <Unmeasured why="مفيش /network/connections" />
            </div>
            <div className="flex justify-between text-xs" title="سعة التحميل/الرفع محتاجة اختبار فعلية (iperf) مش رقم ثابت">
              <span className="text-muted-foreground">العرض:</span>
              <Unmeasured why="مفيش قياس bandwidth" />
            </div>
          </div>
        </div>

        {/* القرص */}
        <div className="bg-gradient-to-br from-orange-500/10 to-amber-600/10 border border-orange-400/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-semibold text-foreground">القرص</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs" title={metrics?.disk?.noteAr ?? "statfs(/) مقاس مباشر من السيرفر"}>
              <span className="text-muted-foreground">المستخدم:</span>
              {metrics?.disk?.present ? (
                <span className="font-mono text-foreground" dir="ltr">{Math.round((metrics.disk.usedMb ?? 0) / 1024)} / {Math.round((metrics.disk.totalMb ?? 0) / 1024)} GB · {metrics.disk.usedPct}%</span>
              ) : (
                <Unmeasured why={metrics?.disk?.noteAr ?? "مفيش قياس"} />
              )}
            </div>
            <div className="flex justify-between text-xs" title="المساحة الفارغة المتبقية — العرض «بلا حد» يعني إني مش بقبّل حدًا معينًا، بس المستهلكة مقاسة بصراحة">
              <span className="text-muted-foreground">الفارغ:</span>
              {metrics?.disk?.present ? (
                <span className="font-mono text-emerald-300" dir="ltr">{Math.round((metrics.disk.freeMb ?? 0) / 1024)} GB</span>
              ) : (
                <Unmeasured why={metrics?.disk?.noteAr ?? "مفيش قياس"} />
              )}
            </div>
            {metrics?.disk?.present && (
              <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${((metrics.disk.usedPct ?? 0) > 85) ? "bg-rose-500" : ((metrics.disk.usedPct ?? 0) > 65) ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(100, metrics.disk.usedPct ?? 0)}%` }}
                />
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الهوست:</span>
              <span className="font-mono text-foreground truncate max-w-[9rem]" title={metrics?.hostname ?? ""}>
                {metrics?.hostname ?? "غير مقاس"}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الـuptime:</span>
              <span className="font-mono text-foreground">{fmtUptime(metrics?.uptime)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* التفاصيل */}
      {isExpanded && (
        <div className="space-y-4 border-t border-primary/20 pt-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              واجهات الشبكة (os.networkInterfaces)
            </h4>
            {ifaces.length === 0 ? (
              <div className="text-xs text-muted-foreground">مفيش قراية من /api/network/interfaces.</div>
            ) : (
              <div className="space-y-2">
                {ifaces.map((iface, index) => (
                  <div key={`${iface.name}-${index}`} className="bg-background/40 rounded p-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">الاسم:</span>
                      <span className="font-mono text-foreground">{iface.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">العناوين:</span>
                      <span className="font-mono text-foreground text-left">{iface.addresses.slice(0, 3).join("، ") || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">الـ MAC:</span>
                      <span className="font-mono text-foreground">{iface.mac || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">الحالة:</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-mono ${iface.isUp ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {iface.isUp ? "نشطة" : "معطلة"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              الأوامر الجارية على المنصة ({procs.length})
            </h4>
            {procs.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                مفيش أمر شغال حالياً. (الجدول ده سجل أوامر المنصة نفسها — مش جدول عمليات الـOS،
                ومفيش مصدر بيدينا دول، فمش هنختلقهم.)
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-auto">
                {procs.slice(0, 20).map((p) => (
                  <div key={p.id} className="bg-background/40 rounded p-2 text-xs flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-foreground truncate" title={p.command}>{p.command}</div>
                      <div className="text-muted-foreground">
                        pid {p.pid ?? "—"} · {new Date(p.startedAt).toLocaleTimeString("ar-EG")} ·
                        خرج {p.exitCode === null ? "لسه" : p.exitCode}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono shrink-0 ${
                      p.status === "running" ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
                    }`}>
                      {p.status === "running" ? "شغال" : p.status === "killed" ? "مقتول" : p.status === "error" ? "غلط" : "خلص"}
                    </span>
                    {p.status === "running" && (
                      <button
                        onClick={() => void kill(p.id)}
                        className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-mono hover:bg-red-500/30 shrink-0"
                        title="POST /api/processes/:id/kill"
                      >
                        إنهاء
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {live && metrics ? `نظام: ${metrics.platform ?? "؟"} · آخر قراية ${checkedAt ? new Date(checkedAt).toLocaleTimeString("ar-EG") : "—"}` : "مفيش مصدر"}
            </span>
            <span className="font-mono">المصادر: /api/system/metrics · /api/network/interfaces · /api/processes</span>
          </div>
        </div>
      )}
    </div>
  );
}
