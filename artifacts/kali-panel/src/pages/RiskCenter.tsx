import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, AlertTriangle, TrendingUp, Zap, Brain, RefreshCw,
  ExternalLink, Target, Activity, Database, CheckCircle, Skull
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `/api${p}`;

interface RiskScore {
  rs: {
    cveId: string; riskScore: number; riskLabel: string; cvss: number;
    epssScore: number; isInKev: boolean; hasPublicExploit: boolean; hasPoc: boolean;
    aiSummary: string; aiTarget: string; aiPayload: string; aiRemediation: string;
    affectedAssets: string[]; lastUpdated: string;
  };
  description: string; publishedAt: string; source: string; url: string;
}

interface RiskStats {
  byLabel: Array<{ riskLabel: string; count: number }>;
  inKev: number; withExploit: number;
  topRisk: RiskScore[];
  ollama: { available: boolean; models: string[] };
}

const LABEL_STYLE: Record<string, { color: string; bg: string; border: string; glow: string }> = {
  CRITICAL: { color: "#ff4444", bg: "rgba(255,30,30,0.1)", border: "rgba(255,30,30,0.4)", glow: "0 0 10px rgba(255,0,0,0.2)" },
  HIGH:     { color: "#ff8844", bg: "rgba(255,120,0,0.08)", border: "rgba(255,100,0,0.35)", glow: "0 0 8px rgba(255,100,0,0.15)" },
  MEDIUM:   { color: "#ffaa44", bg: "rgba(255,160,0,0.07)", border: "rgba(255,150,0,0.3)", glow: "" },
  LOW:      { color: "#44cc88", bg: "rgba(0,200,100,0.07)", border: "rgba(0,200,100,0.25)", glow: "" },
};

const NEON_CARD = {
  background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)",
  borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04), inset 0 0 30px rgba(0,0,0,0.3)",
};

export default function RiskCenter() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "top" | "kev" | "ai">("overview");

  const { data: stats, isLoading: statsLoading } = useQuery<RiskStats>({
    queryKey: ["risk-stats"],
    queryFn: () => fetch(api("/risk/stats")).then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: topData, isLoading: topLoading } = useQuery<{ results: RiskScore[] }>({
    queryKey: ["risk-top"],
    queryFn: () => fetch(api("/risk/top?limit=50")).then(r => r.json()),
    enabled: tab === "top",
  });

  const { data: kevData, isLoading: kevLoading } = useQuery<{ kev: RiskScore[] }>({
    queryKey: ["risk-kev"],
    queryFn: () => fetch(api("/risk/kev")).then(r => r.json()),
    enabled: tab === "kev",
  });

  const scoreMut = useMutation({
    mutationFn: () => fetch(api("/risk/score-batch"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 500 }) }).then(r => r.json()),
    onSuccess: (d) => { toast({ title: "✅ تم التقييم", description: d.message }); qc.invalidateQueries({ queryKey: ["risk-stats"] }); qc.invalidateQueries({ queryKey: ["risk-top"] }); },
    onError: () => toast({ title: "خطأ", description: "فشل التقييم", variant: "destructive" }),
  });

  const llmMut = useMutation({
    mutationFn: () => fetch(api("/risk/analyze-llm"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 15 }) }).then(r => r.json()),
    onSuccess: (d) => { toast({ title: "🧠 Llama3 انتهى", description: d.message }); qc.invalidateQueries({ queryKey: ["risk-top"] }); },
    onError: () => toast({ title: "خطأ", description: "Llama3 غير متاح", variant: "destructive" }),
  });

  const osvMut = useMutation({
    mutationFn: () => fetch(api("/osv/sync"), { method: "POST" }).then(r => r.json()),
    onSuccess: (d) => { toast({ title: "📦 OSV مزامنة", description: d.message }); },
    onError: () => toast({ title: "خطأ", description: "فشلت مزامنة OSV", variant: "destructive" }),
  });

  const byLabel = stats?.byLabel ?? [];
  const totalScored = byLabel.reduce((s, l) => s + (l.count ?? 0), 0);
  const criticalCount = byLabel.find(l => l.riskLabel === "CRITICAL")?.count ?? 0;
  const highCount     = byLabel.find(l => l.riskLabel === "HIGH")?.count ?? 0;

  const TABS = [
    { id: "overview", label: "نظرة عامة", sym: "◈", icon: Activity },
    { id: "top",      label: "أعلى المخاطر", sym: "☠", icon: TrendingUp },
    { id: "kev",      label: "CISA KEV", sym: "⚡", icon: AlertTriangle },
    { id: "ai",       label: "Llama3 AI", sym: "⚔", icon: Brain },
  ];

  function Badge({ label }: { label: string }) {
    const s = LABEL_STYLE[label] ?? LABEL_STYLE.LOW;
    return (
      <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
        style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
        {label}
      </span>
    );
  }

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">

      {/* ── Header ── */}
      <div className="rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4" style={NEON_CARD}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,rgba(255,30,30,0.3),rgba(255,100,0,0.2))", border: "1px solid rgba(255,50,0,0.4)", boxShadow: "0 0 20px rgba(255,0,0,0.2)" }}>
            <Skull className="w-6 h-6" style={{ color: "#ff4444", filter: "drop-shadow(0 0 6px rgba(255,50,50,1))" }} />
          </div>
          <div>
            <h1 className="text-lg font-black" style={{ color: "#ff4444", textShadow: "0 0 15px rgba(255,0,0,0.6)" }}>
              ☠ مركز المخاطر الذكي
            </h1>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
              Risk Engine · CISA KEV · Llama3 local · OSV Database
            </p>
          </div>
          {/* Ollama pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono"
            style={stats?.ollama?.available
              ? { background: "rgba(0,255,100,0.06)", border: "1px solid rgba(0,255,100,0.2)", color: "#44ff88" }
              : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
            <Brain className="w-3 h-3" />
            {stats?.ollama?.available ? "Llama3 ✓" : "Llama3 ✗"}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => osvMut.mutate()} disabled={osvMut.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold font-mono transition-all"
            style={{ background: "rgba(0,150,255,0.08)", border: "1px solid rgba(0,150,255,0.25)", color: "#4488ff" }}>
            {osvMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
            مزامنة OSV
          </button>
          <button onClick={() => scoreMut.mutate()} disabled={scoreMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-black font-mono transition-all"
            style={{ background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.45)", color: "#ff4444", boxShadow: "0 0 15px rgba(255,0,0,0.1)" }}>
            {scoreMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            تشغيل محرك المخاطر
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black font-mono transition-all"
            style={tab === t.id
              ? { background: "rgba(255,30,30,0.15)", border: "1px solid rgba(255,30,30,0.45)", color: "#ff5555", boxShadow: "0 0 12px rgba(255,0,0,0.12)" }
              : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
            <t.icon className="w-3.5 h-3.5" />
            {t.sym} {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "إجمالي مُقيَّم", value: totalScored, icon: Shield, color: "#4488ff" },
              { label: "CRITICAL", value: criticalCount, icon: AlertTriangle, color: "#ff4444" },
              { label: "HIGH", value: highCount, icon: TrendingUp, color: "#ff8844" },
              { label: "في KEV", value: stats?.inKev ?? 0, icon: Target, color: "#aa44ff" },
            ].map((s, i) => (
              <div key={i} className="rounded-xl p-4" style={NEON_CARD}>
                <div className="flex items-center gap-2 mb-3">
                  <s.icon className="w-4 h-4" style={{ color: s.color }} />
                  <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{s.label}</span>
                </div>
                <div className="text-3xl font-black font-mono" style={{ color: s.color, textShadow: `0 0 20px ${s.color}44` }}>
                  {statsLoading ? "..." : s.value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* Risk Distribution */}
          <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
            <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#aa44ff" }}>
              <Activity className="w-4 h-4" />توزيع مستويات المخاطر
            </h3>
            <div className="space-y-3">
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(label => {
                const count = byLabel.find(l => l.riskLabel === label)?.count ?? 0;
                const pct = totalScored > 0 ? Math.round((count / totalScored) * 100) : 0;
                const s = LABEL_STYLE[label]!;
                return (
                  <div key={label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span style={{ color: s.color, fontWeight: 900 }}>{label}</span>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>{count.toLocaleString()} ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* KEV + Exploit */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "مستغَلة فعلياً (CISA KEV)", val: stats?.inKev ?? 0, color: "#aa44ff", icon: Target, desc: "ثغرة مؤكد استغلالها في هجمات حقيقية" },
              { label: "لها exploit عام", val: stats?.withExploit ?? 0, color: "#ff4444", icon: Zap, desc: "ثغرة لها كود استغلال متاح للعموم" },
            ].map(({ label, val, color, icon: Icon, desc }) => (
              <div key={label} className="rounded-2xl p-5" style={NEON_CARD}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-4 h-4" style={{ color }} />
                  <span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.7)" }}>{label}</span>
                </div>
                <div className="text-4xl font-black font-mono mb-2" style={{ color, textShadow: `0 0 20px ${color}66` }}>{val}</div>
                <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{desc}</p>
              </div>
            ))}
          </div>

          {/* Llama3 Quick Action */}
          {stats?.ollama?.available && (
            <div className="rounded-2xl p-5 flex items-center justify-between gap-4"
              style={{ background: "linear-gradient(135deg,rgba(170,0,255,0.08),rgba(0,100,255,0.05))", border: "1px solid rgba(170,0,255,0.25)", borderRadius: 16 }}>
              <div>
                <h3 className="font-black text-sm flex items-center gap-2 mb-1" style={{ color: "#aa44ff" }}>
                  <Brain className="w-4 h-4" />تحليل Llama3 الذكي (محلي)
                </h3>
                <p className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
                  النماذج: {stats.ollama.models.join(", ")} · يعمل بالكامل بدون اتصال خارجي
                </p>
              </div>
              <button onClick={() => llmMut.mutate()} disabled={llmMut.isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-[12px] font-mono whitespace-nowrap transition-all"
                style={{ background: "rgba(170,0,255,0.2)", border: "1px solid rgba(170,0,255,0.4)", color: "#cc66ff", boxShadow: "0 0 15px rgba(170,0,255,0.15)" }}>
                {llmMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                {llmMut.isPending ? "جارٍ..." : "تحليل 15 ثغرة"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Top Risks ── */}
      {tab === "top" && (
        <div className="space-y-3">
          {topLoading && (
            <div className="text-center py-10 font-mono text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
              جارٍ التحميل...
            </div>
          )}
          {topData?.results.length === 0 && (
            <div className="text-center py-12 space-y-3">
              <Shield className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>لا توجد بيانات — شغّل محرك المخاطر أولاً</p>
            </div>
          )}
          {topData?.results.map((item, i) => (
            <div key={item.rs.cveId} className="rounded-xl p-4 transition-all" style={{ ...NEON_CARD, borderRadius: 12 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,30,30,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,0,255,0.12)"; }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="text-[11px] font-black font-mono mt-0.5 w-6 shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>#{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-[12px] font-black font-mono" style={{ color: "#4488ff" }}>{item.rs.cveId}</span>
                      <Badge label={item.rs.riskLabel} />
                      {item.rs.isInKev && <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(170,0,255,0.12)", border: "1px solid rgba(170,0,255,0.3)", color: "#cc66ff" }}>KEV</span>}
                      {item.rs.hasPublicExploit && <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>Exploit</span>}
                      {item.rs.hasPoc && <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,100,0,0.1)", border: "1px solid rgba(255,100,0,0.25)", color: "#ff8844" }}>PoC</span>}
                    </div>
                    <p className="text-[11px] line-clamp-2" style={{ color: "rgba(255,255,255,0.5)" }}>{item.description}</p>
                    {item.rs.aiSummary && (
                      <div className="mt-2 p-2 rounded-lg" style={{ background: "rgba(170,0,255,0.06)", border: "1px solid rgba(170,0,255,0.15)" }}>
                        <p className="text-[10px] flex items-center gap-1.5" style={{ color: "#cc66ff" }}>
                          <Brain className="w-3 h-3 shrink-0" />{item.rs.aiSummary}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-center">
                  <div className="text-2xl font-black font-mono" style={{ color: "#ff4444" }}>{item.rs.riskScore}</div>
                  <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>risk score</div>
                  <div className="text-[9px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>CVSS: {item.rs.cvss?.toFixed(1)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── KEV ── */}
      {tab === "kev" && (
        <div className="space-y-3">
          <div className="rounded-xl p-4" style={{ background: "rgba(170,0,255,0.07)", border: "1px solid rgba(170,0,255,0.25)", borderRadius: 12 }}>
            <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: "#cc66ff" }}>
              <AlertTriangle className="w-4 h-4" />
              <strong>تحذير:</strong> هذه الثغرات مؤكد استغلالها في هجمات حقيقية حسب CISA — يجب معالجتها فوراً
            </div>
          </div>
          {kevLoading && <div className="text-center py-10 font-mono text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>جارٍ التحميل...</div>}
          {kevData?.kev.map((item) => (
            <div key={item.rs.cveId} className="rounded-xl p-4 transition-all" style={{ ...NEON_CARD, borderRadius: 12, border: "1px solid rgba(170,0,255,0.2)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(170,0,255,0.45)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(170,0,255,0.2)"; }}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-[12px] font-black font-mono" style={{ color: "#4488ff" }}>{item.rs.cveId}</span>
                    <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.35)", color: "#ff4444" }}>🔴 مستغَلة فعلياً</span>
                    <Badge label={item.rs.riskLabel} />
                  </div>
                  <p className="text-[11px] line-clamp-2" style={{ color: "rgba(255,255,255,0.5)" }}>{item.description}</p>
                </div>
                <div className="shrink-0 text-center mr-4 space-y-1">
                  <div className="text-2xl font-black font-mono" style={{ color: "#aa44ff" }}>{item.rs.riskScore}</div>
                  <div className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>CVSS: {item.rs.cvss?.toFixed(1)}</div>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      className="text-[9px] flex items-center gap-0.5 justify-center" style={{ color: "#4488ff" }}>
                      <ExternalLink className="w-3 h-3" /> تفاصيل
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── AI Analysis ── */}
      {tab === "ai" && (
        <div className="space-y-4">
          {!stats?.ollama?.available ? (
            <div className="text-center py-12 space-y-3">
              <Brain className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="text-lg font-bold" style={{ color: "rgba(255,255,255,0.4)" }}>Ollama غير متاح</p>
              <p className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>تأكد من تشغيل Ollama على http://127.0.0.1:11434</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl p-6" style={{ background: "linear-gradient(135deg,rgba(170,0,255,0.08),rgba(0,100,255,0.05))", border: "1px solid rgba(170,0,255,0.25)", borderRadius: 16 }}>
                <div className="flex items-center gap-3 mb-4">
                  <Brain className="w-6 h-6" style={{ color: "#aa44ff" }} />
                  <div>
                    <h3 className="font-black" style={{ color: "#cc66ff" }}>تحليل Llama3 للثغرات</h3>
                    <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>النماذج المتاحة: {stats.ollama.models.join(", ")}</p>
                  </div>
                </div>
                <p className="text-[12px] mb-5" style={{ color: "rgba(255,255,255,0.5)" }}>
                  يرسل Llama3 تحليلاً لكل ثغرة يستخرج منه: الهدف المتأثر، طريقة الاستغلال، خطورة التأثير، وخطوات الإصلاح — كل ذلك يعمل محلياً بدون اتصال خارجي.
                </p>
                <button onClick={() => llmMut.mutate()} disabled={llmMut.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-[12px] font-mono transition-all"
                  style={{ background: "rgba(170,0,255,0.2)", border: "1px solid rgba(170,0,255,0.4)", color: "#cc66ff", boxShadow: "0 0 15px rgba(170,0,255,0.15)" }}>
                  {llmMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                  {llmMut.isPending ? "جارٍ التحليل..." : "تحليل 15 ثغرة الآن"}
                </button>
              </div>

              <div className="rounded-2xl p-5 space-y-3" style={{ ...NEON_CARD }}>
                <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#44eebb" }}>
                  <CheckCircle className="w-4 h-4" />كيف يعمل محرك المخاطر؟
                </h3>
                <div className="space-y-2">
                  {[
                    { sym: "🎯", title: "CVSS Score (35%)", desc: "درجة الخطورة الرسمية من NVD" },
                    { sym: "📊", title: "EPSS Score (25%)", desc: "احتمالية الاستغلال الفعلي خلال 30 يوم" },
                    { sym: "🔴", title: "CISA KEV (+20)", desc: "مؤكد استغلالها في هجمات حقيقية" },
                    { sym: "💣", title: "Exploit عام (+12)", desc: "يوجد كود استغلال متاح للعموم" },
                    { sym: "🔬", title: "PoC موجود (+8)", desc: "دليل إثبات مفهومي موجود على GitHub" },
                    { sym: "🏢", title: "تأثير على الأصول (+10)", desc: "الثغرة تؤثر على assets محددة في المخزون" },
                  ].map(f => (
                    <div key={f.title} className="flex items-start gap-3 p-3 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <span className="text-base shrink-0">{f.sym}</span>
                      <div>
                        <div className="text-[11px] font-black" style={{ color: "rgba(255,255,255,0.8)" }}>{f.title}</div>
                        <div className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{f.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
