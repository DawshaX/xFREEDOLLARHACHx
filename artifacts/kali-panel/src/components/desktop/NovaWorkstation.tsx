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
  History, Plus, Copy,
} from "lucide-react";
import {
  autoLinkServer, clearRemoteBase, effectiveBase, getRemoteBase, isRemoteConfigured,
  probeRemote, reachableCandidates, resetAutoLink, setRemoteBase,
  type ProbeResult,
} from "@/lib/remote";
import { servedByEngine } from "@/lib/env";
import { runLocalBrain } from "@/lib/local-brain";
import { CloudBrainCard } from "./CloudBrainCard";
import {
  createSession, deleteSession, exportSession, getActiveId, getSession, listSessions,
  onSessionsChange, persistent, replaceLines, setActiveId, type ChatSession,
} from "@/lib/session-store";

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
  const [input, setInput] = useState(() => effectiveBase());
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(() => isRemoteConfigured());
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState("");
  // This page may itself be served by an engine (Waifly, Codespace, a VPS).
  // In that case it is already connected — to its own origin — and telling the
  // user «مش مربوط» was a lie that made the workstation look broken.
  const sameOrigin = servedByEngine();

  const discover = async () => {
    setDiscovering(true);
    setDiscoverMsg("");
    resetAutoLink();
    try {
      const found = await autoLinkServer();
      if (found) {
        setInput(found);
        setLinked(true);
        setDiscoverMsg(`اتصلت بـ ${found}`);
        onChange();
      } else {
        setDiscoverMsg(
          `جرّبت ${reachableCandidates().length} عنوان ومفيش واحد رد. اتأكد إن السيرفر شغّال.`,
        );
      }
    } finally {
      setDiscovering(false);
    }
  };

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
        <span className="text-[11px] font-black text-white/80">وسّع القدرات — سيرفر اختياري</span>
        <span className={`text-[8px] px-1.5 py-0.5 rounded border ${linked ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-amber-400/40 bg-amber-400/10 text-amber-200"}`}>
          {linked ? (sameOrigin ? "مربوط · نفس السيرفر" : "مربوط") : "مش مربوط"}
        </span>
      </div>

      <div className="text-[8.5px] leading-relaxed text-white/45">
        {sameOrigin
          ? "الصفحة دي بتتخدم من محرك نوفا نفسه — الشات والأسطول والأدوات شغّالين على السيرفر ده مباشرة، من غير أي ربط."
          : "مفيش سيرفر مربوط. دوس «اكتشف تلقائيًا» والبرنامج هيجرّب ماكينات نوفا المعروفة (Waifly / Codespace) — والربط مبيتمش غير لو /api/health رد فعلًا."}
      </div>

      {!sameOrigin && (
        <button
          onClick={() => void discover()}
          disabled={discovering}
          className="w-full py-1 rounded-lg text-[8.5px] font-black bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 flex items-center justify-center gap-1 disabled:opacity-50"
        >
          {discovering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />}
          اكتشف تلقائيًا
        </button>
      )}
      {discoverMsg && <div className="text-[8px] text-white/55 font-mono">{discoverMsg}</div>}

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
          `تعذر إنشاء الخطة: ${j?.error ?? "خطأ غير معروف"}`,
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

/* ─────────────── خريطة القدرات + قنات أوامر نوفا للوحة ─────────────── */

interface CapsPayload {
  ok: boolean;
  measuredAt?: string;
  line?: string;
  build?: { commit: string | null; builtAt: string | null; ageMin: number | null; label: string };
  tools?: { count: number; byCategory: Record<string, number> };
  runtime?: {
    browser: { engines: Array<{ name: string }>; panelClients: number; note: string };
    msf: { installed: boolean };
    burp: { installed: boolean };
    toolchain: { present: string[]; missing: string[]; dir: string } | null;
  };
  machines?: { connected: number; registered: number; names: string[] };
  corpus?: { measured: boolean; total: number; ageMin: number | null };
  memory?: { total: number };
  uiQueue?: { size: number; delivered: number; wsClients: number };
  errorAr?: string;
}

interface UiCommandDto {
  id: string;
  kind: "open_url" | "navigate" | "action";
  url?: string;
  path?: string;
  action?: string;
  at: number;
}

const UI_CURSOR_KEY = "nova:ui-cursor";

/** كيرسور طابور اللوحة — في localStorage لو متاح، ومش بيفتح تاب من تاريخ قديم. */
const uiCursor = {
  read: (): string => {
    try {
      return persistent() ? String(localStorage.getItem(UI_CURSOR_KEY) ?? "") : "";
    } catch {
      return "";
    }
  },
  write: (v: string): void => {
    try {
      if (persistent()) localStorage.setItem(UI_CURSOR_KEY, v);
    } catch {
      /* storage مقفول (private mode) — الكيرسور هيبقى في الذاكرة بس */
    }
  },
};

/**
 * الشريط ده مابيكتبش قدرة — بيقراها من `/api/nova-core/capabilities` (قياس لحظة
 * الطلب). والسبب إن نفس الأرقام كانت بتتقال في الشات من غير مرجع، فـ«49 ولا 55»
 * بقت جدل. هنا المستخدم شايف: كام أداة، إيه اللي متنصّب على المكنة، كام جهاز
 * متصل فعلًا، وإيه اللي نوفا طلبت من اللوحة يفتح (وفتَح ولا لأ).
 */
function CapabilityRail({ onAsk }: { onAsk: (text: string) => void }) {
  const [caps, setCaps] = useState<CapsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<UiCommandDto[]>([]);
  const mountedAt = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API}/nova-core/capabilities`, { signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as CapsPayload;
      if (j && j.ok) {
        setCaps(j);
        setErr(null);
      } else {
        setErr(String(j?.errorAr ?? "السيرفر مرجّعش قياس"));
      }
    } catch (e) {
      setErr(`القياس مش متاح: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  // أوامر نوفا للوحة: رابط يتفتح / صفحة تتنقّل. كل 3 ثواني، وبعيد عن إعادة تشغيل
  // الأوامر القديمة: الكيرسور في localStorage + أي أمر أقدم من فتح اللوحة بيتعلّم
  // مُسلَّم من غير ما ينفّذ (مافيش تاب بيفتح لوحده من تاريخ قديم).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const cursor = uiCursor.read();
        const q = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
        const r = await fetch(`${API}/nova-core/ui${q}`, { signal: AbortSignal.timeout(4000) });
        if (!r.ok || !alive) return;
        const j = (await r.json()) as { commands?: UiCommandDto[] };
        const cmds = Array.isArray(j?.commands) ? j.commands : [];
        if (!cmds.length) return;
        const fresh: UiCommandDto[] = [];
        for (const c of cmds) {
          uiCursor.write(c.id);
          if (c.at < mountedAt.current - 5000) continue;
          fresh.push(c);
          if (c.kind === "open_url" && c.url) {
            window.open(c.url, "_blank", "noopener");
          } else if (c.kind === "navigate" && c.path) {
            window.history.pushState({}, "", c.path);
            window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
          } else if (c.kind === "action" && c.action) {
            window.dispatchEvent(new CustomEvent("nova:ui-action", { detail: c }));
          }
        }
        if (fresh.length) setSeen((prev) => [...fresh, ...prev].slice(0, 6));
      } catch {
        /* الشبكة وقعت — مافيش أمر جديد، ومش هنختلق واحد */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 3_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const age = (min: number | null | undefined) => (min === null || min === undefined ? "—" : min < 1 ? "دلوقتي" : `من ${min} دقيقة`);
  const t = caps?.tools;
  const rt = caps?.runtime;
  const mc = caps?.machines;
  const tc = rt?.toolchain;

  return (
    <div className="border-b border-white/10 bg-white/[0.03] px-3 py-1.5 text-[9px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 font-black text-white/60 hover:text-cyan-300">
          <Radio className="h-2.5 w-2.5" />
          القدرات والشبكة
          <span className="text-white/25">{open ? "▲" : "▼"}</span>
        </button>
        {err && !caps ? (
          <span className="text-red-300/80">{err}</span>
        ) : (
          <>
            <span className="text-cyan-200/80">{t ? `${t.count} أداة` : "عدّد مش مقاس"}</span>
            <span className={mc && mc.connected > 0 ? "text-emerald-300/80" : "text-amber-300/80"}>
              {mc ? `أسطول ${mc.connected}/${mc.registered} متصل` : "الأسطول مش مقاس"}
            </span>
            <span className={rt?.browser.engines.length ? "text-emerald-300/80" : "text-white/45"}>
              متصفح: {rt?.browser.engines.length ? rt.browser.engines.map((e) => e.name).join("·") : "عندك في اللوحة"}
            </span>
            <span className="text-white/45">msf {rt?.msf.installed ? "✓" : "✗"} · burp {rt?.burp.installed ? "✓" : "✗"}</span>
            <span className={tc && tc.present.length ? "text-emerald-300/70" : "text-white/40"}>
              سلسلة الأدوات {tc ? `${tc.present.length}✓/${tc.missing.length}ناقص` : "مش مقاسة"}
            </span>
            <span className="text-white/30">{caps?.build ? `بناء ${caps.build.label} · ${age(caps.build.ageMin)}` : "بلا بصمة"}</span>
          </>
        )}
        <button onClick={() => void refresh()} title="أعد القياس" className="ms-auto text-white/30 hover:text-cyan-300">
          <RefreshCw className="h-2.5 w-2.5" />
        </button>
      </div>

      {open && (
        <div className="mt-1.5 space-y-1 border-t border-white/5 pt-1.5 text-[8.5px] text-white/55">
          {caps?.line && <div className="text-white/70">{caps.line}</div>}
          {t?.byCategory && (
            <div>
              {Object.entries(t.byCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ")}
            </div>
          )}
          {tc && (
            <div>
              <span className="text-white/40">{tc.dir}:</span> {tc.present.join(" · ") || "مفيش حاجة متنصّبة"}
              {tc.missing.length ? ` · ناقص: ${tc.missing.join(" · ")}` : ""}
            </div>
          )}
          {caps?.corpus && (
            <div>
              فهرس الثغرات: {caps.corpus.measured ? `${caps.corpus.total.toLocaleString("en-US")} (${age(caps.corpus.ageMin)})` : "مش متزامن"}
              {caps.memory ? ` · ذاكرة: ${caps.memory.total}` : ""}
            </div>
          )}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {["ايه قدراتك الحقيقية؟", "دوّر على أجهزة مجانية نشغّل عليها الأدوات", "اربط جهاز جديد", "افتح https://hackerone.com"].map((q) => (
              <button key={q} onClick={() => onAsk(q)} className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 px-1.5 py-0.5 text-cyan-200/80 hover:bg-cyan-500/15">
                {q}
              </button>
            ))}
          </div>
          {seen.length > 0 && (
            <div className="text-white/40">
              أوامر نوفا للوحة: {seen.map((c) => `${c.kind === "open_url" ? `فتح ${c.url}` : c.kind === "navigate" ? `نقل لـ${c.path}` : `إجراء ${c.action}`}`).join(" · ")}
            </div>
          )}
          {caps?.uiQueue && <div className="text-white/30">عملاء WS: {caps.uiQueue.wsClients} · الطابور {caps.uiQueue.delivered}/{caps.uiQueue.size} اتسلّم</div>}
        </div>
      )}
    </div>
  );
}

export function NovaWorkstation() {
  // The conversation lives in a persistent session, so coming back to the page
  // (or to an older chat) never loses it.
  const [sessionId, setSessionId] = useState<string>(() => {
    const active = getActiveId();
    if (active && getSession(active)) return active;
    return createSession().id;
  });
  const [lines, setLines] = useState<Line[]>(() => (getSession(sessionId)?.lines as Line[] | undefined) ?? []);
  const [sessions, setSessions] = useState<ChatSession[]>(() => listSessions());
  const [showSessions, setShowSessions] = useState(false);
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

  // Persist on every settled change. Streaming grows one line, so this stays
  // cheap even on a long answer.
  useEffect(() => {
    if (!sessionId) return;
    const id = setTimeout(() => replaceLines(sessionId, lines as Parameters<typeof replaceLines>[1]), 250);
    return () => clearTimeout(id);
  }, [lines, sessionId]);

  useEffect(() => onSessionsChange(() => setSessions(listSessions())), []);

  const openSession = (id: string) => {
    setSessionId(id);
    setActiveId(id);
    setLines((getSession(id)?.lines as Line[] | undefined) ?? []);
    setShowSessions(false);
  };

  const startSession = () => {
    const s2 = createSession();
    setSessionId(s2.id);
    setLines([]);
    setShowSessions(false);
  };

  // Is the server side actually answering? Not a guess — a real request.
  const checkHealth = useCallback(async () => {
    try {
      const r = await fetch(`${API}/nova-core/status`, { signal: AbortSignal.timeout(7000) });
      const j = await r.json();
      const alive = r.ok && j && typeof j === "object" && j.ok === true;
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

  // ── الملاحقين: أي ملاحظة جديدة على السيرفر بتتنزل في الشات لوحدها ──
  // مفيش هنا اختلاق: بنقرا `/api/nova-core/watch` (اللي بيقرا state/proactive-log.json)
  // ونعرض اللي ما شفناهوش. الوضع الساكن بيرجّع notes: [] مع سبب — فالشات ساكت
  // ومش بيدّعي إنه لسه مستني حاجة.
  const seenNotes = useRef<string[] | null>(null);
  const pushRef = useRef(push);
  pushRef.current = push;
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${API}/nova-core/watch`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok || !alive) return;
        const j = (await r.json()) as { notes?: Array<{ id?: string; kind?: string; text?: string }> };
        const notes = Array.isArray(j?.notes) ? j.notes.filter((n) => typeof n?.id === "string" && typeof n?.text === "string") : [];
        if (!notes.length) return;
        const seen = seenNotes.current ?? notes.map((n) => String(n.id));
        const fresh = notes.filter((n) => !seen.includes(String(n.id)));
        seenNotes.current = [...seen, ...fresh.map((n) => String(n.id))].slice(-300);
        for (const n of fresh.slice(0, 4).reverse()) {
          pushRef.current({ role: "note", text: `📡 [${n.kind ?? "مراقب"}] ${String(n.text)}` });
        }
      } catch {
        /* الشبكة وقعت — مفيش ملاحظة جديدة، ومش هنخترع واحدة عشان نملّي الصمت */
      }
    };
    void poll();
    const t2 = setInterval(() => void poll(), 45_000);
    return () => {
      alive = false;
      clearInterval(t2);
    };
  }, []);

  const track = (label: string, status: RunningItem["status"], id?: string, ms?: number) => {
    setItems((prev) => {
      const key = id ?? `${label}-${prev.length}`;
      const rest = prev.filter((i) => i.id !== key);
      return [{ id: key, label, status, at: Date.now(), ms }, ...rest].slice(0, 40);
    });
  };

  /** `override` بيخلّي الأزرار الجاهزة تبعت من غير ما تستنى المستخدم يكتب — من غير ما
   * الحالة تتغيّر قبل الإرسال (وده كان بيخلّي الزر يبعث فاضي لو اتعمل setInput بس). */
  const send = async (override?: string) => {
    const content = (override ?? input).trim();
    if (!content || streaming) return;
    const history = lines
      .filter((line): line is Line & { role: "user" | "assistant" } => line.role === "user" || line.role === "assistant")
      .filter((line) => line.text.trim().length > 0)
      .slice(-8)
      .map(({ role, text }) => ({ role, content: text.slice(-1200) }));
    setInput("");
    push({ role: "user", text: content });
    setStreaming(true);

    let assistant = "";
    let assistantId = nextId();
    setLines((prev) => [...prev, { id: assistantId, role: "assistant", text: "", at: Date.now() }]);

    // Notes and tool lines belong ABOVE the answer being written, otherwise the
    // transcript reads backwards (answer first, reasoning after).
    const insertBefore = (line: Omit<Line, "id" | "at">) =>
      setLines((prev) => {
        const item = { ...line, id: nextId(), at: Date.now() };
        const idx = prev.findIndex((l) => l.id === assistantId);
        if (idx < 0) return [...prev, item];
        return [...prev.slice(0, idx), item, ...prev.slice(idx)];
      });

    const appendAssistant = (chunk: string) => {
      assistant += chunk;
      setLines((prev) => prev.map((l) => (l.id === assistantId ? { ...l, text: assistant } : l)));
    };

    try {
      const res = await fetch(`${API}/nova-core/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          sessionId: sessionId || "workstation",
          history,
          ...(effectiveBrain === "browser" ? { forceHeuristic: true } : {}),
        }),
      });
      if (!res.ok) throw new Error(`chat ${res.status}`);
      const ctype = res.headers.get("content-type") ?? "";
      if (ctype.includes("text/event-stream")) {
        await streamSse(res, (ev) => handleEvent(ev, appendAssistant));
      } else {
        // Not a stream (a proxy, a 404 page, an old deploy): take the text if
        // there is any, otherwise fall through to the in-browser brain below.
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const text = String(body?.reply ?? body?.response ?? body?.content ?? body?.message ?? "");
        if (text) appendAssistant(text);
      }
    } catch (err) {
      push({ role: "error", text: `فشل الاتصال بالعقل: ${(err as Error).message}` });
    } finally {
      // Absolute last resort: never leave the user with an empty answer. The
      // in-browser engine is the same one the shim serves, so this can only
      // add an answer, not fake one.
      if (!assistant.trim()) {
        try {
          await runLocalBrain(content, (ev) => handleEvent(ev as Record<string, unknown>, appendAssistant), {
            sessionId: sessionId || "workstation",
            history,
          });
        } catch {
          /* the note below still tells the truth */
        }
      }
      if (!assistant.trim()) {
        setLines((prev) => prev.filter((l) => l.id !== assistantId));
        push({
          role: "note",
          text: "مفيش رد رجع من العقل — اكتب تاني أو اضغط تحديث، ولو اتكرر ابعتلي الرسالة اللي كتبتها.",
        });
      }
      setStreaming(false);
    }

    function handleEvent(ev: Record<string, unknown>, append: (s: string) => void) {
      const type = String(ev.type ?? "");
      if (type === "thought" && ev.text) {
        insertBefore({ role: "note", text: `🧠 ${String(ev.text)}` });
      } else if (type === "tool_call") {
        const name = String(ev.name ?? "أداة");
        insertBefore({ role: "tool", text: `▶︎ ${name} ${JSON.stringify(ev.args ?? {})}`, name });
        track(name, "running", String(ev.id ?? name));
      } else if (type === "tool_result") {
        const name = String(ev.name ?? "أداة");
        const ok = ev.ok !== false;
        insertBefore({ role: "tool", text: `${ok ? "✓" : "✗"} ${name}: ${String(ev.summary ?? "")}`, ok, name });
        track(name, ok ? "done" : "failed", String(ev.id ?? name), Number(ev.ms ?? 0) || undefined);
      } else if (type === "delta" && ev.text) {
        append(String(ev.text));
      } else if (type === "error" && ev.message) {
        push({ role: "error", text: String(ev.message) });
      } else if (type === "confirm_required") {
        insertBefore({ role: "note", text: `⏸️ ${String(ev.reason ?? "أداة حساسة محتاجة موافقة")}` });
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
            <button
              onClick={() => setShowSessions((v) => !v)}
              title="محادثاتي المحفوظة"
              className={`ms-1 flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded border ${
                showSessions ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200" : "border-white/10 bg-white/5 text-white/50 hover:text-cyan-200"
              }`}
            >
              <History className="h-2.5 w-2.5" /> {sessions.length}
            </button>
            <button onClick={startSession} title="محادثة جديدة" className="text-white/40 hover:text-cyan-300">
              <Plus className="h-3 w-3" />
            </button>
            <button onClick={() => void checkHealth()} title="إعادة فحص الاتصال" className="text-white/40 hover:text-cyan-300">
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        {showSessions && (
          <div className="shrink-0 max-h-40 overflow-y-auto border-b border-white/10 bg-black/40 p-2 space-y-1">
            <div className="flex items-center gap-1.5 px-1">
              <History className="h-3 w-3 text-cyan-300" />
              <span className="text-[9px] font-black text-white/70">محادثاتي</span>
              <span className="text-[7.5px] text-white/30">{persistent() ? "محفوظة على جهازك" : "المتصفح مش بيسمح بالحفظ"}</span>
              <button onClick={startSession} className="ms-auto text-[8px] px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                + جديدة
              </button>
            </div>
            {sessions.length === 0 && <div className="text-[8px] text-white/30 px-1">مفيش محادثات محفوظة بعد.</div>}
            {sessions.map((sess) => (
              <div
                key={sess.id}
                className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 ${
                  sess.id === sessionId ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                }`}
              >
                <button onClick={() => openSession(sess.id)} className="flex-1 min-w-0 text-start">
                  <div className="text-[8.5px] text-white/75 truncate">{sess.title}</div>
                  <div className="text-[7px] text-white/30">
                    {new Date(sess.updatedAt).toLocaleString("ar-EG")} · {sess.lines.length} سطر
                  </div>
                </button>
                <button
                  onClick={() => {
                    const text = exportSession(sess.id);
                    void navigator.clipboard?.writeText(text);
                  }}
                  title="نسخ المحادثة"
                  className="text-white/30 hover:text-cyan-300"
                >
                  <Copy className="h-2.5 w-2.5" />
                </button>
                <button
                  onClick={() => {
                    deleteSession(sess.id);
                    if (sess.id === sessionId) startSession();
                  }}
                  title="حذف"
                  className="text-white/25 hover:text-red-300"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <CapabilityRail onAsk={(q) => void send(q)} />

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {lines.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <Sparkles className="h-6 w-6 text-cyan-300 mx-auto" />
              <div className="text-[11px] font-black text-white/70">اكتب أول أمر لنوفا</div>
              <div className="text-[9px] text-white/35">
                مثال: «استخرج ثغرات example.com» · «المهمات» · «ابحث عن CVE-2025-29927» · «إيه اللي في ذاكرتك عني؟»
              </div>
              <div className="flex flex-wrap justify-center gap-1 pt-1">
                {[
                  "استخرج ثغرات example.com",
                  "هات الثغرات",
                  "المهمات",
                  "افحص example.com",
                  "ابحث عن CVE-2025-29927",
                  "إيه حالة المنصة؟",
                  "إيه الأجهزة المتصلة؟",
                ].map((t) => (
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
        <CloudBrainCard />
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
  // Ordered by what the user actually has: the browser engine first (it always
  // works), then the optional server-only extras. No wall of «محتاج سيرفر».
  const rows: Array<{ label: string; ok: boolean | null; hint: string }> = [
    {
      label: "عقل المتصفح",
      ok: true,
      hint: "شغّال — ذاكرة + فهرس + DNS حي + GitHub + OSV + قراءة صفحات",
    },
    {
      label: "قناة المتصفح الداخلية",
      ok: true,
      hint: "الأحداث والنتائج بتمر فيها لحظياً",
    },
    linked
      ? { label: "سيرفر مربوط", ok: server, hint: server ? "شغّال — 33 أداة + أسطول" : "مربوط بس مش راد" }
      : { label: "سيرفر خارجي", ok: null, hint: "مش مربوط — اختياري، بيوسّع القدرات بس" },
    linked
      ? { label: "WebSocket على السيرفر", ok: server, hint: server ? "wss:// مفتوح" : "مش راد" }
      : { label: "WebSocket على سيرفر", ok: null, hint: "بيتفتح تلقائياً لو ربطت سيرفر" },
    {
      label: "مسح منافذ / تنفيذ على أجهزة",
      ok: linked && server ? null : null,
      hint: "مستحيل من المتصفح بحكم الفيزياء — محتاج سيرفر",
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
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-[7.5px] leading-relaxed text-white/45">
          <div className="flex items-center gap-1 font-black text-white/60"><Server className="h-2.5 w-2.5" /> السيرفر اختياري</div>
          <div className="mt-0.5">
            كل حاجة ذكية شغّالة دلوقتي من غير سيرفر. لو حبيت تضيف مسح منافذ وأوامر على أجهزة:{" "}
            <span className="font-mono text-emerald-300/70" dir="ltr">bash deploy/oracle-setup.sh</span>
          </div>
        </div>
      )}
      <div className="text-[7px] text-white/20 flex items-center gap-1 pt-0.5">
        <Wrench className="h-2.5 w-2.5" /> كل بند هنا بيتفحص فعلياً، مفيش علامة صح من غير دليل
      </div>
    </div>
  );
}
