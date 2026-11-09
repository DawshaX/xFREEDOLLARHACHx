/**
 * NovaContextBridge — the shared context that ties every tool together.
 *
 * `CyberControlHub` had a good idea buried in a separate page: a "Context
 * Bridge" — one shared log that every tool writes to, so a command run in one
 * place shows up in the mission, the live feed and the brain. The problem was
 * that it lived only inside that one page, so the rest of the program could not
 * see it.
 *
 * This component lifts that idea out and makes it a first-class citizen of the
 * ops room. It reads from ONE source of truth — the persistent mission ledger
 * (`mission-store`) plus the live socket feed (`NovaFleetLive`) — and renders a
 * single, honest timeline: what ran, where, and what it produced. Nothing here
 * is a second copy of the truth; if a source is empty it says so.
 */
import { useEffect, useMemo, useState } from "react";
import { Link2, Radio, Target, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";
import { listMissions, onMissionsChange, type Mission } from "@/lib/mission-store";
import { useNovaLive } from "./NovaFleetLive";

interface BridgeRow {
  id: string;
  at: number;
  source: "mission" | "live";
  kind: string;
  text: string;
  detail?: string;
  level: "info" | "ok" | "warn" | "error";
}

function relative(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}ث`;
  if (s < 3600) return `${Math.round(s / 60)}د`;
  return `${Math.round(s / 3600)}س`;
}

const LEVEL_UI: Record<BridgeRow["level"], { dot: string; text: string }> = {
  info: { dot: "bg-cyan-400", text: "text-white/70" },
  ok: { dot: "bg-emerald-400", text: "text-emerald-200" },
  warn: { dot: "bg-amber-400", text: "text-amber-200" },
  error: { dot: "bg-red-500", text: "text-red-200" },
};

export function NovaContextBridge({ limit = 40 }: { limit?: number }) {
  const live = useNovaLive();
  const [missions, setMissions] = useState<Mission[]>(() => listMissions());

  useEffect(() => {
    setMissions(listMissions());
    return onMissionsChange(() => setMissions(listMissions()));
  }, []);

  // One merged timeline: the mission ledger (durable) + the live socket feed
  // (ephemeral). Both are real; neither is invented.
  const rows = useMemo<BridgeRow[]>(() => {
    const out: BridgeRow[] = [];

    for (const m of missions) {
      for (const step of m.steps) {
        if (step.status === "queued") continue;
        out.push({
          id: `m-${m.id}-${step.id}`,
          at: step.endedAt ?? step.startedAt ?? m.updatedAt,
          source: "mission",
          kind: step.tool ?? "step",
          text: `${m.title} — ${step.title}`,
          detail: step.note,
          level: step.status === "done" ? "ok" : step.status === "failed" ? "error" : "info",
        });
      }
      for (const f of m.findings) {
        out.push({
          id: `f-${m.id}-${f.id}`,
          at: f.at,
          source: "mission",
          kind: f.severity ?? "finding",
          text: f.title,
          detail: f.detail ?? f.source,
          level: f.severity === "CRITICAL" || f.severity === "HIGH" ? "warn" : "info",
        });
      }
    }

    for (const e of live.events) {
      out.push({
        id: `l-${e.id}`,
        at: e.at,
        source: "live",
        kind: e.kind,
        text: e.message,
        level: e.level ?? "info",
      });
    }

    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  }, [missions, live.events, limit]);

  const activeMission = missions.find((m) => m.status === "running") ?? null;
  const socketOpen = live.socket === "open";

  return (
    <div dir="rtl" className="rounded-xl border border-fuchsia-500/20 bg-black/25 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-fuchsia-300" />
          <div>
            <h2 className="text-[13px] font-black">جسر السياق — كل الأدوات في خط زمني واحد</h2>
            <p className="text-[9px] text-white/45">
              مصدر حقيقة واحد: سجل المهام الدائم + البث الحي. مفيش نسخة تانية من الحقيقة.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono">
          <span className="flex items-center gap-1 text-white/50">
            <Radio className={`h-3 w-3 ${socketOpen ? "text-emerald-300" : "text-white/30"}`} />
            {socketOpen ? "بث حي" : "غير متصل"}
          </span>
          <span className="flex items-center gap-1 text-white/50">
            <Target className="h-3 w-3 text-amber-300" />
            {activeMission ? activeMission.title : "مفيش مهمة جارية"}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[10px] text-white/45 leading-relaxed">
          مفيش أحداث بعد. أول أداة تشتغل — من الشات أو من غرفة العمليات — هتظهر هنا فورًا،
          بنفس الترتيب اللي حصلت بيه.
        </div>
      ) : (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {rows.map((r) => {
            const ui = LEVEL_UI[r.level];
            return (
              <div key={r.id} className="flex items-start gap-2 rounded-lg border border-white/5 bg-black/30 px-2 py-1.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${ui.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[8px] font-mono text-white/40">
                    {r.source === "mission" ? (
                      <Wrench className="h-2.5 w-2.5 text-cyan-300/70" />
                    ) : (
                      <Radio className="h-2.5 w-2.5 text-fuchsia-300/70" />
                    )}
                    <span className="text-cyan-300/80">{r.kind}</span>
                    <span className="ms-auto">{relative(r.at)}</span>
                  </div>
                  <div className={`break-words text-[10px] ${ui.text}`}>{r.text}</div>
                  {r.detail && <div className="break-words text-[8.5px] text-white/35">{r.detail}</div>}
                </div>
                {r.level === "ok" && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400/70" />}
                {r.level === "error" && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-400/70" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default NovaContextBridge;
