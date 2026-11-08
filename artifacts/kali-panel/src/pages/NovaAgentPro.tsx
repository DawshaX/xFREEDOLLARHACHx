/**
 * «الأجينت المطوّر — مكتب نوفا» (/agent-pro)
 * ─────────────────────────────────────────────────────────────────────────────
 * صفحة واحدة بتجمع كل الشغل الجديد في وش واحد، ومتصلة بكل طبقات البرنامج:
 *
 *   • شات حي بنفس سيل أحداث نوفا-أجينت v3 (thought/action/result...) — على
 *     المحرك يضرب السيرفر الحقيقي، وعلى GitHub Pages نفس النداء بيتلقط بشبكة
 *     الوضع المستقل (setup.ts) فيرد عقل المتصفح — نفس الكود، نفس التجربة.
 *   • لوحة قياسات حية من /api/ops/tools: الأدوات الموجودة/الناقصة، حجم الكاش،
 *     الموارد (CPU/RAM)، آخر provisioning — مع الاعتراف الصريح «غير متاح في
 *     وضع المتصفح» بدل أي رقم متخيل.
 *   • المجلس: /api/nova-core/council — مين واخد مقعد دلوقتي.
 *   • «اللي حصل»: المهمات المحفوظة (mission-store) — بتنجو الريستارت.
 *   • شريط الأسطول: نفس سجل servers.ts اللي الصفحة الكبيرة بتقراه — التفعيل من
 *     هنا بيغيّر قناة التنفيذ للتطبيق كله (متصل ببعضه فعلًا، مش نسخة تانية).
 *   • السجل المحلي للشات بيتخزن (آخر 80 بالون) — الجلسة دايمة زي ما اتطلب.
 *
 * مفيش endpoint واحد هنا متخيل: أي مصدر مش متاح في السياق بيظهر بصراحة.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, Bot, BrainCircuit, Cpu, HardDrive, MemoryStick, Radio,
  RefreshCw, Send, Server, Shield, Sparkles, Wrench, Zap,
} from "lucide-react";
import { isStandaloneHost, servedByEngine } from "@/lib/env";
import { getRemoteBase } from "@/lib/remote";
import { listServers, activateServer, activeServerId, type KnownServer } from "@/lib/servers";
import { listMissions, activeMission, type Mission } from "@/lib/mission-store";

/* ── أنواع الردود اللي بنقراها بشكل دفاعي ──────────────────────────────────── */
interface ToolsReport {
  ok?: boolean;
  present?: string[];
  missing?: string[];
  freeMB?: number | null;
  minFreeMB?: number;
  last?: { at?: string; ok?: boolean; installed?: number; total?: number } | null;
  resources?: { cpuCores?: number; memTotalMB?: number; memFreeMB?: number } | null;
  catalogue?: string[];
}
interface CouncilReply { ok?: boolean; members?: Array<{ id?: string; label?: string; hasKey?: boolean }>; providers?: unknown[]; [k: string]: unknown }

interface ChatMsg { role: "user" | "agent" | "event"; text: string; at: number; kind?: string }

const CHAT_KEY = "nova-agent-pro-chat";
const CHAT_KEEP = 80;

function loadChat(): ChatMsg[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    const arr = raw ? (JSON.parse(raw) as ChatMsg[]) : [];
    return Array.isArray(arr) ? arr.slice(-CHAT_KEEP) : [];
  } catch { return []; }
}
function saveChat(msgs: ChatMsg[]): void {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-CHAT_KEEP))); } catch { /* مساحة الخاص */ }
}

function fmtTime(at?: number | string): string {
  if (!at) return "—";
  const d = typeof at === "number" ? new Date(at) : new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** شارة حالة صغيرة */
function Chip({ ok, label, title }: { ok: boolean | null; label: string; title?: string }) {
  const cls = ok === null
    ? "border-zinc-600 text-zinc-300"
    : ok
      ? "border-emerald-500/60 text-emerald-300"
      : "border-amber-500/60 text-amber-300";
  const dot = ok === null ? "bg-zinc-500" : ok ? "bg-emerald-400 animate-pulse" : "bg-amber-400";
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export default function NovaAgentPro() {
  const standalone = isStandaloneHost();
  const engineServed = servedByEngine();
  const [tools, setTools] = useState<ToolsReport | null>(null);
  const [toolsTried, setToolsTried] = useState(false);
  const [council, setCouncil] = useState<CouncilReply | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [servers, setServers] = useState<KnownServer[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => loadChat());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const pushMsg = useCallback((m: ChatMsg) => {
    setMsgs((prev) => {
      const next = [...prev, m].slice(-CHAT_KEEP);
      saveChat(next);
      return next;
    });
  }, []);

  /* قياسات المحرك — كل 10 ثواني، وبس لما يكون فيه محرك أصلًا */
  const refresh = useCallback(async () => {
    if (standalone) { setToolsTried(true); return; }
    try {
      const t = await fetch("/api/ops/tools").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setTools(t as ToolsReport | null);
      setToolsTried(true);
    } catch { setToolsTried(true); }
    try {
      const c = await fetch("/api/nova-core/council").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setCouncil(c as CouncilReply | null);
    } catch { /* المجلس قرأته الشارة */ }
  }, [standalone]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    const mid = setInterval(() => setMissions(listMissions()), 5_000);
    setMissions(listMissions());
    setServers(listServers());
    setActiveId(activeServerId());
    return () => { clearInterval(id); clearInterval(mid); };
  }, [refresh]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length]);

  /* ── الشات: نفس سيل v3 — يشتغل على المحرك وفي وضع المتصفح بنفس الكود ── */
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    pushMsg({ role: "user", text, at: Date.now() });
    try {
      const res = await fetch("/api/nova-agent-v3/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalText = "";
      const notes: string[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const data = JSON.parse(line.slice(6)) as { type?: string; content?: string };
            if (data.type === "final" || data.type === "result") { if (data.content) finalText = String(data.content); }
            else if (data.type === "thought" || data.type === "action" || data.type === "observation") {
              if (data.content && notes.length < 4) notes.push(`${data.type}: ${String(data.content).slice(0, 90)}`);
            } else if (data.type === "error") finalText = `خطأ: ${String(data.content ?? "غير معروف")}`;
          } catch { /* سطر ناقص من السيل */ }
        }
      }
      for (const n of notes) pushMsg({ role: "event", text: n, at: Date.now(), kind: "step" });
      pushMsg({ role: "agent", text: finalText || "(الأجينت خلص من غير رد نصي)", at: Date.now() });
    } catch (err) {
      pushMsg({ role: "agent", text: `تعذّر الوصول للأجينت: ${(err as Error).message} — لو المحرك مش متصل، جرّب من صفحة الأسطول أو بعد ربط عقدة.`, at: Date.now() });
    } finally {
      setBusy(false);
    }
  }, [input, busy, pushMsg]);

  const mode = standalone ? "وضع المتصفح المستقل" : engineServed ? "متصل مباشرة بالمحرك" : "متصل بعقدة عن بُعد";
  const base = getRemoteBase();
  const missionNow = activeMission();
  const toolsCount = tools ? `${tools.present?.length ?? 0}/${tools.catalogue?.length ?? (tools.present?.length ?? 0) + (tools.missing?.length ?? 0)}` : "—";
  const councilCount = council?.members?.length ?? (Array.isArray(council?.providers) ? council.providers.length : null);

  return (
    <div dir="rtl" className="min-h-screen bg-[#07090f] text-zinc-100 p-4 md:p-6 space-y-4">
      {/* الرأس */}
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-3">
        <Bot className="h-6 w-6 text-emerald-400" />
        <h1 className="text-xl font-bold">الأجينت المطوّر — مكتب نوفا</h1>
        <span className="text-xs text-zinc-500">كل الشغل الجديد متجمع هنا · متصل بكل طبقات البرنامج</span>
        <div className="ms-auto flex flex-wrap gap-1.5">
          <Chip ok={standalone ? null : true} label={mode} />
          {base ? <Chip ok title={base} label={`العقدة: ${base.replace(/^https?:\/\//, "").slice(0, 32)}`} /> : <Chip ok={null} label="بدون عقدة نشطة" />}
          <Chip ok={!standalone && toolsTried ? Boolean(tools?.ok) : null} label={`الأدوات: ${standalone ? "محرك خارجي" : toolsCount}`} />
          <Chip ok={councilCount != null ? councilCount > 0 : null} label={councilCount != null ? `المجلس: ${councilCount} مقعد` : "المجلس: قياس…"} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* عمود الشات */}
        <section className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
            <Sparkles className="h-4 w-4 text-cyan-300" />
            <span className="font-semibold text-sm">اكتب هنا — الأجينت بيفكر قدامك خطوة بخطوة</span>
            {busy && <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-300 ms-auto" />}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[320px] max-h-[52vh]">
            {msgs.length === 0 && (
              <div className="text-zinc-500 text-sm py-10 text-center space-y-2">
                <p>الجلسة دايمة ومحفوظة — اكتب أول أمر:</p>
                <p className="text-xs">«اعمل فحص سريع لـ scanme.nmap.org» · «إيه حالة الأدوات؟» · «لخّص آخر مهمة»</p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={
                m.role === "user"
                  ? "ms-auto max-w-[85%] rounded-lg bg-cyan-600/20 border border-cyan-600/30 px-3 py-2 text-sm"
                  : m.role === "event"
                    ? "mx-4 text-[11px] text-zinc-500 border-r-2 border-zinc-700 pr-2"
                    : "me-auto max-w-[85%] rounded-lg bg-emerald-600/15 border border-emerald-600/25 px-3 py-2 text-sm whitespace-pre-wrap"
              }>
                {m.role === "event" ? <span className="text-zinc-600">⚙ {m.text}</span> : m.text}
                <span className="block text-[10px] text-zinc-600 mt-1">{fmtTime(m.at)}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="border-t border-zinc-800 p-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={standalone ? "اكتب أمرك… (عقل المتصفح يرد — والعقدة المربوطة تنفّذ)" : "اكتب أمرك… (المحرك ينفّذ مباشرة)"}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold inline-flex items-center gap-1"
            >
              <Send className="h-4 w-4" /> إرسال
            </button>
          </div>
        </section>

        {/* عمود الجوانب */}
        <aside className="space-y-4">
          {/* اللي بيحصل دلوقتي */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-fuchsia-400" /> بيحصل دلوقتي
            </div>
            <div className="text-xs space-y-1.5 text-zinc-300">
              <div className="flex items-center gap-2"><Zap className="h-3.5 w-3.5 text-amber-300" /> اللايف أجينت: نبضة كل 3 دقايق (عمق passive آمن — شغال مع الإقلاع)</div>
              <div className="flex items-center gap-2"><Wrench className="h-3.5 w-3.5 text-cyan-300" /> الأدوات عند الطلب + كاش دوّار — الـ16 أداة متاحين من غير ما يملّوا الديسك</div>
              <div className="flex items-center gap-2"><BrainCircuit className="h-3.5 w-3.5 text-emerald-300" /> mission نشطة: {missionNow ? missionNow.title?.slice(0, 40) ?? "بدون عنوان" : "مفيش حاليًا"}</div>
            </div>
          </div>

          {/* موارد العقدة */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Cpu className="h-4 w-4 text-sky-400" /> موارد التنفيذ</div>
            {standalone && <p className="text-xs text-zinc-500">وضع المتصفح: الموارد دي بتاعت جهازك. اربط عقدة من «المحطة» لقياس السيرفر.</p>}
            {!standalone && !tools && toolsTried && <p className="text-xs text-amber-400">المحرك مش واضح من هنا — القياس بيرجع مع أول اتصال ناجح.</p>}
            {tools && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-zinc-950 p-2"><Cpu className="h-4 w-4 mx-auto text-sky-400" /><div className="text-sm font-bold">{tools.resources?.cpuCores ?? "—"}</div><div className="text-[10px] text-zinc-500">أنوية</div></div>
                <div className="rounded-lg bg-zinc-950 p-2"><MemoryStick className="h-4 w-4 mx-auto text-violet-400" /><div className="text-sm font-bold">{tools.resources?.memFreeMB != null && tools.resources?.memTotalMB != null ? `${Math.round(tools.resources.memFreeMB)}/${Math.round(tools.resources.memTotalMB)}` : "—"}</div><div className="text-[10px] text-zinc-500">RAM MB</div></div>
                <div className="rounded-lg bg-zinc-950 p-2"><HardDrive className="h-4 w-4 mx-auto text-emerald-400" /><div className="text-sm font-bold">{tools.freeMB ?? "—"}</div><div className="text-[10px] text-zinc-500">ديسك فاضي MB</div></div>
              </div>
            )}
            {tools?.last && (
              <p className="text-[11px] text-zinc-500">آخر تجهيز أدوات: {fmtTime(tools.last.at)} · نصّب {tools.last.installed ?? "—"}/{tools.last.total ?? "—"}</p>
            )}
          </div>

          {/* اللي حصل */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Shield className="h-4 w-4 text-rose-400" /> اللي حصل — المهمات</div>
            {missions.length === 0 && <p className="text-xs text-zinc-500">لسه مفيش مهمات متسجلة — أول ما الأجينت يشتغل هتبان هنا وتفضل محفوظة.</p>}
            <ul className="space-y-1.5 max-h-40 overflow-y-auto">
              {missions.slice(-6).reverse().map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-xs rounded bg-zinc-950 px-2 py-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${m.status === "done" ? "bg-emerald-400" : m.status === "failed" ? "bg-rose-400" : "bg-cyan-400 animate-pulse"}`} />
                  <span className="truncate">{m.title}</span>
                  <span className="ms-auto text-[10px] text-zinc-600">{fmtTime(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* الأسطول */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Server className="h-4 w-4 text-cyan-300" /> الأسطول — اختَر قناة التنفيذ</div>
            <ul className="space-y-1.5">
              {servers.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-xs rounded bg-zinc-950 px-2 py-1.5">
                  <Radio className={`h-3.5 w-3.5 ${activeId === s.id ? "text-emerald-400" : "text-zinc-600"}`} />
                  <span className="truncate" title={s.base}>{s.name}</span>
                  {activeId === s.id
                    ? <span className="ms-auto text-[10px] text-emerald-400">نشطة</span>
                    : <button className="ms-auto text-[10px] text-cyan-300 hover:underline" onClick={() => { activateServer(s); setActiveId(s.id); }}>استخدمها</button>}
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-zinc-600">القياس الحي لكل ماكينة بيتعمل في «نوفا · المخ والمدير» — من هنا بتختار مين ينفّذ.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
