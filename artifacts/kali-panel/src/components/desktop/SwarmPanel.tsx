/**
 * SwarmPanel — لوحة تحكم نظام الوكلاء المتعددين.
 * 3 وكلاء يعملون بالتوازي: باحث + محلل كود + مراجع أمني.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Bot, Search, Code2, ShieldCheck, Play, RefreshCw, FileText, Zap, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import { jsonRequest } from "@/lib/sse";

const BASE = "/api";

interface AgentStatus {
  id: string;
  name: string;
  role: string;
  status: "idle" | "thinking" | "running" | "done" | "error";
  currentTask: string;
  output: string;
  toolsUsed: string[];
  startedAt: string | null;
  doneAt: string | null;
  icon: string;
}

interface SwarmStatus {
  active: boolean;
  mission: string;
  startedAt: string | null;
  agents: AgentStatus[];
  finalReport: string;
}

const AGENT_ICONS = { researcher: Search, coder: Code2, auditor: ShieldCheck };
const AGENT_COLORS = {
  researcher: { text: "text-cyan-300", bg: "bg-cyan-500/10 border-cyan-500/30", glow: "shadow-cyan-900/30" },
  coder:      { text: "text-yellow-300", bg: "bg-yellow-500/10 border-yellow-500/30", glow: "shadow-yellow-900/30" },
  auditor:    { text: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/30", glow: "shadow-emerald-900/30" },
};

const STATUS_MAP = {
  idle: { label: "استعداد", icon: Clock, color: "text-slate-500" },
  thinking: { label: "يفكر…", icon: Zap, color: "text-yellow-400" },
  running: { label: "يعمل", icon: RefreshCw, color: "text-blue-400" },
  done: { label: "اكتمل", icon: CheckCircle2, color: "text-emerald-400" },
  error: { label: "خطأ", icon: XCircle, color: "text-red-400" },
};

const PRESET_MISSIONS = [
  "ابحث عن أحدث 5 ثغرات حرجة في نظام لينوكس وحللها وأصدر توصيات أمنية",
  "افحص بنية الشبكة المحلية، اكتشف المنافذ المفتوحة، وقيّم المخاطر",
  "ابحث في MITRE ATT&CK عن أحدث تكتيكات الهجوم وكيفية الدفاع ضدها",
  "حلّل أكثر 10 ثغرات استغلالاً في 2024 وأعدّ تقريراً شاملاً",
];

export function SwarmPanel() {
  const [swarm, setSwarm] = useState<SwarmStatus | null>(null);
  const [mission, setMission] = useState("");
  const [tab, setTab] = useState<"agents" | "report" | "presets">("agents");
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await jsonRequest<SwarmStatus>("/swarm/status");
      setSwarm(data);
    } catch {}
  }, []);

  useEffect(() => {
    void fetchStatus();
    pollRef.current = setInterval(() => void fetchStatus(), 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  const launchSwarm = async () => {
    if (!mission.trim()) return;
    setLoading(true);
    try {
      await fetch(`${BASE}/swarm/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission }),
      });
      setMission("");
      await fetchStatus();
    } catch {}
    setLoading(false);
  };

  const activeCount = swarm?.agents.filter((a) => a.status === "running" || a.status === "thinking").length ?? 0;
  const doneCount = swarm?.agents.filter((a) => a.status === "done").length ?? 0;

  return (
    <div className="flex flex-col h-full bg-black/90 text-white" dir="rtl" style={{ fontFamily: "monospace" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-violet-500/20 bg-gradient-to-r from-violet-900/20 to-indigo-900/10">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2 rtl:space-x-reverse">
            {[Search, Code2, ShieldCheck].map((Icon, i) => (
              <div key={i} className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center border-2 border-black">
                <Icon className="w-3.5 h-3.5 text-white" />
              </div>
            ))}
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-violet-200">Nova Swarm — فريق الوكلاء</div>
            <div className="text-[10px] text-violet-400/60">
              {swarm?.active ? `🔴 يعمل: ${swarm.mission.slice(0, 40)}…` :
               doneCount === 3 ? "✅ اكتملت جميع المهام" : "⚫ في انتظار مهمة"}
            </div>
          </div>
          {swarm?.active && (
            <div className="flex items-center gap-1 text-[10px] text-yellow-400">
              <RefreshCw className="w-3 h-3 animate-spin" />
              {activeCount}/3
            </div>
          )}
        </div>

        {/* Mission input */}
        <div className="mt-3 flex gap-2">
          <input
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void launchSwarm()}
            placeholder="المهمة التي يعمل عليها الفريق…"
            disabled={swarm?.active}
            className="flex-1 bg-black/40 border border-violet-500/20 rounded-lg px-3 py-1.5 text-xs outline-none placeholder:text-slate-600 focus:border-violet-500/50 disabled:opacity-50"
          />
          <button
            onClick={() => void launchSwarm()}
            disabled={swarm?.active || !mission.trim() || loading}
            className="px-3 py-1.5 bg-violet-500/20 border border-violet-500/30 text-violet-300 rounded-lg text-xs hover:bg-violet-500/30 disabled:opacity-40 transition-all flex items-center gap-1"
          >
            {swarm?.active ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            إطلاق
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-violet-500/10">
        {(["agents", "report", "presets"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[11px] font-medium transition-all ${tab === t ? "text-violet-300 border-b-2 border-violet-500" : "text-slate-500 hover:text-slate-300"}`}>
            {t === "agents" ? "الوكلاء" : t === "report" ? "التقرير" : "قوالب"}
          </button>
        ))}
      </div>

      {/* AGENTS TAB */}
      {tab === "agents" && (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          {swarm?.agents.map((agent) => {
            const Icon = AGENT_ICONS[agent.id as keyof typeof AGENT_ICONS] || Bot;
            const color = AGENT_COLORS[agent.id as keyof typeof AGENT_COLORS] || AGENT_COLORS.researcher;
            const smap = STATUS_MAP[agent.status];
            const SIcon = smap.icon;
            return (
              <div key={agent.id} className={`rounded-xl border p-3 ${color.bg} transition-all`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${color.bg} border flex items-center justify-center`}>
                    <Icon className={`w-4 h-4 ${color.text}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm font-bold ${color.text}`}>{agent.icon} {agent.name}</span>
                      <span className="text-[10px] text-slate-500">({agent.role})</span>
                    </div>
                    <div className={`flex items-center gap-1 text-[10px] ${smap.color}`}>
                      <SIcon className={`w-2.5 h-2.5 ${agent.status === "running" ? "animate-spin" : agent.status === "thinking" ? "animate-pulse" : ""}`} />
                      {smap.label}
                      {agent.startedAt && agent.doneAt && (
                        <span className="text-slate-600 mr-1">
                          · {Math.round((new Date(agent.doneAt).getTime() - new Date(agent.startedAt).getTime()) / 1000)}ث
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {agent.toolsUsed.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {agent.toolsUsed.map((t) => (
                      <span key={t} className={`text-[8px] px-1.5 py-0.5 ${color.bg} border rounded font-mono ${color.text}`}>{t}</span>
                    ))}
                  </div>
                )}

                {agent.output && (
                  <div className="text-[10px] text-slate-300 bg-black/30 rounded p-2 max-h-24 overflow-auto leading-relaxed">
                    {agent.output.slice(0, 300)}{agent.output.length > 300 ? "…" : ""}
                  </div>
                )}

                {(agent.status === "thinking" || agent.status === "running") && !agent.output && (
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                    <span className="flex gap-0.5">
                      {[0,1,2].map((n) => <span key={n} className={`w-1 h-1 ${color.text.replace("text-", "bg-")} rounded-full animate-bounce`} style={{ animationDelay: `${n * 0.15}s` }} />)}
                    </span>
                    يعمل على المهمة…
                  </div>
                )}
              </div>
            );
          }) || (
            <div className="text-center text-slate-500 text-xs py-10">ابدأ مهمة لرؤية الوكلاء في العمل</div>
          )}
        </div>
      )}

      {/* REPORT TAB */}
      {tab === "report" && (
        <div className="flex-1 overflow-auto p-3">
          {swarm?.finalReport ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] text-emerald-400 mb-3">
                <CheckCircle2 className="w-3.5 h-3.5" /> التقرير النهائي للفريق
              </div>
              <pre className="whitespace-pre-wrap text-[11px] text-slate-300 leading-relaxed bg-black/30 rounded-lg p-3 border border-white/5">
                {swarm.finalReport}
              </pre>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-center text-slate-500 gap-2">
              <FileText className="w-10 h-10 opacity-20" />
              <div className="text-sm">لا يوجد تقرير بعد</div>
              <div className="text-xs opacity-60">أطلق مهمة للفريق لتحصل على تقرير شامل</div>
            </div>
          )}
        </div>
      )}

      {/* PRESETS TAB */}
      {tab === "presets" && (
        <div className="flex-1 overflow-auto p-3 space-y-2">
          <div className="text-[10px] text-slate-500 mb-3">مهام جاهزة للفريق:</div>
          {PRESET_MISSIONS.map((m, i) => (
            <button
              key={i}
              onClick={() => { setMission(m); setTab("agents"); }}
              disabled={swarm?.active}
              className="w-full text-right p-3 rounded-lg bg-violet-500/5 border border-violet-500/15 hover:border-violet-500/40 hover:bg-violet-500/10 transition-all disabled:opacity-40 group"
            >
              <div className="text-[11px] text-violet-200 group-hover:text-violet-100 leading-relaxed">{m}</div>
              <div className="text-[9px] text-slate-600 mt-1 group-hover:text-violet-500">انقر للتحديد →</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
