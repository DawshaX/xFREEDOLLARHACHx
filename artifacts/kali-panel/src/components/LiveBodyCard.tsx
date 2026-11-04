/**
 * LiveBodyCard — the part of NOVA that runs without a server, shown live.
 * ───────────────────────────────────────────────────────────────────────
 * Two real signals, both timestamped, neither invented:
 *   • GitHub Actions runs (public API, polled every 20 s) — the executor that
 *     never sleeps, with the workflow that is running *right now*
 *   • the last committed hunt (state/hunt-latest.json) — what was scanned and
 *     what was found, with its severity split
 *
 * If GitHub rate-limits us, the card prints that instead of a green light.
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, ExternalLink, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";
import { fetchLiveRuns, fetchHunt, runLabel, runColor, type WorkflowRun, type HuntReport } from "@/lib/live-body";

const CARD = { background: "rgba(8,0,18,0.9)", border: "1px solid rgba(0,255,255,0.15)", borderRadius: 14 };

export default function LiveBodyCard() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsError, setRunsError] = useState<string>("");
  const [hunt, setHunt] = useState<HuntReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [r, h] = await Promise.all([fetchLiveRuns(8), fetchHunt()]);
    setRuns(r.runs);
    setRunsError(r.ok ? "" : r.error ?? "unknown");
    setHunt(h);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  const running = runs.filter((r) => r.status !== "completed");
  const lastGood = runs.find((r) => r.conclusion === "success");

  return (
    <div style={CARD} className="p-3 space-y-2" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-black text-cyan-200">
          <Activity className="h-3.5 w-3.5" /> الجسم الحي — GitHub Actions (بيشتغل من غير سيرفر)
        </div>
        <button onClick={() => void load()} className="text-[10px] text-white/40 flex items-center gap-1" title="تحديث">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> تحديث
        </button>
      </div>

      {runsError && <div className="text-[10px] text-amber-300">قياس Actions: {runsError}</div>}

      <div className="text-[10px] font-mono space-y-1">
        {running.length === 0 && !runsError && (
          <div className="text-white/45">مفيش workflow شغّال في اللحظة دي · آخر نجاح: {lastGood?.name ?? "—"}</div>
        )}
        {running.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <span style={{ color: runColor(r) }}>● {runLabel(r)} — {r.name}</span>
            <a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300/70 flex items-center gap-1">
              متابعة حية <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        ))}
        {runs.filter((r) => r.status === "completed").slice(0, 4).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 text-white/45">
            <span style={{ color: runColor(r) }}>● {r.name}</span>
            <span>{runLabel(r)}{r.elapsedSec != null ? ` · ${r.elapsedSec}s` : ""}</span>
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-white/10 space-y-1">
        <div className="flex items-center gap-2 text-[11px] font-black text-fuchsia-200">
          {hunt && hunt.totals.findings > 0 ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          آخر صيد حقيقي (أهداف مسموح بها بس)
        </div>
        {!hunt ? (
          <div className="text-[10px] text-white/40">
            لسه مافيش نتيجة منشورة — الـworkflow «hunt live» هو اللي بيكتبها، وأول تشغيل بيظهر هنا أوتوماتيك.
          </div>
        ) : (
          <div className="text-[10px] font-mono space-y-1">
            <div className="text-white/60">
              {hunt.totals.findings} مطابقة · {hunt.totals.rated} high/critical · {hunt.totals.targets} هدف · {new Date(hunt.at).toLocaleString("ar-EG")}
            </div>
            {hunt.findings.slice(0, 5).map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2">
                <span style={{ color: f.severity === "critical" ? "#ff5555" : f.severity === "high" ? "#ff9944" : "#ffcc44" }}>
                  [{f.severity}] {f.template}
                </span>
                <span className="text-white/40 truncate max-w-[45%]">{f.matchedAt}</span>
              </div>
            ))}
            <div className="text-white/35">{hunt.saysAr}</div>
          </div>
        )}
      </div>
    </div>
  );
}
