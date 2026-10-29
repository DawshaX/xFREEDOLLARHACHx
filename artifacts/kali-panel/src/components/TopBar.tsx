import { useEffect, useState } from "react";
import { Activity, Cpu, Wifi, Clock } from "lucide-react";

export function TopBar() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <header className="h-14 border-b border-border/60 bg-background/60 backdrop-blur-md px-6 flex items-center gap-6">
      <div className="flex items-center gap-2 text-sm font-mono">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
        <span className="text-emerald-300">CONNECTED</span>
      </div>
      <div className="hidden md:flex items-center gap-5 text-xs font-mono text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-primary" />
          <span>CPU 12%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <span>RAM 1.2 GB</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Wifi className="w-3.5 h-3.5 text-primary" />
          <span>NET OK</span>
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2 text-sm font-mono text-primary/80">
        <Clock className="w-4 h-4" />
        <span data-testid="topbar-clock">
          {now.toLocaleTimeString("ar-SA-u-ca-gregory", { hour12: false })}
        </span>
      </div>
    </header>
  );
}
