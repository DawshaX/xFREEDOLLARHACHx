/**
 * Missions — the live work ledger.
 *
 * Every hunt the brain runs becomes a mission with real steps and real
 * findings, persisted locally. This view is the "مهمات شغالة" screen: what is
 * running, what each step did, and what was actually found.
 */
import { useEffect, useState, type ReactElement } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Target, Trash2, XCircle } from "lucide-react";
import { deleteMission, listMissions, missionStats, onMissionsChange, type Mission, type MissionStep } from "@/lib/mission-store";

const STEP_ICON: Record<MissionStep["status"], ReactElement> = {
  queued: <Clock className="h-2.5 w-2.5 text-white/30" />,
  running: <Loader2 className="h-2.5 w-2.5 text-amber-300 animate-spin" />,
  done: <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />,
  failed: <XCircle className="h-2.5 w-2.5 text-red-400" />,
  blocked: <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />,
};

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "text-red-300 border-red-500/40 bg-red-500/10",
  HIGH: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  MEDIUM: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  LOW: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  INFO: "text-white/60 border-white/20 bg-white/5",
};

export function NovaMissions() {
  const [missions, setMissions] = useState<Mission[]>(() => listMissions());
  const [open, setOpen] = useState<string | null>(() => listMissions()[0]?.id ?? null);

  useEffect(() => onMissionsChange(() => setMissions(listMissions())), []);
  const stats = missionStats();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ["المهمات", stats.total, "text-cyan-300"],
          ["شغّالة دلوقتي", stats.running, "text-amber-300"],
          ["خلصت", stats.done, "text-emerald-300"],
          ["نتائج مسجّلة", stats.findings, "text-fuchsia-300"],
        ].map(([label, value, cls]) => (
          <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.02] p-2">
            <div className="text-[8px] text-white/40">{label}</div>
            <div className={`text-[16px] font-black ${cls}`}>{value}</div>
          </div>
        ))}
      </div>

      {missions.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center space-y-1">
          <Target className="h-5 w-5 text-cyan-300 mx-auto" />
          <div className="text-[11px] font-black text-white/70">مفيش مهمات لسه</div>
          <div className="text-[9px] text-white/40">
            افتح «محطة العمل» واكتب: <span className="text-cyan-200">«استخرج ثغرات example.com»</span> — هتتعمل مهمة كاملة هنا
            بخطواتها ونتائجها، وتفضل محفوظة.
          </div>
        </div>
      )}

      {missions.map((m) => {
        const done = m.steps.filter((s) => s.status === "done").length;
        const isOpen = open === m.id;
        return (
          <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
            <button onClick={() => setOpen(isOpen ? null : m.id)} className="w-full flex items-center gap-2 p-2.5 text-start hover:bg-white/[0.03]">
              <span className={`w-1.5 h-1.5 rounded-full ${m.status === "running" ? "bg-amber-300 animate-pulse" : m.status === "failed" ? "bg-red-400" : "bg-emerald-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-black text-white/85 truncate">{m.title}</div>
                <div className="text-[7.5px] text-white/35">
                  {new Date(m.createdAt).toLocaleString("ar-EG")} · {done}/{m.steps.length} خطوة · {m.findings.length} نتيجة
                  {m.target ? ` · ${m.target}` : ""}
                </div>
              </div>
              <span className="text-[7.5px] px-1.5 py-0.5 rounded border border-white/15 text-white/50">
                {m.status === "running" ? "شغّالة" : m.status === "failed" ? "فشلت" : "خلصت"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMission(m.id);
                }}
                className="text-white/25 hover:text-red-300"
                title="حذف المهمة"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </button>

            {isOpen && (
              <div className="border-t border-white/5 p-2.5 space-y-2">
                <div className="space-y-1">
                  {m.steps.map((st) => (
                    <div key={st.id} className="flex items-start gap-1.5">
                      <span className="mt-0.5">{STEP_ICON[st.status]}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[8.5px] text-white/70">{st.title}</div>
                        {st.note && <div className="text-[7.5px] text-white/35 truncate">{st.note}</div>}
                      </div>
                      {st.ms !== undefined && <span className="text-[7px] font-mono text-white/25">{st.ms}ms</span>}
                    </div>
                  ))}
                </div>

                {m.findings.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[8px] font-black text-fuchsia-300/80">النتايج ({m.findings.length})</div>
                    {m.findings.slice(0, 40).map((f) => (
                      <div key={f.id} className="flex items-start gap-1.5 rounded-lg border border-white/5 bg-black/30 p-1.5">
                        {f.severity && (
                          <span className={`text-[6.5px] px-1 py-0.5 rounded border shrink-0 ${SEV_COLOR[f.severity] ?? SEV_COLOR.INFO}`}>
                            {f.severity}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[8px] text-white/75">
                            {f.ref ? (
                              <a href={f.ref} target="_blank" rel="noreferrer" className="hover:text-cyan-300 underline decoration-dotted">
                                {f.title}
                              </a>
                            ) : (
                              f.title
                            )}
                          </div>
                          {f.detail && <div className="text-[7px] text-white/35 line-clamp-2">{f.detail}</div>}
                        </div>
                        <span className="text-[6.5px] text-white/25 shrink-0">{f.source}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
