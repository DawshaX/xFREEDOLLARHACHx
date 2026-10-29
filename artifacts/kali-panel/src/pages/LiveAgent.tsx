import { useEffect, useRef, useState } from "react";
import {
  Activity, Bot, ChevronRight, Loader2, Plus, Send,
  Sparkles, Square, Trash2, Wrench, Skull,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest, sseStream } from "@/lib/sse";

interface Session { id: number; title: string; status: string; createdAt: string; }
interface SessionMessage { id: number; role: string; content: string; toolName?: string | null; toolInput?: string | null; toolResult?: string | null; createdAt: string; }
interface UIBlock { kind: "text" | "tool"; text?: string; toolName?: string; toolInput?: unknown; toolResult?: string; toolError?: boolean; toolPending?: boolean; id: string; }
interface UIMessage { id: number | string; role: "user" | "assistant" | "tool"; blocks: UIBlock[]; }
interface ProcessRecord { id: string; command: string; status: "running" | "exited" | "killed" | "error"; pid: number | null; exitCode: number | null; startedAt: number; endedAt: number | null; output: string; }

const TOOL_LABELS: Record<string, string> = {
  list_files: "قراءة قائمة الملفات", read_file: "قراءة ملف من قاعدة البيانات",
  write_file: "حفظ ملف في قاعدة البيانات", scan_url: "فحص أمني للرابط",
  search_cve_local: "بحث محلي عن ثغرات", fetch_cve_live: "جلب ثغرات حية من NVD",
  cve_stats: "إحصائيات قاعدة الثغرات", run_shell: "تنفيذ أمر shell حقيقي",
  start_background_process: "تشغيل عملية في الخلفية", list_processes: "قائمة العمليات الجارية",
  read_process_output: "قراءة مخرجات عملية", kill_process: "إنهاء عملية",
  read_workspace_file: "قراءة ملف من نظام الملفات", write_workspace_file: "كتابة ملف في نظام الملفات",
  list_workspace_dir: "استعراض مجلد",
};

const DARK = { background: "rgba(5,0,12,0.85)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

function historyToUI(msgs: SessionMessage[]): UIMessage[] {
  const out: UIMessage[] = []; let current: UIMessage | null = null;
  for (const m of msgs) {
    if (m.role === "tool") {
      if (current?.role === "assistant") {
        current.blocks.push({ kind: "tool", id: `t-${m.id}`, toolName: m.toolName ?? "tool", toolInput: m.toolInput ? JSON.parse(m.toolInput) : {}, toolResult: m.toolResult ?? "" });
      }
      continue;
    }
    current = { id: m.id, role: m.role as "user" | "assistant", blocks: [{ kind: "text", text: m.content, id: `tx-${m.id}` }] };
    out.push(current);
  }
  return out;
}

function MessageView({ m }: { m: UIMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap"
          style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)" }} dir="rtl">
          <div className="text-[9px] font-black font-mono uppercase mb-1" style={{ color: "#ff5555" }}>أنت</div>
          <span style={{ color: "rgba(255,255,255,0.8)" }}>{m.blocks[0]?.text}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2">
        <div className="text-[9px] font-black font-mono uppercase text-end" style={{ color: "#44eebb" }}>⚡ Live Agent</div>
        {m.blocks.map(b => {
          if (b.kind === "text") {
            return (
              <div key={b.id} className="rounded-xl px-4 py-3 text-sm whitespace-pre-wrap"
                style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(68,238,187,0.15)", fontFamily: "monospace", color: "rgba(68,238,187,0.85)" }}>
                {b.text || <span style={{ opacity: 0.4 }}>▍</span>}
              </div>
            );
          }
          return (
            <div key={b.id} className="rounded-xl overflow-hidden" data-testid={`tool-${b.toolName}`}
              style={{ background: "rgba(255,170,68,0.04)", border: "1px solid rgba(255,170,68,0.3)" }}>
              <div className="flex items-center gap-2 px-3 py-2"
                style={{ background: "rgba(255,170,68,0.08)", borderBottom: "1px solid rgba(255,170,68,0.15)" }}>
                <Wrench className="w-3.5 h-3.5" style={{ color: "#ffaa44" }} />
                <span className="text-[10px] font-black font-mono" style={{ color: "#ffaa44" }}>
                  {TOOL_LABELS[b.toolName || ""] || b.toolName}
                </span>
                {b.toolPending && <Loader2 className="w-3 h-3 animate-spin ms-auto" style={{ color: "#ffaa44" }} />}
                {!b.toolPending && <ChevronRight className="w-3.5 h-3.5 ms-auto" style={{ color: "rgba(255,170,68,0.4)" }} />}
              </div>
              {b.toolInput != null && Object.keys(b.toolInput as object).length > 0 && (
                <div className="px-3 py-2 text-[10px] font-mono" style={{ color: "rgba(255,200,100,0.7)", background: "rgba(255,170,68,0.03)" }}>
                  <pre className="whitespace-pre-wrap" dir="ltr">{JSON.stringify(b.toolInput, null, 2)}</pre>
                </div>
              )}
              {b.toolResult && (
                <div className="px-3 py-2 text-[10px] font-mono max-h-48 overflow-y-auto"
                  style={{ color: "rgba(68,255,136,0.75)", background: "rgba(68,255,136,0.03)", borderTop: "1px solid rgba(255,170,68,0.1)", scrollbarWidth: "thin" }}>
                  <pre className="whitespace-pre-wrap" dir="ltr">
                    {b.toolResult.length > 1500 ? b.toolResult.slice(0, 1500) + "\n...[مقتطع]" : b.toolResult}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LiveAgent() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [msgs, setMsgs] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [procs, setProcs] = useState<ProcessRecord[]>([]);
  const [openProc, setOpenProc] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadSessions = async () => {
    const list = await jsonRequest<Session[]>("/live-agent/sessions");
    setSessions(list);
    if (!active && list.length > 0) selectSession(list[0]);
  };
  const loadProcs = async () => {
    try { setProcs(await jsonRequest<ProcessRecord[]>("/processes")); } catch {}
  };

  useEffect(() => {
    loadSessions(); loadProcs();
    const t = setInterval(loadProcs, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  const selectSession = async (s: Session) => {
    setActive(s);
    const data = await jsonRequest<Session & { messages: SessionMessage[] }>(`/live-agent/sessions/${s.id}`);
    setMsgs(historyToUI(data.messages));
  };
  const newSession = async () => {
    const s = await jsonRequest<Session>("/live-agent/sessions", { method: "POST", body: JSON.stringify({}) });
    await loadSessions(); selectSession(s);
  };
  const removeSession = async (s: Session) => {
    await jsonRequest(`/live-agent/sessions/${s.id}`, { method: "DELETE" });
    if (active?.id === s.id) { setActive(null); setMsgs([]); }
    await loadSessions();
  };
  const killProc = async (id: string) => { await jsonRequest(`/processes/${id}/kill`, { method: "POST" }); await loadProcs(); };
  const removeProc = async (id: string) => { await jsonRequest(`/processes/${id}`, { method: "DELETE" }); if (openProc === id) setOpenProc(null); await loadProcs(); };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !active || busy) return;
    const userText = input; setInput("");
    const userMsg: UIMessage = { id: `u-${Date.now()}`, role: "user", blocks: [{ kind: "text", text: userText, id: "u" }] };
    const assistantMsg: UIMessage = { id: `a-${Date.now()}`, role: "assistant", blocks: [] };
    setMsgs(m => [...m, userMsg, assistantMsg]); setBusy(true);
    const toolBlocks = new Map<string, UIBlock>();
    try {
      await sseStream(
        `/live-agent/sessions/${active.id}/messages`,
        { method: "POST", body: JSON.stringify({ content: userText }) },
        (e) => {
          const d = e.data as Record<string, unknown>;
          if (e.event === "delta") {
            setMsgs(prev => prev.map(m => {
              if (m.id !== assistantMsg.id) return m;
              const last = m.blocks[m.blocks.length - 1];
              if (last && last.kind === "text") return { ...m, blocks: [...m.blocks.slice(0, -1), { ...last, text: (last.text || "") + (d.text as string) }] };
              return { ...m, blocks: [...m.blocks, { kind: "text", text: d.text as string, id: `tx-${Date.now()}` }] };
            }));
          } else if (e.event === "tool_call") {
            const block: UIBlock = { kind: "tool", id: d.id as string, toolName: d.name as string, toolInput: d.input, toolPending: true };
            toolBlocks.set(d.id as string, block);
            setMsgs(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, blocks: [...m.blocks, block] } : m));
          } else if (e.event === "tool_result") {
            const id = d.toolCallId as string;
            setMsgs(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, blocks: m.blocks.map(b => b.id === id ? { ...b, toolPending: false, toolResult: d.result as string, toolError: !!d.isError } : b) } : m));
          }
        },
      );
    } catch (err) {
      setMsgs(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, blocks: [...m.blocks, { kind: "text", id: "err", text: `\n\n[خطأ: ${err instanceof Error ? err.message : "Unknown"}]` }] } : m));
    } finally { setBusy(false); }
  };

  return (
    <div className="h-full flex flex-col space-y-4 overflow-hidden" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ Live Agent"
        subtitle="وكيل ذكاء اصطناعي حي بأدوات حقيقية - يقرأ، يكتب، يفحص، وينفّذ"
        icon={Sparkles} danger
        actions={
          <button onClick={newSession} data-testid="btn-new-session"
            className="px-4 py-2 rounded-xl font-black text-xs font-mono flex items-center gap-2 transition-all"
            style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
            <Plus className="w-3.5 h-3.5" />جلسة جديدة
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1 min-h-0">
        {/* Sidebar */}
        <div className="space-y-3 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {/* Sessions */}
          <div className="rounded-2xl p-3" style={DARK}>
            <div className="text-[9px] font-black font-mono uppercase mb-2 px-1" style={{ color: "rgba(255,30,30,0.5)" }}>☠ الجلسات</div>
            {sessions.length === 0 && (
              <div className="text-center py-4 text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>لا جلسات بعد</div>
            )}
            <div className="space-y-1" data-testid="session-list">
              {sessions.map(s => {
                const isActive = active?.id === s.id;
                return (
                  <div key={s.id} onClick={() => selectSession(s)}
                    className="group flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all"
                    style={isActive ? { background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)" } : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <Bot className="w-4 h-4 shrink-0" style={{ color: isActive ? "#ff5555" : "rgba(255,255,255,0.2)" }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-mono truncate" style={{ color: isActive ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)" }}>{s.title}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); removeSession(s); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "rgba(255,68,68,0.6)" }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Processes */}
          <div className="rounded-2xl p-3" style={DARK} data-testid="process-list">
            <div className="text-[9px] font-black font-mono uppercase mb-2 px-1 flex items-center gap-2" style={{ color: "rgba(68,255,136,0.5)" }}>
              <Activity className="w-3 h-3" />المهام الجارية
              <span className="ms-auto text-[9px]" style={{ color: "rgba(255,255,255,0.25)" }}>{procs.filter(p => p.status === "running").length} نشطة</span>
            </div>
            {procs.length === 0 && (
              <div className="text-center py-3 text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>لا توجد عمليات</div>
            )}
            <div className="space-y-1.5">
              {procs.slice(0, 8).map(p => {
                const statusColor = p.status === "running" ? "#44ff88" : p.status === "exited" && p.exitCode === 0 ? "#4488ff" : "#ff4444";
                const isOpen = openProc === p.id;
                return (
                  <div key={p.id} className="rounded-xl transition-all overflow-hidden"
                    style={{ border: isOpen ? "1px solid rgba(255,170,68,0.4)" : "1px solid rgba(255,255,255,0.04)", background: isOpen ? "rgba(255,170,68,0.04)" : "rgba(255,255,255,0.01)" }}>
                    <div className="flex items-center gap-2 p-2 cursor-pointer" onClick={() => setOpenProc(isOpen ? null : p.id)}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor, boxShadow: p.status === "running" ? `0 0 5px ${statusColor}` : "none" }} />
                      <div className="flex-1 min-w-0 text-[10px] font-mono truncate" dir="ltr" title={p.command}>
                        {p.command.replace(/^bash -lc /, "").slice(0, 50)}
                      </div>
                      {p.status === "running" ? (
                        <button onClick={e => { e.stopPropagation(); killProc(p.id); }}
                          style={{ color: "rgba(255,170,68,0.6)" }} title="إيقاف"><Square className="w-3 h-3" /></button>
                      ) : (
                        <button onClick={e => { e.stopPropagation(); removeProc(p.id); }}
                          style={{ color: "rgba(255,68,68,0.5)" }}><Trash2 className="w-3 h-3" /></button>
                      )}
                    </div>
                    {isOpen && (
                      <pre className="px-3 pb-2 text-[9px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto"
                        style={{ color: "rgba(68,255,136,0.7)", scrollbarWidth: "thin" }} dir="ltr">
                        {p.output ? p.output.slice(-2000) : "[لا مخرجات بعد]"}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="lg:col-span-3 rounded-2xl flex flex-col min-h-0" style={DARK}>
          {active ? (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4" data-testid="agent-messages" style={{ scrollbarWidth: "thin" }}>
                {msgs.length === 0 && (
                  <div className="text-center py-12 font-mono text-sm" style={{ color: "rgba(255,255,255,0.15)" }}>
                    اطلب من الوكيل أي مهمة. مثال:<br />
                    "ابحث عن ثغرات apache الحرجة وأنشئ تقريراً" أو "افحص google.com وقارن النتيجة بـ github.com"
                  </div>
                )}
                {msgs.map(m => <MessageView key={m.id} m={m} />)}
                {busy && (
                  <div className="flex items-center gap-2 text-[10px] font-black font-mono animate-pulse" style={{ color: "#ff5555" }}>
                    <Loader2 className="w-3 h-3 animate-spin" />الوكيل يفكر / ينفّذ...
                  </div>
                )}
              </div>
              <form onSubmit={send} className="p-3 flex gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <input data-testid="input-agent-message" value={input} onChange={e => setInput(e.target.value)}
                  placeholder="اطلب أي شيء... الوكيل سيستخدم أدواته للتنفيذ" disabled={busy}
                  style={inputStyle} />
                <button type="submit" data-testid="btn-agent-send" disabled={busy}
                  className="px-5 rounded-xl font-black text-xs font-mono flex items-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", whiteSpace: "nowrap" }}>
                  <Send className="w-3.5 h-3.5" />أرسل
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3">
                <Skull className="w-16 h-16 mx-auto" style={{ color: "rgba(255,30,30,0.12)", filter: "drop-shadow(0 0 15px rgba(255,30,30,0.2))" }} />
                <Bot className="w-12 h-12 mx-auto" style={{ color: "rgba(255,30,30,0.2)" }} />
                <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>أنشئ جلسة جديدة للبدء</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
