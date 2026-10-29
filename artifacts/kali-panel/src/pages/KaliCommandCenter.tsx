import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, Bot, Brain, ChevronDown, ChevronUp, ChevronRight,
  Cpu, Eye, HardDrive, Loader2, Monitor, Network,
  Play, RefreshCw, Send, Server, Shield, Skull, Square,
  Target, Terminal, Trash2, Wifi, WifiOff, Wrench, X, Zap,
  Swords, Crosshair, MemoryStick, Clock, Search, Flame,
  Code, Package, CheckCircle2, XCircle, AlertTriangle,
  Globe, Database, Lock, Radio, Layers, FolderOpen, Copy,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const API = "/api";

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system" | "plan" | "exec_result";
  text: string;
  isError?: boolean;
  command?: string;
  taskId?: string;
  ts: number;
}
interface KaliTask {
  id: string;
  title: string;
  description: string;
  status: "queued" | "running" | "done" | "failed" | "approved" | "awaiting_approval";
  progress: number;
  command?: string;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}
interface AgentInfo {
  id: string;
  hostname: string;
  platform: string;
  user: string;
  capabilities: string[];
  connectedAt: number;
  arch?: string;
  cpus?: number;
  totalMemory?: number;
  isRoot?: boolean;
  hasDeepProfile?: boolean;
}
interface DeepProfile {
  system?: {
    hostname: string; platform: string; arch: string; release?: string; uptime?: number;
    cpus?: { count: number; model: string; speed: number };
    memory?: { total: number; free: number; used: number; usedPct: number };
    loadAvg?: number[]; user?: string; isRoot?: boolean;
    display?: boolean; displayValue?: string | null;
  };
  tools?: Record<string, string[]>;
  toolCount?: number;
  network?: {
    interfaces?: Record<string, string[]>;
    routes?: string[]; openPorts?: string[]; arpTable?: string[]; dnsServers?: string[];
  };
  services?: { running?: string[]; failed?: string[] };
  users?: { current?: string; all?: string[]; sudoers?: string[] };
  docker?: { containers?: string[]; count?: number } | null;
  environment?: { shell?: string; path?: string; home?: string };
  capabilities?: string[];
  profileBuildMs?: number;
}
interface SystemIntel {
  server: {
    hostname: string; platform: string; arch: string; cpus: number;
    totalMemory: string; uptime: string; loadAvg: string; memUsage: string; openPorts: string;
  };
  agents: AgentInfo[];
  agentCount: number;
  knowledgeCount: number;
  tasks: { queued: number; running: number; done: number; failed: number };
}
interface TermLine {
  text: string;
  isError: boolean;
  isCmd: boolean;
  ts: number;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function fmtBytes(b?: number) {
  if (!b) return "?";
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}
function fmtUptime(s?: number) {
  if (!s) return "?";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function statusColor(s: string) {
  if (s === "done")    return "#44ff88";
  if (s === "running") return "#ffaa00";
  if (s === "failed")  return "#ff4444";
  if (s === "queued")  return "#6699ff";
  return "#888";
}

/* ── Streaming chat ──────────────────────────────────────────────────────────── */
async function* streamChat(
  sessionId: string, message: string, signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: unknown }> {
  const resp = await fetch(`${API}/kali-command/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    yield { event: "error", data: { error: `HTTP ${resp.status}` } };
    return;
  }
  const reader = resp.body.getReader();
  const dec    = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.trim().split("\n");
      let event = "message", dataStr = "";
      for (const l of lines) {
        if (l.startsWith("event: ")) event = l.slice(7).trim();
        else if (l.startsWith("data: ")) dataStr = l.slice(6).trim();
      }
      if (dataStr) {
        try { yield { event, data: JSON.parse(dataStr) }; } catch {}
      }
    }
  }
}

/* ── Quick prompts ───────────────────────────────────────────────────────────── */
const QUICK_PROMPTS = [
  { icon: Skull,    label: "تدقيق النظام",  color: "#ff4444", prompt: "نفّذ تدقيقاً شاملاً للنظام الآن: معلومات السيرفر، العمليات، الشبكة، والأجهزة المتصلة." },
  { icon: Target,   label: "صيد التهديدات", color: "#ff6600", prompt: "ابدأ عملية صيد التهديدات: فتّش عن نشاط مشبوه، اتصالات غير عادية، ملفات جديدة." },
  { icon: Network,  label: "مسح الشبكة",    color: "#00aaff", prompt: "نفّذ مسح شبكي كامل: اكتشف الأجهزة، المنافذ المفتوحة، والخدمات الجارية." },
  { icon: Shield,   label: "فحص الثغرات",   color: "#44ff88", prompt: "ابحث عن ثغرات في النظام. استخدم CVE database وقارن مع الخدمات المكتشفة." },
  { icon: Brain,    label: "راجع ذاكرتك",   color: "#aa44ff", prompt: "راجع كل ما تعلّمته. صنّف المعرفة وأخبرني بأهم الاكتشافات." },
  { icon: Zap,      label: "استقلالية كاملة",color: "#ffaa00", prompt: "وضع الاستقلالية الكاملة — قيّم النظام وضع خطة تحسين أمني ونفّذها." },
];

const DEVICE_CMDS = [
  "uname -a", "whoami && id", "ip addr", "ps aux | head -25",
  "df -h", "free -h", "netstat -an 2>/dev/null | head -20",
  "ls -la /root 2>/dev/null || ls -la ~",
  "cat /etc/os-release 2>/dev/null | head -5",
  "systemctl list-units --state=running --no-pager --no-legend 2>/dev/null | head -15",
  "cat /etc/passwd | grep -v nologin | grep -v false",
  "cat /etc/hosts",
];

/* ── Sub-components ──────────────────────────────────────────────────────────── */

function Stat({ icon: Icon, label, color }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>, label: string, color: string }) {
  return (
    <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-lg"
      style={{ background: `${color}12`, border: `1px solid ${color}25`, color }}>
      <Icon className="w-2.5 h-2.5" />
      <span className="font-bold">{label}</span>
    </div>
  );
}

function CollapsibleSection({
  title, icon: Icon, color = "#ff4444", badge, defaultOpen = true,
  children, extra,
}: {
  title: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color?: string; badge?: number; defaultOpen?: boolean;
  children: React.ReactNode; extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl overflow-visible mb-2"
      style={{ border: `1px solid ${color}25`, background: "rgba(0,0,0,0.25)" }}>
      <div
        role="button" tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(o => !o); }}
        className="w-full flex items-center gap-2 px-3 py-2 transition-colors hover:bg-white/5 cursor-pointer select-none"
        style={{ borderBottom: open ? `1px solid ${color}15` : "none", borderRadius: open ? "12px 12px 0 0" : 12 }}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        <span className="text-[10px] font-black font-mono tracking-wider flex-1 text-left" style={{ color }}>
          {title}
        </span>
        {badge !== undefined && badge > 0 && (
          <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{ background: color, color: "#000", minWidth: 16, textAlign: "center" }}>
            {badge}
          </span>
        )}
        {extra && <span onClick={e => e.stopPropagation()}>{extra}</span>}
        {open
          ? <ChevronUp className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />}
      </div>
      {open && <div className="p-2">{children}</div>}
    </div>
  );
}

function TaskCard({ task, onDelete }: { task: KaliTask; onDelete: (id: string) => void }) {
  const [exp, setExp] = useState(false);
  const color = statusColor(task.status);
  return (
    <div className="rounded-xl p-2.5 mb-1.5 cursor-pointer"
      style={{ background: `${color}08`, border: `1px solid ${color}25` }}
      onClick={() => setExp(e => !e)}>
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        <span className="flex-1 text-[10px] font-mono font-bold truncate" style={{ color }}>{task.title}</span>
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
            style={{ background: `${color}20`, color }}>{task.status}</span>
          {exp ? <ChevronUp className="w-3 h-3 opacity-40" /> : <ChevronDown className="w-3 h-3 opacity-40" />}
          <button onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
            className="p-0.5 rounded hover:bg-red-500/20 transition-colors">
            <X className="w-3 h-3" style={{ color: "rgba(255,80,80,0.5)" }} />
          </button>
        </div>
      </div>
      {task.progress > 0 && task.progress < 100 && (
        <div className="mt-1.5 rounded-full overflow-hidden h-1" style={{ background: "rgba(255,255,255,0.05)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${task.progress}%`, background: color }} />
        </div>
      )}
      {exp && (
        <div className="mt-2 space-y-1">
          {task.description && (
            <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{task.description}</p>
          )}
          {task.command && (
            <div className="rounded px-2 py-1 text-[9px] font-mono" style={{ background: "rgba(0,0,0,0.4)", color: "#ffaa44" }}>
              $ {task.command}
            </div>
          )}
          {task.result && (
            <pre className="text-[8px] font-mono whitespace-pre-wrap max-h-28 overflow-y-auto rounded px-2 py-1"
              style={{ background: "rgba(0,0,0,0.4)", color: "rgba(255,255,255,0.6)" }}>
              {task.result.slice(0, 800)}
            </pre>
          )}
          {task.error && (
            <pre className="text-[8px] font-mono whitespace-pre-wrap max-h-20 overflow-y-auto rounded px-2 py-1"
              style={{ background: "rgba(255,0,0,0.08)", color: "#ff6666" }}>
              {task.error.slice(0, 400)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  const isPlan = msg.role === "plan";
  const isExec = msg.role === "exec_result";

  if (isPlan) return (
    <div className="rounded-xl px-3 py-2.5 text-xs font-mono"
      style={{ background: "rgba(170,68,255,0.08)", border: "1px solid rgba(170,68,255,0.25)", color: "rgba(200,120,255,0.9)" }}>
      <div className="flex items-center gap-2 mb-1 text-[9px] font-black tracking-widest">
        <Brain className="w-3 h-3" style={{ color: "#cc44ff" }} /><span style={{ color: "#cc44ff" }}>KALI AI — خطة عمل</span>
      </div>
      <div style={{ color: "rgba(200,150,255,0.85)", lineHeight: 1.6 }}>{msg.text}</div>
    </div>
  );

  if (isExec) return (
    <div className="rounded-xl px-3 py-2.5 text-xs font-mono"
      style={{ background: msg.isError ? "rgba(255,50,50,0.08)" : "rgba(0,255,100,0.04)", border: `1px solid ${msg.isError ? "rgba(255,50,50,0.25)" : "rgba(68,255,136,0.2)"}` }}>
      <div className="flex items-center gap-2 mb-1 text-[9px] font-black">
        {msg.isError ? <XCircle className="w-3 h-3" style={{ color: "#ff4444" }} /> : <CheckCircle2 className="w-3 h-3" style={{ color: "#44ff88" }} />}
        <span style={{ color: msg.isError ? "#ff4444" : "#44ff88" }}>
          {msg.isError ? "❌ فشل" : "✅ نُفِّذ"}: <code className="text-[9px]">{msg.command}</code>
        </span>
      </div>
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          code: ({ children }) => (
            <code className="block overflow-x-auto text-[9px] font-mono leading-relaxed"
              style={{ color: msg.isError ? "#ff8888" : "rgba(255,255,255,0.7)" }}>{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="rounded p-2 max-h-40 overflow-y-auto scrollbar-thin"
              style={{ background: "rgba(0,0,0,0.5)" }}>{children}</pre>
          ),
        }}>
        {msg.text}
      </ReactMarkdown>
    </div>
  );

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[90%] rounded-2xl px-3 py-2.5 text-xs"
        style={isUser
          ? { background: "rgba(255,30,30,0.14)", border: "1px solid rgba(255,50,50,0.4)", color: "rgba(255,220,220,0.9)" }
          : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.85)" }}>
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1.5 text-[9px] font-black tracking-wider">
            <Skull className="w-3 h-3" style={{ color: "#ff4444" }} />
            <span style={{ color: "rgba(255,80,80,0.7)" }}>KALI AI v7</span>
          </div>
        )}
        {msg.text
          ? <ReactMarkdown remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p style={{ marginBottom: "0.4em", lineHeight: 1.65 }}>{children}</p>,
                code: ({ children, ...props }) => {
                  const isInline = !(props as { node?: { type?: string } }).node;
                  return isInline
                    ? <code className="px-1 py-0.5 rounded text-[9px] font-mono"
                        style={{ background: "rgba(255,100,100,0.15)", color: "#ffaa44" }}>{children}</code>
                    : <code className="block text-[9px] font-mono leading-relaxed" style={{ color: "#44ffaa" }}>{children}</code>;
                },
                pre: ({ children }) => (
                  <pre className="rounded-lg p-2 my-1.5 overflow-x-auto text-[9px] max-h-60 scrollbar-thin"
                    style={{ background: "rgba(0,0,0,0.55)" }}>{children}</pre>
                ),
                ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
                li: ({ children }) => <li className="text-[11px]">{children}</li>,
                strong: ({ children }) => <strong style={{ color: "#ff8888" }}>{children}</strong>,
                h3: ({ children }) => <h3 className="font-black text-xs mt-2 mb-1" style={{ color: "#ff6666" }}>{children}</h3>,
              }}>
              {msg.text}
            </ReactMarkdown>
          : <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#ff4444" }} />
        }
      </div>
    </div>
  );
}

function DeviceProfilePanel({ agent, profile }: { agent: AgentInfo; profile: DeepProfile | null }) {
  const sys = profile?.system;
  const tools = profile?.tools || {};
  const totalTools = profile?.toolCount ?? 0;
  const services = profile?.services;
  const network  = profile?.network;
  const users    = profile?.users;

  const toolCategories = Object.entries(tools);

  const CAT_COLORS: Record<string, string> = {
    recon: "#00aaff", exploit: "#ff4444", web: "#ff8800", password: "#ff44ff",
    wireless: "#44ffff", mitm: "#ff6600", forensics: "#8844ff", privesc: "#ff0044",
    network: "#44ff88", utils: "#aaaa44", container: "#44aaff", post: "#ff2244",
  };

  return (
    <div className="space-y-2 text-[10px] font-mono">
      {/* Identity */}
      <div className="rounded-xl p-3 space-y-1.5"
        style={{ background: "rgba(68,255,136,0.04)", border: "1px solid rgba(68,255,136,0.25)" }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ boxShadow: "0 0 8px #44ff88" }} />
          <span className="font-black text-xs" style={{ color: "#44ff88" }}>{agent.hostname}</span>
          {sys?.isRoot && (
            <span className="text-[8px] px-1.5 py-0.5 rounded-full font-black"
              style={{ background: "rgba(255,50,50,0.2)", border: "1px solid rgba(255,50,50,0.5)", color: "#ff5555" }}>
              ROOT
            </span>
          )}
          <span className="ml-auto text-[8px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            {new Date(agent.connectedAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1" style={{ color: "rgba(255,255,255,0.5)" }}>
          <span><span style={{ color: "rgba(255,255,255,0.3)" }}>user: </span><span style={{ color: "#44ff88" }}>{agent.user}</span></span>
          <span><span style={{ color: "rgba(255,255,255,0.3)" }}>platform: </span>{sys?.platform ?? agent.platform}</span>
          <span><span style={{ color: "rgba(255,255,255,0.3)" }}>arch: </span>{sys?.arch ?? agent.arch ?? "?"}</span>
          <span><span style={{ color: "rgba(255,255,255,0.3)" }}>release: </span>{sys?.release?.split("-")[0] ?? "?"}</span>
          {sys?.cpus && <span><span style={{ color: "rgba(255,255,255,0.3)" }}>cpus: </span>{sys.cpus.count} × {sys.cpus.model?.split(" ").slice(-2).join(" ")}</span>}
          {sys?.memory && <span><span style={{ color: "rgba(255,255,255,0.3)" }}>ram: </span>{fmtBytes(sys.memory.total)} ({sys.memory.usedPct}%)</span>}
          {sys?.uptime !== undefined && <span><span style={{ color: "rgba(255,255,255,0.3)" }}>uptime: </span>{fmtUptime(sys.uptime)}</span>}
          {sys?.loadAvg && <span><span style={{ color: "rgba(255,255,255,0.3)" }}>load: </span>{sys.loadAvg.map(l => l.toFixed(2)).join(" ")}</span>}
        </div>
        {profile && <p className="text-[8px] mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>Profile built in {profile.profileBuildMs}ms</p>}
      </div>

      {/* Security Tools */}
      {toolCategories.length > 0 && (
        <div className="rounded-xl p-2.5" style={{ background: "rgba(255,50,50,0.04)", border: "1px solid rgba(255,50,50,0.2)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="w-3 h-3" style={{ color: "#ff4444" }} />
            <span className="font-black text-[9px]" style={{ color: "#ff4444" }}>SECURITY TOOLS — {totalTools} FOUND</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {toolCategories.map(([cat, list]) => (
              <div key={cat} className="relative group">
                <span className="px-2 py-0.5 rounded-full text-[8px] font-black cursor-default"
                  style={{ background: `${CAT_COLORS[cat] ?? "#888"}18`, border: `1px solid ${CAT_COLORS[cat] ?? "#888"}40`, color: CAT_COLORS[cat] ?? "#888" }}>
                  {cat} <span className="opacity-70">({list.length})</span>
                </span>
                <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block z-50 min-w-max"
                  style={{ background: "#0a0010", border: `1px solid ${CAT_COLORS[cat] ?? "#888"}50`, borderRadius: 8, padding: "6px 10px" }}>
                  <p className="text-[8px] font-black mb-1" style={{ color: CAT_COLORS[cat] ?? "#888" }}>{cat.toUpperCase()}</p>
                  {list.slice(0, 20).map(t => (
                    <p key={t} className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{t.split("/").pop()}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Network */}
      {network && (
        <div className="rounded-xl p-2.5" style={{ background: "rgba(0,150,255,0.04)", border: "1px solid rgba(0,150,255,0.2)" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <Network className="w-3 h-3" style={{ color: "#0099ff" }} />
            <span className="font-black text-[9px]" style={{ color: "#0099ff" }}>NETWORK</span>
          </div>
          {network.interfaces && Object.entries(network.interfaces).slice(0, 4).map(([name, addrs]) => (
            <div key={name} className="flex items-center gap-2 mb-0.5">
              <span className="text-[8px] font-black w-16 truncate" style={{ color: "rgba(0,170,255,0.7)" }}>{name}</span>
              <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>{(addrs as string[]).join(", ")}</span>
            </div>
          ))}
          {network.openPorts && network.openPorts.length > 0 && (
            <details className="mt-1">
              <summary className="text-[8px] cursor-pointer" style={{ color: "rgba(0,170,255,0.5)" }}>
                {network.openPorts.length} open ports
              </summary>
              <pre className="text-[7px] font-mono mt-1 max-h-20 overflow-y-auto" style={{ color: "rgba(255,255,255,0.4)" }}>
                {network.openPorts.slice(0, 20).join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Services */}
      {services?.running && services.running.length > 0 && (
        <div className="rounded-xl p-2.5" style={{ background: "rgba(68,255,100,0.03)", border: "1px solid rgba(68,255,100,0.15)" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <Server className="w-3 h-3" style={{ color: "#44ff88" }} />
            <span className="font-black text-[9px]" style={{ color: "#44ff88" }}>SERVICES — {services.running.length} RUNNING</span>
            {services.failed && services.failed.length > 0 && (
              <span className="text-[8px] px-1.5 rounded-full" style={{ background: "rgba(255,50,50,0.2)", color: "#ff5555" }}>
                {services.failed.length} failed
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {services.running.slice(0, 24).map(s => (
              <span key={s} className="px-1.5 py-0.5 rounded text-[7.5px] font-mono"
                style={{ background: "rgba(68,255,100,0.08)", border: "1px solid rgba(68,255,100,0.15)", color: "rgba(68,255,100,0.7)" }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Users */}
      {users && (
        <div className="rounded-xl p-2.5" style={{ background: "rgba(170,80,255,0.04)", border: "1px solid rgba(170,80,255,0.18)" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <Eye className="w-3 h-3" style={{ color: "#aa44ff" }} />
            <span className="font-black text-[9px]" style={{ color: "#aa44ff" }}>USERS</span>
          </div>
          <div className="grid grid-cols-2 gap-1" style={{ color: "rgba(255,255,255,0.45)" }}>
            <span className="text-[8px]"><span style={{ color: "rgba(255,255,255,0.25)" }}>current: </span>
              <span style={{ color: "#aa44ff" }}>{users.current}</span></span>
            <span className="text-[8px]"><span style={{ color: "rgba(255,255,255,0.25)" }}>accounts: </span>{users.all?.length ?? 0}</span>
          </div>
        </div>
      )}

      {/* No profile yet */}
      {!profile && (
        <div className="text-center py-3 text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
          <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" style={{ color: "#44ff88" }} />
          جاري بناء الملف العميق للجهاز...
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   KALI AI v7 Command Center
══════════════════════════════════════════════════════════════════════════════ */
export default function KaliCommandCenter() {
  const sessionId = useRef(`kali-${Date.now()}`);

  const [msgs,       setMsgs]       = useState<ChatMsg[]>([]);
  const [input,      setInput]      = useState("");
  const [busy,       setBusy]       = useState(false);
  const [streaming,  setStreaming]  = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [tasks,    setTasks]    = useState<KaliTask[]>([]);
  const [intel,    setIntel]    = useState<SystemIntel | null>(null);
  const [profile,  setProfile]  = useState<DeepProfile | null>(null);

  const [termLog,  setTermLog]  = useState<TermLine[]>([]);
  const [cmdInput, setCmdInput] = useState("");
  const [cmdTarget, setCmdTarget] = useState<"agent" | "server">("agent");
  const [cmdBusy,  setCmdBusy]  = useState(false);
  const termRef = useRef<HTMLDivElement>(null);

  const [connectInfo, setConnectInfo] = useState<{
    wsUrl: string; oneLineBash: string; agentUrl: string;
  } | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [copied, setCopied] = useState(false);

  // Scroll chat
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  // Scroll terminal
  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight, behavior: "smooth" });
  }, [termLog]);

  // Load intel + profile
  const loadIntel = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-command/system`);
      if (r.ok) setIntel(await r.json());
    } catch {}
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-command/tasks`);
      if (r.ok) setTasks(await r.json());
    } catch {}
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-command/device-context`);
      if (r.ok) {
        const d = await r.json();
        if (d.deepProfile) setProfile(d.deepProfile);
      }
    } catch {}
  }, []);

  const loadConnectInfo = useCallback(async () => {
    try {
      const r = await fetch(`${API}/local-agent/connect-info`);
      if (r.ok) setConnectInfo(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    loadIntel(); loadTasks(); loadConnectInfo();
    const iv = setInterval(() => { loadIntel(); loadTasks(); }, 5000);
    return () => clearInterval(iv);
  }, [loadIntel, loadTasks, loadConnectInfo]);

  // Load profile when agent connects
  const hasDevice = (intel?.agentCount ?? 0) > 0;
  const prevHasDevice = useRef(false);
  useEffect(() => {
    if (hasDevice && !prevHasDevice.current) {
      loadProfile();
      // Auto-scan announcement
      setMsgs(prev => [...prev, {
        id: uid(), role: "system",
        text: `✅ جهاز متصل: **${intel?.agents[0]?.hostname}** (${intel?.agents[0]?.user}@${intel?.agents[0]?.platform}) — جاري بناء الملف الكامل...`,
        ts: Date.now(),
      }]);
    }
    prevHasDevice.current = hasDevice;
  }, [hasDevice, intel, loadProfile]);

  // Profile refresh every 30s when connected
  useEffect(() => {
    if (!hasDevice) return;
    loadProfile();
    const iv = setInterval(loadProfile, 30000);
    return () => clearInterval(iv);
  }, [hasDevice, loadProfile]);

  // WebSocket live updates
  useEffect(() => {
    const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl   = `${wsProto}://${window.location.host}/api/ws`;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "kali_task_update" && msg.data?.task) {
              setTasks(prev => {
                const i = prev.findIndex(t => t.id === msg.data.task.id);
                if (i >= 0) { const n = [...prev]; n[i] = msg.data.task; return n; }
                return [msg.data.task, ...prev];
              });
            }
            if (msg.type === "kali_task_deleted") setTasks(prev => prev.filter(t => t.id !== msg.data?.id));
            if (msg.type === "local_agent_status") { loadIntel(); if (msg.data?.connected) loadProfile(); }
            if (msg.type === "agent_deep_profile") loadProfile();
          } catch {}
        };
        ws.onclose = () => { retryTimer = setTimeout(connect, 3000); };
      } catch {}
    };
    connect();
    return () => { ws?.close(); clearTimeout(retryTimer); };
  }, [loadIntel, loadProfile]);

  /* ── Send message ─────────────────────────────────────────────────────────── */
  const send = async (prompt?: string) => {
    const text = (prompt ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setStreaming(true);

    const userMsg: ChatMsg = { id: uid(), role: "user", text, ts: Date.now() };
    setMsgs(prev => [...prev, userMsg]);

    const asstId = uid();
    setMsgs(prev => [...prev, { id: asstId, role: "assistant", text: "", ts: Date.now() }]);
    abortRef.current = new AbortController();
    try {
      let asstText = "";
      for await (const { event, data } of streamChat(sessionId.current, text, abortRef.current.signal)) {
        if (event === "delta") {
          asstText += (data as { text: string }).text;
          setMsgs(prev => prev.map(m => m.id === asstId ? { ...m, text: asstText } : m));
        }
        if (event === "exec_result") {
          const d = data as { taskId: string; command: string; result: string; isError: boolean; type?: string };
          const icon = d.type === "agent" ? "🖥️" : "⚡";
          setMsgs(prev => [...prev, {
            id: uid(), role: "exec_result",
            text: `${icon} \`${d.command}\`\n\`\`\`\n${d.result}\n\`\`\``,
            isError: d.isError, command: d.command, taskId: d.taskId, ts: Date.now(),
          }]);
          setTermLog(prev => [...prev.slice(-300), {
            text: `$ ${d.command}\n${d.result}`, isError: d.isError, isCmd: true, ts: Date.now(),
          }]);
        }
        if (event === "plan_proposed") {
          const d = data as { plan: string };
          setMsgs(prev => [...prev, { id: uid(), role: "plan", text: d.plan, ts: Date.now() }]);
        }
        if (event === "task_created") loadTasks();
        if (event === "error") {
          setMsgs(prev => prev.map(m => m.id === asstId ? {
            ...m, text: "❌ خطأ في الاتصال بـ KALI AI — تحقق من إعدادات Ollama", isError: true,
          } : m));
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        setMsgs(prev => prev.map(m => m.id === asstId ? {
          ...m, text: "⚠️ انقطع الاتصال بـ KALI AI", isError: true,
        } : m));
      }
    } finally {
      setBusy(false); setStreaming(false); abortRef.current = null;
      loadTasks();
    }
  };

  /* ── Direct exec ──────────────────────────────────────────────────────────── */
  const execCmd = async (cmd: string, target?: "agent" | "server") => {
    const tgt = target ?? cmdTarget;
    if (!cmd.trim() || cmdBusy) return;
    setCmdBusy(true);
    setCmdInput("");
    setTermLog(prev => [...prev, {
      text: `$ [${tgt === "agent" ? intel?.agents[0]?.hostname ?? "DEVICE" : "SERVER"}] ${cmd}`,
      isError: false, isCmd: true, ts: Date.now(),
    }]);
    try {
      const endpoint = tgt === "agent" ? "/kali-command/agent/exec" : "/kali-command/server/exec";
      const r = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const d = await r.json();
      const out = d.stdout || d.result?.stdout || d.result || d.error || JSON.stringify(d);
      const isErr = !r.ok || d.exitCode !== 0 || !!d.error;
      setTermLog(prev => [...prev, {
        text: String(out).substring(0, 4000),
        isError: isErr, isCmd: false, ts: Date.now(),
      }]);
      if (d.stderr) setTermLog(prev => [...prev, { text: d.stderr, isError: true, isCmd: false, ts: Date.now() }]);
    } catch (e: unknown) {
      setTermLog(prev => [...prev, {
        text: `خطأ: ${e instanceof Error ? e.message : String(e)}`,
        isError: true, isCmd: false, ts: Date.now(),
      }]);
    } finally { setCmdBusy(false); }
  };

  const resetSession = async () => {
    await fetch(`${API}/kali-command/session/reset`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId.current }),
    });
    setMsgs([]);
    setTasks([]);
    sessionId.current = `kali-${Date.now()}`;
  };

  const copyCmd = (txt: string) => {
    navigator.clipboard.writeText(txt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const runningTasks = tasks.filter(t => t.status === "running").length;
  const agent0 = intel?.agents[0];

  /* ═════════════════════════════════════════════════════════════════════════
     RENDER
  ═════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="h-full flex flex-col overflow-hidden"
      style={{ background: "linear-gradient(180deg,#03000a 0%,#060010 100%)", color: "#e0e0e0" }}
      dir="rtl">

      {/* ── TOP STATUS BAR ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0"
        style={{ background: "rgba(0,0,0,0.65)", borderBottom: "1px solid rgba(255,30,30,0.3)", backdropFilter: "blur(12px)" }}>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,rgba(200,0,0,0.7),rgba(60,0,0,0.9))", border: "1px solid rgba(255,50,50,0.6)", boxShadow: "0 0 12px rgba(255,0,0,0.4)" }}>
            <Skull className="w-4 h-4" style={{ color: "#ff4444" }} />
          </div>
          <div className="leading-none">
            <div className="text-[11px] font-black tracking-widest" style={{ color: "#ff4444", textShadow: "0 0 10px rgba(255,50,50,0.8)" }}>KALI AI</div>
            <div className="text-[8px] font-mono" style={{ color: "rgba(255,80,80,0.5)" }}>v7.0 · نيورال كور</div>
          </div>
        </div>

        <div className="flex-1" />

        {/* Server stats */}
        {intel && (
          <div className="hidden md:flex items-center gap-2">
            <Stat icon={Server}     label={intel.server.hostname}                      color="#6699ff" />
            <Stat icon={Cpu}        label={`CPU ${intel.server.loadAvg?.split(",")[0]?.trim() ?? "?"}`} color="#ffaa00" />
            <Stat icon={MemoryStick}label={intel.server.memUsage}                      color="#44ff88" />
            <Stat icon={Brain}      label={`${intel.knowledgeCount} ذاكرة`}            color="#cc44ff" />
            {runningTasks > 0 && <Stat icon={Zap} label={`${runningTasks} مهمة`}      color="#ff6600" />}
          </div>
        )}

        {/* Device badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold"
          style={hasDevice
            ? { background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.4)", color: "#44ff88" }
            : { background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.3)", color: "#ff6666" }}>
          {hasDevice ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {hasDevice ? `${agent0?.hostname} متصل` : "لا يوجد جهاز"}
          {hasDevice && agent0?.isRoot && (
            <span className="text-[8px] px-1 rounded font-black"
              style={{ background: "rgba(255,50,50,0.3)", color: "#ff5555" }}>ROOT</span>
          )}
        </div>

        {/* Connect button (when no device) */}
        {!hasDevice && (
          <button onClick={() => { setShowConnect(v => !v); loadConnectInfo(); }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all"
            style={{ background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.35)", color: "#44ff88" }}>
            <Play className="w-3 h-3" />اتصل بجهازك
          </button>
        )}

        {/* Actions */}
        <button onClick={() => { loadIntel(); loadProfile(); }} title="تحديث"
          className="p-1.5 rounded-lg transition-colors hover:bg-white/5">
          <RefreshCw className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
        <button onClick={resetSession}
          className="px-2 py-1 rounded-lg text-[9px] font-mono font-bold transition-all hover:bg-red-500/10"
          style={{ border: "1px solid rgba(255,50,50,0.3)", color: "rgba(255,80,80,0.7)" }}>
          جلسة جديدة
        </button>
      </div>

      {/* ── CONNECT GUIDE ─────────────────────────────────────────────────────── */}
      {showConnect && connectInfo && (
        <div className="px-4 py-3 shrink-0"
          style={{ background: "rgba(68,255,136,0.04)", borderBottom: "1px solid rgba(68,255,136,0.2)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Radio className="w-3.5 h-3.5" style={{ color: "#44ff88" }} />
            <span className="text-[10px] font-black tracking-widest" style={{ color: "#44ff88" }}>اتصل بجهاز كالي</span>
            <button onClick={() => setShowConnect(false)} className="ml-auto p-1 rounded hover:bg-white/5">
              <X className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
          </div>
          <p className="text-[9px] font-mono mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>
            شغّل هذا الأمر على جهاز كالي Linux:
          </p>
          <div className="flex items-start gap-2 rounded-xl px-3 py-2"
            style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(68,255,136,0.2)" }}>
            <code className="flex-1 text-[9px] font-mono break-all" style={{ color: "#44ff88" }}>
              {connectInfo.oneLineBash}
            </code>
            <button onClick={() => copyCmd(connectInfo.oneLineBash)}
              className="p-1 rounded transition-colors hover:bg-white/10 shrink-0">
              {copied ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#44ff88" }} /> : <Copy className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />}
            </button>
          </div>
          <p className="text-[8px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>
            يتطلب: Node.js + npm. سيتصل تلقائياً ويبقى متصلاً.
          </p>
        </div>
      )}

      {/* ── MAIN LAYOUT ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 gap-0 overflow-hidden">

        {/* ══════════ LEFT — Chat Panel ══════════ */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0"
          style={{ borderRight: "1px solid rgba(255,30,30,0.12)" }}>

          {/* Quick prompts */}
          <div className="flex gap-1.5 px-3 py-2 shrink-0 flex-wrap"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.3)" }}>
            {QUICK_PROMPTS.map(q => (
              <button key={q.label} onClick={() => send(q.prompt)} disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all disabled:opacity-40"
                style={{ background: `${q.color}12`, border: `1px solid ${q.color}35`, color: q.color }}
                onMouseEnter={e => (e.currentTarget.style.background = `${q.color}22`)}
                onMouseLeave={e => (e.currentTarget.style.background = `${q.color}12`)}>
                <q.icon className="w-3 h-3" />{q.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,30,30,0.2) transparent" }}>
            {msgs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4 opacity-40">
                <Skull className="w-14 h-14" style={{ color: "#ff3333", filter: "drop-shadow(0 0 20px rgba(255,0,0,0.5))" }} />
                <div className="text-center">
                  <p className="text-sm font-black tracking-widest" style={{ color: "#ff4444" }}>KALI AI v7 — جاهز</p>
                  <p className="text-xs font-mono mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>
                    {hasDevice ? `جهاز متصل: ${agent0?.hostname}` : "اكتب مهمتك أو اختر أمراً سريعاً"}
                  </p>
                </div>
              </div>
            )}
            {msgs.map(m => <ChatBubble key={m.id} msg={m} />)}
          </div>

          {/* Input */}
          <div className="px-3 py-2.5 shrink-0"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)" }}>
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={hasDevice
                  ? `اكتب مهمتك لـ KALI AI... الجهاز ${agent0?.hostname} جاهز للتنفيذ`
                  : "اكتب مهمتك لـ KALI AI... (Enter للإرسال، Shift+Enter سطر جديد)"}
                rows={2} disabled={busy}
                className="flex-1 resize-none rounded-xl px-3 py-2 text-sm font-mono disabled:opacity-50"
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,50,50,0.25)",
                  color: "rgba(255,255,255,0.85)", outline: "none", lineHeight: 1.5,
                }}
              />
              {busy ? (
                <button onClick={() => abortRef.current?.abort()}
                  className="px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs font-mono font-bold"
                  style={{ background: "rgba(255,50,50,0.15)", border: "1px solid rgba(255,50,50,0.4)", color: "#ff5555" }}>
                  <Square className="w-3.5 h-3.5" />إيقاف
                </button>
              ) : (
                <button onClick={() => send()} disabled={!input.trim()}
                  className="px-4 py-2 rounded-xl flex items-center gap-1.5 text-xs font-mono font-bold transition-all disabled:opacity-30"
                  style={{ background: "rgba(255,30,30,0.18)", border: "1px solid rgba(255,50,50,0.5)", color: "#ff5555" }}>
                  <Send className="w-3.5 h-3.5" />إرسال
                </button>
              )}
            </div>
            {streaming && (
              <div className="flex items-center gap-1.5 mt-1">
                <Loader2 className="w-3 h-3 animate-spin" style={{ color: "#ff4444" }} />
                <span className="text-[9px] font-mono" style={{ color: "rgba(255,100,100,0.6)" }}>KALI AI يفكر ويعالج...</span>
              </div>
            )}
          </div>
        </div>

        {/* ══════════ RIGHT — Control Panel ══════════ */}
        <div className="w-[380px] shrink-0 flex flex-col min-h-0 overflow-y-auto px-2 py-2 gap-0"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,30,30,0.15) transparent" }}>

          {/* ── Tasks ── */}
          <CollapsibleSection
            title={`قائمة المهام (${tasks.length})`}
            icon={Activity} color="#ff4444"
            badge={runningTasks}
            defaultOpen={true}
            extra={tasks.length > 0
              ? <button onClick={async (e) => { e.stopPropagation(); await fetch(`${API}/kali-command/tasks`, { method: "DELETE" }); setTasks([]); }}
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded ml-1"
                  style={{ color: "rgba(255,60,60,0.5)", border: "1px solid rgba(255,60,60,0.2)" }}>
                  مسح
                </button>
              : undefined}>
            {tasks.length === 0
              ? <div className="text-center py-4 text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>
                  ابدأ محادثة مع KALI AI لإنشاء المهام
                </div>
              : tasks.map(task => <TaskCard key={task.id} task={task} onDelete={async (id) => {
                  await fetch(`${API}/kali-command/tasks/${id}`, { method: "DELETE" });
                  setTasks(prev => prev.filter(t => t.id !== id));
                }} />)
            }
          </CollapsibleSection>

          {/* ── Device Profile ── */}
          <CollapsibleSection
            title={hasDevice ? `جهاز متصل: ${agent0?.hostname}` : "لا يوجد جهاز"}
            icon={Monitor} color={hasDevice ? "#44ff88" : "#ff4444"}
            defaultOpen={hasDevice}>
            {hasDevice && agent0
              ? <DeviceProfilePanel agent={agent0} profile={profile} />
              : <div className="text-center py-5 space-y-3">
                  <WifiOff className="w-8 h-8 mx-auto" style={{ color: "rgba(255,50,50,0.25)" }} />
                  <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>لا يوجد جهاز متصل</p>
                  <button onClick={() => { setShowConnect(true); loadConnectInfo(); }}
                    className="px-3 py-1.5 rounded-lg text-[9px] font-mono font-bold transition-all"
                    style={{ background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.35)", color: "#44ff88" }}>
                    <Play className="w-3 h-3 inline mr-1" />كيفية الاتصال
                  </button>
                </div>
            }
          </CollapsibleSection>

          {/* ── Terminal ── */}
          <CollapsibleSection
            title="الطرفية المباشرة"
            icon={Terminal} color="#ffaa00" defaultOpen={true}>
            <div className="space-y-2">
              {/* Target toggle */}
              <div className="flex rounded-lg overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                {(["agent", "server"] as const).map(tgt => (
                  <button key={tgt} onClick={() => setCmdTarget(tgt)}
                    className="flex-1 py-1 text-[9px] font-mono font-bold transition-all"
                    style={cmdTarget === tgt
                      ? { background: tgt === "agent" ? "rgba(68,255,136,0.15)" : "rgba(100,150,255,0.15)", color: tgt === "agent" ? "#44ff88" : "#6699ff", borderBottom: `2px solid ${tgt === "agent" ? "#44ff88" : "#6699ff"}` }
                      : { color: "rgba(255,255,255,0.3)" }}>
                    {tgt === "agent" ? `🖥️ ${agent0?.hostname ?? "DEVICE"}` : "⚡ SERVER"}
                  </button>
                ))}
              </div>

              {/* Quick commands */}
              <div className="flex flex-wrap gap-1">
                {DEVICE_CMDS.slice(0, 6).map(cmd => (
                  <button key={cmd} onClick={() => execCmd(cmd)} disabled={cmdBusy || (cmdTarget === "agent" && !hasDevice)}
                    className="px-2 py-1 rounded text-[8px] font-mono transition-all disabled:opacity-30"
                    style={{ background: "rgba(255,170,0,0.05)", border: "1px solid rgba(255,170,0,0.15)", color: "rgba(255,170,0,0.6)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,170,0,0.12)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,170,0,0.05)")}>
                    {cmd.split(" ")[0]}
                  </button>
                ))}
              </div>

              {/* Terminal output */}
              <div ref={termRef}
                className="rounded-xl p-2 h-36 overflow-y-auto font-mono text-[9px]"
                style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,170,0,0.15)", scrollbarWidth: "thin" }}>
                {termLog.length === 0
                  ? <span style={{ color: "rgba(255,255,255,0.15)" }}>الطرفية جاهزة...</span>
                  : termLog.slice(-80).map((line, i) => (
                    <div key={i} className="leading-relaxed whitespace-pre-wrap break-all"
                      style={{ color: line.isCmd ? "#ffaa44" : line.isError ? "#ff6666" : "rgba(255,255,255,0.7)" }}>
                      {line.text}
                    </div>
                  ))
                }
                {cmdBusy && <div className="flex items-center gap-1.5 mt-1"><Loader2 className="w-2.5 h-2.5 animate-spin" style={{ color: "#ffaa44" }} /><span style={{ color: "rgba(255,170,0,0.6)" }}>تنفيذ...</span></div>}
              </div>

              {/* Command input */}
              <div className="flex gap-1.5">
                <div className="text-[10px] font-mono mt-1.5 flex-shrink-0" style={{ color: "rgba(255,170,0,0.5)" }}>$</div>
                <input
                  value={cmdInput}
                  onChange={e => setCmdInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") execCmd(cmdInput); }}
                  placeholder={cmdTarget === "agent" && !hasDevice ? "لا يوجد جهاز..." : "اكتب أمراً..."}
                  disabled={cmdBusy || (cmdTarget === "agent" && !hasDevice)}
                  className="flex-1 rounded-lg px-2.5 py-1.5 text-[10px] font-mono disabled:opacity-40"
                  style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,170,0,0.25)", color: "#ffaa44", outline: "none" }}
                />
                <button onClick={() => execCmd(cmdInput)}
                  disabled={!cmdInput.trim() || cmdBusy || (cmdTarget === "agent" && !hasDevice)}
                  className="px-2.5 py-1.5 rounded-lg text-[9px] font-mono font-bold transition-all disabled:opacity-30"
                  style={{ background: "rgba(255,170,0,0.1)", border: "1px solid rgba(255,170,0,0.3)", color: "#ffaa44" }}>
                  <Play className="w-3 h-3" />
                </button>
                {termLog.length > 0 && (
                  <button onClick={() => setTermLog([])}
                    className="px-2 py-1.5 rounded-lg transition-all hover:bg-red-500/10"
                    style={{ border: "1px solid rgba(255,50,50,0.2)" }} title="مسح الطرفية">
                    <Trash2 className="w-3 h-3" style={{ color: "rgba(255,80,80,0.5)" }} />
                  </button>
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* ── Quick Device Commands ── */}
          {hasDevice && (
            <CollapsibleSection
              title="أوامر سريعة على الجهاز"
              icon={Zap} color="#cc44ff" defaultOpen={false}>
              <div className="grid grid-cols-2 gap-1">
                {DEVICE_CMDS.map(cmd => (
                  <button key={cmd} onClick={() => { setCmdTarget("agent"); execCmd(cmd, "agent"); }}
                    disabled={cmdBusy}
                    className="text-left px-2 py-1.5 rounded-lg text-[8.5px] font-mono transition-all disabled:opacity-40 truncate"
                    style={{ background: "rgba(200,68,255,0.05)", border: "1px solid rgba(200,68,255,0.15)", color: "rgba(200,100,255,0.6)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(200,68,255,0.12)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(200,68,255,0.05)")}>
                    {cmd}
                  </button>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* ── Server Info ── */}
          {intel && (
            <CollapsibleSection title="معلومات السيرفر" icon={Server} color="#6699ff" defaultOpen={false}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] font-mono"
                style={{ color: "rgba(255,255,255,0.5)" }}>
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>hostname: </span><span style={{ color: "#6699ff" }}>{intel.server.hostname}</span></span>
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>platform: </span>{intel.server.platform}</span>
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>arch: </span>{intel.server.arch}</span>
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>cpus: </span>{intel.server.cpus}</span>
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>mem: </span>{intel.server.totalMemory}</span>
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>uptime: </span>{intel.server.uptime}</span>
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>load: </span>{intel.server.loadAvg}</span>
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>ports: </span>{intel.server.openPorts}</span>
              </div>
              <div className="flex gap-3 mt-2 text-[9px] font-mono">
                <span><span style={{ color: "rgba(255,255,255,0.25)" }}>tasks: </span>
                  <span style={{ color: "#ffaa00" }}>{intel.tasks.running}</span> تعمل ·
                  <span style={{ color: "#44ff88" }}> {intel.tasks.done}</span> منجزة ·
                  <span style={{ color: "#ff4444" }}> {intel.tasks.failed}</span> فاشلة
                </span>
              </div>
            </CollapsibleSection>
          )}

        </div>
      </div>
    </div>
  );
}
