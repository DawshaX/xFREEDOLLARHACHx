import { useQuery } from "@tanstack/react-query";
import { Database, Download, Radio, RefreshCcw, ExternalLink, Skull } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface Cve { id: string; description: string; cvss: number; severity: string; publishedAt: string; url: string; }
interface DbStats { total: number; bySeverity: Record<string, number>; }
interface SyncJob { id: number; status: string; totalFetched: number; totalAvailable: number; pagesDone: number; startedAt: string; finishedAt?: string | null; lastError?: string | null; }

const SEVS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const SEV_COLOR: Record<string, string> = { CRITICAL: "#ff4444", HIGH: "#ff8844", MEDIUM: "#ffaa44", LOW: "#44ff88" };
const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };

export default function CveLive() {
  const [severity, setSeverity] = useState<(typeof SEVS)[number]>("CRITICAL");
  const [source, setSource] = useState<"live" | "local">("live");
  const [syncing, setSyncing] = useState(false);

  const { data: liveData, isLoading: liveLoading, refetch, isFetching } = useQuery<Cve[]>({
    queryKey: ["cve-live", severity],
    queryFn: () => jsonRequest<Cve[]>(`/cve/recent?severity=${severity}&limit=50`),
    refetchInterval: source === "live" ? 60000 : false,
    enabled: source === "live",
  });

  const { data: localData, refetch: refetchLocal } = useQuery<{ total: number; items: Cve[] }>({
    queryKey: ["cve-local", severity],
    queryFn: () => jsonRequest(`/cve/db/search?severity=${severity}&limit=200`),
    enabled: source === "local",
  });

  const { data: stats, refetch: refetchStats } = useQuery<DbStats>({
    queryKey: ["cve-db-stats"],
    queryFn: () => jsonRequest<DbStats>("/cve/db/stats"),
    refetchInterval: syncing ? 3000 : 30000,
  });

  const { data: job, refetch: refetchJob } = useQuery<SyncJob | null>({
    queryKey: ["cve-sync-job"],
    queryFn: () => jsonRequest<SyncJob | null>("/cve/sync/status"),
    refetchInterval: syncing ? 2000 : 15000,
  });

  useEffect(() => {
    if (job?.status === "running") setSyncing(true);
    else if (syncing && job?.status !== "running") {
      setSyncing(false); void refetchStats();
      if (source === "local") void refetchLocal();
    }
  }, [job?.status]);

  const startSync = async (maxItems: number) => {
    try {
      await jsonRequest("/cve/sync", { method: "POST", body: JSON.stringify({ maxItems }) });
      setSyncing(true); void refetchJob();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  };

  const items = source === "live" ? liveData : localData?.items;
  const isLoading = source === "live" ? liveLoading : !localData;

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ بث الثغرات الحي" subtitle="مصدر مباشر من NVD + قاعدة محلية للبحث السريع في آلاف الثغرات" icon={Radio} danger
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {SEVS.map((s) => {
                const color = SEV_COLOR[s];
                return (
                  <button key={s} data-testid={`btn-sev-${s}`} onClick={() => setSeverity(s)}
                    className="px-3 py-1.5 text-[10px] font-black font-mono rounded-lg transition-all"
                    style={severity === s
                      ? { background: `${color}16`, border: `1px solid ${color}38`, color }
                      : { color: "rgba(255,255,255,0.35)" }}>
                    {s}
                  </button>
                );
              })}
            </div>
            <button onClick={() => (source === "live" ? void refetch() : void refetchLocal())}
              data-testid="btn-refresh-cve"
              className="p-2 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
              <RefreshCcw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      {/* ── Stats + Sync ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* DB Stats */}
        <div className="md:col-span-2 rounded-2xl p-4 space-y-3" style={NEON_CARD}>
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5" style={{ color: "#4488ff" }} />
            <h3 className="font-black text-sm" style={{ color: "#4488ff" }}>قاعدة الثغرات المحلية</h3>
            <span className="text-3xl font-black font-mono ms-auto" style={{ color: "#4488ff", textShadow: "0 0 14px rgba(0,100,255,0.5)" }}>
              {(stats?.total ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {SEVS.map((s) => {
              const color = SEV_COLOR[s];
              return (
                <div key={s} className="rounded-xl p-3"
                  style={{ background: `${color}06`, border: `1px solid ${color}18` }}>
                  <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: `${color}88` }}>{s}</div>
                  <div className="text-lg font-black font-mono" style={{ color, textShadow: `0 0 10px ${color}55` }}>
                    {(stats?.bySeverity[s] ?? 0).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sync */}
        <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4" style={{ color: "#ffaa44" }} />
            <h3 className="font-black text-sm" style={{ color: "#ffaa44" }}>مزامنة من NVD</h3>
            {syncing && <span className="text-[9px] font-black font-mono animate-pulse ms-auto" style={{ color: "#ffaa44" }}>● مزامنة...</span>}
          </div>
          {job && (
            <div className="rounded-xl p-2.5 space-y-1 text-[9px] font-mono" style={DARK}>
              <div className="flex justify-between">
                <span style={{ color: "rgba(255,255,255,0.35)" }}>الحالة:</span>
                <span style={{ color: job.status === "running" ? "#ffaa44" : job.status === "completed" ? "#44ff88" : job.status === "failed" ? "#ff4444" : "rgba(255,255,255,0.4)" }}>
                  {job.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "rgba(255,255,255,0.35)" }}>جُلب:</span>
                <span style={{ color: "rgba(255,255,255,0.7)" }}>{job.totalFetched.toLocaleString()} / {job.totalAvailable ? job.totalAvailable.toLocaleString() : "?"}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "rgba(255,255,255,0.35)" }}>صفحات:</span>
                <span style={{ color: "rgba(255,255,255,0.7)" }}>{job.pagesDone}</span>
              </div>
              {job.lastError && <div style={{ color: "#ff4444" }} className="text-[9px]">{job.lastError.slice(0, 80)}</div>}
            </div>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            {[["10K", 10000], ["50K", 50000], ["200K", 200000]].map(([label, n]) => (
              <button key={label} data-testid={`btn-sync-${String(label).toLowerCase()}`}
                onClick={() => void startSync(n as number)} disabled={syncing}
                className="py-2 rounded-xl text-[10px] font-black font-mono transition-all disabled:opacity-50"
                style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.22)", color: "#ffaa44" }}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-[9px] font-mono leading-relaxed" style={{ color: "rgba(255,255,255,0.2)" }}>
            المزامنة تعمل بالخلفية. بدون مفتاح NVD السرعة ~2K/30s.
          </p>
        </div>
      </div>

      {/* ── Source tabs ── */}
      <div className="flex items-center gap-2 w-fit">
        {[
          { id: "live", label: "مباشر من NVD", testId: "tab-source-live" },
          { id: "local", label: "من القاعدة المحلية", testId: "tab-source-local" },
        ].map(({ id, label, testId }) => (
          <button key={id} onClick={() => setSource(id as "live" | "local")} data-testid={testId}
            className="px-4 py-2 text-[11px] font-black font-mono rounded-xl transition-all"
            style={source === id
              ? { background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }
              : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── CVE List ── */}
      <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
        {isLoading ? (
          <div className="text-center py-12 font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>جارِ التحميل...</div>
        ) : (
          <div data-testid="cve-live-list">
            {(items || []).map((c, i) => {
              const color = SEV_COLOR[c.severity] ?? "#888";
              return (
                <div key={c.id} className="p-4 flex items-start gap-4 transition-all"
                  style={{ borderBottom: i < (items?.length ?? 0) - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                  <div className="shrink-0 text-center w-14">
                    <div className="text-[8px] font-black font-mono uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>CVSS</div>
                    <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 12px ${color}55` }}>
                      {c.cvss?.toFixed(1) ?? "—"}
                    </div>
                    <span className="text-[8px] font-black font-mono px-1.5 py-0.5 rounded mt-1 inline-block"
                      style={{ color, background: `${color}14`, border: `1px solid ${color}25` }}>
                      {c.severity}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <a href={c.url} target="_blank" rel="noreferrer"
                        className="font-black font-mono text-sm hover:underline" style={{ color: "#ff5555" }}>{c.id}</a>
                      <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {new Date(c.publishedAt).toLocaleDateString("ar-EG")}
                      </span>
                      <a href={c.url} target="_blank" rel="noreferrer" className="ms-auto" style={{ color: "rgba(255,255,255,0.2)" }}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <p className="text-[11px] font-mono leading-relaxed line-clamp-3" style={{ color: "rgba(255,255,255,0.5)" }}>{c.description}</p>
                  </div>
                </div>
              );
            })}
            {(items?.length ?? 0) === 0 && !isLoading && (
              <div className="text-center py-12 space-y-2">
                <Skull className="w-10 h-10 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                <div className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {source === "local" ? "لا ثغرات في القاعدة المحلية. اضغط زر المزامنة أعلاه." : "لا نتائج"}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
