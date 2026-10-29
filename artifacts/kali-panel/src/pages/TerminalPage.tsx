import { useState, useEffect, useRef } from "react";
import { Terminal, Copy, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/Layout";

interface TerminalLine {
  id: string; type: "input" | "output" | "error"; content: string; timestamp: string;
}

const COMMANDS: Record<string, string> = {
  help: "عرض الأوامر المتاحة",
  clear: "مسح الشاشة",
  date: "عرض التاريخ والوقت",
  whoami: "معلومات المستخدم",
  ls: "عرض الملفات",
  pwd: "المسار الحالي",
  echo: "عرض نص",
  uname: "معلومات النظام",
  ifconfig: "معلومات الشبكة",
  ps: "العمليات النشطة",
};

export default function TerminalPage() {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: "1", type: "output", content: "CyberNova Terminal v2.0 — Arabic Cybersecurity Platform", timestamp: new Date().toISOString() },
    { id: "2", type: "output", content: '┌──(cybernova)─[~/workspace]\n└─$ اكتب \'help\' لعرض الأوامر المتاحة', timestamp: new Date().toISOString() },
  ]);
  const [currentInput, setCurrentInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [lines]);

  const executeCommand = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    const inputLine: TerminalLine = { id: Date.now().toString(), type: "input", content: `$ ${trimmed}`, timestamp: new Date().toISOString() };
    setLines(p => [...p, inputLine]);
    setHistory(p => [...p, trimmed]);
    setHistoryIndex(-1);

    const [cmd, ...args] = trimmed.split(" ");
    let output: TerminalLine | null = null;
    const id = (Date.now() + 1).toString();
    const ts = new Date().toISOString();

    switch (cmd.toLowerCase()) {
      case "help":
        output = { id, type: "output", timestamp: ts, content: Object.entries(COMMANDS).map(([c, d]) => `  \x1b[32m${c.padEnd(12)}\x1b[0m ${d}`).join("\n") } as TerminalLine;
        break;
      case "clear":
        setLines([]);
        return;
      case "date":
        output = { id, type: "output", timestamp: ts, content: new Date().toString() };
        break;
      case "whoami":
        output = { id, type: "output", timestamp: ts, content: "cybernova-user@cybernova-system [root]" };
        break;
      case "ls":
        output = { id, type: "output", timestamp: ts, content: "drwxr-xr-x  Desktop    Documents   Downloads\ndrwxr-xr-x  Pictures   Videos      scans\n-rw-r--r--  targets.txt  report.html  config.json" };
        break;
      case "pwd":
        output = { id, type: "output", timestamp: ts, content: "/home/cybernova-user/workspace" };
        break;
      case "echo":
        output = { id, type: "output", timestamp: ts, content: args.join(" ") };
        break;
      case "uname":
        output = { id, type: "output", timestamp: ts, content: "Linux cybernova 6.1.0-kali3-amd64 #1 SMP Debian GNU/Linux" };
        break;
      case "ifconfig":
        output = { id, type: "output", timestamp: ts, content: "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>\n      inet 192.168.1.100  netmask 255.255.255.0\n      ether 00:11:22:33:44:55\ntun0: flags=4305<UP,POINTOPOINT,RUNNING,NOARP,MULTICAST>\n      inet 10.10.10.1  netmask 255.255.255.0" };
        break;
      case "ps":
        output = { id, type: "output", timestamp: ts, content: "  PID TTY          TIME CMD\n 1234 pts/0    00:00:12 cybernova-api\n 5678 pts/0    00:01:05 ollama\n 9012 pts/0    00:00:03 node\n 3456 pts/0    00:00:08 postgres" };
        break;
      default:
        output = { id, type: "error", timestamp: ts, content: `bash: ${cmd}: command not found — اكتب 'help' لعرض الأوامر` };
    }
    if (output) setLines(p => [...p, output]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      executeCommand(currentInput);
      setCurrentInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0 && historyIndex < history.length - 1) {
        const ni = historyIndex + 1;
        setHistoryIndex(ni);
        setCurrentInput(history[history.length - 1 - ni]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const ni = historyIndex - 1;
        setHistoryIndex(ni);
        setCurrentInput(history[history.length - 1 - ni]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentInput("");
      }
    }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ Terminal" subtitle="محطة طرفية سيبرانية — CyberNova CLI" icon={Terminal} danger />

      <div className="rounded-2xl overflow-hidden" style={{ background: "#000000", border: "1px solid rgba(68,255,136,0.25)", boxShadow: "0 0 30px rgba(0,255,100,0.06)" }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "#0a0a0a", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: "#ff5555", boxShadow: "0 0 4px #ff5555" }} />
            <div className="w-3 h-3 rounded-full" style={{ background: "#ffaa44", boxShadow: "0 0 4px #ffaa44" }} />
            <div className="w-3 h-3 rounded-full" style={{ background: "#44ff88", boxShadow: "0 0 4px #44ff88" }} />
            <span className="ms-3 text-[10px] font-black font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>cybernova-terminal — ~/workspace</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { const t = lines.map(l => l.content).join("\n"); navigator.clipboard.writeText(t); }}
              className="p-1.5 rounded-lg transition-all" style={{ color: "rgba(255,255,255,0.25)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#44ff88"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.25)"; }}>
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setLines([])} className="p-1.5 rounded-lg transition-all" style={{ color: "rgba(255,255,255,0.25)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ff4444"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.25)"; }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal body */}
        <div ref={terminalRef} className="h-[60vh] overflow-y-auto p-4 font-mono text-[12px] cursor-text"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(68,255,136,0.2) transparent" }}
          onClick={() => inputRef.current?.focus()}>
          {lines.map(line => (
            <div key={line.id} className="mb-1 leading-relaxed"
              style={{ color: line.type === "input" ? "#44ff88" : line.type === "error" ? "#ff6666" : "rgba(200,255,200,0.8)" }}>
              <pre className="whitespace-pre-wrap break-words">{line.content}</pre>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <span className="font-black" style={{ color: "#44ff88" }}>$</span>
            <input ref={inputRef} type="text" value={currentInput}
              onChange={e => setCurrentInput(e.target.value)}
              onKeyDown={handleKeyDown} autoFocus dir="ltr"
              className="flex-1 bg-transparent outline-none"
              style={{ color: "rgba(200,255,200,0.9)", caretColor: "#44ff88", fontFamily: "monospace", fontSize: 12 }}
              placeholder="اكتب أمراً..." />
          </div>
        </div>
      </div>

      {/* Quick Commands */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16 }}>
        <h3 className="text-[10px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>أوامر سريعة</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {Object.entries(COMMANDS).map(([cmd, desc]) => (
            <button key={cmd} onClick={() => { setCurrentInput(cmd); inputRef.current?.focus(); }}
              className="p-2.5 rounded-xl text-right transition-all"
              style={{ background: "rgba(68,255,136,0.04)", border: "1px solid rgba(68,255,136,0.12)", borderRadius: 12 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.border = "1px solid rgba(68,255,136,0.3)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.border = "1px solid rgba(68,255,136,0.12)"; }}>
              <div className="font-black font-mono text-[11px]" style={{ color: "#44ff88" }}>{cmd}</div>
              <div className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
