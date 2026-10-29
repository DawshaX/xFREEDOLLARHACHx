import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type LineKind =
  | "prompt"
  | "stdout"
  | "stderr"
  | "system"
  | "agent"
  | "agent-thought"
  | "tool-use"
  | "tool-result-ok"
  | "tool-result-err"
  | "info"
  | "error";

type Line = { id: string; kind: LineKind; text: string };

const colorFor: Record<LineKind, string> = {
  prompt: "text-cyan-300",
  stdout: "text-emerald-200",
  stderr: "text-rose-300",
  system: "text-slate-400 italic",
  agent: "text-fuchsia-200",
  "agent-thought": "text-slate-400 italic",
  "tool-use": "text-amber-300",
  "tool-result-ok": "text-emerald-300",
  "tool-result-err": "text-rose-300",
  info: "text-cyan-200",
  error: "text-rose-400",
};

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SESSION_KEY = "kali-terminal:sessionId";
const HISTORY_KEY = "kali-terminal:history";

function loadSessionId(): string {
  try {
    const v = localStorage.getItem(SESSION_KEY);
    if (v) return v;
  } catch { /* noop */ }
  const fresh = `s_${uid()}`;
  try { localStorage.setItem(SESSION_KEY, fresh); } catch { /* noop */ }
  return fresh;
}

function loadHistory(): string[] {
  try {
    const v = localStorage.getItem(HISTORY_KEY);
    if (v) return JSON.parse(v) as string[];
  } catch { /* noop */ }
  return [];
}

function saveHistory(h: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-200))); } catch { /* noop */ }
}

// ── API Types ────────────────────────────────────────────────────────────────

type AgentEvent =
  | { type: "status"; message: string }
  | { type: "text_delta"; text: string }
  | { type: "text_block"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: string; ok: boolean; meta?: unknown }
  | { type: "shell_chunk"; toolUseId: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "done"; stopReason: string | null; turns: number }
  | { type: "error"; message: string };

type ShellEvent =
  | { type: "start"; command: string; sessionId: string; agentId: string; hostname: string }
  | { type: "chunk"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "end"; exitCode: number; cwd: string; ok: boolean; durationMs: number }
  | { type: "error"; message: string };

async function streamSSE<T>(
  url: string,
  body: unknown,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          onEvent(JSON.parse(data) as T);
        } catch {
          // ignore malformed
        }
      }
    }
  }
}

const API_BASE = "/api";

function streamShell(
  body: { command: string; sessionId?: string; timeoutMs?: number },
  onEvent: (event: ShellEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamSSE(`${API_BASE}/kali-terminal/shell`, body, onEvent, signal);
}

function streamAgentChat(
  body: { message: string; conversationId?: string; sessionId?: string; model?: string },
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamSSE(`${API_BASE}/kali-terminal/chat`, body, onEvent, signal);
}

async function getAgentHealth(): Promise<{ status: string; model: string; tools: string[]; agents: Array<{ id: string; hostname: string; user: string; capabilities: string[] }> }> {
  const res = await fetch(`${API_BASE}/kali-terminal/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

async function resetConversation(id: string): Promise<void> {
  await fetch(`${API_BASE}/kali-terminal/conversations/${encodeURIComponent(id)}/reset`, { method: "POST" });
}

async function deleteSession(id: string): Promise<void> {
  await fetch(`${API_BASE}/kali-terminal/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface KaliTerminalProps {
  agentConnected?: boolean;
  agentHostname?: string;
  agentUser?: string;
}

export function KaliTerminal({ agentConnected, agentHostname, agentUser }: KaliTerminalProps) {
  const [sessionId] = useState<string>(() => loadSessionId());
  const conversationId = sessionId;
  const [mode, setMode] = useState<"agent" | "shell">("agent");
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{ status: string; model: string; tools: string[]; agents: Array<{ hostname: string; user: string }> } | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingAgentLineId = useRef<string | null>(null);

  const append = useCallback((kind: LineKind, text: string) => {
    setLines((prev) => [...prev, { id: uid(), kind, text }]);
  }, []);

  const appendChunkTo = useCallback((id: string, chunk: string, kind: LineKind) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx === -1) return [...prev, { id, kind, text: chunk }];
      const next = prev.slice();
      next[idx] = { ...next[idx], text: next[idx].text + chunk };
      return next;
    });
  }, []);

  useEffect(() => {
    getAgentHealth()
      .then((h) => {
        setHealth(h);
        const host = h.agents[0]?.hostname || agentHostname || "kali";
        const user = h.agents[0]?.user || agentUser || "kali";
        append("system", `☠ KaliGPT Terminal v8 — connected to ${user}@${host}`);
        append("system", `Model: ${h.model} · Tools: ${h.tools.join(", ")}`);
        append("info", `Type a goal in agent mode, or switch to shell mode (Ctrl+M) for direct bash. Session: ${sessionId.slice(0, 12)}`);
      })
      .catch((err) => {
        append("error", `Health check failed: ${(err as Error).message}`);
        append("info", `Try reconnecting the Kali agent. Run: node /tmp/nova-agent.js --server wss://...`);
      });
  }, [append, sessionId, agentHostname, agentUser]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [busy, mode]);

  const promptLabel = useMemo(() => {
    const host = health?.agents[0]?.hostname || agentHostname || "kali";
    const user = health?.agents[0]?.user || agentUser || "kali";
    return `${user}@${host}${mode === "agent" ? " 🤖" : " #"}`;
  }, [health, agentHostname, agentUser, mode]);

  const pushHistory = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = prev[prev.length - 1] === trimmed ? prev : [...prev, trimmed];
      saveHistory(next);
      return next;
    });
    setHistoryIdx(-1);
  }, []);

  const runShell = useCallback(async (command: string) => {
    append("prompt", `${promptLabel} ${command}`);
    pushHistory(command);
    setBusy(true);
    abortRef.current = new AbortController();
    let stdoutLineId: string | null = null;
    let stderrLineId: string | null = null;
    try {
      await streamShell(
        { command, sessionId },
        (ev) => {
          switch (ev.type) {
            case "start":
              append("system", `Executing on ${ev.hostname}...`);
              break;
            case "chunk": {
              const id = ev.stream === "stdout"
                ? (stdoutLineId ?? (stdoutLineId = uid()))
                : (stderrLineId ?? (stderrLineId = uid()));
              appendChunkTo(id, ev.chunk, ev.stream === "stdout" ? "stdout" : "stderr");
              break;
            }
            case "end": {
              if (ev.exitCode !== 0) {
                append("system", `[exit ${ev.exitCode} · ${ev.durationMs}ms]`);
              } else {
                append("system", `[done · ${ev.durationMs}ms]`);
              }
              break;
            }
            case "error":
              append("error", ev.message);
              break;
          }
        },
        abortRef.current.signal,
      );
    } catch (err) {
      append("error", (err as Error).message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [append, appendChunkTo, promptLabel, pushHistory, sessionId]);

  const runAgent = useCallback(async (message: string) => {
    append("prompt", `${promptLabel} ${message}`);
    pushHistory(message);
    setBusy(true);
    abortRef.current = new AbortController();
    streamingAgentLineId.current = null;
    const shellChunkLines = new Map<string, { stdout?: string; stderr?: string }>();
    try {
      await streamAgentChat(
        { message, sessionId, conversationId },
        (ev: AgentEvent) => {
          switch (ev.type) {
            case "status":
              append("agent-thought", `… ${ev.message}`);
              break;
            case "text_delta": {
              if (!streamingAgentLineId.current) {
                streamingAgentLineId.current = uid();
                setLines((prev) => [...prev, { id: streamingAgentLineId.current!, kind: "agent", text: ev.text }]);
              } else {
                appendChunkTo(streamingAgentLineId.current, ev.text, "agent");
              }
              break;
            }
            case "text_block":
              streamingAgentLineId.current = null;
              break;
            case "tool_use": {
              const inputJson = JSON.stringify(ev.input);
              const preview = inputJson.length > 200 ? inputJson.slice(0, 200) + "…" : inputJson;
              append("tool-use", `▸ ${ev.name}(${preview})`);
              if (ev.name === "shell") {
                shellChunkLines.set(ev.id, {});
              }
              break;
            }
            case "shell_chunk": {
              const map = shellChunkLines.get(ev.toolUseId) ?? {};
              if (ev.stream === "stdout") {
                if (!map.stdout) {
                  map.stdout = uid();
                  setLines((prev) => [...prev, { id: map.stdout!, kind: "stdout", text: ev.chunk }]);
                } else {
                  appendChunkTo(map.stdout, ev.chunk, "stdout");
                }
              } else {
                if (!map.stderr) {
                  map.stderr = uid();
                  setLines((prev) => [...prev, { id: map.stderr!, kind: "stderr", text: ev.chunk }]);
                } else {
                  appendChunkTo(map.stderr, ev.chunk, "stderr");
                }
              }
              shellChunkLines.set(ev.toolUseId, map);
              break;
            }
            case "tool_result": {
              const meta = ev.meta as { exitCode?: number; cwd?: string; size?: number; status?: number } | undefined;
              const hadStreamed = shellChunkLines.has(ev.id);
              if (!hadStreamed) {
                const trimmed = ev.output.length > 1500 ? ev.output.slice(0, 1500) + "\n… [truncated]" : ev.output;
                append(ev.ok ? "tool-result-ok" : "tool-result-err", trimmed);
              } else if (typeof meta?.exitCode === "number" && meta.exitCode !== 0) {
                append("system", `[exit ${meta.exitCode}]`);
              }
              break;
            }
            case "done":
              streamingAgentLineId.current = null;
              if (ev.stopReason && ev.stopReason !== "end_turn" && ev.stopReason !== "tool_use") {
                append("system", `(stopped: ${ev.stopReason})`);
              }
              break;
            case "error":
              append("error", ev.message);
              break;
          }
        },
        abortRef.current.signal,
      );
    } catch (err) {
      append("error", (err as Error).message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [append, appendChunkTo, conversationId, promptLabel, pushHistory, sessionId]);

  const handleSubmit = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || busy) return;
    setInput("");

    if (cmd === "clear" || cmd === "cls") {
      setLines([]);
      return;
    }
    if (cmd === "/help" || cmd === "help") {
      append("info", "Commands: /help  /reset  /mode shell|agent  /shell <cmd>  /agent <msg>  clear");
      append("info", "Shortcuts: Ctrl+M toggle mode  •  Ctrl+L clear  •  Ctrl+C abort  •  ↑/↓ history");
      return;
    }
    if (cmd === "/reset") {
      await resetConversation(conversationId);
      await deleteSession(sessionId);
      setLines([]);
      append("system", "Conversation and shell session reset");
      return;
    }
    if (cmd.startsWith("/mode ")) {
      const m = cmd.slice(6).trim();
      if (m === "shell" || m === "agent") {
        setMode(m);
        append("system", `Mode → ${m}`);
      } else {
        append("error", "usage: /mode shell|agent");
      }
      return;
    }
    if (cmd.startsWith("/shell ")) {
      await runShell(cmd.slice(7));
      return;
    }
    if (cmd.startsWith("/agent ")) {
      await runAgent(cmd.slice(7));
      return;
    }

    if (mode === "shell") await runShell(cmd);
    else await runAgent(cmd);
  }, [append, busy, conversationId, input, mode, runAgent, runShell, sessionId]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setLines([]);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
      e.preventDefault();
      setMode((m) => {
        const next = m === "agent" ? "shell" : "agent";
        append("system", `Mode → ${next}`);
        return next;
      });
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "c") {
      if (busy && abortRef.current) {
        e.preventDefault();
        abortRef.current.abort();
        append("system", "^C — aborted");
        setBusy(false);
      }
      return;
    }
    if (e.key === "ArrowUp" && !e.shiftKey) {
      if (history.length === 0) return;
      e.preventDefault();
      const next = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(history[next] ?? "");
    } else if (e.key === "ArrowDown" && !e.shiftKey) {
      if (history.length === 0 || historyIdx === -1) return;
      e.preventDefault();
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        setHistoryIdx(next);
        setInput(history[next] ?? "");
      }
    }
  }, [append, busy, handleSubmit, history, historyIdx]);

  const isConnected = agentConnected || (health?.status === "ok");
  const hostName = health?.agents[0]?.hostname || agentHostname || "kali";

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a0f] text-[#e0e0e0] font-mono" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1a1a2e] bg-[#0f0f1a] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-cyan-300 font-bold tracking-wider text-xs select-none">☠ KaliGPT</span>
          <span className="text-[10px] text-slate-500 hidden sm:inline">AI Terminal Agent</span>
          {isConnected && (
            <span className="flex items-center gap-1 text-[9px] text-emerald-400/80">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {hostName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <button
            onClick={() => setMode((m) => (m === "agent" ? "shell" : "agent"))}
            className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-all ${
              mode === "agent"
                ? "bg-fuchsia-500/15 border-fuchsia-400/50 text-fuchsia-200"
                : "bg-cyan-500/15 border-cyan-400/50 text-cyan-200"
            }`}
            title="Ctrl+M"
          >
            {mode === "agent" ? "🤖 AGENT" : "# SHELL"}
          </button>
          <span className="px-2 py-0.5 rounded bg-[#1a1a2e] border border-[#2a2a3e] text-slate-500">
            {health ? `● ${health.model}` : "○ connecting"}
          </span>
          <button
            onClick={async () => {
              await resetConversation(conversationId);
              await deleteSession(sessionId);
              setLines([]);
              append("system", "Reset complete");
            }}
            className="px-2 py-0.5 rounded border border-[#2a2a3e] bg-[#1a1a2e] hover:bg-[#2a2a3e] text-rose-300 text-[10px]"
          >
            reset
          </button>
        </div>
      </div>

      {/* Output Area */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto px-3 py-2"
        onClick={() => inputRef.current?.focus()}
        style={{ scrollbarWidth: "thin", scrollbarColor: "#2a2a3e #0a0a0f" }}
      >
        {/* CRT scanline overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.03) 2px, rgba(0,255,0,0.03) 4px)"
        }} />
        <div className="relative space-y-0 text-[13px] leading-relaxed">
          {lines.map((l) => (
            <pre
              key={l.id}
              className={`whitespace-pre-wrap break-words font-mono ${colorFor[l.kind]}`}
            >
              {l.text}
            </pre>
          ))}
          {busy ? (
            <div className="text-cyan-300/60 text-[11px] italic mt-1 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse" />
              working...
            </div>
          ) : null}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-[#1a1a2e] bg-[#0f0f1a] px-3 py-2 shrink-0">
        <div className="flex items-start gap-2">
          <span className={`pt-1.5 select-none whitespace-pre text-[13px] font-bold ${mode === "agent" ? "text-fuchsia-300" : "text-cyan-300"}`}>
            {promptLabel}
          </span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            rows={Math.min(6, Math.max(1, input.split("\n").length))}
            placeholder={mode === "agent" ? "Tell the agent what to do on Kali... (Shift+Enter newline)" : "Run bash on Kali..."}
            className="flex-1 bg-transparent outline-none text-emerald-100 font-mono text-[13px] resize-none pt-1 placeholder:text-slate-600/60 disabled:opacity-40"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[9px] text-slate-600 select-none">
          <span>Ctrl+M switch • Ctrl+L clear • Ctrl+C abort • ↑/↓ history • /help</span>
          <span className="font-mono">{sessionId.slice(0, 12)}</span>
        </div>
      </div>
    </div>
  );
}
