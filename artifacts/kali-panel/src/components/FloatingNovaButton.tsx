/**
 * FloatingNovaButton — floating Live Agent chat using the same WebSocket
 * bidirectional protocol as the full /live-agent page.
 * Creates/reuses a session automatically on open.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { X, Maximize2, Sparkles, Wrench, ChevronDown, Loader2, Send, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import { jsonRequest } from "@/lib/sse";
import { DAW_SKULL } from "@/lib/skull";

const BASE_API = "/api";

interface Session { id: string; title: string; status: string; createdAt: string; }
interface SessionMessage { role: "user" | "assistant"; content: string; ts?: number; }

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: string;
  isError?: boolean;
  confirmationRequired?: boolean;
  pending?: boolean;
  ts: string;
}

function ToolPill({ msg }: { msg: ChatMsg }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg overflow-hidden text-[10px] font-mono border"
      style={{ borderColor: msg.isError ? "rgba(255,80,80,0.3)" : "rgba(255,170,68,0.3)", background: msg.isError ? "rgba(255,80,80,0.05)" : "rgba(255,170,68,0.05)" }}
    >
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left">
        <Wrench className="w-3 h-3 shrink-0" style={{ color: msg.isError ? "#ff5555" : "#ffaa22" }} />
        <span className="flex-1 truncate font-bold" style={{ color: msg.isError ? "#ff5555" : "#ffaa22" }}>{msg.toolName}</span>
        {msg.pending && <Loader2 className="w-2.5 h-2.5 animate-spin" style={{ color: "#ffaa22" }} />}
        <ChevronDown className="w-2.5 h-2.5 opacity-50 shrink-0" style={{ transform: open ? "rotate(180deg)" : "" }} />
      </button>
      {open && msg.toolResult && (
        <pre className="px-2 pb-2 whitespace-pre-wrap max-h-40 overflow-auto text-[9px]" style={{ color: msg.isError ? "rgba(255,100,100,0.8)" : msg.confirmationRequired ? "#ffaa22" : "rgba(68,255,136,0.75)" }}>
          {msg.toolResult.slice(0, 2000)}
        </pre>
      )}
    </div>
  );
}

export function FloatingNovaButton() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeReqRef = useRef<string | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const activeTurnRef = useRef<{ sessionId: string; userContent: string; assistantContent: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => { setPulse(true); setTimeout(() => setPulse(false), 1500); }, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const ensureSession = async (): Promise<{ id: string; history: ChatMsg[] } | null> => {
    if (sessionId) {
      return {
        id: sessionId,
        history: messages.filter(m => m.role === "user" || m.role === "assistant"),
      };
    }
    try {
      const existing = await jsonRequest<Array<Session & { isRoot?: boolean }>>("/live-agent/sessions");
      if (existing.length > 0) {
        const preferred = existing.find((s) => s.id === "nova-root" || s.isRoot) ?? existing[0];
        const id = preferred.id;
        const session = await jsonRequest<{ messages?: SessionMessage[] }>(`/live-agent/sessions/${id}`);
        const history = (session.messages ?? [])
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message, index) => ({
            id: `history_${index}`,
            role: message.role,
            content: message.content,
            ts: message.ts ? new Date(message.ts).toISOString() : new Date().toISOString(),
          }));
        setSessionId(id);
        setMessages(history);
        return { id, history };
      }
    } catch { /**/ }
    try {
      const s = await jsonRequest<Session>("/live-agent/sessions", { method: "POST", body: "{}" });
      setSessionId(s.id);
      return { id: s.id, history: [] };
    } catch { return null; }
  };

  const wsCallback = useCallback((e: { type: string; [key: string]: unknown }) => {
      const reqId = activeReqRef.current;
      if (!reqId) return;
      const d = e as Record<string, unknown>;
      const evReqId = d?.requestId as string | undefined;
      if (evReqId && evReqId !== reqId) return;

      const assistantId = activeAssistantIdRef.current;
      if (!assistantId) return;

      if (e.type === "chat_delta") {
        const text = String(d.text ?? "");
        if (!text) return;
        if (activeTurnRef.current) activeTurnRef.current.assistantContent += text;
        setMessages(prev => prev.map(m => {
          if (m.id !== assistantId) return m;
          return { ...m, content: m.content + text };
        }));
      } else if (e.type === "chat_tool_call") {
        setMessages(prev => [...prev, {
          id: `tool_${String(d.id ?? Date.now())}`,
          role: "tool",
          content: "",
          toolName: String(d.name ?? ""),
          toolInput: d.input,
          pending: true,
          ts: new Date().toISOString(),
        }]);
      } else if (e.type === "chat_tool_result") {
        const id = `tool_${String(d.toolCallId ?? "")}`;
        setMessages(prev => prev.map(m =>
          m.id === id ? {
            ...m,
            pending: false,
            toolResult: String(d.result ?? ""),
            isError: Boolean(d.isError),
            confirmationRequired: Boolean(d.confirmationRequired),
          } : m
        ));
      } else if (e.type === "chat_client_tool") {
        const toolName = String(d.name ?? "");
        const inp = d.input as Record<string, unknown>;
        if (toolName === "ui_show_page" || toolName === "ui_navigate") {
          const page = String(inp?.page ?? inp?.path ?? "");
          if (page) setLocation(page.startsWith("/") ? page : `/${page}`);
        } else if (toolName === "ui_browse_url") {
          const url = String(inp?.url ?? "");
          if (url) window.open(url, "_blank");
        } else if (toolName === "ui_open_window") {
          const win = String(inp?.window ?? "");
          const pageMap: Record<string, string> = {
            browser: "/web-search", terminal: "/terminal", scanner: "/scanner",
            files: "/files", dashboard: "/", monitor: "/system-monitor",
          };
          if (pageMap[win]) setLocation(pageMap[win]);
        } else if (toolName === "ui_notify") {
          setMessages(prev => [...prev, {
            id: `notify_${Date.now()}`,
            role: "tool",
            content: String(inp?.message ?? "Notification"),
            toolName: "📢 notification",
            ts: new Date().toISOString(),
          }]);
        }
      } else if (e.type === "chat_done") {
        const turn = activeTurnRef.current;
        if (turn?.assistantContent) {
          void jsonRequest(`/live-agent/sessions/${turn.sessionId}/save-ai-response`, {
            method: "POST",
            body: JSON.stringify({ userContent: turn.userContent, assistantContent: turn.assistantContent }),
          }).catch(() => {
            setMessages(prev => [...prev, {
              id: `err_${Date.now()}`,
              role: "error",
              content: "وصل الرد، لكن تعذّر حفظه في سجل الجلسة.",
              ts: new Date().toISOString(),
            }]);
          });
        }
        activeTurnRef.current = null;
        setStreaming(false);
        activeReqRef.current = null;
        activeAssistantIdRef.current = null;
      } else if (e.type === "chat_error") {
        activeTurnRef.current = null;
        setStreaming(false);
        activeReqRef.current = null;
        activeAssistantIdRef.current = null;
        setMessages(prev => [...prev, {
          id: `err_${Date.now()}`,
          role: "error",
          content: String(d.message ?? "Unknown error"),
          ts: new Date().toISOString(),
        }]);
      }
    }, [setLocation]);

  const { connected: wsConnected, send: wsSend } = useWebSocket({ onMessage: wsCallback });

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !wsConnected) return;
    setInput("");

    const session = await ensureSession();
    if (!session) {
      setMessages(prev => [...prev, { id: `err_${Date.now()}`, role: "error", content: "تعذّر إنشاء جلسة. تحقق من الاتصال بالخادم.", ts: new Date().toISOString() }]);
      return;
    }
    const { id: sid, history } = session;

    const requestId = `req_${Date.now()}`;
    const assistantId = `a_${Date.now()}`;
    activeReqRef.current = requestId;
    activeAssistantIdRef.current = assistantId;
    activeTurnRef.current = { sessionId: sid, userContent: text, assistantContent: "" };

    setMessages(prev => [
      ...prev,
      { id: `u_${Date.now()}`, role: "user", content: text, ts: new Date().toISOString() },
      { id: assistantId, role: "assistant", content: "", ts: new Date().toISOString() },
    ]);
    setStreaming(true);

    wsSend({
      type: "chat_send",
      sessionId: sid,
      content: text,
      requestId,
      history: history
        .filter(m => m.role === "user" || m.role === "assistant")
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content })),
    });
  }, [input, messages, streaming, wsConnected, wsSend, sessionId]);

  return (
    <div className="fixed z-[9999]" style={{ bottom: "24px", right: "24px" }}>
      {open && (
        <div
          className="absolute bottom-16 right-0 w-80 sm:w-96 rounded-2xl border border-rose-500/45 bg-[#07030a]/96 backdrop-blur-xl shadow-2xl shadow-rose-950/50 flex flex-col overflow-hidden"
          style={{ height: "520px", boxShadow: "0 0 40px rgba(255,20,70,0.22), inset 0 1px 0 rgba(255,60,110,0.2)" }}
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-rose-950/60 via-[#120518]/80 to-cyan-950/35 border-b border-rose-500/30 shrink-0">
            <div className="relative">
              <img
                src={DAW_SKULL}
                alt="Dawsha Skull"
                className="w-9 h-9 rounded-full object-cover ring-2 ring-rose-500/80 skull-halo"
              />
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-black ${wsConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-black text-rose-100 flex items-center gap-1.5">
                <span>☠ نوفا الجذرية</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300">24/7</span>
              </div>
              <div className="text-[9px] flex items-center gap-1 font-mono" style={{ color: wsConnected ? "#22d3ee" : "#fbbf24" }}>
                <Sparkles className="w-2.5 h-2.5" />
                {wsConnected ? "متصل · nova-root · العقل الموحد" : "WS جاري الربط بالجذر..."}
                {streaming && <><Loader2 className="w-2.5 h-2.5 animate-spin text-rose-400" /><span className="text-rose-300">يفكر...</span></>}
              </div>
            </div>
            <button onClick={() => { setOpen(false); setLocation("/agent-pro"); }}
              className="text-slate-400 hover:text-cyan-300 p-1 transition-colors" title="فتح مركز القيادة الكامل">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-rose-400 p-1 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 cyber-hud-grid" style={{ fontFamily: "monospace" }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-center gap-3">
                <div className="relative">
                  <img
                    src={DAW_SKULL}
                    alt="Dawsha Skull"
                    className="w-14 h-14 rounded-full object-cover ring-2 ring-rose-500/75 skull-halo"
                  />
                </div>
                <div className="text-xs text-slate-300">
                  <span className="text-rose-300 font-black">☠ nova-root</span> متصل 24/7<br />
                  <span className="text-cyan-300/70 text-[10px]">أدوات حقيقية · ذاكرة دائمة · مجلس عقول</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 w-full mt-1">
                  {["ما حالة النظام؟", "فحص أمني سريع", "أهم CVEs اليوم", "ملخص الذاكرة"].map(q => (
                    <button key={q} onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                      className="text-[10px] px-2 py-1.5 bg-rose-500/10 border border-rose-500/25 rounded-lg text-rose-200 hover:bg-rose-500/20 hover:border-cyan-400/40 transition-all text-right">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(msg => {
              if (msg.role === "tool") return <ToolPill key={msg.id} msg={msg} />;
              if (msg.role === "error") return (
                <div key={msg.id} className="flex items-start gap-2 text-[11px] text-red-400 bg-red-400/5 border border-red-400/20 rounded-lg px-2 py-2">
                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>{msg.content}</span>
                </div>
              );
              return (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-rose-500/18 border border-rose-500/35 text-white"
                      : "bg-[#09121d]/90 border border-cyan-500/25 text-slate-200"
                  }`}>
                    {msg.role === "assistant" && !msg.content && streaming ? (
                      <span className="flex items-center gap-1 text-slate-500">
                        <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
                        <span>يفكر…</span>
                      </span>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-rose-500/20 bg-black/60 shrink-0">
            <div className="flex gap-2 items-center">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && void sendMessage()}
                placeholder={wsConnected ? "أمر أو سؤال لـ nova-root…" : "جاري الربط بالجذر..."}
                disabled={streaming || !wsConnected}
                className="flex-1 bg-black/60 border border-rose-500/30 rounded-xl px-3 py-2 text-xs text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/60 transition-colors disabled:opacity-50"
              />
              {streaming ? (
                <button onClick={() => { setStreaming(false); activeReqRef.current = null; }}
                  className="w-8 h-8 bg-red-600/20 border border-red-500/30 rounded-xl flex items-center justify-center text-red-400 hover:bg-red-600/30">
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button onClick={() => void sendMessage()} disabled={!input.trim() || !wsConnected}
                  className="w-8 h-8 bg-gradient-to-br from-rose-600 to-cyan-600 rounded-xl flex items-center justify-center disabled:opacity-40 hover:from-rose-500 hover:to-cyan-500 transition-all shadow-lg shadow-rose-900/40">
                  <Send className="w-3.5 h-3.5 text-white" />
                </button>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setOpen(false); setLocation("/live-agent"); }}
                className="flex-1 text-[9px] text-cyan-400/75 hover:text-cyan-300 transition-colors">
                فتح الوكيل الحي الكامل →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Button */}
      <button onClick={() => setOpen(v => !v)}
        className={`relative w-14 h-14 rounded-full shadow-2xl transition-all duration-300 group overflow-visible ${
          open
            ? "bg-gradient-to-br from-red-600 to-rose-800 shadow-red-900/50 ring-2 ring-rose-400/80"
            : "bg-[#0a0308] ring-2 ring-rose-500/85 skull-halo hover:scale-110"
        }`}
      >
        {!open && (
          <>
            <span className={`absolute inset-0 rounded-full bg-rose-500/25 ${pulse ? "animate-ping" : ""}`} />
            <span className="absolute -inset-1 rounded-full border border-cyan-400/30 animate-pulse pointer-events-none" />
          </>
        )}
        <div className="relative z-10 flex items-center justify-center w-full h-full rounded-full overflow-hidden">
          {open ? (
            <X className="w-6 h-6 text-white" />
          ) : (
            <img src={DAW_SKULL} alt="Dawsha Skull" className="w-full h-full object-cover" />
          )}
        </div>
        {!open && (
          <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap bg-black/95 border border-rose-500/50 text-rose-200 text-[10px] px-2.5 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg shadow-rose-950/60" dir="rtl">
            ☠ كلّم nova-root الآن
          </div>
        )}
      </button>
    </div>
  );
}
