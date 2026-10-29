/**
 * FloatingNovaButton — floating Live Agent chat using the same WebSocket
 * bidirectional protocol as the full /live-agent page.
 * Creates/reuses a session automatically on open.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Bot, X, Maximize2, Sparkles, Brain, Zap, Wrench, ChevronDown, Loader2, Send, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import { jsonRequest } from "@/lib/sse";

const BASE_API = "/api";

interface Session { id: string; title: string; status: string; createdAt: string; }

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: string;
  isError?: boolean;
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
        <pre className="px-2 pb-2 whitespace-pre-wrap max-h-40 overflow-auto text-[9px]" style={{ color: msg.isError ? "rgba(255,100,100,0.8)" : "rgba(68,255,136,0.75)" }}>
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

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    try {
      const existing = await jsonRequest<Session[]>("/live-agent/sessions");
      if (existing.length > 0) {
        setSessionId(existing[0].id);
        return existing[0].id;
      }
    } catch { /**/ }
    try {
      const s = await jsonRequest<Session>("/live-agent/sessions", { method: "POST", body: "{}" });
      setSessionId(s.id);
      return s.id;
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
          m.id === id ? { ...m, pending: false, toolResult: String(d.result ?? ""), isError: Boolean(d.isError) } : m
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
        setStreaming(false);
        activeReqRef.current = null;
        activeAssistantIdRef.current = null;
      } else if (e.type === "chat_error") {
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

    const sid = await ensureSession();
    if (!sid) {
      setMessages(prev => [...prev, { id: `err_${Date.now()}`, role: "error", content: "تعذّر إنشاء جلسة. تحقق من الاتصال بالخادم.", ts: new Date().toISOString() }]);
      return;
    }

    const requestId = `req_${Date.now()}`;
    const assistantId = `a_${Date.now()}`;
    activeReqRef.current = requestId;
    activeAssistantIdRef.current = assistantId;

    setMessages(prev => [
      ...prev,
      { id: `u_${Date.now()}`, role: "user", content: text, ts: new Date().toISOString() },
      { id: assistantId, role: "assistant", content: "", ts: new Date().toISOString() },
    ]);
    setStreaming(true);

    wsSend({ type: "chat_send", sessionId: sid, content: text, requestId });
  }, [input, streaming, wsConnected, wsSend, sessionId]);

  return (
    <div className="fixed z-[9999]" style={{ bottom: "24px", right: "24px" }}>
      {open && (
        <div
          className="absolute bottom-16 right-0 w-80 sm:w-96 rounded-2xl border border-fuchsia-500/30 bg-black/96 backdrop-blur-xl shadow-2xl shadow-fuchsia-900/20 flex flex-col overflow-hidden"
          style={{ height: "520px" }}
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-fuchsia-900/40 to-purple-900/30 border-b border-fuchsia-500/20 shrink-0">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-black ${wsConnected ? "bg-emerald-400 animate-pulse" : "bg-yellow-400"}`} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-fuchsia-200">Live Agent</div>
              <div className="text-[9px] flex items-center gap-1" style={{ color: wsConnected ? "#44ff88" : "#ffaa22" }}>
                <Sparkles className="w-2.5 h-2.5" />
                {wsConnected ? "WS متصل · dolphin-llama3" : "WS جاري الاتصال..."}
                {streaming && <><Loader2 className="w-2.5 h-2.5 animate-spin" /><span>يفكر...</span></>}
              </div>
            </div>
            <button onClick={() => { setOpen(false); setLocation("/live-agent"); }}
              className="text-slate-500 hover:text-fuchsia-300 p-1 transition-colors" title="فتح الصفحة الكاملة">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-red-400 p-1 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3" style={{ fontFamily: "monospace" }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-fuchsia-500/20 to-purple-600/20 border border-fuchsia-500/30 flex items-center justify-center">
                  <Brain className="w-6 h-6 text-fuchsia-400" />
                </div>
                <div className="text-xs text-slate-400">
                  <span className="text-fuchsia-300 font-bold">Live Agent</span> جاهز<br />
                  <span className="text-slate-600 text-[10px]">يتصل بـ Ollama عبر ngrok</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 w-full mt-1">
                  {["ما حالة النظام؟", "افحص google.com", "ابحث CVE-2024", "شغّل: whoami"].map(q => (
                    <button key={q} onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                      className="text-[10px] px-2 py-1.5 bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-lg text-fuchsia-300 hover:bg-fuchsia-500/20 transition-all text-right">
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
                      ? "bg-fuchsia-500/15 border border-fuchsia-500/20 text-white"
                      : "bg-slate-800/80 border border-slate-700/50 text-slate-200"
                  }`}>
                    {msg.role === "assistant" && !msg.content && streaming ? (
                      <span className="flex items-center gap-1 text-slate-500">
                        <Loader2 className="w-3 h-3 animate-spin text-fuchsia-400" />
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
          <div className="p-3 border-t border-fuchsia-500/10 bg-black/40 shrink-0">
            <div className="flex gap-2 items-center">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && void sendMessage()}
                placeholder={wsConnected ? "اسأل Agent أي شيء…" : "جاري الاتصال..."}
                disabled={streaming || !wsConnected}
                className="flex-1 bg-black/50 border border-fuchsia-500/20 rounded-xl px-3 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-fuchsia-500/50 transition-colors disabled:opacity-50"
              />
              {streaming ? (
                <button onClick={() => { setStreaming(false); activeReqRef.current = null; }}
                  className="w-8 h-8 bg-red-600/20 border border-red-500/30 rounded-xl flex items-center justify-center text-red-400 hover:bg-red-600/30">
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button onClick={() => void sendMessage()} disabled={!input.trim() || !wsConnected}
                  className="w-8 h-8 bg-gradient-to-br from-fuchsia-600 to-purple-700 rounded-xl flex items-center justify-center disabled:opacity-40 hover:from-fuchsia-500 hover:to-purple-600 transition-all shadow-lg shadow-fuchsia-900/30">
                  <Send className="w-3.5 h-3.5 text-white" />
                </button>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setOpen(false); setLocation("/live-agent"); }}
                className="flex-1 text-[9px] text-fuchsia-500/60 hover:text-fuchsia-400 transition-colors">
                فتح الصفحة الكاملة →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Button */}
      <button onClick={() => setOpen(v => !v)}
        className={`relative w-14 h-14 rounded-full shadow-2xl transition-all duration-300 group ${
          open
            ? "bg-gradient-to-br from-red-600 to-rose-700 shadow-red-900/40"
            : "bg-gradient-to-br from-fuchsia-600 to-purple-700 shadow-fuchsia-900/40 hover:scale-110"
        }`}
      >
        {!open && (
          <>
            <span className={`absolute inset-0 rounded-full bg-fuchsia-500/30 ${pulse ? "animate-ping" : ""}`} />
            <span className="absolute inset-[-4px] rounded-full border border-fuchsia-500/20 animate-pulse" />
          </>
        )}
        <div className="relative z-10 flex items-center justify-center w-full h-full">
          {open ? <X className="w-6 h-6 text-white" /> : <Bot className="w-7 h-7 text-white drop-shadow-lg" />}
        </div>
        {!open && (
          <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap bg-black/90 border border-fuchsia-500/30 text-fuchsia-200 text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" dir="rtl">
            كلّم Live Agent الآن
          </div>
        )}
      </button>
    </div>
  );
}
