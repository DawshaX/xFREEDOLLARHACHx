import { useState, useEffect } from "react";
import { Archive, Loader2, Clock, Skull, CheckCircle, XCircle, ToggleLeft, ToggleRight } from "lucide-react";

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };

export default function Jobs() {
  const [jobs, setJobs] = useState<any[]>([]);

  useEffect(() => {
    setJobs([
      { id: "1", name: "CVE Daily Sync", target: "NVD API", cron: "0 0 * * *", enabled: true, lastStatus: "success", nextRunAt: new Date(Date.now() + 86400000).toISOString() },
      { id: "2", name: "Network Monitor", target: "Local Network", cron: "*/15 * * * *", enabled: true, lastStatus: "success", nextRunAt: new Date(Date.now() + 900000).toISOString() },
      { id: "3", name: "System Cleanup", target: "Temporary Files", cron: "0 3 * * 0", enabled: false, lastStatus: "success", nextRunAt: new Date(Date.now() + 604800000).toISOString() },
    ]);
  }, []);

  const statusColor = (s: string) => s === "success" ? "#44ff88" : s === "failure" ? "#ff4444" : "#ffaa44";

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
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد مهام مجدولة</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {jobs.map(job => {
            const sc = statusColor(job.lastStatus ?? "");
            return (
              <div key={job.id} className="rounded-xl p-5 space-y-4 transition-all"
                style={{ background: "rgba(8,0,18,0.9)", border: job.enabled ? "1px solid rgba(68,255,136,0.15)" : "1px solid rgba(255,255,255,0.05)", borderRadius: 16, opacity: job.enabled ? 1 : 0.6 }}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{job.name}</h3>
                  <button onClick={() => setJobs(p => p.map(j => j.id === job.id ? { ...j, enabled: !j.enabled } : j))}
                    className="transition-all" style={{ color: job.enabled ? "#44ff88" : "rgba(255,255,255,0.2)" }}>
                    {job.enabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                </div>
                <div className="space-y-1.5 rounded-xl p-3" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span style={{ color: "rgba(255,255,255,0.3)" }}>الهدف:</span>
                    <span style={{ color: "#4488ff" }}>{job.target}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span style={{ color: "rgba(255,255,255,0.3)" }}>الجدول:</span>
                    <span className="px-1.5 py-0.5 rounded font-black"
                      style={{ color: "#aa44ff", background: "rgba(170,68,255,0.1)", border: "1px solid rgba(170,68,255,0.2)" }}>{job.cron}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    <Clock className="w-3 h-3" />
                    {new Date(job.nextRunAt).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                  <span className="flex items-center gap-1 text-[9px] font-black font-mono"
                    style={{ color: sc }}>
                    {job.lastStatus === "success" ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {job.lastStatus}
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
