import { useEffect, useRef, useState, useCallback } from "react";
import { MessageSquare, Plus, Send, Trash2, Skull, RefreshCw, Bot, Settings, Wifi, WifiOff, Loader2, Brain, Pin, Search, X, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import {
  streamOllamaViaServer,
  probeOllamaViaServer,
  getStoredOllamaBase,
  getStoredOllamaModel,
  saveOllamaSettings,
} from "@/lib/ollama-browser";

interface Conversation { id: number; title: string; createdAt: string; }
interface Message { id: number; conversationId: number; role: string; content: string; createdAt: string; }
interface MemoryItem { id: string; kind: string; title: string; content: string; pinned: boolean; createdAt: string; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none" };

const KIND_COLOR: Record<string, string> = { fact: "#4488ff", project: "#44ff88", preference: "#aa44ff", contact: "#ffaa44" };
const KIND_RGB: Record<string, string> = { fact: "68,136,255", project: "68,255,136", preference: "170,68,255", contact: "255,170,68" };

const CHAT_SYSTEM = `أنت محلل أمن سيبراني متخصص في CyberNova. أجب بنفس لغة المستخدم (الافتراضي العربية). كن دقيقاً تقنياً وأشر إلى CVEs وOWASP عند الحاجة. استخدم Markdown مع code blocks.`;

export default function Chat() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [ollamaError, setOllamaError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsBase, setSettingsBase] = useState(getStoredOllamaBase());
  const [settingsModel, setSettingsModel] = useState(getStoredOllamaModel());
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Memory Panel state
  const [showMemory, setShowMemory] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memSearch, setMemSearch] = useState("");
  const [memLoading, setMemLoading] = useState(false);
  const [showAddMem, setShowAddMem] = useState(false);
  const [newMemKind, setNewMemKind] = useState("fact");
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");

  const checkOllama = useCallback(async () => {
    const result = await probeOllamaViaServer();
    setOllamaStatus(result.connected ? "ok" : "error");
    setOllamaError(result.error || "");
  }, []);

  useEffect(() => { void checkOllama(); }, [checkOllama]);

  const loadConvs = async () => {
    const list = await jsonRequest<Conversation[]>("/anthropic/conversations");
    setConvs(list);
    if (!active && list.length > 0) void selectConv(list[0]);
  };

  useEffect(() => { void loadConvs(); }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Load memories
  const loadMemories = useCallback(async (q?: string) => {
    setMemLoading(true);
    try {
      const url = q ? `/memory?search=${encodeURIComponent(q)}` : "/memory";
      const data = await jsonRequest<MemoryItem[]>(url);
      setMemories(data);
    } catch { /* ignore */ } finally { setMemLoading(false); }
  }, []);

  useEffect(() => {
    if (showMemory) void loadMemories();
  }, [showMemory, loadMemories]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (showMemory) void loadMemories(memSearch || undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [memSearch, showMemory, loadMemories]);

  const selectConv = async (c: Conversation) => {
    setActive(c);
    const data = await jsonRequest<Conversation & { messages: Message[] }>(`/anthropic/conversations/${c.id}`);
    setMessages(data.messages);
  };

  const newConv = async () => {
    const c = await jsonRequest<Conversation>("/anthropic/conversations", {
      method: "POST",
      body: JSON.stringify({ title: `محادثة ${new Date().toLocaleString("ar-SA-u-ca-gregory")}` }),
    });
    await loadConvs();
    void selectConv(c);
  };

  const remove = async (c: Conversation) => {
    await jsonRequest(`/anthropic/conversations/${c.id}`, { method: "DELETE" });
    if (active?.id === c.id) { setActive(null); setMessages([]); }
    await loadConvs();
  };

  const saveSettings = async () => {
    saveOllamaSettings(settingsBase, settingsModel);
    setShowSettings(false);
    await checkOllama();
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !active || streaming) return;

    const userText = input.trim();
    const now = new Date().toISOString();
    const tempId = Date.now();
    const aId = tempId + 1;

    setMessages(m => [
      ...m,
      { id: tempId, conversationId: active.id, role: "user", content: userText, createdAt: now },
      { id: aId, conversationId: active.id, role: "assistant", content: "", createdAt: now },
    ]);
    setInput("");
    setStreaming(true);
    abortRef.current = new AbortController();

    try {
      const history = [...messages, { id: tempId, conversationId: active.id, role: "user", content: userText, createdAt: now }];
      const ollamaMessages = [
        { role: "system" as const, content: CHAT_SYSTEM },
        ...history.map(m => ({
          role: m.role === "assistant" ? "assistant" as const : "user" as const,
          content: m.content,
        })),
      ];

      const fullResponse = await streamOllamaViaServer({
        apiBase: getStoredOllamaBase(),
        model: getStoredOllamaModel(),
        messages: ollamaMessages,
        signal: abortRef.current.signal,
        onToken: (token) => {
          setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: m.content + token } : m));
        },
      });

      setOllamaStatus("ok");

      await jsonRequest(`/anthropic/conversations/${active.id}/save-messages`, {
        method: "POST",
        body: JSON.stringify({ userContent: userText, assistantContent: fullResponse }),
      });

      const data = await jsonRequest<Conversation & { messages: Message[] }>(`/anthropic/conversations/${active.id}`);
      setMessages(data.messages);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setOllamaStatus("error");
      setOllamaError(msg);
      setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: `⚠ خطأ:\n${msg}` } : m));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  // Memory helpers
  const handlePinMem = async (item: MemoryItem) => {
    const { pinned } = await jsonRequest<{ id: string; pinned: boolean }>(`/memory/${item.id}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: !item.pinned }),
    });
    setMemories(p => {
      const updated = p.map(m => m.id === item.id ? { ...m, pinned } : m);
      return [...updated.filter(m => m.pinned), ...updated.filter(m => !m.pinned)];
    });
  };

  const handleDeleteMem = async (id: string) => {
    await jsonRequest(`/memory/${id}`, { method: "DELETE" });
    setMemories(p => p.filter(m => m.id !== id));
  };

  const handleAddMem = async () => {
    if (!newMemTitle || !newMemContent) return;
    const created = await jsonRequest<MemoryItem>("/memory", {
      method: "POST",
      body: JSON.stringify({ kind: newMemKind, title: newMemTitle, content: newMemContent }),
    });
    setMemories(p => [created, ...p]);
    setShowAddMem(false); setNewMemTitle(""); setNewMemContent("");
  };

  const smallInput: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "rgba(255,255,255,0.8)", fontSize: 11, fontFamily: "monospace", padding: "6px 10px", outline: "none", width: "100%" };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="p-4 space-y-3">
        <PageHeader title="☠ محادثة AI" subtitle="متصل بـ Ollama على جهازك مباشرة — بث حي · دعم كامل للعربية · بلا حدود" icon={MessageSquare} danger
          actions={
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono"
                style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${ollamaStatus === "ok" ? "rgba(68,255,136,0.3)" : ollamaStatus === "error" ? "rgba(255,68,68,0.3)" : "rgba(255,255,255,0.1)"}` }}>
                {ollamaStatus === "ok" ? <Wifi className="w-3 h-3 text-emerald-400" /> : ollamaStatus === "error" ? <WifiOff className="w-3 h-3 text-red-400" /> : <Loader2 className="w-3 h-3 animate-spin text-white/40" />}
                <span style={{ color: ollamaStatus === "ok" ? "#44ff88" : ollamaStatus === "error" ? "#ff5555" : "rgba(255,255,255,0.4)" }}>
                  {ollamaStatus === "ok" ? `${getStoredOllamaModel()} · Online` : ollamaStatus === "error" ? "Ollama Offline" : "جاري الفحص..."}
                </span>
              </div>
              <button onClick={() => { setShowMemory(s => !s); }} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono transition-all"
                style={showMemory ? { background: "rgba(170,0,255,0.12)", border: "1px solid rgba(170,0,255,0.35)", color: "#cc66ff" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
                <Brain className="w-3 h-3" />الذاكرة {memories.length > 0 && <span className="font-black">{memories.length}</span>}
              </button>
              <button onClick={() => setShowSettings(s => !s)} className="p-1.5 rounded-lg transition-all" style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}>
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button onClick={newConv} data-testid="btn-new-conv"
                className="px-4 py-2 rounded-xl font-black text-[12px] font-mono flex items-center gap-2 transition-all"
                style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
                <Plus className="w-4 h-4" />محادثة جديدة
              </button>
            </div>
          }
        />

        {showSettings && (
          <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(170,0,255,0.05)", border: "1px solid rgba(170,0,255,0.2)" }}>
            <div className="text-[11px] font-black font-mono text-purple-400 uppercase tracking-widest mb-2">⚙ إعدادات Ollama</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>Ollama URL</label>
                <input value={settingsBase} onChange={e => setSettingsBase(e.target.value)}
                  style={{ ...inputStyle, width: "100%", fontSize: 11 }}
                  placeholder="http://127.0.0.1:11434" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>Model</label>
                <input value={settingsModel} onChange={e => setSettingsModel(e.target.value)}
                  style={{ ...inputStyle, width: "100%", fontSize: 11 }}
                  placeholder="dolphin-llama3" />
              </div>
            </div>
            {ollamaStatus === "error" && (
              <div className="text-[10px] font-mono p-3 rounded-lg whitespace-pre-wrap leading-relaxed" style={{ background: "rgba(255,0,0,0.06)", border: "1px solid rgba(255,0,0,0.2)", color: "#ff8888" }}>
                {ollamaError}
                {"\n\n💡 الحل: افتح terminal وشغّل:\n  OLLAMA_ORIGINS=\"*\" ollama serve"}
              </div>
            )}
            <button onClick={saveSettings} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-all"
              style={{ background: "rgba(170,0,255,0.15)", border: "1px solid rgba(170,0,255,0.35)", color: "#cc66ff" }}>
              حفظ وفحص الاتصال
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 grid gap-4 px-4 pb-4 min-h-0"
        style={{
          gridTemplateColumns: showMemory ? "1fr 2fr 1fr" : "1fr 3fr",
          height: "calc(100vh - 130px)",
        }}>

        {/* Conversations Sidebar */}
        <div className="rounded-2xl p-3 overflow-y-auto" style={{ ...NEON_CARD, scrollbarWidth: "thin" }}>
          <div className="text-[10px] font-black font-mono mb-3 px-1" style={{ color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em" }}>المحادثات</div>
          {convs.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <Skull className="w-8 h-8 mx-auto" style={{ color: "rgba(255,255,255,0.07)" }} />
              <div className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>لا محادثات</div>
            </div>
          ) : (
            <div className="space-y-1.5" data-testid="conv-list">
              {convs.map((c) => (
                <div key={c.id} onClick={() => void selectConv(c)}
                  className="group flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all"
                  style={active?.id === c.id
                    ? { background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)" }
                    : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <MessageSquare className="w-3.5 h-3.5 shrink-0"
                    style={{ color: active?.id === c.id ? "#ff5555" : "rgba(255,255,255,0.3)" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-mono truncate" style={{ color: active?.id === c.id ? "#ff8888" : "rgba(255,255,255,0.55)" }}>{c.title}</div>
                    <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
                      {new Date(c.createdAt).toLocaleDateString("ar-SA")}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); void remove(c); }}
                    className="opacity-0 group-hover:opacity-100 transition-all p-1 rounded"
                    style={{ color: "rgba(255,255,255,0.3)" }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat window */}
        <div className="rounded-2xl flex flex-col min-h-0" style={NEON_CARD}>
          {active ? (
            <>
              <div className="px-4 pt-3 pb-2 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <Bot className="w-4 h-4" style={{ color: "#aa44ff" }} />
                <span className="text-[11px] font-black font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{active.title}</span>
                {streaming && <RefreshCw className="w-3 h-3 animate-spin ml-auto" style={{ color: "#aa44ff" }} />}
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" style={{ scrollbarWidth: "thin" }} data-testid="messages">
                {messages.length === 0 && (
                  <div className="text-center py-16 space-y-3">
                    <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                    <p className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>ابدأ المحادثة بكتابة رسالة...</p>
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[82%] rounded-2xl px-4 py-3 space-y-1"
                      style={m.role === "user"
                        ? { background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.25)" }
                        : { background: "rgba(170,0,255,0.08)", border: "1px solid rgba(170,0,255,0.18)" }}>
                      <div className="text-[9px] font-black font-mono uppercase mb-1 flex items-center gap-1.5 justify-between"
                        style={{ color: m.role === "user" ? "#ff6666" : "#cc66ff" }}>
                        <span>{m.role === "user" ? "أنت" : `☠ Ollama · ${getStoredOllamaModel()}`}</span>
                        {m.role === "assistant" && m.content && (
                          <button
                            onClick={() => {
                              const title = m.content.slice(0, 60).trim();
                              setNewMemKind("fact");
                              setNewMemTitle(title);
                              setNewMemContent(m.content.slice(0, 500));
                              setShowMemory(true);
                              setShowAddMem(true);
                            }}
                            title="حفظ في الذاكرة"
                            className="px-1.5 py-0.5 rounded text-[8px] transition-all"
                            style={{ background: "rgba(170,0,255,0.1)", border: "1px solid rgba(170,0,255,0.2)", color: "#aa44ff" }}>
                            <Brain className="w-2.5 h-2.5 inline-block" /> حفظ
                          </button>
                        )}
                      </div>
                      <div className="text-[12px] font-mono leading-relaxed whitespace-pre-wrap"
                        style={{ color: "rgba(255,255,255,0.8)" }}>
                        {m.content
                          ? m.content
                          : m.role === "assistant"
                            ? <span style={{ color: "#aa44ff", opacity: 0.7 }}>▍ جاري التفكير...</span>
                            : <span style={{ opacity: 0.5 }}>▍</span>
                        }
                      </div>
                      <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
                        {new Date(m.createdAt).toLocaleTimeString("ar-EG")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={send} className="p-3 flex gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <input data-testid="input-message" value={input} onChange={(e) => setInput(e.target.value)}
                  placeholder={ollamaStatus === "error" ? "⚠ Ollama غير متصل — افتح الإعدادات ⚙" : "اكتب رسالتك... (بلا حدود للردود)"}
                  disabled={streaming}
                  style={{ ...inputStyle, flex: 1, borderColor: ollamaStatus === "error" ? "rgba(255,68,68,0.3)" : undefined }} />
                <button type="submit" data-testid="btn-send" disabled={streaming || !input.trim()}
                  className="px-5 py-2.5 rounded-xl font-black text-[12px] font-mono flex items-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: "rgba(255,30,30,0.14)", border: "1px solid rgba(255,30,30,0.38)", color: "#ff6666" }}>
                  {streaming ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {streaming ? "..." : "إرسال"}
                </button>
                {streaming && (
                  <button type="button" onClick={() => abortRef.current?.abort()}
                    className="px-3 py-2.5 rounded-xl font-black text-[11px] font-mono transition-all"
                    style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.25)", color: "#ff5555" }}>
                    إيقاف
                  </button>
                )}
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4">
                <Skull className="w-16 h-16 mx-auto" style={{ color: "rgba(255,255,255,0.06)", filter: "drop-shadow(0 0 10px rgba(200,0,255,0.1))" }} />
                <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>أنشئ محادثة جديدة للبدء</p>
                <button onClick={newConv}
                  className="px-5 py-2.5 rounded-xl font-black text-[12px] font-mono flex items-center gap-2 mx-auto transition-all"
                  style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.28)", color: "#ff6666" }}>
                  <Plus className="w-4 h-4" />محادثة جديدة
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Memory Panel */}
        {showMemory && (
          <div className="rounded-2xl flex flex-col min-h-0 overflow-hidden" style={{ ...NEON_CARD, border: "1px solid rgba(170,0,255,0.2)" }}>
            {/* Header */}
            <div className="px-3 pt-3 pb-2 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(170,0,255,0.1)" }}>
              <div className="flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5" style={{ color: "#cc66ff" }} />
                <span className="text-[10px] font-black font-mono" style={{ color: "#cc66ff" }}>الذاكرة والتعلم</span>
                <span className="text-[9px] font-mono px-1 rounded" style={{ background: "rgba(170,0,255,0.1)", color: "#aa44ff" }}>{memories.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => void loadMemories(memSearch || undefined)}
                  className="p-1 rounded" style={{ color: "rgba(255,255,255,0.25)" }}>
                  <RefreshCw className={`w-3 h-3 ${memLoading ? "animate-spin" : ""}`} />
                </button>
                <button onClick={() => { setShowAddMem(s => !s); setNewMemTitle(""); setNewMemContent(""); }}
                  className="p-1 rounded" style={{ color: "#cc66ff" }}>
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setShowMemory(false)} className="p-1 rounded" style={{ color: "rgba(255,255,255,0.25)" }}>
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Add Form */}
            {showAddMem && (
              <div className="p-3 space-y-2" style={{ borderBottom: "1px solid rgba(170,0,255,0.1)", background: "rgba(170,0,255,0.03)" }}>
                <div className="text-[9px] font-black font-mono" style={{ color: "#aa44ff" }}>إضافة ذاكرة جديدة</div>
                <select value={newMemKind} onChange={e => setNewMemKind(e.target.value)} style={smallInput}>
                  <option value="fact">Fact — حقيقة</option>
                  <option value="project">Project — مشروع</option>
                  <option value="preference">Preference — تفضيل</option>
                  <option value="contact">Contact — جهة اتصال</option>
                </select>
                <input placeholder="العنوان *" style={smallInput} value={newMemTitle} onChange={e => setNewMemTitle(e.target.value)} />
                <textarea placeholder="المحتوى *" style={{ ...smallInput, minHeight: 60, resize: "vertical" }} value={newMemContent} onChange={e => setNewMemContent(e.target.value)} />
                <div className="flex gap-1.5">
                  <button onClick={handleAddMem} disabled={!newMemTitle || !newMemContent}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-black font-mono disabled:opacity-40 transition-all"
                    style={{ background: "rgba(170,0,255,0.12)", border: "1px solid rgba(170,0,255,0.3)", color: "#cc66ff" }}>
                    حفظ
                  </button>
                  <button onClick={() => setShowAddMem(false)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {/* Search */}
            <div className="px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="relative">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                <input value={memSearch} onChange={e => setMemSearch(e.target.value)}
                  placeholder="بحث..."
                  style={{ ...smallInput, paddingRight: "24px", fontSize: 10 }} />
              </div>
            </div>

            {/* Memory List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5" style={{ scrollbarWidth: "thin" }}>
              {memLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-4 h-4 animate-spin" style={{ color: "rgba(170,0,255,0.3)" }} />
                </div>
              ) : memories.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <Brain className="w-8 h-8 mx-auto" style={{ color: "rgba(255,255,255,0.04)" }} />
                  <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد ذكريات بعد</p>
                  <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.12)" }}>اضغط زر الحفظ على أي رد من AI</p>
                </div>
              ) : (
                memories.map(item => {
                  const color = KIND_COLOR[item.kind] ?? "#888";
                  const rgb = KIND_RGB[item.kind] ?? "136,136,136";
                  return (
                    <div key={item.id} className="group rounded-xl p-2.5 space-y-1 relative"
                      style={{ background: `rgba(${rgb},0.04)`, border: `1px solid rgba(${item.pinned ? rgb + ",0.35" : rgb + ",0.1"})` }}>
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          {item.pinned && <Pin className="w-2.5 h-2.5 shrink-0" style={{ color }} />}
                          <span className="text-[8px] font-black font-mono px-1 rounded shrink-0"
                            style={{ color, background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.2)` }}>
                            {item.kind}
                          </span>
                          <span className="text-[10px] font-black truncate" style={{ color }}>{item.title}</span>
                        </div>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => void handlePinMem(item)}
                            className="p-0.5 rounded"
                            style={{ color: item.pinned ? color : "rgba(255,255,255,0.2)" }}
                            title={item.pinned ? "إلغاء التثبيت" : "تثبيت"}>
                            <Pin className="w-2.5 h-2.5" />
                          </button>
                          <button onClick={() => void handleDeleteMem(item.id)}
                            className="p-0.5 rounded"
                            style={{ color: "#ff4444" }}>
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[9px] font-mono leading-relaxed line-clamp-3" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {item.content}
                      </p>
                      <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>
                        {new Date(item.createdAt).toLocaleDateString("ar-EG")}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer stats */}
            <div className="px-3 py-2 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
                {memories.filter(m => m.pinned).length} مثبت · {memories.length} إجمالي
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
