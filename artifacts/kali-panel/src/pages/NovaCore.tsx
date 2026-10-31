import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, Send, Sparkles, Activity, CheckCircle2, AlertTriangle,
  Brain, Cpu, Loader2, Radio, Terminal, Trash2, Wrench,
  ShieldCheck, Zap, MessageSquare, StopCircle, ChevronDown, ChevronUp,
  Network, Database, Globe, BookOpen,
} from "lucide-react";
import { Link } from "wouter";
import { runNova, getNovaStatus, getNovaMemories, NOVA_CARD, type NovaEvent } from "@/lib/nova-core";

/* ── local types ──────────────────────────────────────────────────────────── */

type TimelineItem =
  | { kind: "thought"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; title: string; args: Record<string, unknown>; risk: string;
      status: "running" | "ok" | "fail"; summary?: string; ms?: number; data?: unknown }
  | { kind: "memory"; id: string; title: string }
  | { kind: "error"; id: string; message: string };

type Turn = {
  id: string;
  question: string;
  answer: string;
  timeline: TimelineItem[];
  running: boolean;
  brain?: string;
  mode?: string;
  startedAt: number;
  finishedAt?: number;
  toolCount: number;
};

const QUICK = [
  { label: "مين انت؟", text: "انت مين وممكن تعمل ايه؟", icon: Bot },
  { label: "استطلع نطاق", text: "اعمل استطلاع على github.com", icon: Globe },
  { label: "ابحث عن ثغرة", text: "ابحث عن CVE-2024-3094", icon: ShieldCheck },
  { label: "أدوات مفتوحة", text: "هات لي أدوات GitHub لفحص الويب", icon: Network },
  { label: "فهرس المنصة", text: "ابحث في فهرس المنصة عن SSRF", icon: BookOpen },
  { label: "حالة المنصة", text: "ايه حالة المنصة دلوقتي؟", icon: Database },
];

/* Tool → deep link inside the platform, so execution is visible where it belongs */
const TOOL_LINKS: Record<string, string> = {
  recon_target: "/attack-surface",
  dns_lookup: "/network",
  tls_audit: "/attack-surface",
  http_headers_audit: "/attack-surface",
  port_scan: "/active-scanner",
  subdomain_enum: "/attack-surface",
  web_fetch: "/github-search",
  cve_lookup: "/cve-search",
  vuln_search: "/vuln-center",
  exploit_search: "/exploit-db",
  github_search: "/github-search",
  knowledge_search: "/vuln-encyclopedia",
  kali_toolbox: "/kali-command-center",
  memory_save: "/memory",
  memory_search: "/memory",
  memory_list: "/memory",
  set_active_target: "/mission-tracker",
  record_finding: "/evidence",
  mission_status: "/mission-tracker",
  platform_status: "/status",
  hash_text: "/knowledge",
  web_check: "/network",
};

const RISK_STYLE: Record<string, string> = {
  safe: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  active: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  risky: "text-red-300 border-red-500/40 bg-red-500/10",
};

/* ── small pieces ─────────────────────────────────────────────────────────── */

function ToolCard({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const link = TOOL_LINKS[item.name];
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-xs backdrop-blur-sm transition-colors ${
        item.status === "running"
          ? "border-cyan-500/40 bg-cyan-500/5"
          : item.status === "ok"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-red-500/30 bg-red-500/5"
      }`}
    >
      <div className="flex items-center gap-2">
        {item.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
        ) : item.status === "ok" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        )}
        <span className="font-semibold text-white/90">{item.title}</span>
        <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-white/50">{item.name}</code>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${RISK_STYLE[item.risk] ?? RISK_STYLE.safe}`}>
          {item.risk}
        </span>
        <span className="ms-auto flex items-center gap-2 text-[10px] text-white/40">
          {typeof item.ms === "number" && <span>{item.ms}ms</span>}
          {link && (
            <Link href={link} className="text-cyan-300/80 underline decoration-dotted hover:text-cyan-200">
              افتح الصفحة
            </Link>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-white/40 hover:text-white/80">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </span>
      </div>
      {item.summary && <p className="mt-1 leading-relaxed text-white/70">{item.summary}</p>}
      {open && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-white/35">arguments</p>
          <pre dir="ltr" className="max-h-32 overflow-auto rounded bg-black/50 p-2 text-[10px] text-cyan-200/80">
            {JSON.stringify(item.args, null, 2)}
          </pre>
          {item.data !== undefined && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-white/35">raw output</p>
              <pre dir="ltr" className="max-h-52 overflow-auto rounded bg-black/50 p-2 text-[10px] text-emerald-200/80">
                {JSON.stringify(item.data, null, 2).slice(0, 4000)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {items.map((item) => {
        if (item.kind === "thought") {
          return (
            <p key={item.id} className="flex gap-2 text-xs italic leading-relaxed text-cyan-200/70">
              <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {item.text}
            </p>
          );
        }
        if (item.kind === "tool") return <ToolCard key={item.id} item={item} />;
        if (item.kind === "memory") {
          return (
            <p key={item.id} className="flex gap-2 text-xs text-violet-300/80">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" /> اتحفظ في الذاكرة: {item.title}
            </p>
          );
        }
        return (
          <p key={item.id} className="flex gap-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {item.message}
          </p>
        );
      })}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function NovaCore() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getNovaStatus>> | null>(null);
  const [memCount, setMemCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void getNovaStatus().then(setStatus);
    setMemCount(getNovaMemories().length);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const patchTurn = useCallback((id: string, fn: (t: Turn) => Turn) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const send = useCallback(
    async (raw?: string) => {
      const message = (raw ?? input).trim();
      if (!message || busy) return;
      setInput("");
      setBusy(true);

      const id = `t-${Date.now()}`;
      const controller = new AbortController();
      abortRef.current = controller;

      const turn: Turn = {
        id,
        question: message,
        answer: "",
        timeline: [],
        running: true,
        startedAt: Date.now(),
        toolCount: 0,
      };
      setTurns((prev) => [...prev, turn]);

      const history = turns
        .filter((t) => t.answer)
        .slice(-4)
        .flatMap((t) => [
          { role: "user" as const, content: t.question },
          { role: "assistant" as const, content: t.answer.slice(0, 1200) },
        ]);

      const onEvent = (e: NovaEvent) => {
        patchTurn(id, (t) => {
          switch (e.type) {
            case "ready":
              return { ...t, brain: e.brain ?? "server", mode: e.mode };
            case "thought":
              return { ...t, timeline: [...t.timeline, { kind: "thought", id: `th-${Date.now()}-${t.timeline.length}`, text: e.text }] };
            case "tool_call":
              return {
                ...t,
                timeline: [...t.timeline, { kind: "tool", id: e.id, name: e.name, title: e.title, args: e.args, risk: e.risk, status: "running" }],
              };
            case "tool_result":
              return {
                ...t,
                toolCount: t.toolCount + 1,
                timeline: t.timeline.map((it) =>
                  it.kind === "tool" && it.id === e.id
                    ? { ...it, status: e.ok ? "ok" : "fail", summary: e.summary, ms: e.ms, data: e.data }
                    : it,
                ),
              };
            case "delta":
              return { ...t, answer: t.answer + e.text };
            case "memory":
              return { ...t, timeline: [...t.timeline, { kind: "memory", id: `mem-${e.id}`, title: e.title }] };
            case "error":
              return { ...t, timeline: [...t.timeline, { kind: "error", id: `err-${Date.now()}`, message: e.message }] };
            case "done":
              return { ...t, running: false, finishedAt: Date.now(), mode: e.mode };
            default:
              return t;
          }
        });
      };

      try {
        await runNova({ message, history, onEvent, signal: controller.signal });
      } catch (err) {
        onEvent({ type: "error", message: (err as Error)?.message ?? "فشل غير معروف" });
      } finally {
        patchTurn(id, (t) => ({ ...t, running: false, finishedAt: t.finishedAt ?? Date.now() }));
        setBusy(false);
        abortRef.current = null;
        setMemCount(getNovaMemories().length);
        void getNovaStatus().then(setStatus);
      }
    },
    [busy, input, patchTurn, turns],
  );

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const stats = useMemo(
    () => ({
      tools: turns.reduce((a, t) => a + t.toolCount, 0),
      ok: turns.reduce((a, t) => a + t.timeline.filter((i) => i.kind === "tool" && i.status === "ok").length, 0),
      fail: turns.reduce((a, t) => a + t.timeline.filter((i) => i.kind === "tool" && i.status === "fail").length, 0),
    }),
    [turns],
  );

  const brainLabel =
    status?.brain === "server"
      ? `سيرفر كامل · ${status.tools} أداة`
      : `مخ محلي · ${status?.tools ?? 0} أداة`;
  const brainColor = status?.brain === "server" ? "text-emerald-300" : "text-amber-300";

  return (
    <div dir="rtl" className="relative min-h-screen bg-[#050208] text-white">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute -top-32 right-1/4 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-red-600/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex max-w-6xl flex-col gap-4 px-3 py-5 sm:px-5">
        {/* header */}
        <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 backdrop-blur">
          <div className="relative">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-400/10">
              <Sparkles className="h-5 w-5 text-cyan-300" />
            </div>
            <span className="absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-[#050208] bg-emerald-400" />
          </div>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold">
              {NOVA_CARD.name}
              <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-200">
                {NOVA_CARD.handle}
              </span>
            </h1>
            <p className="truncate text-xs text-white/50">{NOVA_CARD.tagline}</p>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1 ${brainColor}`}>
              <Cpu className="h-3.5 w-3.5" /> {brainLabel}
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-white/60">
              <Wrench className="h-3.5 w-3.5" /> {stats.tools} تشغيل
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-white/60">
              <Database className="h-3.5 w-3.5" /> {memCount} ذكرى
            </span>
            <button
              type="button"
              onClick={() => setTurns([])}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-white/60 hover:text-white"
            >
              <Trash2 className="h-3.5 w-3.5" /> مسح
            </button>
          </div>
        </header>

        {status && (
          <p className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] text-white/45">
            <Radio className="me-1 inline h-3 w-3 text-emerald-400" /> {status.note}
            {status.model && status.model !== "—" ? ` · الموديل: ${status.model}` : ""}
          </p>
        )}

        {/* chat area */}
        <div className="min-h-[45vh] flex-1 space-y-4 rounded-2xl border border-white/10 bg-black/40 p-3 sm:p-4">
          {turns.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/5">
                <Bot className="h-8 w-8 text-cyan-300" />
              </div>
              <div>
                <h2 className="text-base font-bold">اتكلم معايا زي ما بتتكلم مع صاحبك</h2>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/50">
                  مش لازم أوامر. قولي هدفك وأنا أفهم، أعمل خطة، أنفّذ الأدوات الحقيقية، وأوريك كل خطوة لحظة بلحظة.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => void send(q.text)}
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/70 transition hover:border-cyan-400/40 hover:text-cyan-200"
                  >
                    <q.icon className="h-3.5 w-3.5" /> {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t) => (
            <div key={t.id} className="space-y-2">
              {/* user */}
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm">
                  {t.question}
                </div>
              </div>

              {/* nova */}
              <div className="flex justify-end">
                <div className="w-full max-w-[92%] rounded-2xl rounded-tl-sm border border-cyan-500/20 bg-cyan-500/[0.06] px-3 py-2">
                  <div className="flex items-center gap-2 text-[10px] text-white/40">
                    <Sparkles className="h-3 w-3 text-cyan-300" />
                    <span>NOVA</span>
                    {t.brain && (
                      <span className="rounded border border-white/10 px-1">
                        {t.brain === "server" ? "سيرفر" : "محلي"} · {t.mode}
                      </span>
                    )}
                    {t.finishedAt && <span>{((t.finishedAt - t.startedAt) / 1000).toFixed(1)}s</span>}
                  </div>

                  <Timeline items={t.timeline} />

                  {t.answer && (
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/90">
                      {t.answer.split("**").map((part, i) =>
                        i % 2 === 1 ? (
                          <strong key={i} className="text-cyan-200">
                            {part}
                          </strong>
                        ) : (
                          <span key={i}>{part}</span>
                        ),
                      )}
                    </div>
                  )}
                  {t.running && !t.answer && (
                    <p className="mt-2 flex items-center gap-2 text-xs text-cyan-300/70">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> بفكر وأنفّذ…
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {/* composer */}
        <div className="sticky bottom-3 rounded-2xl border border-white/10 bg-[#0a0610]/90 p-2 backdrop-blur">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="اكتب هدفك… مثال: فحص نطاق example.com وطلع لي التقرير"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-cyan-400/50"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="flex h-11 items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/15 px-3 text-xs text-red-200"
              >
                <StopCircle className="h-4 w-4" /> وقف
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-11 items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-4 text-sm font-semibold text-cyan-100 disabled:opacity-40"
              >
                <Send className="h-4 w-4" /> ابعت
              </button>
            )}
          </form>
          <div className="mt-1 flex flex-wrap items-center gap-3 px-1 text-[10px] text-white/30">
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" /> {stats.ok} نجحت
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {stats.fail} فشلت
            </span>
            <span className="flex items-center gap-1">
              <Terminal className="h-3 w-3" /> كل نتيجة حقيقية من الأداة مش تخمين
            </span>
            <span className="ms-auto flex items-center gap-1">
              <Zap className="h-3 w-3" /> Enter للإرسال · Shift+Enter لسطر جديد
            </span>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 pb-4 text-[10px] text-white/25">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> نفس العقل موجود في نافذة الديسكتوب (Live Agent Panel)
          </span>
          <Link href="/live-agent" className="underline decoration-dotted hover:text-white/60">
            افتح Live Agent Panel
          </Link>
        </footer>
      </div>
    </div>
  );
}
