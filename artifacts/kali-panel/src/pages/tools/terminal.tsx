import { useEffect, useRef, useState } from "react";
import { TerminalSquare, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { jsonRequest } from "@/lib/sse";

type Entry = { command: string; stdout: string; stderr: string; exitCode: number; durationMs: number };
interface ShellResult { sessionId: string; stdout: string; stderr: string; exitCode: number; durationMs: number; }

const QUICK_CMDS = ["uname -a", "ls /tmp", "whoami", "echo hello", "cat /etc/os-release", "uptime"];

export default function TerminalPage() {
  const [history, setHistory] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [history]);

  const exec = useMutation<ShellResult, Error, string>({
    mutationFn: (command: string) => jsonRequest<ShellResult>("/tools/shell", { method: "POST", body: JSON.stringify({ command, sessionId }) }),
    onSuccess: (r, command) => {
      setSessionId(r.sessionId);
      setHistory(h => [...h, { command, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: r.durationMs }]);
    },
  });

  const submit = (cmd: string) => { if (!cmd.trim()) return; exec.mutate(cmd); setInput(""); };

  return (
    <div className="min-h-screen p-5 space-y-4 flex flex-col" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.3)" }}>
          <TerminalSquare className="w-5 h-5" style={{ color: "#44ff88" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#44ff88", textShadow: "0 0 16px rgba(68,255,136,0.4)" }}>Live Terminal</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
            تنفيذ أوامر آمنة (whitelisted) — الجلسة: <code>{sessionId ?? "جديدة"}</code>
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {QUICK_CMDS.map(cmd => (
          <button key={cmd} onClick={() => submit(cmd)} disabled={exec.isPending}
            className="px-2.5 py-1 rounded-xl font-mono text-[9px] transition-all disabled:opacity-40"
            style={{ background: "rgba(68,255,136,0.04)", border: "1px solid rgba(68,255,136,0.15)", color: "rgba(68,255,136,0.6)" }}>
            {cmd}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden flex flex-col flex-1 min-h-96" style={{ background: "rgba(0,0,0,0.92)", border: "1px solid rgba(68,255,136,0.12)" }}>
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 font-mono text-sm" dir="ltr" style={{ scrollbarWidth: "thin" }}>
          <div className="mb-3" style={{ color: "rgba(68,255,136,0.5)" }}>
            CyberNova Shell — أدخل أمراً مسموحاً به (echo, ls, dig, whois, nmap...)
          </div>
          {history.map((h, i) => (
            <div key={i} className="mb-3">
              <div style={{ color: "#44ff88" }}>$ {h.command}</div>
              {h.stdout && <pre className="whitespace-pre-wrap" style={{ color: "rgba(255,255,255,0.75)" }}>{h.stdout}</pre>}
              {h.stderr && <pre className="whitespace-pre-wrap" style={{ color: "#ff8888" }}>{h.stderr}</pre>}
              <div className="text-[9px] mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>exit: {h.exitCode} · {h.durationMs}ms</div>
            </div>
          ))}
          {exec.isPending && <div className="flex items-center gap-2" style={{ color: "#ffaa44" }}><Loader2 className="w-3 h-3 animate-spin" />جاري التنفيذ...</div>}
        </div>

        <form onSubmit={e => { e.preventDefault(); submit(input); }}
          className="flex items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid rgba(68,255,136,0.08)", background: "rgba(0,0,0,0.5)" }}>
          <span className="font-mono font-black" style={{ color: "#44ff88" }}>$</span>
          <input value={input} onChange={e => setInput(e.target.value)}
            placeholder="echo hello" dir="ltr" autoFocus disabled={exec.isPending}
            className="flex-1 bg-transparent font-mono focus:outline-none"
            style={{ color: "rgba(68,255,136,0.85)", caretColor: "#44ff88", fontSize: 13 }} />
        </form>
      </div>
    </div>
  );
}
