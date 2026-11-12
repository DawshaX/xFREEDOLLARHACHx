import { useState, useEffect } from "react";
import { Archive, Clock, Skull, CheckCircle, XCircle, ToggleLeft, ToggleRight } from "lucide-react";
import { jsonRequest } from "@/lib/sse";

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };

export default function Jobs() {
  interface CronRow { id: string; name: string; cronExpr: string; enabled: boolean; lastRun?: string; lastResult?: string; nextRun?: string; runCount: number; errorCount: number; }
  const [jobs, setJobs] = useState<CronRow[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);

  // بند 5 (2026-11-09): المهام كانت ثلاث بطاقات مكتوبة في الكود (CVE Daily Sync…)
  // والتوجل كان بيقلب state محلي بس — تصريح وهمي. دلوقتي القراءة من
  // GET /nova/cron/jobs (المجدول الحقيقي على العقدة / الرد الصادق على Pages)،
  // والتوجل بيعمل PATCH حقيقي وبيسترجع فشله.
  const reload = async () => {
    try {
      const res = await jsonRequest<{ jobs: CronRow[]; count: number }>("/nova/cron/jobs");
      setJobs(Array.isArray(res.jobs) ? res.jobs : []);
      setJobsError(null);
    } catch (e) {
      setJobsError(e instanceof Error ? e.message : "تعذر قراءة المهام");
    }
  };
  useEffect(() => {
    void reload();
    const t = setInterval(() => { void reload(); }, 30_000);
    return () => clearInterval(t);
  }, []);

  const statusColor = (s: string) => (s === "success" || s === "ok") ? "#44ff88" : (s === "failure" || s === "error") ? "#ff4444" : "#ffaa44";

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <Archive className="w-6 h-6" style={{ color: "#ff5555" }} />
        <div>
          <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>المهام المجدولة</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Scheduled Jobs & Automations</p>
        </div>
      </div>

      {!jobs.length ? (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>{jobsError ? `تعذر القراءة: ${jobsError}` : "لا توجد مهام مجدولة"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {jobs.map(job => {
            const sc = statusColor(job.lastResult ?? "");
            return (
              <div key={job.id} className="rounded-xl p-5 space-y-4 transition-all"
                style={{ background: "rgba(8,0,18,0.9)", border: job.enabled ? "1px solid rgba(68,255,136,0.15)" : "1px solid rgba(255,255,255,0.05)", borderRadius: 16, opacity: job.enabled ? 1 : 0.6 }}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{job.name}</h3>
                  <button onClick={async () => {
                    const next = !job.enabled;
                    setJobs(p => p.map(j => j.id === job.id ? { ...j, enabled: next } : j));
                    try {
                      await jsonRequest(`/nova/cron/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
                    } catch {
                      // فشل الـPATCH = رجّع الحالة زي ما كانت — مافيش تظاهر
                      setJobs(p => p.map(j => j.id === job.id ? { ...j, enabled: !next } : j));
                    }
                  }}
                    className="transition-all" style={{ color: job.enabled ? "#44ff88" : "rgba(255,255,255,0.2)" }}>
                    {job.enabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                </div>
                <div className="space-y-1.5 rounded-xl p-3" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span style={{ color: "rgba(255,255,255,0.3)" }}>السجل:</span>
                    <span style={{ color: "#4488ff" }}>{job.runCount} ركضة · {job.errorCount} خطأ</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span style={{ color: "rgba(255,255,255,0.3)" }}>الجدول:</span>
                    <span className="px-1.5 py-0.5 rounded font-black"
                      style={{ color: "#aa44ff", background: "rgba(170,68,255,0.1)", border: "1px solid rgba(170,68,255,0.2)" }}>{job.cronExpr}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    <Clock className="w-3 h-3" />
                    {job.nextRun ? new Date(job.nextRun).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "—"}
                  </div>
                  <span className="flex items-center gap-1 text-[9px] font-black font-mono"
                    style={{ color: sc }}>
                    {job.lastResult === "success" || job.lastResult === "ok" ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {job.lastResult ?? "لم يركض بعد"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
