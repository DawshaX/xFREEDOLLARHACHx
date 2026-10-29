import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, Skull } from "lucide-react";

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };

export default function Audit() {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading] = useState(false);

  useEffect(() => {
    setLogs([
      { id: 1, createdAt: new Date().toISOString(), actor: "System", action: "STARTUP", target: "CORE", result: "success", detail: "System services started successfully" },
      { id: 2, createdAt: new Date(Date.now() - 3600000).toISOString(), actor: "Nova Agent", action: "SCAN", target: "192.168.1.1", result: "success", detail: "Port scan completed" },
      { id: 3, createdAt: new Date(Date.now() - 7200000).toISOString(), actor: "User", action: "LOGIN", target: "ADMIN_PANEL", result: "warning", detail: "Login attempt from new IP" },
    ]);
  }, []);

  const resultColor = (r: string) => r === "success" ? "#44ff88" : r === "failure" ? "#ff4444" : r === "warning" ? "#ffaa44" : "#4488ff";

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-6 h-6" style={{ color: "#ff5555" }} />
        <div>
          <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>سجل التدقيق</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Audit Log & System Events</p>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "#ff5555" }} /></div>
        ) : !logs.length ? (
          <div className="p-12 text-center space-y-3">
            <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
            <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد سجلات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  {["الوقت", "الممثل", "الإجراء", "الهدف", "النتيجة", "التفاصيل"].map(h => (
                    <th key={h} className="px-4 py-3 text-right font-black" style={{ color: "rgba(255,255,255,0.3)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="transition-all" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "rgba(255,255,255,0.3)" }}>{new Date(log.createdAt).toLocaleString("ar")}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black"
                        style={{ color: log.actor.includes("agent") || log.actor.includes("Nova") ? "#ff5555" : "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        {log.actor}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-black" style={{ color: "rgba(255,255,255,0.7)" }}>{log.action}</td>
                    <td className="px-4 py-3" style={{ color: "rgba(255,255,255,0.4)" }}>{log.target}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: resultColor(log.result), boxShadow: `0 0 5px ${resultColor(log.result)}` }} />
                        <span className="font-black uppercase text-[9px]" style={{ color: resultColor(log.result) }}>{log.result}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[250px] truncate" style={{ color: "rgba(255,255,255,0.3)" }}>{log.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
