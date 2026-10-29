/**
 * CyberNova Cyber Control Hub v2 — مركز التحكم الموحّد المتصل
 * ════════════════════════════════════════════════════════════════════
 * Context Bridge: كل الأدوات متصلة ببعض عبر حالة مشتركة:
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │              SHARED HUB CONTEXT (Context Bridge)            │
 *  │  activeMission ← تحديد من Mission Tracker                   │
 *  │  contextLog    ← أحداث من كل الأدوات                        │
 *  │  logToMission  ← تسجيل أوامر/نتائج مباشرة للمهمة النشطة   │
 *  │  navigateTo    ← التنقل بين التبويبات برمجياً               │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * الاتصالات:
 *  KALI AI     → log exec_result → activeMission.commands
 *  Local Ctrl  → log terminal cmd → activeMission.commands
 *  Mission     → select mission  → sets activeMission for ALL panels
 *  Live Agent  → shows activeMission banner
 *  Context Feed → shows unified event stream from all panels
 * ════════════════════════════════════════════════════════════════════
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Radio, Skull, Command, Monitor, Target, Wifi, WifiOff,
  Server, Cpu, MemoryStick, Brain, Activity, RefreshCw,
  Send, Square, Loader2, Trash2, Plus, Shield,
  Network, Globe, Zap, Lock, Terminal, Link,
  Fingerprint, ChevronDown, ChevronRight, ChevronLeft, X, Download,
  Eye, Clock, FileText, CheckCircle, XCircle, Info, Swords,
  Search, Flag, AlertTriangle, BookOpen, GitBranch, ArrowRight,
  Layers, Crosshair, List,
} from "lucide-react";
import { LiveAgentPanel } from "@/components/desktop/LiveAgentPanel";
import type { ClientToolEvent } from "@/components/desktop/AgentWindow";
import NovaCommanderPage from "./NovaCommander";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const API = "/api";

/* ═══════════════════════════════════════════════════════════════════════
   SHARED TYPES
═══════════════════════════════════════════════════════════════════════ */

interface AgentInfo {
  id: string; hostname: string; platform: string; user: string;
  arch?: string; capabilities?: string[]; connectedAt?: number;
}

interface SystemIntel {
  server: { hostname: string; platform: string; arch: string; cpus: number; totalMemory: string; uptime: string; loadAvg: string; memUsage: string; openPorts: string };
  agents: AgentInfo[]; agentCount: number; knowledgeCount: number;
  tasks: { queued: number; running: number; done: number; failed: number };
}

interface Mission {
  id: number; name: string; target: string; objective: string;
  phase: string; status: string; createdAt: string; updatedAt: string;
  findings: Finding[]; commands: MissionCmd[]; notes: string; tags: string[];
  findingCount?: number; commandCount?: number;
}

interface Finding {
  id: number; type: string; title: string; severity: string;
  detail: string; tool?: string; raw?: string; ts: string;
}

interface MissionCmd { cmd: string; output: string; ts: string; }

interface KaliTask {
  id: string; title: string; description: string;
  status: "queued" | "running" | "done" | "failed" | "approved" | "awaiting_approval";
  progress: number; command?: string; result?: string; error?: string;
  createdAt: number; updatedAt: number;
}

interface TermLine { kind: "cmd" | "stdout" | "stderr" | "error" | "system"; text: string; ts: number; loggedToMission?: boolean; }

interface Preflight {
  connected: boolean; hostname: string; user: string; platform: string;
  arch?: string; os?: string; ip?: string;
  tools: string[]; services: string[]; openPorts: string[];
  toolCount?: number; agentId?: string;
}

/* ── Context Bridge Types ──────────────────────────────────────────── */

interface ActiveMission {
  id: number; name: string; target: string; phase: string; status: string;
}

interface ContextEvent {
  id: string; ts: number;
  source: "kali" | "local" | "mission" | "live" | "nova";
  type: "cmd" | "finding" | "message" | "connection" | "task" | "select";
  text: string; detail?: string; isError?: boolean;
}

interface HubCtx {
  activeMission: ActiveMission | null;
  setActiveMission: (m: ActiveMission | null) => void;
  addEvent: (e: Omit<ContextEvent, "id" | "ts">) => void;
  logToMission: (cmd: string, output: string, source?: string) => Promise<boolean>;
  navigateTo: (tab: MainTab) => void;
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════ */

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function taskStatusColor(s: string) {
  if (s === "done")    return "#44ff88";
  if (s === "running") return "#ffaa00";
  if (s === "failed")  return "#ff4444";
  if (s === "queued")  return "#6699ff";
  return "#888";
}

const SOURCE_ICON: Record<string, React.ReactNode> = {
  kali:    <Skull className="w-3 h-3" style={{ color: "#ff4444" }} />,
  local:   <Monitor className="w-3 h-3" style={{ color: "#ff6688" }} />,
  mission: <Target className="w-3 h-3" style={{ color: "#ff9933" }} />,
  live:    <Radio className="w-3 h-3" style={{ color: "#44eebb" }} />,
  nova:    <Command className="w-3 h-3" style={{ color: "#a855f7" }} />,
};

const PHASES = [
  { id: "reconnaissance",    label: "Reconnaissance",    color: "#06b6d4", icon: Eye },
  { id: "scanning",          label: "Scanning",           color: "#8b5cf6", icon: Network },
  { id: "exploitation",      label: "Exploitation",       color: "#f59e0b", icon: Zap },
  { id: "post-exploitation", label: "Post-Exploitation",  color: "#ef4444", icon: Skull },
  { id: "reporting",         label: "Reporting",          color: "#10b981", icon: FileText },
];

const SEVERITIES = [
  { id: "critical", label: "Critical", color: "#ef4444" },
  { id: "high",     label: "High",     color: "#f97316" },
  { id: "medium",   label: "Medium",   color: "#f59e0b" },
  { id: "low",      label: "Low",      color: "#06b6d4" },
  { id: "info",     label: "Info",     color: "#6b7280" },
];

const FINDING_TYPES = ["vulnerability","misconfiguration","information","credentials","other"];

function phaseColor(p: string) { return PHASES.find(x => x.id === p)?.color ?? "#ff3355"; }
function sevColor(s: string)   { return SEVERITIES.find(x => x.id === s)?.color ?? "#6b7280"; }

function statusIcon(s: string) {
  if (s === "active")    return <Activity className="w-3 h-3 text-emerald-400" />;
  if (s === "completed") return <CheckCircle className="w-3 h-3 text-blue-400" />;
  if (s === "paused")    return <Clock className="w-3 h-3 text-amber-400" />;
  if (s === "failed")    return <XCircle className="w-3 h-3 text-red-400" />;
  return <Info className="w-3 h-3 text-gray-400" />;
}

/* Kali markdown renderer */
function renderKaliText(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const result: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      result.push(<div key={i} className="font-bold text-[10px] mt-1.5" style={{ color: "rgba(255,100,100,0.9)" }}>{line.slice(4)}</div>);
    } else if (line.startsWith("## ")) {
      result.push(<div key={i} className="font-bold text-[11px] mt-2" style={{ color: "#ff5555" }}>{line.slice(3)}</div>);
    } else if (line.startsWith("# ")) {
      result.push(<div key={i} className="font-bold text-[12px] mt-2" style={{ color: "#ff4444" }}>{line.slice(2)}</div>);
    } else if (line.match(/^[-*] /)) {
      result.push(<div key={i} className="flex gap-1.5 text-[9px] leading-relaxed"><span className="shrink-0" style={{ color: "rgba(68,255,136,0.7)" }}>▸</span><span style={{ color: "rgba(220,255,220,0.9)" }}>{line.slice(2)}</span></div>);
    } else if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      const code = codeLines.join("\n");
      result.push(
        <div key={i} className="my-1.5 rounded overflow-hidden" style={{ background: "rgba(0,0,0,0.7)", border: "1px solid rgba(68,255,136,0.2)" }}>
          <div className="flex items-center justify-between px-2 py-0.5" style={{ background: "rgba(68,255,136,0.06)", borderBottom: "1px solid rgba(68,255,136,0.12)" }}>
            <span className="text-[7px] font-mono" style={{ color: "rgba(68,255,136,0.5)" }}>bash</span>
            <button onClick={() => navigator.clipboard.writeText(code).catch(() => {})} className="text-[7px] font-mono px-1.5 py-0.5 rounded hover:bg-white/10 transition-all" style={{ color: "rgba(68,255,136,0.6)" }}>📋 نسخ</button>
          </div>
          <pre className="px-2.5 py-2 text-[8.5px] font-mono whitespace-pre-wrap break-all" style={{ color: "rgba(150,255,180,0.95)" }}>{code}</pre>
        </div>
      );
    } else if (line.trim() === "") {
      result.push(<div key={i} className="h-1" />);
    } else {
      result.push(<div key={i} className="text-[9px] leading-relaxed" style={{ color: "rgba(220,255,220,0.9)" }}>{line}</div>);
    }
    i++;
  }
  return result;
}

async function* kaliStreamChat(sessionId: string, message: string, signal?: AbortSignal): AsyncGenerator<{event: string; data: unknown}> {
  const resp = await fetch(`${API}/kali-command/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, message }), signal });
  if (!resp.ok || !resp.body) { yield { event: "error", data: { error: `HTTP ${resp.status}` } }; return; }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const ls = part.trim().split("\n");
      let event = "message", dataStr = "";
      for (const l of ls) {
        if (l.startsWith("event: ")) event = l.slice(7).trim();
        else if (l.startsWith("data: ")) dataStr = l.slice(6).trim();
      }
      if (dataStr) { try { yield { event, data: JSON.parse(dataStr) }; } catch {} }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   ACTIVE MISSION BANNER — يظهر في كل التبويبات
═══════════════════════════════════════════════════════════════════════ */

function ActiveMissionBanner({ ctx, onGoToMissions }: { ctx: HubCtx; onGoToMissions: () => void }) {
  if (!ctx.activeMission) return null;
  const ph = PHASES.find(p => p.id === ctx.activeMission!.phase);
  const PhIcon = ph?.icon ?? Target;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 shrink-0"
      style={{ background: "rgba(255,153,51,0.07)", borderBottom: "1px solid rgba(255,153,51,0.2)" }}>
      <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" style={{ boxShadow: "0 0 6px #ff9933" }} />
      <span className="text-[9px] font-mono font-bold" style={{ color: "rgba(255,153,51,0.7)" }}>🎯 المهمة النشطة:</span>
      <span className="text-[10px] font-mono font-black" style={{ color: "#ff9933" }}>{ctx.activeMission.name}</span>
      <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>←</span>
      <span className="text-[9px] font-mono text-cyan-400/70">{ctx.activeMission.target}</span>
      <PhIcon className="w-3 h-3 ms-1" style={{ color: ph?.color ?? "#ff9933" }} />
      <span className="text-[8px] font-mono ms-0.5" style={{ color: ph?.color ?? "#ff9933" }}>{ph?.label}</span>
      <div className="ms-auto flex items-center gap-1.5">
        <button onClick={onGoToMissions}
          className="flex items-center gap-1 text-[8px] font-mono px-2 py-0.5 rounded-lg transition-all"
          style={{ background: "rgba(255,153,51,0.1)", border: "1px solid rgba(255,153,51,0.25)", color: "#ff9933" }}>
          <ArrowRight className="w-2.5 h-2.5" />فتح المهمة
        </button>
        <button onClick={() => ctx.setActiveMission(null)}
          className="p-0.5 rounded hover:bg-red-500/10">
          <X className="w-2.5 h-2.5 text-white/20 hover:text-red-400 transition-colors" />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CONTEXT FEED — شريط الأحداث الموحّد
═══════════════════════════════════════════════════════════════════════ */

function ContextFeed({ events, onClose, ctx }: { events: ContextEvent[]; onClose: () => void; ctx: HubCtx }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [events]);

  return (
    <div className="w-72 shrink-0 flex flex-col border-r" style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.4)" }}>
        <Layers className="w-3.5 h-3.5" style={{ color: "#ff4444" }} />
        <span className="text-[10px] font-black font-mono tracking-widest" style={{ color: "#ff4444" }}>CONTEXT BRIDGE</span>
        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full ms-auto" style={{ background: "rgba(255,68,68,0.15)", color: "#ff6666", border: "1px solid rgba(255,68,68,0.25)" }}>
          {events.length}
        </span>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/5">
          <ChevronLeft className="w-3.5 h-3.5 text-white/30" />
        </button>
      </div>
      {/* Mission Quick Set */}
      {ctx.activeMission && (
        <div className="px-2 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,153,51,0.05)" }}>
          <div className="flex items-center gap-1.5">
            <Target className="w-3 h-3" style={{ color: "#ff9933" }} />
            <div className="flex-1 min-w-0">
              <div className="text-[8px] font-mono" style={{ color: "rgba(255,153,51,0.6)" }}>المهمة النشطة</div>
              <div className="text-[10px] font-mono font-bold truncate" style={{ color: "#ff9933" }}>{ctx.activeMission.name}</div>
            </div>
            <button onClick={() => ctx.setActiveMission(null)} className="p-0.5">
              <X className="w-2.5 h-2.5 text-white/20" />
            </button>
          </div>
        </div>
      )}
      {/* Events */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0" style={{ scrollbarWidth: "thin" }}>
        {events.length === 0 && (
          <div className="text-center py-8 opacity-30">
            <GitBranch className="w-8 h-8 mx-auto mb-2 text-red-400" />
            <p className="text-[10px] font-mono text-white">Context Bridge جاهز</p>
            <p className="text-[8px] font-mono text-gray-500 mt-1">نفّذ أوامر في أي تبويب<br/>لتراها هنا مجتمعة</p>
          </div>
        )}
        {[...events].reverse().map(ev => (
          <div key={ev.id} className="rounded-lg px-2.5 py-2 relative"
            style={{ background: ev.isError ? "rgba(255,68,68,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${ev.isError ? "rgba(255,68,68,0.15)" : "rgba(255,255,255,0.05)"}` }}>
            <div className="flex items-center gap-1.5 mb-1">
              {SOURCE_ICON[ev.source]}
              <span className="text-[8px] font-mono uppercase font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>{ev.source}</span>
              <span className="text-[7px] font-mono ms-auto" style={{ color: "rgba(255,255,255,0.2)" }}>
                {new Date(ev.ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
            <p className="text-[9px] font-mono leading-snug" style={{ color: ev.isError ? "#ff8888" : "rgba(255,255,255,0.65)" }}>{ev.text.substring(0, 120)}</p>
            {ev.detail && (
              <p className="text-[8px] font-mono mt-0.5 truncate" style={{ color: "rgba(68,255,136,0.5)" }}>{ev.detail.substring(0, 80)}</p>
            )}
            {/* Log to mission button */}
            {ctx.activeMission && (ev.type === "cmd" || ev.type === "task") && (
              <button onClick={() => void ctx.logToMission(ev.text, ev.detail ?? "", ev.source)}
                className="mt-1.5 flex items-center gap-1 text-[8px] font-mono px-2 py-0.5 rounded transition-all"
                style={{ background: "rgba(255,153,51,0.08)", border: "1px solid rgba(255,153,51,0.2)", color: "rgba(255,153,51,0.8)" }}>
                <Link className="w-2 h-2" />log to mission
              </button>
            )}
          </div>
        ))}
      </div>
      {/* Clear */}
      {events.length > 0 && (
        <div className="px-2 py-2 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button className="w-full text-[9px] font-mono py-1.5 rounded-lg transition-all text-center"
            style={{ border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)" }}
            onClick={() => {}}>
            <Trash2 className="w-2.5 h-2.5 inline me-1" />لا يمكن مسح الأحداث (للمراجعة فقط)
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LOCAL TOOL CATALOG
═══════════════════════════════════════════════════════════════════════ */

const LOCAL_TOOL_CATS = [
  { label: "الشبكة",     icon: Network, tools: [
    { name: "nmap",       desc: "مسح المنافذ",     cmd: "nmap -sV --top-ports 1000 localhost 2>&1 | tail -40" },
    { name: "netstat",    desc: "المنافذ المفتوحة", cmd: "ss -tulpn 2>/dev/null || netstat -tulpn" },
    { name: "ip addr",    desc: "عناوين IP",        cmd: "ip addr show 2>/dev/null || ipconfig" },
    { name: "traceroute", desc: "تتبع المسار",       cmd: "traceroute 8.8.8.8 2>&1 | head -15 || tracert 8.8.8.8" },
  ]},
  { label: "النظام",     icon: Cpu, tools: [
    { name: "uname",   desc: "معلومات النظام", cmd: "uname -a && whoami && id" },
    { name: "df -h",   desc: "مساحة القرص",   cmd: "df -h" },
    { name: "ps aux",  desc: "العمليات",       cmd: "ps aux --sort=-%cpu | head -20 2>/dev/null || tasklist" },
    { name: "crontab", desc: "المهام المجدولة", cmd: "crontab -l 2>/dev/null; cat /etc/crontab 2>/dev/null | head -20" },
  ]},
  { label: "الاستطلاع", icon: Search, tools: [
    { name: "gobuster", desc: "فحص المسارات",   cmd: "gobuster dir -u http://localhost -w /usr/share/wordlists/dirb/common.txt -t 20 2>&1 | tail -30" },
    { name: "nikto",    desc: "فحص الويب",       cmd: "nikto -h http://localhost -C all 2>&1 | tail -40" },
    { name: "whatweb",  desc: "تقنيات الموقع",   cmd: "whatweb http://localhost -v 2>&1 | tail -20" },
    { name: "curl",     desc: "طلب HTTP",         cmd: "curl -sI http://localhost" },
  ]},
  { label: "الامتيازات", icon: Shield, tools: [
    { name: "sudo -l",      desc: "صلاحيات sudo", cmd: "sudo -l 2>/dev/null" },
    { name: "SUID",         desc: "ملفات SUID",   cmd: "find / -perm -u=s -type f 2>/dev/null | head -20" },
    { name: "Capabilities", desc: "الصلاحيات",    cmd: "getcap -r / 2>/dev/null | head -20" },
    { name: "env",          desc: "المتغيرات",     cmd: "env | head -30" },
  ]},
  { label: "كسر كلمات", icon: Lock, tools: [
    { name: "hydra ssh", desc: "هجوم SSH",       cmd: "hydra -l root -P /usr/share/wordlists/rockyou.txt -t 4 ssh://127.0.0.1 2>&1 | head -20" },
    { name: "john",      desc: "كسر Hashes",     cmd: "john --list=formats 2>&1 | head -5" },
    { name: "hashcat",   desc: "كسر GPU",        cmd: "hashcat --version 2>&1" },
    { name: "hashid",    desc: "تحديد نوع Hash", cmd: "echo '5f4dcc3b5aa765d61d8327deb882cf99' | hashid" },
  ]},
  { label: "OSINT",      icon: Globe, tools: [
    { name: "subfinder",    desc: "النطاقات الفرعية", cmd: "subfinder -d example.com -silent 2>&1 | head -20" },
    { name: "theHarvester", desc: "بصمة الهدف",       cmd: "theHarvester -d example.com -b google -l 20 2>&1 | tail -20" },
    { name: "whois",        desc: "معلومات النطاق",   cmd: "whois example.com 2>&1 | head -30" },
    { name: "dig",          desc: "DNS",               cmd: "dig any example.com +short 2>&1 | head -20" },
  ]},
];

const KALI_QUICK_PROMPTS = [
  { label: "تدقيق النظام",   color: "#ff4444", icon: Skull,   prompt: "نفّذ تدقيقاً شاملاً للنظام الآن: معلومات السيرفر، العمليات، الشبكة، والأجهزة المتصلة. قدّم تقريراً كاملاً." },
  { label: "صيد التهديدات",  color: "#ff6600", icon: Target,  prompt: "ابدأ عملية صيد التهديدات. فتّش عن نشاط مشبوه، اتصالات غير عادية، ملفات جديدة، وعمليات مجهولة." },
  { label: "مسح الشبكة",     color: "#00aaff", icon: Network, prompt: "نفّذ مسح شبكي كامل للبيئة المحلية. اكتشف الأجهزة، المنافذ المفتوحة، والخدمات الجارية." },
  { label: "راجع ذاكرتك",    color: "#aa44ff", icon: Brain,   prompt: "راجع كل ما تعلّمته من الجلسات السابقة. صنّف المعرفة وأخبرني بأهم الاكتشافات." },
  { label: "فحص الثغرات",    color: "#44ff88", icon: Shield,  prompt: "ابحث عن ثغرات في النظام. استخدم CVE database وقارن مع الخدمات المكتشفة." },
  { label: "استقلالية كاملة", color: "#ffaa00", icon: Zap,    prompt: "وضع الاستقلالية الكاملة — قيّم النظام، ضع خطة تحسين أمني، ونفّذها تدريجياً مع إبلاغي بكل خطوة." },
];

/* ═══════════════════════════════════════════════════════════════════════
   KALI AI PANEL
═══════════════════════════════════════════════════════════════════════ */

interface KaliChatMsg {
  id: string; role: "user" | "assistant" | "system" | "plan" | "exec_result";
  text: string; isError?: boolean; ts: number;
  cmd?: string; cmdOutput?: string;  // for log-to-mission
}

function KaliAiPanel({ intel, hasDevice, loadIntel, ctx }: {
  intel: SystemIntel | null; hasDevice: boolean; loadIntel: () => void; ctx: HubCtx;
}) {
  const sessionId  = useRef(`kali-hub-${Date.now()}`);
  const [msgs, setMsgs]         = useState<KaliChatMsg[]>([]);
  const [input, setInput]       = useState("");
  const [busy, setBusy]         = useState(false);
  const [streaming, setStreaming] = useState(false);
  const abortRef                = useRef<AbortController | null>(null);
  const scrollRef               = useRef<HTMLDivElement>(null);
  const [tasks, setTasks]       = useState<KaliTask[]>([]);
  const [taskTab, setTaskTab]   = useState<"tasks" | "device" | "terminal" | "services">("tasks");
  const [termLog, setTermLog]   = useState<{text: string; isError: boolean; ts: number}[]>([]);
  const [cmdInput, setCmdInput] = useState("");
  const [cmdBusy, setCmdBusy]   = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  const loadTasks = useCallback(async () => {
    try { const r = await fetch(`${API}/kali-command/tasks`); if (r.ok) setTasks(await r.json()); } catch {}
  }, []);

  useEffect(() => {
    loadIntel(); loadTasks();
    const iv = setInterval(() => { loadIntel(); loadTasks(); }, 8000);
    return () => clearInterval(iv);
  }, [loadIntel, loadTasks]);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/ws`;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      try {
        ws = new WebSocket(url);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data as string);
            if (msg.type === "kali_task_update" && msg.data?.task) {
              setTasks(prev => { const idx = prev.findIndex(t => t.id === msg.data.task.id); if (idx >= 0) { const n = [...prev]; n[idx] = msg.data.task; return n; } return [msg.data.task, ...prev]; });
            }
          } catch {}
        };
        ws.onclose = () => { timer = setTimeout(connect, 3000); };
      } catch {}
    };
    connect();
    return () => { ws?.close(); clearTimeout(timer); };
  }, []);

  const buildPrompt = (text: string) => {
    if (!ctx.activeMission) return text;
    return `[المهمة النشطة: ${ctx.activeMission.name} | الهدف: ${ctx.activeMission.target} | المرحلة: ${ctx.activeMission.phase}]\n\n${text}`;
  };

  const send = async (prompt?: string) => {
    const rawText = (prompt ?? input).trim();
    if (!rawText || busy) return;
    const text = buildPrompt(rawText);
    setInput(""); setBusy(true); setStreaming(true);
    setMsgs(prev => [...prev, { id: uid(), role: "user", text: rawText, ts: Date.now() }]);
    ctx.addEvent({ source: "kali", type: "message", text: rawText });
    const asstId = uid();
    setMsgs(prev => [...prev, { id: asstId, role: "assistant", text: "", ts: Date.now() }]);
    abortRef.current = new AbortController();
    try {
      let asstText = "";
      for await (const { event, data } of kaliStreamChat(sessionId.current, text, abortRef.current.signal)) {
        if (event === "delta") {
          asstText += (data as { text: string }).text;
          setMsgs(prev => prev.map(m => m.id === asstId ? { ...m, text: asstText } : m));
        }
        if (event === "exec_result") {
          const d = data as { command: string; result: string; isError: boolean; type?: string };
          const icon = d.type === "agent" ? "🖥️" : "⚡";
          const msgId = uid();
          setMsgs(prev => [...prev, { id: msgId, role: "exec_result", text: `${icon} ${d.isError ? "❌" : "✅"}: \`${d.command}\`\n\`\`\`\n${d.result}\n\`\`\``, isError: d.isError, ts: Date.now(), cmd: d.command, cmdOutput: d.result }]);
          setTermLog(prev => [...prev.slice(-200), { text: `$ ${d.command}\n${d.result}`, isError: d.isError, ts: Date.now() }]);
          ctx.addEvent({ source: "kali", type: "cmd", text: d.command, detail: d.result.substring(0, 100), isError: d.isError });
        }
        if (event === "plan_proposed") {
          setMsgs(prev => [...prev, { id: uid(), role: "plan", text: (data as { plan: string }).plan, ts: Date.now() }]);
        }
        if (event === "task_created") loadTasks();
        if (event === "error") {
          setMsgs(prev => prev.map(m => m.id === asstId ? { ...m, text: "❌ خطأ في الاتصال بـ KALI AI — تحقق من إعدادات Ollama", isError: true } : m));
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        setMsgs(prev => prev.map(m => m.id === asstId ? { ...m, text: "⚠️ انقطع الاتصال بـ KALI AI", isError: true } : m));
      }
    } finally { setBusy(false); setStreaming(false); abortRef.current = null; loadTasks(); }
  };

  const execCmd = async (cmd: string, target: "agent" | "server") => {
    if (!cmd.trim() || cmdBusy) return;
    setCmdBusy(true); setCmdInput("");
    setTermLog(prev => [...prev, { text: `$ [${target === "agent" ? "DEVICE" : "SERVER"}] ${cmd}`, isError: false, ts: Date.now() }]);
    try {
      const ep = target === "agent" ? "/kali-command/agent/exec" : "/kali-command/server/exec";
      const r = await fetch(`${API}${ep}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: cmd }) });
      const d = await r.json();
      const out = String(d.result?.stdout || d.stdout || d.result || d.error || JSON.stringify(d)).substring(0, 3000);
      setTermLog(prev => [...prev, { text: out, isError: !r.ok, ts: Date.now() }]);
      ctx.addEvent({ source: "kali", type: "cmd", text: cmd, detail: out.substring(0, 100), isError: !r.ok });
    } catch (e: unknown) {
      setTermLog(prev => [...prev, { text: `خطأ: ${String(e)}`, isError: true, ts: Date.now() }]);
    } finally { setCmdBusy(false); }
  };

  const logMsgToMission = async (m: KaliChatMsg) => {
    if (!ctx.activeMission || !m.cmd) return;
    setLoggingId(m.id);
    await ctx.logToMission(m.cmd, m.cmdOutput ?? "", "KALI AI");
    setLoggingId(null);
  };

  return (
    <div className="flex flex-1 min-h-0">
      {/* LEFT Chat */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0" style={{ borderRight: "1px solid rgba(255,30,30,0.15)" }}>
        <ActiveMissionBanner ctx={ctx} onGoToMissions={() => ctx.navigateTo("missions")} />
        {/* Quick prompts */}
        <div className="flex gap-1.5 px-3 py-2 shrink-0 flex-wrap" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.3)" }}>
          {KALI_QUICK_PROMPTS.map(q => (
            <button key={q.label} onClick={() => void send(q.prompt)} disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all disabled:opacity-40"
              style={{ background: `${q.color}14`, border: `1px solid ${q.color}40`, color: q.color }}>
              <q.icon className="w-3 h-3" />{q.label}
            </button>
          ))}
        </div>
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,30,30,0.2) transparent" }}>
          {msgs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 opacity-40">
              <Skull className="w-16 h-16" style={{ color: "#ff3333", filter: "drop-shadow(0 0 20px rgba(255,0,0,0.5))" }} />
              <div className="text-center">
                <p className="text-sm font-black tracking-widest" style={{ color: "#ff4444" }}>KALI AI — جاهز للعمل</p>
                <p className="text-xs font-mono mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                  {ctx.activeMission ? `🎯 سيعمل على: ${ctx.activeMission.name} (${ctx.activeMission.target})` : "اكتب مهمتك أو اختر من الأوامر السريعة"}
                </p>
              </div>
            </div>
          )}
          {msgs.map(m => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
              {m.role === "user" ? (
                <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap" style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)" }} dir="rtl">
                  <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: "#ff5555" }}>أنت</div>
                  <span style={{ color: "rgba(255,255,255,0.8)" }}>{m.text}</span>
                </div>
              ) : m.role === "plan" ? (
                <div className="max-w-[90%] rounded-xl px-4 py-3" style={{ background: "rgba(255,170,0,0.06)", border: "1px solid rgba(255,170,0,0.25)" }} dir="rtl">
                  <div className="text-[9px] font-black font-mono uppercase mb-2" style={{ color: "#ffaa44" }}>📋 خطة KALI AI</div>
                  <div className="text-[10px] font-mono space-y-0.5">{renderKaliText(m.text)}</div>
                </div>
              ) : (
                <div className="max-w-[88%] rounded-xl px-4 py-3" style={{ background: m.isError ? "rgba(255,50,50,0.08)" : "rgba(0,0,0,0.5)", border: `1px solid ${m.isError ? "rgba(255,50,50,0.3)" : "rgba(68,255,136,0.15)"}` }}>
                  <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: m.isError ? "#ff5555" : "#44eebb" }}>⚡ KALI AI</div>
                  <div className="text-[10px] font-mono space-y-0.5">{renderKaliText(m.text)}</div>
                  {/* Log to mission button for exec results */}
                  {m.cmd && ctx.activeMission && (
                    <button onClick={() => void logMsgToMission(m)} disabled={loggingId === m.id}
                      className="mt-2 flex items-center gap-1.5 text-[8px] font-mono px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                      style={{ background: "rgba(255,153,51,0.1)", border: "1px solid rgba(255,153,51,0.3)", color: "#ff9933" }}>
                      {loggingId === m.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Link className="w-2.5 h-2.5" />}
                      🔗 تسجيل في المهمة: {ctx.activeMission.name}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Input */}
        <div className="px-3 py-2.5 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)" }}>
          {ctx.activeMission && (
            <div className="flex items-center gap-1.5 mb-1.5 text-[9px] font-mono" style={{ color: "rgba(255,153,51,0.6)" }}>
              <Target className="w-2.5 h-2.5" />
              سيرسل مع سياق المهمة: {ctx.activeMission.target}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="اكتب مهمتك لـ KALI AI... (Enter للإرسال)"
              rows={2} disabled={busy}
              className="flex-1 resize-none rounded-xl px-3 py-2 text-sm font-mono disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,50,50,0.25)", color: "rgba(255,255,255,0.85)", outline: "none", lineHeight: 1.5 }}
            />
            {busy ? (
              <button onClick={() => abortRef.current?.abort()} className="px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs font-mono font-bold" style={{ background: "rgba(255,50,50,0.15)", border: "1px solid rgba(255,50,50,0.4)", color: "#ff5555" }}>
                <Square className="w-3.5 h-3.5" />إيقاف
              </button>
            ) : (
              <button onClick={() => void send()} disabled={!input.trim()} className="px-4 py-2 rounded-xl flex items-center gap-1.5 text-xs font-mono font-bold transition-all disabled:opacity-30" style={{ background: "rgba(255,30,30,0.18)", border: "1px solid rgba(255,50,50,0.5)", color: "#ff5555" }}>
                <Send className="w-3.5 h-3.5" />إرسال
              </button>
            )}
          </div>
          {streaming && <div className="flex items-center gap-1.5 mt-1.5"><Loader2 className="w-3 h-3 animate-spin" style={{ color: "#ff4444" }} /><span className="text-[9px] font-mono" style={{ color: "rgba(255,100,100,0.6)" }}>KALI AI يفكر ويعالج...</span></div>}
        </div>
      </div>

      {/* RIGHT Control */}
      <div className="w-[380px] shrink-0 flex flex-col min-h-0">
        <div className="flex shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.4)" }}>
          {([["tasks","المهام",Activity],["device","الجهاز",Monitor],["terminal","الطرفية",Terminal],["services","الخدمات",Server]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTaskTab(id as typeof taskTab)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono font-bold transition-all"
              style={taskTab === id ? { background: "rgba(255,30,30,0.12)", borderBottom: "2px solid #ff4444", color: "#ff5555" } : { color: "rgba(255,255,255,0.3)", borderBottom: "2px solid transparent" }}>
              <Icon className="w-3 h-3" />{label}
              {id === "tasks" && tasks.filter(t => t.status === "running").length > 0 && (
                <span className="w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center" style={{ background: "#ff4444", color: "#fff" }}>{tasks.filter(t => t.status === "running").length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,30,30,0.15) transparent" }}>
          {taskTab === "tasks" && (
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold tracking-widest" style={{ color: "rgba(255,80,80,0.7)" }}>⚡ المهام الحية</span>
                {tasks.length > 0 && <button onClick={async () => { await fetch(`${API}/kali-command/tasks`, { method: "DELETE" }); setTasks([]); }} className="text-[9px] font-mono px-1.5 rounded" style={{ color: "rgba(255,60,60,0.5)", border: "1px solid rgba(255,60,60,0.2)" }}>مسح</button>}
              </div>
              {tasks.length === 0 && <div className="text-center py-8 font-mono text-xs" style={{ color: "rgba(255,255,255,0.15)" }}>لا توجد مهام — ابدأ محادثة مع KALI AI</div>}
              {tasks.map(task => (
                <div key={task.id} className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: taskStatusColor(task.status), boxShadow: `0 0 6px ${taskStatusColor(task.status)}` }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-mono font-bold text-white/80 truncate">{task.title}</p>
                      <p className="text-[9px] font-mono mt-0.5" style={{ color: taskStatusColor(task.status) }}>{task.status}</p>
                    </div>
                    <button onClick={async () => { await fetch(`${API}/kali-command/tasks/${task.id}`, { method: "DELETE" }); setTasks(prev => prev.filter(t => t.id !== task.id)); }} className="shrink-0 p-1 rounded hover:bg-red-500/10"><X className="w-3 h-3 text-red-500/50" /></button>
                  </div>
                  {task.command && <div className="rounded-lg px-2 py-1 font-mono text-[9px]" style={{ background: "rgba(68,255,136,0.05)", color: "rgba(68,255,136,0.7)" }} dir="ltr">$ {task.command.substring(0, 80)}</div>}
                  {task.result && <div className="rounded-lg px-2 py-1 font-mono text-[9px] max-h-20 overflow-y-auto" style={{ background: "rgba(0,0,0,0.4)", color: "rgba(200,255,200,0.7)" }} dir="ltr">{task.result.substring(0, 400)}</div>}
                  {/* Log to mission */}
                  {ctx.activeMission && task.command && (task.status === "done" || task.status === "failed") && (
                    <button onClick={() => void ctx.logToMission(task.command!, task.result ?? "", "KALI Task")}
                      className="flex items-center gap-1 text-[8px] font-mono px-2 py-0.5 rounded transition-all"
                      style={{ background: "rgba(255,153,51,0.08)", border: "1px solid rgba(255,153,51,0.2)", color: "rgba(255,153,51,0.8)" }}>
                      <Link className="w-2 h-2" />🔗 log to {ctx.activeMission.name}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {taskTab === "device" && (
            <div className="p-3 space-y-3">
              {!hasDevice ? (
                <div className="text-center py-8 space-y-3"><WifiOff className="w-10 h-10 mx-auto" style={{ color: "rgba(255,50,50,0.3)" }} /><p className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>لا يوجد جهاز متصل</p></div>
              ) : intel?.agents.map(agent => (
                <div key={agent.id} className="rounded-xl p-3 space-y-2" style={{ background: "rgba(68,255,136,0.04)", border: "1px solid rgba(68,255,136,0.2)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ boxShadow: "0 0 8px #44ff88" }} />
                    <span className="text-xs font-mono font-bold" style={{ color: "#44ff88" }}>{agent.hostname}</span>
                    <span className="text-[9px] font-mono ms-auto" style={{ color: "rgba(255,255,255,0.35)" }}>{agent.platform}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>
                    <span>user: {agent.user}</span><span>caps: {agent.capabilities?.length || 0}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {agent.capabilities?.map((c: string) => <span key={c} className="px-1.5 py-0.5 rounded text-[8px] font-mono" style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.2)", color: "#44ff88" }}>{c}</span>)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {taskTab === "terminal" && (
            <div className="flex flex-col h-full p-2 gap-2 min-h-0">
              <div className="flex-1 overflow-y-auto rounded-xl p-3 font-mono text-[10px] space-y-1 min-h-0" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.06)" }}>
                {termLog.length === 0 && <span style={{ color: "rgba(255,255,255,0.15)" }}>-- KALI AI Exec Log -- نفّذ أمراً أو تحدث مع KALI AI --</span>}
                {termLog.map((l, i) => <div key={i} className="whitespace-pre-wrap break-all" style={{ color: l.isError ? "#ff6666" : "rgba(68,255,136,0.85)", lineHeight: 1.5 }}>{l.text}</div>)}
              </div>
              <div className="flex gap-1.5">
                <input value={cmdInput} onChange={e => setCmdInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { void execCmd(cmdInput, hasDevice ? "agent" : "server"); setCmdInput(""); } }}
                  placeholder={hasDevice ? "$ أمر على الجهاز..." : "$ أمر على السيرفر..."} disabled={cmdBusy}
                  className="flex-1 rounded-lg px-3 py-1.5 text-xs font-mono disabled:opacity-50"
                  style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,50,50,0.2)", color: "#44ff88", outline: "none" }} />
                <button onClick={() => void execCmd(cmdInput, "server")} disabled={cmdBusy || !cmdInput.trim()} className="px-2 py-1.5 rounded-lg text-[9px] font-mono font-bold disabled:opacity-30" style={{ background: "rgba(100,100,255,0.1)", border: "1px solid rgba(100,100,255,0.3)", color: "#6699ff" }}>SRV</button>
                {hasDevice && <button onClick={() => void execCmd(cmdInput, "agent")} disabled={cmdBusy || !cmdInput.trim()} className="px-2 py-1.5 rounded-lg text-[9px] font-mono font-bold disabled:opacity-30" style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.3)", color: "#44ff88" }}>DEV</button>}
                <button onClick={() => setTermLog([])} className="px-2 py-1.5 rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          )}
          {taskTab === "services" && intel && (
            <div className="p-3 space-y-2">
              <div className="text-[10px] font-mono font-bold mb-2" style={{ color: "rgba(255,80,80,0.7)" }}>⚙️ حالة النظام</div>
              {[
                { l: "السيرفر", v: intel.server.hostname, c: "#6699ff", I: Server },
                { l: "المنصة", v: `${intel.server.platform}/${intel.server.arch}`, c: "#44ff88", I: Cpu },
                { l: "الذاكرة", v: intel.server.memUsage, c: "#cc44ff", I: MemoryStick },
                { l: "وقت التشغيل", v: intel.server.uptime, c: "#44ffaa", I: Clock },
                { l: "الأجهزة المتصلة", v: `${intel.agentCount}`, c: intel.agentCount > 0 ? "#44ff88" : "#ff4444", I: Wifi },
                { l: "قاعدة المعرفة", v: `${intel.knowledgeCount} إدخال`, c: "#ff44cc", I: Brain },
              ].map(({ l, v, c, I }) => (
                <div key={l} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <I className="w-3.5 h-3.5 shrink-0" style={{ color: c }} />
                  <span className="text-[10px] font-mono flex-1" style={{ color: "rgba(255,255,255,0.4)" }}>{l}</span>
                  <span className="text-[10px] font-mono font-bold" style={{ color: c }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LOCAL DEVICE CONTROL PANEL
═══════════════════════════════════════════════════════════════════════ */

interface ConnectInfo {
  wsUrl: string; agentUrl: string; primaryDomain: string;
  connected: boolean; agentCount: number;
  oneLineBash: string; oneLineWget: string; manualCmd: string;
}

function LocalControlPanel({ intel, ctx }: { intel: SystemIntel | null; ctx: HubCtx }) {
  const [agents, setAgents]         = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [connected, setConnected]   = useState(false);
  const [preflight, setPreflight]   = useState<Preflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [connectInfo, setConnectInfo] = useState<ConnectInfo | null>(null);
  const [copiedKey, setCopiedKey]   = useState<string | null>(null);
  const [lines, setLines]           = useState<TermLine[]>([
    { kind: "system", text: "مرحباً في Local Device Control — اختر الوكيل ونفّذ أوامرك", ts: Date.now() },
  ]);
  const [cmdInput, setCmdInput]     = useState("");
  const [busy, setBusy]             = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [section, setSection]       = useState<"terminal" | "tools" | "fingerprint">("terminal");
  const [expandedCat, setExpandedCat] = useState<string | null>("الشبكة");
  const [loggingLine, setLoggingLine] = useState<number | null>(null);
  const termRef = useRef<HTMLDivElement>(null);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const addLine = useCallback((line: TermLine) => {
    setLines(prev => [...prev.slice(-500), line]);
    setTimeout(() => termRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 30);
  }, []);

  const pollAgents = useCallback(async () => {
    try {
      const [statusRes, infoRes] = await Promise.all([
        fetch(`${API}/local-agent/status`),
        fetch(`${API}/local-agent/connect-info`),
      ]);
      if (statusRes.ok) {
        const d = await statusRes.json() as { connected: boolean; agents?: AgentInfo[] };
        setConnected(d.connected);
        if (d.agents && d.agents.length > 0) { setAgents(d.agents); if (!selectedAgent) setSelectedAgent(d.agents[0].id); }
        else if (!d.connected) setAgents([]);
      }
      if (infoRes.ok) {
        setConnectInfo(await infoRes.json() as ConnectInfo);
      }
    } catch {}
  }, [selectedAgent]);

  useEffect(() => { void pollAgents(); const t = setInterval(pollAgents, 5000); return () => clearInterval(t); }, [pollAgents]);

  // When active mission changes, show it in terminal
  useEffect(() => {
    if (ctx.activeMission) {
      addLine({ kind: "system", text: `🎯 المهمة النشطة: ${ctx.activeMission.name} — الهدف: ${ctx.activeMission.target}`, ts: Date.now() });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.activeMission?.id]);

  const runPreflight = useCallback(async () => {
    setPreflightLoading(true);
    addLine({ kind: "system", text: "🔍 جاري فحص النظام (Pre-Flight)...", ts: Date.now() });
    try {
      const r = await fetch(`${API}/kali-command/preflight`);
      if (r.ok) {
        const d = await r.json() as Preflight;
        setPreflight(d);
        setSection("fingerprint");
        addLine({ kind: "system", text: d.connected ? `✅ Fingerprint: ${d.hostname} [${d.platform}] — ${d.toolCount ?? d.tools.length} أداة` : "❌ لا يوجد وكيل متصل", ts: Date.now() });
        ctx.addEvent({ source: "local", type: "connection", text: d.connected ? `Fingerprint: ${d.hostname} (${d.platform})` : "No agent connected" });
      }
    } catch (e) { addLine({ kind: "error", text: `خطأ Preflight: ${String(e)}`, ts: Date.now() }); }
    setPreflightLoading(false);
  }, [addLine, ctx]);

  const execCmd = useCallback(async (cmd: string) => {
    if (!cmd.trim() || busy) return;
    if (!selectedAgent) { addLine({ kind: "error", text: "لا يوجد وكيل متصل — شغّل nova-agent.js أولاً", ts: Date.now() }); return; }
    const lineIdx = lines.length;
    addLine({ kind: "cmd", text: `[kali]$ ${cmd}`, ts: Date.now() });
    setCmdHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistoryIdx(-1);
    setBusy(true);
    let fullOutput = "";
    try {
      const es = new EventSource(`${API}/local-agent/exec-stream?agentId=${encodeURIComponent(selectedAgent)}&command=${encodeURIComponent(cmd)}`);
      await new Promise<void>(res => {
        es.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data) as { type: string; data?: string; exitCode?: number; error?: string };
            if (d.type === "stdout" && d.data?.trim()) { addLine({ kind: "stdout", text: d.data, ts: Date.now() }); fullOutput += d.data; }
            else if (d.type === "stderr" && d.data?.trim()) { addLine({ kind: "stderr", text: d.data, ts: Date.now() }); fullOutput += d.data; }
            else if (d.type === "done") { addLine({ kind: "system", text: `[exit ${d.exitCode ?? 0}]`, ts: Date.now() }); es.close(); res(); }
            else if (d.type === "error") { addLine({ kind: "error", text: d.error ?? "خطأ", ts: Date.now() }); es.close(); res(); }
          } catch {}
        };
        es.onerror = () => { es.close(); res(); };
      });
    } catch (e) { addLine({ kind: "error", text: String(e), ts: Date.now() }); }
    ctx.addEvent({ source: "local", type: "cmd", text: cmd, detail: fullOutput.substring(0, 100) });
    setBusy(false);
    void lineIdx; // suppress unused warning
  }, [busy, selectedAgent, addLine, ctx, lines.length]);

  const logLineToMission = async (lineIdx: number) => {
    if (!ctx.activeMission) return;
    const cmdLine = lines[lineIdx];
    if (!cmdLine) return;
    const cmd = cmdLine.text.replace(/^\[kali\]\$ /, "");
    const outputLines: string[] = [];
    for (let i = lineIdx + 1; i < lines.length; i++) {
      if (lines[i].kind === "cmd" || lines[i].kind === "system") break;
      outputLines.push(lines[i].text);
    }
    setLoggingLine(lineIdx);
    await ctx.logToMission(cmd, outputLines.join("\n"), "Local Control");
    setLines(prev => prev.map((l, i) => i === lineIdx ? { ...l, loggedToMission: true } : l));
    setLoggingLine(null);
  };

  const lineColor = (k: TermLine["kind"]) => {
    if (k === "cmd")    return "#44ff88";
    if (k === "stdout") return "rgba(200,255,200,0.85)";
    if (k === "stderr") return "#ffaa44";
    if (k === "error")  return "#ff5555";
    return "rgba(255,255,255,0.4)";
  };

  return (
    <div className="flex flex-1 min-h-0">
      {/* LEFT */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0" style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}>
        <ActiveMissionBanner ctx={ctx} onGoToMissions={() => ctx.navigateTo("missions")} />
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold ${connected ? "text-emerald-400" : "text-red-400"}`}
            style={{ background: connected ? "rgba(68,255,136,0.08)" : "rgba(255,68,68,0.08)", border: `1px solid ${connected ? "rgba(68,255,136,0.3)" : "rgba(255,68,68,0.3)"}` }}>
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? `${agents[0]?.hostname ?? "مُتصل"} متصل` : "لا وكيل متصل"}
          </div>
          {agents.length > 1 && (
            <select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)} className="text-[10px] font-mono px-2 py-1 rounded-lg border outline-none" style={{ background: "rgba(0,0,0,0.5)", borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }}>
              {agents.map(a => <option key={a.id} value={a.id}>{a.hostname}</option>)}
            </select>
          )}
          <div className="ms-auto flex gap-1">
            {(["terminal","tools","fingerprint"] as const).map(s => (
              <button key={s} onClick={() => setSection(s)} className="px-2.5 py-1 rounded-lg text-[9px] font-mono font-bold transition-all"
                style={section === s ? { background: "rgba(255,50,50,0.15)", border: "1px solid rgba(255,50,50,0.4)", color: "#ff5555" } : { border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)" }}>
                {s === "terminal" ? "Terminal" : s === "tools" ? "أدوات" : "Fingerprint"}
              </button>
            ))}
            <button onClick={() => void runPreflight()} disabled={preflightLoading} className="px-2.5 py-1 rounded-lg text-[9px] font-mono font-bold transition-all disabled:opacity-50" style={{ background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.25)", color: "#44ff88" }}>
              {preflightLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Fingerprint className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Terminal */}
        {section === "terminal" && (
          <>
            <div ref={termRef} className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-0.5 min-h-0" style={{ background: "rgba(0,0,0,0.7)", scrollbarWidth: "thin" }}>
              {lines.map((l, i) => (
                <div key={i} className="group leading-relaxed whitespace-pre-wrap break-all relative" dir={l.kind === "cmd" || l.kind === "stdout" ? "ltr" : "auto"} style={{ color: lineColor(l.kind) }}>
                  {l.text}
                  {/* Log to mission button for cmd lines */}
                  {l.kind === "cmd" && ctx.activeMission && !l.loggedToMission && (
                    <button onClick={() => void logLineToMission(i)} disabled={loggingLine === i}
                      className="ms-2 opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 text-[7px] font-mono px-1.5 py-0.5 rounded transition-all"
                      style={{ background: "rgba(255,153,51,0.15)", border: "1px solid rgba(255,153,51,0.3)", color: "#ff9933" }}>
                      {loggingLine === i ? <Loader2 className="w-2 h-2 animate-spin" /> : <Link className="w-2 h-2" />}🔗
                    </button>
                  )}
                  {l.loggedToMission && <span className="ms-2 text-[7px] font-mono text-orange-400/50">✓ logged</span>}
                </div>
              ))}
              {busy && <div className="flex items-center gap-2 text-emerald-400 animate-pulse"><Loader2 className="w-3 h-3 animate-spin" />جاري التنفيذ...</div>}
            </div>
            <div className="px-3 py-2 shrink-0 flex gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)" }}>
              <div className="flex items-center gap-1 text-[11px] font-mono font-bold" style={{ color: "#44ff88" }}>kali$</div>
              <input value={cmdInput} onChange={e => setCmdInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { void execCmd(cmdInput); setCmdInput(""); }
                  if (e.key === "ArrowUp") { const ni = historyIdx + 1; if (ni < cmdHistory.length) { setHistoryIdx(ni); setCmdInput(cmdHistory[ni]); } }
                  if (e.key === "ArrowDown") { const ni = historyIdx - 1; if (ni < 0) { setHistoryIdx(-1); setCmdInput(""); } else { setHistoryIdx(ni); setCmdInput(cmdHistory[ni]); } }
                }}
                placeholder={ctx.activeMission ? `هدف: ${ctx.activeMission.target}` : connected ? "أمر للجهاز..." : "لا وكيل متصل..."} disabled={busy}
                className="flex-1 bg-transparent outline-none font-mono text-[11px]" style={{ color: "#44ff88" }} dir="ltr"
              />
              <div className="flex gap-1">
                {["whoami","uname -a","ip addr","ps aux","ss -tulpn","df -h","id","sudo -l"].map(q => (
                  <button key={q} onClick={() => void execCmd(q)} disabled={busy} className="px-1.5 py-0.5 rounded text-[8px] font-mono disabled:opacity-40 transition-all" style={{ background: "rgba(68,255,136,0.06)", border: "1px solid rgba(68,255,136,0.15)", color: "rgba(68,255,136,0.6)" }}>
                    {q.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {section === "tools" && (
          <div className="flex-1 overflow-y-auto p-3 min-h-0" style={{ scrollbarWidth: "thin" }}>
            <div className="space-y-2">
              {LOCAL_TOOL_CATS.map(cat => (
                <div key={cat.label} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                  <button onClick={() => setExpandedCat(c => c === cat.label ? null : cat.label)} className="w-full flex items-center gap-2 px-3 py-2" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <cat.icon className="w-3.5 h-3.5 text-white/40" />
                    <span className="text-[10px] font-mono font-bold flex-1 text-start" style={{ color: "rgba(255,255,255,0.7)" }}>{cat.label}</span>
                    {expandedCat === cat.label ? <ChevronDown className="w-3 h-3 text-white/30" /> : <ChevronRight className="w-3 h-3 text-white/30" />}
                  </button>
                  {expandedCat === cat.label && (
                    <div className="grid grid-cols-2 gap-1 p-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      {cat.tools.map(tool => (
                        <button key={tool.name} onClick={() => void execCmd(tool.cmd)} className="flex flex-col items-start px-2.5 py-2 rounded-lg text-left transition-all" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <span className="text-[10px] font-mono font-bold" style={{ color: "rgba(255,255,255,0.8)" }}>{tool.name}</span>
                          <span className="text-[8px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{tool.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "fingerprint" && (
          <div className="flex-1 overflow-y-auto p-4 min-h-0" style={{ scrollbarWidth: "thin" }}>
            {!preflight ? (
              <div className="text-center py-12">
                <Fingerprint className="w-12 h-12 mx-auto mb-4 opacity-20" style={{ color: "#44ff88" }} />
                <p className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>اضغط Pre-Flight لفحص الجهاز</p>
                <button onClick={() => void runPreflight()} disabled={preflightLoading || !connected} className="mt-4 flex items-center gap-2 mx-auto px-4 py-2 rounded-xl font-mono text-sm font-bold transition-all disabled:opacity-40" style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.3)", color: "#44ff88" }}>
                  {preflightLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}Pre-Flight
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${preflight.connected ? "text-emerald-400" : "text-red-400"}`} style={{ background: preflight.connected ? "rgba(68,255,136,0.08)" : "rgba(255,68,68,0.08)", border: `1px solid ${preflight.connected ? "rgba(68,255,136,0.3)" : "rgba(255,68,68,0.3)"}` }}>
                  {preflight.connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                  <span className="font-mono text-sm font-bold">{preflight.connected ? "LIVE CONNECTION" : "NO AGENT"}</span>
                </div>
                {preflight.connected && (
                  <div className="grid grid-cols-2 gap-2">
                    {[{ l: "Hostname", v: preflight.hostname },{ l: "User", v: preflight.user },{ l: "Platform", v: preflight.platform },{ l: "Arch", v: preflight.arch ?? "?" },{ l: "IP", v: preflight.ip ?? "?" },{ l: "Tools", v: `${preflight.toolCount ?? preflight.tools.length} أداة` }].map(({ l, v }) => (
                      <div key={l} className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="text-[8px] font-mono uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>{l}</div>
                        <div className="text-[11px] font-mono font-bold" style={{ color: "#44ff88" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
                {preflight.tools.length > 0 && (
                  <div>
                    <p className="text-[9px] font-mono mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>الأدوات ({preflight.tools.length}):</p>
                    <div className="flex flex-wrap gap-1">{preflight.tools.map(t => <span key={t} className="px-1.5 py-0.5 rounded text-[8px] font-mono" style={{ background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.15)", color: "#44ff88" }}>{t}</span>)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT: Connection Info + Agents */}
      <div className="w-72 shrink-0 flex flex-col min-h-0" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>

        {/* ── Connection Info Card ── */}
        <div className="shrink-0 p-2.5 space-y-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.5)" }}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} style={{ boxShadow: connected ? "0 0 6px #44ff88" : "0 0 6px #ff4444" }} />
            <span className="text-[10px] font-mono font-black tracking-widest" style={{ color: connected ? "#44ff88" : "#ff4444" }}>
              {connected ? `متصل — ${agents.length} جهاز` : "في انتظار الاتصال"}
            </span>
            <button onClick={() => void pollAgents()} className="ms-auto p-1 rounded hover:bg-white/5">
              <RefreshCw className="w-3 h-3 text-white/30" />
            </button>
          </div>

          {/* WSS URL */}
          {connectInfo && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(68,255,136,0.2)", background: "rgba(0,0,0,0.6)" }}>
              <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: "1px solid rgba(68,255,136,0.1)", background: "rgba(68,255,136,0.05)" }}>
                <Link className="w-2.5 h-2.5" style={{ color: "rgba(68,255,136,0.6)" }} />
                <span className="text-[8px] font-mono font-bold tracking-widest" style={{ color: "rgba(68,255,136,0.6)" }}>WSS SERVER URL</span>
                <button onClick={() => copyText(connectInfo.wsUrl, "wss")} className="ms-auto text-[8px] font-mono px-1.5 py-0.5 rounded transition-all" style={{ background: copiedKey === "wss" ? "rgba(68,255,136,0.2)" : "rgba(68,255,136,0.06)", color: copiedKey === "wss" ? "#44ff88" : "rgba(68,255,136,0.5)", border: "1px solid rgba(68,255,136,0.2)" }}>
                  {copiedKey === "wss" ? "✓ تم" : "📋 نسخ"}
                </button>
              </div>
              <div className="px-2 py-1.5 font-mono text-[9px] break-all" style={{ color: "#44ffaa" }} dir="ltr">{connectInfo.wsUrl}</div>
            </div>
          )}

          {/* One-liner command */}
          {connectInfo && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,170,0,0.2)", background: "rgba(0,0,0,0.6)" }}>
              <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: "1px solid rgba(255,170,0,0.1)", background: "rgba(255,170,0,0.05)" }}>
                <Terminal className="w-2.5 h-2.5" style={{ color: "rgba(255,170,0,0.6)" }} />
                <span className="text-[8px] font-mono font-bold tracking-widest" style={{ color: "rgba(255,170,0,0.6)" }}>شغّل على كالي</span>
                <button onClick={() => copyText(connectInfo.oneLineBash, "cmd")} className="ms-auto text-[8px] font-mono px-1.5 py-0.5 rounded transition-all" style={{ background: copiedKey === "cmd" ? "rgba(255,170,0,0.2)" : "rgba(255,170,0,0.06)", color: copiedKey === "cmd" ? "#ffaa00" : "rgba(255,170,0,0.5)", border: "1px solid rgba(255,170,0,0.2)" }}>
                  {copiedKey === "cmd" ? "✓ تم" : "📋 نسخ"}
                </button>
              </div>
              <pre className="px-2 py-1.5 font-mono text-[8px] whitespace-pre-wrap break-all leading-relaxed" style={{ color: "rgba(255,200,100,0.85)" }} dir="ltr">{connectInfo.oneLineBash}</pre>
            </div>
          )}

          {/* Download button */}
          <a href={`${API}/local-agent/download-nova-agent`} className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-mono text-[9px] font-bold transition-all" style={{ background: "rgba(68,255,136,0.05)", border: "1px solid rgba(68,255,136,0.18)", color: "rgba(68,255,136,0.6)" }}>
            <Download className="w-3 h-3" />تحميل nova-agent.js مباشرة
          </a>
        </div>

        {/* ── Agents List ── */}
        <div className="px-3 py-2 shrink-0 font-mono text-[10px] font-bold tracking-widest" style={{ color: "rgba(255,80,80,0.7)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          ⚡ الأجهزة المتصلة ({agents.length})
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
          {agents.length === 0 ? (
            <div className="text-center py-6">
              <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-20 text-red-400" />
              <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>في انتظار الاتصال</p>
              <p className="text-[9px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.12)" }}>انسخ الأمر أعلاه وشغّله على كالي</p>
            </div>
          ) : agents.map(a => (
            <button key={a.id} onClick={() => setSelectedAgent(a.id)} className="w-full text-left rounded-xl p-2.5 transition-all" style={{ background: selectedAgent === a.id ? "rgba(68,255,136,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${selectedAgent === a.id ? "rgba(68,255,136,0.3)" : "rgba(255,255,255,0.06)"}` }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: "0 0 6px #44ff88" }} />
                <span className="text-[10px] font-mono font-bold" style={{ color: "#44ff88" }}>{a.hostname}</span>
                {selectedAgent === a.id && <span className="ms-auto text-[7px] font-mono px-1 rounded" style={{ background: "rgba(68,255,136,0.15)", color: "#44ff88" }}>نشط</span>}
              </div>
              <div className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{a.user} · {a.platform}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {(a.capabilities ?? []).slice(0, 4).map((c: string) => (
                  <span key={c} className="text-[7px] font-mono px-1 rounded" style={{ background: "rgba(68,255,136,0.07)", color: "rgba(68,255,136,0.5)" }}>{c}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MISSION TRACKER PANEL
═══════════════════════════════════════════════════════════════════════ */

function MissionTrackerPanel({ ctx }: { ctx: HubCtx }) {
  const [missions, setMissions]   = useState<Mission[]>([]);
  const [selected, setSelected]   = useState<Mission | null>(null);
  const [loading, setLoading]     = useState(false);
  const [view, setView]           = useState<"list" | "detail" | "new">("list");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue]     = useState("");
  const [newFinding, setNewFinding]     = useState(false);
  const [findingForm, setFindingForm]   = useState<Partial<Finding>>({ severity: "medium", type: "vulnerability" });
  const [search, setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedFinding, setExpandedFinding] = useState<number | null>(null);
  const [tab, setTab]             = useState<"findings" | "commands" | "notes">("findings");
  const [newForm, setNewForm]     = useState({ name: "", target: "", objective: "", phase: "reconnaissance", tags: "" });

  const fetchMissions = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch(`${API}/missions`); if (r.ok) setMissions(await r.json() as Mission[]); } catch {}
    setLoading(false);
  }, []);

  const fetchDetail = useCallback(async (id: number) => {
    try { const r = await fetch(`${API}/missions/${id}`); if (r.ok) { const m = await r.json() as Mission; setSelected(m); setNotesValue(m.notes ?? ""); } } catch {}
  }, []);

  useEffect(() => { void fetchMissions(); }, [fetchMissions]);

  // When context logs a cmd to active mission, refresh
  useEffect(() => {
    if (ctx.activeMission && selected?.id === ctx.activeMission.id) {
      const t = setInterval(() => void fetchDetail(selected.id), 8000);
      return () => clearInterval(t);
    }
    return undefined;
  }, [ctx.activeMission, selected?.id, fetchDetail]);

  const createMission = async () => {
    if (!newForm.name.trim() || !newForm.target.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/missions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newForm, tags: newForm.tags.split(",").map(t => t.trim()).filter(Boolean) }) });
      if (r.ok) {
        const m = await r.json() as Mission;
        await fetchMissions();
        selectMission(m);
        setNewForm({ name: "", target: "", objective: "", phase: "reconnaissance", tags: "" });
      }
    } catch {}
    setLoading(false);
  };

  const selectMission = (m: Mission) => {
    setView("detail"); setSelected(m); setNotesValue(""); setTab("findings");
    void fetchDetail(m.id);
    ctx.setActiveMission({ id: m.id, name: m.name, target: m.target, phase: m.phase, status: m.status });
    ctx.addEvent({ source: "mission", type: "select", text: `تم تحديد المهمة: ${m.name}`, detail: `الهدف: ${m.target}` });
  };

  const updateMission = async (id: number, patch: Partial<Mission>) => {
    try {
      const r = await fetch(`${API}/missions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (r.ok) { const m = await r.json() as Mission; setSelected(m); setMissions(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x)); if (ctx.activeMission?.id === id) ctx.setActiveMission({ id: m.id, name: m.name, target: m.target, phase: m.phase, status: m.status }); }
    } catch {}
  };

  const deleteMission = async (id: number) => {
    try { await fetch(`${API}/missions/${id}`, { method: "DELETE" }); setMissions(prev => prev.filter(x => x.id !== id)); if (selected?.id === id) { setSelected(null); setView("list"); } if (ctx.activeMission?.id === id) ctx.setActiveMission(null); } catch {}
  };

  const addFinding = async () => {
    if (!selected || !findingForm.title?.trim()) return;
    try { const r = await fetch(`${API}/missions/${selected.id}/findings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(findingForm) }); if (r.ok) { await fetchDetail(selected.id); setNewFinding(false); setFindingForm({ severity: "medium", type: "vulnerability" }); ctx.addEvent({ source: "mission", type: "finding", text: `نتيجة جديدة: ${findingForm.title}`, detail: `خطورة: ${findingForm.severity}` }); } } catch {}
  };

  const filtered = missions.filter(m => {
    if (filterStatus !== "all" && m.status !== filterStatus) return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.target.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = { total: missions.length, active: missions.filter(m => m.status === "active").length, completed: missions.filter(m => m.status === "completed").length, findings: missions.reduce((a, m) => a + (m.findingCount ?? m.findings?.length ?? 0), 0) };

  return (
    <div className="flex flex-1 min-h-0">
      {/* LEFT: list */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r min-h-0" style={{ borderColor: "rgba(255,30,60,0.2)", background: "rgba(4,0,10,0.95)" }}>
        <div className="shrink-0 px-3 pt-3 pb-2 border-b" style={{ borderColor: "rgba(255,30,60,0.15)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4" style={{ color: "#ff3355" }} />
            <span className="font-mono font-black text-sm tracking-widest" style={{ color: "#ff3355" }}>MISSIONS</span>
            <span className="ms-auto text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,50,80,0.1)", color: "#ff3355", border: "1px solid rgba(255,50,80,0.25)" }}>{missions.length}</span>
          </div>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-1 mb-2">
            {[{ l: "كل", v: stats.total, c: "#ff3355" },{ l: "نشط", v: stats.active, c: "#34d399" },{ l: "اكتمل", v: stats.completed, c: "#60a5fa" },{ l: "نتائج", v: stats.findings, c: "#f59e0b" }].map(s => (
              <div key={s.l} className="rounded-lg p-1.5 text-center border" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                <div className="font-mono font-black text-sm" style={{ color: s.c }}>{s.v}</div>
                <div className="text-[8px] text-gray-500">{s.l}</div>
              </div>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..." dir="rtl" className="w-full bg-transparent border rounded-lg px-3 py-1 text-[10px] font-mono outline-none mb-2" style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} />
          <div className="flex gap-1 flex-wrap">
            {["all","active","completed","paused"].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border transition" style={{ background: filterStatus === s ? "rgba(255,50,80,0.15)" : "transparent", borderColor: filterStatus === s ? "rgba(255,50,80,0.4)" : "rgba(255,255,255,0.08)", color: filterStatus === s ? "#ff3355" : "rgba(255,255,255,0.3)" }}>
                {s === "all" ? "الكل" : s === "active" ? "نشط" : s === "completed" ? "مكتمل" : "موقوف"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 py-1.5 px-2 space-y-1">
          {loading && <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-600" /></div>}
          {!loading && filtered.length === 0 && <div className="text-center py-8 text-gray-600 text-[11px]"><Target className="w-8 h-8 mx-auto mb-2 opacity-20" /><p>لا مهام بعد</p></div>}
          {filtered.map(m => {
            const ph = PHASES.find(p => p.id === m.phase);
            const PhIcon = ph?.icon ?? Target;
            const isActive = ctx.activeMission?.id === m.id;
            return (
              <button key={m.id} onClick={() => selectMission(m)} className="w-full text-left rounded-xl p-2.5 border transition-all relative" style={{ background: selected?.id === m.id ? "rgba(255,50,80,0.1)" : "rgba(255,255,255,0.02)", borderColor: selected?.id === m.id ? "rgba(255,50,80,0.35)" : "rgba(255,255,255,0.06)" }}>
                {isActive && <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" title="المهمة النشطة" />}
                <div className="flex items-center gap-1.5 mb-1">{statusIcon(m.status)}<span className="font-mono font-bold text-[11px] text-white/90 truncate">{m.name}</span></div>
                <div className="flex items-center gap-1 text-[9px] font-mono text-gray-500">
                  <PhIcon className="w-2.5 h-2.5" style={{ color: ph?.color }} />
                  <span style={{ color: ph?.color }}>{ph?.label ?? m.phase}</span><span>·</span>
                  <span className="text-cyan-500/60">{m.target}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[8px] font-mono text-amber-400/60">{(m.findingCount ?? m.findings?.length ?? 0)} نتيجة</span>
                  {isActive && <span className="text-[7px] font-mono px-1 rounded" style={{ background: "rgba(255,153,51,0.15)", color: "#ff9933", border: "1px solid rgba(255,153,51,0.3)" }}>🎯 نشطة</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="shrink-0 p-2 border-t" style={{ borderColor: "rgba(255,30,60,0.15)" }}>
          <button onClick={() => setView("new")} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-[11px] font-mono font-bold transition" style={{ background: "rgba(255,50,80,0.08)", borderColor: "rgba(255,50,80,0.3)", color: "#ff3355" }}>
            <Plus className="w-3.5 h-3.5" />مهمة جديدة
          </button>
        </div>
      </div>

      {/* RIGHT: detail */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {view === "new" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-xl mx-auto space-y-4">
              <h2 className="font-mono font-black text-base text-white">مهمة اختراق جديدة</h2>
              {[{ label: "اسم المهمة *", key: "name", ph: "مثال: فحص شبكة المكتب" },{ label: "الهدف *", key: "target", ph: "192.168.1.0/24 أو example.com" },{ label: "الغاية", key: "objective", ph: "اكتشاف الثغرات..." },{ label: "تاغات", key: "tags", ph: "internal, network, web" }].map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] font-mono text-gray-400 mb-1">{f.label}</label>
                  <input value={newForm[f.key as keyof typeof newForm]} onChange={e => setNewForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph} dir="auto" className="w-full bg-transparent border rounded-xl px-3 py-2.5 text-[11px] font-mono outline-none" style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} />
                </div>
              ))}
              <div>
                <label className="block text-[10px] font-mono text-gray-400 mb-1.5">المرحلة الأولى</label>
                <div className="grid grid-cols-3 gap-2">
                  {PHASES.map(p => {
                    const Icon = p.icon;
                    return (
                      <button key={p.id} onClick={() => setNewForm(prev => ({ ...prev, phase: p.id }))} className="flex flex-col items-center gap-1 p-2.5 rounded-xl border transition" style={{ background: newForm.phase === p.id ? `${p.color}22` : "transparent", borderColor: newForm.phase === p.id ? p.color + "55" : "rgba(255,255,255,0.08)" }}>
                        <Icon className="w-4 h-4" style={{ color: p.color }} /><span className="text-[9px] font-mono" style={{ color: p.color }}>{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => void createMission()} disabled={!newForm.name || !newForm.target || loading} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-mono font-bold text-[12px] transition disabled:opacity-40" style={{ background: "rgba(255,50,80,0.15)", border: "1px solid rgba(255,50,80,0.4)", color: "#ff3355" }}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}إنشاء المهمة + تفعيلها
                </button>
                <button onClick={() => setView("list")} className="px-4 rounded-xl border text-[12px] font-mono transition" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>إلغاء</button>
              </div>
            </div>
          </div>
        )}

        {view === "detail" && selected && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b" style={{ borderColor: "rgba(255,30,60,0.2)", background: "rgba(8,0,14,0.9)" }}>
              <div>
                <div className="flex items-center gap-2">{statusIcon(selected.status)}<h2 className="font-mono font-black text-sm text-white">{selected.name}</h2>{selected.tags.map(t => <span key={t} className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>{t}</span>)}</div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500 mt-0.5">
                  <span className="text-cyan-400/70">{selected.target}</span><span>·</span><span style={{ color: phaseColor(selected.phase) }}>{selected.phase}</span>
                </div>
              </div>
              <div className="ms-auto flex items-center gap-1.5">
                {ctx.activeMission?.id !== selected.id ? (
                  <button onClick={() => ctx.setActiveMission({ id: selected.id, name: selected.name, target: selected.target, phase: selected.phase, status: selected.status })}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-mono font-bold transition"
                    style={{ background: "rgba(255,153,51,0.12)", border: "1px solid rgba(255,153,51,0.4)", color: "#ff9933" }}>
                    <Target className="w-3 h-3" />تفعيل كمهمة نشطة
                  </button>
                ) : (
                  <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-mono" style={{ background: "rgba(255,153,51,0.1)", border: "1px solid rgba(255,153,51,0.3)", color: "#ff9933" }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />🎯 نشطة
                  </div>
                )}
                <select value={selected.phase} onChange={e => void updateMission(selected.id, { phase: e.target.value })} className="text-[9px] font-mono px-2 py-1 rounded-lg border outline-none" style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }}>
                  {PHASES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <select value={selected.status} onChange={e => void updateMission(selected.id, { status: e.target.value })} className="text-[9px] font-mono px-2 py-1 rounded-lg border outline-none" style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }}>
                  {["active","paused","completed","failed"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => void deleteMission(selected.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[9px] font-mono transition" style={{ borderColor: "rgba(239,68,68,0.3)", color: "#f87171", background: "rgba(239,68,68,0.05)" }}>
                  <Trash2 className="w-3 h-3" />حذف
                </button>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-0.5 px-3 py-1.5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              {([["findings","نتائج"],["commands","أوامر"],["notes","ملاحظات"]] as const).map(([id, label]) => {
                const count = id === "findings" ? selected.findings.length : id === "commands" ? selected.commands.length : 0;
                return (
                  <button key={id} onClick={() => setTab(id)} className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-mono transition"
                    style={{ background: tab === id ? "rgba(255,50,80,0.1)" : "transparent", border: `1px solid ${tab === id ? "rgba(255,50,80,0.3)" : "transparent"}`, color: tab === id ? "#ff3355" : "rgba(255,255,255,0.3)" }}>
                    {label}{count > 0 && ` (${count})`}
                  </button>
                );
              })}
              {/* Quick KALI AI */}
              <button onClick={() => { ctx.setActiveMission({ id: selected.id, name: selected.name, target: selected.target, phase: selected.phase, status: selected.status }); ctx.navigateTo("kali"); }}
                className="ms-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-mono transition"
                style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff6666" }}>
                <Skull className="w-3 h-3" />فتح KALI AI على هذه المهمة
              </button>
              <button onClick={() => { ctx.setActiveMission({ id: selected.id, name: selected.name, target: selected.target, phase: selected.phase, status: selected.status }); ctx.navigateTo("local"); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-mono transition ms-1"
                style={{ background: "rgba(255,102,136,0.08)", border: "1px solid rgba(255,102,136,0.2)", color: "#ff6688" }}>
                <Monitor className="w-3 h-3" />Local Terminal
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 min-h-0">
              {tab === "findings" && (
                <div className="space-y-2">
                  <button onClick={() => setNewFinding(v => !v)} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-[11px] font-mono transition mb-2" style={{ borderColor: "rgba(255,50,80,0.2)", color: "rgba(255,50,80,0.6)", background: "rgba(255,50,80,0.04)" }}>
                    <Plus className="w-3.5 h-3.5" />إضافة نتيجة
                  </button>
                  {newFinding && (
                    <div className="rounded-2xl border p-4 mb-3 space-y-3" style={{ background: "rgba(255,50,80,0.05)", borderColor: "rgba(255,50,80,0.25)" }}>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="block text-[9px] font-mono text-gray-500 mb-1">العنوان *</label><input value={findingForm.title ?? ""} onChange={e => setFindingForm(p => ({ ...p, title: e.target.value }))} placeholder="SQL Injection في /login" className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none" style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} /></div>
                        <div><label className="block text-[9px] font-mono text-gray-500 mb-1">الأداة</label><input value={findingForm.tool ?? ""} onChange={e => setFindingForm(p => ({ ...p, tool: e.target.value }))} placeholder="nmap, nikto, manual..." className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none" style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} /></div>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {SEVERITIES.map(s => <button key={s.id} onClick={() => setFindingForm(p => ({ ...p, severity: s.id }))} className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border transition" style={{ background: findingForm.severity === s.id ? s.color + "22" : "transparent", borderColor: findingForm.severity === s.id ? s.color + "55" : "rgba(255,255,255,0.08)", color: findingForm.severity === s.id ? s.color : "rgba(255,255,255,0.3)" }}>{s.label}</button>)}
                      </div>
                      <select value={findingForm.type ?? "vulnerability"} onChange={e => setFindingForm(p => ({ ...p, type: e.target.value }))} className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none" style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0", background: "rgba(0,0,0,0.5)" }}>
                        {FINDING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <textarea value={findingForm.detail ?? ""} onChange={e => setFindingForm(p => ({ ...p, detail: e.target.value }))} placeholder="وصف الثغرة..." rows={2} dir="auto" className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none resize-none" style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setNewFinding(false); setFindingForm({ severity: "medium", type: "vulnerability" }); }} className="px-3 py-1.5 rounded-lg border text-[10px] font-mono" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>إلغاء</button>
                        <button onClick={() => void addFinding()} disabled={!findingForm.title?.trim()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[10px] font-mono font-bold disabled:opacity-40" style={{ background: "rgba(255,50,80,0.1)", borderColor: "rgba(255,50,80,0.35)", color: "#ff3355" }}>
                          <Plus className="w-3 h-3" />حفظ
                        </button>
                      </div>
                    </div>
                  )}
                  {selected.findings.map(f => (
                    <div key={f.id} onClick={() => setExpandedFinding(v => v === f.id ? null : f.id)} className="rounded-xl p-3 cursor-pointer transition-all border" style={{ background: expandedFinding === f.id ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)", borderColor: `${sevColor(f.severity)}33` }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: sevColor(f.severity) + "22", color: sevColor(f.severity) }}>{f.severity}</span>
                        <span className="text-[10px] font-mono font-bold text-white/80 flex-1 truncate">{f.title}</span>
                        <span className="text-[8px] font-mono text-gray-500">{f.tool ?? "manual"}</span>
                      </div>
                      {expandedFinding === f.id && <div className="mt-2 text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{f.detail}</div>}
                    </div>
                  ))}
                </div>
              )}
              {tab === "commands" && (
                <div className="space-y-2">
                  {selected.commands.length === 0 && <div className="text-center py-8 text-gray-600 text-[11px]">لا أوامر مسجّلة<br /><span className="text-[9px] opacity-50">نفّذ أوامر من KALI AI أو Local Control واضغط 🔗</span></div>}
                  {selected.commands.map((c, i) => (
                    <div key={i} className="rounded-xl p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="font-mono text-[10px] text-emerald-400 mb-1" dir="ltr">$ {c.cmd}</div>
                      <pre className="font-mono text-[9px] text-white/50 whitespace-pre-wrap break-all max-h-32 overflow-y-auto" dir="ltr">{c.output.substring(0, 600)}</pre>
                    </div>
                  ))}
                </div>
              )}
              {tab === "notes" && (
                <div className="h-full">
                  {editingNotes ? (
                    <div className="h-full flex flex-col gap-2">
                      <textarea value={notesValue} onChange={e => setNotesValue(e.target.value)} dir="auto" className="flex-1 w-full bg-transparent border rounded-xl p-3 font-mono text-[11px] outline-none resize-none" style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} />
                      <div className="flex gap-2">
                        <button onClick={() => void updateMission(selected.id, { notes: notesValue }).then(() => setEditingNotes(false))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold" style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.3)", color: "#44ff88" }}>حفظ</button>
                        <button onClick={() => setEditingNotes(false)} className="px-3 py-1.5 rounded-lg text-[10px] font-mono" style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>إلغاء</button>
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => setEditingNotes(true)} className="h-full rounded-xl p-3 cursor-text min-h-[100px]" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <pre className="font-mono text-[11px] text-white/60 whitespace-pre-wrap">{selected.notes || "انقر للإضافة..."}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {view === "list" && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3 opacity-40">
              <Target className="w-16 h-16 mx-auto" style={{ color: "#ff3355" }} />
              <p className="font-mono text-sm font-black tracking-widest" style={{ color: "#ff3355" }}>Mission Tracker</p>
              <p className="text-[11px] font-mono text-gray-500">اختر مهمة لتفعيلها في كل الأدوات<br />أو أنشئ مهمة جديدة</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN: CYBER CONTROL HUB v2
═══════════════════════════════════════════════════════════════════════ */

type MainTab = "live" | "kali" | "nova" | "local" | "missions";

const MAIN_TABS: { id: MainTab; label: string; labelEn: string; icon: React.ComponentType<{className?:string}>; color: string; badge?: string }[] = [
  { id: "live",     label: "Live Agent",     labelEn: "Nova AI Director", icon: Radio,    color: "#44eebb", badge: "LIVE" },
  { id: "kali",     label: "KALI AI",        labelEn: "Command Center",   icon: Skull,    color: "#ff4444", badge: "⚔" },
  { id: "nova",     label: "Nova Commander", labelEn: "Auto Operations",  icon: Command,  color: "#a855f7" },
  { id: "local",    label: "Local Control",  labelEn: "Device Terminal",  icon: Monitor,  color: "#ff6688" },
  { id: "missions", label: "Mission Tracker",labelEn: "Pentest Missions", icon: Target,   color: "#ff9933" },
];

export default function CyberControlHub() {
  /* ── Global Tab ── */
  const [activeTab, setActiveTab] = useState<MainTab>("live");

  /* ── System Intel ── */
  const [intel, setIntel]         = useState<SystemIntel | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [pulse, setPulse]         = useState(false);
  const [now, setNow]             = useState(new Date());

  /* ── Context Bridge State ── */
  const [activeMission, setActiveMissionState] = useState<ActiveMission | null>(null);
  const [contextEvents, setContextEvents]       = useState<ContextEvent[]>([]);
  const [showContextFeed, setShowContextFeed]   = useState(false);
  const [missionsList, setMissionsList]         = useState<Mission[]>([]);
  const [showMissionPicker, setShowMissionPicker] = useState(false);
  const missionPickerRef = useRef<HTMLDivElement>(null);

  /* ── Hub Context API ── */
  const setActiveMission = useCallback((m: ActiveMission | null) => {
    setActiveMissionState(m);
    if (m) {
      setContextEvents(prev => [...prev.slice(-299), { id: uid(), ts: Date.now(), source: "mission", type: "select", text: `تم تفعيل المهمة: ${m.name}`, detail: `الهدف: ${m.target}` }]);
    }
  }, []);

  const addEvent = useCallback((e: Omit<ContextEvent, "id" | "ts">) => {
    setContextEvents(prev => [...prev.slice(-299), { ...e, id: uid(), ts: Date.now() }]);
  }, []);

  const logToMission = useCallback(async (cmd: string, output: string, source = "Hub"): Promise<boolean> => {
    if (!activeMission) return false;
    try {
      const r = await fetch(`${API}/missions/${activeMission.id}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd, output: `[${source}]\n${output}` }),
      });
      if (r.ok) {
        addEvent({ source: "mission", type: "cmd", text: `✅ تم تسجيل الأمر في "${activeMission.name}"`, detail: `$ ${cmd}` });
        return true;
      }
    } catch {}
    addEvent({ source: "mission", type: "cmd", text: `❌ فشل تسجيل الأمر في المهمة`, isError: true });
    return false;
  }, [activeMission, addEvent]);

  const navigateTo = useCallback((tab: MainTab) => { setActiveTab(tab); }, []);

  const ctx: HubCtx = { activeMission, setActiveMission, addEvent, logToMission, navigateTo };

  /* ── Load Intel ── */
  const loadIntel = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-command/system`);
      if (r.ok) { const d = await r.json() as SystemIntel; setIntel(d); setAgentConnected((d.agentCount ?? 0) > 0); }
    } catch {}
    try {
      const r = await fetch(`${API}/local-agent/status`);
      if (r.ok) { const d = await r.json() as { connected: boolean }; if (d.connected) setAgentConnected(true); }
    } catch {}
  }, []);

  /* ── Load Missions list for picker ── */
  const loadMissions = useCallback(async () => {
    try { const r = await fetch(`${API}/missions`); if (r.ok) setMissionsList(await r.json() as Mission[]); } catch {}
  }, []);

  useEffect(() => { void loadIntel(); const t = setInterval(loadIntel, 10000); return () => clearInterval(t); }, [loadIntel]);
  useEffect(() => { void loadMissions(); const t = setInterval(loadMissions, 15000); return () => clearInterval(t); }, [loadMissions]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setPulse(p => !p), 1500); return () => clearInterval(t); }, []);

  // Close mission picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (missionPickerRef.current && !missionPickerRef.current.contains(e.target as Node)) setShowMissionPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const hasDevice = agentConnected || (intel?.agentCount ?? 0) > 0;
  const timeStr = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const unreadEvents = contextEvents.length;

  return (
    <div className="h-full flex flex-col overflow-hidden" dir="rtl"
      style={{ background: "linear-gradient(180deg,#02000a 0%,#040010 100%)", color: "#e0e0e0" }}>

      {/* ══════════════════════════════════════════════════════════════════
          TOP STATUS BAR
      ══════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 z-30"
        style={{ background: "rgba(0,0,0,0.7)", borderBottom: "1px solid rgba(255,30,30,0.3)", backdropFilter: "blur(12px)" }}>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,rgba(200,0,0,0.7),rgba(60,0,60,0.9))", border: "1px solid rgba(255,50,50,0.5)", boxShadow: "0 0 14px rgba(255,0,0,0.4)" }}>
            <Skull className="w-4 h-4" style={{ color: "#ff4444" }} />
          </div>
          <div>
            <div className="text-[11px] font-black tracking-widest font-mono" style={{ color: "#ff3333", textShadow: "0 0 10px rgba(255,30,30,0.7)" }}>CYBER CONTROL HUB</div>
            <div className="text-[8px] font-mono" style={{ color: "rgba(255,100,100,0.4)" }}>v2 · Context Bridge Active</div>
          </div>
        </div>

        {/* System Stats */}
        {intel && (
          <div className="flex items-center gap-3 ms-2">
            <div className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "#ffaa00" }}><Cpu className="w-3 h-3" /><span>{intel.server.loadAvg?.split(",")[0]?.trim() ?? "N/A"}</span></div>
            <div className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "#cc44ff" }}><MemoryStick className="w-3 h-3" /><span>{intel.server.memUsage}</span></div>
            <div className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "#44ff88" }}><Brain className="w-3 h-3" /><span>{intel.knowledgeCount} mem</span></div>
          </div>
        )}

        {/* ── ACTIVE MISSION BADGE (status bar) ── */}
        <div className="ms-4 relative" ref={missionPickerRef}>
          <button onClick={() => { setShowMissionPicker(p => !p); void loadMissions(); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-mono font-bold transition-all"
            style={activeMission
              ? { background: "rgba(255,153,51,0.12)", border: "1px solid rgba(255,153,51,0.45)", color: "#ff9933" }
              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)" }}>
            <Target className="w-3 h-3" />
            {activeMission ? <><span>{activeMission.name}</span><span className="opacity-50">·</span><span className="text-cyan-400/70 font-normal">{activeMission.target}</span></> : <span>اختر مهمة نشطة...</span>}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </button>
          {showMissionPicker && (
            <div className="absolute top-full mt-1 right-0 z-50 rounded-xl overflow-hidden shadow-2xl" style={{ background: "rgba(6,0,16,0.98)", border: "1px solid rgba(255,153,51,0.3)", minWidth: 260, maxHeight: 300, overflowY: "auto", backdropFilter: "blur(16px)" }}>
              <div className="px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="text-[9px] font-mono font-black tracking-widest" style={{ color: "rgba(255,153,51,0.6)" }}>🎯 اختر المهمة النشطة</span>
              </div>
              {activeMission && (
                <button onClick={() => { setActiveMission(null); setShowMissionPicker(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[9px] font-mono text-left transition-all hover:bg-white/5" style={{ color: "rgba(255,100,100,0.7)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <X className="w-3 h-3" />إلغاء تفعيل المهمة
                </button>
              )}
              {missionsList.length === 0 && <div className="px-3 py-4 text-center text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد مهام</div>}
              {missionsList.map(m => (
                <button key={m.id} onClick={() => { setActiveMission({ id: m.id, name: m.name, target: m.target, phase: m.phase, status: m.status }); setShowMissionPicker(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-all hover:bg-orange-500/5"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: activeMission?.id === m.id ? "rgba(255,153,51,0.1)" : "transparent" }}>
                  {statusIcon(m.status)}
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono font-bold truncate" style={{ color: activeMission?.id === m.id ? "#ff9933" : "rgba(255,255,255,0.8)" }}>{m.name}</div>
                    <div className="text-[8px] font-mono text-cyan-400/60 truncate">{m.target}</div>
                  </div>
                  {activeMission?.id === m.id && <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Agent Status */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-mono font-bold transition-all"
          style={hasDevice ? { background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.4)", color: "#44ff88" } : { background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.3)", color: "#ff6666" }}>
          {hasDevice ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {hasDevice ? `${intel?.agents?.[0]?.hostname ?? "كالي"} متصل` : "لا يوجد جهاز"}
        </div>

        {/* Context Feed Toggle */}
        <button onClick={() => setShowContextFeed(v => !v)} className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all"
          style={showContextFeed ? { background: "rgba(255,68,68,0.15)", border: "1px solid rgba(255,68,68,0.4)", color: "#ff5555" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
          <Layers className="w-3.5 h-3.5" />Context Feed
          {unreadEvents > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[7px] font-black flex items-center justify-center" style={{ background: "#ff4444", color: "#fff" }}>{Math.min(unreadEvents, 99)}</span>
          )}
        </button>

        {/* Pulse + Clock */}
        <div className={`w-2 h-2 rounded-full transition-all ${pulse ? "opacity-100" : "opacity-30"}`} style={{ background: "#ff4444", boxShadow: "0 0 8px #ff0000" }} />
        <div className="text-[10px] font-mono font-bold" style={{ color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>{timeStr}</div>
        <button onClick={() => { void loadIntel(); void loadMissions(); }} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"><RefreshCw className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} /></button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          MAIN TAB BAR
      ══════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 flex items-stretch" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.5)" }}>
        {MAIN_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className="flex items-center gap-2 px-5 py-3 font-mono font-bold transition-all relative"
              style={isActive ? { background: `${tab.color}14`, borderBottom: `2px solid ${tab.color}`, color: tab.color } : { color: "rgba(255,255,255,0.3)", borderBottom: "2px solid transparent" }}>
              <tab.icon className="w-3.5 h-3.5" />
              <div className="text-start">
                <div className="text-[11px] leading-none">{tab.label}</div>
                <div className="text-[8px] opacity-50 leading-none mt-0.5">{tab.labelEn}</div>
              </div>
              {tab.badge && <span className="text-[7px] font-black px-1 py-0.5 rounded" style={{ background: `${tab.color}22`, color: tab.color, border: `1px solid ${tab.color}44` }}>{tab.badge}</span>}
              {/* Active mission indicator on missions tab */}
              {tab.id === "missions" && activeMission && <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" style={{ boxShadow: "0 0 4px #ff9933" }} />}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: tab.color, boxShadow: `0 0 8px ${tab.color}` }} />}
            </button>
          );
        })}
        {/* Context Bridge indicator */}
        {activeMission && (
          <div className="ms-auto flex items-center gap-2 px-4">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "rgba(255,153,51,0.08)", border: "1px solid rgba(255,153,51,0.2)" }}>
              <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
              <span className="text-[9px] font-mono" style={{ color: "rgba(255,153,51,0.8)" }}>Bridge Active</span>
              <Link className="w-3 h-3" style={{ color: "rgba(255,153,51,0.6)" }} />
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          CONTENT AREA (Context Feed | Tab Content)
      ══════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Context Feed Sidebar */}
        {showContextFeed && (
          <ContextFeed events={contextEvents} onClose={() => setShowContextFeed(false)} ctx={ctx} />
        )}

        {/* Tab Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Live Agent */}
          {activeTab === "live" && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {activeMission && (
                <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ background: "rgba(68,238,187,0.05)", borderBottom: "1px solid rgba(68,238,187,0.15)" }}>
                  <Radio className="w-3.5 h-3.5" style={{ color: "#44eebb" }} />
                  <span className="text-[10px] font-mono font-bold" style={{ color: "#44eebb" }}>Live Agent</span>
                  <span className="text-[9px] font-mono text-white/40">•</span>
                  <Target className="w-3 h-3 text-orange-400" />
                  <span className="text-[9px] font-mono" style={{ color: "#ff9933" }}>{activeMission.name} — {activeMission.target}</span>
                  <button onClick={() => navigateTo("missions")} className="ms-auto text-[8px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(68,238,187,0.08)", border: "1px solid rgba(68,238,187,0.2)", color: "#44eebb" }}>فتح المهمة</button>
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-hidden">
                <LiveAgentPanel embedded={true} onClientTool={(_e: ClientToolEvent) => {}} onOpenAgentWindow={() => {}} />
              </div>
            </div>
          )}

          {activeTab === "kali" && (
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <KaliAiPanel intel={intel} hasDevice={hasDevice} loadIntel={loadIntel} ctx={ctx} />
            </div>
          )}

          {activeTab === "nova" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <NovaCommanderPage />
            </div>
          )}

          {activeTab === "local" && (
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <LocalControlPanel intel={intel} ctx={ctx} />
            </div>
          )}

          {activeTab === "missions" && (
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <MissionTrackerPanel ctx={ctx} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
