import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain, Database, Download, Search, Pin, PinOff, Trash2, Plus,
  RefreshCw, AlertTriangle, CheckCircle2, Loader2, HardDrive,
  FileText, BookMarked, MessagesSquare, Lightbulb, SlidersHorizontal,
  Upload, X, ChevronRight, Sparkles, ShieldCheck,
} from "lucide-react";

/* ── API ──────────────────────────────────────────────────────────────────── */

const API = "/api/nova-core";

type Kind = "fact" | "preference" | "lesson" | "event" | "session";

interface MemoryRecord {
  id: string;
  kind: Kind;
  scope: string;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  hits: number;
  lastUsedAt: string | null;
}

interface Stats {
  total: number;
  byKind: Record<Kind, number>;
  scopes: Array<{ scope: string; count: number }>;
  pinned: number;
  file: string;
  bytes: number;
  lastWriteError: string | null;
  oldest: string | null;
  newest: string | null;
}

const KIND_META: Record<Kind, { label: string; icon: typeof Brain; color: string }> = {
  fact: { label: "حقيقة", icon: ShieldCheck, color: "#22d3ee" },
  preference: { label: "تفضيل", icon: SlidersHorizontal, color: "#a78bfa" },
  lesson: { label: "درس", icon: Lightbulb, color: "#fbbf24" },
  event: { label: "حدث", icon: BookMarked, color: "#34d399" },
  session: { label: "جلسة", icon: MessagesSquare, color: "#f472b6" },
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "الآن";
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ساعة`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} يوم`;
  return `${Math.floor(d / 30)} شهر`;
}

function bytes(n: number): string {
  return n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1048576).toFixed(1)}MB`;
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function NovaMemory() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [sort, setSort] = useState<"recent" | "important">("recent");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ title: "", content: "", kind: "fact" as Kind, scope: "", importance: 7 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (kind !== "all") params.set("kind", kind);
      params.set("sort", sort);
      const [listRes, statsRes] = await Promise.all([
        fetch(`${API}/memory?${params}`),
        fetch(`${API}/memory/stats`),
      ]);
      if (!listRes.ok || !statsRes.ok) throw new Error(`HTTP ${listRes.status}/${statsRes.status}`);
      const list = (await listRes.json()) as { total: number; items: MemoryRecord[] };
      setItems(list.items ?? []);
      setTotal(list.total ?? 0);
      setStats((await statsRes.json()) as Stats);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kind, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      void load();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/memory/search?q=${encodeURIComponent(q)}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { hits: MemoryRecord[] };
      setItems(json.hits ?? []);
      setTotal(json.hits?.length ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, load]);

  const act = useCallback(
    async (id: string, fn: () => Promise<void>) => {
      setBusyId(id);
      try {
        await fn();
        await load();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const togglePin = (m: MemoryRecord) =>
    act(m.id, async () => {
      await fetch(`${API}/memory/${m.id}/pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !m.pinned }),
      });
    });

  const remove = (m: MemoryRecord) =>
    act(m.id, async () => {
      await fetch(`${API}/memory/${m.id}`, { method: "DELETE" });
    });

  const add = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, scope: draft.scope || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft({ title: "", content: "", kind: "fact", scope: "", importance: 7 });
      setShowAdd(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const res = await fetch(`${API}/memory/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const kindCounts = useMemo(() => stats?.byKind ?? { fact: 0, preference: 0, lesson: 0, event: 0, session: 0 }, [stats]);

  return (
    <div dir="rtl" className="min-h-screen bg-[#050208] px-3 py-5 text-white sm:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* header */}
        <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/40 bg-violet-400/10">
            <Brain className="h-5 w-5 text-violet-300" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold">
              ذاكرة نوفا طويلة الأمد
              <span className="rounded border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-200">
                على القرص
              </span>
            </h1>
            <p className="text-xs text-white/50">
              كل حاجة هنا بتفضل بعد إعادة التشغيل — نوفا بتفتكرها في كل محادثة جديدة.
            </p>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-white/70 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> تحديث
            </button>
            <a
              href={`${API}/memory/export`}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-white/70 hover:text-white"
            >
              <Download className="h-3.5 w-3.5" /> نسخة احتياطية
            </a>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-white/70 hover:text-white">
              <Upload className="h-3.5 w-3.5" /> استيراد
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                }}
              />
            </label>
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100"
            >
              <Plus className="h-3.5 w-3.5" /> ذكرى جديدة
            </button>
          </div>
        </header>

        {/* stats strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[10px] text-white/40">إجمالي الذكريات</p>
            <p className="text-xl font-bold text-white">{stats?.total ?? "—"}</p>
          </div>
          {(Object.keys(KIND_META) as Kind[]).map((k) => {
            const meta = KIND_META[k];
            const Icon = meta.icon;
            return (
              <button
                key={k}
                onClick={() => {
                  setKind(kind === k ? "all" : k);
                  setQuery("");
                }}
                className={`rounded-xl border p-3 text-start transition ${
                  kind === k ? "border-white/30 bg-white/[0.06]" : "border-white/10 bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <p className="flex items-center gap-1 text-[10px] text-white/40">
                  <Icon className="h-3 w-3" style={{ color: meta.color }} /> {meta.label}
                </p>
                <p className="text-xl font-bold" style={{ color: meta.color }}>
                  {kindCounts[k]}
                </p>
              </button>
            );
          })}
        </div>

        {/* storage info */}
        {stats && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] text-white/45">
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" /> {bytes(stats.bytes)} على القرص
            </span>
            <span className="flex items-center gap-1">
              <Pin className="h-3 w-3" /> {stats.pinned} مثبتة
            </span>
            {stats.oldest && <span>أقدم: {ago(stats.oldest)}</span>}
            <span dir="ltr" className="truncate text-white/25">
              {stats.file}
            </span>
            {stats.lastWriteError ? (
              <span className="flex items-center gap-1 text-red-300">
                <AlertTriangle className="h-3 w-3" /> خطأ كتابة: {stats.lastWriteError}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> الكتابة سليمة
              </span>
            )}
          </div>
        )}

        {/* search + sort */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void search()}
              placeholder="دوّر في ذاكرة نوفا… (نفس محرك البحث اللي بتستخدمه)"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 pe-9 text-sm outline-none placeholder:text-white/30 focus:border-violet-400/50"
            />
          </div>
          <button
            onClick={() => void search()}
            className="rounded-xl border border-violet-400/40 bg-violet-500/20 px-3 py-2 text-xs font-semibold text-violet-100"
          >
            بحث بالصلة
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "recent" | "important")}
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/70 outline-none"
          >
            <option value="recent">الأحدث</option>
            <option value="important">الأهم</option>
          </select>
        </div>

        {error && (
          <p className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}

        {/* add form */}
        {showAdd && (
          <div className="space-y-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.04] p-3">
            <div className="flex flex-wrap gap-2">
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="العنوان (مثال: برنامج HackerOne اسمه acme)"
                className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/50"
              />
              <input
                value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                placeholder="النطاق (اختياري: example.com)"
                className="w-48 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/50"
              />
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none"
              >
                {(Object.keys(KIND_META) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_META[k].label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={10}
                value={draft.importance}
                onChange={(e) => setDraft({ ...draft, importance: Number(e.target.value) })}
                className="w-20 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none"
              />
            </div>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={3}
              placeholder="المحتوى…"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/50"
            />
            <div className="flex gap-2">
              <button onClick={() => void add()} className="rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100">
                حفظ
              </button>
              <button onClick={() => setShowAdd(false)} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/60">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* list */}
        <div className="space-y-2">
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.02] py-12 text-center">
              <Database className="h-8 w-8 text-white/20" />
              <p className="text-sm text-white/50">
                {query ? "مفيش ذكرى مطابقة" : "الذاكرة فاضية — كلم نوفا في /nova-core وهيبدأ يتعلم"}
              </p>
            </div>
          )}

          {items.map((m) => {
            const meta = KIND_META[m.kind] ?? KIND_META.fact;
            const Icon = meta.icon;
            const open = openId === m.id;
            return (
              <article
                key={m.id}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20"
              >
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: meta.color }} />
                  <button onClick={() => setOpenId(open ? null : m.id)} className="min-w-0 flex-1 text-start">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white/90">
                      {m.pinned && <Pin className="h-3 w-3 text-amber-300" />}
                      {m.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-white/40">
                      <span style={{ color: meta.color }}>{meta.label}</span>
                      <span>· {m.scope}</span>
                      <span>· أهمية {m.importance}/10</span>
                      <span>· {ago(m.updatedAt)}</span>
                      {m.hits > 0 && <span>· استُخدمت {m.hits} مرة</span>}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => void togglePin(m)}
                      title={m.pinned ? "إلغاء التثبيت" : "تثبيت"}
                      className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:text-amber-300"
                    >
                      {m.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => void remove(m)}
                      title="حذف"
                      className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:text-red-300"
                    >
                      {busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => setOpenId(open ? null : m.id)}
                      className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:text-white"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 transition ${open ? "rotate-90" : ""}`} />
                    </button>
                  </div>
                </div>

                {open ? (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/50 p-2 text-[11px] leading-relaxed text-white/70">
                    {m.content}
                  </pre>
                ) : (
                  <p className="mt-1 line-clamp-2 ps-6 text-xs text-white/55">{m.content}</p>
                )}

                {open && m.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 ps-6">
                    {m.tags.map((t) => (
                      <span key={t} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {total > items.length && (
          <p className="pb-6 text-center text-[11px] text-white/35">
            بتشوف {items.length} من {total} — استخدم البحث أو الفلاتر
          </p>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 pb-4 text-[10px] text-white/25">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" /> التخزين: ملف JSON على القرص بكتابة ذرّية (tmp + rename)
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> نوفا بتضيف ذكريات تلقائياً بعد كل تشغيل
          </span>
        </footer>
      </div>
    </div>
  );
}
