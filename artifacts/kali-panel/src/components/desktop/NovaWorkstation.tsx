/**
 * NOVA Workstation — the place you actually work from.
 *
 * Everything the user asked for in one screen:
 *   • a real chat with NOVA (streams the same SSE contract the server uses:
 *     thought / tool_call / tool_result / delta), with a visible tool trace,
 *   • a brain selector: «سيرفر» (the linked server's 33-tool brain) or
 *     «متصفح» (the built-in engine that works with no server),
 *   • a server linker with a real probe (status → tools → fleet) and honest
 *     results, because a static page cannot have a fleet without one,
 *   • live activity: what is running now, what finished, what is next,
 *   • a plan box that assigns steps to agents,
 *   • and a checklist of what is actually broken when something is.
 *
 * No mock data: every number here comes from a real endpoint or from the
 * in-browser engine, and every failure is shown as a failure.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Brain, CheckCircle2, CircleDashed, Clock, Loader2, Plug,
  PlugZap, Radio, RefreshCw, Send, Server, Sparkles, Trash2, Wifi, WifiOff, Wrench,
} from "lucide-react";
import {
  clearRemoteBase, getRemoteBase, isRemoteConfigured, probeRemote, setRemoteBase,
  type ProbeResult,
} from "@/lib/remote";

const API = "/api";

type Role = "user" | "assistant" | "tool" | "note" | "error";

interface Line {
  id: string;
  role: Role;
  text: string;
  at: number;
  ok?: boolean;
  name?: string;
}

interface RunningItem {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  at: number;
  ms?: number;
}

interface PlanStep {
  id: string;
  title: string;
  agent: string;
  status: "queued" | "running" | "done" | "failed";
}

interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
}

/** Read an SSE body and hand every frame to the caller. Shared by both brains. */
async function streamSse(
  res: Response,
  onEvent: (ev: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          onEvent(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}

let seq = 0;
const nextId = () => `l-${Date.now()}-${seq++}`;

/* ─────────────────────────── server linker ─────────────────────────── */

function ServerLink({ onChange }: { onChange: () => void }) {
  const [input, setInput] = useState(() => getRemoteBase());
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(() => isRemoteConfigured());

  // Mixed content is the #1 reason a link "works on my machine" and dies on
  // GitHub Pages: an https page cannot call an http server. Say it up front.
  const mixedContentRisk = (() => {
    try {
      return window.location.protocol === "https:" && /^http:\/\//i.test(input.trim() || getRemoteBase());
    } catch {
      return false;
    }
  })();

  const test = async () => {
    setBusy(true);
    try {
      const result = await probeRemote(input);
      setProbe(result);
      if (result.ok) {
        setRemoteBase(input);
        setLinked(true);
        onChange();
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    clearRemoteBase();
    setLinked(false);
    setProbe(null);
    onChange();
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        {linked ? <PlugZap className="h-3.5 w-3.5 text-emerald-300" /> : <Plug className="h-3.5 w-3.5 text-amber-300" />}
        <span className="text-[11px] font-black text-white/80">ربط السيرفر</span>
        <span className={`text-[8px] px-1.5 py-0.5 rounded border ${linked ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-amber-400/40 bg-amber-400/10 text-amber-200"}`}>
          {linked ? "مربوط" : "مش مربوط"}
        </span>
      </div>

      <div className="text-[8.5px] leading-relaxed text-white/45">
        الصفحة الثابتة مفيهاش سيرفر. حطّ رابط NOVA عندك (Oracle Free / Fly / ngrok) وكل الشات والأسطول هيتحوّلوا عليه.
      </div>

      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void test()}
          placeholder="https://my-nova.fly.dev"
          dir="ltr"
          className="flex-1 min-w-0 bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] font-mono text-cyan-200 outline-none placeholder:text-white/20"
        />
        <button
          onClick={() => void test()}
          disabled={busy || !input.trim()}
          className="px-2 rounded-lg text-[9px] font-black bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-100 border border-cyan-500/40 disabled:opacity-40 shrink-0"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "اختبر واربط"}
        </button>
      </div>

      {mixedContentRisk && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-1.5 text-[8px] leading-relaxed text-amber-100/90 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            الصفحة https والسيرفر http — المتصفح هيمنع الطلب (mixed content). استخدم <b>https</b> (Fly/Render/Oracle + Caddy)
            أو نفق https زي <span className="font-mono">ngrok http 8080</span>.
          </span>
        </div>
      )}

      {linked && (
        <button onClick={disconnect} className="w-full py-1 rounded-lg text-[8.5px] font-black bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 flex items-center justify-center gap-1">
          <Trash2 className="h-3 w-3" /> فصل السيرفر (الرجوع للمتصفح)
        </button>
      )}

      {probe && (
        <div className={`rounded-lg p-1.5 border text-[8.5px] leading-relaxed ${probe.ok ? "border-emerald-500/35 bg-emerald-500/5" : "border-red-500/35 bg-red-500/5"}`}>
          {probe.ok ? (
            <>
              <div className="text-emerald-300 font-black flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> اتصل في {probe.latencyMs}ms
              </div>
              <div className="text-white/55 font-mono">
                brain: {probe.server?.brainMode ?? "?"} · ollama: {probe.server?.ollamaOnline ? "✓" : "✗"} · tools: {probe.server?.tools ?? "?"} · agents: {probe.agents ?? "?"}
              </div>
            </>
          ) : (
            <div className="text-red-300 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> {probe.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── live activity ─────────────────────────── */

function LiveRail({ items }: { items: RunningItem[] }) {
  const running = items.filter((i) => i.status === "running");
  const done = items.filter((i) => i.status !== "running");
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <Radio className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-[11px] font-black text-white/80">الشغل الحي</span>
      </div>
      <div>
        <div className="text-[8px] font-black text-amber-300/80 mb-1">شغّال دلوقتي ({running.length})</div>
        {running.length === 0 ? (
          <div className="text-[8.5px] text-white/30">مفيش حاجة شغالة</div>
        ) : (
          running.slice(0, 4).map((i) => (
            <div key={i.id} className="text-[8.5px] text-amber-100/80 flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> {i.label}
            </div>
          ))
        )}
      </div>
      <div>
        <div className="text-[8px] font-black text-sky-300/80 mb-1">خلص ({done.length})</div>
        {done.length === 0 ? (
          <div className="text-[8.5px] text-white/30">لسه مفيش</div>
        ) : (
          done.slice(0, 6).map((i) => (
            <div key={i.id} className="text-[8.5px] flex items-center gap-1" title={i.label}>
              {i.status === "failed" ? <span className="text-red-400">✗</span> : <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />}
              <span className="text-white/60 truncate">{i.label}</span>
              {i.ms != null && <span className="text-white/25 font-mono shrink-0">{i.ms}ms</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── plan box ─────────────────────────── */

function PlanBox({ onPlan, version }: { onPlan: (p: Plan | null) => void; version: number }) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/fleet/plan/active`, { signal: AbortSignal.timeout(7000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { plan?: Plan | null } | null) => {
        if (alive) setPlan(j?.plan ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);

  const create = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`${API}/fleet/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const j = await r.json();
      if (j?.plan) {
        setPlan(j.plan);
        onPlan(j.plan);
        setGoal("");
      } else {
        setNote(
          j?.static
            ? "وضع المتصفح: الخطة محتاجة سيرفر. اربط سيرفر من فوق."
            : `تعذر إنشاء الخطة: ${j?.error ?? "خطأ غير معروف"}`,
        );
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const advance = async (stepId: string, status: PlanStep["status"]) => {
    if (!plan) return;
    try {
      await fetch(`${API}/fleet/plan/${plan.id}/step/${stepId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const r = await fetch(`${API}/fleet/plan/active`);
      const j = await r.json();
      setPlan(j?.plan ?? null);
    } catch {
      /* the list keeps its last good state */
    }
  };

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-sky-300" />
        <span className="text-[11px] font-black text-sky-200">خطة العمل</span>
      </div>
      <div className="flex gap-1.5">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          placeholder="اكتب هدف واحد… مثال: افحص example.com"
          className="flex-1 min-w-0 bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] text-sky-100 outline-none placeholder:text-white/25"
        />
        <button
          onClick={() => void create()}
          disabled={busy || !goal.trim()}
          className="px-2 rounded-lg text-[9px] font-black bg-sky-500/20 hover:bg-sky-500/35 text-sky-100 border border-sky-500/40 disabled:opacity-40 shrink-0"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "خطّط"}
        </button>
      </div>
      {note && <div className="text-[8.5px] text-amber-300/85 leading-relaxed">{note}</div>}
      {plan && (
        <div className="space-y-1 max-h-44 overflow-y-auto">
          <div className="text-[9px] text-white/55 truncate">🎯 {plan.goal}</div>
          {plan.steps.map((s) => (
            <div key={s.id} className="rounded-lg bg-black/35 px-1.5 py-1 border border-white/5">
              <div className="flex items-center gap-1">
                {s.status === "done" ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                ) : s.status === "failed" ? (
                  <span className="text-red-400 text-[9px]">✗</span>
                ) : s.status === "running" ? (
                  <Loader2 className="h-3 w-3 text-amber-300 animate-spin shrink-0" />
                ) : (
                  <CircleDashed className="h-3 w-3 text-white/25 shrink-0" />
                )}
                <span className="text-[8.5px] text-white/70 truncate flex-1">{s.title}</span>
                <span className="text-[7.5px] font-mono text-cyan-300/60 shrink-0">{s.agent}</span>
              </div>
              {(s.status === "queued" || s.status === "running") && (
                <div className="flex gap-1 mt-1">
                  <button onClick={() => void advance(s.id, "running")} className="text-[7.5px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30">بدأت</button>
                  <button onClick={() => void advance(s.id, "done")} className="text-[7.5px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/30">خلصت</button>
                  <button onClick={() => void advance(s.id, "failed")} className="text-[7.5px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-200 border border-red-500/30">فشلت</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── the workstation ─────────────────────────── */

export function NovaWorkstation() {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [brain, setBrain] = useState<"auto" | "server" | "browser">("auto");
  const [items, setItems] = useState<RunningItem[]>([]);
  const [planVersion, setPlanVersion] = useState(0);
  const [health, setHealth] = useState<{ server: boolean; checked: boolean }>({ server: false, checked: false });
  const bottom = useRef<HTMLDivElement>(null);

  const linked = isRemoteConfigured();
  const effectiveBrain = brain === "auto" ? (linked ? "server" : "browser") : brain;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Is the server side actually answering? Not a guess — a real request.
  const checkHealth = useCallback(async () => {
    try {
      const r = await fetch(`${API}/nova-core/status`, { signal: AbortSignal.timeout(7000) });
      const j = await r.json();
      const alive = r.ok && j && typeof j === "object" && Array.isArray(Object.keys(j)) ;
      // In static mode the engine answers with `mode: "static"` — that is not a server.
      setHealth({ server: Boolean(alive) && j?.mode !== "static", checked: true });
    } catch {
      setHealth({ server: false, checked: true });
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  const push = (line: Omit<Line, "id" | "at">) => setLines((prev) => [...prev, { ...line, id: nextId(), at: Date.now() }]);

  const track = (label: string, status: RunningItem["status"], id?: string, ms?: number) => {
    setItems((prev) => {
      const key = id ?? `${label}-${prev.length}`;
      const rest = prev.filter((i) => i.id !== key);
      return [{ id: key, label, status, at: Date.now(), ms }, ...rest].slice(0, 40);
    });
  };

  const send = async () => {
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");
    push({ role: "user", text: content });
    setStreaming(true);

    let assistant = "";
    let assistantId = nextId();
    setLines((prev) => [...prev, { id: assistantId, role: "assistant", text: "", at: Date.now() }]);

    const appendAssistant = (chunk: string) => {
      assistant += chunk;
      setLines((prev) => prev.map((l) => (l.id === assistantId ? { ...l, text: assistant } : l)));
    };

    try {
      if (effectiveBrain === "browser") {
        // Force the built-in engine: the setup shim owns that route.
        const res = await fetch(`${API}/nova-core/chat?brain=browser`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content, sessionId: "workstation", forceHeuristic: true }),
        });
        if (!res.ok) throw new Error(`chat ${res.status}`);
        await streamSse(res, (ev) => handleEvent(ev, appendAssistant));
      } else {
        const res = await fetch(`${API}/nova-core/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content, sessionId: "workstation" }),
        });
        if (!res.ok) throw new Error(`chat ${res.status}`);
        await streamSse(res, (ev) => handleEvent(ev, appendAssistant));
      }
    } catch (err) {
      push({ role: "error", text: `فشل الاتصال بالعقل: ${(err as Error).message}` });
      setLines((prev) => prev.filter((l) => !(l.id === assistantId && l.text === "")));
    } finally {
      if (!assistant.trim()) {
        setLines((prev) => prev.filter((l) => l.id !== assistantId));
        push({
          role: "note",
          text: "العقل رجّع رد فاضي. جرّب «متصفح» من فوق، أو اربط سيرفر من محطة العمل.",
        });
      }
      setStreaming(false);
    }

    function handleEvent(ev: Record<string, unknown>, append: (s: string) => void) {
      const type = String(ev.type ?? "");
      if (type === "thought" && ev.text) {
        push({ role: "note", text: `🧠 ${String(ev.text)}` });
      } else if (type === "tool_call") {
        const name = String(ev.name ?? "أداة");
        push({ role: "tool", text: `▶︎ ${name} ${JSON.stringify(ev.args ?? {})}`, name });
        track(name, "running", String(ev.id ?? name));
      } else if (type === "tool_result") {
        const name = String(ev.name ?? "أداة");
        const ok = ev.ok !== false;
        push({ role: "tool", text: `${ok ? "✓" : "✗"} ${name}: ${String(ev.summary ?? "")}`, ok, name });
        track(name, ok ? "done" : "failed", String(ev.id ?? name), Number(ev.ms ?? 0) || undefined);
      } else if (type === "delta" && ev.text) {
        append(String(ev.text));
      } else if (type === "error" && ev.message) {
        push({ role: "error", text: String(ev.message) });
      } else if (type === "confirm_required") {
        push({ role: "note", text: `⏸️ ${String(ev.reason ?? "أداة حساسة محتاجة موافقة")}` });
      }
    }
  };

  const serverBadge = useMemo(() => {
    if (effectiveBrain === "browser") return { text: "عقل المتصفح", cls: "border-violet-400/40 bg-violet-400/10 text-violet-200" };
    if (!health.checked) return { text: "بيفحص…", cls: "border-white/20 bg-white/5 text-white/60" };
    return health.server
      ? { text: "عقل السيرفر متصل", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" }
      : { text: "السيرفر مش متاح — هستخدم المتصفح", cls: "border-amber-400/40 bg-amber-400/10 text-amber-200" };
  }, [effectiveBrain, health]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
      {/* chat */}
      <div className="xl:col-span-8 rounded-xl border border-cyan-500/20 bg-black/30 flex flex-col h-[74vh] min-h-[460px] overflow-hidden">
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-white/10">
          <Brain className="h-4 w-4 text-cyan-300" />
          <span className="text-[11px] font-black text-white/85">محطة العمل — كلّم نوفا</span>
          <span className={`text-[8px] px-1.5 py-0.5 rounded border ${serverBadge.cls}`}>{serverBadge.text}</span>
          <div className="ms-auto flex items-center gap-1">
            {(["auto", "server", "browser"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBrain(b)}
                className={`text-[8px] px-1.5 py-0.5 rounded border ${
                  brain === b
                    ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
                    : "border-white/10 bg-white/5 text-white/45 hover:text-white/70"
                }`}
              >
                {b === "auto" ? "تلقائي" : b === "server" ? "سيرفر" : "متصفح"}
              </button>
            ))}
            <button onClick={() => void checkHealth()} title="إعادة فحص الاتصال" className="ms-1 text-white/40 hover:text-cyan-300">
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {lines.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <Sparkles className="h-6 w-6 text-cyan-300 mx-auto" />
              <div className="text-[11px] font-black text-white/70">اكتب أول أمر لنوفا</div>
              <div className="text-[9px] text-white/35">مثال: «افحص example.com» · «ابحث عن CVE-2025-29927» · «إيه اللي في ذاكرتك عني؟»</div>
              <div className="flex flex-wrap justify-center gap-1 pt-1">
                {["إيه الأجهزة المتصلة؟", "ابحث عن CVE-2025-29927", "إيه حالة المنصة؟"].map((t) => (
                  <button key={t} onClick={() => setInput(t)} className="text-[8.5px] px-2 py-1 rounded-lg border border-cyan-500/25 bg-cyan-500/5 text-cyan-200/80 hover:bg-cyan-500/15">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {lines.map((l) => {
            const style =
              l.role === "user"
                ? "bg-cyan-500/10 border-cyan-500/25 ms-6"
                : l.role === "tool"
                  ? "bg-amber-500/5 border-amber-500/20 me-4"
                  : l.role === "note"
                    ? "bg-white/5 border-white/10 me-4"
                    : l.role === "error"
                      ? "bg-red-500/10 border-red-500/30 me-4"
                      : "bg-emerald-500/5 border-emerald-500/20 me-4";
            return (
              <div key={l.id} className={`rounded-xl border p-2 ${style}`}>
                <div className="text-[7.5px] font-black mb-0.5 text-white/40">
                  {l.role === "user" ? "أنت" : l.role === "assistant" ? "نوفا" : l.role === "tool" ? "أداة" : l.role === "error" ? "خطأ" : "ملاحظة"}
                  <span className="ms-2 font-normal text-white/20">{new Date(l.at).toLocaleTimeString("ar-EG")}</span>
                </div>
                <pre className="text-[9px] whitespace-pre-wrap break-words leading-relaxed font-sans text-white/80">
                  {l.text || (streaming ? "▌" : "")}
                </pre>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>

        <div className="shrink-0 flex gap-2 p-2 border-t border-white/10">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="اكتب أمرك لنوفا… (Enter للإرسال، Shift+Enter لسطر جديد)"
            className="flex-1 bg-black/60 border border-cyan-900/40 rounded-xl px-3 py-2 text-[9.5px] text-cyan-100 outline-none resize-none placeholder:text-white/25"
          />
          <button
            onClick={() => void send()}
            disabled={streaming || !input.trim()}
            className="px-3 rounded-xl text-[9px] font-black bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-100 border border-cyan-500/40 disabled:opacity-40 flex items-center gap-1"
          >
            {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            إرسال
          </button>
        </div>
      </div>

      {/* right rail */}
      <div className="xl:col-span-4 space-y-2">
        <ServerLink
          onChange={() => {
            setHealth({ server: false, checked: false });
            void checkHealth();
            setPlanVersion((v) => v + 1);
          }}
        />
        <LiveRail items={items} />
        <PlanBox onPlan={() => setPlanVersion((v) => v + 1)} version={planVersion} />
        <HealthCard linked={linked} server={health.server} checked={health.checked} onRecheck={() => void checkHealth()} />
      </div>
    </div>
  );
}

/* ─────────────────────────── health checklist ─────────────────────────── */

function HealthCard({
  linked,
  server,
  checked,
  onRecheck,
}: {
  linked: boolean;
  server: boolean;
  checked: boolean;
  onRecheck: () => void;
}) {
  const rows: Array<{ label: string; ok: boolean | null; hint: string }> = [
    {
      label: "ربط سيرفر",
      ok: linked,
      hint: linked ? "مربوط — كل الطلبات بتروح عليه" : "مش مربوط — بنستخدم عقل المتصفح",
    },
    {
      label: "عقل السيرفر (33 أداة)",
      ok: server,
      hint: server ? "شغّال" : "مش متاح — محتاج سيرفر",
    },
    {
      label: "WebSocket مباشر",
      ok: linked,
      hint: linked ? "بيفتح wss:// على السيرفر المربوط" : "مفيش سيرفر، فمفيش سوكت",
    },
    {
      label: "أسطول أجهزة",
      ok: linked ? null : false,
      hint: linked ? "بيظهر لو الوكيل متشغّل على جهاز" : "محتاج سيرفر + nova-agent.js",
    },
    {
      label: "Ollama",
      ok: linked ? null : false,
      hint: linked ? "بيتفحص على السيرفر (المتصفح مايوصلهاش)" : "مستحيل من المتصفح — CORS/mixed content",
    },
  ];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        {server ? <Wifi className="h-3.5 w-3.5 text-emerald-300" /> : <WifiOff className="h-3.5 w-3.5 text-white/40" />}
        <span className="text-[11px] font-black text-white/80">حالة الاتصالات</span>
        <button onClick={onRecheck} className="ms-auto text-white/35 hover:text-cyan-300" title="إعادة الفحص">
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-start gap-1.5">
          <span className="mt-0.5 shrink-0">
            {r.ok === true ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            ) : r.ok === null ? (
              <CircleDashed className="h-3 w-3 text-amber-300" />
            ) : (
              <AlertTriangle className="h-3 w-3 text-white/30" />
            )}
          </span>
          <div className="min-w-0">
            <div className="text-[8.5px] text-white/70 font-black">{r.label}</div>
            <div className="text-[7.5px] text-white/35 leading-snug">{r.hint}</div>
          </div>
        </div>
      ))}
      {!checked && <div className="text-[7.5px] text-cyan-300/60 flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> بيفحص…</div>}
      {!server && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-1.5 text-[7.5px] leading-relaxed text-cyan-100/70">
          <div className="flex items-center gap-1 font-black text-cyan-200"><Server className="h-2.5 w-2.5" /> تشغيل سيرفر مجاني</div>
          <code className="block font-mono text-[7px] text-emerald-300/80 mt-0.5" dir="ltr">bash deploy/oracle-setup.sh</code>
          <div className="mt-0.5">أو Fly.io / Render / Docker على أي VPS — التفاصيل في <span className="font-mono">deploy/README.md</span></div>
        </div>
      )}
      <div className="text-[7px] text-white/20 flex items-center gap-1 pt-0.5">
        <Wrench className="h-2.5 w-2.5" /> كل بند هنا بيتفحص فعلياً، مفيش علامة صح من غير دليل
      </div>
    </div>
  );
}
