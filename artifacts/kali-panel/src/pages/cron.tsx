import { useEffect, useRef, useState } from "react";
import {
  Brain, Clock, Github, Globe, MemoryStick, Plus, Play, Trash2,
  Pause, CheckCircle2, RefreshCw, Zap, BookOpen, AlertTriangle,
  TrendingUp, Database, ChevronDown, ChevronUp, Eye, Skull,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface CronJob {
  id: number; name: string; description: string;
  cronExpression: string; prompt: string;
  isEnabled: string; lastRunAt: string | null;
  lastStatus: string; runCount: number; createdAt: string;
}
interface MemoryItem {
  id: number; memoryType: string; key: string; content: string;
  context: string; confidence: number; tags: string;
  createdAt: string; useCount: number;
}
interface KnowledgeItem {
  id: string; title: string; category: string; content: string;
  tags: string[]; createdAt: string;
}
interface IntelStats {
  totalMemories: number; totalKnowledge: number; githubPocs: number;
  threatIntel: number; cvePatterns: number; githubMemories: number;
  webIntelItems: number; totalCves: number;
  memoryByType: Array<{ memoryType: string; count: number }>;
}

const PRESETS = [
  { label: "كل ساعتين", value: "0 */2 * * *" },
  { label: "كل 6 ساعات", value: "0 */6 * * *" },
  { label: "كل 8 ساعات", value: "0 */8 * * *" },
  { label: "يومياً 8ص", value: "0 8 * * *" },
  { label: "كل 15 دقيقة", value: "*/15 * * * *" },
  { label: "أسبوعياً", value: "0 9 * * 0" },
];

const MEMORY_TYPE_LABELS: Record<string, string> = {
  cve_pattern: "نمط CVE", github_poc: "GitHub PoC", web_intel: "استخبارات ويب",
  success_pattern: "نجاح مهمة", consolidated_insight: "رؤية موحّدة",
  threat_intel: "استخبارات تهديد", daily_report: "تقرير يومي", self_heal: "إصلاح ذاتي",
};
const MEMORY_TYPE_COLOR: Record<string, string> = {
  cve_pattern: "#ff8844", github_poc: "#4488ff", web_intel: "#aa44ff",
  success_pattern: "#44ff88", consolidated_insight: "#44eebb",
  threat_intel: "#ff4444", daily_report: "#ffaa44", self_heal: "#aaaaaa",
};

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso); const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "الآن";
  if (diff < 3600_000) return `منذ ${Math.floor(diff / 60_000)} دقيقة`;
  if (diff < 86400_000) return `منذ ${Math.floor(diff / 3600_000)} ساعة`;
  return d.toLocaleDateString("ar-EG");
}

function MemoryCard({ item }: { item: MemoryItem }) {
  const [expanded, setExpanded] = useState(false);
  const color = MEMORY_TYPE_COLOR[item.memoryType] ?? "#888";
  const label = MEMORY_TYPE_LABELS[item.memoryType] ?? item.memoryType;
  const conf = item.confidence;
  const confColor = conf >= 0.9 ? "#44ff88" : conf >= 0.7 ? "#ffaa44" : "#ff4444";
  return (
    <div className="rounded-xl p-4 space-y-2 transition-all" style={{ background: "rgba(8,0,18,0.8)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14 }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded" style={{ color, background: `${color}18`, border: `1px solid ${color}35` }}>{label}</span>
        <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{fmtTime(item.createdAt)}</span>
      </div>
      <div className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{item.key.slice(0, 60)}</div>
      <div className={`text-[11px] whitespace-pre-wrap leading-relaxed ${expanded ? "" : "line-clamp-3"}`} style={{ color: "rgba(255,255,255,0.65)" }}>{item.content}</div>
      {item.content.length > 200 && (
        <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-1 text-[10px] font-mono" style={{ color: "#4488ff" }}>
          {expanded ? <><ChevronUp className="w-3 h-3" />طيّ</> : <><ChevronDown className="w-3 h-3" />اقرأ المزيد</>}
        </button>
      )}
      <div className="flex items-center justify-between text-[9px] font-mono">
        <span style={{ color: confColor }}>ثقة: {(conf * 100).toFixed(0)}%</span>
        {item.tags && <span style={{ color: "rgba(255,255,255,0.2)" }}>{item.tags.slice(0, 40)}</span>}
      </div>
    </div>
  );
}

function KnowledgeCard({ item }: { item: KnowledgeItem }) {
  const [expanded, setExpanded] = useState(false);
  const catColors: Record<string, string> = { "github-poc": "#4488ff", "threat-intel": "#ff4444", tools: "#44ff88", web: "#aa44ff", tactics: "#ff8844" };
  const color = catColors[item.category] ?? "#888";
  return (
    <div className="rounded-xl p-4 space-y-2 transition-all" style={{ background: "rgba(8,0,18,0.8)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14 }}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded" style={{ color, background: `${color}18` }}>{item.category}</span>
        <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{fmtTime(item.createdAt)}</span>
      </div>
      <div className="font-black text-sm leading-snug" style={{ color: "rgba(255,255,255,0.8)" }}>{item.title}</div>
      <div className={`text-[10px] whitespace-pre-wrap leading-relaxed ${expanded ? "" : "line-clamp-3"}`} style={{ color: "rgba(255,255,255,0.4)" }}>{item.content}</div>
      {item.content.length > 200 && (
        <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-1 text-[10px] font-mono" style={{ color: "#4488ff" }}>
          {expanded ? <><ChevronUp className="w-3 h-3" />طيّ</> : <><ChevronDown className="w-3 h-3" />اقرأ المزيد</>}
        </button>
      )}
      {item.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 5).map(t => (
            <span key={t} className="text-[8px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>#{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CronPage() {
  const [tab, setTab] = useState<"jobs" | "memory" | "github" | "intel">("jobs");
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState(""); const [desc, setDesc] = useState("");
  const [cronExpr, setCronExpr] = useState("0 */6 * * *"); const [prompt, setPrompt] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [output, setOutput] = useState<string>("");
  const outputRef = useRef<HTMLPreElement>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [stats, setStats] = useState<IntelStats | null>(null);
  const [memFilter, setMemFilter] = useState<string>("");
  const [knowledgeCat, setKnowledgeCat] = useState<string>("");
  const [triggerBusy, setTriggerBusy] = useState<string>("");

  async function loadJobs() { try { setJobs(await jsonRequest<CronJob[]>("/bot/cron")); } catch {} }
  async function loadMemories() {
    try {
      const params = new URLSearchParams({ limit: "60" });
      if (memFilter) params.set("type", memFilter);
      setMemories(await jsonRequest<MemoryItem[]>(`/intelligence/memory?${params}`));
    } catch {}
  }
  async function loadKnowledge() {
    try {
      const params = new URLSearchParams({ limit: "60" });
      if (knowledgeCat) params.set("category", knowledgeCat);
      setKnowledge(await jsonRequest<KnowledgeItem[]>(`/intelligence/knowledge?${params}`));
    } catch {}
  }
  async function loadStats() { try { setStats(await jsonRequest<IntelStats>("/intelligence/stats")); } catch {} }

  useEffect(() => {
    void loadJobs(); void loadStats();
    const t = setInterval(() => { void loadJobs(); void loadStats(); }, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { void loadMemories(); }, [memFilter]);
  useEffect(() => { void loadKnowledge(); }, [knowledgeCat]);
  useEffect(() => { if (tab === "memory") void loadMemories(); if (tab === "github") void loadKnowledge(); }, [tab]);
  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [output]);

  async function create() {
    if (!name || !cronExpr || !prompt) return;
    await jsonRequest("/bot/cron", { method: "POST", body: JSON.stringify({ name, description: desc, cronExpression: cronExpr, prompt }) });
    setName(""); setDesc(""); setPrompt(""); setShowForm(false); await loadJobs();
  }
  async function remove(id: number) {
    if (!confirm("احذف المهمة؟")) return;
    await jsonRequest(`/bot/cron/${id}`, { method: "DELETE" }); await loadJobs();
  }
  async function toggle(j: CronJob) {
    await jsonRequest(`/bot/cron/${j.id}`, { method: "PUT", body: JSON.stringify({ isEnabled: j.isEnabled === "true" ? "false" : "true" }) });
    await loadJobs();
  }
  async function trigger(id: number) {
    setBusyId(id); setOutput(`🚀 بدء تشغيل المهمة #${id}...\n`);
    try {
      const res = await fetch('/api/bot/cron/' + id + '/trigger', { method: "POST" });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value);
        const blocks = buf.split("\n\n"); buf = blocks.pop() ?? "";
        for (const blk of blocks) {
          const ev = blk.match(/event: (.+)/)?.[1]; const dat = blk.match(/data: (.+)/)?.[1];
          if (!ev || !dat) continue;
          try {
            const d = JSON.parse(dat);
            if (ev === "tool_call") setOutput(p => p + `🔧 ${d.name} ← ${JSON.stringify(d.input).slice(0, 100)}\n`);
            else if (ev === "tool_result") setOutput(p => p + `✅ ${d.name} نجح\n`);
            else if (ev === "cron_message") setOutput(p => p + `\n📝 ${d.text}\n`);
            else if (ev === "cron_completed") setOutput(p => p + `\n🏁 اكتملت المهمة\n`);
            else if (ev === "cron_error") setOutput(p => p + `\n❌ ${d.error}\n`);
          } catch {}
        }
      }
    } catch (err) { setOutput(p => p + `\n❌ ${String(err)}\n`); }
    finally { setBusyId(null); await loadJobs(); }
  }
  async function runIntelAction(action: string, label: string) {
    setTriggerBusy(action);
    try {
      const res = await jsonRequest<{ stored?: number; patternsFound?: number; consolidated?: number; updated?: number; durationMs: number }>(`/intelligence/${action}`, { method: "POST" });
      setOutput(prev => prev + `✅ ${label}: اكتملت في ${res.durationMs}ms — ${JSON.stringify(res)}\n`);
      await loadStats(); await loadMemories(); await loadKnowledge();
    } catch (err) { setOutput(prev => prev + `❌ ${label}: ${String(err)}\n`); }
    finally { setTriggerBusy(""); }
  }

  const TABS = [
    { id: "jobs" as const, label: "المهام المجدولة", icon: Clock, badge: jobs.length },
    { id: "memory" as const, label: "ذاكرة التعلم", icon: MemoryStick, badge: stats?.totalMemories },
    { id: "github" as const, label: "GitHub & استخبارات", icon: Github, badge: stats?.totalKnowledge },
    { id: "intel" as const, label: "مركز الذكاء", icon: Brain, badge: null },
  ];

  const statusColor = (s: string) => s === "success" ? "#44ff88" : s === "running" ? "#4488ff" : s === "failed" ? "#ff4444" : "#888";

  const INTEL_ACTIONS = [
    { action: "learn", label: "محلل الثغرات الذكي", desc: "يحلل آخر الثغرات ويكتشف أنماط الهجوم ويخزن الرؤى في الذاكرة.", icon: TrendingUp, color: "#ff8844", rgb: "255,136,68", sub: "يعمل كل ساعتين تلقائياً", btnLabel: "تشغيل الآن" },
    { action: "github-scan", label: "صياد PoC GitHub", desc: "يبحث في GitHub عن مستودعات PoC وexploit للثغرات الحرجة ويحفظها.", icon: Github, color: "#4488ff", rgb: "68,136,255", sub: "يعمل كل 6 ساعات تلقائياً", btnLabel: "فحص GitHub الآن" },
    { action: "web-crawl", label: "زاحف الاستخبارات", desc: "يجمع آخر التهديدات من CISA KEV وقواعد البيانات الأمنية.", icon: Globe, color: "#aa44ff", rgb: "170,68,255", sub: "يعمل كل 12 ساعة تلقائياً", btnLabel: "فحص المصادر الآن" },
    { action: "consolidate", label: "موحّد الذاكرة", desc: "يدمج الذكريات المتشابهة في رؤى موحدة ويحذف التكرار.", icon: MemoryStick, color: "#44eebb", rgb: "68,238,187", sub: "يعمل يومياً تلقائياً", btnLabel: "توحيد الذاكرة الآن" },
    { action: "classify-cves", label: "مصنّف الثغرات العميق", desc: "يصنف الثغرات غير المصنفة حسب نمط الهجوم (RCE, SQLi, XSS…)", icon: Eye, color: "#ffaa44", rgb: "255,170,68", sub: "يعمل كل 4 ساعات تلقائياً", btnLabel: "تصنيف الآن" },
  ];

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ مركز التعلم الذكي"
        subtitle="Cron Jobs + Nova Learner — ذاكرة تعلم آلي، فحص GitHub، استخبارات أمنية"
        icon={Brain} danger
        actions={
          <div className="flex gap-2">
            {tab === "jobs" && (
              <button onClick={() => setShowForm(s => !s)}
                className="px-3 py-1.5 rounded-xl font-black text-[10px] font-mono flex items-center gap-1.5 transition-all"
                style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff5555" }}>
                <Plus className="w-3.5 h-3.5" />مهمة جديدة
              </button>
            )}
            <button onClick={() => { void loadJobs(); void loadStats(); void loadMemories(); void loadKnowledge(); }}
              className="p-1.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "إجمالي الذاكرة", value: stats.totalMemories, icon: MemoryStick, color: "#44eebb", rgb: "68,238,187" },
            { label: "قاعدة المعرفة", value: stats.totalKnowledge, icon: BookOpen, color: "#aa44ff", rgb: "170,68,255" },
            { label: "مستودعات GitHub", value: stats.githubPocs, icon: Github, color: "#4488ff", rgb: "68,136,255" },
            { label: "أنماط الثغرات", value: stats.cvePatterns, icon: TrendingUp, color: "#ff8844", rgb: "255,136,68" },
          ].map(({ label, value, icon: Icon, color, rgb }) => (
            <div key={label} className="rounded-xl p-4 flex flex-col gap-1"
              style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
              <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: `rgba(${rgb},0.7)` }}>
                <Icon className="w-3.5 h-3.5" />{label}
              </div>
              <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 10px rgba(${rgb},0.4)` }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-4 py-2.5 text-[11px] font-black font-mono rounded-t-xl transition-all"
              style={active
                ? { background: "rgba(255,30,30,0.08)", borderBottom: "2px solid #ff5555", color: "#ff5555" }
                : { color: "rgba(255,255,255,0.3)", borderBottom: "2px solid transparent" }}>
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.badge != null && (
                <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}>{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── JOBS TAB ─── */}
      {tab === "jobs" && (
        <div className="space-y-4">
          {showForm && (
            <div className="rounded-2xl p-5 space-y-3" style={{ background: "rgba(255,30,30,0.04)", border: "1px solid rgba(255,30,30,0.2)", borderRadius: 16 }}>
              <div className="font-black text-sm" style={{ color: "#ff5555" }}>إضافة مهمة مجدولة جديدة</div>
              <input placeholder="اسم المهمة" style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
              <input placeholder="وصف (اختياري)" style={inputStyle} value={desc} onChange={e => setDesc(e.target.value)} />
              <div className="space-y-2">
                <input placeholder="0 */6 * * *" style={{ ...inputStyle, fontFamily: "monospace" }} value={cronExpr} onChange={e => setCronExpr(e.target.value)} />
                <div className="flex gap-2 flex-wrap">
                  {PRESETS.map(p => (
                    <button key={p.value} onClick={() => setCronExpr(p.value)}
                      className="text-[9px] font-black font-mono px-2.5 py-1 rounded-xl transition-all"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: cronExpr === p.value ? "#ff5555" : "rgba(255,255,255,0.4)" }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea placeholder="ما يجب أن يفعله البوت — مثال: ابحث عن آخر CVEs الحرجة وخزّن النتائج في الذاكرة"
                style={{ ...inputStyle, minHeight: 100, resize: "vertical" }} value={prompt} onChange={e => setPrompt(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={create}
                  className="px-4 py-2 rounded-xl font-black text-xs font-mono transition-all"
                  style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff5555" }}>حفظ المهمة</button>
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-xl font-black text-xs font-mono transition-all"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>إلغاء</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {jobs.length === 0 ? (
              <div className="lg:col-span-2 rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
                <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد مهام مجدولة. انتظر بضع ثوان لبدء المهام الذكية تلقائياً.</p>
              </div>
            ) : jobs.map(j => {
              const sc = statusColor(j.lastStatus);
              const isRunning = busyId === j.id;
              return (
                <div key={j.id} className="rounded-xl p-4 space-y-3 transition-all"
                  style={{ background: isRunning ? "rgba(255,30,30,0.05)" : "rgba(8,0,18,0.85)", border: isRunning ? "1px solid rgba(255,30,30,0.3)" : "1px solid rgba(255,255,255,0.06)", borderRadius: 16 }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 font-black text-sm">
                        {j.isEnabled === "true"
                          ? <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "#44ff88" }} />
                          : <Pause className="w-4 h-4 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />}
                        <span className="truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{j.name}</span>
                      </div>
                      {j.description && <div className="text-[10px] font-mono mt-1 line-clamp-1" style={{ color: "rgba(255,255,255,0.3)" }}>{j.description}</div>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => trigger(j.id)} disabled={busyId !== null}
                        className="p-1.5 rounded-lg transition-all disabled:opacity-50"
                        style={{ background: "rgba(68,255,136,0.08)", border: "1px solid rgba(68,255,136,0.2)", color: "#44ff88" }}>
                        {isRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => toggle(j)}
                        className="p-1.5 rounded-lg transition-all"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)" }}>
                        {j.isEnabled === "true" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => remove(j.id)}
                        className="p-1.5 rounded-lg transition-all"
                        style={{ background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.15)", color: "#ff4444" }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[9px] font-black font-mono">
                    <span className="px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>{j.cronExpression}</span>
                    <span className="px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)" }}>▶ {j.runCount} مرة</span>
                    {j.lastStatus && (
                      <span className="px-2 py-0.5 rounded" style={{ color: sc, background: `${sc}15`, border: `1px solid ${sc}35` }}>{j.lastStatus}</span>
                    )}
                    {j.lastRunAt && (
                      <span className="px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.3)" }}>{fmtTime(j.lastRunAt)}</span>
                    )}
                  </div>
                  <div className="rounded-xl p-2 font-mono text-[10px] line-clamp-2 leading-relaxed"
                    style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)" }}>
                    {j.prompt.slice(0, 150)}{j.prompt.length > 150 ? "…" : ""}
                  </div>
                </div>
              );
            })}
          </div>

          {output && (
            <div className="rounded-2xl p-4 space-y-2" style={{ background: "rgba(0,0,0,0.7)", border: "1px solid rgba(68,255,136,0.15)", borderRadius: 16 }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono flex items-center gap-2" style={{ color: "rgba(68,255,136,0.7)" }}>
                  <Zap className="w-3.5 h-3.5" />مخرجات التنفيذ المباشر
                </span>
                <button onClick={() => setOutput("")} className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>مسح</button>
              </div>
              <pre ref={outputRef} className="text-[11px] font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed" style={{ color: "#44ff88", scrollbarWidth: "thin" }}>{output}</pre>
            </div>
          )}
        </div>
      )}

      {/* ─── MEMORY TAB ─── */}
      {tab === "memory" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {["", "cve_pattern", "github_poc", "web_intel", "success_pattern", "consolidated_insight", "threat_intel", "daily_report"].map(t => {
              const color = MEMORY_TYPE_COLOR[t] ?? "#888";
              const active = memFilter === t;
              return (
                <button key={t} onClick={() => setMemFilter(t)}
                  className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
                  style={active ? { background: `${color}15`, border: `1px solid ${color}45`, color } : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                  {t === "" ? "الكل" : (MEMORY_TYPE_LABELS[t] ?? t)}
                </button>
              );
            })}
            <button onClick={loadMemories} className="p-1.5 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          {stats?.memoryByType && stats.memoryByType.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {stats.memoryByType.map(m => {
                const color = MEMORY_TYPE_COLOR[m.memoryType] ?? "#888";
                return (
                  <div key={m.memoryType} className="flex items-center gap-2 text-[9px] font-black font-mono px-2 py-1 rounded-lg"
                    style={{ color, background: `${color}12`, border: `1px solid ${color}30` }}>
                    <span>{MEMORY_TYPE_LABELS[m.memoryType] ?? m.memoryType}</span>
                    <span>{m.count}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {memories.length === 0 ? (
              <div className="lg:col-span-2 rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
                <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد إدخالات في الذاكرة. ابدأ دورة التعلم من تبويب "مركز الذكاء".</p>
              </div>
            ) : memories.map(m => <MemoryCard key={m.id} item={m} />)}
          </div>
        </div>
      )}

      {/* ─── GITHUB TAB ─── */}
      {tab === "github" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {["", "github-poc", "threat-intel", "tools", "web", "tactics"].map(c => {
              const catColors: Record<string, string> = { "github-poc": "#4488ff", "threat-intel": "#ff4444", tools: "#44ff88", web: "#aa44ff", tactics: "#ff8844" };
              const color = catColors[c] ?? "#888";
              const active = knowledgeCat === c;
              return (
                <button key={c} onClick={() => setKnowledgeCat(c)}
                  className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
                  style={active ? { background: `${color}15`, border: `1px solid ${color}45`, color } : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                  {c === "" ? "الكل" : c}
                </button>
              );
            })}
            <button onClick={loadKnowledge} className="p-1.5 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: "GitHub PoC", value: stats?.githubPocs ?? 0, color: "#4488ff", rgb: "68,136,255" },
              { label: "استخبارات تهديد", value: stats?.threatIntel ?? 0, color: "#ff4444", rgb: "255,68,68" },
              { label: "إجمالي المعرفة", value: stats?.totalKnowledge ?? 0, color: "#aa44ff", rgb: "170,68,255" },
            ].map(({ label, value, color, rgb }) => (
              <div key={label} className="rounded-xl p-3" style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.2)`, borderRadius: 14 }}>
                <div className="text-[9px] font-mono" style={{ color: `rgba(${rgb},0.6)` }}>{label}</div>
                <div className="text-xl font-black font-mono" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {knowledge.length === 0 ? (
              <div className="lg:col-span-2 rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
                <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
                <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد نتائج. شغّل "صياد GitHub PoC" من مركز الذكاء لجمع البيانات.</p>
              </div>
            ) : knowledge.map(k => <KnowledgeCard key={k.id} item={k} />)}
          </div>
        </div>
      )}

      {/* ─── INTEL TAB ─── */}
      {tab === "intel" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {INTEL_ACTIONS.map(({ action, label, desc, icon: Icon, color, rgb, sub, btnLabel }) => (
              <div key={action} className="rounded-xl p-5 space-y-3 transition-all"
                style={{ background: `rgba(${rgb},0.04)`, border: `1px solid rgba(${rgb},0.2)`, borderRadius: 16 }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `rgba(${rgb},0.15)` }}>
                    <Icon className="w-5 h-5" style={{ color }} />
                  </div>
                  <div>
                    <div className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{label}</div>
                    <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{sub}</div>
                  </div>
                </div>
                <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{desc}</p>
                <button onClick={() => runIntelAction(action, label)} disabled={triggerBusy === action}
                  className="w-full py-2 rounded-xl font-black text-xs font-mono flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.3)`, color }}>
                  {triggerBusy === action ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {btnLabel}
                </button>
              </div>
            ))}
            <div className="rounded-xl p-5 space-y-3 transition-all"
              style={{ background: "rgba(68,255,136,0.05)", border: "1px solid rgba(68,255,136,0.25)", borderRadius: 16 }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(68,255,136,0.15)" }}>
                  <Zap className="w-5 h-5" style={{ color: "#44ff88" }} />
                </div>
                <div>
                  <div className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>دورة تعلم كاملة</div>
                  <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>تشغيل جميع المحركات دفعة واحدة</div>
                </div>
              </div>
              <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>تشغيل محلل الثغرات + صياد GitHub + زاحف الويب + موحّد الذاكرة.</p>
              <button disabled={triggerBusy !== ""}
                onClick={async () => {
                  for (const [action, label] of [["learn","محلل الثغرات"],["github-scan","صياد GitHub"],["web-crawl","زاحف الويب"],["consolidate","موحّد الذاكرة"]] as const) {
                    await runIntelAction(action, label);
                  }
                }}
                className="w-full py-2 rounded-xl font-black text-xs font-mono flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ background: "rgba(68,255,136,0.15)", border: "1px solid rgba(68,255,136,0.4)", color: "#44ff88" }}>
                <Zap className="w-3.5 h-3.5" />تشغيل الكل
              </button>
            </div>
          </div>

          {output && (
            <div className="rounded-2xl p-4 space-y-2" style={{ background: "rgba(0,0,0,0.7)", border: "1px solid rgba(68,255,136,0.15)", borderRadius: 16 }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono flex items-center gap-2" style={{ color: "rgba(68,255,136,0.7)" }}>
                  <Brain className="w-3.5 h-3.5" />سجل عمليات التعلم
                </span>
                <button onClick={() => setOutput("")} className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>مسح</button>
              </div>
              <pre ref={outputRef} className="text-[11px] font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed" style={{ color: "#44ff88", scrollbarWidth: "thin" }}>{output}</pre>
            </div>
          )}

          {stats && (
            <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
              <div className="font-black text-sm flex items-center gap-2" style={{ color: "#ff5555" }}>
                <Database className="w-4 h-4" />إحصاء شامل للذكاء المكتسب
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                {[
                  { label: "إجمالي CVEs", value: stats.totalCves.toLocaleString(), color: "#ff4444" },
                  { label: "ذاكرة التعلم", value: stats.totalMemories, color: "#44eebb" },
                  { label: "استخبارات ويب", value: stats.webIntelItems, color: "#aa44ff" },
                  { label: "GitHub PoC", value: stats.githubMemories, color: "#4488ff" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
                    <div className="font-black font-mono text-lg" style={{ color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
