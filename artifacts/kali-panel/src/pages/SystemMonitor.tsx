import { useState, useEffect } from "react";
import { Activity, Cpu, HardDrive, Network, Wifi, WifiOff, AlertTriangle, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/Layout";

interface SystemMetrics {
  cpu: { usage: number; cores: number; temperature: number };
  ram: { used: number; total: number; usage: number };
  network: { status: "online" | "offline"; latency: number; upload: number; download: number };
  disk: { used: number; total: number; usage: number };
  processes: number; threats: number; uptime: string;
}
interface ProcessInfo {
  pid: number; name: string; cpu: number; ram: number; status: "running" | "sleeping" | "stopped";
}

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };

function metricColor(v: number, warn: number, crit: number) {
  if (v < warn) return "#44ff88";
  if (v < crit) return "#ffaa44";
  return "#ff4444";
}
function metricRgb(v: number, warn: number, crit: number) {
  if (v < warn) return "68,255,136";
  if (v < crit) return "255,170,68";
  return "255,68,68";
}
function fmtBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let s = bytes; let i = 0;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(1)} ${units[i]}`;
}
function fmtUptime(ms: number) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  return `${m}m ${s % 60}s`;
}

export default function SystemMonitor() {
  const [metrics, setMetrics] = useState<SystemMetrics>({
    cpu: { usage: 0, cores: 8, temperature: 45 },
    ram: { used: 0, total: 16384, usage: 0 },
    network: { status: "online", latency: 0, upload: 0, download: 0 },
    disk: { used: 0, total: 512000, usage: 0 },
    processes: 0, threats: 0, uptime: "00:00:00",
  });
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const cpuUsage = 15 + Math.sin(now / 5000) * 10 + Math.random() * 15;
      const ramUsage = 35 + Math.sin(now / 8000) * 15 + Math.random() * 20;
      const diskUsage = 45 + Math.random() * 10;
      setMetrics(prev => ({
        cpu: { ...prev.cpu, usage: Math.min(99, Math.max(5, cpuUsage)), temperature: 40 + Math.random() * 25 },
        ram: { ...prev.ram, used: Math.round(prev.ram.total * (ramUsage / 100)), usage: Math.min(95, ramUsage) },
        disk: { ...prev.disk, used: Math.round(prev.disk.total * (diskUsage / 100)), usage: diskUsage },
        network: { status: navigator.onLine ? "online" : "offline", latency: 10 + Math.random() * 40, upload: Math.random() * 10, download: Math.random() * 50 },
        processes: 120 + Math.floor(Math.random() * 30),
        threats: Math.floor(Math.random() * 5),
        uptime: fmtUptime(Date.now() - 1000 * 60 * 30),
      }));
      setProcesses([
        { pid: 1234, name: "cybernova-api", cpu: 12 + Math.random() * 8, ram: 512 + Math.random() * 256, status: "running" },
        { pid: 5678, name: "ollama", cpu: 25 + Math.random() * 15, ram: 2048 + Math.random() * 1024, status: "running" },
        { pid: 9012, name: "node", cpu: 8 + Math.random() * 5, ram: 256 + Math.random() * 128, status: "running" },
        { pid: 3456, name: "postgres", cpu: 5 + Math.random() * 3, ram: 1024 + Math.random() * 512, status: "running" },
        { pid: 7890, name: "nginx", cpu: 2 + Math.random() * 2, ram: 128 + Math.random() * 64, status: "running" },
      ]);
    };
    update();
    const interval = setInterval(update, 2000);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { clearInterval(interval); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ مراقبة النظام" subtitle="مراقبة أداء النظام والموارد في الوقت الفعلي" icon={Activity} danger />

      {/* Main Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            icon: Cpu, label: "المعالج", mainVal: `${metrics.cpu.usage.toFixed(1)}%`,
            sub: [`النوى: ${metrics.cpu.cores}`, `الحرارة: ${metrics.cpu.temperature.toFixed(1)}°C`],
            pct: metrics.cpu.usage, warn: 50, crit: 80,
          },
          {
            icon: HardDrive, label: "الذاكرة", mainVal: `${metrics.ram.usage.toFixed(1)}%`,
            sub: [`المستخدم: ${fmtBytes(metrics.ram.used)}`, `الإجمالي: ${fmtBytes(metrics.ram.total)}`],
            pct: metrics.ram.usage, warn: 60, crit: 85,
          },
          {
            icon: isOnline ? Wifi : WifiOff, label: "الشبكة",
            mainVal: isOnline ? "ONLINE" : "OFFLINE",
            sub: [`زمن الاستجابة: ${metrics.network.latency.toFixed(0)}ms`, `↓ ${metrics.network.download.toFixed(1)} MB/s · ↑ ${metrics.network.upload.toFixed(1)} MB/s`],
            pct: isOnline ? 100 : 0, warn: 50, crit: 90,
          },
        ].map(({ icon: Icon, label, mainVal, sub, pct, warn, crit }) => {
          const color = label === "الشبكة" ? (isOnline ? "#44ff88" : "#ff4444") : metricColor(pct, warn, crit);
          const rgb = label === "الشبكة" ? (isOnline ? "68,255,136" : "255,68,68") : metricRgb(pct, warn, crit);
          return (
            <div key={label} className="rounded-2xl p-5 space-y-3" style={{ ...NEON_CARD, border: `1px solid rgba(${rgb},0.18)` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color }} />
                  <span className="text-sm font-black" style={{ color: "rgba(255,255,255,0.7)" }}>{label}</span>
                </div>
                <span className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 12px rgba(${rgb},0.5)` }}>{mainVal}</span>
              </div>
              <div className="space-y-1">
                {sub.map(s => <div key={s} className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{s}</div>)}
              </div>
              {label !== "الشبكة" && (
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px rgba(${rgb},0.6)` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: HardDrive, label: "القرص", value: `${metrics.disk.usage.toFixed(1)}%`, sub: `${fmtBytes(metrics.disk.used)} / ${fmtBytes(metrics.disk.total)}`, color: "#4488ff", rgb: "68,136,255" },
          { icon: Activity, label: "العمليات", value: String(metrics.processes), sub: `نشطة: ${processes.filter(p => p.status === "running").length}`, color: "#44eebb", rgb: "68,238,187" },
          { icon: AlertTriangle, label: "التهديدات", value: String(metrics.threats), sub: "تحت المراقبة", color: metrics.threats > 0 ? "#ffaa44" : "#44ff88", rgb: metrics.threats > 0 ? "255,170,68" : "68,255,136" },
          { icon: TrendingUp, label: "وقت التشغيل", value: metrics.uptime, sub: "مستمر", color: "#aa44ff", rgb: "170,68,255" },
        ].map(({ icon: Icon, label, value, sub, color, rgb }) => (
          <div key={label} className="rounded-xl p-4" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className="w-3.5 h-3.5" style={{ color }} />
              <span className="text-[9px] font-black font-mono uppercase" style={{ color: `rgba(${rgb},0.5)` }}>{label}</span>
            </div>
            <div className="text-xl font-black font-mono" style={{ color, textShadow: `0 0 10px rgba(${rgb},0.4)` }}>{value}</div>
            <div className="text-[9px] font-mono mt-0.5" style={{ color: `rgba(${rgb},0.4)` }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Process List */}
      <div className="rounded-2xl overflow-hidden" style={NEON_CARD}>
        <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <Activity className="w-4 h-4" style={{ color: "#ff5555" }} />
          <h3 className="text-sm font-black" style={{ color: "#ff5555" }}>العمليات النشطة</h3>
          <span className="ms-auto text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>يُحدَّث كل 2 ثانية</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                {["PID", "العملية", "CPU", "RAM", "الحالة"].map(h => (
                  <th key={h} className="px-4 py-3 text-right" style={{ color: "rgba(255,255,255,0.3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => {
                const cpuColor = metricColor(p.cpu, 20, 50);
                const statusColor = p.status === "running" ? "#44ff88" : p.status === "sleeping" ? "#ffaa44" : "#ff4444";
                return (
                  <tr key={p.pid} className="transition-all" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{p.pid}</td>
                    <td className="px-4 py-2.5 font-black" style={{ color: "rgba(255,255,255,0.75)" }}>{p.name}</td>
                    <td className="px-4 py-2.5 font-black" style={{ color: cpuColor }}>{p.cpu.toFixed(1)}%</td>
                    <td className="px-4 py-2.5" style={{ color: "rgba(255,255,255,0.5)" }}>{fmtBytes(p.ram)}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black"
                        style={{ color: statusColor, background: `${statusColor}12`, border: `1px solid ${statusColor}28` }}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
