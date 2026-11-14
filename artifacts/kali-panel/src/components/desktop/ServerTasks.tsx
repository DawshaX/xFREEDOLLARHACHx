/**
 * TEST9 — مهمات السيرفر (اللايف أجينت) بفروعها ودويناتها.
 * طلب المالك: «اضبطلي قسم المهمات في /agent-pro وضيف فروع جديدة وكل الي
 * عملو وبيعملو وهيعلمو». كل فعل هنا = API حقيقي + إشعار حي بـlink.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, GitBranch, Loader2, NotebookPen, Plus, RefreshCw } from "lucide-react";
import { jsonRequest, pushNotify } from "@/lib/sse";

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  progress?: number;
  createdAt?: string;
  metadata?: { parentTaskId?: string };
}
interface StepRow { id: string; title: string; status: string; description?: string }
interface Learning { id: string; title: string; content: string; kind: string }
interface Journal { ok: boolean; steps: StepRow[]; branches: Array<{ id: string; title: string; status: string }>; learnings: Learning[] }

function statusLabel(s: string): string {
  const map: Record<string, string> = { planned: "مخطّطة", pending: "معلّقة", running: "بتشتغل", done: "منجزة", completed: "منجزة", failed: "فشلت" };
  return map[s] ?? s;
}

export function ServerTasks() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [rootTasks, setRootTasks] = useState<TaskRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [journal, setJournal] = useState<Record<string, Journal>>({});
  const [branchGoal, setBranchGoal] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [newGoal, setNewGoal] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await jsonRequest<TaskRow[]>("/agent/tasks");
      setTasks(rows ?? []);
      setRootTasks((rows ?? []).filter((t) => !t.metadata?.parentTaskId));
    } catch (e) {
      pushNotify("error", "مهمات الأجينت", `التحميل فشل: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTask = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    setBusy(`journal:${id}`);
    try {
      const d = await jsonRequest<Journal>(`/agent/tasks/${id}/journal`);
      setJournal((prev) => ({ ...prev, [id]: d }));
    } catch (e) {
      pushNotify("error", "يومية المهمة", `فشل: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const addBranch = async (id: string) => {
    const goal = (branchGoal[id] ?? "").trim();
    if (!goal) return;
    setBusy(`branch:${id}`);
    try {
      const d = await jsonRequest<{ ok: boolean }>("/agent/tasks/" + id + "/branches", {
        method: "POST",
        body: JSON.stringify({ goal }),
      });
      pushNotify(d.ok ? "success" : "error", "فرع مهمة", d.ok ? `اتعمل الفرع: ${goal.slice(0, 60)}` : "فشل إنشاء الفرع");
      setBranchGoal((prev) => ({ ...prev, [id]: "" }));
      await openTaskRefresh(id);
      void load();
    } catch (e) {
      pushNotify("error", "فرع مهمة", `فشل: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const openTaskRefresh = async (id: string) => {
    try {
      const d = await jsonRequest<Journal>(`/agent/tasks/${id}/journal`);
      setJournal((prev) => ({ ...prev, [id]: d }));
    } catch { /* الحملة التانية هتجيب */ }
  };

  const addNote = async (id: string) => {
    const content = (noteText[id] ?? "").trim();
    if (!content) return;
    setBusy(`note:${id}`);
    try {
      const d = await jsonRequest<{ ok: boolean }>(`/agent/tasks/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      pushNotify(d.ok ? "success" : "error", "دوّن", d.ok ? "اتسجّل تعلّم دائم في مخ الأجينت" : "فشل التدوين");
      setNoteText((prev) => ({ ...prev, [id]: "" }));
      await openTaskRefresh(id);
    } catch (e) {
      pushNotify("error", "دوّن", `فشل: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const createTask = async () => {
    const goal = newGoal.trim();
    if (!goal) return;
    setBusy("create");
    try {
      await jsonRequest("/agent/tasks", { method: "POST", body: JSON.stringify({ goal }) });
      pushNotify("success", "مهمة جديدة", `اتسجّلت واتخطّطت خطواتها: ${goal.slice(0, 60)}`);
      setNewGoal("");
      void load();
    } catch (e) {
      pushNotify("error", "مهمة جديدة", `فشل: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const branchCount = tasks.length - rootTasks.length;

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-3 min-w-0" dir="rtl">
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-amber-300" />
        <span className="text-[11px] font-black text-amber-200">مهمات الأجينت على السيرفر — فروع ودوينات دائمة</span>
        <span className="text-[8px] font-mono text-white/40">{rootTasks.length} أصلية · {branchCount} فرع</span>
        <button onClick={() => void load()} className="ml-auto text-[10px] text-amber-300/80 hover:text-amber-200 flex items-center gap-1">
          <RefreshCw className="h-3 w-3" /> تحديث
        </button>
      </div>

      <div className="flex gap-1.5">
        <input
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          placeholder="هدف مهمة جديدة — الأجينت يخطط خطواتها على السيرفر…"
          className="flex-1 bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white/90 outline-none focus:border-amber-500/50 break-safe"
        />
        <button
          onClick={() => void createTask()}
          disabled={busy === "create" || !newGoal.trim()}
          className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-amber-500/20 border border-amber-500/40 text-amber-100 hover:bg-amber-500/30 disabled:opacity-40 flex items-center gap-1"
        >
          {busy === "create" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} مهمة
        </button>
      </div>

      {rootTasks.length === 0 && (
        <div className="text-[10px] text-white/40 py-3 text-center">مافيش مهمات على السيرفر لسه — اكتب هدف فوق والأجينت يخططه</div>
      )}

      {rootTasks.map((t) => {
        const j = journal[t.id];
        return (
          <div key={t.id} className="rounded-lg border border-white/8 bg-black/30 overflow-hidden min-w-0">
            <button onClick={() => void openTask(t.id)} className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-white/[0.04] text-right">
              {open === t.id ? <ChevronDown className="h-3 w-3 text-amber-300" /> : <ChevronLeft className="h-3 w-3 text-white/40" />}
              <span className="text-[10px] font-bold text-white/90 break-safe flex-1 min-w-0">{t.title}</span>
              <span className={`text-[8px] font-bold rounded px-1.5 py-0.5 border ${t.status === "done" || t.status === "completed" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : t.status === "running" ? "text-cyan-300 border-cyan-500/30 bg-cyan-500/10" : "text-white/50 border-white/10"}`}>
                {statusLabel(t.status)}
              </span>
              {j && j.branches.length > 0 && <span className="text-[8px] font-mono text-amber-300/80">{j.branches.length} فرع</span>}
              {j && j.learnings.length > 0 && <span className="text-[8px] font-mono text-fuchsia-300/80">{j.learnings.length} دوّن</span>}
            </button>

            {open === t.id && (
              <div className="px-2.5 pb-2.5 space-y-2 border-t border-white/5 pt-2">
                {busy === `journal:${t.id}` && !j && <div className="text-[9px] text-white/40">… بحمّل اليومية</div>}
                {j?.steps?.length ? (
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold text-white/45">الخطوات ({j.steps.length})</div>
                    {j.steps.map((s) => (
                      <div key={s.id} className="text-[9px] text-white/60 flex items-center gap-1.5">
                        <span className={s.status === "done" || s.status === "completed" ? "text-emerald-400" : "text-white/30"}>•</span>
                        <span className="break-safe">{s.title}</span>
                        <span className="text-white/30">— {statusLabel(s.status)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {j && (
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold text-amber-300/80">الفروع ({j.branches.length})</div>
                    {j.branches.map((b) => (
                      <div key={b.id} className="text-[9px] text-white/60 flex items-center gap-1.5">
                        <GitBranch className="h-2.5 w-2.5 text-amber-300/70" />
                        <span className="break-safe">{b.title}</span>
                        <span className="text-white/30">— {statusLabel(b.status)}</span>
                      </div>
                    ))}
                    <div className="flex gap-1.5 pt-1">
                      <input
                        value={branchGoal[t.id] ?? ""}
                        onChange={(e) => setBranchGoal((prev) => ({ ...prev, [t.id]: e.target.value }))}
                        placeholder="هدف فرع جديد تحت المهمة دي…"
                        className="flex-1 bg-black/50 border border-white/10 rounded-md px-2 py-1 text-[9px] text-white/85 outline-none focus:border-amber-500/40 break-safe"
                      />
                      <button
                        onClick={() => void addBranch(t.id)}
                        disabled={busy === `branch:${t.id}` || !(branchGoal[t.id] ?? "").trim()}
                        className="px-2 py-1 rounded-md text-[9px] font-black bg-amber-500/15 border border-amber-500/35 text-amber-100 disabled:opacity-40 flex items-center gap-1"
                      >
                        {busy === `branch:${t.id}` ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />} فرع
                      </button>
                    </div>
                  </div>
                )}

                {j && j.learnings.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold text-fuchsia-300/80">اللي اتدوّن وهيعلم ({j.learnings.length})</div>
                    {j.learnings.slice(0, 6).map((l) => (
                      <div key={l.id} className="text-[9px] text-white/55 break-safe">• {l.title} — {l.content.slice(0, 80)}</div>
                    ))}
                  </div>
                )}

                <div className="flex gap-1.5 pt-1">
                  <input
                    value={noteText[t.id] ?? ""}
                    onChange={(e) => setNoteText((prev) => ({ ...prev, [t.id]: e.target.value }))}
                    placeholder="دوّن هنا درس/نتيجة من المهمة دي — بيخزن في مخ الأجينت دائمًا…"
                    className="flex-1 bg-black/50 border border-white/10 rounded-md px-2 py-1 text-[9px] text-white/85 outline-none focus:border-fuchsia-500/40 break-safe"
                  />
                  <button
                    onClick={() => void addNote(t.id)}
                    disabled={busy === `note:${t.id}` || !(noteText[t.id] ?? "").trim()}
                    className="px-2 py-1 rounded-md text-[9px] font-black bg-fuchsia-500/15 border border-fuchsia-500/35 text-fuchsia-100 disabled:opacity-40 flex items-center gap-1"
                  >
                    {busy === `note:${t.id}` ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <NotebookPen className="h-2.5 w-2.5" />} دوّن
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
