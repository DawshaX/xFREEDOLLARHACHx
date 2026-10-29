import { useState, useCallback, useEffect, useRef } from "react";
import {
  Target, Plus, Trash2, ChevronRight, Flag, Clock,
  CheckCircle, XCircle, AlertCircle, Shield, Zap, Eye,
  FileText, Terminal, Tag, Edit3, Save, X, Download,
  RefreshCw, Loader2, ChevronDown, ChevronUp, Copy,
  Crosshair, Map, Skull, Activity, Network, Lock,
  Search, BookOpen, Layers, BarChart2, Info, Flame,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = (p: string) => `/api${p}`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Finding {
  id: number; type: string; title: string; severity: string;
  detail: string; tool?: string; raw?: string; ts: string;
}
interface MissionCmd { cmd: string; output: string; ts: string; }
interface Mission {
  id: number; name: string; target: string; objective: string;
  phase: string; status: string; createdAt: string; updatedAt: string;
  findings: Finding[]; commands: MissionCmd[]; notes: string; tags: string[];
  findingCount?: number; commandCount?: number;
}

const PHASES = [
  { id: "reconnaissance",  label: "Reconnaissance",  color: "#06b6d4", icon: Eye },
  { id: "scanning",        label: "Scanning",         color: "#8b5cf6", icon: Network },
  { id: "exploitation",    label: "Exploitation",     color: "#f59e0b", icon: Zap },
  { id: "post-exploitation",label: "Post-Exploitation",color: "#ef4444", icon: Skull },
  { id: "reporting",       label: "Reporting",        color: "#10b981", icon: FileText },
];

const SEVERITIES = [
  { id: "critical", label: "Critical", color: "#ef4444" },
  { id: "high",     label: "High",     color: "#f97316" },
  { id: "medium",   label: "Medium",   color: "#f59e0b" },
  { id: "low",      label: "Low",      color: "#06b6d4" },
  { id: "info",     label: "Info",     color: "#6b7280" },
];

const FINDING_TYPES = [
  "vulnerability", "open-port", "service", "credential", "path",
  "misconfig", "sqli", "xss", "rce", "lfi", "ssrf", "xxe", "info",
];

function severityColor(s: string) {
  return SEVERITIES.find(x => x.id === s)?.color ?? "#6b7280";
}
function phaseColor(p: string) {
  return PHASES.find(x => x.id === p)?.color ?? "#ff3355";
}
function statusIcon(s: string) {
  if (s === "active") return <Activity className="w-3 h-3 text-emerald-400" />;
  if (s === "completed") return <CheckCircle className="w-3 h-3 text-blue-400" />;
  if (s === "paused") return <Clock className="w-3 h-3 text-amber-400" />;
  if (s === "failed") return <XCircle className="w-3 h-3 text-red-400" />;
  return <Info className="w-3 h-3 text-gray-400" />;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MissionTracker() {
  const [missions, setMissions]       = useState<Mission[]>([]);
  const [selected, setSelected]       = useState<Mission | null>(null);
  const [loading, setLoading]         = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [view, setView]               = useState<"list" | "detail" | "new">("list");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue]   = useState("");
  const [newFinding, setNewFinding]   = useState(false);
  const [findingForm, setFindingForm] = useState<Partial<Finding>>({ severity: "medium", type: "vulnerability" });
  const [search, setSearch]           = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedFinding, setExpandedFinding] = useState<number | null>(null);
  const [tab, setTab]                 = useState<"findings" | "commands" | "notes">("findings");

  const [newForm, setNewForm] = useState({
    name: "", target: "", objective: "", phase: "reconnaissance", tags: "",
  });

  const fetchMissions = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(API("/missions"));
      if (r.ok) setMissions(await r.json() as Mission[]);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const r = await fetch(API(`/missions/${id}`));
      if (r.ok) {
        const m = await r.json() as Mission;
        setSelected(m);
        setNotesValue(m.notes ?? "");
      }
    } catch { /* ignore */ }
    setDetailLoading(false);
  }, []);

  useEffect(() => { void fetchMissions(); }, [fetchMissions]);

  const createMission = async () => {
    if (!newForm.name.trim() || !newForm.target.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(API("/missions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newForm.name, target: newForm.target,
          objective: newForm.objective, phase: newForm.phase,
          tags: newForm.tags.split(",").map(t => t.trim()).filter(Boolean),
        }),
      });
      if (r.ok) {
        const m = await r.json() as Mission;
        await fetchMissions();
        setNewForm({ name: "", target: "", objective: "", phase: "reconnaissance", tags: "" });
        setView("detail");
        setSelected(m);
        setNotesValue("");
        setTab("findings");
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const updateMission = async (id: number, patch: Partial<Mission>) => {
    try {
      const r = await fetch(API(`/missions/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        const m = await r.json() as Mission;
        setSelected(m);
        setMissions(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
      }
    } catch { /* ignore */ }
  };

  const deleteMission = async (id: number) => {
    try {
      await fetch(API(`/missions/${id}`), { method: "DELETE" });
      setMissions(prev => prev.filter(x => x.id !== id));
      if (selected?.id === id) { setSelected(null); setView("list"); }
    } catch { /* ignore */ }
  };

  const addFinding = async () => {
    if (!selected || !findingForm.title?.trim()) return;
    try {
      const r = await fetch(API(`/missions/${selected.id}/findings`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(findingForm),
      });
      if (r.ok) {
        await fetchDetail(selected.id);
        setNewFinding(false);
        setFindingForm({ severity: "medium", type: "vulnerability" });
      }
    } catch { /* ignore */ }
  };

  const removeFinding = async (fid: number) => {
    if (!selected) return;
    try {
      await fetch(API(`/missions/${selected.id}/findings/${fid}`), { method: "DELETE" });
      await fetchDetail(selected.id);
    } catch { /* ignore */ }
  };

  const saveNotes = async () => {
    if (!selected) return;
    await updateMission(selected.id, { notes: notesValue });
    setEditingNotes(false);
  };

  const exportReport = () => {
    if (!selected) return;
    const lines = [
      `# Mission Report — ${selected.name}`,
      `Target: ${selected.target}`,
      `Objective: ${selected.objective}`,
      `Phase: ${selected.phase}`,
      `Status: ${selected.status}`,
      `Created: ${new Date(selected.createdAt).toLocaleString()}`,
      "",
      `## Findings (${selected.findings.length})`,
      ...selected.findings.map(f =>
        `### [${f.severity.toUpperCase()}] ${f.title}\nType: ${f.type}\nTool: ${f.tool ?? "manual"}\n${f.detail}\n`
      ),
      "",
      `## Commands (${selected.commands.length})`,
      ...selected.commands.map(c => `$ ${c.cmd}\n${c.output}\n`),
      "",
      "## Notes",
      selected.notes ?? "",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mission-${selected.id}-report.txt`;
    a.click();
  };

  const filtered = missions.filter(m => {
    if (filterStatus !== "all" && m.status !== filterStatus) return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase()) &&
        !m.target.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // ── Summary stats ──────────────────────────────────────────────────────────
  const statsAll = {
    total: missions.length,
    active: missions.filter(m => m.status === "active").length,
    completed: missions.filter(m => m.status === "completed").length,
    findings: missions.reduce((acc, m) => acc + (m.findingCount ?? m.findings?.length ?? 0), 0),
    critical: missions.reduce((acc, m) =>
      acc + (m.findings?.filter(f => f.severity === "critical").length ?? 0), 0),
  };

  return (
    <div className="flex h-full min-h-0" style={{ background: "rgba(2,0,6,0.98)", color: "#e2e8f0" }}>

      {/* ── Left Panel: Mission List ── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r min-h-0"
        style={{ borderColor: "rgba(255,30,60,0.2)", background: "rgba(4,0,10,0.95)" }}>

        {/* Header */}
        <div className="shrink-0 px-3 pt-3 pb-2 border-b" style={{ borderColor: "rgba(255,30,60,0.15)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Crosshair className="w-4 h-4" style={{ color: "#ff3355" }} />
            <span className="font-mono font-black text-sm tracking-widest" style={{ color: "#ff3355" }}>
              MISSIONS
            </span>
            <span className="ms-auto text-[9px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(255,50,80,0.1)", color: "#ff3355", border: "1px solid rgba(255,50,80,0.25)" }}>
              {missions.length}
            </span>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-1 mb-2">
            {[
              { label: "كل", val: statsAll.total, color: "#ff3355" },
              { label: "نشط", val: statsAll.active, color: "#34d399" },
              { label: "اكتمل", val: statsAll.completed, color: "#60a5fa" },
              { label: "نتائج", val: statsAll.findings, color: "#f59e0b" },
            ].map(s => (
              <div key={s.label} className="rounded-lg p-1.5 text-center border" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                <div className="font-mono font-black text-sm" style={{ color: s.color }}>{s.val}</div>
                <div className="text-[8px] text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="بحث..." dir="rtl"
              className="w-full bg-transparent border rounded-lg pl-7 pr-2 py-1 text-[10px] font-mono outline-none"
              style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} />
          </div>

          {/* Filter */}
          <div className="flex gap-1 flex-wrap">
            {["all","active","completed","paused"].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border transition"
                style={{
                  background: filterStatus === s ? "rgba(255,50,80,0.15)" : "transparent",
                  borderColor: filterStatus === s ? "rgba(255,50,80,0.4)" : "rgba(255,255,255,0.08)",
                  color: filterStatus === s ? "#ff3355" : "rgba(255,255,255,0.3)",
                }}>
                {s === "all" ? "الكل" : s === "active" ? "نشط" : s === "completed" ? "مكتمل" : "موقوف"}
              </button>
            ))}
          </div>
        </div>

        {/* Mission list */}
        <div className="flex-1 overflow-y-auto min-h-0 py-1.5 px-2 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-8 text-gray-600 text-[11px]">
              <Target className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>لا مهام بعد</p>
            </div>
          )}
          {filtered.map(m => {
            const ph = PHASES.find(p => p.id === m.phase);
            const PhIcon = ph?.icon ?? Target;
            const isActive = selected?.id === m.id;
            return (
              <button key={m.id}
                onClick={() => { setView("detail"); setSelected(m); void fetchDetail(m.id); }}
                className="w-full text-left rounded-xl p-2.5 border transition-all"
                style={{
                  background: isActive ? "rgba(255,50,80,0.1)" : "rgba(255,255,255,0.02)",
                  borderColor: isActive ? "rgba(255,50,80,0.35)" : "rgba(255,255,255,0.06)",
                }}>
                <div className="flex items-center gap-1.5 mb-1">
                  {statusIcon(m.status)}
                  <span className="font-mono font-bold text-[11px] text-white/90 truncate">{m.name}</span>
                </div>
                <div className="flex items-center gap-1 text-[9px] font-mono text-gray-500">
                  <PhIcon className="w-2.5 h-2.5" style={{ color: ph?.color }} />
                  <span style={{ color: ph?.color }}>{ph?.label ?? m.phase}</span>
                  <span>·</span>
                  <span className="text-cyan-500/60">{m.target}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[8px] font-mono text-amber-400/60">
                    {(m.findingCount ?? m.findings?.length ?? 0)} نتيجة
                  </span>
                  <span className="text-[8px] text-gray-600">
                    {new Date(m.updatedAt).toLocaleDateString("ar")}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* New mission button */}
        <div className="shrink-0 p-2 border-t" style={{ borderColor: "rgba(255,30,60,0.15)" }}>
          <button
            onClick={() => setView("new")}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-[11px] font-mono font-bold transition"
            style={{ background: "rgba(255,50,80,0.08)", borderColor: "rgba(255,50,80,0.3)", color: "#ff3355" }}>
            <Plus className="w-3.5 h-3.5" />
            مهمة جديدة
          </button>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* ── NEW MISSION FORM ── */}
        {view === "new" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-xl mx-auto">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,50,80,0.1)", border: "1px solid rgba(255,50,80,0.3)" }}>
                  <Plus className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h2 className="font-mono font-black text-base text-white">مهمة اختراق جديدة</h2>
                  <p className="text-[10px] text-gray-500">حدد الهدف والغاية قبل البدء</p>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  { label: "اسم المهمة", key: "name", placeholder: "مثال: فحص شبكة المكتب", required: true },
                  { label: "الهدف (Target)", key: "target", placeholder: "192.168.1.0/24 أو example.com", required: true },
                  { label: "الغاية (Objective)", key: "objective", placeholder: "اكتشاف الثغرات في الشبكة الداخلية..." },
                  { label: "تاغات (Tags)", key: "tags", placeholder: "internal, network, web (مفصولة بفاصلة)" },
                ].map(field => (
                  <div key={field.key}>
                    <label className="block text-[10px] font-mono text-gray-400 mb-1.5">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    <input
                      value={newForm[field.key as keyof typeof newForm]}
                      onChange={e => setNewForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      dir="auto"
                      className="w-full bg-transparent border rounded-xl px-3 py-2.5 text-[11px] font-mono outline-none"
                      style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }}
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-[10px] font-mono text-gray-400 mb-1.5">المرحلة الأولى</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PHASES.map(p => {
                      const Icon = p.icon;
                      return (
                        <button key={p.id} onClick={() => setNewForm(prev => ({ ...prev, phase: p.id }))}
                          className="flex flex-col items-center gap-1 p-2.5 rounded-xl border transition"
                          style={{
                            background: newForm.phase === p.id ? `rgba(${p.color.replace("#","").match(/.{2}/g)!.map(x => parseInt(x,16)).join(",")},0.1)` : "transparent",
                            borderColor: newForm.phase === p.id ? p.color + "55" : "rgba(255,255,255,0.08)",
                          }}>
                          <Icon className="w-4 h-4" style={{ color: p.color }} />
                          <span className="text-[9px] font-mono" style={{ color: p.color }}>{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={createMission} disabled={!newForm.name || !newForm.target || loading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-mono font-bold text-[12px] transition disabled:opacity-40"
                    style={{ background: "rgba(255,50,80,0.15)", border: "1px solid rgba(255,50,80,0.4)", color: "#ff3355" }}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                    إنشاء المهمة
                  </button>
                  <button onClick={() => setView("list")}
                    className="px-4 rounded-xl border text-[12px] font-mono transition"
                    style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
                    إلغاء
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── MISSION DETAIL ── */}
        {view === "detail" && selected && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

            {/* Detail Header */}
            <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b"
              style={{ borderColor: "rgba(255,30,60,0.2)", background: "rgba(8,0,14,0.9)" }}>
              <div>
                <div className="flex items-center gap-2">
                  {statusIcon(selected.status)}
                  <h2 className="font-mono font-black text-sm text-white">{selected.name}</h2>
                  {selected.tags.map(t => (
                    <span key={t} className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border"
                      style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
                      {t}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500 mt-0.5">
                  <span className="text-cyan-400/70">{selected.target}</span>
                  <span>·</span>
                  <span style={{ color: phaseColor(selected.phase) }}>{selected.phase}</span>
                  <span>·</span>
                  <span>{new Date(selected.updatedAt).toLocaleString("ar")}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="ms-auto flex items-center gap-1.5">
                {/* Phase selector */}
                <select value={selected.phase}
                  onChange={e => void updateMission(selected.id, { phase: e.target.value })}
                  className="text-[9px] font-mono px-2 py-1 rounded-lg border outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }}>
                  {PHASES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {/* Status selector */}
                <select value={selected.status}
                  onChange={e => void updateMission(selected.id, { status: e.target.value })}
                  className="text-[9px] font-mono px-2 py-1 rounded-lg border outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }}>
                  {["active","paused","completed","failed"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={exportReport}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[9px] font-mono transition"
                  style={{ borderColor: "rgba(16,185,129,0.3)", color: "#34d399", background: "rgba(16,185,129,0.05)" }}>
                  <Download className="w-3 h-3" />تقرير
                </button>
                <button onClick={() => deleteMission(selected.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[9px] font-mono transition"
                  style={{ borderColor: "rgba(239,68,68,0.3)", color: "#f87171", background: "rgba(239,68,68,0.05)" }}>
                  <Trash2 className="w-3 h-3" />حذف
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="shrink-0 flex items-center gap-0.5 px-3 py-1.5 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              {[
                { id: "findings", label: `نتائج (${selected.findings.length})`, icon: Shield },
                { id: "commands", label: `أوامر (${selected.commands.length})`, icon: Terminal },
                { id: "notes",    label: "ملاحظات", icon: BookOpen },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-mono transition"
                  style={{
                    background: tab === t.id ? "rgba(255,50,80,0.1)" : "transparent",
                    border: `1px solid ${tab === t.id ? "rgba(255,50,80,0.3)" : "transparent"}`,
                    color: tab === t.id ? "#ff3355" : "rgba(255,255,255,0.3)",
                  }}>
                  <t.icon className="w-3 h-3" />
                  {t.label}
                </button>
              ))}

              {/* Severity summary pills */}
              {tab === "findings" && selected.findings.length > 0 && (
                <div className="ms-auto flex gap-1">
                  {SEVERITIES.filter(s => selected.findings.some(f => f.severity === s.id)).map(s => {
                    const cnt = selected.findings.filter(f => f.severity === s.id).length;
                    return (
                      <span key={s.id} className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border"
                        style={{ borderColor: s.color + "44", color: s.color, background: s.color + "11" }}>
                        {cnt} {s.label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-3 min-h-0">
              {detailLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
                </div>
              )}

              {!detailLoading && tab === "findings" && (
                <div className="space-y-2">
                  {/* Add finding button */}
                  {!newFinding && (
                    <button onClick={() => setNewFinding(true)}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-[11px] font-mono transition mb-3"
                      style={{ borderColor: "rgba(255,50,80,0.2)", color: "rgba(255,50,80,0.6)", background: "rgba(255,50,80,0.04)" }}>
                      <Plus className="w-3.5 h-3.5" />
                      إضافة نتيجة
                    </button>
                  )}

                  {/* New finding form */}
                  {newFinding && (
                    <div className="rounded-2xl border p-4 mb-3 space-y-3"
                      style={{ background: "rgba(255,50,80,0.05)", borderColor: "rgba(255,50,80,0.25)" }}>
                      <div className="flex items-center gap-2 text-[11px] font-mono text-red-400 font-bold mb-1">
                        <Shield className="w-3.5 h-3.5" />
                        نتيجة جديدة
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-mono text-gray-500 mb-1">العنوان *</label>
                          <input value={findingForm.title ?? ""}
                            onChange={e => setFindingForm(p => ({ ...p, title: e.target.value }))}
                            placeholder="مثال: SQL Injection في /login"
                            className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none"
                            style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} />
                        </div>
                        <div>
                          <label className="block text-[9px] font-mono text-gray-500 mb-1">الأداة</label>
                          <input value={findingForm.tool ?? ""}
                            onChange={e => setFindingForm(p => ({ ...p, tool: e.target.value }))}
                            placeholder="nmap, nikto, manual..."
                            className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none"
                            style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-mono text-gray-500 mb-1">الخطورة</label>
                          <div className="flex gap-1 flex-wrap">
                            {SEVERITIES.map(s => (
                              <button key={s.id} onClick={() => setFindingForm(p => ({ ...p, severity: s.id }))}
                                className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border transition"
                                style={{
                                  background: findingForm.severity === s.id ? s.color + "22" : "transparent",
                                  borderColor: findingForm.severity === s.id ? s.color + "55" : "rgba(255,255,255,0.08)",
                                  color: findingForm.severity === s.id ? s.color : "rgba(255,255,255,0.3)",
                                }}>
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-[9px] font-mono text-gray-500 mb-1">النوع</label>
                          <select value={findingForm.type ?? "vulnerability"}
                            onChange={e => setFindingForm(p => ({ ...p, type: e.target.value }))}
                            className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none"
                            style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0", background: "rgba(0,0,0,0.5)" }}>
                            {FINDING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[9px] font-mono text-gray-500 mb-1">التفاصيل</label>
                        <textarea value={findingForm.detail ?? ""}
                          onChange={e => setFindingForm(p => ({ ...p, detail: e.target.value }))}
                          placeholder="وصف الثغرة، مكانها، كيفية استغلالها..."
                          rows={3} dir="auto"
                          className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none resize-none"
                          style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }} />
                      </div>
                      <div>
                        <label className="block text-[9px] font-mono text-gray-500 mb-1">المخرجات الخام (Raw Output)</label>
                        <textarea value={findingForm.raw ?? ""}
                          onChange={e => setFindingForm(p => ({ ...p, raw: e.target.value }))}
                          placeholder="الصق مخرجات الأداة هنا..."
                          rows={2} dir="ltr"
                          className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none resize-none"
                          style={{ borderColor: "rgba(255,255,255,0.1)", color: "#86efac" }} />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setNewFinding(false); setFindingForm({ severity: "medium", type: "vulnerability" }); }}
                          className="px-3 py-1.5 rounded-lg border text-[10px] font-mono"
                          style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
                          إلغاء
                        </button>
                        <button onClick={addFinding} disabled={!findingForm.title?.trim()}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[10px] font-mono font-bold transition disabled:opacity-40"
                          style={{ background: "rgba(255,50,80,0.1)", borderColor: "rgba(255,50,80,0.35)", color: "#ff3355" }}>
                          <Plus className="w-3 h-3" />
                          حفظ النتيجة
                        </button>
                      </div>
                    </div>
                  )}

                  {selected.findings.length === 0 && !newFinding && (
                    <div className="text-center py-10 text-gray-600">
                      <Shield className="w-10 h-10 mx-auto mb-2 opacity-20" />
                      <p className="text-[11px]">لا توجد نتائج بعد — أضف أول نتيجة</p>
                    </div>
                  )}

                  {selected.findings.map(f => (
                    <div key={f.id} className="rounded-2xl border overflow-hidden"
                      style={{ borderColor: severityColor(f.severity) + "33", background: "rgba(0,0,0,0.25)" }}>
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: severityColor(f.severity) }} />
                        <span className="font-mono font-bold text-[11px] text-white/90 flex-1">{f.title}</span>
                        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border shrink-0"
                          style={{ borderColor: severityColor(f.severity) + "44", color: severityColor(f.severity) }}>
                          {f.severity}
                        </span>
                        {f.tool && (
                          <span className="text-[8px] font-mono text-gray-500 shrink-0">{f.tool}</span>
                        )}
                        <button onClick={() => setExpandedFinding(expandedFinding === f.id ? null : f.id)}
                          className="text-gray-600 hover:text-gray-400 shrink-0">
                          {expandedFinding === f.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        <button onClick={() => removeFinding(f.id)} className="text-gray-700 hover:text-red-500 shrink-0 transition">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      {expandedFinding === f.id && (
                        <div className="px-3 pb-3 space-y-2 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                          {f.detail && (
                            <p className="text-[10px] text-gray-300/80 pt-2 leading-relaxed">{f.detail}</p>
                          )}
                          {f.raw && (
                            <div className="relative">
                              <pre className="text-[9px] font-mono text-green-300/70 bg-black/30 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                                {f.raw}
                              </pre>
                              <button onClick={() => navigator.clipboard?.writeText(f.raw ?? "").catch(() => {})}
                                className="absolute top-1 right-1 text-gray-600 hover:text-gray-400">
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          <div className="text-[8px] font-mono text-gray-600">
                            {f.type} · {new Date(f.ts).toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!detailLoading && tab === "commands" && (
                <div className="space-y-2">
                  {selected.commands.length === 0 && (
                    <div className="text-center py-10 text-gray-600">
                      <Terminal className="w-10 h-10 mx-auto mb-2 opacity-20" />
                      <p className="text-[11px]">لا أوامر مسجّلة — الأوامر تُسجَّل تلقائياً من Local Control</p>
                    </div>
                  )}
                  {selected.commands.map((c, i) => (
                    <div key={i} className="rounded-xl border p-3 font-mono"
                      style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}>
                      <div className="text-[10px] text-cyan-300 mb-1.5 font-bold">$ {c.cmd}</div>
                      <pre className="text-[9px] text-green-300/70 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">{c.output}</pre>
                      <div className="text-[8px] text-gray-600 mt-1">{new Date(c.ts).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}

              {!detailLoading && tab === "notes" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-mono text-gray-400">ملاحظات المهمة</span>
                    {!editingNotes ? (
                      <button onClick={() => setEditingNotes(true)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[9px] font-mono transition"
                        style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
                        <Edit3 className="w-3 h-3" />
                        تحرير
                      </button>
                    ) : (
                      <div className="flex gap-1">
                        <button onClick={saveNotes}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[9px] font-mono transition"
                          style={{ borderColor: "rgba(16,185,129,0.3)", color: "#34d399" }}>
                          <Save className="w-3 h-3" />
                          حفظ
                        </button>
                        <button onClick={() => { setEditingNotes(false); setNotesValue(selected.notes ?? ""); }}
                          className="px-2.5 py-1 rounded-lg border text-[9px] font-mono"
                          style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)" }}>
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  {editingNotes ? (
                    <textarea
                      value={notesValue}
                      onChange={e => setNotesValue(e.target.value)}
                      rows={16} dir="auto"
                      placeholder="سجّل ملاحظاتك هنا: مسار الهجوم، الأفكار، الخطوات القادمة..."
                      className="w-full bg-transparent border rounded-xl px-3 py-2.5 text-[11px] font-mono outline-none resize-none"
                      style={{ borderColor: "rgba(255,255,255,0.1)", color: "#e2e8f0" }}
                    />
                  ) : (
                    <div className="border rounded-xl p-4 min-h-32"
                      style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)" }}>
                      {selected.notes ? (
                        <p className="text-[11px] font-mono text-gray-300/80 leading-relaxed whitespace-pre-wrap">{selected.notes}</p>
                      ) : (
                        <p className="text-[11px] text-gray-600 italic">لا توجد ملاحظات — اضغط تحرير للكتابة</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── EMPTY STATE ── */}
        {view === "list" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-5">
            <div className="relative">
              <Crosshair className="w-20 h-20 text-gray-800" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Flame className="w-8 h-8 text-red-900/50" />
              </div>
            </div>
            <div className="text-center">
              <h3 className="font-mono font-black text-base text-gray-600 mb-1">Mission Tracker</h3>
              <p className="text-[11px] text-gray-700 max-w-xs">
                سجّل مهام الاختراق، وتتبع النتائج والثغرات، واستخرج تقارير احترافية
              </p>
            </div>
            <button onClick={() => setView("new")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-mono font-bold text-[12px] transition"
              style={{ background: "rgba(255,50,80,0.1)", border: "1px solid rgba(255,50,80,0.3)", color: "#ff3355" }}>
              <Plus className="w-4 h-4" />
              ابدأ مهمة جديدة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
