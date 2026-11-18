/**
 * KaliLiveBridge — الجسر الحي الموحد بين كل صفحات كالي
 * ───────────────────────────────────────────────────────
 * أي تنفيذ كالي في أي مكان يظهر حيًا في كل الصفحات الثانية.
 * + تيرمنال موحد + مراقبة عمليات/شبكة/ملفات + بث حي
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, Activity, Cpu, HardDrive, Wifi, Eye, EyeOff, Zap, Clock, X, Maximize2, Minimize2, Trash2, Copy, ExternalLink } from "lucide-react";
import { useKali } from "@/context/KaliContext";

// ─── Live Ticker — يظهر في أعلى كل صفحة ───────────────────────────────
export function KaliLiveTicker() {
  const { liveExec, isConnected, lastUpdate } = useKali();
  const [visible, setVisible] = useState(true);
  const [minimized, setMinimized] = useState(false);

  if (!liveExec && !isConnected) return null;

  return (
    <div className="relative z-20 border-b border-rose-500/20 bg-gradient-to-l from-rose-950/20 via-black/80 to-cyan-950/10">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button onClick={() => setVisible(!visible)} className="flex items-center gap-1.5 text-[10px] font-black" style={{ color: isConnected ? "#44ff88" : "#ff6644" }}>
          {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} style={{ boxShadow: isConnected ? "0 0 8px #44ff88" : "none" }} />
          كالي {isConnected ? "متصل" : "غير متصل"}
        </button>

        {liveExec && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: liveExec.running ? "rgba(239,68,68,0.15)" : "rgba(68,255,136,0.1)", color: liveExec.running ? "#ff6666" : "#44ff88", border: `1px solid ${liveExec.running ? "rgba(239,68,68,0.3)" : "rgba(68,255,136,0.2)"}` }}>
              {liveExec.running ? "● شغّال" : `✓ exit ${liveExec.exitCode}`}
            </span>
            <span className="text-[10px] font-mono truncate flex-1" style={{ color: "#ffaa44" }}>$ {liveExec.cmd}</span>
            <span className="text-[8px] font-mono px-1 py-0.5 rounded hidden sm:inline" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>{liveExec.plane}</span>
            <span className="text-[8px] font-mono hidden sm:inline" style={{ color: "rgba(255,255,255,0.35)" }}>{liveExec.chunks} chunk</span>
          </div>
        )}

        {!liveExec && isConnected && (
          <span className="text-[9px] font-mono flex-1" style={{ color: "rgba(255,255,255,0.35)" }}>جاهز — أي أمر تنفذه هنا هيظهر في كل الصفحات</span>
        )}

        <span className="text-[7px] font-mono hidden md:inline" style={{ color: "rgba(255,255,255,0.25)" }}>{lastUpdate ? new Date(lastUpdate).toLocaleTimeString("ar-EG") : ""}</span>
      </div>
    </div>
  );
}

// ─── Shared Terminal — نفس التيرمنال في كل الصفحات ───────────────────
export function KaliUnifiedTerminal({ embedded = false }: { embedded?: boolean }) {
  const { exec, liveExec, execHistory, clearHistory, isConnected } = useKali();
  const [input, setInput] = useState("");
  const [historyIdx, setHistoryIdx] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cmdHistory = execHistory.map(h => h.cmd);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [liveExec, execHistory]);

  const run = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;
    setInput("");
    setHistoryIdx(-1);
    await exec(cmd, { source: embedded ? "agent-pro:terminal" : "kali-env:terminal" });
  }, [exec, embedded]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") run(input);
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, cmdHistory.length - 1);
      if (cmdHistory[idx]) { setHistoryIdx(idx); setInput(cmdHistory[idx]); }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(idx);
      setInput(idx >= 0 ? cmdHistory[idx] : "");
    }
  };

  const quickCmds = [
    "nmap --version", "whoami; id; pwd", "ls -la", "ps aux | head -20",
    "netstat -tulpn 2>/dev/null | head -20", "cat /etc/os-release",
    "df -h", "uname -a",
  ];

  return (
    <div className={`flex flex-col rounded-xl overflow-hidden ${embedded ? "h-[400px]" : "h-[500px]"}`} style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,100,50,0.2)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10" style={{ background: "linear-gradient(90deg, rgba(255,80,40,0.08), rgba(0,0,0,0.4))" }}>
        <span className="flex items-center gap-2 text-[11px] font-black" style={{ color: "#ff6644" }}>
          <Terminal className="w-4 h-4" />
          كالي — تيرمنال موحّد {isConnected && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>{execHistory.length} أمر</span>
          <button onClick={clearHistory} title="مسح السجل" className="p-1 rounded hover:bg-white/10" style={{ color: "rgba(255,255,255,0.4)" }}><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>

      {/* Quick commands */}
      <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-white/5">
        {quickCmds.map(c => (
          <button key={c} onClick={() => run(c)} className="text-[8px] font-mono px-2 py-0.5 rounded transition hover:scale-105" style={{ background: "rgba(255,100,50,0.08)", border: "1px solid rgba(255,100,50,0.2)", color: "rgba(255,170,100,0.8)" }}>{c.split(" ")[0]}</button>
        ))}
      </div>

      {/* Log */}
      <div ref={logRef} className="flex-1 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed" style={{ background: "rgba(0,0,0,0.4)" }}>
        {execHistory.length === 0 && !liveExec && (
          <div className="text-center py-8 space-y-2">
            <div style={{ color: "rgba(255,255,255,0.2)" }}>جاهز — اكتب أي أمر كالي</div>
            <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.15)" }}>الأوامر هنا تظهر في كل الصفحات لحظيًا</div>
          </div>
        )}
        {execHistory.slice().reverse().slice(0, 20).map(h => (
          <div key={h.id} className="mb-2 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <span style={{ color: h.exitCode === 0 ? "#44ff88" : h.exitCode === null ? "#ffaa44" : "#ff6666" }}>{h.exitCode === 0 ? "✓" : h.exitCode === null ? "◐" : "✗"}</span>
              <span style={{ color: "#ffaa44" }}>$ {h.cmd}</span>
              <span className="text-[7px] px-1 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>{h.plane}</span>
              <span className="text-[7px]" style={{ color: "rgba(255,255,255,0.25)" }}>{h.durationMs ? `${h.durationMs}ms` : ""}</span>
            </div>
            {h.output.slice(1, 4).map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>{line.slice(0, 300)}</div>
            ))}
          </div>
        ))}
        {liveExec && (
          <div className="mb-2 p-2 rounded" style={{ background: "rgba(255,100,50,0.05)", border: "1px solid rgba(255,100,50,0.15)" }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span style={{ color: "#ffaa44" }}>$ {liveExec.cmd}</span>
              <span className="text-[7px] animate-pulse" style={{ color: "#ff6644" }}>● {liveExec.chunks} chunks</span>
            </div>
            {liveExec.output.slice(-3).map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>{line.slice(0, 400)}</div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 p-2 border-t border-white/10" style={{ background: "rgba(0,0,0,0.5)" }}>
        <span className="text-[10px] font-mono shrink-0" style={{ color: "#44ff88" }}>kali@nova:~$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={isConnected ? "اكتب أمر كالي..." : "كالي غير متصل — شغّل عقدة أولًا"}
          disabled={!isConnected}
          className="flex-1 bg-transparent outline-none text-[11px] font-mono placeholder:text-white/20"
          style={{ color: "#ffaa44" }}
        />
        <button onClick={() => run(input)} disabled={!input.trim() || !isConnected} className="px-3 py-1 rounded-lg text-[10px] font-black transition disabled:opacity-30" style={{ background: "rgba(255,80,40,0.15)", border: "1px solid rgba(255,80,40,0.4)", color: "#ff6644" }}>نفّذ ↵</button>
      </div>
    </div>
  );
}

// ─── File Manager — متصفح ملفات كالي ─────────────────────────────────
export function KaliFileManager() {
  const { browseFiles, files, exec, isConnected } = useKali();
  const [path, setPath] = useState("/root");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setPath(p);
    // Use exec to list files - works on any plane
    const r = await exec(`ls -la "${p}" 2>&1 | head -50`, { source: "file-manager" });
    // Parse output into files
    const lines = r.output.split("\n").filter(Boolean);
    const parsed: typeof files = [];
    for (const line of lines.slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 9) {
        const perms = parts[0];
        const name = parts.slice(8).join(" ");
        if (name === "." || name === "..") continue;
        parsed.push({
          name, path: `${p}/${name}`, type: perms.startsWith("d") ? "dir" : perms.startsWith("l") ? "link" : "file",
          size: parseInt(parts[4]) || 0, perms, modified: parts.slice(5, 8).join(" "),
        });
      }
    }
    // For now use parsed, fallback to browseFiles
    setLoading(false);
  }, [exec]);

  useEffect(() => { if (isConnected) void load("/root"); }, [isConnected]);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(100,150,255,0.15)" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10" style={{ background: "rgba(100,150,255,0.06)" }}>
        <span className="flex items-center gap-2 text-[11px] font-black" style={{ color: "#6496ff" }}><HardDrive className="w-4 h-4" /> ملفات كالي</span>
        <div className="flex items-center gap-1">
          <button onClick={() => load("/")} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>/</button>
          <button onClick={() => load("/root")} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>/root</button>
          <button onClick={() => load("/tmp")} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>/tmp</button>
        </div>
      </div>
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-white/5">
        <span className="text-[9px] font-mono flex-1" style={{ color: "rgba(255,255,255,0.5)" }}>{path}</span>
        {loading && <span className="text-[8px] animate-pulse" style={{ color: "#6496ff" }}>يحمّل...</span>}
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {files.length === 0 ? (
          <div className="text-center py-6 text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>{loading ? "يحمّل..." : "فاضي أو غير متصل"}</div>
        ) : (
          files.map(f => (
            <div key={f.path} onClick={() => f.type === "dir" && load(f.path)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer border-b border-white/[0.03]" >
              <span className="text-[11px]">{f.type === "dir" ? "📁" : f.type === "link" ? "🔗" : "📄"}</span>
              <span className="text-[10px] font-mono flex-1 truncate" style={{ color: f.type === "dir" ? "#6496ff" : "rgba(255,255,255,0.7)" }}>{f.name}</span>
              <span className="text-[8px] font-mono hidden sm:inline" style={{ color: "rgba(255,255,255,0.25)" }}>{f.perms}</span>
              <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{f.size ? `${(f.size / 1024).toFixed(1)}K` : ""}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Process Monitor ─────────────────────────────────────────────────
export function KaliProcessMonitor() {
  const { exec, isConnected } = useKali();
  const [procs, setProcs] = useState<Array<{ pid: string; user: string; cpu: string; mem: string; cmd: string }>>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    const r = await exec("ps aux --sort=-%cpu 2>/dev/null | head -20", { source: "process-monitor" });
    const lines = r.output.split("\n").filter(Boolean);
    const parsed = lines.slice(1).map(l => {
      const p = l.trim().split(/\s+/);
      return { user: p[0] ?? "", pid: p[1] ?? "", cpu: p[2] ?? "", mem: p[3] ?? "", cmd: p.slice(10).join(" ").slice(0, 60) };
    }).filter(p => p.pid);
    setProcs(parsed);
    setLoading(false);
  }, [exec, isConnected]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const iv = setInterval(() => void refresh(), 10000); return () => clearInterval(iv); }, [refresh]);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(100,255,100,0.12)" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10" style={{ background: "rgba(100,255,100,0.05)" }}>
        <span className="flex items-center gap-2 text-[11px] font-black" style={{ color: "#64ff64" }}><Cpu className="w-4 h-4" /> العمليات</span>
        <button onClick={() => void refresh()} disabled={loading} className="text-[8px] px-2 py-0.5 rounded" style={{ background: "rgba(100,255,100,0.1)", color: "#64ff64" }}>{loading ? "..." : "تحديث"}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[8px] font-mono">
          <thead><tr style={{ color: "rgba(255,255,255,0.3)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}><th className="px-2 py-1 text-right">PID</th><th className="px-2 py-1 text-right">USER</th><th className="px-2 py-1">CPU%</th><th className="px-2 py-1">MEM%</th><th className="px-2 py-1 text-right">CMD</th></tr></thead>
          <tbody>
            {procs.length === 0 ? <tr><td colSpan={5} className="text-center py-4" style={{ color: "rgba(255,255,255,0.25)" }}>لا يوجد</td></tr> :
              procs.map(p => (
                <tr key={p.pid} className="border-b border-white/[0.02] hover:bg-white/[0.03]">
                  <td className="px-2 py-1" style={{ color: "#64ff64" }}>{p.pid}</td>
                  <td className="px-2 py-1" style={{ color: "rgba(255,255,255,0.5)" }}>{p.user}</td>
                  <td className="px-2 py-1 text-center" style={{ color: parseFloat(p.cpu) > 10 ? "#ff6644" : "rgba(255,255,255,0.6)" }}>{p.cpu}</td>
                  <td className="px-2 py-1 text-center" style={{ color: "rgba(255,255,255,0.5)" }}>{p.mem}</td>
                  <td className="px-2 py-1 truncate max-w-[150px]" style={{ color: "rgba(255,255,255,0.6)" }}>{p.cmd}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Network Monitor ─────────────────────────────────────────────────
export function KaliNetworkMonitor() {
  const { exec, isConnected } = useKali();
  const [conns, setConns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    const r = await exec("ss -tulpn 2>/dev/null | head -20; echo '---'; ip -br addr 2>/dev/null | head -10", { source: "network-monitor" });
    setConns(r.output.split("\n").filter(Boolean));
    setLoading(false);
  }, [exec, isConnected]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(100,200,255,0.12)" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10" style={{ background: "rgba(100,200,255,0.05)" }}>
        <span className="flex items-center gap-2 text-[11px] font-black" style={{ color: "#64c8ff" }}><Wifi className="w-4 h-4" /> الشبكة</span>
        <button onClick={() => void refresh()} disabled={loading} className="text-[8px] px-2 py-0.5 rounded" style={{ background: "rgba(100,200,255,0.1)", color: "#64c8ff" }}>{loading ? "..." : "تحديث"}</button>
      </div>
      <div className="p-2 font-mono text-[9px] max-h-[250px] overflow-y-auto space-y-0.5">
        {conns.length === 0 ? <div style={{ color: "rgba(255,255,255,0.25)" }}>لا يوجد</div> :
          conns.map((l, i) => <div key={i} className="whitespace-pre-wrap break-all" style={{ color: l.includes("LISTEN") ? "#44ff88" : l.includes("---") ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.55)" }}>{l}</div>)}
      </div>
    </div>
  );
}

// ─── Kali Status Card — للـ HUD ─────────────────────────────────────
export function KaliStatusCard({ compact = false }: { compact?: boolean }) {
  const { kaliStatus, kaliHealth, nodes, isConnected, desktopUrl, openDesktop, closeDesktop } = useKali();
  const running = kaliStatus?.desktop?.running;
  const kaliNodes = nodes.filter(n => n.kali);

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-[9px] font-mono">
        <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
        <span style={{ color: isConnected ? "#44ff88" : "#ff6644" }}>{isConnected ? `${kaliNodes.length} عقدة كالي` : "غير متصل"}</span>
        {kaliStatus?.present && <span style={{ color: "rgba(255,255,255,0.4)" }}>{kaliStatus.packages} حزمة</span>}
      </div>
    );
  }

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,80,40,0.04)", border: "1px solid rgba(255,80,40,0.2)" }}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11px] font-black" style={{ color: "#ff6644" }}>🐉 كالي — {isConnected ? "متصل ✓" : "غير متصل"}</span>
        <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div><div className="text-sm font-black" style={{ color: "#ff6644" }}>{kaliNodes.length}</div><div className="text-[7px]" style={{ color: "rgba(255,255,255,0.4)" }}>عقدة كالي</div></div>
        <div><div className="text-sm font-black" style={{ color: "#44ff88" }}>{kaliStatus?.executables ?? nodes.length ? "✓" : "—"}</div><div className="text-[7px]" style={{ color: "rgba(255,255,255,0.4)" }}>أدوات</div></div>
        <div><div className="text-sm font-black" style={{ color: running ? "#44ff88" : "rgba(255,255,255,0.3)" }}>{running ? "●" : "○"}</div><div className="text-[7px]" style={{ color: "rgba(255,255,255,0.4)" }}>ديسكتوب</div></div>
      </div>
      {kaliStatus?.present && (
        <div className="flex gap-1">
          <button onClick={() => running ? void closeDesktop() : void openDesktop()} className="flex-1 text-[9px] font-black py-1 rounded" style={{ background: running ? "rgba(255,100,50,0.1)" : "rgba(68,255,136,0.1)", border: `1px solid ${running ? "rgba(255,100,50,0.3)" : "rgba(68,255,136,0.3)"}`, color: running ? "#ff6644" : "#44ff88" }}>{running ? "إطفاء الديسكتوب" : "شغّل الديسكتوب"}</button>
          {desktopUrl && running && <a href={desktopUrl} target="_blank" rel="noreferrer" className="text-[9px] px-2 py-1 rounded flex items-center gap-1" style={{ background: "rgba(100,150,255,0.1)", border: "1px solid rgba(100,150,255,0.3)", color: "#6496ff" }}><ExternalLink className="w-3 h-3" /> فتح</a>}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {nodes.slice(0, 4).map(n => (
          <span key={n.id} className="text-[7px] font-mono px-1.5 py-0.5 rounded" style={{ background: n.kali ? "rgba(68,255,136,0.08)" : "rgba(255,255,255,0.04)", color: n.kali ? "#44ff88" : "rgba(255,255,255,0.3)" }}>{n.hostname.slice(0, 12)}</span>
        ))}
      </div>
    </div>
  );
}
