import { useState, useEffect } from "react";
import { Activity, Cpu, HardDrive, Wifi, WifiOff, AlertTriangle, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/Layout";

/**
 * مراقبة النظام — نسخة مقاسة (فحص 2026-11-05).
 *
 * قبل الفحص كانت الصفحة دي بتولّد كل رقم فيها من دماغها كل ثانيتين:
 *   cpu/ram/disk = `15 + sin(t) * 10 + Math.random()*15`، والحرارة
 *   `40+random*25`، و«العمليات» عدد عشوائي، و«التهديدات» random(0..4)،
 *   وجدول عمليات مكتوب يدويًا (cybernova-api/1234، ollama/5678، nginx/7890).
 * يعني المستخدم كان بيشغّل الصفحة دي وبيقرأ «تهديدات: 3» من العدم.
 *
 * دلوقتي: اللي ليه مصدر حقيقي بيتقاس (`/api/system/metrics`,
 * `/api/processes`)، واللي مالوش مصدر مكتوب صراحة «لا مصدر مقاس» — من غير
 * ما نختلقه. والصفحة سايبنة، مش متشيلين حاجة.
 */

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };

/** `/api/system/metrics` */
interface ServerMetrics {
  cpu?: { usage?: number; cores?: number; model?: string; speed?: number };
  ram?: { total?: number; used?: number; free?: number; percent?: number };
  loadAvg?: number[];
  uptime?: number;
  platform?: string;
  hostname?: string;
}
/** `/api/processes` → ProcessRecord (سجل أوامر المنصة الحقيقية) */
interface ProcRec {
  id: string;
  command: string;
  pid: number | null;
  status: "running" | "exited" | "killed" | "error";
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

const UNMEASURED = "لا مصدر مقاس";

function metricColor(v: number, warn: number, crit: number) {
  if (v < warn) return "#44ff88";
  if (v < crit) return "#ffaa44";
  return "#ff4444";
}
function metricRgb(v: number, warn: number, crit: number) {
  if (v < warn) return "68,255,136";
  if (v < crit) return "255,170,68";
  return "255,68,68";
}
// الحقول دي من السيرفر بـ MB (os.totalmem/1024/1024) — مش bytes
const fmtMB = (mb?: number) =>
  Number.isFinite(mb ?? NaN) ? (mb as number) >= 1024 ? `${((mb as number) / 1024).toFixed(1)} GB` : `${Math.round(mb as number)} MB` : UNMEASURED;
function fmtUptimeSec(sec?: number) {
  if (!Number.isFinite(sec ?? NaN)) return UNMEASURED;
  const s = Math.floor(sec as number), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  return `${m}m ${s % 60}s`;
}
const elapsed = (since: number) => fmtUptimeSec((Date.now() - since) / 1000);

export default function SystemMonitor() {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [procs, setProcs] = useState<ProcRec[]>([]);
  const [rtt, setRtt] = useState<number | null>(null);
  const [reachable, setReachable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    let cancelled = false;
    const update = async () => {
      const t0 = Date.now();
      try {
        const r = await fetch("/api/system/metrics", { signal: AbortSignal.timeout(6000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as ServerMetrics;
        if (cancelled) return;
        setMetrics(d);
        setRtt(Date.now() - t0);
        setReachable(true);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setReachable(false);
        setRtt(null);
        setError(e instanceof Error ? e.message : String(e));
      }
      try {
        const rp = await fetch("/api/processes", { signal: AbortSignal.timeout(6000) });
        const dp = rp.ok ? (await rp.json()) : [];
        if (!cancelled && Array.isArray(dp)) setProcs(dp as ProcRec[]);
      } catch {
        if (!cancelled) setProcs([]);
      }
    };
    update();
    const interval = setInterval(update, 5000);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { clearInterval(interval); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  const cpu = metrics?.cpu ?? {};
  const ram = metrics?.ram ?? {};
  const running = procs.filter((p) => p.status === "running").length;

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ مراقبة النظام" subtitle="كل رقم هنا مقاس من السيرفر · اللي مالوش مصدر مكتوب كده" icon={Activity} danger />

      {!reachable && (
        <div className="rounded-xl px-4 py-3 text-[11px] font-mono" style={{ background: "rgba(255,170,68,0.08)", border: "1px solid rgba(255,170,68,0.3)", color: "#ffaa44" }}>
          مفيش رد من /api/system/metrics{error ? ` — ${error}` : ""}. الأرقام تحت مش هتتعرض؛ مش هنلفّقها لحد ما السيرفر يرد.
        </div>
      )}

      {/* Main Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            icon: Cpu, label: "المعالج",
            mainVal: reachable && Number.isFinite(cpu.usage ?? NaN) ? `${(cpu.usage ?? 0).toFixed(0)}%` : UNMEASURED,
            sub: [
              `النوى: ${cpu.cores ?? UNMEASURED}`,
              `الحرارة: ${UNMEASURED}`,
              `حمل النظام: ${metrics?.loadAvg?.length ? metrics.loadAvg.map((n) => n.toFixed(2)).join(" / ") : UNMEASURED}`,
            ],
            pct: reachable ? cpu.usage ?? 0 : 0, warn: 50, crit: 80,
          },
          {
            icon: TrendingUp, label: "الذاكرة",
            mainVal: reachable && Number.isFinite(ram.percent ?? NaN) ? `${(ram.percent ?? 0).toFixed(0)}%` : UNMEASURED,
            sub: [`المستخدم: ${fmtMB(ram.used)}`, `الإجمالي: ${fmtMB(ram.total)}`, `الفارغ: ${fmtMB(ram.free)}`],
            pct: reachable ? ram.percent ?? 0 : 0, warn: 60, crit: 85,
          },
          {
            icon: isOnline ? Wifi : WifiOff, label: "الشبكة",
            mainVal: isOnline ? (reachable ? "ONLINE" : "محلّي بس") : "OFFLINE",
            sub: [
              `زمن استجابة السيرفر: ${rtt !== null ? `${rtt}ms` : UNMEASURED}`,
              `↓ ${UNMEASURED} · ↑ ${UNMEASURED}`,
              `الهوست: ${metrics?.hostname ?? UNMEASURED}`,
            ],
            pct: isOnline ? 100 : 0, warn: 50, crit: 90,
          },
        ].map(({ icon: Icon, label, mainVal, sub, pct, warn, crit }) => {
          const color = label === "الشبكة" ? (isOnline ? "#44ff88" : "#ff4444") : metricColor(pct, warn, crit);
          const rgb = label === "الشبكة" ? (isOnline ? "68,255,136" : "255,68,68") : metricRgb(pct, warn, crit);
          return (
            <div key={label} className="rounded-2xl p-5 space-y-3" style={{ ...NEON_CARD, border: `1px solid rgba(${rgb},0.18)` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color }} />
                  <span className="text-sm font-black" style={{ color: "rgba(255,255,255,0.7)" }}>{label}</span>
                </div>
                <span className="text-2xl font-black font-mono" style={{ color: mainVal === UNMEASURED ? "rgba(255,255,255,0.35)" : color, textShadow: `0 0 12px rgba(${rgb},0.5)`, fontSize: mainVal === UNMEASURED ? 11 : undefined }}>{mainVal}</span>
              </div>
              <div className="space-y-1">
                {sub.map(s => <div key={s} className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{s}</div>)}
              </div>
              {label !== "الشبكة" && (
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color, boxShadow: `0 0 6px rgba(${rgb},0.6)` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: HardDrive, label: "القرص", value: UNMEASURED, sub: "مفيش /system/disk في السيرفر", color: "#4488ff", rgb: "68,136,255" },
          { icon: Activity, label: "أوامر المنصة", value: String(procs.length), sub: `نشطة: ${running}`, color: "#44eebb", rgb: "68,238,187" },
          { icon: AlertTriangle, label: "التهديدات", value: UNMEASURED, sub: "مفيش محرك كشف شغّل مسح بعد", color: "#ffaa44", rgb: "255,170,68" },
          { icon: TrendingUp, label: "وقت التشغيل", value: fmtUptimeSec(metrics?.uptime), sub: "من /api/system/metrics", color: "#aa44ff", rgb: "170,68,255" },
        ].map(({ icon: Icon, label, value, sub, color, rgb }) => (
          <div key={label} className="rounded-xl p-4" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className="w-3.5 h-3.5" style={{ color }} />
              <span className="text-[9px] font-black font-mono uppercase" style={{ color: `rgba(${rgb},0.5)` }}>{label}</span>
            </div>
            <div className="text-xl font-black font-mono" style={{ color: value === UNMEASURED ? "rgba(255,255,255,0.3)" : color, textShadow: `0 0 10px rgba(${rgb},0.4)`, fontSize: value === UNMEASURED ? 11 : undefined }}>{value}</div>
            <div className="text-[9px] font-mono mt-0.5" style={{ color: `rgba(${rgb},0.4)` }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Process List — سجل أوامر المنصة الحقيقي (ProcessRecord) */}
      <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
        <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <Activity className="w-4 h-4" style={{ color: "#ff5555" }} />
          <h3 className="text-sm font-black" style={{ color: "#ff5555" }}>أوامر المنصة الجارية</h3>
          <span className="ms-auto text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
            /api/processes · كل 5 ثوانٍ {reachable ? "" : "· السيرفر مش وارد"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                {["PID", "الأمر", "مدة التشغيل", "الحالة", "خرج"].map(h => (
                  <th key={h} className="px-4 py-3 text-right" style={{ color: "rgba(255,255,255,0.3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {procs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                    مفيش أمر شغال. الجدول ده مبيتملاش بعمليات مختلقة — لو عايز تشغّل حاجة، من محطة العمليات.
                  </td>
                </tr>
              )}
              {procs.map((p) => {
                const statusColor = p.status === "running" ? "#44ff88" : p.status === "error" ? "#ff4444" : "#ffaa44";
                return (
                  <tr key={p.id} className="transition-all" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{p.pid ?? "—"}</td>
                    <td className="px-4 py-2.5 font-black max-w-[28rem] truncate" style={{ color: "rgba(255,255,255,0.75)" }} title={p.command}>{p.command}</td>
                    <td className="px-4 py-2.5" style={{ color: "rgba(255,255,255,0.5)" }}>{elapsed(p.startedAt)}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black"
                        style={{ color: statusColor, background: `${statusColor}12`, border: `1px solid ${statusColor}28` }}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "rgba(255,255,255,0.5)" }}>{p.exitCode === null ? "لسه" : p.exitCode}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
