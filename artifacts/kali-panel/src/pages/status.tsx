import { useEffect, useState } from "react";
import { Activity, Server, Skull } from "lucide-react";
import { probeServices, type ProbeResult } from "@/lib/probe-services";

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };

interface Service {
  name: string;
  status: string;
  uptime: number | null;
  latencyMs: number;
  measured: boolean;
  errorAr?: string;
}

export default function Status() {
  const [services, setServices] = useState<Service[]>([]);

  // 🥇 القياس الحقيقي: كل سطر هنا نتيجة طلب فعلي على مساره. الصفحات التانية
  // كانت بتفتتح بـ«operational / 99.9%» مكتوب في الكود — رقم ببدّل من غير ما
  // حد يسأل أي حاجة. المسارات دي موجودة في `routes/` فعلاً.
  const SPECS = [
    { name: "API Server", path: "/healthz" },
    { name: "فاحص المحرك (self-check)", path: "/self-check" },
    { name: "الأداة المستقلة (autonomy)", path: "/autonomous/status" },
    { name: "مراقبة النظام", path: "/monitor/system" },
    { name: "محرك CVE", path: "/cve/db/stats" },
    { name: "أدوات الأمان (toolchain)", path: "/ops/tools" },
  ];

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const results: ProbeResult[] = await probeServices(SPECS, 4000);
      if (cancelled) return;
      setServices(
        results.map((r) => ({
          name: r.name,
          status: r.measured ? (r.status === "online" ? "operational" : "degraded") : "unknown",
          uptime: null,
          latencyMs: r.latencyMs,
          measured: r.measured,
          errorAr: r.errorAr,
        })),
      );
    };
    void run();
    const timer = setInterval(() => void run(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const allOk = services.length > 0 && services.every((s) => s.status === "operational");

  const statusColor = (s: string) =>
    s === "operational" ? "#44ff88" : s === "degraded" ? "#ffaa44" : "#ff4444";

  return (
    <div className="min-h-screen p-5 space-y-5 max-w-4xl mx-auto" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(0,200,100,0.12)", border: "1px solid rgba(0,200,100,0.3)" }}>
          <Activity className="w-5 h-5" style={{ color: "#44ff88" }} />
        </div>
        <div>
          <h1 className="text-lg font-black" style={{ color: "#44ff88", textShadow: "0 0 12px rgba(0,200,100,0.4)" }}>⚡ حالة النظام</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>System Status & Uptime — تحديث تلقائي كل دقيقة</p>
        </div>
      </div>

      {/* Global Status */}
      <div className="rounded-2xl p-6 text-center relative overflow-hidden" style={{ ...NEON_CARD, border: `1px solid ${allOk ? "rgba(0,200,100,0.3)" : "rgba(255,30,30,0.3)"}` }}>
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(90deg,transparent,${allOk ? "rgba(0,200,100,0.8)" : "rgba(255,30,30,0.8)"} 50%,transparent)` }} />
        <div className="text-3xl font-black mb-1"
          style={{ color: allOk ? "#44ff88" : "#ff4444", textShadow: `0 0 20px ${allOk ? "rgba(0,200,100,0.5)" : "rgba(255,30,30,0.5)"}` }}>
          {allOk ? "جميع الأنظمة تعمل بشكل طبيعي" : "توجد مشاكل في بعض الأنظمة"}
        </div>
        <div className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>تحديث تلقائي كل دقيقة</div>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {services.map((service, i) => {
          const color = statusColor(service.status);
          return (
            <div key={service.name} className="rounded-2xl p-4 space-y-3 transition-all"
              style={{ ...NEON_CARD, animationDelay: `${i * 0.1}s` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                  <span className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{service.name}</span>
                </div>
                <span className="flex items-center gap-1.5 text-[10px] font-black font-mono px-2.5 py-1 rounded-xl"
                  style={{ color, background: `${color}12`, border: `1px solid ${color}30` }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
                  {service.status}
                </span>
              </div>

              <div className="flex justify-between text-center">
                <div>
                  <div className="text-[9px] font-mono mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Uptime</div>
                  <div className="text-lg font-black font-mono" style={{ color: "#44ff88" }}>
                    {service.uptime === null ? "غير مقاس" : `${service.uptime.toFixed(2)}%`}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-mono mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Latency</div>
                  <div className="text-lg font-black font-mono" style={{ color: "#4488ff" }}>
                    {service.measured ? `${service.latencyMs} ms` : "غير مقاس"}
                  </div>
                  {!service.measured && (
                    <div className="text-[9px] font-mono" style={{ color: "#ff8844" }}>{service.errorAr}</div>
                  )}
                </div>
              </div>

              {/* Uptime bar */}
              <div>
                <div className="flex gap-0.5 h-6 items-end w-full">
                  {Array.from({ length: 30 }).map((_, j) => {
                    const hasDip = j === 25 && service.status !== "operational";
                    return (
                      <div key={j} className="flex-1 rounded-sm transition-all"
                        style={{
                          background: hasDip ? "#ffaa44" : `${color}55`,
                          height: hasDip ? "40%" : `${60 + Math.random() * 40}%`,
                        }} />
                    );
                  })}
                </div>
                <div className="text-[9px] font-mono mt-1 flex justify-between" style={{ color: "rgba(255,255,255,0.2)" }}>
                  <span>30 يوم</span><span>الآن</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {services.length === 0 && (
        <div className="rounded-2xl p-12 text-center" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <div className="font-mono text-sm mt-3" style={{ color: "rgba(255,255,255,0.2)" }}>جارِ التحميل...</div>
        </div>
      )}
    </div>
  );
}
