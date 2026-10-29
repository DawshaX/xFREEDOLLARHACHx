/**
 * HardwareMonitorWidget — شريط مراقبة الموارد اللحظية.
 * CPU · RAM · Load · Uptime — يُعرض ثابتاً في قاعدة سطح المكتب.
 */
import { useState, useEffect, useRef } from "react";
import { Cpu, MemoryStick, Activity, Clock, Zap, TrendingUp } from "lucide-react";

const BASE = "/api";

interface SysInfo {
  cpu: { model: string; cores: number; usage: number; perCore: number[] };
  memory: { total: number; used: number; free: number; usagePercent: number };
  loadAvg: number[];
  uptime: number;
  hostname: string;
  platform: string;
  timestamp: string;
}

function fmtBytes(b: number): string {
  if (b > 1e9) return `${(b / 1e9).toFixed(1)}G`;
  if (b > 1e6) return `${(b / 1e6).toFixed(0)}M`;
  return `${b}B`;
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Gauge({ value, color, size = 28 }: { value: number; color: string; size?: number }) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={3} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.5s ease" }} />
    </svg>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-0.5 bg-white/5 rounded-full overflow-hidden w-16">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, backgroundColor: color }} />
    </div>
  );
}

const CPU_COLOR = (v: number) => v > 80 ? "#ef4444" : v > 60 ? "#f97316" : "#22d3ee";
const MEM_COLOR = (v: number) => v > 85 ? "#ef4444" : v > 70 ? "#f97316" : "#a78bfa";

export function HardwareMonitorWidget() {
  const [info, setInfo] = useState<SysInfo | null>(null);
  const [history, setHistory] = useState<{ cpu: number; mem: number }[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchInfo = async () => {
    try {
      const res = await fetch(`${BASE}/monitor/system`);
      if (res.ok) {
        const data: SysInfo = await res.json();
        setInfo(data);
        setHistory((prev) => [...prev, { cpu: data.cpu.usage, mem: data.memory.usagePercent }].slice(-20));
      }
    } catch {}
  };

  useEffect(() => {
    void fetchInfo();
    timerRef.current = setInterval(() => void fetchInfo(), 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  if (!info) return null;

  const cpuColor = CPU_COLOR(info.cpu.usage);
  const memColor = MEM_COLOR(info.memory.usagePercent);

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 bg-black/60 border-t border-white/5 select-none"
         style={{ fontFamily: "monospace", fontSize: "10px" }}>

      {/* CPU */}
      <div className="flex items-center gap-1.5">
        <Gauge value={info.cpu.usage} color={cpuColor} size={26} />
        <div>
          <div className="flex items-center gap-1">
            <Cpu className="w-2.5 h-2.5" style={{ color: cpuColor }} />
            <span style={{ color: cpuColor }} className="font-bold">{info.cpu.usage}%</span>
          </div>
          <div className="text-slate-600 text-[9px]">{info.cpu.cores} cores</div>
        </div>
      </div>

      {/* RAM */}
      <div className="flex items-center gap-1.5">
        <Gauge value={info.memory.usagePercent} color={memColor} size={26} />
        <div>
          <div className="flex items-center gap-1">
            <MemoryStick className="w-2.5 h-2.5" style={{ color: memColor }} />
            <span style={{ color: memColor }} className="font-bold">{info.memory.usagePercent}%</span>
          </div>
          <div className="text-slate-600 text-[9px]">{fmtBytes(info.memory.used)}/{fmtBytes(info.memory.total)}</div>
        </div>
      </div>

      {/* Load */}
      <div className="flex items-center gap-1.5">
        <Activity className="w-3 h-3 text-emerald-500" />
        <div>
          <div className="text-emerald-400 font-bold">{info.loadAvg?.[0]?.toFixed(2) ?? "—"}</div>
          <div className="text-slate-600 text-[9px]">load avg</div>
        </div>
      </div>

      {/* Mini history graph */}
      <div className="hidden sm:flex items-end gap-0.5 h-5">
        {history.map((h, i) => (
          <div key={i} className="w-1 rounded-t" style={{
            height: `${Math.max(2, (h.cpu / 100) * 20)}px`,
            backgroundColor: CPU_COLOR(h.cpu),
            opacity: 0.3 + (i / history.length) * 0.7,
          }} />
        ))}
      </div>

      {/* Uptime */}
      <div className="flex items-center gap-1 text-slate-600 hidden md:flex">
        <Clock className="w-2.5 h-2.5" />
        <span>{fmtUptime(info.uptime)}</span>
      </div>

      {/* Host */}
      <div className="text-slate-700 text-[9px] hidden lg:block truncate max-w-24">{info.hostname}</div>

      {/* Core bars */}
      <div className="hidden xl:flex gap-0.5 items-center">
        {(info.cpu.perCore ?? []).slice(0, 8).map((c, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <div className="w-1 rounded-t bg-black/40" style={{ height: "14px" }}>
              <div className="w-full rounded-t" style={{ height: `${(c / 100) * 14}px`, backgroundColor: CPU_COLOR(c), marginTop: "auto" }} />
            </div>
          </div>
        ))}
      </div>

      {/* Live dot */}
      <div className="ml-auto flex items-center gap-1 text-slate-600">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[9px]">LIVE</span>
      </div>
    </div>
  );
}
