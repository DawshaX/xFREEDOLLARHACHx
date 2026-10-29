import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Send, Skull, Trash2, Settings, Wifi, WifiOff, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import {
  streamOllamaViaServer,
  probeOllamaViaServer,
  getStoredOllamaBase,
  getStoredOllamaModel,
  saveOllamaSettings,
} from "@/lib/ollama-browser";

interface Conv { id: number; title: string; createdAt: string; }
interface Msg { id: number; role: string; content: string; }

const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", outline: "none", flex: 1 };

const KALI_SYSTEM = `أنت "KaliGPT" — مساعد ذكاء اصطناعي متخصص في Kali Linux واختبار الاختراق الأخلاقي والأمن السيبراني الهجومي.
- أجب دائماً بالعربية الفصحى الواضحة، مع مصطلحات تقنية بالإنجليزية بين قوسين عند الحاجة.
- خبرتك تشمل: nmap, metasploit, burp suite, sqlmap, hydra, wireshark, john, hashcat, aircrack-ng, gobuster, nikto, OWASP ZAP، استغلال ثغرات الويب (XSS, SQLi, SSRF, RCE, IDOR, XXE)، تصعيد الصلاحيات في Linux/Windows، Active Directory attacks، تجاوز AV/EDR، Pivoting، Lateral Movement.
- قدّم أوامر جاهزة للنسخ مع شرح مختصر لكل علم/Flag.
- عند طلب اختبار اختراق، اطلب نطاق الاستهداف والاختصاص المسموح به أولاً.
- استخدم تنسيق Markdown مع code blocks وbash highlighting.
- التزم بالأخلاق المهنية: لا تساعد على اختراق أنظمة بدون إذن صريح.`;

export default function KaliGpt() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [active, setActive] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [ollamaError, setOllamaError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsBase, setSettingsBase] = useState(getStoredOllamaBase());
  const [settingsModel, setSettingsModel] = useState(getStoredOllamaModel());
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const checkOllama = useCallback(async () => {
    const result = await probeOllamaViaServer();
    setOllamaStatus(result.connected ? "ok" : "error");
    setOllamaError(result.error || "");
  }, []);

  useEffect(() => { void checkOllama(); }, [checkOllama]);

  const load = async () => {
    const list = await jsonRequest<Conv[]>("/kaligpt/conversations");
    setConvs(list);
    if (!active && list.length > 0) void select(list[0]);
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const select = async (c: Conv) => {
    setActive(c);
    const data = await jsonRequest<Conv & { messages: Msg[] }>(`/kaligpt/conversations/${c.id}`);
    setMsgs(data.messages);
  };

  const create = async () => {
    const c = await jsonRequest<Conv>("/kaligpt/conversations", {
      method: "POST",
      body: JSON.stringify({ title: `جلسة ${new Date().toLocaleString("ar-SA-u-ca-gregory")}` }),
    });
    await load(); void select(c);
  };

  const remove = async (c: Conv) => {
    await jsonRequest(`/kaligpt/conversations/${c.id}`, { method: "DELETE" });
    if (active?.id === c.id) { setActive(null); setMsgs([]); }
    await load();
  };

  const saveSettings = async () => {
    saveOllamaSettings(settingsBase, settingsModel);
    setShowSettings(false);
    await checkOllama();
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !active || busy) return;

    const userText = input.trim();
    const tempId = Date.now();
    const aId = tempId + 1;

    setMsgs(m => [...m, { id: tempId, role: "user", content: userText }, { id: aId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    abortRef.current = new AbortController();

    try {
      // Build message history for Ollama
      const history = [...msgs, { id: tempId, role: "user", content: userText }];
      const ollamaMessages = [
        { role: "system" as const, content: KALI_SYSTEM },
        ...history.map(m => ({
          role: m.role === "assistant" ? "assistant" as const : "user" as const,
          content: m.content,
        })),
      ];

      // Stream via API server proxy → Ollama (no CORS issues)
      const fullResponse = await streamOllamaViaServer({
        apiBase: getStoredOllamaBase(),
        model: getStoredOllamaModel(),
        messages: ollamaMessages,
        signal: abortRef.current.signal,
        onToken: (token) => {
          setMsgs(prev => prev.map(m => m.id === aId ? { ...m, content: m.content + token } : m));
        },
      });

      setOllamaStatus("ok");

      // Save both messages to server (history persistence)
      await jsonRequest(`/kaligpt/conversations/${active.id}/save-messages`, {
        method: "POST",
        body: JSON.stringify({ userContent: userText, assistantContent: fullResponse }),
      });

      // Reload messages from server to get real IDs
      const data = await jsonRequest<Conv & { messages: Msg[] }>(`/kaligpt/conversations/${active.id}`);
      setMsgs(data.messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "AbortError" || (err instanceof Error && err.name === "AbortError")) return;
      setOllamaStatus("error");
      setOllamaError(msg);
      setMsgs(prev => prev.map(m => m.id === aId ? { ...m, content: `⚠ خطأ: ${msg}` } : m));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4 overflow-hidden" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="☠ KaliGPT" subtitle="مساعد Kali Linux — متصل بـ Ollama على جهازك" icon={Skull} danger
        actions={
          <div className="flex items-center gap-2">
            {/* Ollama status indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono"
              style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${ollamaStatus === "ok" ? "rgba(68,255,136,0.3)" : ollamaStatus === "error" ? "rgba(255,68,68,0.3)" : "rgba(255,255,255,0.1)"}` }}>
              {ollamaStatus === "ok" ? <Wifi className="w-3 h-3 text-emerald-400" /> : ollamaStatus === "error" ? <WifiOff className="w-3 h-3 text-red-400" /> : <Loader2 className="w-3 h-3 animate-spin text-white/40" />}
              <span style={{ color: ollamaStatus === "ok" ? "#44ff88" : ollamaStatus === "error" ? "#ff5555" : "rgba(255,255,255,0.4)" }}>
                {ollamaStatus === "ok" ? `${getStoredOllamaModel()} · Online` : ollamaStatus === "error" ? "Ollama Offline" : "جاري الفحص..."}
              </span>
            </div>
            <button onClick={() => setShowSettings(s => !s)} className="p-1.5 rounded-lg transition-all" style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}>
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button onClick={create} data-testid="btn-new-kali"
              className="px-4 py-2 rounded-xl font-black text-xs font-mono flex items-center gap-2 transition-all"
              style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
              <Plus className="w-3.5 h-3.5" />جلسة جديدة
            </button>
          </div>
        }
      />

      {/* Settings Panel */}
      {showSettings && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,30,30,0.05)", border: "1px solid rgba(255,30,30,0.2)" }}>
          <div className="text-[11px] font-black font-mono text-red-400 uppercase tracking-widest mb-2">⚙ إعدادات Ollama</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>Ollama URL</label>
              <input value={settingsBase} onChange={e => setSettingsBase(e.target.value)}
                style={{ ...inputStyle, flex: "none", width: "100%", fontSize: 11 }}
                placeholder="http://127.0.0.1:11434" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>Model</label>
              <input value={settingsModel} onChange={e => setSettingsModel(e.target.value)}
                style={{ ...inputStyle, flex: "none", width: "100%", fontSize: 11 }}
                placeholder="dolphin-llama3" />
            </div>
          </div>
          {ollamaStatus === "error" && (
            <div className="text-[10px] font-mono p-2 rounded-lg whitespace-pre-wrap" style={{ background: "rgba(255,0,0,0.08)", border: "1px solid rgba(255,0,0,0.2)", color: "#ff7777" }}>
              {ollamaError || "لا يمكن الوصول إلى Ollama"}
              {"\n\n💡 تأكد من تشغيل: OLLAMA_ORIGINS=\"*\" ollama serve"}
            </div>
          )}
          <button onClick={saveSettings} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-all"
            style={{ background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
            حفظ وفحص الاتصال
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1 min-h-0">
        {/* Sidebar */}
        <div className="rounded-2xl p-3 overflow-y-auto" style={{ ...DARK, scrollbarWidth: "thin" }}>
          {convs.length === 0 && (
            <div className="text-center py-6 text-xs font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>لا جلسات</div>
          )}
          <div className="space-y-1" data-testid="kali-list">
            {convs.map(c => {
              const isActive = active?.id === c.id;
              return (
                <div key={c.id} onClick={() => void select(c)}
                  className="group flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all"
                  style={isActive
                    ? { background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.35)" }
                    : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <Skull className="w-4 h-4 shrink-0" style={{ color: isActive ? "#ff5555" : "rgba(255,255,255,0.25)" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate font-mono" style={{ color: isActive ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.45)" }}>
                      {c.title.replace("[KaliGPT] ", "")}
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); void remove(c); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: "rgba(255,68,68,0.6)" }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chat area */}
        <div className="lg:col-span-3 rounded-2xl flex flex-col min-h-0" style={DARK}>
          {active ? (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4" data-testid="kali-messages" style={{ scrollbarWidth: "thin" }}>
                {msgs.length === 0 && (
                  <div className="text-center py-12 font-mono text-sm" style={{ color: "rgba(255,255,255,0.15)" }}>
                    اسأل عن أي أداة في Kali أو سيناريو اختبار اختراق...
                  </div>
                )}
                {msgs.map(m => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                    <div className="max-w-[85%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap"
                      style={m.role === "user"
                        ? { background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)" }
                        : { background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "monospace" }}
                      dir={m.role === "user" ? "rtl" : "auto"}>
                      <div className="text-[9px] font-black font-mono uppercase mb-1"
                        style={{ color: m.role === "user" ? "#ff5555" : "#44ff88" }}>
                        {m.role === "user" ? "أنت" : "☠ KaliGPT"}
                      </div>
                      <span style={{ color: m.role === "user" ? "rgba(255,255,255,0.8)" : "rgba(68,255,136,0.85)" }}>
                        {m.content
                          ? m.content
                          : m.role === "assistant"
                            ? <span style={{ opacity: 0.7 }}>▍ جاري التفكير...</span>
                            : <span style={{ opacity: 0.4 }}>▍</span>
                        }
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={send} className="p-3 flex gap-2"
                style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <input data-testid="input-kali" value={input} onChange={e => setInput(e.target.value)}
                  placeholder={ollamaStatus === "error" ? "⚠ Ollama غير متصل — تحقق من الإعدادات" : "اطرح سؤالاً تقنياً..."}
                  disabled={busy}
                  style={{ ...inputStyle, borderColor: ollamaStatus === "error" ? "rgba(255,68,68,0.3)" : undefined }} />
                <button type="submit" data-testid="btn-kali-send" disabled={busy}
                  className="px-5 rounded-xl font-black text-xs font-mono flex items-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555", whiteSpace: "nowrap" }}>
                  <Send className="w-3.5 h-3.5" />إرسال
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3">
                <Skull className="w-16 h-16 mx-auto" style={{ color: "rgba(255,30,30,0.15)", filter: "drop-shadow(0 0 15px rgba(255,30,30,0.2))" }} />
                <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>أنشئ جلسة جديدة لتبدأ</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
