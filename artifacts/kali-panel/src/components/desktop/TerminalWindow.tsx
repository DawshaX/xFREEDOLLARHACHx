import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "@/lib/sse";

interface ProcessRecord {
  id: string;
  status: "running" | "exited" | "killed" | "error";
  output: string;
  exitCode: number | null;
}

interface Line {
  kind: "cmd" | "out" | "err" | "info";
  text: string;
}

export function TerminalWindow({ initialCommand }: { initialCommand?: string }) {
  const [lines, setLines] = useState<Line[]>([
    { kind: "info", text: "CyberNova Shell v6 — bash on Replit container" },
    { kind: "info", text: 'Type any command. Use "clear" to reset.' },
  ]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ranInitial = useRef(false);

  function append(l: Line) {
    setLines((arr) => [...arr, l]);
  }

  async function run(command: string) {
    const c = command.trim();
    if (!c) return;
    if (c === "clear") {
      setLines([]);
      return;
    }
    append({ kind: "cmd", text: `nova@cybernova:~$ ${c}` });
    setBusy(true);
    try {
      const started = await jsonRequest<ProcessRecord>("/processes", {
        method: "POST",
        body: JSON.stringify({ command: c }),
      });
      let last = "";
      // Poll the process endpoint for its full output until it exits
      for (let i = 0; i < 120; i++) {
        const p = await jsonRequest<ProcessRecord>(`/processes/${started.id}`);
        const fresh = p.output.slice(last.length);
        if (fresh) {
          fresh.split(/\r?\n/).forEach((ln) => {
            if (ln.length > 0) append({ kind: "out", text: ln });
          });
          last = p.output;
        }
        if (p.status !== "running") {
          append({
            kind: "info",
            text: `[exit ${p.exitCode ?? "?"} · ${p.status}]`,
          });
          break;
        }
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch (e) {
      append({ kind: "err", text: `error: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialCommand && !ranInitial.current) {
      ranInitial.current = true;
      void run(initialCommand);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCommand]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      className="flex flex-col h-full bg-black/85 text-emerald-300 font-mono text-[12px]"
      dir="ltr"
    >
      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-0.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "cmd"
                ? "text-primary"
                : l.kind === "err"
                  ? "text-red-400"
                  : l.kind === "info"
                    ? "text-muted-foreground"
                    : "text-emerald-200"
            }
          >
            {l.text}
          </div>
        ))}
        {busy && <div className="text-yellow-300 animate-pulse">running…</div>}
      </div>
      <form
        className="flex items-center gap-2 px-3 py-2 border-t border-primary/20 bg-black/60"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          run(cmd);
          setCmd("");
        }}
      >
        <span className="text-primary">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          className="flex-1 bg-transparent outline-none text-emerald-200"
          placeholder="run anything…"
          autoFocus
          data-testid="terminal-input"
        />
      </form>
    </div>
  );
}
