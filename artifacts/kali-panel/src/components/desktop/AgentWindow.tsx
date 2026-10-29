import { useEffect, useRef, useState, useCallback } from "react";
import { jsonRequest, sseStream } from "@/lib/sse";
import { Bot, Send, Sparkles, Wrench, AlertTriangle, RefreshCw, Wifi, WifiOff, Plus, Trash2, Clock, CheckCircle2 } from "lucide-react";

export interface ClientToolEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface Session {
  id: number;
  title: string;
  createdAt?: string;
}

interface ChatLine {
  role: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  timestamp?: string;
}

export function AgentWindow({
  onClientTool,
}: {
  onClientTool: (e: ClientToolEvent) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastError, setLastError] = useState<string>("");
  const [isRetrying, setIsRetrying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      await jsonRequest<Session[]>("/live-agent/sessions");
      setConnectionStatus('connected');
      setLastError("");
      return true;
    } catch (err) {
      setConnectionStatus('error');
      setLastError(err instanceof Error ? err.message : 'Connection failed');
      return false;
    }
  }, []);

  const retryConnection = useCallback(async () => {
    setIsRetrying(true);
    const success = await checkConnection();
    if (success) {
      // Reload sessions after successful connection
      try {
        const list = await jsonRequest<Session[]>("/live-agent/sessions");
        setSessions(list || []);
        if (list && list.length > 0) setActive(list[0]);
      } catch (err) {
        console.error("Failed to reload sessions after reconnection:", err);
      }
    }
    setIsRetrying(false);
  }, [checkConnection]);

  useEffect(() => {
    void (async () => {
      setConnectionStatus('disconnected');
      try {
        const list = await jsonRequest<Session[]>("/live-agent/sessions");
        setSessions(list || []);
        if (list && list.length > 0) setActive(list[0]);
        else {
          const created = await jsonRequest<Session>("/live-agent/sessions", {
            method: "POST",
            body: JSON.stringify({ title: "Desktop Session" }),
          });
          if (created) {
            setSessions([created]);
            setActive(created);
          }
        }
        setConnectionStatus('connected');
      } catch (err) {
        console.error("Failed to load agent sessions:", err);
        setConnectionStatus('error');
        setLastError(err instanceof Error ? err.message : 'Connection failed');
        const mockSession = { id: Date.now() as any, title: "جلسة غير متصلة" };
        setSessions([mockSession]);
        setActive(mockSession);
        
        retryTimeoutRef.current = setTimeout(() => {
          void retryConnection();
        }, 5000);
      }
    })();
    
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [retryConnection]);

  useEffect(() => {
    if (!active || String(active.id).startsWith("error-") || String(active.id).startsWith("temp-")) return;
    void (async () => {
      try {
        const data = await jsonRequest<{
          messages: Array<{ role: string; content: string; toolName?: string | null; createdAt?: string }>;
        }>(`/live-agent/sessions/${active.id}`);
        if (data && data.messages) {
          setChat(
            data.messages.map((m) => ({
              role: (["user", "assistant", "tool"].includes(m.role) ? m.role : "assistant") as ChatLine["role"],
              text: m.content,
              timestamp: m.createdAt,
              ...(m.toolName ? { toolName: m.toolName } : {}),
            })),
          );
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
      }
    })();
  }, [active]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat]);

  async function send() {
    if (!input.trim() || !active || busy || connectionStatus === 'error') return;
    const text = input;
    const now = new Date().toISOString();
    setInput("");
    setBusy(true);
    setChat((c) => [...c, { role: "user", text, timestamp: now }]);
    let accumulator = "";
    setChat((c) => [...c, { role: "assistant", text: "", timestamp: new Date().toISOString() }]);
    try {
      await sseStream(
        `/live-agent/sessions/${active.id}/messages`,
        { method: "POST", body: JSON.stringify({ content: text }) },
        (e) => {
          if (e.event === "delta") {
            accumulator += (e.data as { text: string }).text;
            setChat((c) => {
              const arr = [...c];
              arr[arr.length - 1] = { ...arr[arr.length - 1], text: accumulator };
              return arr;
            });
          } else if (e.event === "tool_call") {
            const d = e.data as { name: string; input: Record<string, unknown> };
            setChat((c) => [
              ...c,
              {
                role: "tool",
                toolName: d.name,
                text: `→ ${d.name}(${JSON.stringify(d.input).slice(0, 160)})`,
                timestamp: new Date().toISOString(),
              },
              { role: "assistant", text: "", timestamp: new Date().toISOString() },
            ]);
            accumulator = "";
          } else if (e.event === "tool_result") {
            const d = e.data as { name: string; result: string };
            // Optional: update tool message with result
          }
        }
      );
    } catch (e) {
      console.error("SSE error:", e);
      setConnectionStatus('error');
      setLastError(e instanceof Error ? e.message : 'Failed to send message');
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: "❌ حدث خطأ أثناء إرسال رسالتك. يرجى المحاولة مرة أخرى.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function newSession() {
    if (connectionStatus === 'error') return;
    try {
      const created = await jsonRequest<Session>("/live-agent/sessions", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSessions((s) => [created, ...s]);
      setActive(created);
    } catch (e) {
      console.error("Failed to create session:", e);
    }
  }

  async function deleteSession(id: number) {
    if (connectionStatus === 'error') return;
    try {
      await jsonRequest(`/live-agent/sessions/${id}`, { method: "DELETE" });
      setSessions((s) => s.filter((sess) => sess.id !== id));
      if (active?.id === id) {
        setActive(sessions.find((sess) => sess.id !== id) || null);
      }
    } catch (e) {
      console.error("Failed to delete session:", e);
    }
  }

  return (
    <div className="flex h-full bg-background/95 backdrop-blur-sm">
      <aside className="w-52 shrink-0 border-l border-primary/10 bg-card/40 flex flex-col">
        {/* Connection Status Indicator */}
        <div className="m-3 p-3 rounded-xl bg-card/60 border border-primary/20 shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            {connectionStatus === 'connected' ? (
              <div className="relative">
                <Wifi className="w-4 h-4 text-emerald-400" />
                <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
              </div>
            ) : connectionStatus === 'error' ? (
              <WifiOff className="w-4 h-4 text-red-400" />
            ) : (
              <Wifi className="w-4 h-4 text-muted-foreground animate-pulse" />
            )}
            <span className="text-[11px] font-bold tracking-wider">
              {connectionStatus === 'connected' ? 'ONLINE' : 
               connectionStatus === 'error' ? 'OFFLINE' : 'CONNECTING'}
            </span>
          </div>
          
          {connectionStatus === 'error' && (
            <div className="space-y-2">
              <div className="text-[9px] text-red-400/80 font-mono leading-tight break-all">
                {lastError || 'Server Connection Failed'}
              </div>
              <button
                onClick={retryConnection}
                disabled={isRetrying}
                className="w-full px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                RECONNECT
              </button>
            </div>
          )}
        </div>

        <button
          onClick={newSession}
          disabled={connectionStatus === 'error'}
          className="mx-3 mb-3 px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:grayscale"
        >
          <Plus className="w-4 h-4" />
          جلسة جديدة
        </button>

        <div className="flex-1 overflow-auto px-3 pb-3 space-y-1.5 custom-scrollbar">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded-xl transition-all ${
                active?.id === s.id
                  ? "bg-primary/20 border border-primary/30"
                  : "hover:bg-primary/5 border border-transparent"
              }`}
            >
              <button
                onClick={() => setActive(s)}
                className={`flex-1 text-right px-3 py-2 text-[11px] font-medium truncate ${
                  active?.id === s.id ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {s.title}
              </button>
              <button
                onClick={() => deleteSession(s.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-4 custom-scrollbar">
          {chat.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full opacity-40 grayscale">
              <Sparkles className="w-12 h-12 mb-4 text-primary animate-pulse" />
              <div className="text-sm font-bold text-primary tracking-widest">CYBERNOVA V6</div>
              <div className="text-[10px] font-mono mt-2">READY FOR COMMANDS</div>
            </div>
          )}
          {chat.map((m, i) => (
            <div
              key={i}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                  m.role === "user"
                    ? "bg-primary/20 border border-primary/30 rounded-tr-none"
                    : m.role === "tool"
                      ? "bg-amber-500/10 border border-amber-500/20 text-amber-200 font-mono italic"
                      : "bg-card/80 border border-border/40 rounded-tl-none backdrop-blur-md"
                }`}
              >
                {m.role === "tool" && (
                  <div className="flex items-center gap-2 mb-1 text-[10px] font-bold text-amber-400/80">
                    <Wrench className="w-3 h-3" />
                    {m.toolName?.toUpperCase()}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">
                  {m.text || (busy && i === chat.length - 1 ? "..." : "")}
                </div>
              </div>
              {m.timestamp && (
                <div className="mt-1 px-2 text-[9px] text-muted-foreground/60 font-mono">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          ))}
          {busy && chat[chat.length - 1]?.role !== 'assistant' && (
            <div className="flex justify-start">
              <div className="bg-card/80 border border-border/40 rounded-2xl rounded-tl-none px-4 py-3 backdrop-blur-md">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}
        </div>
        
        <form
          className="p-4 border-t border-primary/10 bg-card/60 backdrop-blur-xl"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="relative flex items-center group">
            <div className="absolute left-3 p-1.5">
              <Bot className={`w-4 h-4 transition-colors ${busy ? 'text-primary animate-pulse' : 'text-muted-foreground group-focus-within:text-primary'}`} />
            </div>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اطلب أي مهمة... (فحص، اختراق، بحث، ملفات)"
              className="w-full bg-background/50 border border-primary/20 focus:border-primary/50 rounded-2xl pl-10 pr-12 py-3 text-xs outline-none transition-all placeholder:text-muted-foreground/50 shadow-inner"
              disabled={busy || connectionStatus === 'error'}
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || connectionStatus === 'error'}
              className="absolute right-2 p-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-0 transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between px-2">
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-muted-foreground/60">
                <Clock className="w-3 h-3" />
                AUTO-SAVE ACTIVE
              </div>
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-muted-foreground/60">
                <CheckCircle2 className="w-3 h-3 text-emerald-500/60" />
                SECURE CHANNEL
              </div>
            </div>
            {busy && (
              <div className="text-[9px] font-bold text-primary animate-pulse tracking-widest">
                AI IS PROCESSING...
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
