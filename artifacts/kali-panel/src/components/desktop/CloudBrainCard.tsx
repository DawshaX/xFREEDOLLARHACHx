/**
 * CloudBrainCard — proof that the 24/7 part is real.
 *
 * A GitHub Actions job runs every 6 hours on GitHub's own runners: it resolves
 * the active target, fetches it, and harvests CVEs from NVD / CISA KEV / GitHub
 * Advisories (no CORS, no tab, no device). It commits the result to
 * `state/cybernova-brain-state.json`, and this card reads that file.
 *
 * So this card shows what the machine did **while the page was closed** — the
 * honest answer to «هيفضل يتكلم مدى الحياة؟»: this part does, the chat does not.
 */
import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Intel {
  id: string;
  title: string;
  description?: string;
  cvss?: number | null;
  severity?: string | null;
  source?: string;
  url?: string;
  at?: string;
}

interface BrainState {
  daemonStatus?: { autonomousCyclesCompleted?: number; lastHeartbeatAt?: string; state?: string };
  intelStats?: { total?: number; freshThisPulse?: number; sourcesAnswered?: string[]; at?: string };
  intelFeed?: Intel[];
  whereAmINow?: { activeTarget?: string };
}

function ago(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "دلوقتي";
  if (m < 60) return `من ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `من ${h} ساعة`;
  return `من ${Math.round(h / 24)} يوم`;
}

export function CloudBrainCard() {
  const [state, setState] = useState<BrainState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/state/cybernova-brain-state.json?t=${Date.now()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState((await r.json()) as BrainState);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cycles = state?.daemonStatus?.autonomousCyclesCompleted;
  const stats = state?.intelStats;
  const feed = (state?.intelFeed ?? []).slice(0, 4);

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Cloud className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-[11px] font-black text-white/80">العقل السحابي 24/7</span>
        <span className="text-[7px] px-1 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
          GitHub Actions
        </span>
        <button onClick={() => void load()} className="ms-auto text-white/35 hover:text-cyan-300" title="تحديث">
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>

      {err && <div className="text-[7.5px] text-red-300">مقدرتش أقرا الحالة: {err}</div>}

      {!err && !state && <div className="text-[7.5px] text-white/35">بيحمّل آخر نبضة…</div>}

      {state && (
        <>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="rounded-lg border border-white/10 bg-black/30 p-1">
              <div className="text-[6.5px] text-white/35">نبضات</div>
              <div className="text-[10px] font-black text-cyan-300">{cycles ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30 p-1">
              <div className="text-[6.5px] text-white/35">ثغرات محفوظة</div>
              <div className="text-[10px] font-black text-fuchsia-300">{stats?.total ?? 0}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30 p-1">
              <div className="text-[6.5px] text-white/35">آخر نبضة</div>
              <div className="text-[9px] font-black text-emerald-300">{ago(state.daemonStatus?.lastHeartbeatAt)}</div>
            </div>
          </div>

          <div className="text-[7px] text-white/35 leading-snug">
            شغّالة على سيرفرات GitHub كل ساعة — من غير جهازك ومن غير إن الصفحة تكون مفتوحة.
            {state.whereAmINow?.activeTarget ? ` الهدف النشط: ${state.whereAmINow.activeTarget}.` : ""}
            {stats?.sourcesAnswered?.length ? ` المصادر اللي ردت: ${stats.sourcesAnswered.join(" · ")}.` : ""}
          </div>

          {feed.length > 0 && (
            <div className="space-y-0.5 pt-0.5">
              <div className="text-[7px] font-black text-fuchsia-300/80">آخر اللي لقطته لوحدها</div>
              {feed.map((f) => (
                <div key={f.id} className="flex items-center gap-1 text-[7.5px]">
                  <span className="text-white/25 shrink-0">{f.severity ?? "—"}</span>
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer" className="text-cyan-200/80 hover:text-cyan-200 truncate underline decoration-dotted">
                      {f.id}
                    </a>
                  ) : (
                    <span className="text-white/60 truncate">{f.id}</span>
                  )}
                  {f.cvss ? <span className="text-white/30 shrink-0">CVSS {f.cvss}</span> : null}
                </div>
              ))}
            </div>
          )}

          {feed.length === 0 && (
            <div className="text-[7px] text-white/25">
              النبضة الجديدة بتحفظ أول 200 ثغرة — استنى دورة واحدة (6 ساعات) أو شغّلها يدوي من Actions.
            </div>
          )}
        </>
      )}
    </div>
  );
}
