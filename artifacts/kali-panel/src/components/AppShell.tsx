import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { NavSidebar } from "./NavSidebar";
import {
  Shield, Zap, Cpu, MemoryStick, Clock, Monitor, Skull,
  Activity, Wifi, AlertTriangle, Radio,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AppShellProps {
  children: React.ReactNode;
}

// ── Animated top-bar marquee
const MARQUEE_MSGS = [
  "☠ CyberNova v10 · Powered by Ollama dolphin-llama3 · No external APIs",
  "⚡ ALL SYSTEMS NOMINAL · CVE SYNC ACTIVE · THREAT MONITOR LIVE",
  "☢ DANGER LEVEL: CRITICAL · 169 SERVICES MONITORED",
  "⚔ OFFENSIVE SECURITY PLATFORM · AUTHORIZED USE ONLY",
  "◈ AI NEURAL CORE ACTIVE · KNOWLEDGE BASE LOADED",
  "☠ NOVA SENTINEL v10 · RISK ENGINE SCANNING...",
];

function TopMarquee() {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);
  useEffect(() => {
    const id = setInterval(() => {
      setFade(false);
      setTimeout(() => { setIdx(i => (i + 1) % MARQUEE_MSGS.length); setFade(true); }, 250);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex-1 min-w-0 px-4 overflow-hidden">
      <span
        className={`text-[9px] font-black font-mono tracking-[0.2em] transition-all duration-300 whitespace-nowrap ${fade ? "opacity-70" : "opacity-0"}`}
        style={{ color: "#ff4444", textShadow: "0 0 10px rgba(255,30,30,0.5)" }}>
        {MARQUEE_MSGS[idx]}
      </span>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  const [, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [apiAlive, setApiAlive] = useState(false);
  const [cpu, setCpu] = useState<number | null>(null);
  const [ram, setRam] = useState<number | null>(null);
  const [now, setNow] = useState(new Date());
  const [scanPos, setScanPos] = useState(0);
  const [pulse, setPulse] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setScanPos(p => (p + 0.4) % 100), 20);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const id = setInterval(() => { setPulse(p => !p); }, 1500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch("/api/healthz");
        setApiAlive(r.ok);
      } catch { setApiAlive(false); }
      try {
        const r = await fetch("/api/monitor/system");
        if (r.ok) {
          const d = await r.json() as { cpu?: { usage?: number }; memory?: { usagePercent?: number } };
          setCpu(d?.cpu?.usage ?? null);
          setRam(d?.memory?.usagePercent ?? null);
        }
      } catch {}
    };
    void check();
    const interval = setInterval(() => void check(), 30000);
    return () => clearInterval(interval);
  }, []);

  const t = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="h-screen bg-[#030008] text-white flex flex-col overflow-hidden">
      {/* ── Top Bar ──────────────────────────────────────────────────────────── */}
      <div ref={barRef}
        className="h-9 shrink-0 flex items-center justify-between px-3 gap-2 z-30 relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg, rgba(30,0,0,0.98) 0%, rgba(10,0,0,0.98) 100%)",
          borderBottom: "1px solid rgba(255,20,20,0.45)",
          boxShadow: "0 2px 20px rgba(255,0,0,0.08), inset 0 0 30px rgba(255,0,0,0.03)",
        }}>

        {/* Animated scan line */}
        <div className="absolute top-0 bottom-0 w-px pointer-events-none transition-none"
          style={{
            left: `${scanPos}%`,
            background: "linear-gradient(180deg, transparent, rgba(255,30,30,0.5), transparent)",
            boxShadow: "0 0 8px rgba(255,30,30,0.3)",
            opacity: 0.3,
          }} />

        {/* Bottom glow line */}
        <div className="absolute bottom-0 left-0 right-0 h-px pointer-events-none"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,20,20,0.8) 30%, rgba(255,20,20,0.5) 70%, transparent)", boxShadow: "0 0 8px rgba(255,0,0,0.4)" }} />

        {/* LEFT — Brand + nav */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md flex items-center justify-center"
              style={{ background: "rgba(180,0,0,0.3)", border: "1px solid rgba(255,30,30,0.6)", boxShadow: "0 0 10px rgba(255,0,0,0.3)" }}>
              <Skull style={{ width: 11, height: 11, color: "#ff4444", filter: "drop-shadow(0 0 4px rgba(255,50,50,1))" }} />
            </div>
            <div className="hidden sm:flex flex-col leading-none">
              <span className="text-[10px] font-black tracking-[0.22em]"
                style={{ color: "#ff3333", textShadow: "0 0 10px rgba(255,30,30,0.8), 0 0 20px rgba(255,0,0,0.4)" }}>
                CYBERNOVA
              </span>
              <span className="text-[7px] font-mono tracking-wider" style={{ color: "rgba(255,80,80,0.35)" }}>xDaw · حمو دوشة</span>
            </div>
          </div>

          {/* API pill */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black font-mono`}
            style={apiAlive
              ? { background: "rgba(0,255,100,0.08)", border: "1px solid rgba(0,255,100,0.25)", color: "#44ff88" }
              : { background: "rgba(255,0,0,0.1)", border: "1px solid rgba(255,0,0,0.3)", color: "#ff4444" }}>
            <div className={`w-1.5 h-1.5 rounded-full ${apiAlive ? "bg-emerald-400" : "bg-red-500"} ${apiAlive ? "animate-pulse" : ""}`}
              style={apiAlive ? { boxShadow: "0 0 6px #00ff88" } : { boxShadow: "0 0 6px #ff0000" }} />
            {apiAlive ? "API LIVE" : "OFFLINE"}
          </div>

          {/* CPU */}
          {cpu !== null && (
            <div className="hidden md:flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-lg"
              style={{ background: "rgba(0,200,255,0.06)", border: "1px solid rgba(0,200,255,0.12)", color: cpu > 80 ? "#ffaa22" : "rgba(0,200,255,0.7)" }}>
              <Cpu style={{ width: 10, height: 10 }} />
              <span className="font-black">{cpu.toFixed(0)}%</span>
              <span className="opacity-50">CPU</span>
            </div>
          )}
          {/* RAM */}
          {ram !== null && (
            <div className="hidden lg:flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-lg"
              style={{ background: "rgba(170,0,255,0.06)", border: "1px solid rgba(170,0,255,0.15)", color: ram > 85 ? "#ffaa22" : "rgba(170,60,255,0.7)" }}>
              <MemoryStick style={{ width: 10, height: 10 }} />
              <span className="font-black">{ram.toFixed(0)}%</span>
              <span className="opacity-50">RAM</span>
            </div>
          )}
        </div>

        {/* CENTER — marquee */}
        <TopMarquee />

        {/* RIGHT — nav + clock */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Threat level */}
          <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-lg"
            style={{ background: "rgba(255,0,0,0.08)", border: "1px solid rgba(255,0,0,0.2)" }}>
            <AlertTriangle style={{ width: 10, height: 10, color: pulse ? "#ff4444" : "#ff2222", filter: "drop-shadow(0 0 3px #ff0000)" }} />
            <span className="text-[8px] font-black tracking-widest" style={{ color: "rgba(255,60,60,0.8)" }}>THREAT:HIGH</span>
          </div>

          {/* Clock */}
          <div className="hidden sm:flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,200,200,0.5)" }}>
            <Clock style={{ width: 10, height: 10 }} />
            <span className="font-black tracking-wider">{t}</span>
          </div>

          {/* Dashboard nav */}
          <button onClick={() => navigate("/")}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black font-mono transition-all"
            style={{ color: "rgba(255,100,100,0.5)", border: "1px solid rgba(255,100,100,0.1)" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,30,30,0.12)"; el.style.color = "#ff5555"; el.style.borderColor = "rgba(255,30,30,0.4)"; el.style.boxShadow = "0 0 10px rgba(255,0,0,0.2)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = ""; el.style.color = "rgba(255,100,100,0.5)"; el.style.borderColor = "rgba(255,100,100,0.1)"; el.style.boxShadow = ""; }}>
            <Monitor style={{ width: 11, height: 11 }} />
            Dashboard
          </button>

          {/* Desktop nav */}
          <button onClick={() => navigate("/desktop")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all"
            style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", boxShadow: "0 0 10px rgba(255,0,0,0.1)" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,30,30,0.22)"; el.style.boxShadow = "0 0 15px rgba(255,0,0,0.25)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,30,30,0.12)"; el.style.boxShadow = "0 0 10px rgba(255,0,0,0.1)"; }}>
            <Skull style={{ width: 11, height: 11 }} />
            xDaw Desktop
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden" style={{ flexDirection: "row" }}>
        <main className="flex-1 overflow-y-auto" style={{ background: "linear-gradient(180deg, #060010 0%, #03000a 100%)", scrollbarWidth: "thin", order: 1 }}>
          {children}
        </main>
        <NavSidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      </div>
    </div>
  );
}
