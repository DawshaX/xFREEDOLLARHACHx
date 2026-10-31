import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Activity, Bookmark, BookOpen, Brain, Bug, ChevronDown,
  ChevronLeft, ChevronRight, Clock, Code, ClipboardList,
  Database, Eye, FileSearch, FileText, GitBranch,
  Globe, Globe2, Hash, HardDrive, Layers, LayoutDashboard,
  ListTree, Lock, Map, MemoryStick, MessageSquare, Monitor, Music2,
  Network, Package, Play, Radio, ScanLine, Search, Server,
  Settings, Shield, Sparkles, Target, Terminal, Webhook, Zap,
  AlertTriangle, TrendingUp, Crosshair, History, Skull, Flame, Siren, Bot,
} from "lucide-react";

type NavItem = {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  path: string;
  badge?: string;
  hot?: boolean;
  iconColor: string;
  skull?: boolean;
};
type NavSection = {
  id: string; title: string; titleEn: string;
  neonColor: string; neonRgb: string;
  symbol?: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "general", title: "مركز القيادة", titleEn: "COMMAND CENTER",
    neonColor: "#ff2222", neonRgb: "255,34,34", symbol: "☠",
    items: [
      { label: "لوحة التحكم",          icon: LayoutDashboard, path: "/",                  iconColor: "#ff4444" },
      { label: "استوديو البج باونتي",   icon: Shield,          path: "/bug-bounty-studio", iconColor: "#00ff88", badge: "VRP", hot: true },
      { label: "موسوعة الثغرات والكود", icon: BookOpen,        path: "/vuln-encyclopedia", iconColor: "#38bdf8", badge: "PRO", hot: true },
      { label: "فاحص الكود الدفاعي",    icon: Code,            path: "/code-auditor",      iconColor: "#fbbf24", badge: "SAST" },
      { label: "xDaw Desktop",         icon: Monitor,         path: "/desktop",           iconColor: "#ff6666", hot: true },
      { label: "Workspaces",           icon: Layers,          path: "/workspaces",        iconColor: "#ff4444" },
      { label: "Live Monitor",         icon: Activity,        path: "/monitor",           iconColor: "#ff4444" },
      { label: "System Status",        icon: Server,          path: "/status",            iconColor: "#ff4444" },
    ],
  },
  {
    id: "bots", title: "العمليات العصبية", titleEn: "AI · NEURAL OPS",
    neonColor: "#ff6600", neonRgb: "255,102,0", symbol: "⚡",
    items: [
      { label: "نوفا · الأسطول الموحّد", icon: Network,    path: "/nova-fleet",        iconColor: "#22d3ee", badge: "MESH", hot: true, skull: true },
      { label: "نوفا — الوكيل الأساسي", icon: Radio,       path: "/nova-agent",        iconColor: "#22d3ee", badge: "CORE", hot: true, skull: true },
      { label: "Live Agent Panel", icon: Activity,         path: "/live-agent",        iconColor: "#ff4444" },
      { label: "AI Agent V3",      icon: Brain,           path: "/nova-agent-v3",     iconColor: "#ff7722", badge: "V3" },
      { label: "Nova Agent V6",    icon: Sparkles,        path: "/nova-agent-v6",     iconColor: "#ffaa00", badge: "V6" },
      { label: "NOVA Core · المحادثة", icon: Sparkles,    path: "/nova-core",         iconColor: "#22d3ee", badge: "LIVE", hot: true },
      { label: "ذاكرة نوفا",        icon: Brain,           path: "/nova-memory",       iconColor: "#a78bfa", badge: "LTM" },
      { label: "Nova Agent Chat",  icon: Bot,             path: "/nova-agent-chat",   iconColor: "#aa66ff", badge: "NEW", hot: true },
      { label: "Nova Intelligence",icon: Eye,             path: "/nova-intelligence", iconColor: "#ff5555" },
      { label: "Nova Sentinel",    icon: Shield,          path: "/nova-sentinel",     iconColor: "#ff3333" },
      { label: "xDAW Sequencer",   icon: Music2,          path: "/nova-modules",      iconColor: "#ff66aa" },
      { label: "KaliGPT",          icon: Terminal,        path: "/kaligpt",           iconColor: "#ff8833" },
      { label: "Chat Bot",         icon: MessageSquare,   path: "/chat",              iconColor: "#ffaa44" },
      { label: "Nova Modules",     icon: Package,         path: "/module-center",     iconColor: "#ff5577" },
      { label: "Knowledge Base",   icon: BookOpen,        path: "/knowledge",         iconColor: "#ff7733" },
      { label: "Playbooks",        icon: ClipboardList,   path: "/playbooks",         iconColor: "#ffbb44" },
    ],
  },
  {
    id: "security", title: "الثغرات والهجمات", titleEn: "EXPLOIT · VULN OPS",
    neonColor: "#ff1111", neonRgb: "255,17,17", symbol: "☢",
    items: [
      { label: "مركز الثغرات",     icon: Database,        path: "/vuln-center",       iconColor: "#00ff88", badge: "LIVE", hot: true, skull: true },
      { label: "CVE Live Sync",    icon: ScanLine,        path: "/cve-live",          iconColor: "#ff2222", badge: "LIVE" },
      { label: "CVE-DB",           icon: Database,        path: "/cve-search",        iconColor: "#ff4444" },
      { label: "Exploit-DB",       icon: Bug,             path: "/exploit-db",        iconColor: "#ff1111", skull: true },
      { label: "GitHub Search",    icon: GitBranch,       path: "/github-search",     iconColor: "#ff7744" },
      { label: "Web Fetch",        icon: Globe,           path: "/web-search",        iconColor: "#ff5533" },
      { label: "MITRE ATT&CK",     icon: Map,             path: "/mitre",             iconColor: "#ff3322" },
      { label: "CWE Database",     icon: ListTree,        path: "/cwe",               iconColor: "#ffaa33" },
      { label: "Shodan-like",      icon: Globe2,          path: "/shodan",            iconColor: "#ff6633" },
      { label: "Scanner",          icon: Target,          path: "/scanner",           iconColor: "#ff2233" },
      { label: "Audit Log",        icon: FileSearch,      path: "/audit",             iconColor: "#ff5544" },
    ],
  },
  {
    id: "sentinel", title: "NOVA SENTINEL V10", titleEn: "RISK · ASSETS · EVIDENCE",
    neonColor: "#ff0044", neonRgb: "255,0,68", symbol: "⚠",
    items: [
      { label: "مركز المخاطر",     icon: Shield,          path: "/risk-center",       iconColor: "#ff0044", badge: "HOT", hot: true, skull: true },
      { label: "مخزون الأصول",     icon: Database,        path: "/assets",            iconColor: "#ff4488" },
      { label: "الفحص النشط",      icon: Zap,             path: "/active-scanner",    iconColor: "#ff6600" },
      { label: "الأدلة والإثبات",  icon: FileSearch,      path: "/evidence",          iconColor: "#ff8833" },
      { label: "Threat Detection",  icon: Siren,           path: "/threat-detector",   iconColor: "#ff0066", badge: "AI", hot: true },
      { label: "IOC Tracker",      icon: Target,          path: "/ioc",               iconColor: "#ff2244" },
      { label: "Attack Surface",   icon: Crosshair,       path: "/attack-surface",    iconColor: "#ff1133" },
    ],
  },
  {
    id: "intelligence", title: "الاستخبارات", titleEn: "THREAT INTEL · ANALYTICS",
    neonColor: "#aa00ff", neonRgb: "170,0,255", symbol: "◈",
    items: [
      { label: "Threat Intelligence", icon: Brain,       path: "/threat-intel",      iconColor: "#aa44ff", badge: "AI", hot: true },
      { label: "Timeline",          icon: History,        path: "/timeline",          iconColor: "#bb55ff" },
      { label: "Nova Intelligence", icon: TrendingUp,     path: "/nova-intelligence", iconColor: "#cc66ff" },
    ],
  },
  {
    id: "tools", title: "الأدوات الهجومية", titleEn: "OFFENSIVE TOOLS",
    neonColor: "#ff4400", neonRgb: "255,68,0", symbol: "⚔",
    items: [
      { label: "Nova Explorer",    icon: Globe,           path: "/auto-explorer",     iconColor: "#ff44aa", badge: "NEW", hot: true },
      { label: "Nuclei Engine",    icon: Crosshair,       path: "/nuclei-engine",     iconColor: "#ff2244", skull: true },
      { label: "Tool Installer",   icon: Package,         path: "/installer",         iconColor: "#ff5533" },
      { label: "Live Terminal",    icon: Terminal,        path: "/terminal",          iconColor: "#ff6644" },
      { label: "Subdomain Enum",   icon: Search,          path: "/tools/subdomains",  iconColor: "#ff7744" },
      { label: "DNS / WHOIS",      icon: Globe2,          path: "/tools/dns",         iconColor: "#ff5533" },
      { label: "SSL/TLS Checker",  icon: Lock,            path: "/tools/ssl",         iconColor: "#ff4433" },
      { label: "Port Scanner",     icon: Network,         path: "/tools/portscan",    iconColor: "#ff3322" },
      { label: "Hash Cracker",     icon: Hash,            path: "/tools/hash",        iconColor: "#ffaa33" },
      { label: "Encoder/Decoder",  icon: Code,            path: "/tools/encode",      iconColor: "#ff8833" },
    ],
  },
  {
    id: "data", title: "قواعد البيانات", titleEn: "DATA · INTEL BASE",
    neonColor: "#ffaa00", neonRgb: "255,170,0", symbol: "◉",
    items: [
      { label: "Reports",          icon: FileText,        path: "/reports",           iconColor: "#ffbb44" },
      { label: "Files",            icon: HardDrive,       path: "/files",             iconColor: "#ff9933" },
      { label: "Memory",           icon: MemoryStick,     path: "/memory",            iconColor: "#ff5533" },
      { label: "Cron Jobs",        icon: Clock,           path: "/cron",              iconColor: "#ffaa33" },
      { label: "Scheduled Jobs",   icon: Play,            path: "/jobs",              iconColor: "#ff7744" },
      { label: "Webhooks",         icon: Webhook,         path: "/webhooks",          iconColor: "#ff8833" },
      { label: "Bookmarks",        icon: Bookmark,        path: "/bookmarks",         iconColor: "#ffcc44" },
      { label: "Settings",         icon: Settings,        path: "/settings",          iconColor: "#ff6644" },
    ],
  },
];

/* ─── Glitch text ─────────────────────────────────────────────────── */
function GlitchText() {
  const [g, setG] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setG(true);
      setTimeout(() => setG(false), 120);
    }, 3000 + Math.random() * 2000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="text-[13px] font-black tracking-[0.22em]"
      style={{
        color: g ? "#fff" : "#ff2222",
        textShadow: g
          ? "0 0 6px #fff, 3px 0 12px #ff0000, -3px 0 12px #0033ff"
          : "0 0 12px rgba(255,30,30,1), 0 0 25px rgba(255,30,30,0.6), 0 0 40px rgba(255,0,0,0.3)",
        filter: g ? "blur(0.5px)" : "none",
        letterSpacing: g ? "0.28em" : "0.22em",
        transition: "none",
      }}>
      CYBERNOVA
    </span>
  );
}

/* ─── Animated threat ticker ──────────────────────────────────────── */
function Ticker() {
  const msgs = [
    "☠ SCANNING NETWORK...",
    "⚡ CVE FEED ACTIVE",
    "☢ THREAT LEVEL: CRITICAL",
    "⚔ MONITORING ENDPOINTS",
    "◈ AUTH VERIFIED · OK",
    "☠ EXPLOIT DB SYNCED",
    "⚠ INTRUDER DETECTED",
  ];
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);
  useEffect(() => {
    const id = setInterval(() => {
      setShow(false);
      setTimeout(() => { setIdx(i => (i + 1) % msgs.length); setShow(true); }, 300);
    }, 2500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mx-2 mb-2 px-2.5 py-1.5 rounded-lg flex items-center gap-2"
      style={{ background: "rgba(255,10,10,0.08)", border: "1px solid rgba(255,10,10,0.25)", boxShadow: "inset 0 0 10px rgba(255,0,0,0.04)" }}>
      <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse"
        style={{ boxShadow: "0 0 8px #ff0000, 0 0 16px rgba(255,0,0,0.5)" }} />
      <span
        className={`text-[9px] font-black font-mono tracking-[0.2em] transition-all duration-300 ${show ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1"}`}
        style={{ color: "#ff4444", textShadow: "0 0 10px rgba(255,50,50,0.8)" }}>
        {msgs[idx]}
      </span>
    </div>
  );
}

/* ─── Clearance indicator ─────────────────────────────────────────── */
function ClearanceBar() {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const id = setInterval(() => { setBlink(b => !b); }, 1200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mx-2 mb-1 px-2.5 py-1.5 rounded-lg flex items-center justify-between"
      style={{ background: "rgba(255,0,0,0.05)", border: "1px solid rgba(255,0,0,0.15)" }}>
      <div className="flex items-center gap-1.5">
        <Skull style={{ width: 10, height: 10, color: "#ff3333", filter: "drop-shadow(0 0 4px #ff0000)" }} />
        <span className="text-[8px] font-black tracking-widest" style={{ color: "rgba(255,80,80,0.7)" }}>CLEARANCE</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-black font-mono" style={{ color: blink ? "#ff4444" : "#ff2222", textShadow: "0 0 6px rgba(255,30,30,0.8)" }}>LEVEL 5</span>
        <AlertTriangle style={{ width: 8, height: 8, color: "#ff4444", filter: "drop-shadow(0 0 3px #ff0000)" }} />
      </div>
    </div>
  );
}

/* ─── Section component ───────────────────────────────────────────── */
function SideSection({ section, currentPath, onNav, collapsed }: {
  section: NavSection; currentPath: string;
  onNav: (p: string) => void; collapsed: boolean;
}) {
  const [open, setOpen] = useState(true);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-[3px] py-1">
        {section.items.map(item => {
          const Icon = item.icon;
          const active = currentPath === item.path || (item.path !== "/" && currentPath.startsWith(item.path));
          return (
            <button key={item.path} title={item.label} onClick={() => onNav(item.path)}
              className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
              style={active ? {
                background: "rgba(255,30,30,0.18)",
                border: "1px solid rgba(255,50,50,0.6)",
                boxShadow: "0 0 14px rgba(255,30,30,0.4), inset 0 0 8px rgba(255,0,0,0.1)",
              } : { border: "1px solid transparent" }}>
              <Icon style={{ width: 15, height: 15, color: active ? "#ff5555" : item.iconColor, opacity: active ? 1 : 0.55,
                filter: active ? "drop-shadow(0 0 5px rgba(255,60,60,0.9))" : "none" }} />
              {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
                style={{ background: "#ff3333", boxShadow: "0 0 8px #ff3333, 0 0 16px rgba(255,0,0,0.5)" }} />}
              {item.hot && !active && <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500 animate-ping" style={{ boxShadow: "0 0 6px #ff0000" }} />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mb-1">
      {/* Section header */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg group transition-all duration-150"
        style={{ background: "transparent" }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.background = `rgba(${section.neonRgb},0.05)`;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}>
        <div className="flex items-center gap-2">
          {/* Symbol + neon bars */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-black" style={{
              color: section.neonColor,
              textShadow: `0 0 8px ${section.neonColor}, 0 0 16px ${section.neonColor}66`,
            }}>{section.symbol}</span>
            <div className="flex flex-col gap-[3px]">
              <div className="w-5 h-[2px] rounded-full" style={{ background: section.neonColor, boxShadow: `0 0 8px ${section.neonColor}, 0 0 14px ${section.neonColor}66` }} />
              <div className="w-3 h-[2px] rounded-full" style={{ background: section.neonColor, opacity: 0.4 }} />
            </div>
          </div>
          <div>
            <span className="block text-[9.5px] font-black tracking-[0.2em]"
              style={{ color: section.neonColor, textShadow: `0 0 10px ${section.neonColor}99` }}>
              {section.titleEn}
            </span>
            <span className="block text-[7px] font-bold tracking-wider" style={{ color: `rgba(${section.neonRgb},0.45)` }}>
              {section.title}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
          style={{ color: `rgba(${section.neonRgb},0.5)` }} />
      </button>

      {/* Items */}
      {open && (
        <div className="space-y-[1px] mt-0.5 ml-1">
          {section.items.map(item => {
            const Icon = item.icon;
            const active = currentPath === item.path || (item.path !== "/" && currentPath.startsWith(item.path));
            return (
              <button key={item.path} onClick={() => onNav(item.path)}
                className="w-full flex items-center gap-2.5 px-2 py-[6px] rounded-xl transition-all duration-150 relative overflow-hidden group"
                style={active ? {
                  background: `linear-gradient(90deg, rgba(${section.neonRgb},0.16) 0%, rgba(${section.neonRgb},0.05) 60%, transparent 100%)`,
                  borderLeft: `3px solid ${section.neonColor}`,
                  boxShadow: `inset 0 0 30px rgba(${section.neonRgb},0.06)`,
                } : { borderLeft: "3px solid transparent" }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = `rgba(${section.neonRgb},0.06)`;
                    el.style.borderLeftColor = `rgba(${section.neonRgb},0.3)`;
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "";
                    el.style.borderLeftColor = "transparent";
                  }
                }}>

                {/* Active left glow */}
                {active && (
                  <div className="absolute left-0 top-0 bottom-0 w-16 pointer-events-none"
                    style={{ background: `linear-gradient(90deg, rgba(${section.neonRgb},0.18), transparent)` }} />
                )}
                {/* Top glow line */}
                {active && (
                  <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
                    style={{ background: `linear-gradient(90deg, rgba(${section.neonRgb},0.6), transparent 70%)` }} />
                )}

                {/* Icon box */}
                <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 relative z-10 transition-all"
                  style={active ? {
                    background: `rgba(${section.neonRgb},0.2)`,
                    border: `1px solid rgba(${section.neonRgb},0.5)`,
                    boxShadow: `0 0 10px rgba(${section.neonRgb},0.3), inset 0 0 6px rgba(${section.neonRgb},0.1)`,
                  } : {
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}>
                  <Icon style={{
                    width: 13, height: 13,
                    color: active ? section.neonColor : item.iconColor,
                    opacity: active ? 1 : 0.6,
                    filter: active ? `drop-shadow(0 0 5px ${section.neonColor})` : "none",
                  }} />
                </div>

                {/* Label — BOLD & CLEAR */}
                <span
                  className="flex-1 text-right text-[11.5px] font-bold truncate relative z-10 transition-all"
                  style={active
                    ? { color: section.neonColor, textShadow: `0 0 10px rgba(${section.neonRgb},0.7)`, fontWeight: 900 }
                    : { color: "rgba(255,255,255,0.72)", fontWeight: 700 }
                  }>
                  {item.skull && !active && (
                    <span className="mr-0.5 text-[9px] opacity-50">☠</span>
                  )}
                  {item.label}
                </span>

                {/* Badges */}
                <div className="flex items-center gap-1 shrink-0 relative z-10">
                  {item.hot && (
                    <span className="flex items-center gap-0.5 text-[8px] font-black px-1.5 py-0.5 rounded-md animate-pulse"
                      style={{
                        color: "#ff6666",
                        background: "rgba(255,20,20,0.2)",
                        border: "1px solid rgba(255,20,20,0.4)",
                        textShadow: "0 0 8px rgba(255,50,50,0.9)",
                        boxShadow: "0 0 8px rgba(255,0,0,0.2)",
                      }}>
                      ⚡ LIVE
                    </span>
                  )}
                  {item.badge && !item.hot && (
                    <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md"
                      style={
                        item.badge === "V6"
                          ? { color: "#ffd080", background: "rgba(255,170,0,0.18)", border: "1px solid rgba(255,170,0,0.4)", boxShadow: "0 0 6px rgba(255,170,0,0.2)" }
                        : item.badge === "V3"
                          ? { color: "#ffaa66", background: "rgba(255,100,0,0.18)", border: "1px solid rgba(255,100,0,0.4)" }
                        : item.badge === "AI"
                          ? { color: "#cc88ff", background: "rgba(170,0,255,0.18)", border: "1px solid rgba(170,0,255,0.4)", boxShadow: "0 0 6px rgba(170,0,255,0.2)" }
                        : item.badge === "HOT"
                          ? { color: "#ff4444", background: "rgba(255,0,0,0.2)", border: "1px solid rgba(255,0,0,0.5)", boxShadow: "0 0 8px rgba(255,0,0,0.3)" }
                        : item.badge === "NEW"
                          ? { color: "#44ffaa", background: "rgba(0,255,128,0.1)", border: "1px solid rgba(0,255,128,0.3)" }
                        : { color: "#ff7777", background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.35)" }
                      }>
                      {item.badge}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── FooterCard — حمو دوشة ─────────────────────────────────────── */
function FooterCard() {
  const [pulse, setPulse] = useState(false);
  const [glitch, setGlitch] = useState(false);

  // Skull pulse every 2s
  useEffect(() => {
    const id = setInterval(() => {
      setPulse(true);
      setTimeout(() => setPulse(false), 400);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Random glitch on name every 4s
  useEffect(() => {
    const id = setInterval(() => {
      setGlitch(true);
      setTimeout(() => setGlitch(false), 180);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ padding:"0 8px 10px", borderTop:"1px solid rgba(255,20,20,0.2)" }}>

      {/* SYS ONLINE strip */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"4px 8px", marginTop:8, marginBottom:6, borderRadius:6,
        background:"rgba(255,0,0,0.04)", border:"1px solid rgba(255,0,0,0.1)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:"#00ff88", boxShadow:"0 0 8px #00ff88", animation:"pulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontFamily:"monospace", fontSize:7.5, fontWeight:900, color:"rgba(0,255,136,0.65)", letterSpacing:"0.18em" }}>SYS ONLINE</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <Flame style={{ width:8, height:8, color:"#ff4444", filter:"drop-shadow(0 0 4px #ff0000)" }} />
          <span style={{ fontFamily:"monospace", fontSize:7.5, fontWeight:900, color:"rgba(255,80,80,0.5)" }}>v10.0</span>
        </div>
      </div>

      {/* CLEARANCE bar */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"4px 10px", borderRadius:6, marginBottom:6,
        background:"rgba(255,150,0,0.06)", border:"1px solid rgba(255,150,0,0.22)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:"#ffaa00", boxShadow:"0 0 6px #ffaa00" }} />
          <span style={{ fontFamily:"monospace", fontSize:7.5, fontWeight:900, color:"rgba(255,170,0,0.75)", letterSpacing:"0.16em" }}>CLEARANCE · LEVEL 5</span>
        </div>
        <span style={{ fontSize:10, color:"#ffaa00", fontWeight:900, filter:"drop-shadow(0 0 5px #ffaa00)" }}>△</span>
      </div>

      {/* ── Main profile card ── */}
      <div style={{
        borderRadius:14,
        background:"linear-gradient(160deg, rgba(100,5,5,0.75) 0%, rgba(40,0,0,0.92) 60%, rgba(20,0,0,0.98) 100%)",
        border:"1.5px solid rgba(255,50,50,0.45)",
        padding:"11px 11px 9px",
        position:"relative", overflow:"hidden",
        boxShadow:"0 0 32px rgba(255,0,0,0.15), 0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,100,100,0.18)",
        imageRendering:"crisp-edges",
      }}>
        {/* Top shimmer edge */}
        <div style={{ position:"absolute", top:0, left:0, right:0, height:2,
          background:"linear-gradient(90deg, transparent 0%, rgba(255,80,80,0.9) 35%, rgba(255,180,180,1) 50%, rgba(255,80,80,0.9) 65%, transparent 100%)",
          filter:"blur(0.5px)",
        }} />
        {/* Diagonal grid overlay */}
        <div style={{
          position:"absolute", inset:0, opacity:0.04,
          backgroundImage:"repeating-linear-gradient(45deg, #ff4444 0px, #ff4444 1px, transparent 1px, transparent 12px)",
          pointerEvents:"none",
        }} />
        {/* Moving scan line */}
        <div style={{
          position:"absolute", left:0, right:0, height:2,
          background:"linear-gradient(90deg, transparent, rgba(255,100,100,0.35), transparent)",
          animation:"matrix-col 2.5s linear infinite",
          pointerEvents:"none",
        }} />

        {/* ── Row 1: Skull | Names | HD ── */}
        <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:8, position:"relative" }}>

          {/* Skull box */}
          <div style={{
            width:42, height:42, borderRadius:11, flexShrink:0,
            background: pulse
              ? "radial-gradient(circle, rgba(255,60,60,0.5) 0%, rgba(120,0,0,0.6) 100%)"
              : "radial-gradient(circle, rgba(180,0,0,0.35) 0%, rgba(60,0,0,0.55) 100%)",
            border: pulse ? "1.5px solid rgba(255,100,100,0.9)" : "1.5px solid rgba(200,30,30,0.5)",
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow: pulse
              ? "0 0 28px rgba(255,0,0,0.85), 0 0 8px rgba(255,80,80,0.5), inset 0 0 14px rgba(255,30,30,0.4)"
              : "0 0 10px rgba(200,0,0,0.35), inset 0 0 6px rgba(150,0,0,0.3)",
            transition:"all 0.18s ease",
            position:"relative",
          }}>
            <Skull style={{
              width:23, height:23,
              color: pulse ? "#ff9999" : "#ff4444",
              filter: pulse
                ? "drop-shadow(0 0 12px #ff0000) drop-shadow(0 0 5px #ff6666)"
                : "drop-shadow(0 0 6px rgba(255,40,40,0.9))",
              transition:"all 0.18s ease",
            }} />
            {/* Live indicator */}
            <div style={{
              position:"absolute", top:-4, right:-4, width:10, height:10,
              borderRadius:"50%", background:"#ff1111",
              boxShadow:"0 0 12px #ff0000, 0 0 24px rgba(255,0,0,0.6)",
              animation:"pulse 1s ease-in-out infinite",
              border:"2px solid rgba(20,0,0,0.9)",
            }} />
          </div>

          {/* Names block */}
          <div style={{ flex:1, minWidth:0, overflow:"hidden" }}>
            {/* حمو دوشة — main title */}
            <div style={{
              fontSize:17, fontWeight:900, lineHeight:1.1,
              fontFamily:"'Cairo', 'Tajawal', Arial, sans-serif",
              color: glitch ? "#ff8888" : "#ffffff",
              textShadow: glitch
                ? "3px 0 rgba(255,0,0,1), -3px 0 rgba(0,200,255,0.7), 0 0 20px rgba(255,50,50,1)"
                : "0 0 16px rgba(255,110,110,0.75), 0 0 5px rgba(255,60,60,0.4), 0 2px 4px rgba(0,0,0,0.95)",
              letterSpacing:"0.02em",
              transition:"color 0.06s, text-shadow 0.06s",
              whiteSpace:"nowrap",
              WebkitFontSmoothing:"antialiased",
              MozOsxFontSmoothing:"grayscale",
            }}>
              حمو دوشة
            </div>

            {/* 🔥 كيمو العسلية */}
            <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:3 }}>
              <span style={{ fontSize:13, lineHeight:1, filter:"drop-shadow(0 0 5px rgba(255,130,0,0.9))" }}>🔥</span>
              <span style={{
                fontSize:12, fontWeight:800, lineHeight:1,
                fontFamily:"'Cairo', 'Tajawal', Arial, sans-serif",
                color:"#ffaa55",
                textShadow:"0 0 12px rgba(255,150,0,0.85), 0 0 4px rgba(255,100,0,0.5), 0 1px 3px rgba(0,0,0,0.9)",
                whiteSpace:"nowrap",
                WebkitFontSmoothing:"antialiased",
              }}>كيمو العسلية</span>
            </div>

            {/* handles */}
            <div style={{ display:"flex", gap:8, marginTop:4 }}>
              {["kemo","xDawQ"].map(h => (
                <span key={h} style={{
                  fontFamily:"monospace", fontSize:9, fontWeight:700,
                  color:"rgba(255,150,150,0.5)", letterSpacing:"0.06em",
                  textShadow:"0 0 6px rgba(255,60,60,0.25)",
                }}>@{h}</span>
              ))}
            </div>
          </div>

          {/* HD badge — top right */}
          <div style={{
            width:34, height:34, borderRadius:9, flexShrink:0, alignSelf:"flex-start",
            background:"linear-gradient(135deg, rgba(200,10,10,0.95) 0%, rgba(120,0,0,1) 100%)",
            border:"1.5px solid rgba(255,80,80,0.6)",
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:"0 0 16px rgba(255,0,0,0.45), inset 0 1px 0 rgba(255,120,120,0.25)",
          }}>
            <span style={{
              fontFamily:"monospace", fontSize:11, fontWeight:900,
              color:"#ffffff",
              textShadow:"0 0 10px rgba(255,160,160,0.9), 0 1px 2px rgba(0,0,0,0.8)",
              letterSpacing:"0.04em",
            }}>HD</span>
          </div>
        </div>

        {/* ── Row 2: Role buttons ── */}
        <div style={{ display:"flex", gap:4 }}>
          {[
            { label:"LVL 5",   col:"#ffc200", shadow:"rgba(255,190,0,0.5)",  bg:"rgba(255,170,0,0.1)",  border:"rgba(255,160,0,0.4)"  },
            { label:"AI CORE", col:"#cc55ff", shadow:"rgba(180,0,255,0.45)", bg:"rgba(150,0,255,0.1)", border:"rgba(160,0,255,0.38)" },
            { label:"ADMIN",   col:"#ff5555", shadow:"rgba(255,0,0,0.4)",    bg:"rgba(255,20,20,0.1)",  border:"rgba(255,40,40,0.4)"  },
            { label:"ROOT",    col:"#ff2020", shadow:"rgba(255,0,0,0.5)",    bg:"rgba(220,0,0,0.14)",   border:"rgba(255,0,0,0.45)"   },
          ].map(b => (
            <div key={b.label} style={{
              flex:1, textAlign:"center",
              fontFamily:"monospace", fontSize:8, fontWeight:900,
              color:b.col, background:b.bg, border:`1px solid ${b.border}`,
              borderRadius:6, padding:"4px 2px", letterSpacing:"0.07em",
              boxShadow:`0 0 10px ${b.shadow}`,
              cursor:"default",
              textShadow:`0 0 8px ${b.shadow}`,
              WebkitFontSmoothing:"antialiased",
            }}>{b.label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────────── */
interface NavSidebarProps { collapsed: boolean; onToggle: () => void; }

export function NavSidebar({ collapsed, onToggle }: NavSidebarProps) {
  const [location, navigate] = useLocation();
  const [, setSec] = useState(0);
  const scanLine = 50;

  useEffect(() => {
    const id = setInterval(() => setSec(s => s + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  return (
    <aside
      className={`${collapsed ? "w-13" : "w-[230px]"} shrink-0 flex flex-col transition-all duration-300 overflow-hidden relative`}
      style={{
        background: "linear-gradient(180deg, #030003 0%, #06000a 50%, #030003 100%)",
        borderLeft: "1px solid rgba(255,20,20,0.45)",
        boxShadow: "-4px 0 30px rgba(255,0,0,0.08)",
        order: 2,
      }}>

      {/* ── Atmosphere layers ──────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 h-64 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 25% 0%, rgba(255,10,10,0.12) 0%, transparent 70%)" }} />
      <div className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 80% 100%, rgba(255,10,10,0.1) 0%, transparent 65%)" }} />
      {/* Animated scan line */}
      <div className="absolute left-0 right-0 h-px pointer-events-none transition-none"
        style={{
          top: `${scanLine}%`,
          background: "linear-gradient(90deg, transparent, rgba(255,0,0,0.15), transparent)",
          boxShadow: "0 0 8px rgba(255,0,0,0.1)",
          opacity: 0.4,
        }} />
      {/* Left neon edge */}
      <div className="absolute top-8 bottom-8 left-0 w-px pointer-events-none"
        style={{
          background: "linear-gradient(180deg, transparent, rgba(255,30,30,0.7) 30%, rgba(255,30,30,0.4) 70%, transparent)",
          boxShadow: "2px 0 8px rgba(255,30,30,0.25)",
        }} />
      {/* Grid overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{ backgroundImage: "linear-gradient(rgba(255,0,0,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,0,0,0.5) 1px,transparent 1px)", backgroundSize: "20px 20px" }} />

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div
        className={`relative flex items-center ${collapsed ? "justify-center flex-col gap-2" : "justify-between"} px-2.5 pt-3.5 pb-2.5`}
        style={{ borderBottom: "1px solid rgba(255,20,20,0.35)" }}>
        <div className="absolute bottom-0 left-4 right-4 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,30,30,0.8) 40%, rgba(255,30,30,0.8) 60%, transparent)", boxShadow: "0 0 8px rgba(255,30,30,0.5)" }} />

        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Logo */}
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-xl opacity-30 animate-pulse"
                style={{ background: "radial-gradient(circle, rgba(255,0,0,0.6), transparent 70%)" }} />
              <div className="w-8 h-8 rounded-xl flex items-center justify-center relative"
                style={{
                  background: "linear-gradient(135deg, rgba(200,0,0,0.5), rgba(80,0,0,0.7))",
                  border: "1px solid rgba(255,40,40,0.7)",
                  boxShadow: "0 0 20px rgba(255,20,20,0.4), inset 0 0 12px rgba(255,20,20,0.15)",
                }}>
                <Skull style={{ width: 16, height: 16, color: "#ff4444", filter: "drop-shadow(0 0 6px rgba(255,40,40,1))" }} />
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 bg-red-500 animate-pulse"
                style={{ borderColor: "#030003", boxShadow: "0 0 10px #ff0000, 0 0 20px rgba(255,0,0,0.5)" }} />
            </div>
            {/* Brand */}
            <div className="flex flex-col leading-none min-w-0">
              <GlitchText />
              <div className="flex items-center gap-1 mt-[3px]">
                <div className="w-1 h-1 rounded-full bg-red-500 animate-pulse" style={{ boxShadow: "0 0 5px #ff0000" }} />
                <span className="text-[7px] font-black font-mono tracking-widest" style={{ color: "rgba(255,50,50,0.6)" }}>SECURE · {t}</span>
              </div>
            </div>
          </div>
        )}

        {collapsed && (
          <div className="relative">
            <div className="absolute -inset-1 rounded-xl opacity-25 animate-pulse"
              style={{ background: "radial-gradient(circle, rgba(255,0,0,0.6), transparent 70%)" }} />
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(200,0,0,0.5), rgba(80,0,0,0.7))", border: "1px solid rgba(255,40,40,0.7)", boxShadow: "0 0 20px rgba(255,20,20,0.4)" }}>
              <Skull style={{ width: 16, height: 16, color: "#ff4444", filter: "drop-shadow(0 0 6px rgba(255,40,40,1))" }} />
            </div>
          </div>
        )}

        <button onClick={onToggle}
          className="w-6 h-6 rounded-lg flex items-center justify-center transition-all shrink-0"
          style={{ color: "rgba(255,50,50,0.4)", border: "1px solid rgba(255,50,50,0.15)" }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = "#ff5555"; el.style.background = "rgba(255,20,20,0.12)"; el.style.borderColor = "rgba(255,20,20,0.5)"; el.style.boxShadow = "0 0 10px rgba(255,0,0,0.3)"; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = "rgba(255,50,50,0.4)"; el.style.background = ""; el.style.borderColor = "rgba(255,50,50,0.15)"; el.style.boxShadow = ""; }}>
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── Clearance + Ticker ───────────────────────────────────────────── */}
      {!collapsed && (
        <div className="pt-2">
          <ClearanceBar />
          <Ticker />
        </div>
      )}

      {/* ── Nav items ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1 space-y-0.5 scrollbar-none"
        style={{ scrollbarWidth: "none" }}>
        {NAV_SECTIONS.map(section => (
          <SideSection
            key={section.id}
            section={section}
            currentPath={location}
            onNav={navigate}
            collapsed={collapsed}
          />
        ))}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      {!collapsed && <FooterCard />}
    </aside>
  );
}
