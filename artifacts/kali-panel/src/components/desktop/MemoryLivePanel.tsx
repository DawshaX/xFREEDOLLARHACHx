/**
 * MemoryLivePanel — لوحة الذاكرة الحية للوكيل الذكي.
 * تعرض ما يتعلمه الوكيل في الوقت الفعلي.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Brain, Search, Pin, Trash2, Star, BookOpen, AlertTriangle, Lightbulb, User, ChevronRight, RefreshCw, Zap } from "lucide-react";
import { useSystem, type MemoryEvent } from "@/context/SystemContext";
import { jsonRequest } from "@/lib/sse";

const BASE = "/api";

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; bg: string }> = {
  fact:            { label: "حقيقة",    icon: BookOpen,      color: "text-cyan-300",    bg: "bg-cyan-500/10 border-cyan-500/30" },
  skill:           { label: "مهارة",    icon: Zap,           color: "text-yellow-300",  bg: "bg-yellow-500/10 border-yellow-500/30" },
  preference:      { label: "تفضيل",   icon: User,          color: "text-purple-300",  bg: "bg-purple-500/10 border-purple-500/30" },
  error_pattern:   { label: "خطأ",     icon: AlertTriangle, color: "text-red-300",     bg: "bg-red-500/10 border-red-500/30" },
  success_pattern: { label: "نجاح",    icon: Star,          color: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/30" },
};

function getConfig(type: string) {
  return TYPE_CONFIG[type] ?? { label: type, icon: Brain, color: "text-slate-300", bg: "bg-slate-500/10 border-slate-500/30" };
}

interface StoredMemory {
  id: number;
  memoryType: string;
  key: string;
  content: string;
  tags: string;
  context: string;
  confidence: number;
  useCount: number;
  createdAt: string;
}

export function MemoryLivePanel() {
  const { memoryEvents, systemEvents } = useSystem();
  const [tab, setTab] = useState<"live" | "all" | "stats">("live");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [allMemory, setAllMemory] = useState<StoredMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveFlash, setLiveFlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevEventsLen = useRef(0);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await jsonRequest<StoredMemory[]>(`/bot/memory${search ? `?q=${encodeURIComponent(search)}&type=${filterType === "all" ? "" : filterType}` : ""}`);
      setAllMemory(rows || []);
    } catch {
      try {
        const rows = await jsonRequest<StoredMemory[]>(`/memory`);
        setAllMemory((rows as any[]).map((r, i) => ({ id: i, memoryType: r.kind || "fact", key: r.title || "", content: r.content || "", tags: "", context: "", confidence: 1, useCount: 0, createdAt: r.createdAt })));
      } catch {}
    }
    setLoading(false);
  }, [search, filterType]);

  useEffect(() => {
    if (tab === "all" || tab === "stats") void loadAll();
  }, [tab, loadAll]);

  useEffect(() => {
    if (memoryEvents.length > prevEventsLen.current) {
      prevEventsLen.current = memoryEvents.length;
      setLiveFlash(true);
      setTimeout(() => setLiveFlash(false), 1000);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [memoryEvents.length]);

  const deleteMemory = async (id: number) => {
    try {
      await fetch(`${BASE}/bot/memory/${id}`, { method: "DELETE" });
      setAllMemory((prev) => prev.filter((m) => m.id !== id));
    } catch {}
  };

  const stats = {
    total: allMemory.length,
    facts: allMemory.filter((m) => m.memoryType === "fact").length,
    skills: allMemory.filter((m) => m.memoryType === "skill").length,
    success: allMemory.filter((m) => m.memoryType === "success_pattern").length,
    errors: allMemory.filter((m) => m.memoryType === "error_pattern").length,
    preferences: allMemory.filter((m) => m.memoryType === "preference").length,
    liveToday: memoryEvents.length,
  };

  const TABS = [
    { id: "live", label: "مباشر", count: memoryEvents.length },
    { id: "all", label: "الكل", count: allMemory.length },
    { id: "stats", label: "إحصائيات", count: null },
  ] as const;

  return (
    <div className="flex flex-col h-full bg-black/90 text-white" dir="rtl" style={{ fontFamily: "monospace" }}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-4 py-3 border-b border-purple-500/20 transition-all ${liveFlash ? "bg-purple-500/10" : "bg-black/40"}`}>
        <Brain className={`w-5 h-5 ${liveFlash ? "text-purple-400 animate-pulse" : "text-purple-500"}`} />
        <div className="flex-1">
          <div className="text-sm font-bold text-purple-300">ذاكرة Nova الحية</div>
          <div className="text-[10px] text-purple-500/70">
            {memoryEvents.length > 0 ? `${memoryEvents.length} حدث في هذه الجلسة` : "في انتظار أحداث الذاكرة…"}
          </div>
        </div>
        <div className={`w-2 h-2 rounded-full ${liveFlash ? "bg-purple-400 animate-ping" : "bg-purple-600"}`} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-purple-500/20">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-xs font-medium transition-all ${tab === t.id ? "text-purple-300 border-b-2 border-purple-500 bg-purple-500/5" : "text-slate-500 hover:text-slate-300"}`}
          >
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span className="mr-1 px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-[9px] rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* LIVE TAB */}
      {tab === "live" && (
        <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-2">
          {memoryEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center text-slate-500 gap-3">
              <Brain className="w-10 h-10 opacity-20" />
              <div className="text-sm">في انتظار تعلّم Nova…</div>
              <div className="text-xs opacity-60">كلما استخدم الوكيل أداة memory_save سيظهر هنا فوراً</div>
            </div>
          ) : (
            memoryEvents.map((ev, i) => {
              const cfg = getConfig(ev.memoryType);
              const Icon = cfg.icon;
              return (
                <div key={`${ev.id}-${i}`} className={`rounded-lg border p-2.5 ${cfg.bg} transition-all animate-in fade-in duration-300`}>
                  <div className="flex items-start gap-2">
                    <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`text-[10px] font-bold uppercase ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-[10px] text-slate-400 truncate">{ev.key}</span>
                        <span className="text-[9px] text-slate-600 mr-auto">{new Date(ev.createdAt ?? ev.ts).toLocaleTimeString("ar-SA")}</span>
                      </div>
                      <div className="text-[11px] text-slate-200 leading-relaxed">{ev.content.slice(0, 200)}</div>
                      {ev.tags && <div className="mt-1 text-[9px] text-slate-500">#{ev.tags.split(",").join(" #")}</div>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ALL TAB */}
      {tab === "all" && (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex gap-2 p-2 border-b border-purple-500/10">
            <div className="flex items-center gap-1.5 flex-1 bg-black/40 border border-purple-500/20 rounded px-2">
              <Search className="w-3 h-3 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void loadAll()}
                placeholder="ابحث في الذاكرة…"
                className="flex-1 bg-transparent text-xs text-white outline-none py-1.5"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-black/60 border border-purple-500/20 text-xs text-slate-300 rounded px-1.5 py-1"
            >
              <option value="all">الكل</option>
              {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <button onClick={() => void loadAll()} className="p-1.5 text-purple-400 hover:bg-purple-500/10 rounded">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1.5">
            {allMemory.length === 0 && !loading && (
              <div className="text-center text-slate-500 text-xs py-10">لا توجد ذكريات محفوظة بعد</div>
            )}
            {allMemory.map((m) => {
              const cfg = getConfig(m.memoryType);
              const Icon = cfg.icon;
              return (
                <div key={m.id} className={`rounded border p-2 ${cfg.bg} group`}>
                  <div className="flex items-start gap-1.5">
                    <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className={`text-[9px] font-bold ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-[9px] text-slate-400 truncate">{m.key}</span>
                        <span className="text-[8px] text-slate-600 mr-auto">{new Date(m.createdAt).toLocaleDateString("ar-SA")}</span>
                      </div>
                      <div className="text-[11px] text-slate-300 leading-relaxed">{m.content.slice(0, 150)}</div>
                    </div>
                    <button onClick={() => void deleteMemory(m.id)} className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 p-0.5 rounded transition-all">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STATS TAB */}
      {tab === "stats" && (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <button onClick={() => void loadAll()} className="flex items-center gap-2 text-xs text-purple-400 hover:text-purple-300 mb-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> تحديث
          </button>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "إجمالي الذكريات", value: stats.total, color: "text-white", bg: "bg-white/5" },
              { label: "جلسة اليوم", value: stats.liveToday, color: "text-purple-300", bg: "bg-purple-500/10" },
              { label: "حقائق", value: stats.facts, color: "text-cyan-300", bg: "bg-cyan-500/10" },
              { label: "مهارات", value: stats.skills, color: "text-yellow-300", bg: "bg-yellow-500/10" },
              { label: "نجاحات", value: stats.success, color: "text-emerald-300", bg: "bg-emerald-500/10" },
              { label: "أخطاء", value: stats.errors, color: "text-red-300", bg: "bg-red-500/10" },
            ].map((s) => (
              <div key={s.label} className={`rounded-lg border border-white/5 p-3 ${s.bg}`}>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-500 mb-2">توزيع الذاكرة</div>
            {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
              const count = allMemory.filter((m) => m.memoryType === type).length;
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              return (
                <div key={type}>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className={cfg.color}>{cfg.label}</span>
                    <span className="text-slate-500">{count} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                    <div className={`h-full ${cfg.color.replace("text-", "bg-").replace("-300", "-500")} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
