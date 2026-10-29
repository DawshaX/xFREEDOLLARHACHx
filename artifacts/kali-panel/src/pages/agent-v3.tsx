import { useState, useRef, useEffect } from "react";
import {
  Cpu, Send, Brain, Wrench, Sparkles, ListChecks, Loader2,
  Monitor, Terminal, Globe, Search, Database, ShieldAlert,
  Power, CircleDot, Skull, Zap,
} from "lucide-react";

const HINT_CARDS = [
  { tag: "LIST + TERMINAL", title: "افتح terminal ونفّذ أمر معلومات المضيف", prompt: "افتح terminal على سطح المكتب ونفّذ uname -a و cat /etc/os-release واعرض النتيجة", color: "#44eebb", rgb: "68,238,187" },
  { tag: "SCAN + SHOW", title: "افحص example.com وافتح dashboard", prompt: "ابدأ scanner على example.com (DNS + ports + SSL + headers) ثم افتح dashboard لعرض النتيجة", color: "#ffaa44", rgb: "255,170,68" },
  { tag: "CVE HUNT", title: "أحدث ثغرات critical من NVD مع PoCs", prompt: "ابحث عن آخر CVEs بتصنيف critical في آخر 7 أيام، ولكل واحدة هاتلي PoC من GitHub لو موجود", color: "#aa44ff", rgb: "170,68,255" },
  { tag: "BROWSE", title: "افتح متصفح داخلي على رابط", prompt: "افتح المتصفح الداخلي على https://nvd.nist.gov واستعرض الصفحة ثم لخّص ما رأيت", color: "#44ff88", rgb: "68,255,136" },
  { tag: "KALI START", title: "ابدأ KaliGPT terminal جاهز للأوامر", prompt: "افتح KaliGPT terminal واعرض قائمة الأدوات المثبتة (which nmap whois dig curl python3)", color: "#ff4444", rgb: "255,68,68" },
  { tag: "OLLAMA CHECK", title: "افحص حالة Ollama dolphin-llama3", prompt: "اعرض حالة Ollama وتأكد أن dolphin-llama3 متصل وشغّال، ثم اعرض list_settings", color: "#4488ff", rgb: "68,136,255" },
];

const API_KEYS_TO_TRACK = [
  { id: "ollamaModel", label: "OLLAMA_MODEL" },
  { id: "ollamaBaseUrl", label: "OLLAMA_BASE_URL" },
];

interface AgentTaskStep { id?: string; kind: string; text?: string; title?: string; content?: string; toolName?: string; toolInput?: unknown; toolResult?: string; createdAt?: string; }
interface AgentTool { name: string; description: string; riskLevel?: string; }
type RunResult = { taskId: string; finalAnswer: string; iterations: number; steps: AgentTaskStep[]; };
type ProvidersResp = { providers: Array<{ provider: string; available: boolean; defaultModel: string }>; current: { provider: string; model: string }; };

const KIND_META: Record<string, { color: string; iconColor: string; label: string; icon: typeof Brain }> = {
  plan:        { color: "rgba(68,238,187,0.08)", iconColor: "#44eebb", label: "تخطيط", icon: ListChecks },
  thought:     { color: "rgba(170,68,255,0.08)", iconColor: "#aa44ff", label: "تفكير", icon: Brain },
  tool:        { color: "rgba(255,170,68,0.08)", iconColor: "#ffaa44", label: "أداة",  icon: Wrench },
  observation: { color: "rgba(68,255,136,0.08)", iconColor: "#44ff88", label: "ملاحظة", icon: Sparkles },
  answer:      { color: "rgba(68,136,255,0.08)", iconColor: "#4488ff", label: "إجابة", icon: Sparkles },
};

const TOOL_ICONS: Record<string, typeof Wrench> = {
  run_shell: Terminal, fetch_url: Globe, search_cve_local: Database, fetch_cve_live: Database,
  search_mitre: ShieldAlert, search_cwe: ShieldAlert, search_github: Search, search_exploitdb: Search,
  knowledge_search: Search, full_scan: ShieldAlert, dns_lookup: Globe, list_files: Database,
  read_file: Database, hash_text: Cpu,
};
function pickToolIcon(title: string) {
  const lower = title.toLowerCase();
  for (const [name, Icon] of Object.entries(TOOL_ICONS)) { if (lower.includes(name)) return Icon; }
  return Wrench;
}

const API = (p: string) => `/api${p}`;

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.85)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

export default function AgentV3Page() {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [provider, setProvider] = useState<ProvidersResp["current"] | null>(null);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [liveLines, setLiveLines] = useState<Array<{ id: string; ts: string; kind: string; text: string }>>([]);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(API("/agent/tools")).then(r => r.ok ? r.json() : null).then(d => d?.tools && setTools(d.tools)).catch(() => undefined);
    fetch(API("/ai/providers")).then(r => r.ok ? r.json() : null).then((d: ProvidersResp | null) => d && setProvider(d.current)).catch(() => undefined);
    fetch(API("/ai/keys")).then(r => r.ok ? r.json() : null).then((d: { keys?: Array<{ key: string; hasValue: boolean }> } | null) => {
      if (!d?.keys) return;
      const status: Record<string, boolean> = {};
      for (const k of d.keys) { const id = k.key.replace(/^user_key_/, ""); status[id] = k.hasValue; }
      setKeyStatus(status);
    }).catch(() => undefined);
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); screenRef.current?.scrollTo({ top: screenRef.current.scrollHeight, behavior: "smooth" }); }, [result, liveLines]);
  useEffect(() => {
    if (!result?.steps) return;
    const lines = result.steps.map((s, idx) => ({ id: s.id ?? String(idx), ts: s.createdAt ? new Date(s.createdAt).toLocaleTimeString("ar") : new Date().toLocaleTimeString("ar"), kind: s.kind, text: `${s.title ?? s.text ?? s.kind}\n${s.content ?? ""}` }));
    setLiveLines(lines);
  }, [result]);

  const run = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true); setResult(null);
    setLiveLines([{ id: "boot-" + Date.now(), ts: new Date().toLocaleTimeString("ar"), kind: "system", text: `> CyberNova Agent v3 [${provider?.provider ?? "auto"}/${provider?.model ?? ""}] جاري الإقلاع...\n> استلام المهمة: ${prompt.slice(0, 80)}` }]);
    try {
      const res = await fetch(API("/agent/run"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as RunResult; setResult(data);
    } catch (e) {
      setResult({ taskId: "", finalAnswer: `فشل: ${(e as Error).message}`, iterations: 0, steps: [] });
      setLiveLines(prev => [...prev, { id: "err-" + Date.now(), ts: new Date().toLocaleTimeString("ar"), kind: "error", text: `> ERROR: ${(e as Error).message}` }]);
    } finally { setRunning(false); }
  };

  const completedSteps = result?.steps.filter(s => s.kind !== "thought").length ?? 0;
  const totalEstimate = Math.max(completedSteps, 6);
  const progress = result ? Math.min(100, (completedSteps / totalEstimate) * 100) : running ? 25 : 0;

  return (
    <div className="min-h-screen p-4 space-y-4" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left column */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)" }}>
                <Skull className="w-5 h-5" style={{ color: "#ff5555" }} />
              </div>
              <div>
                <h1 className="font-black text-lg font-mono" style={{ color: "#ff5555" }}>AI Agent v3</h1>
                {provider && <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color: "#4488ff", background: "rgba(68,136,255,0.12)", border: "1px solid rgba(68,136,255,0.25)" }}>{provider.provider}</span>}
              </div>
            </div>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>وكيل متعدد المزودين (Anthropic / Gemini / OpenAI) مع 14 أداة حقيقية — يخطط، يبحث، ينفذ، ويستنتج.</p>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="مثال: ابحث عن CVE-2024-3400 ثم أعطني PoCs على GitHub وملخص استراتيجي للحماية."
              rows={5} disabled={running} style={{ ...inputStyle, resize: "vertical" }} />
            <button onClick={run} disabled={running || !prompt.trim()}
              className="w-full py-2.5 rounded-xl font-black text-sm font-mono flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>
              {running ? <><Loader2 className="w-4 h-4 animate-spin" />جاري التنفيذ...</> : <><Send className="w-4 h-4" />تشغيل الوكيل</>}
            </button>
            {(running || result) && (
              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                  <span>التقدم</span><span>{Math.round(progress)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: "linear-gradient(90deg,#ff5555,#ff8844)" }} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {HINT_CARDS.map(h => (
                <button key={h.tag} onClick={() => !running && setPrompt(h.prompt)} disabled={running}
                  className="text-right text-[9px] font-mono p-2 rounded-xl transition-all disabled:opacity-50"
                  style={{ background: `rgba(${h.rgb},0.06)`, border: `1px solid rgba(${h.rgb},0.2)`, color: h.color }}>
                  <div className="font-black mb-0.5">{h.tag}</div>
                  <div className="line-clamp-2" style={{ color: "rgba(255,255,255,0.35)" }}>{h.title}</div>
                </button>
              ))}
            </div>
          </div>

          {/* API Keys */}
          <div className="rounded-2xl p-4 space-y-3" style={DARK}>
            <h3 className="text-[9px] font-black uppercase font-mono flex items-center gap-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              <Power className="w-3 h-3" />مفاتيح API
            </h3>
            {API_KEYS_TO_TRACK.map(k => {
              const has = keyStatus[k.id];
              return (
                <div key={k.id} className="flex items-center justify-between text-[10px] font-mono px-2 py-1.5 rounded-xl" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>{k.label}</span>
                  <span className="font-black px-1.5 py-0.5 rounded" style={{ color: has ? "#44ff88" : "#555", background: has ? "rgba(68,255,136,0.1)" : "rgba(255,255,255,0.02)", border: `1px solid ${has ? "rgba(68,255,136,0.25)" : "rgba(255,255,255,0.05)"}` }}>
                    {has ? "READY" : "EMPTY"}
                  </span>
                </div>
              );
            })}
            <a href={`${import.meta.env.BASE_URL}settings`.replace(/\/+/g, "/")}
              className="block text-center text-[9px] font-black font-mono transition-all" style={{ color: "#4488ff" }}>
              ← إدارة المفاتيح في الإعدادات
            </a>
          </div>

          {/* Tools */}
          <div className="rounded-2xl p-4 space-y-2" style={DARK}>
            <h2 className="text-[9px] font-black uppercase font-mono flex items-center gap-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              <Wrench className="w-3 h-3" />الأدوات المتاحة ({tools?.length ?? 0})
            </h2>
            <div className="space-y-1 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              {tools?.map(t => {
                const riskColor = t.riskLevel === "high" ? "#ff4444" : t.riskLevel === "medium" ? "#ffaa44" : "#44ff88";
                return (
                  <div key={t.name} className="text-[10px] p-2 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <code className="font-mono font-black" style={{ color: "#4488ff" }}>{t.name}</code>
                      {t.riskLevel && <span className="font-black px-1 rounded" style={{ color: riskColor, background: `${riskColor}12`, fontSize: 9 }}>{t.riskLevel}</span>}
                    </div>
                    <div className="font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{t.description}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Terminal Screen */}
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(68,255,136,0.2)", boxShadow: "0 0 30px rgba(68,255,136,0.06)" }}>
            <div className="flex items-center justify-between px-4 py-2" style={{ background: "rgba(0,0,0,0.6)", borderBottom: "1px solid rgba(68,255,136,0.12)" }}>
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4" style={{ color: "#44ff88" }} />
                <span className="text-[10px] font-mono" style={{ color: "rgba(68,255,136,0.7)" }}>CyberNova://agent-screen</span>
                <span className={`text-[9px] font-black font-mono px-1.5 py-0.5 rounded ${running ? "animate-pulse" : ""}`}
                  style={{ color: running ? "#ffaa44" : result ? "#44ff88" : "#555", background: running ? "rgba(255,170,68,0.12)" : result ? "rgba(68,255,136,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${running ? "rgba(255,170,68,0.3)" : result ? "rgba(68,255,136,0.3)" : "rgba(255,255,255,0.05)"}` }}>
                  <CircleDot className="w-2 h-2 inline-block me-1" />{running ? "RUNNING" : result ? "IDLE" : "STANDBY"}
                </span>
              </div>
              <div className="flex gap-1">{["#ff4444", "#ffaa44", "#44ff88"].map(c => <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c, opacity: 0.6 }} />)}</div>
            </div>
            <div ref={screenRef} className="font-mono text-[11px] p-4 h-52 overflow-auto" style={{ background: "rgba(0,0,0,0.9)", backgroundImage: "repeating-linear-gradient(0deg, rgba(0,255,200,0.02) 0px, rgba(0,255,200,0.02) 1px, transparent 1px, transparent 3px)", scrollbarWidth: "thin" }}>
              {liveLines.length === 0 && (
                <div className="text-center pt-12" style={{ color: "rgba(68,255,136,0.2)" }}>
                  <Power className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  شاشة الوكيل في وضع الاستعداد. شغّل مهمة لرؤية التنفيذ المباشر.
                </div>
              )}
              {liveLines.map(line => {
                const Icon = line.kind === "tool" ? pickToolIcon(line.text) : line.kind === "plan" ? ListChecks : line.kind === "answer" ? Brain : line.kind === "error" ? ShieldAlert : Terminal;
                const color = line.kind === "error" ? "#ff4444" : line.kind === "tool" ? "#ffaa44" : line.kind === "answer" ? "#4488ff" : line.kind === "plan" ? "#44eebb" : "#44ff88";
                return (
                  <div key={line.id} className="mb-2 flex items-start gap-2">
                    <span style={{ color: "rgba(68,255,136,0.3)" }}>[{line.ts}]</span>
                    <Icon className="w-3 h-3 mt-0.5 shrink-0" style={{ color }} />
                    <pre className="whitespace-pre-wrap break-words flex-1 leading-relaxed" style={{ color }}>{line.text.length > 800 ? line.text.slice(0, 800) + "\n... [مقتطع]" : line.text}</pre>
                  </div>
                );
              })}
              {running && <div className="flex items-center gap-2 mt-2" style={{ color: "#ffaa44" }}><Loader2 className="w-3 h-3 animate-spin" /><span className="animate-pulse">_</span></div>}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1">
            {/* Thinking Visualizer */}
            <div className="rounded-2xl p-4 space-y-3 flex flex-col min-h-64" style={DARK}>
              <h2 className="text-[10px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "#aa44ff" }}>
                <Brain className="w-3.5 h-3.5" />Thinking Visualizer
              </h2>
              <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2" style={{ scrollbarWidth: "thin" }}>
                {!result && !running && <div className="text-center py-10 text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>أدخل مهمة لبدء عرض خطوات التفكير الحية للوكيل.</div>}
                {running && !result && <div className="text-center py-6 flex items-center justify-center gap-2 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}><Loader2 className="w-3.5 h-3.5 animate-spin" /> الوكيل يخطط ويستدعي الأدوات...</div>}
                {result?.steps.map((s, idx) => {
                  const meta = KIND_META[s.kind] ?? KIND_META.thought;
                  const Icon = meta.icon;
                  return (
                    <div key={s.id ?? idx} className="p-2 rounded-xl" style={{ background: meta.color, borderRight: `3px solid ${meta.iconColor}`, paddingRight: 8 }}>
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="w-3 h-3 shrink-0" style={{ color: meta.iconColor }} />
                        <span className="text-[9px] font-black font-mono" style={{ color: meta.iconColor }}>{meta.label}</span>
                        <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{s.title ?? s.text ?? s.toolName}</span>
                      </div>
                      <pre className="text-[10px] whitespace-pre-wrap font-mono leading-relaxed max-h-24 overflow-auto" style={{ color: "rgba(255,255,255,0.55)", scrollbarWidth: "thin" }}>{s.content ?? s.text ?? s.toolResult}</pre>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Final Answer */}
            <div className="rounded-2xl p-4 space-y-3 flex flex-col min-h-64" style={DARK}>
              <h2 className="text-[10px] font-black font-mono uppercase flex items-center gap-2" style={{ color: "#4488ff" }}>
                <Sparkles className="w-3.5 h-3.5" />الإجابة النهائية
              </h2>
              <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {result?.finalAnswer ? (
                  <div className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>{result.finalAnswer}</div>
                ) : (
                  <div className="text-center py-10 text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>في انتظار اكتمال المهمة...</div>
                )}
              </div>
              {result && (
                <div className="flex justify-between text-[9px] font-mono pt-2" style={{ color: "rgba(255,255,255,0.2)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <span>المهمة: {result.taskId.slice(0, 8)}</span>
                  <span>التكرارات: {result.iterations}</span>
                  <span>الخطوات: {result.steps.length}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
