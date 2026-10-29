/**
 * KaliTerminalPage — xterm.js terminal emulator for connected local agent.
 *
 * Features:
 *  - Full xterm.js terminal with dark Kali theme
 *  - Live command execution on connected agent via SSE
 *  - Session history with ↑/↓ navigation
 *  - Copy/paste support
 *  - Real-time streaming output
 *  - Agent selector, file browser, process list, screenshot viewer
 *  - Model picker for Ollama / Dolphin AI
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  Skull, RefreshCw, Folder, Activity, Camera, Cpu, Wifi,
  WifiOff, Trash2, Send, ChevronRight, Download, Terminal as TermIcon,
  HardDrive, MemoryStick, Eye, EyeOff, Copy, X, Loader2,
  Play, StopCircle, Brain, List, FileText, Monitor,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AgentInfo {
  id: string;
  hostname: string;
  platform: string;
  user: string;
  arch?: string;
  cpus?: number;
  totalMemory?: number;
  nodeVersion?: string;
  capabilities?: string[];
  interfaces?: Record<string, string[]>;
  connectedAt: number;
}

interface FsEntry {
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mtime: number;
  path: string;
}

interface ProcessEntry {
  pid: string;
  user: string;
  cpu: string;
  mem: string;
  command: string;
}

type TabKind = "terminal" | "files" | "processes" | "screenshot" | "ai";

const XTERM_THEME = {
  background: "#010204",
  foreground: "#e0ffe0",
  cursor: "#00ff88",
  cursorAccent: "#010204",
  black: "#000000",
  red: "#ff4444",
  green: "#00ff88",
  yellow: "#ffcc00",
  blue: "#4488ff",
  magenta: "#ff44ff",
  cyan: "#44ffee",
  white: "#e0ffe0",
  brightBlack: "#444444",
  brightRed: "#ff6666",
  brightGreen: "#44ffaa",
  brightYellow: "#ffdd44",
  brightBlue: "#66aaff",
  brightMagenta: "#ff66ff",
  brightCyan: "#66ffee",
  brightWhite: "#ffffff",
  selectionBackground: "#00ff8833",
};

const QUICK_CMDS = [
  "whoami", "id", "hostname", "uname -a", "ip addr", "ss -tulpn",
  "ps aux --sort=-%cpu | head -15", "df -h", "free -h",
  "cat /etc/os-release", "netstat -tulpn 2>/dev/null",
  "find / -perm -4000 2>/dev/null | head -10",
  "cat /etc/passwd | head -20", "sudo -l 2>/dev/null",
  "env | grep -v PATH", "history | tail -20",
  "ls -la /home", "cat /etc/hosts",
  "nmap -sV --top-ports 20 127.0.0.1 2>&1",
  "which nmap nikto gobuster sqlmap hydra",
];

export default function KaliTerminalPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<TabKind>("terminal");

  // Terminal
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // File browser
  const [fsDir, setFsDir] = useState("~");
  const [fsEntries, setFsEntries] = useState<FsEntry[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [fsBreadcrumbs, setFsBreadcrumbs] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<FsEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // Processes
  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [procsLoading, setProcsLoading] = useState(false);
  const [procSearch, setProcSearch] = useState("");

  // Screenshot
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  // ── xterm.js init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!termRef.current || xtermRef.current) return;

    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    term.writeln("\x1b[32m╔══════════════════════════════════════════════════════╗\x1b[0m");
    term.writeln("\x1b[32m║   \x1b[1;36mCyberNova Nova-Agent Terminal v2\x1b[0m\x1b[32m                 ║\x1b[0m");
    term.writeln("\x1b[32m╚══════════════════════════════════════════════════════╝\x1b[0m");
    term.writeln("\x1b[90mاتصل بجهازك المحلي باستخدام nova-agent.js\x1b[0m");
    term.writeln("");

    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* ignore */ } });
    ro.observe(termRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // ── Fetch agent list ─────────────────────────────────────────────────────────
  const fetchAgents = useCallback(async () => {
    try {
      const r = await fetch("/api/local-agent/status");
      const d = await r.json() as { connected: boolean; agents: AgentInfo[] };
      setAgents(d.agents || []);
      setConnected(d.connected);
      if (d.agents.length > 0 && !selectedAgent) {
        setSelectedAgent(d.agents[0].id);
      }
    } catch { /* ignore */ }
  }, [selectedAgent]);

  useEffect(() => {
    fetchAgents();
    const t = setInterval(fetchAgents, 5000);
    return () => clearInterval(t);
  }, [fetchAgents]);

  // Write to xterm
  const writeToTerm = useCallback((text: string, color?: string) => {
    if (!xtermRef.current) return;
    if (color) {
      xtermRef.current.write(color + text + "\x1b[0m");
    } else {
      xtermRef.current.write(text);
    }
  }, []);

  const writeLineToTerm = useCallback((text: string, color?: string) => {
    writeToTerm((color ? color : "") + text + (color ? "\x1b[0m" : "") + "\r\n");
  }, [writeToTerm]);

  // ── Execute command ──────────────────────────────────────────────────────────
  const executeCmd = useCallback(async (cmd: string) => {
    if (!cmd.trim() || busy) return;
    if (!connected || !selectedAgent) {
      writeLineToTerm("⚠ لا يوجد جهاز متصل. شغّل nova-agent.js على الجهاز المحلي.", "\x1b[33m");
      return;
    }

    // Add to history
    setCmdHistory(h => {
      const next = h[h.length - 1] === cmd ? h : [...h, cmd];
      return next.slice(-200);
    });
    setHistIdx(-1);
    setInput("");

    // Show prompt + command
    const agent = agents.find(a => a.id === selectedAgent);
    const prompt = `\x1b[1;31m${agent?.user ?? "kali"}@${agent?.hostname ?? "local"}\x1b[0m\x1b[32m:~$\x1b[0m `;
    writeToTerm(`\r\n${prompt}\x1b[1;37m${cmd}\x1b[0m\r\n`);

    if (cmd.trim() === "clear" || cmd.trim() === "cls") {
      xtermRef.current?.clear();
      return;
    }

    setBusy(true);
    abortRef.current = new AbortController();

    try {
      const params = new URLSearchParams({ command: cmd, agentId: selectedAgent, timeout: "120000" });
      const es = new EventSource(`/api/local-agent/exec-stream?${params}`);

      await new Promise<void>((resolve) => {
        es.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data) as { type: string; text?: string; exitCode?: number; durationMs?: number };
            if (d.type === "stdout" && d.text) {
              writeToTerm(d.text.replace(/\n/g, "\r\n"));
            } else if (d.type === "stderr" && d.text) {
              writeToTerm("\x1b[33m" + d.text.replace(/\n/g, "\r\n") + "\x1b[0m");
            } else if (d.type === "done") {
              const exitOk = (d.exitCode ?? 0) === 0;
              writeToTerm(`\r\n\x1b[${exitOk ? "32" : "31"}m[exit ${d.exitCode ?? 0} | ${d.durationMs ?? 0}ms]\x1b[0m\r\n`);
              es.close();
              resolve();
            } else if (d.type === "error") {
              writeLineToTerm(`⚠ ${d.text}`, "\x1b[31m");
              es.close();
              resolve();
            }
          } catch { /* ignore */ }
        };
        es.onerror = () => { es.close(); resolve(); };
      });
    } catch (e) {
      writeLineToTerm(`Error: ${(e as Error).message}`, "\x1b[31m");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, connected, selectedAgent, agents, writeToTerm, writeLineToTerm]);

  // ── File browser ─────────────────────────────────────────────────────────────
  const loadDir = useCallback(async (dir: string) => {
    if (!connected || !selectedAgent) return;
    setFsLoading(true);
    try {
      const r = await fetch(`/api/local-agent/fs/list?agentId=${selectedAgent}&dir=${encodeURIComponent(dir)}`);
      const d = await r.json() as { dir: string; items: FsEntry[]; error?: string };
      if (d.items) {
        setFsEntries(d.items);
        setFsDir(d.dir ?? dir);
        const parts = (d.dir ?? dir).split("/").filter(Boolean);
        setFsBreadcrumbs(["/" , ...parts]);
      }
    } catch { /* ignore */ }
    setFsLoading(false);
  }, [connected, selectedAgent]);

  useEffect(() => {
    if (tab === "files" && connected) loadDir(fsDir);
  }, [tab, connected, loadDir, fsDir]);

  const loadFileContent = useCallback(async (entry: FsEntry) => {
    if (entry.isDir) { loadDir(entry.path); return; }
    setSelectedFile(entry);
    setFileLoading(true);
    setFileContent(null);
    try {
      const r = await fetch("/api/local-agent/fs/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: entry.path, agentId: selectedAgent }),
      });
      const d = await r.json() as { content?: string; error?: string; truncated?: boolean };
      setFileContent(d.content ?? d.error ?? "");
    } catch (e) { setFileContent(String(e)); }
    setFileLoading(false);
  }, [selectedAgent, loadDir]);

  // ── Process list ──────────────────────────────────────────────────────────────
  const loadProcesses = useCallback(async () => {
    if (!connected || !selectedAgent) return;
    setProcsLoading(true);
    try {
      const r = await fetch(`/api/local-agent/processes?agentId=${selectedAgent}`);
      const d = await r.json() as { processes?: ProcessEntry[]; processes_result?: { processes: ProcessEntry[] } };
      const procs = d.processes ?? (d as any)?.processes ?? [];
      setProcesses(procs);
    } catch { /* ignore */ }
    setProcsLoading(false);
  }, [connected, selectedAgent]);

  const killProc = useCallback(async (pid: string) => {
    await fetch("/api/local-agent/kill-process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid, agentId: selectedAgent }),
    });
    await loadProcesses();
  }, [selectedAgent, loadProcesses]);

  useEffect(() => {
    if (tab === "processes" && connected) loadProcesses();
  }, [tab, connected, loadProcesses]);

  // ── Screenshot ────────────────────────────────────────────────────────────────
  const takeScreenshot = useCallback(async () => {
    if (!connected || !selectedAgent) return;
    setScreenshotLoading(true);
    setScreenshotError(null);
    try {
      const r = await fetch(`/api/local-agent/screenshot?agentId=${selectedAgent}`);
      const d = await r.json() as { ok: boolean; dataUri?: string; error?: string };
      if (d.ok && d.dataUri) {
        setScreenshot(d.dataUri);
      } else {
        setScreenshotError(d.error ?? "فشل التصوير");
      }
    } catch (e) { setScreenshotError(String(e)); }
    setScreenshotLoading(false);
  }, [connected, selectedAgent]);

  // ── Key handling in terminal input ───────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(histIdx + 1, cmdHistory.length - 1);
      setHistIdx(next);
      if (cmdHistory[cmdHistory.length - 1 - next]) setInput(cmdHistory[cmdHistory.length - 1 - next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? "" : cmdHistory[cmdHistory.length - 1 - next] ?? "");
    } else if (e.key === "c" && e.ctrlKey) {
      if (abortRef.current) { abortRef.current.abort(); setBusy(false); }
      writeLineToTerm("^C", "\x1b[31m");
    }
  }, [histIdx, cmdHistory, writeLineToTerm]);

  const formatBytes = (b: number) => {
    if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
    if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
    if (b > 1e3) return (b / 1e3).toFixed(1) + " KB";
    return b + " B";
  };

  const selectedAgentInfo = agents.find(a => a.id === selectedAgent);

  return (
    <div className="flex flex-col h-full bg-[#010204] text-green-300" style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-green-900/40 bg-[#010a04]">
        <Skull className="w-4 h-4 text-red-400" />
        <span className="text-sm font-bold text-red-300 tracking-wider">NOVA AGENT TERMINAL</span>
        <div className="flex items-center gap-1.5 ms-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-red-900"}`} />
          <span className={`text-xs ${connected ? "text-green-400" : "text-red-700"}`}>
            {connected ? `${agents.length} متصل` : "غير متصل"}
          </span>
        </div>
        {selectedAgentInfo && (
          <span className="text-xs text-green-700 font-mono">
            {selectedAgentInfo.user}@{selectedAgentInfo.hostname} ({selectedAgentInfo.platform} {selectedAgentInfo.arch})
          </span>
        )}
        {/* Agent selector */}
        {agents.length > 1 && (
          <select
            value={selectedAgent || ""}
            onChange={e => setSelectedAgent(e.target.value)}
            className="text-xs bg-black border border-green-900/50 text-green-300 rounded px-1.5 py-0.5 outline-none ms-auto"
          >
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.user}@{a.hostname}</option>
            ))}
          </select>
        )}
        <button onClick={fetchAgents} className="text-green-800 hover:text-green-400 transition ms-auto">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {/* Download nova-agent */}
        <a href="/api/local-agent/download-nova-agent" download="nova-agent.js"
          className="text-xs px-2 py-0.5 rounded border border-green-900/50 text-green-700 hover:text-green-300 hover:border-green-700/50 transition flex items-center gap-1">
          <Download className="w-3 h-3" /> nova-agent.js
        </a>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex border-b border-green-900/40 bg-[#010a04]">
        {([
          { id: "terminal", icon: TermIcon, label: "Terminal" },
          { id: "files", icon: Folder, label: "ملفات" },
          { id: "processes", icon: Activity, label: "عمليات" },
          { id: "screenshot", icon: Camera, label: "لقطة شاشة" },
        ] as { id: TabKind; icon: React.FC<{ className?: string }>; label: string }[]).map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`text-xs px-4 py-2 border-b-2 transition-all flex items-center gap-1.5 ${tab === id ? "border-green-400 text-green-300" : "border-transparent text-green-900 hover:text-green-600"}`}>
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Not connected banner ──────────────────────────────────────────────── */}
      {!connected && (
        <div className="shrink-0 mx-4 mt-3 p-3 rounded border border-red-900/50 bg-red-950/20">
          <div className="flex items-center gap-2 mb-2">
            <WifiOff className="w-4 h-4 text-red-500" />
            <span className="text-xs font-bold text-red-400">لا يوجد جهاز متصل</span>
          </div>
          <div className="text-xs text-red-700 mb-2">شغّل nova-agent.js على الجهاز المحلي:</div>
          <div className="space-y-1.5">
            {[
              { label: "تنزيل وتشغيل (أمر واحد)", cmd: `node <(curl -sL "${window.location.origin}/api/local-agent/download-nova-agent") --server wss://${window.location.host}/api/local-agent/ws --reconnect` },
              { label: "أو: تنزيل ثم تشغيل", cmd: `curl -sL "${window.location.origin}/api/local-agent/download-nova-agent" -o nova-agent.js && node nova-agent.js --server wss://${window.location.host}/api/local-agent/ws --reconnect` },
            ].map(item => (
              <div key={item.label} className="bg-black/60 border border-red-900/30 rounded px-2 py-1.5">
                <div className="flex justify-between mb-0.5">
                  <span className="text-[10px] text-red-700">{item.label}</span>
                  <button onClick={() => navigator.clipboard.writeText(item.cmd).catch(() => {})}
                    className="text-[10px] text-red-700 hover:text-red-400 px-1 border border-red-900/30 rounded">نسخ</button>
                </div>
                <div className="text-red-300 text-[10px] font-mono break-all select-all">{item.cmd}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* Terminal tab */}
        {tab === "terminal" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Quick commands */}
            <div className="shrink-0 px-2 py-1 border-b border-green-900/30 flex gap-1 overflow-x-auto" style={{ background: "#010a04" }}>
              {QUICK_CMDS.slice(0, 12).map(cmd => (
                <button key={cmd} onClick={() => void executeCmd(cmd)} disabled={busy || !connected}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-black/40 border border-green-900/40 text-green-800 hover:text-green-300 hover:bg-green-900/30 transition shrink-0 disabled:opacity-30">
                  {cmd.split(" ")[0]}
                </button>
              ))}
            </div>
            {/* xterm.js canvas */}
            <div ref={termRef} className="flex-1 min-h-0 p-1" style={{ background: "#010204" }} />
            {/* Command input */}
            <div className="shrink-0 border-t border-green-900/50 bg-[#010a04]">
              <form onSubmit={e => { e.preventDefault(); void executeCmd(input); }}>
                <div className="flex items-center gap-2 px-3 py-2">
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 text-green-500 animate-spin shrink-0" />
                  ) : (
                    <span className="text-green-600 font-bold shrink-0 select-none">$</span>
                  )}
                  <input
                    value={input}
                    onChange={e => { setInput(e.target.value); setHistIdx(-1); }}
                    onKeyDown={handleKeyDown}
                    disabled={busy}
                    placeholder={connected ? `أمر على ${selectedAgentInfo?.hostname ?? "الجهاز"}... (↑↓ للتاريخ | Ctrl+C إلغاء)` : "اتصل بالجهاز أولاً..."}
                    className="flex-1 bg-transparent outline-none text-green-300 text-sm placeholder:text-green-900 disabled:opacity-30"
                    style={{ caretColor: "#00ff88" }}
                    autoFocus
                  />
                  {busy ? (
                    <button type="button" onClick={() => { abortRef.current?.abort(); setBusy(false); }}
                      className="text-red-500 hover:text-red-300 transition">
                      <StopCircle className="w-4 h-4" />
                    </button>
                  ) : (
                    <button type="submit" disabled={!input.trim() || !connected}
                      className="text-green-700 hover:text-green-300 disabled:opacity-20 transition">
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </form>
              <div className="px-3 pb-1.5 flex items-center gap-2">
                <button onClick={() => { xtermRef.current?.clear(); }}
                  className="text-[9px] font-mono px-2 py-0.5 rounded bg-black/30 border border-green-900/30 text-green-900 hover:text-green-500 transition">
                  CLS
                </button>
                <span className="text-[9px] text-green-900">{cmdHistory.length} في التاريخ</span>
                {busy && <span className="text-[9px] text-green-600 animate-pulse ms-auto">⚡ تنفيذ...</span>}
              </div>
            </div>
          </div>
        )}

        {/* File Browser tab */}
        {tab === "files" && (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* File list */}
            <div className="flex-1 flex flex-col min-h-0 border-r border-green-900/30">
              {/* Breadcrumbs */}
              <div className="shrink-0 px-3 py-1.5 border-b border-green-900/30 flex items-center gap-1 overflow-x-auto" style={{ background: "#010a04" }}>
                <HardDrive className="w-3 h-3 text-green-700 shrink-0" />
                {fsBreadcrumbs.map((part, i) => (
                  <span key={i} className="flex items-center gap-0.5 shrink-0">
                    {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-green-900" />}
                    <button onClick={() => loadDir(fsBreadcrumbs.slice(0, i + 1).join("/") || "/")}
                      className="text-[10px] text-green-600 hover:text-green-300 transition">{part}</button>
                  </span>
                ))}
                {fsLoading && <Loader2 className="w-3 h-3 text-green-700 animate-spin ms-auto shrink-0" />}
                <button onClick={() => loadDir(fsDir)}
                  className="ms-auto text-green-900 hover:text-green-600 transition shrink-0">
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              {/* Parent dir */}
              <div className="shrink-0">
                <button onClick={() => { const parts = fsDir.split("/"); loadDir(parts.slice(0, -1).join("/") || "/"); }}
                  className="w-full text-left px-3 py-1 text-[10px] text-green-800 hover:bg-green-900/20 flex items-center gap-1.5 transition">
                  <Folder className="w-3 h-3" /> ..
                </button>
              </div>
              {/* Entries */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {fsEntries.map(entry => (
                  <button key={entry.path} onClick={() => loadFileContent(entry)}
                    className={`w-full text-left px-3 py-1 text-[10px] flex items-center gap-2 transition hover:bg-green-900/10 ${selectedFile?.path === entry.path ? "bg-green-900/20 text-green-200" : "text-green-700"}`}>
                    {entry.isDir ? <Folder className="w-3 h-3 text-yellow-600 shrink-0" /> : <FileText className="w-3 h-3 text-green-800 shrink-0" />}
                    <span className={`flex-1 truncate ${entry.isDir ? "text-yellow-500" : ""}`}>{entry.name}</span>
                    {!entry.isDir && <span className="text-green-900 shrink-0">{formatBytes(entry.size)}</span>}
                  </button>
                ))}
                {fsEntries.length === 0 && !fsLoading && (
                  <div className="px-3 py-4 text-[10px] text-green-900 text-center">فارغ</div>
                )}
              </div>
            </div>

            {/* File content viewer */}
            <div className="w-96 flex flex-col min-h-0">
              {selectedFile ? (
                <>
                  <div className="shrink-0 px-3 py-1.5 border-b border-green-900/30 flex items-center gap-2" style={{ background: "#010a04" }}>
                    <FileText className="w-3 h-3 text-green-700" />
                    <span className="text-[10px] text-green-500 truncate flex-1">{selectedFile.name}</span>
                    <button onClick={() => setSelectedFile(null)} className="text-green-900 hover:text-green-500 transition">
                      <X className="w-3 h-3" />
                    </button>
                    <button onClick={() => { if (fileContent) navigator.clipboard.writeText(fileContent).catch(() => {}); }}
                      className="text-green-900 hover:text-green-500 transition">
                      <Copy className="w-3 h-3" />
                    </button>
                    <button onClick={() => executeCmd(`cat '${selectedFile.path}'`)}
                      className="text-green-900 hover:text-green-500 transition">
                      <TermIcon className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 min-h-0" style={{ background: "#010204" }}>
                    {fileLoading ? (
                      <div className="flex items-center gap-2 text-green-800 text-[10px] p-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> جاري التحميل...
                      </div>
                    ) : (
                      <pre className="text-[10px] text-green-400 whitespace-pre-wrap break-all leading-relaxed">{fileContent}</pre>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-green-900 text-xs">
                  اختر ملفاً لعرضه
                </div>
              )}
            </div>
          </div>
        )}

        {/* Processes tab */}
        {tab === "processes" && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="shrink-0 px-3 py-1.5 border-b border-green-900/30 flex items-center gap-2" style={{ background: "#010a04" }}>
              <Activity className="w-3 h-3 text-green-700" />
              <input value={procSearch} onChange={e => setProcSearch(e.target.value)}
                placeholder="بحث..."
                className="flex-1 bg-transparent outline-none text-green-300 text-[10px] placeholder:text-green-900"
              />
              <button onClick={loadProcesses} disabled={procsLoading}
                className="text-green-800 hover:text-green-400 transition disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${procsLoading ? "animate-spin" : ""}`} />
              </button>
              <span className="text-[9px] text-green-900">{processes.length} عملية</span>
            </div>
            {/* Header */}
            <div className="shrink-0 px-3 py-1 flex gap-2 text-[9px] text-green-800 border-b border-green-900/20" style={{ background: "#010a04" }}>
              <span className="w-12 shrink-0">PID</span>
              <span className="w-16 shrink-0">USER</span>
              <span className="w-10 shrink-0">CPU%</span>
              <span className="w-10 shrink-0">MEM%</span>
              <span className="flex-1">COMMAND</span>
              <span className="w-12 shrink-0">قتل</span>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {processes
                .filter(p => !procSearch || p.command.includes(procSearch) || p.pid.includes(procSearch) || p.user.includes(procSearch))
                .map(p => (
                  <div key={p.pid} className="px-3 py-0.5 flex gap-2 text-[9px] hover:bg-green-900/10 transition border-b border-green-900/10">
                    <span className="w-12 shrink-0 text-yellow-600">{p.pid}</span>
                    <span className="w-16 shrink-0 text-green-600 truncate">{p.user}</span>
                    <span className={`w-10 shrink-0 ${parseFloat(p.cpu) > 50 ? "text-red-400" : "text-green-700"}`}>{p.cpu}</span>
                    <span className={`w-10 shrink-0 ${parseFloat(p.mem) > 20 ? "text-orange-400" : "text-green-700"}`}>{p.mem}</span>
                    <span className="flex-1 truncate text-green-500">{p.command}</span>
                    <button onClick={() => killProc(p.pid)}
                      className="w-12 shrink-0 text-red-900 hover:text-red-400 transition text-center">
                      <X className="w-3 h-3 inline" />
                    </button>
                  </div>
                ))}
              {processes.length === 0 && !procsLoading && (
                <div className="py-8 text-center text-green-900 text-xs">لا توجد عمليات — اضغط تحديث</div>
              )}
            </div>
          </div>
        )}

        {/* Screenshot tab */}
        {tab === "screenshot" && (
          <div className="flex-1 flex flex-col min-h-0 items-center justify-start p-4 gap-3 overflow-y-auto">
            <button onClick={takeScreenshot} disabled={screenshotLoading || !connected}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg border border-green-500/50 text-green-300 bg-green-500/10 hover:bg-green-500/20 transition disabled:opacity-30">
              {screenshotLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              التقاط لقطة الشاشة
            </button>
            {screenshotError && (
              <div className="text-red-400 text-xs border border-red-900/50 rounded p-2 w-full max-w-md text-center">
                ⚠ {screenshotError}
                <div className="text-red-800 text-[10px] mt-1">تأكد من تثبيت: scrot أو import أو gnome-screenshot</div>
              </div>
            )}
            {screenshot && (
              <div className="w-full max-w-4xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-green-700">لقطة الشاشة الحية</span>
                  <div className="flex gap-2">
                    <a href={screenshot} download="kali-screenshot.png"
                      className="text-[10px] px-2 py-0.5 rounded border border-green-900/50 text-green-700 hover:text-green-400 transition flex items-center gap-1">
                      <Download className="w-2.5 h-2.5" /> تنزيل
                    </a>
                    <button onClick={() => setScreenshot(null)} className="text-[10px] text-green-900 hover:text-green-600 transition">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <img src={screenshot} alt="screenshot" className="w-full rounded border border-green-900/40" />
              </div>
            )}
            {!screenshot && !screenshotError && !screenshotLoading && (
              <div className="text-green-900 text-xs text-center mt-8">
                <Monitor className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <div>اضغط "التقاط لقطة الشاشة" لرؤية واجهة الجهاز المتصل</div>
                <div className="mt-1 text-[10px]">يتطلب: scrot أو import أو gnome-screenshot على الجهاز البعيد</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
