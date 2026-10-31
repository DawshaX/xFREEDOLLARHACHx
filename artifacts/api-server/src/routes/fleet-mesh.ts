/**
 * Fleet Mesh — the connective tissue between every agent in the platform.
 *
 * The problem this solves: NOVA (the brain), the specialised agents (V3, V6,
 * Commander, Sentinel, Intelligence), and every physical machine that runs
 * `nova-agent.js` used to live in separate tabs with no shared state. Here they
 * are one network:
 *
 *   • every agent is a **node** with a live status,
 *   • agents talk to each other through one message bus (persisted, so the
 *     conversation survives a restart),
 *   • a **capacity plan** keeps 5 machines × 10 agent slots visible even when
 *     they are not plugged in yet — so you can see exactly what is missing,
 *   • **broadcast** sends one command to every connected machine, and it is
 *     gated behind explicit approval, exactly like `fleet_exec`,
 *   • a **work plan** turns one instruction from you into assigned steps that
 *     survive restarts and can be resumed later.
 *
 * Nothing here is simulated: device nodes come from real WebSocket registrations
 * and broadcast really executes on the machines.
 */
import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { getConnectedAgentList, execOnLocalAgent } from "./local-agent";
import { broadcastEvent } from "../lib/ws-hub";
import { broadcastLiveEvent } from "./live-events";

const router = Router();

/* ── config ─────────────────────────────────────────────────────────────── */

const STATE_DIR = path.join(process.cwd(), "state");
const STATE_FILE = process.env.NOVA_MESH_FILE || path.join(STATE_DIR, "fleet-mesh.json");
const TARGET_MACHINES = Math.max(1, Number(process.env.NOVA_FLEET_MACHINES || 5));
const TARGET_AGENTS = Math.max(1, Number(process.env.NOVA_FLEET_AGENTS || 10));
const MAX_LOG = 400;

/* ── types ──────────────────────────────────────────────────────────────── */

export type MeshNodeKind = "brain" | "internal" | "machine" | "slot";

export interface MeshNode {
  id: string;
  name: string;
  kind: MeshNodeKind;
  role: string;
  status: "online" | "waiting" | "offline";
  /** UI route that opens this agent's own workspace (internal agents only). */
  route?: string;
  /** Machine that hosts this agent (device + slot nodes). */
  host?: string;
  platform?: string;
  arch?: string;
  user?: string;
  tools?: number;
  cpus?: number;
  totalMemory?: number;
  connectedAt?: number;
  /** Slot → machine assignment for the 10-agent capacity plan. */
  assignedTo?: string | null;
}

export interface MeshMessage {
  id: string;
  at: number;
  from: string;
  to: string;
  kind: "info" | "command" | "result" | "plan" | "error";
  text: string;
  ok?: boolean;
}

export type StepStatus = "queued" | "running" | "done" | "failed";

export interface PlanStep {
  id: string;
  title: string;
  agent: string;
  status: StepStatus;
  note?: string;
  at?: number;
}

export interface FleetPlan {
  id: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
  steps: PlanStep[];
}

interface MeshState {
  log: MeshMessage[];
  plans: FleetPlan[];
  /** Sticky id → machine assignment so slot labels do not shuffle every poll. */
  slotAssignments: Record<string, string>;
}

/* ── the agents that live inside this server ────────────────────────────── */

const INTERNAL_AGENTS: Array<{
  id: string;
  name: string;
  role: string;
  route: string;
  kind: "brain" | "internal";
}> = [
  { id: "nova", name: "نوفا · الدماغ", role: "التخطيط والتنفيذ على 33 أداة", route: "/nova-agent", kind: "brain" },
  { id: "nova-v3", name: "Nova Agent V3", role: "وكيل الجيل الثالث", route: "/nova-agent-v3", kind: "internal" },
  { id: "nova-v6", name: "Nova Agent V6", role: "وكيل الجيل السادس", route: "/nova-agent-v6", kind: "internal" },
  { id: "commander", name: "Nova Commander", role: "قيادة الأسراب وتوزيع المهام", route: "/nova-commander", kind: "internal" },
  { id: "sentinel", name: "Nova Sentinel", role: "المراقبة والحراسة المستمرة", route: "/nova-sentinel", kind: "internal" },
  { id: "intelligence", name: "Nova Intelligence", role: "الاستخبارات وتحليل التهديدات", route: "/nova-intelligence", kind: "internal" },
  { id: "memory", name: "Nova Memory", role: "الذاكرة طويلة المدى", route: "/nova-memory", kind: "internal" },
];

/* ── persistence (atomic, failure-tolerant) ─────────────────────────────── */

function emptyState(): MeshState {
  return { log: [], plans: [], slotAssignments: {} };
}

let state: MeshState = loadState();

function loadState(): MeshState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<MeshState>;
    return {
      log: Array.isArray(parsed.log) ? parsed.log.slice(0, MAX_LOG) : [],
      plans: Array.isArray(parsed.plans) ? parsed.plans.slice(0, 40) : [],
      slotAssignments: parsed.slotAssignments && typeof parsed.slotAssignments === "object" ? parsed.slotAssignments : {},
    };
  } catch {
    return emptyState();
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      const tmp = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
      fs.renameSync(tmp, STATE_FILE);
    } catch {
      /* a failed write must never break a live command */
    }
  }, 60);
}

/* ── messaging ──────────────────────────────────────────────────────────── */

function pushMessage(msg: Omit<MeshMessage, "id" | "at">): MeshMessage {
  const full: MeshMessage = {
    ...msg,
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
  };
  state.log.unshift(full);
  if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
  persist();
  broadcastEvent("fleet_mesh_message", full as unknown as Record<string, unknown>);
  broadcastLiveEvent({
    type: "tool_result",
    data: { tool: `mesh:${full.from}→${full.to}`, ok: full.ok !== false, summary: full.text.slice(0, 200), ms: 0, ts: full.at },
    ts: new Date().toISOString(),
  });
  return full;
}

/* ── node graph ─────────────────────────────────────────────────────────── */

function buildNodes(): MeshNode[] {
  const devices = getConnectedAgentList();
  const nodes: MeshNode[] = INTERNAL_AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    role: a.role,
    status: "online" as const,
    route: a.route,
  }));

  // One node per real machine that has an agent attached.
  for (const d of devices) {
    nodes.push({
      id: `machine:${d.id}`,
      name: d.id,
      kind: "machine",
      role: `${d.platform}/${d.arch ?? "?"} · ${d.user}`,
      status: "online",
      host: d.hostname,
      platform: d.platform,
      arch: d.arch,
      user: d.user,
      tools: d.capabilities?.length,
      cpus: d.cpus,
      totalMemory: d.totalMemory,
      connectedAt: d.connectedAt,
    });
  }

  // One slot per *real* agent — never reuse a machine to fake capacity.
  // Slot #i is only "online" when there are at least i agents actually attached.
  const deviceIds = devices.map((d) => d.id);
  for (let i = 0; i < TARGET_AGENTS; i++) {
    const slotId = `agent:${i + 1}`;
    const assigned = deviceIds[i] ?? null;
    if (assigned) state.slotAssignments[slotId] = assigned;
    else delete state.slotAssignments[slotId];
    const online = Boolean(assigned);
    nodes.push({
      id: slotId,
      name: `Agent ${i + 1}`,
      kind: "slot",
      role: online ? `متصل على ${assigned}` : "سلوت فاضي — محتاج تركيب",
      status: online ? "online" : "waiting",
      assignedTo: assigned,
      host: assigned ?? undefined,
    });
  }
  return nodes;
}

function capacity() {
  const devices = getConnectedAgentList();
  const online = Math.min(devices.length, TARGET_AGENTS);
  return {
    machines: { target: TARGET_MACHINES, connected: devices.length },
    agents: { target: TARGET_AGENTS, connected: online },
    ready: devices.length >= TARGET_MACHINES && online >= TARGET_AGENTS,
    installCommand: "curl -fsSL <host>/api/local-agent/download-agent | bash -s -- --id machine-N",
  };
}

/* ── planner (deterministic, free, no LLM required) ─────────────────────── */

function pickAgent(nodes: MeshNode[], index: number): string {
  const pool = nodes.filter((n) => n.status === "online" && (n.kind === "machine" || n.kind === "slot" || n.kind === "brain"));
  if (pool.length === 0) return "nova";
  return pool[index % pool.length].id;
}

function decompose(goal: string, nodes: MeshNode[]): PlanStep[] {
  const target =
    goal.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/i)?.[0] ??
    goal.match(/CVE-\d{4}-\d+/i)?.[0] ??
    null;

  const titles: string[] = [];
  if (target) titles.push(`تثبيت الهدف النشط: ${target}`);
  if (target && /^CVE-/i.test(target)) {
    titles.push(`بحث CVE في NVD + Exploit-DB: ${target}`);
    titles.push("تحديد النسخ المتأثرة ومطابقتها بالأسطول");
  } else if (target) {
    titles.push(`استطلاع سلبي: DNS + شهادات TLS + ترويسات HTTP لـ ${target}`);
    titles.push(`تعداد النطاقات الفرعية + فحص منافذ محدود لـ ${target}`);
    titles.push("مطابقة النتائج مع فهرس الثغرات و CISA-KEV");
  }
  titles.push("جمع الأدلة وتوقيعها (SHA-256)");
  titles.push("توليد تقرير Markdown جاهز للإرسال");
  titles.push("مراجعة السرب: تحديث الذاكرة ودروس الجلسة");

  return titles.slice(0, 6).map((title, i) => ({
    id: `s-${i + 1}`,
    title,
    agent: pickAgent(nodes, i),
    status: "queued" as StepStatus,
  }));
}

/* ── routes ─────────────────────────────────────────────────────────────── */

/** Full live picture: nodes, capacity, plan board, and the message log. */
router.get("/fleet/mesh", (_req: Request, res: Response) => {
  const nodes = buildNodes();
  const active = state.plans[0] ?? null;
  res.json({
    ok: true,
    now: Date.now(),
    capacity: capacity(),
    nodes,
    stats: {
      nodes: nodes.length,
      online: nodes.filter((n) => n.status === "online").length,
      machines: nodes.filter((n) => n.kind === "machine").length,
      slots: nodes.filter((n) => n.kind === "slot").length,
      messages: state.log.length,
    },
    plan: active,
    plans: state.plans.slice(0, 10),
    log: state.log.slice(0, 80),
  });
});

/** The raw log only (used by the tail widgets). */
router.get("/fleet/mesh/log", (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 100) || 100, MAX_LOG);
  res.json({ ok: true, count: state.log.length, log: state.log.slice(0, limit) });
});

/** Agent → agent (or agent → all) message on the shared bus. */
router.post("/fleet/mesh/send", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { from?: string; to?: string; text?: string; kind?: MeshMessage["kind"] };
  const text = String(body.text ?? "").trim();
  if (!text) {
    res.status(400).json({ ok: false, error: "text is required" });
    return;
  }
  const msg = pushMessage({
    from: String(body.from ?? "nova"),
    to: String(body.to ?? "*"),
    kind: body.kind ?? "info",
    text: text.slice(0, 1000),
  });
  res.json({ ok: true, message: msg });
});

/**
 * One command → every connected machine.
 *
 * Deliberately two-phase: the first call never touches a box, it only reports
 * what would happen. The second call must carry `approve: true`.
 */
router.post("/fleet/broadcast", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { command?: string; approve?: boolean; timeoutMs?: number };
  const command = String(body.command ?? "").trim();
  if (!command) {
    res.status(400).json({ ok: false, error: "command is required" });
    return;
  }
  const devices = getConnectedAgentList();
  if (devices.length === 0) {
    pushMessage({ from: "nova", to: "*", kind: "error", ok: false, text: `تعذّر البث: مفيش أجهزة متصلة (${command})` });
    res.status(409).json({ ok: false, error: "no_agents", command, hint: "شغّل nova-agent.js على جهاز واحد على الأقل" });
    return;
  }

  const targets = devices.map((d) => d.id);
  if (body.approve !== true) {
    res.json({
      ok: true,
      needsApproval: true,
      command,
      targets,
      reason: `الأمر هيشتغل على ${targets.length} جهاز حقيقي. محتاج موافقة صريحة قبل التنفيذ.`,
    });
    return;
  }

  const timeout = Math.min(Number(body.timeoutMs ?? 20_000) || 20_000, 60_000);
  pushMessage({ from: "nova", to: "*", kind: "command", text: `بث أمر على ${targets.length} جهاز: ${command}` });

  const results = await Promise.all(
    targets.map(async (id) => {
      const started = Date.now();
      try {
        const r = await execOnLocalAgent(command, id, timeout);
        const ms = Date.now() - started;
        if (!r) {
          pushMessage({ from: id, to: "nova", kind: "error", ok: false, text: `${id}: الجهاز مش متاح` });
          return { id, ok: false, exitCode: null, output: "agent unavailable", ms };
        }
        const ok = r.exitCode === 0;
        const out = `${r.stdout || r.stderr || "(no output)"}`.trim().slice(0, 600);
        pushMessage({ from: id, to: "nova", kind: "result", ok, text: `${id} · exit=${r.exitCode} · ${ms}ms · ${out}` });
        return { id, ok, exitCode: r.exitCode, output: out, ms };
      } catch (err) {
        const ms = Date.now() - started;
        pushMessage({ from: id, to: "nova", kind: "error", ok: false, text: `${id}: ${(err as Error).message}` });
        return { id, ok: false, exitCode: null, output: (err as Error).message, ms };
      }
    }),
  );

  res.json({
    ok: results.every((r) => r.ok),
    command,
    targets,
    results,
    ranAt: Date.now(),
  });
});

/** Turn one instruction into an assigned, persistent plan. */
router.post("/fleet/plan", (req: Request, res: Response) => {
  const goal = String((req.body ?? {}).goal ?? "").trim();
  if (!goal) {
    res.status(400).json({ ok: false, error: "goal is required" });
    return;
  }
  const nodes = buildNodes();
  const plan: FleetPlan = {
    id: `plan-${Date.now()}`,
    goal: goal.slice(0, 400),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: decompose(goal, nodes),
  };
  state.plans.unshift(plan);
  if (state.plans.length > 40) state.plans.length = 40;
  persist();
  pushMessage({ from: "nova", to: "*", kind: "plan", text: `خطة جديدة (${plan.steps.length} خطوة): ${plan.goal}` });
  res.json({ ok: true, plan });
});

/** Move a step forward — this is how a plan survives restarts. */
router.post("/fleet/plan/:planId/step/:stepId", (req: Request, res: Response) => {
  const { planId, stepId } = req.params;
  const status = String((req.body ?? {}).status ?? "done") as StepStatus;
  const note = (req.body ?? {}).note ? String((req.body ?? {}).note).slice(0, 400) : undefined;
  const plan = state.plans.find((p) => p.id === planId);
  const step = plan?.steps.find((s) => s.id === stepId);
  if (!plan || !step) {
    res.status(404).json({ ok: false, error: "plan or step not found" });
    return;
  }
  step.status = ["queued", "running", "done", "failed"].includes(status) ? status : "done";
  step.note = note;
  step.at = Date.now();
  plan.updatedAt = Date.now();
  persist();
  pushMessage({
    from: step.agent,
    to: "nova",
    kind: "result",
    ok: step.status !== "failed",
    text: `${plan.goal} → «${step.title}» ${step.status === "done" ? "خلصت" : step.status === "failed" ? "فشلت" : step.status}`,
  });
  res.json({ ok: true, plan });
});

/** Resume: the newest unfinished plan, so nothing is lost between sessions. */
router.get("/fleet/plan/active", (_req: Request, res: Response) => {
  const plan = state.plans.find((p) => p.steps.some((s) => s.status === "queued" || s.status === "running")) ?? state.plans[0] ?? null;
  res.json({ ok: true, plan });
});

export default router;
