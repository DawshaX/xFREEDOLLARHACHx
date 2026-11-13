import React, { useCallback, useEffect, useRef, useState } from "react";
import { Activity, BellRing, BrainCircuit, CheckCircle2, Clock4, Compass, Lightbulb, ListTodo, Radar, RefreshCw, Sparkles } from "lucide-react";
import { novaAuthHeaders } from "@/lib/ops-client";

/**
 * AgentCommandDeck — «لوحة القيادة الموحّدة» للوكيل الحي.
 *
 * طلب المالك (TEST2-4): «تبويب للسجل اللحظي + لوحة تحكم فيها كل الشغل، اللي حصل
 * وبيحصل وهيحصل، المنجز واللي لسه، الخطط، اللي اتعلمه، فهمه ليا، وتحليل كل حاجة
 * — مدموجة مع المخ وكل البرنامج».
 *
 * كل بطاقة تحت بتقرأ من مصدر حيّ موجود فعلاً على السيرفر (ولا بطاقة فيها رقم
 * مكتوب): /agent/tasks · /autonomous/tasks · /memory/stats? · /notifications ·
 * /live-agent/status · /nova-core/awareness · /ops/corpus. أي مصدر فشل بيظهر
 * «غير متاح» بدل رقم مزيّف.
 */

const API = "/api";

interface AgentTaskRow {
  id: number;
  title?: string;
  description?: string;
  status?: string;
  createdAt?: string;
}
interface CronRow {
  id: number | string;
  name?: string;
  cronExpression?: string;
  isEnabled?: string | boolean;
  lastRunAt?: string | null;
  lastStatus?: string;
  runCount?: number;
}
interface NotifRow {
  id: number | string;
  title?: string;
  body?: string;
  kind?: string;
  read?: boolean;
  source?: string;
  createdAt?: string;
}
interface LiveStatus {
  toolsCount?: number;
  memoryCount?: number;
  backgroundFeedCount?: number;
  activeSessions?: number;
  agentConnected?: boolean;
  resources?: { diskFreeGb?: number | null; diskTotalGb?: number | null };
  platform?: { corpus?: { total?: number | null; measured?: boolean }; cronEnabled?: boolean };
}
interface Awareness {
  [k: string]: unknown;
}
interface MemRow {
  key?: string;
  title?: string;
  content?: string;
  memoryType?: string;
  kind?: string;
  ts?: number;
}

function fmtWhen(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { headers: novaAuthHeaders() });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const cardCls = "rounded-xl border border-white/8 bg-white/[0.03] p-3 min-w-0";
const headCls = "flex items-center justify-between mb-2";

export function AgentCommandDeck() {
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [aware, setAware] = useState<Awareness | null>(null);
  const [tasks, setTasks] = useState<AgentTaskRow[] | null>(null);
  const [crons, setCrons] = useState<CronRow[] | null>(null);
  const [notifs, setNotifs] = useState<NotifRow[] | null>(null);
  const [memCount, setMemCount] = useState<number | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [memories, setMemories] = useState<MemRow[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const [lv, aw, tk, cr, nf, mem] = await Promise.all([
      getJson<LiveStatus>("/live-agent/status"),
      getJson<Awareness>("/nova-core/awareness"),
      getJson<AgentTaskRow[]>("/agent/tasks"),
      getJson<CronRow[]>("/autonomous/tasks"),
      getJson<NotifRow[]>("/notifications"),
      getJson<MemRow[]>("/memory"),
    ]);
    setLive(lv);
    setAware(aw);
    setTasks(Array.isArray(tk) ? tk : tk === null ? null : []);
    setCrons(Array.isArray(cr) ? cr : cr === null ? null : []);
    setNotifs(Array.isArray(nf) ? nf : nf === null ? null : []);
    if (Array.isArray(mem)) {
      setMemCount(mem.length);
      setMemories(mem.slice(0, 6));
    }
    setFetchedAt(new Date());
  }, []);

  useEffect(() => {
    void load();
    timer.current = setInterval(() => void load(), 15_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const doneTasks = (tasks ?? []).filter((t) => (t.status ?? "").toLowerCase() === "done" || t.status === "completed");
  const pendingTasks = (tasks ?? []).filter((t) => !doneTasks.includes(t));
  const enabledCrons = (crons ?? []).filter((c) => c.isEnabled === true || c.isEnabled === "true");
  const unread = (notifs ?? []).filter((n) => n.read === false);

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3" dir="rtl" data-testid="agent-command-deck">
      {/* شريط الحالة العلوي */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-cyan-400/15 bg-cyan-500/5 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-bold text-cyan-200">
          <Compass className="w-4 h-4" />
          لوحة القيادة الموحّدة — اللي حصل وبيحصل وهيحصل
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
          <span>{fetchedAt ? `آخر قياس ${fetchedAt.toLocaleTimeString("ar")}` : "…"}</span>
          <button onClick={() => void load()} className="px-2 py-0.5 rounded border border-cyan-400/30 text-cyan-300 hover:bg-cyan-500/10 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> تحديث
          </button>
        </div>
      </div>

      {/* أرقام حية سريعة */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className={cardCls}>
          <div className={headCls}><span className="text-[10px] text-muted-foreground">الأدوات الحقيقية</span><Activity className="w-3.5 h-3.5 text-emerald-400" /></div>
          <div className="text-xl font-black text-emerald-300">{live?.toolsCount ?? "…"}</div>
          <div className="text-[9px] text-muted-foreground mt-1">{live?.agentConnected ? "وكيل متصل ✓" : live ? "الوكيل غير متصل" : "في الانتظار"}</div>
        </div>
        <div className={cardCls}>
          <div className={headCls}><span className="text-[10px] text-muted-foreground">الكوربوس</span><Radar className="w-3.5 h-3.5 text-rose-400" /></div>
          <div className="text-xl font-black text-rose-300">{(live?.platform?.corpus?.total ?? null)?.toLocaleString("en-US") ?? "…"}</div>
          <div className="text-[9px] text-muted-foreground mt-1">{live?.platform?.corpus?.measured ? "مقاس من الملف" : "غير مقاس"}</div>
        </div>
        <div className={cardCls}>
          <div className={headCls}><span className="text-[10px] text-muted-foreground">الذاكرة والتعلّم</span><BrainCircuit className="w-3.5 h-3.5 text-violet-400" /></div>
          <div className="text-xl font-black text-violet-300">{live?.memoryCount ?? memCount ?? "…"}</div>
          <div className="text-[9px] text-muted-foreground mt-1">ذكرى محفوظة (تنجو من الريستارت)</div>
        </div>
        <div className={cardCls}>
          <div className={headCls}><span className="text-[10px] text-muted-foreground">القرص بلا حد</span><Sparkles className="w-3.5 h-3.5 text-amber-400" /></div>
          <div className="text-xl font-black text-amber-300">{live?.resources?.diskFreeGb != null ? `${live.resources.diskFreeGb} GB` : "…"}</div>
          <div className="text-[9px] text-muted-foreground mt-1">فاضل من إجمالي {live?.resources?.diskTotalGb ?? "…"} GB</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* المهام: المنجزة + اللي لسه */}
        <div className={cardCls}>
          <div className={headCls}>
            <span className="text-[11px] font-bold text-emerald-200 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> المهام — منجزة / قيد التنفيذ / خطط</span>
            <span className="text-[9px] font-mono text-muted-foreground">{tasks === null ? "غير متاح" : `${doneTasks.length} منجزة · ${pendingTasks.length} شغالة`}</span>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {tasks === null && <div className="text-[10px] text-muted-foreground">مصدر المهام غير متاح (لا DB) — لكن مهام الكرون والوكيل الحي شغالة تحت.</div>}
            {(tasks ?? []).slice(0, 8).map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-[10px] px-2 py-1.5 rounded bg-black/20 border border-white/5">
                <span className={`w-1.5 h-1.5 rounded-full ${doneTasks.includes(t) ? "bg-emerald-400" : t.status === "failed" ? "bg-rose-400" : "bg-amber-400 animate-pulse"}`} />
                <span className="flex-1 truncate text-foreground/90">{t.title ?? t.description ?? `#${t.id}`}</span>
                <span className="text-[8px] font-mono text-muted-foreground">{t.status ?? "?"}</span>
              </div>
            ))}
            {(tasks ?? []).length === 0 && tasks !== null && <div className="text-[10px] text-muted-foreground">مفيش مهام مسجلة بعد — اطلب من الوكيل هدف وهيتسجل هنا.</div>}
          </div>
          {/* مهام الكرون */}
          <div className="mt-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-amber-200 flex items-center gap-1"><Clock4 className="w-3 h-3" /> مهام مجدولة (بتشتغل في الخلفية)</span>
              <span className="text-[8px] font-mono text-muted-foreground">{crons === null ? "غير متاح" : `${enabledCrons.length} مفعّلة من ${crons.length}`}</span>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {(crons ?? []).map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-[9px] px-2 py-1 rounded bg-black/15 border border-white/5">
                  <span className={`w-1.5 h-1.5 rounded-full ${c.isEnabled === true || c.isEnabled === "true" ? "bg-emerald-400" : "bg-muted"}`} />
                  <span className="flex-1 truncate">{c.name ?? `#${c.id}`}</span>
                  <span className="font-mono text-muted-foreground">{c.cronExpression ?? ""}</span>
                  <span className="font-mono text-muted-foreground">{fmtWhen(c.lastRunAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* مركز الإشعارات */}
        <div className={cardCls}>
          <div className={headCls}>
            <span className="text-[11px] font-bold text-sky-200 flex items-center gap-1"><BellRing className="w-3.5 h-3.5" /> مركز الإشعارات — مهم ومختصر</span>
            <span className="text-[9px] font-mono text-muted-foreground">{notifs === null ? "غير متاح" : `${unread.length} غير مقروءة`}</span>
          </div>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {notifs === null && <div className="text-[10px] text-muted-foreground">المصدر غير متاح الآن.</div>}
            {(notifs ?? []).slice(0, 12).map((n) => (
              <div key={n.id} className={`px-2 py-1.5 rounded border text-[10px] ${n.read === false ? "border-sky-400/30 bg-sky-500/8" : "border-white/5 bg-black/20 opacity-70"}`}>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sky-200 truncate flex-1">{n.title ?? "إشعار"}</span>
                  <span className="text-[8px] font-mono text-muted-foreground shrink-0">{fmtWhen(n.createdAt)}</span>
                </div>
                {n.body && <div className="text-[9px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>}
              </div>
            ))}
            {(notifs ?? []).length === 0 && notifs !== null && <div className="text-[10px] text-muted-foreground">مفيش إشعارات — كل حاجة هادية ✓</div>}
          </div>
          <div className="text-[8px] text-muted-foreground mt-2">القاعدة: المهم بس هو اللي يظهر هنا عشان ميتشتتش شغلك — التفاصيل في السجل اللحظي.</div>
        </div>
      </div>

      {/* التعلم الذاتي */}
      <div className={cardCls}>
        <div className={headCls}>
          <span className="text-[11px] font-bold text-violet-200 flex items-center gap-1"><Lightbulb className="w-3.5 h-3.5" /> اللي اتعلمه الوكيل (ذاكرة حديثة)</span>
          <span className="text-[9px] font-mono text-muted-foreground">{memCount !== null ? `${memCount} ذكرى` : ""}</span>
        </div>
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {memories.length === 0 && <div className="text-[10px] text-muted-foreground">مفيش عينة ذاكرة — شغّل الوكيل على هدف وأول ما ينجح/يفشل حاجة هيحفظها هنا.</div>}
          {memories.map((m, i) => (
            <div key={`${m.key ?? i}-${i}`} className="text-[10px] px-2 py-1.5 rounded bg-black/20 border border-violet-400/10">
              <span className="text-violet-300 font-mono">{m.key ?? m.title ?? "ذكرى"}</span>
              {m.ts ? <span className="text-muted-foreground/60 font-mono"> · {new Date(m.ts).toLocaleTimeString("ar")}</span> : null}
              <div className="text-foreground/85 mt-0.5">{String(m.content ?? "").slice(0, 180)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* الوعي/الفهم */}
      {aware && (
        <div className={cardCls}>
          <div className={headCls}>
            <span className="text-[11px] font-bold text-cyan-200 flex items-center gap-1"><ListTodo className="w-3.5 h-3.5" /> فهم الوكيل (وعي الخلفية)</span>
          </div>
          <pre className="text-[9px] font-mono text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto" dir="ltr">{JSON.stringify(aware, null, 2).slice(0, 2000)}</pre>
        </div>
      )}
    </div>
  );
}

export default AgentCommandDeck;
