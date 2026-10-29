import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";

const API_BASE = "/api";

interface ProviderHealth {
  id: string;
  family: "anthropic" | "openai" | "gemini" | "ollama";
  source: "replit" | "user" | "local";
  available: boolean;
  enabled: boolean;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  lastCheckedAt: string;
}

interface BotStatus {
  status: string;
  availableTools: number;
  cronJobs: { total: number; enabled: number };
  alerts: { unread: number; total?: number };
  memory?: { total?: number };
}

interface WatchdogStatus {
  lastRun: string | null;
  health: ProviderHealth[];
  healthyCount: number;
  totalAvailable: number;
}

const FAMILY_LABEL: Record<ProviderHealth["family"], string> = {
  anthropic: "Claude",
  openai: "GPT",
  gemini: "Gemini",
  ollama: "Ollama",
};
const FAMILY_HUE: Record<ProviderHealth["family"], string> = {
  anthropic: "from-orange-400/30 to-amber-600/10 border-orange-400/40 text-orange-200",
  openai: "from-emerald-400/30 to-emerald-600/10 border-emerald-400/40 text-emerald-200",
  gemini: "from-sky-400/30 to-blue-600/10 border-sky-400/40 text-sky-200",
  ollama: "from-violet-400/30 to-purple-600/10 border-violet-400/40 text-violet-200",
};

export function BotHealthBar({
  onOpenAgent,
  onOpenSettings,
}: {
  onOpenAgent?: () => void;
  onOpenSettings?: () => void;
}) {
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [wd, setWd] = useState<WatchdogStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<number>(Date.now());

  const refresh = async () => {
    try {
      const [b, w] = await Promise.all([
        fetch(`${API_BASE}/bot/status`).then((r) => r.json()).catch(() => null),
        fetch(`${API_BASE}/providers/watchdog/status`).then((r) => r.json()).catch(() => null),
      ]);
      if (b) setBot(b as BotStatus);
      if (w) setWd(w as WatchdogStatus);
      setLastTickAt(Date.now());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, []);

  const runProbe = async () => {
    setProbing(true);
    try {
      const r = await fetch(`${API_BASE}/providers/watchdog/run`, { method: "POST" });
      const data = await r.json();
      setWd({
        lastRun: data.finishedAt,
        health: data.health || [],
        healthyCount: data.healthyCount || 0,
        totalAvailable: data.totalAvailable || 0,
      });
    } catch {
      // ignore
    } finally {
      setProbing(false);
      void refresh();
    }
  };

  const totalHealthy = wd?.healthyCount ?? 0;
  const totalAvailable = wd?.totalAvailable ?? 0;
  const allDown = totalAvailable > 0 && totalHealthy === 0;
  const partial = totalHealthy > 0 && totalHealthy < totalAvailable;
  const lastRunAgo = wd?.lastRun
    ? Math.round((lastTickAt - new Date(wd.lastRun).getTime()) / 1000)
    : null;

  return (
    <div
      dir="rtl"
      className="relative z-30 flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/40 px-3 py-2 text-xs text-white backdrop-blur-md"
    >
      {/* 24/7 self-healing badge */}
      <div
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${
          allDown
            ? "border-rose-400/60 bg-rose-500/20 text-rose-200"
            : partial
              ? "border-amber-400/60 bg-amber-500/20 text-amber-200"
              : "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
        }`}
        title="نظام الإصلاح الذاتي 24/7"
      >
        {allDown ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" />
        )}
        <span>
          {allDown
            ? "نظام معطّل"
            : partial
              ? `${totalHealthy}/${totalAvailable} موفّر شغّال`
              : "24/7 ذاتي يعمل"}
        </span>
      </div>

      {/* Provider chips */}
      <div className="flex items-center gap-1.5">
        {(wd?.health ?? []).filter((h) => h.available && h.enabled).map((p) => (
          <div
            key={p.id}
            title={`${p.id} • ${p.healthy ? `${p.latencyMs}ms` : p.error || "down"}`}
            className={`flex items-center gap-1 rounded-md border bg-gradient-to-br px-2 py-0.5 text-[10px] font-medium ${
              FAMILY_HUE[p.family]
            } ${p.healthy ? "" : "opacity-50 grayscale"}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                p.healthy ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-rose-500"
              }`}
            />
            <span>{FAMILY_LABEL[p.family]}</span>
            {p.source === "replit" && <span className="opacity-60">·R</span>}
            {p.healthy && p.latencyMs && (
              <span className="opacity-60">{p.latencyMs}ms</span>
            )}
          </div>
        ))}
        {!wd?.health?.length && (
          <div className="flex items-center gap-1 text-white/40">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>تحميل…</span>
          </div>
        )}
      </div>

      <div className="mx-1 h-4 w-px bg-white/10" />

      {/* Cron jobs */}
      <div
        className="flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-cyan-200"
        title="مهام مجدولة 24/7"
      >
        <Clock className="h-3.5 w-3.5" />
        <span className="font-semibold">{bot?.cronJobs?.enabled ?? 0}</span>
        <span className="opacity-70">/</span>
        <span className="opacity-70">{bot?.cronJobs?.total ?? 0}</span>
        <span className="opacity-70">مهمة</span>
      </div>

      {/* Tools */}
      <div
        className="flex items-center gap-1 rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-200"
        title="أدوات متاحة للوكلاء"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="font-semibold">{bot?.availableTools ?? 0}</span>
        <span className="opacity-70">أداة</span>
      </div>

      {/* Alerts */}
      {bot && bot.alerts.unread > 0 && (
        <div
          className="flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-amber-200"
          title="تنبيهات غير مقروءة"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="font-semibold">{bot.alerts.unread}</span>
          <span className="opacity-70">تنبيه</span>
        </div>
      )}

      {/* Last watchdog run */}
      {lastRunAgo !== null && (
        <div className="flex items-center gap-1 text-white/50" title="آخر فحص ذاتي">
          <Activity className="h-3 w-3" />
          <span>
            {lastRunAgo < 60
              ? `${lastRunAgo}s`
              : lastRunAgo < 3600
                ? `${Math.floor(lastRunAgo / 60)}m`
                : `${Math.floor(lastRunAgo / 3600)}h`}
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={runProbe}
          disabled={probing}
          className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-white/80 hover:bg-white/10 disabled:opacity-50"
          title="تشغيل الفحص الذاتي الآن"
        >
          <RefreshCw className={`h-3 w-3 ${probing ? "animate-spin" : ""}`} />
          <span>فحص الآن</span>
        </button>
        {onOpenAgent && (
          <button
            onClick={onOpenAgent}
            className="flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-cyan-200 hover:bg-cyan-500/20"
          >
            <Zap className="h-3 w-3" />
            <span>Live Agent</span>
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-white/80 hover:bg-white/10"
            title="إعدادات الموفّرين"
          >
            <Cpu className="h-3 w-3" />
            <span>إعدادات</span>
          </button>
        )}
      </div>

      {allDown && (
        <div className="absolute -bottom-7 left-3 right-3 flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-950/80 px-3 py-1 text-[11px] text-rose-100 shadow-lg">
          <AlertTriangle className="h-3 w-3" />
          <span>كل الموفّرين فشلوا — اضغط فحص الآن للإصلاح الذاتي</span>
          <CheckCircle2 className="h-3 w-3 opacity-50" />
        </div>
      )}
    </div>
  );
}
