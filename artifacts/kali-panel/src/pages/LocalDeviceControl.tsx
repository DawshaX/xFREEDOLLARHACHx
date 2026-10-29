import { useState, useRef, useCallback, useEffect } from "react";
import {
  Monitor, Terminal, Cpu, Wifi, HardDrive, Shield, Activity,
  RefreshCw, Play, X, CheckCircle, XCircle, AlertCircle,
  ChevronRight, Search, Zap, Fingerprint, Wrench, Eye,
  Network, Lock, Globe, Target, Skull, Radio, Layers,
  ChevronDown, ChevronUp, Copy, Loader2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_BASE = "/api";

interface TermLine { kind: "cmd" | "stdout" | "stderr" | "error" | "system"; text: string; ts: number; }
interface AgentInfo { id: string; hostname: string; user: string; platform: string; capabilities?: string[]; }
interface Preflight {
  connected: boolean; hostname: string; user: string; platform: string;
  arch?: string; os?: string; ip?: string;
  tools: string[]; services: string[]; openPorts: string[];
  toolCount?: number; agentId?: string; ts?: number;
}

type ToolCategory = {
  label: string; color: string; icon: React.ComponentType<{className?:string}>;
  tools: Array<{ name: string; desc: string; cmd: string }>;
};

const TOOL_CATS: ToolCategory[] = [
  {
    label: "الشبكة", color: "cyan", icon: Network,
    tools: [
      { name: "nmap", desc: "مسح المنافذ", cmd: "nmap -sV --top-ports 1000 localhost 2>&1 | tail -40" },
      { name: "netstat", desc: "المنافذ المفتوحة", cmd: "ss -tulpn 2>/dev/null || netstat -tulpn" },
      { name: "ip addr", desc: "عناوين IP", cmd: "ip addr show 2>/dev/null || ipconfig" },
      { name: "traceroute", desc: "تتبع المسار", cmd: "traceroute 8.8.8.8 2>&1 | head -15 || tracert 8.8.8.8" },
    ],
  },
  {
    label: "الاستطلاع", color: "amber", icon: Search,
    tools: [
      { name: "gobuster", desc: "فحص المسارات", cmd: "gobuster dir -u http://localhost -w /usr/share/wordlists/dirb/common.txt -t 20 2>&1 | tail -30" },
      { name: "nikto", desc: "فحص الويب", cmd: "nikto -h http://localhost -C all 2>&1 | tail -40" },
      { name: "whatweb", desc: "تقنيات الموقع", cmd: "whatweb http://localhost -v 2>&1 | tail -20" },
      { name: "curl", desc: "طلب HTTP", cmd: "curl -sI http://localhost" },
    ],
  },
  {
    label: "كسر الكلمات", color: "rose", icon: Lock,
    tools: [
      { name: "hydra ssh", desc: "هجوم SSH", cmd: "hydra -l root -P /usr/share/wordlists/rockyou.txt -t 4 ssh://127.0.0.1 2>&1 | head -20" },
      { name: "john", desc: "كسر Hashes", cmd: "john --list=formats 2>&1 | head -5" },
      { name: "hashcat", desc: "كسر GPU", cmd: "hashcat --version 2>&1" },
      { name: "hashid", desc: "تحديد نوع Hash", cmd: "echo '5f4dcc3b5aa765d61d8327deb882cf99' | hashid" },
    ],
  },
  {
    label: "النظام", color: "emerald", icon: Cpu,
    tools: [
      { name: "uname", desc: "معلومات النظام", cmd: "uname -a && whoami && id" },
      { name: "df -h", desc: "مساحة القرص", cmd: "df -h" },
      { name: "ps aux", desc: "العمليات", cmd: "ps aux --sort=-%cpu | head -20 2>/dev/null || tasklist" },
      { name: "crontab", desc: "المهام المجدولة", cmd: "crontab -l 2>/dev/null; cat /etc/crontab 2>/dev/null | head -20" },
    ],
  },
  {
    label: "الامتيازات", color: "violet", icon: Shield,
    tools: [
      { name: "sudo -l", desc: "صلاحيات sudo", cmd: "sudo -l 2>/dev/null" },
      { name: "SUID", desc: "ملفات SUID", cmd: "find / -perm -u=s -type f 2>/dev/null | head -20" },
      { name: "Capabilities", desc: "الصلاحيات", cmd: "getcap -r / 2>/dev/null | head -20" },
      { name: "env", desc: "المتغيرات", cmd: "env | head -30" },
    ],
  },
  {
    label: "OSINT", color: "sky", icon: Globe,
    tools: [
      { name: "subfinder", desc: "النطاقات الفرعية", cmd: "subfinder -d example.com -silent 2>&1 | head -20" },
      { name: "theHarvester", desc: "بصمة الهدف", cmd: "theHarvester -d example.com -b google -l 20 2>&1 | tail -20" },
      { name: "whois", desc: "معلومات النطاق", cmd: "whois example.com 2>&1 | head -30" },
      { name: "dig", desc: "DNS", cmd: "dig any example.com +short 2>&1 | head -20" },
    ],
  },
];

export default function LocalDeviceControl() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [lines, setLines] = useState<TermLine[]>([
    { kind: "system", text: "مرحباً في Local Device Control — اختر الوكيل ونفّذ أوامرك مباشرة على جهاز كالي", ts: Date.now() },
  ]);
  const [cmdInput, setCmdInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [activeSection, setActiveSection] = useState<"terminal" | "tools" | "fingerprint" | "missions">("terminal");
  const [expandedCat, setExpandedCat] = useState<string | null>("الشبكة");
  const termRef = useRef<HTMLDivElement>(null);

  const addLine = useCallback((line: TermLine) => {
    setLines(prev => [...prev.slice(-500), line]);
    setTimeout(() => termRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 30);
  }, []);

  const pollAgents = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/local-agent/status`);
      if (r.ok) {
        const d = await r.json() as { connected: boolean; agents?: AgentInfo[] };
        setConnected(d.connected);
        if (d.agents && d.agents.length > 0) {
          setAgents(d.agents);
          if (!selectedAgent) setSelectedAgent(d.agents[0].id);
        }
      }
    } catch { /* ignore */ }
  }, [selectedAgent]);

  useEffect(() => {
    void pollAgents();
    const t = setInterval(pollAgents, 5000);
    return () => clearInterval(t);
  }, [pollAgents]);

  const runPreflight = useCallback(async () => {
    setPreflightLoading(true);
    addLine({ kind: "system", text: "🔍 جاري فحص النظام (Pre-Flight)...", ts: Date.now() });
    try {
      const r = await fetch(`${API_BASE}/kali-command/preflight`);
      if (r.ok) {
        const d = await r.json() as Preflight;
        setPreflight(d);
        setActiveSection("fingerprint");
        if (d.connected) {
          addLine({ kind: "system", text: `✅ Fingerprint: ${d.hostname} [${d.platform}] — ${d.toolCount ?? (d.tools ?? []).length} أداة`, ts: Date.now() });
        } else {
          addLine({ kind: "error", text: "❌ لا يوجد وكيل متصل", ts: Date.now() });
        }
      }
    } catch (e) {
      addLine({ kind: "error", text: `خطأ Preflight: ${String(e)}`, ts: Date.now() });
    }
    setPreflightLoading(false);
  }, [addLine]);

  const execCmd = useCallback(async (cmd: string) => {
    if (!cmd.trim() || busy) return;
    if (!selectedAgent) {
      addLine({ kind: "error", text: "لا يوجد وكيل متصل — شغّل nova-agent.js أولاً", ts: Date.now() });
      return;
    }
    addLine({ kind: "cmd", text: `[kali]$ ${cmd}`, ts: Date.now() });
    setCmdHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistoryIdx(-1);
    setBusy(true);
    try {
      const es = new EventSource(`${API_BASE}/local-agent/exec-stream?agentId=${encodeURIComponent(selectedAgent)}&command=${encodeURIComponent(cmd)}`);
      await new Promise<void>((res) => {
        es.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data) as { type: string; data?: string; exitCode?: number; error?: string };
            if (d.type === "stdout" && d.data?.trim()) addLine({ kind: "stdout", text: d.data, ts: Date.now() });
            else if (d.type === "stderr" && d.data?.trim()) addLine({ kind: "stderr", text: d.data, ts: Date.now() });
            else if (d.type === "done") {
              addLine({ kind: "system", text: `[exit ${d.exitCode ?? 0}]`, ts: Date.now() });
              es.close(); res();
            } else if (d.type === "error") {
              addLine({ kind: "error", text: d.error ?? "خطأ", ts: Date.now() });
              es.close(); res();
            }
          } catch { /* ignore */ }
        };
        es.onerror = () => { es.close(); res(); };
      });
    } catch (e) {
      addLine({ kind: "error", text: String(e), ts: Date.now() });
    }
    setBusy(false);
  }, [busy, selectedAgent, addLine]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { void execCmd(cmdInput); setCmdInput(""); }
    if (e.key === "ArrowUp") {
      const idx = historyIdx + 1;
      if (idx < cmdHistory.length) { setHistoryIdx(idx); setCmdInput(cmdHistory[idx]); }
    }
    if (e.key === "ArrowDown") {
      const idx = historyIdx - 1;
      if (idx < 0) { setHistoryIdx(-1); setCmdInput(""); }
      else { setHistoryIdx(idx); setCmdInput(cmdHistory[idx]); }
    }
  };

  const SECTION_TABS = [
    { id: "terminal", label: "Terminal", icon: Terminal },
    { id: "tools", label: "أدوات", icon: Wrench },
    { id: "fingerprint", label: "Fingerprint", icon: Fingerprint },
  ] as const;

  return (
    <div className="h-full flex flex-col" style={{ background: "rgba(2,0,6,0.98)", color: "#e2e8f0" }}>

      {/* ── Header ── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b"
        style={{ borderColor: "rgba(255,30,60,0.3)", background: "rgba(8,0,14,0.98)" }}>
        <div className="flex items-center gap-3">
          <Skull className="w-4 h-4" style={{ color: "#ff3355" }} />
          <span className="font-mono font-black text-sm tracking-widest" style={{ color: "#ff3355", textShadow: "0 0 12px rgba(255,50,80,0.5)" }}>
            LOCAL DEVICE CONTROL
          </span>
          <span className="text-[9px] font-mono px-2 py-0.5 rounded border"
            style={{ borderColor: "rgba(255,50,80,0.3)", color: "rgba(255,50,80,0.6)", background: "rgba(255,50,80,0.05)" }}>
            v1.0
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Agent status */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-mono"
            style={{
              background: connected ? "rgba(52,211,153,0.08)" : "rgba(239,68,68,0.08)",
              borderColor: connected ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.3)",
              color: connected ? "#34d399" : "#f87171",
            }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? "#34d399" : "#f87171", boxShadow: connected ? "0 0 4px #34d399" : "none", animation: connected ? "pulse 2s infinite" : "none" }} />
            {connected ? `متصل — ${agents.length} وكيل` : "غير متصل"}
          </div>

          {/* Agent selector */}
          {agents.length > 1 && (
            <select
              value={selectedAgent}
              onChange={e => setSelectedAgent(e.target.value)}
              className="text-[10px] font-mono px-2 py-1 rounded-lg border outline-none"
              style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }}>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.hostname} [{a.user}]</option>
              ))}
            </select>
          )}

          {/* Preflight button */}
          <button
            onClick={runPreflight}
            disabled={preflightLoading || !connected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-mono font-bold transition-all disabled:opacity-40"
            style={{ background: "rgba(99,102,241,0.1)", borderColor: "rgba(99,102,241,0.35)", color: "#818cf8" }}>
            {preflightLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Fingerprint className="w-3 h-3" />}
            Pre-Flight
          </button>

          <button onClick={() => setLines([{ kind: "system", text: "تم مسح الطرفية", ts: Date.now() }])}
            className="text-[10px] font-mono px-2 py-1 rounded border transition"
            style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
            مسح
          </button>
        </div>
      </div>

      {/* ── Section Tabs ── */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 py-1.5 border-b"
        style={{ borderColor: "rgba(255,30,60,0.15)" }}>
        {SECTION_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveSection(tab.id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-mono transition-all"
            style={{
              background: activeSection === tab.id ? "rgba(255,50,80,0.12)" : "transparent",
              border: `1px solid ${activeSection === tab.id ? "rgba(255,50,80,0.35)" : "transparent"}`,
              color: activeSection === tab.id ? "#ff3355" : "rgba(255,255,255,0.35)",
            }}>
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
        {preflight && (
          <div className="ms-auto flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-mono"
            style={{ color: "rgba(52,211,153,0.7)", background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.15)" }}>
            <CheckCircle className="w-3 h-3" />
            {preflight.hostname} · {preflight.toolCount ?? (preflight.tools ?? []).length} أداة
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── Terminal Section ── */}
        {activeSection === "terminal" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Terminal output */}
            <div ref={termRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-0.5 min-h-0"
              style={{ background: "rgba(0,0,0,0.5)" }}>
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 group">
                  <span className="text-[9px] text-gray-600 font-mono shrink-0 mt-0.5 select-none">
                    {new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  <span className={
                    l.kind === "cmd" ? "text-cyan-300 font-bold" :
                    l.kind === "stdout" ? "text-green-300/90" :
                    l.kind === "stderr" ? "text-amber-400/90" :
                    l.kind === "error" ? "text-red-400" :
                    "text-gray-500 italic text-[10px]"
                  } style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {l.text}
                  </span>
                  <button
                    onClick={() => navigator.clipboard?.writeText(l.text).catch(() => {})}
                    className="opacity-0 group-hover:opacity-100 ml-auto shrink-0 text-gray-600 hover:text-gray-400 transition-opacity">
                    <Copy className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-amber-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span className="text-[10px]">جاري التنفيذ...</span>
                </div>
              )}
            </div>

            {/* Command input */}
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <span className="font-mono text-[11px] text-cyan-400 shrink-0">
                {agents.find(a => a.id === selectedAgent)?.hostname ?? "kali"}$
              </span>
              <input
                value={cmdInput}
                onChange={e => setCmdInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={busy || !connected}
                dir="ltr"
                placeholder={connected ? "أدخل الأمر..." : "الوكيل غير متصل..."}
                className="flex-1 bg-transparent outline-none font-mono text-[11px] text-green-300 placeholder:text-gray-600 disabled:opacity-40"
              />
              <button
                onClick={() => { void execCmd(cmdInput); setCmdInput(""); }}
                disabled={busy || !connected || !cmdInput.trim()}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg border transition-all disabled:opacity-30"
                style={{ background: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.3)", color: "#06b6d4" }}>
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
              </button>
            </div>

            {/* Quick commands */}
            <div className="shrink-0 flex flex-wrap gap-1 px-3 pb-2 border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
              {[
                "whoami", "uname -a", "ip addr", "ss -tulpn", "ps aux | head -15",
                "df -h", "cat /etc/passwd | head -5", "id", "sudo -l",
              ].map(cmd => (
                <button key={cmd}
                  onClick={() => { setCmdInput(cmd); }}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded border transition"
                  style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.02)" }}>
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Tools Section ── */}
        {activeSection === "tools" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
            {TOOL_CATS.map(cat => {
              const isExpanded = expandedCat === cat.label;
              const CatIcon = cat.icon;
              return (
                <div key={cat.label} className="rounded-xl border overflow-hidden"
                  style={{ borderColor: `rgba(var(--${cat.color}-rgb, 100,200,255),0.2)`, background: "rgba(0,0,0,0.3)" }}>
                  <button
                    onClick={() => setExpandedCat(isExpanded ? null : cat.label)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 transition"
                    style={{ background: isExpanded ? `rgba(0,0,0,0.4)` : "transparent" }}>
                    <CatIcon className={`w-3.5 h-3.5 text-${cat.color}-400`} />
                    <span className={`font-mono font-bold text-[11px] text-${cat.color}-300`}>{cat.label}</span>
                    <span className="text-[9px] text-gray-600 ml-1">({cat.tools.length})</span>
                    <div className="ml-auto">
                      {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-3 grid grid-cols-2 gap-1.5">
                      {cat.tools.map(tool => (
                        <button key={tool.name}
                          onClick={() => { setActiveSection("terminal"); void execCmd(tool.cmd); }}
                          disabled={busy || !connected}
                          className={`text-left p-2.5 rounded-lg border transition-all disabled:opacity-40 hover:border-${cat.color}-400/40`}
                          style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" }}>
                          <div className={`font-mono font-bold text-[10px] text-${cat.color}-300`}>{tool.name}</div>
                          <div className="text-[9px] text-gray-500 mt-0.5">{tool.desc}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Custom command runner */}
            <div className="rounded-xl border p-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="text-[10px] font-mono text-gray-400 mb-2 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-400" />
                أمر مخصص
              </div>
              <div className="flex gap-2">
                <input
                  value={cmdInput}
                  onChange={e => setCmdInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { setActiveSection("terminal"); void execCmd(cmdInput); setCmdInput(""); } }}
                  placeholder="أدخل أمر مخصص..."
                  dir="ltr"
                  className="flex-1 bg-transparent font-mono text-[10px] text-green-300 placeholder:text-gray-600 outline-none px-2 py-1.5 rounded-lg border"
                  style={{ borderColor: "rgba(255,255,255,0.08)" }}
                />
                <button
                  onClick={() => { setActiveSection("terminal"); void execCmd(cmdInput); setCmdInput(""); }}
                  disabled={busy || !connected || !cmdInput.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[10px] font-mono transition disabled:opacity-30"
                  style={{ background: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.3)", color: "#06b6d4" }}>
                  <Play className="w-3 h-3" />
                  نفّذ
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Fingerprint Section ── */}
        {activeSection === "fingerprint" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {!preflight ? (
              <div className="flex flex-col items-center justify-center h-48 gap-4">
                <Fingerprint className="w-12 h-12 text-gray-700" />
                <div className="text-sm text-gray-500 text-center">
                  <p>لم يتم تشغيل Pre-Flight بعد</p>
                  <p className="text-[11px] text-gray-600 mt-1">اضغط "Pre-Flight" في الأعلى لفحص نظام كالي</p>
                </div>
                <button onClick={runPreflight} disabled={preflightLoading || !connected}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border text-[11px] font-mono font-bold transition disabled:opacity-40"
                  style={{ background: "rgba(99,102,241,0.1)", borderColor: "rgba(99,102,241,0.35)", color: "#818cf8" }}>
                  {preflightLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                  تشغيل Pre-Flight
                </button>
              </div>
            ) : !preflight.connected ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <XCircle className="w-10 h-10 text-red-500/50" />
                <p className="text-sm text-red-400">لا يوجد وكيل متصل</p>
                <p className="text-[10px] font-mono text-gray-500 bg-black/30 px-3 py-1.5 rounded border border-white/5">
                  node nova-agent.js wss://YOUR-DOMAIN/api/local-agent/ws
                </p>
              </div>
            ) : (
              <>
                {/* System Card */}
                <div className="rounded-2xl border p-4" style={{ background: "rgba(0,255,150,0.04)", borderColor: "rgba(0,255,150,0.2)" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Monitor className="w-4 h-4 text-emerald-400" />
                    <span className="font-mono font-bold text-sm text-emerald-300">System Identity</span>
                    <span className="ml-auto text-[9px] font-mono text-gray-600">
                      {preflight.ts ? new Date(preflight.ts).toLocaleTimeString() : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Hostname", value: preflight.hostname, color: "emerald" },
                      { label: "User", value: preflight.user, color: "cyan" },
                      { label: "Platform", value: preflight.platform, color: "blue" },
                      { label: "Arch", value: preflight.arch || "unknown", color: "violet" },
                      { label: "IP", value: preflight.ip || "unknown", color: "amber" },
                      { label: "OS", value: preflight.os ? preflight.os.split(" ").slice(0, 4).join(" ") : preflight.platform, color: "rose" },
                    ].map(item => (
                      <div key={item.label} className="bg-black/20 rounded-lg px-3 py-2 border" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                        <div className="text-[9px] text-gray-500 font-mono">{item.label}</div>
                        <div className={`font-mono font-bold text-[11px] text-${item.color}-300 truncate`}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tools Card */}
                <div className="rounded-2xl border p-4" style={{ background: "rgba(251,191,36,0.04)", borderColor: "rgba(251,191,36,0.2)" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Wrench className="w-4 h-4 text-amber-400" />
                    <span className="font-mono font-bold text-sm text-amber-300">أدوات الهجوم المكتشفة</span>
                    <span className="ms-auto font-mono text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>
                      {preflight.tools.length} أداة
                    </span>
                  </div>
                  {preflight.tools.length === 0 ? (
                    <p className="text-[10px] text-gray-500">لا أدوات مكتشفة في $PATH</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {preflight.tools.map(tool => (
                        <button key={tool}
                          onClick={() => { setActiveSection("terminal"); void execCmd(`which ${tool} && ${tool} --version 2>&1 | head -3`); }}
                          className="font-mono text-[10px] px-2 py-0.5 rounded-lg border transition hover:scale-105"
                          style={{ background: "rgba(251,191,36,0.06)", borderColor: "rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                          {tool}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Open Ports Card */}
                {preflight.openPorts.length > 0 && (
                  <div className="rounded-2xl border p-4" style={{ background: "rgba(239,68,68,0.04)", borderColor: "rgba(239,68,68,0.2)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Network className="w-4 h-4 text-red-400" />
                      <span className="font-mono font-bold text-sm text-red-300">المنافذ المفتوحة</span>
                      <span className="ms-auto text-[9px] font-mono text-red-600">{preflight.openPorts.length} منفذ</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {preflight.openPorts.map(port => (
                        <span key={port} className="font-mono text-[10px] px-2 py-0.5 rounded border"
                          style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.2)", color: "#fca5a5" }}>
                          :{port}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Services Card */}
                {preflight.services.length > 0 && (
                  <div className="rounded-2xl border p-4" style={{ background: "rgba(99,102,241,0.04)", borderColor: "rgba(99,102,241,0.2)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Activity className="w-4 h-4 text-indigo-400" />
                      <span className="font-mono font-bold text-sm text-indigo-300">الخدمات المكتشفة</span>
                    </div>
                    <div className="space-y-1">
                      {preflight.services.slice(0, 8).map((svc, i) => (
                        <div key={i} className="font-mono text-[10px] text-indigo-200/70 bg-black/20 rounded px-2 py-1 truncate">{svc}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Refresh button */}
                <button onClick={runPreflight} disabled={preflightLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border text-[11px] font-mono transition disabled:opacity-40 mx-auto"
                  style={{ borderColor: "rgba(99,102,241,0.3)", color: "#818cf8", background: "rgba(99,102,241,0.06)" }}>
                  <RefreshCw className={`w-3.5 h-3.5 ${preflightLoading ? "animate-spin" : ""}`} />
                  تحديث Fingerprint
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Status Footer ── */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-t text-[9px] font-mono"
        style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.2)" }}>
        <Radio className={`w-3 h-3 ${connected ? "text-emerald-400" : "text-red-600"}`} />
        {connected ? `${agents.length} وكيل متصل` : "لا وكيل متصل"}
        {selectedAgent && agents.length > 0 && (
          <>
            <span>·</span>
            <span>{agents.find(a => a.id === selectedAgent)?.hostname ?? selectedAgent.slice(0, 12)}</span>
          </>
        )}
        <span className="ms-auto">Local Device Control — CyberNova</span>
      </div>
    </div>
  );
}
