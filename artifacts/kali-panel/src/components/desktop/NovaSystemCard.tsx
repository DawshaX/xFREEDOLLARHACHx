/**
 * «نظام واحد» — one request, one honest picture of the whole program.
 *
 * The fleet page used to answer "is everything connected?" only by making a
 * human read six cards. This card reads `GET /api/fleet/system`, which the
 * engine builds from what it just measured: the machines it runs on, the agents
 * inside it, the corpus it reads, and the providers that give it a mind.
 *
 * Rules kept here:
 *   • every number is from that response — nothing is invented when the request
 *     fails, the card says it failed,
 *   • the sentence in `says_ar` is shown **verbatim**: it is NOVA describing
 *     itself from those numbers, not a decoration,
 *   • a machine that was learned from a peer says so (`learnedFrom`), so the list
 *     never pretends every entry was typed here.
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, Brain, Database, Loader2, Network, Power, RefreshCw, Server } from "lucide-react";
import { effectiveBase, isRemoteConfigured } from "@/lib/remote";

interface SystemMachine {
  name: string;
  base: string;
  kind: string;
  state: "up" | "down" | "unknown";
  status: number | null;
  ms: number | null;
  error?: string;
  learnedFrom?: string;
}

/**
 * Which code is actually executing. `build` is the disk, `boot` is the process:
 * on 2026-11-05 the live slot answered with `boot.builtAt` 01:26 while
 * `build.builtAt` said 02:34 — a shipped release that no one was running.
 */
interface VersionSnapshot {
  build?: { commit?: string; builtAt?: string };
  boot?: { commit: string | null; builtAt: string | null };
  stale?: boolean;
  staleWhy?: string | null;
}

interface SystemSnapshot {
  ok: boolean;
  now: number;
  machines: { total: number; up: number; down: number; list: SystemMachine[] };
  corpus: { measured: boolean; total: number; at: string | null; ageMin: number | null; note?: string };
  brain: { providers: string[]; count: number; note: string };
  mesh: { stats: { nodes: number; online: number; machines: number; slots: number } } | null;
  says_ar: string;
}

const STATE_COLOR: Record<string, string> = {
  up: "#34d399",
  down: "#f87171",
  unknown: "#94a3b8",
};

export function NovaSystemCard({ compact = false }: { compact?: boolean }) {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [ver, setVer] = useState<VersionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartNote, setRestartNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fleet/system", { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as SystemSnapshot & { static?: boolean };
      if (body?.static) {
        setError("الصفحة دي ثابتة (مفيش محرك) — الحالة المقاسة بتحتاج سيرفر مربوط.");
        setSnap(null);
        return;
      }
      setSnap(body);
    } catch (err) {
      setError((err as Error).message);
      setSnap(null);
    } finally {
      setBusy(false);
    }
    // Same request pattern, different question: is the running code the
    // shipped code? Failures here are silent — the system card still stands.
    try {
      const res = await fetch("/api/nova-core/version", { signal: AbortSignal.timeout(8000) });
      if (res.ok) setVer((await res.json()) as VersionSnapshot);
      else setVer(null);
    } catch {
      setVer(null);
    }
  }, []);

  const restart = useCallback(async () => {
    setRestarting(true);
    setRestartNote(null);
    try {
      // force=1 only matters on a bundle with no supervisor (it swaps the
      // process out itself); under boot.mjs the marker is enough.
      const res = await fetch("/api/nova-core/restart", { method: "POST", signal: AbortSignal.timeout(10000) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; note?: string; forced?: boolean };
      setRestartNote(body.note ?? (res.ok ? "اتبعت طلب إعادة التشغيل" : `HTTP ${res.status}`));
    } catch {
      // A restart that works kills the connection — that is the success case.
      setRestartNote("الاتصال اتقطع — ده معناه إن البرنامج قام من جديد. استنى 5 ثواني واضغط قياس دلوقتي.");
    } finally {
      setRestarting(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Re-measure when the auto-link lands or the user connects another machine.
    const onLink = () => void load();
    window.addEventListener("nova:autolink", onLink);
    return () => window.removeEventListener("nova:autolink", onLink);
  }, [load]);

  const base = isRemoteConfigured() ? effectiveBase() : "";

  return (
    <div className="rounded-xl border border-cyan-500/25 bg-black/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Network className="h-4 w-4 text-cyan-300" />
        <span className="text-[11px] font-black text-white/85">نظام واحد — الحالة المقاسة</span>
        <span className="text-[8px] px-1.5 py-0.5 rounded border border-white/15 bg-white/5 text-white/50 font-mono">
          {base || "نفس السيرفر"}
        </span>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="ms-auto text-[8px] px-2 py-0.5 rounded border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20 flex items-center gap-1 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          قياس دلوقتي
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[8.5px] leading-relaxed text-amber-100/90">
          {error}
        </div>
      )}

      {snap && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile
              icon={<Server className="h-3.5 w-3.5" />}
              label="ماكينات"
              value={`${snap.machines.up}/${snap.machines.total}`}
              hint={snap.machines.up === snap.machines.total ? "كلها بترد" : "فيه ماكينة مش بترد"}
              color="#22d3ee"
            />
            <Tile
              icon={<Brain className="h-3.5 w-3.5" />}
              label="عقل"
              value={String(snap.brain.count)}
              hint={snap.brain.count ? "مزوّد متاح" : "مفيش مزوّد"}
              color="#a78bfa"
            />
            <Tile
              icon={<Database className="h-3.5 w-3.5" />}
              label="كوربوس"
              value={snap.corpus.measured ? snap.corpus.total.toLocaleString("en-US") : "—"}
              hint={snap.corpus.measured ? `${snap.corpus.ageMin ?? "?"} دقيقة` : "مش مقاس"}
              color="#34d399"
            />
            <Tile
              icon={<Activity className="h-3.5 w-3.5" />}
              label="عقد المِش"
              value={snap.mesh ? `${snap.mesh.stats.online}/${snap.mesh.stats.nodes}` : "—"}
              hint={snap.mesh ? `${snap.mesh.stats.machines} ماكينة · ${snap.mesh.stats.slots} سلوت` : "المِش مش متاح"}
              color="#fbbf24"
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[8.5px] leading-relaxed text-white/70">
            {snap.says_ar}
          </div>

          {ver && (
            <div
              className={`rounded-lg p-2 text-[8px] font-mono flex flex-wrap items-center gap-2 border ${
                ver.stale
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-100"
                  : "border-white/10 bg-white/[0.03] text-white/55"
              }`}
            >
              <span className="text-white/40">الكود الشغّال</span>
              <span dir="ltr">{(ver.boot?.commit ?? "?").slice(0, 7)}</span>
              <span className="text-white/25">
                {ver.boot?.builtAt ? new Date(ver.boot.builtAt).toISOString().slice(11, 19) : "?"}
              </span>
              {ver.stale ? (
                <>
                  <span dir="ltr" className="text-rose-200">
                    ≠ ديسك {(ver.build?.commit ?? "?").slice(0, 7)}
                  </span>
                  <button
                    onClick={() => void restart()}
                    disabled={restarting}
                    className="ms-auto px-2 py-0.5 rounded border border-rose-400/50 bg-rose-400/15 text-rose-100 hover:bg-rose-400/25 flex items-center gap-1 disabled:opacity-50"
                  >
                    {restarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                    شغّل النسخة الجديدة
                  </button>
                </>
              ) : (
                <span className="text-emerald-300/80 ms-auto">مطابق للديسك</span>
              )}
              {restartNote && <span className="basis-full text-white/60">{restartNote}</span>}
            </div>
          )}

          {!compact && (
            <div className="space-y-1">
              {snap.machines.list.map((m) => (
                <div key={m.base} className="flex flex-wrap items-center gap-1.5 text-[8px] font-mono">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: STATE_COLOR[m.state] ?? "#94a3b8" }}
                  />
                  <span className="text-white/80">{m.name}</span>
                  <span className="text-white/30" dir="ltr">{m.base}</span>
                  <span style={{ color: STATE_COLOR[m.state] ?? "#94a3b8" }}>
                    {m.state === "up" ? `up ${m.ms ?? "?"}ms` : m.error?.slice(0, 60) ?? m.state}
                  </span>
                  {m.learnedFrom && (
                    <span className="text-white/25">تعلّمتُها من {m.learnedFrom.replace(/^https?:\/\//, "")}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!snap && !error && (
        <div className="text-[8.5px] text-white/40 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> بقياس…
        </div>
      )}
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  color: string;
}) {
  return (
    <div className="rounded-lg p-2 border" style={{ borderColor: `${color}33`, background: `${color}0f` }}>
      <div className="flex items-center gap-1 text-[8px]" style={{ color }}>
        {icon}
        <span className="font-black">{label}</span>
      </div>
      <div className="text-[13px] font-black font-mono" style={{ color }}>
        {value}
      </div>
      <div className="text-[7.5px] text-white/40 leading-tight">{hint}</div>
    </div>
  );
}
