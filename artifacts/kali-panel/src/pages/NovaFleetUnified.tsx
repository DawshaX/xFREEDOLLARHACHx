/**
 * NOVA · الأسطول الموحّد — `/nova-fleet`
 *
 * One screen that finally puts everything in the same room:
 *   • the modified LiveAgentPanel (the brain, all 15 tabs) in the middle,
 *   • every agent in the platform as a live node (NOVA, V3, V6, Commander,
 *     Sentinel, Intelligence, Memory) plus every real machine and its slots,
 *   • the mesh bus — messages that actually travel between them, persisted,
 *   • one command broadcast to all machines (approval-gated, never silent),
 *   • a work plan assigned to agents that survives restarts.
 *
 * Everything on this page reads from `/api/fleet/mesh` and the permanent
 * `/api/ws` socket; nothing is hard-coded fake state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity, ArrowLeftRight, CheckCircle2, CircleDashed, Cpu, Crown, Loader2,
  PlayCircle, Radio, Send, Server, ShieldAlert, XCircle, Zap,
} from "lucide-react";
import { LiveAgentPanel } from "@/components/desktop/LiveAgentPanel";
import { NovaLiveBar, useNovaLive } from "@/components/desktop/NovaFleetLive";

const API = "/api";

interface MeshNode {
  id: string;
  name: string;
  kind: "brain" | "internal" | "machine" | "slot";
  role: string;
  status: "online" | "waiting" | "offline";
  route?: string;
  host?: string;
  platform?: string;
  arch?: string;
  user?: string;
  tools?: number;
  cpus?: number;
  totalMemory?: number;
  connectedAt?: number;
  assignedTo?: string | null;
}

interface MeshMessage {
  id: string;
  at: number;
  from: string;
  to: string;
  kind: string;
  text: string;
  ok?: boolean;
}

interface PlanStep {
  id: string;
  title: string;
  agent: string;
  status: "queued" | "running" | "done" | "failed";
  note?: string;
  at?: number;
}

interface FleetPlan {
  id: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
  steps: PlanStep[];
}

interface MeshSnapshot {
  ok: boolean;
  capacity: {
    machines: { target: number; connected: number };
    agents: { target: number; connected: number };
    ready: boolean;
    installCommand: string;
  };
  nodes: MeshNode[];
  stats: { nodes: number; online: number; machines: number; slots: number; messages: number };
  plan: FleetPlan | null;
  log: MeshMessage[];
}

const ACCENT: Record<MeshNode["kind"], string> = {
  brain: "#22d3ee",
  internal: "#a78bfa",
  machine: "#34d399",
  slot: "#fbbf24",
};

function relative(ts?: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}ث`;
  if (s < 3600) return `${Math.round(s / 60)}د`;
  return `${Math.round(s / 3600)}س`;
}

/* ── mesh graph ─────────────────────────────────────────────────────────── */

function NodeCard({ node, onOpen }: { node: MeshNode; onOpen?: (route: string) => void }) {
  const color = ACCENT[node.kind];
  const online = node.status === "online";
  return (
    <button
      onClick={() => node.route && onOpen?.(node.route)}
      disabled={!node.route}
      className="text-right rounded-xl p-2 border transition-all disabled:cursor-default hover:brightness-125"
      style={{
        background: online ? `rgba(255,255,255,0.04)` : "rgba(255,255,255,0.015)",
        borderColor: online ? `${color}55` : "rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background: online ? color : "#64748b",
            boxShadow: online ? `0 0 6px ${color}` : "none",
          }}
        />
        <span className="text-[10px] font-black truncate" style={{ color: online ? color : "#94a3b8" }}>
          {node.name}
        </span>
        {node.kind === "brain" && <Crown className="h-3 w-3 text-cyan-300 shrink-0" />}
        {node.kind === "machine" && <Server className="h-3 w-3 text-emerald-300 shrink-0" />}
        {node.kind === "slot" && <Cpu className="h-3 w-3 text-amber-300/70 shrink-0" />}
      </div>
      <div className="text-[8px] text-white/45 truncate mt-0.5">{node.role}</div>
      {node.kind === "machine" && (
        <div className="text-[8px] font-mono text-white/35 mt-0.5">
          {node.cpus ?? "?"}vCPU · {node.totalMemory ? `${Math.round(node.totalMemory / 1e9)}GB` : "?"} · {relative(node.connectedAt)}
        </div>
      )}
    </button>
  );
}

/* ── broadcast console ──────────────────────────────────────────────────── */

function BroadcastConsole({ hasTargets }: { hasTargets: boolean }) {
  const [command, setCommand] = useState("uname -a && whoami && uptime");
  const [pending, setPending] = useState<{ command: string; targets: string[]; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Array<{ id: string; ok: boolean; exitCode: number | null; output: string; ms: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (approve: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(`${API}/fleet/broadcast`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command, approve }),
        });
        const j = await r.json();
        if (j.needsApproval) {
          setPending({ command: j.command, targets: j.targets ?? [], reason: j.reason ?? "" });
          setResult(null);
        } else if (j.ok === false && j.error) {
          setError(String(j.error));
        } else {
          setPending(null);
          setResult(j.results ?? []);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [command],
  );

  return (
    <div className="rounded-xl p-2.5 border border-fuchsia-500/25 bg-fuchsia-500/5 space-y-2">
      <div className="flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-fuchsia-300" />
        <span className="text-[11px] font-black text-fuchsia-200">أمر واحد للكل</span>
        <span className="text-[8px] text-white/35">بيبث على كل جهاز متصل — بموافقة</span>
      </div>
      <textarea
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        rows={2}
        dir="ltr"
        className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] font-mono text-emerald-200 outline-none resize-none"
      />
      {!hasTargets && <div className="text-[9px] text-amber-300/80">مفيش أجهزة متصلة — أمر التركيب تحت في خانة السعة.</div>}
      {!pending ? (
        <button
          onClick={() => void run(false)}
          disabled={busy || !command.trim()}
          className="w-full py-1.5 rounded-lg text-[10px] font-black bg-fuchsia-500/20 hover:bg-fuchsia-500/35 text-fuchsia-100 border border-fuchsia-500/40 disabled:opacity-40 flex items-center justify-center gap-1"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} اطلب التنفيذ
        </button>
      ) : (
        <div className="rounded-lg p-2 border border-amber-500/45 bg-amber-500/10 space-y-1.5">
          <div className="text-[9px] font-black text-amber-300 flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> موافقة مطلوبة
          </div>
          <div className="text-[8px] text-amber-100/80 leading-relaxed">{pending.reason}</div>
          <div className="text-[8px] font-mono text-amber-200/70 break-all">{pending.targets.join(" · ")}</div>
          <div className="flex gap-1.5">
            <button
              onClick={() => void run(true)}
              disabled={busy}
              className="flex-1 py-1 rounded-md text-[9px] font-black bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 border border-amber-500/50 disabled:opacity-40"
            >
              ✅ موافق، نفّذ على الكل
            </button>
            <button
              onClick={() => setPending(null)}
              className="px-2 py-1 rounded-md text-[9px] font-black bg-white/5 hover:bg-white/10 text-white/70 border border-white/15"
            >
              ❌ إلغاء
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-[9px] text-red-400">⚠️ {error}</div>}
      {result && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {result.map((r) => (
            <div key={r.id} className="text-[8px] font-mono rounded bg-black/40 px-1.5 py-1">
              <span className={r.ok ? "text-emerald-300" : "text-red-400"}>{r.ok ? "✓" : "✗"} {r.id}</span>
              <span className="text-white/35"> · exit={r.exitCode ?? "?"} · {r.ms}ms</span>
              <div className="text-white/55 break-all">{r.output.slice(0, 160)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── plan board ─────────────────────────────────────────────────────────── */

function PlanBoard({ plan, onRefresh }: { plan: FleetPlan | null; onRefresh: () => void }) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    try {
      await fetch(`${API}/fleet/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      setGoal("");
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const advance = async (stepId: string, status: PlanStep["status"]) => {
    if (!plan) return;
    await fetch(`${API}/fleet/plan/${plan.id}/step/${stepId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onRefresh();
  };

  const done = plan?.steps.filter((s) => s.status === "done").length ?? 0;
  const total = plan?.steps.length ?? 0;

  return (
    <div className="rounded-xl p-2.5 border border-sky-500/25 bg-sky-500/5 space-y-2">
      <div className="flex items-center gap-1.5">
        <PlayCircle className="h-3.5 w-3.5 text-sky-300" />
        <span className="text-[11px] font-black text-sky-200">خطة العمل</span>
        {plan && <span className="text-[8px] font-mono text-white/40">{done}/{total}</span>}
      </div>
      <div className="flex gap-1.5">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          placeholder="اكتب الهدف… مثال: افحص example.com وجهّز تقرير"
          className="flex-1 bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] text-sky-100 outline-none placeholder:text-white/25"
        />
        <button
          onClick={() => void create()}
          disabled={busy || !goal.trim()}
          className="px-2 rounded-lg text-[9px] font-black bg-sky-500/20 hover:bg-sky-500/35 text-sky-100 border border-sky-500/40 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "خطّط"}
        </button>
      </div>
      {plan && (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          <div className="text-[9px] text-white/60 truncate">🎯 {plan.goal}</div>
          {plan.steps.map((s) => (
            <div key={s.id} className="rounded-lg bg-black/35 px-1.5 py-1 border border-white/5">
              <div className="flex items-center gap-1">
                {s.status === "done" ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                ) : s.status === "failed" ? (
                  <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                ) : s.status === "running" ? (
                  <Loader2 className="h-3 w-3 text-amber-300 animate-spin shrink-0" />
                ) : (
                  <CircleDashed className="h-3 w-3 text-white/30 shrink-0" />
                )}
                <span className="text-[8.5px] text-white/75 truncate flex-1">{s.title}</span>
                <span className="text-[7.5px] font-mono text-cyan-300/70">{s.agent}</span>
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

/* ── page ───────────────────────────────────────────────────────────────── */

export default function NovaFleetUnified() {
  const [, navigate] = useLocation();
  const [snap, setSnap] = useState<MeshSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useNovaLive();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/fleet/mesh`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`mesh ${r.status}`);
      const j = (await r.json()) as MeshSnapshot;
      setSnap(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  // A socket frame means the mesh may have changed — refresh immediately.
  useEffect(() => {
    if (!live.lastBeat) return;
    void load();
  }, [live.lastBeat, live.machines.length, load]);

  const groups = useMemo(() => {
    const nodes = snap?.nodes ?? [];
    return {
      brains: nodes.filter((n) => n.kind === "brain" || n.kind === "internal"),
      machines: nodes.filter((n) => n.kind === "machine"),
      slots: nodes.filter((n) => n.kind === "slot"),
    };
  }, [snap]);

  const cap = snap?.capacity;
  const log = (snap?.log ?? []).slice(0, 14);

  return (
    <div dir="rtl" className="min-h-[calc(100vh-64px)] bg-[#050208] text-white p-3 space-y-3">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-400/10 border border-cyan-400/40 flex items-center justify-center">
            <Radio className="h-4 w-4 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-sm font-black flex items-center gap-2">
              نوفا · الأسطول الموحّد
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-400/30 bg-emerald-400/10 text-emerald-200">MESH</span>
            </h1>
            <p className="text-[9px] text-white/45">كل الأيجنتات والأجهزة في شبكة واحدة — اتصال حقيقي، مش رسمة.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-white/45">عقد <b className="text-cyan-300">{snap?.stats.online ?? 0}/{snap?.stats.nodes ?? 0}</b></span>
          <span className="text-white/45">رسائل <b className="text-fuchsia-300">{snap?.stats.messages ?? 0}</b></span>
          {error && <span className="text-red-400">⚠️ {error}</span>}
        </div>
      </div>

      <NovaLiveBar onOpen={() => navigate("/nova-agent")} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* left: mesh */}
        <div className="xl:col-span-3 space-y-2">
          <div className="rounded-xl p-2.5 border border-white/10 bg-white/[0.02] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-white/80 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-cyan-300" /> عقد الشبكة
              </span>
              <span className="text-[8px] font-mono text-white/35">{snap?.stats.online ?? 0} أونلاين</span>
            </div>

            <div>
              <div className="text-[8px] font-black text-violet-300/80 mb-1">أيجنتات المنصة ({groups.brains.length})</div>
              <div className="grid grid-cols-2 gap-1">
                {groups.brains.map((n) => <NodeCard key={n.id} node={n} onOpen={(r) => navigate(r)} />)}
              </div>
            </div>

            <div>
              <div className="text-[8px] font-black text-emerald-300/80 mb-1">أجهزة متصلة ({groups.machines.length}/{cap?.machines.target ?? 5})</div>
              {groups.machines.length === 0 ? (
                <div className="text-[8.5px] text-amber-300/70 rounded-lg border border-amber-500/25 bg-amber-500/5 p-1.5 leading-relaxed">
                  مفيش جهاز متصل الآن. شغّل الوكلاء بأمر واحد لكل ماكينة — بيظهروا هنا في ثانية.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1">
                  {groups.machines.map((n) => <NodeCard key={n.id} node={n} />)}
                </div>
              )}
            </div>

            <div>
              <div className="text-[8px] font-black text-amber-300/80 mb-1">
                سلوتات الأيجنت ({groups.slots.filter((s) => s.status === "online").length}/{cap?.agents.target ?? 10})
              </div>
              <div className="grid grid-cols-5 gap-1">
                {groups.slots.map((n) => (
                  <div
                    key={n.id}
                    title={`${n.name} — ${n.role}`}
                    className="rounded-md py-1 text-center text-[7.5px] font-mono border"
                    style={{
                      borderColor: n.status === "online" ? "rgba(52,211,153,0.45)" : "rgba(255,255,255,0.08)",
                      background: n.status === "online" ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.02)",
                      color: n.status === "online" ? "#6ee7b7" : "#64748b",
                    }}
                  >
                    {n.name.replace("Agent ", "A")}
                  </div>
                ))}
              </div>
            </div>

            {cap && !cap.ready && (
              <div className="rounded-lg p-1.5 border border-white/10 bg-black/40">
                <div className="text-[8px] font-black text-white/60 mb-1">أمر التركيب (بيتكرر بـ --id مختلف)</div>
                <code className="block text-[7.5px] font-mono text-emerald-300/90 break-all leading-relaxed" dir="ltr">
                  {cap.installCommand}
                </code>
              </div>
            )}
          </div>

          <div className="rounded-xl p-2.5 border border-white/10 bg-white/[0.02]">
            <div className="text-[10px] font-black text-white/75 flex items-center gap-1.5 mb-1.5">
              <ArrowLeftRight className="h-3 w-3 text-fuchsia-300" /> باص الرسائل
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {log.length === 0 && <div className="text-[8.5px] text-white/35">مفيش رسائل بعد — أول أمر أو خطة هتظهر هنا.</div>}
              {log.map((m) => (
                <div key={m.id} className="text-[8px] rounded bg-black/35 px-1.5 py-1 border border-white/5">
                  <div className="flex items-center gap-1 text-white/40 font-mono">
                    <span className="text-cyan-300/80">{m.from}</span>
                    <span>→</span>
                    <span className="text-fuchsia-300/80">{m.to}</span>
                    <span className="ms-auto">{relative(m.at)}</span>
                  </div>
                  <div className={`break-words ${m.ok === false ? "text-red-300/80" : "text-white/65"}`}>{m.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* center: the modified live panel */}
        <div className="xl:col-span-6">
          <div className="rounded-xl border border-cyan-500/20 overflow-hidden bg-black/30 h-[78vh] min-h-[520px]">
            <LiveAgentPanel embedded onClientTool={() => {}} onOpenAgentWindow={() => {}} />
          </div>
        </div>

        {/* right: broadcast + plan */}
        <div className="xl:col-span-3 space-y-2">
          <BroadcastConsole hasTargets={(snap?.stats.machines ?? 0) > 0} />
          <PlanBoard plan={snap?.plan ?? null} onRefresh={() => void load()} />
        </div>
      </div>
    </div>
  );
}
