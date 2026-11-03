/**
 * Ops routes — authorized programs, real jobs, evidence, verification, reports.
 *
 *   GET   /api/ops/kinds              كل أنواع المهام + الأدوات المكتشفة على النود
 *   GET   /api/ops/programs           البرامج المصرّح بها + حالتها
 *   POST  /api/ops/programs           إضافة/تحديث برنامج (scope + حدود)
 *   DELETE/api/ops/programs/:id       حذف برنامج
 *   POST  /api/ops/programs/check     «هل النطاق ده جوه السكوب؟» — قبل أي شغل
 *   GET   /api/ops/programs/security-txt?host=  قراءة سياسة الإفصاح (RFC 9116)
 *   POST  /api/ops/jobs               إنشاء job (يُرفض لو الهدف مش مصرّح به)
 *   GET   /api/ops/jobs               قايمة الـjobs
 *   GET   /api/ops/jobs/:id           حالة تفصيلية (tasks + findings + log)
 *   POST  /api/ops/jobs/:id/run       تشغيل فوري (لحد الميزانية)
 *   POST  /api/ops/jobs/:id/pause     إيقاف مؤقت
 *   POST  /api/ops/jobs/:id/resume    إكمال
 *   POST  /api/ops/jobs/:id/cancel    إلغاء
 *   POST  /api/ops/jobs/:id/verify    بوابة البرهان لfinding واحد (أو الكل)
 *   GET   /api/ops/jobs/:id/report    تقرير Markdown جاهز للإرسال
 *   GET   /api/ops/stats              ثروتل + pump + إحصائيات
 *   POST  /api/ops/programs/discover  نطاق عادي → يقرأ security.txt ويسجّله (passive)
 *   GET   /api/ops/provision          أسماء المفاتيح اللي اتحمّلت + النطاقات اللي اتسجّلت
 *   POST  /api/ops/provision/reload   يعيد القراءة من غير restart
 *   GET   /api/ops/sweep              وضع الدورة الخلفية (آخر sweep / السقف)
 *   POST  /api/ops/sweep              يشغّل الدورة دلوقتي (نفس اللي بيعمله الـdaemon كل 3 دقايق)
 */
import { Router, type Request, type Response } from "express";
import { catalogStatus, lookupBountyProgram } from "../lib/ops/bounty-catalog";
import {
  assertAuthorized,
  discoverProgram,
  fetchSecurityTxt,
  loadPrograms,
  normalizeHost,
  removeProgram,
  upsertProgram,
} from "../lib/ops/scope";
import {
  buildReport,
  cancelJob,
  createJob,
  getJob,
  isJobRunning,
  listJobs,
  pauseJob,
  resumeJob,
  runJob,
  runnerStats,
  startJobPump,
  suggestPlan,
  verifyFinding,
} from "../lib/ops/runner";
import { KIND_LIST, toolStatus } from "../lib/ops/tools";
import { checkGate, opsExposure } from "../lib/ops/gate";
import { provisionOnBoot, provisionStatus } from "../lib/ops/keys-source";
import { autonomySummary, runOpsSweep } from "../lib/ops/autonomy";
import { buildStamp } from "../lib/ops/version";
import { throttleStats } from "../lib/ops/ratelimit";
import { broadcastEvent } from "../lib/ws-hub";

const router = Router();

/**
 * Jobs create real traffic against someone's asset, so creating/controlling them
 * follows the same policy as every other powerful surface: token when one is
 * configured, same-origin browser calls otherwise (and never anonymous writes).
 */
function opsAllowed(req: Request): boolean {
  return checkGate(req, "ops").ok;
}

function deny(res: Response, why = ""): void {
  res.status(403).json({
    ok: false,
    error: "ops_write_requires_token",
    note: "إنشاء/تحكم المهام محتاج NOVA_EXEC_TOKEN (هيدر x-nova-token أو ?token=) — أو طلب من نفس اللوحة. القراءة مفتوحة.",
    why: why || undefined,
  });
}

startJobPump();

/* ── catalogue ───────────────────────────────────────────────────────────── */

router.get("/ops/kinds", (_req: Request, res: Response) => {
  const tools = toolStatus();
  res.json({
    ok: true,
    total: KIND_LIST.length,
    kinds: KIND_LIST.map((k) => ({ ...k, present: k.binary ? tools.find((t) => t.bin === k.binary)?.present ?? false : true })),
    tools,
    execPlane: {
      allowNodeTools: process.env.NOVA_ALLOW_NODE_TOOLS !== "0",
      nodeToolsPresent: tools.filter((t) => t.present).map((t) => t.bin),
    },
  });
});

// حالة كتالوج برامج الـ bug bounty — سياق للنطاقات، مش مصدر إذن.
// ?host=example.com → مين البرنامج اللي بغطي الهوست ده (ولو مافيش، ليه).
router.get("/ops/bounty/catalog", (req: Request, res: Response) => {
  const st = catalogStatus();
  const raw = String(req.query.host || "").trim().toLowerCase();
  if (!raw) {
    res.json(st);
    return;
  }
  const clean = raw.replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0];
  res.json({ ...st, host: clean, match: lookupBountyProgram(clean) });
});

/* ── programs / scope ────────────────────────────────────────────────────── */

router.get("/ops/programs", (req: Request, res: Response) => {
  // the registry IS the authorization: which programs, which hosts. A stranger
  // reading it learns the target list, so it is gated like the job files.
  if (!readGuarded(req, res, "/ops/programs")) return;
  const file = loadPrograms();
  res.json({
    ok: true,
    count: file.programs.length,
    updatedAt: file.updatedAt ?? null,
    programs: file.programs,
    note:
      file.programs.length === 0
        ? "مفيش برنامج مضاف — أي فحص نشط هيترفض. ضيف من /bug-bounty-studio أو POST /api/ops/programs."
        : null,
  });
});

router.post("/ops/programs", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const id = String(b.id ?? "").trim();
  const name = String(b.name ?? id).trim();
  const hosts = Array.isArray(b.hosts) ? (b.hosts as unknown[]).map(String) : String(b.hosts ?? "").split(/[,\s]+/).filter(Boolean);
  if (!id || hosts.length === 0) {
    res.status(400).json({ ok: false, error: "مطلوب id و hosts (نطاق واحد على الأقل)" });
    return;
  }
  // security.txt first: a program with a published policy is a safer yes than a guess
  const st = await fetchSecurityTxt(hosts[0]!.replace(/^\*\./, ""));
  const program = upsertProgram({
    id,
    name,
    hosts,
    platform: b.platform ? String(b.platform) : undefined,
    exact: Array.isArray(b.exact) ? (b.exact as unknown[]).map(String) : undefined,
    cidrs: Array.isArray(b.cidrs) ? (b.cidrs as unknown[]).map(String) : undefined,
    out_of_scope: Array.isArray(b.out_of_scope) ? (b.out_of_scope as unknown[]).map(String) : undefined,
    max_rps: b.max_rps === undefined ? undefined : Number(b.max_rps),
    max_concurrency: b.max_concurrency === undefined ? undefined : Number(b.max_concurrency),
    passive_only: Boolean(b.passive_only),
    policy_url: b.policy_url ? String(b.policy_url) : st.url,
    enabled: b.enabled !== false,
    notes_ar: b.notes_ar ? String(b.notes_ar) : st.found ? `security.txt: ${st.contact.join(" , ")}`.slice(0, 200) : undefined,
  });
  res.json({ ok: true, program, securityTxt: { found: st.found, contact: st.contact, url: st.url ?? null } });
});

router.delete("/ops/programs/:id", (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason); return; }
  const removed = removeProgram(String(req.params.id));
  res.json({ ok: removed, removed });
});

/**
 * One-command onboarding for a human who does not read scope files.
 *   POST /api/ops/programs/discover { target: "example.com" }
 * Reads the target's own security.txt (and a HackerOne/Bugcrowd policy page when
 * given one), then registers the host in passive-only mode. Active probing needs
 * the verbatim consent sentence, so no bot can flip it by guessing.
 */
router.post("/ops/programs/discover", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const proposal = await discoverProgram(body.target ?? body.host ?? "", {
    register: body.register !== false,
    activate: body.activate ? String(body.activate) : undefined,
    name: body.name ? String(body.name) : undefined,
  });
  if (!proposal.ok) {
    res.status(400).json(proposal);
    return;
  }
  try {
    broadcastEvent("nova-ops", { type: "program.discovered", host: proposal.host, registered: proposal.registered });
  } catch {
    /* the bus is best-effort; the file is the truth */
  }
  res.status(proposal.registered ? 201 : 200).json(proposal);
});

router.post("/ops/programs/check", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const target = String(body.target ?? body.host ?? req.query.target ?? "");
  const decision = await assertAuthorized(normalizeHost(target), {
    programId: body.programId ? String(body.programId) : undefined,
    active: body.active !== false,
  });
  res.json(decision);
});

router.get("/ops/programs/security-txt", async (req: Request, res: Response) => {
  const host = String(req.query.host ?? "");
  if (!host) {
    res.status(400).json({ ok: false, error: "host required" });
    return;
  }
  const st = await fetchSecurityTxt(host);
  res.json({ ok: st.found, ...st, raw: undefined });
});

/* ── jobs ────────────────────────────────────────────────────────────────── */

/**
 * Job reads expose the findings themselves: which hosts are being worked, what
 * was proven, and the evidence paths. On a guarded hub (NOVA_EXEC_TOKEN set) they
 * are gated exactly like writes — same-origin (the panel) or the token. With no
 * token configured nothing changes, so local use stays one curl simple.
 */
function readGuarded(req: Request, res: Response, path: string): boolean {
  // `SENSITIVE_READS` is matched against the full API path, so the scope label has
  // to carry it — "ops /ops/jobs" would match nothing and the gate would be theatre.
  const scope = `ops /api${path}`;
  const g = checkGate(req, scope);
  if (g.ok) return true;
  res.status(403).json({ ok: false, error: g.code, reason: g.reason, how: g.how, endpoint: path });
  return false;
}


router.post("/ops/jobs", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const target = String(b.target ?? b.host ?? "");
  if (!target) {
    res.status(400).json({ ok: false, error: "target required" });
    return;
  }
  const result = await createJob({
    name: b.name ? String(b.name) : undefined,
    objective: b.objective ? String(b.objective) : undefined,
    target,
    programId: b.programId ? String(b.programId) : undefined,
    scheme: b.scheme === "http" ? "http" : "https",
    depth: b.depth === "passive" || b.depth === "deep" ? b.depth : "standard",
    tools: b.tools !== false,
    maxTasks: b.maxTasks ? Number(b.maxTasks) : undefined,
    taskIds: Array.isArray(b.taskIds) ? (b.taskIds as unknown[]).map(String) : undefined,
  });
  if (!result.ok || !result.job) {
    res.status(403).json({ ok: false, error: result.error, denial: result.denial, hint: "ضيف البرنامج أولًا: POST /api/ops/programs" });
    return;
  }
  const autoRun = b.run !== false;
  if (autoRun) void runJob(result.job.id).catch(() => undefined);
  res.status(201).json({
    ok: true,
    job: result.job,
    started: autoRun,
    next: `GET /api/ops/jobs/${result.job.id}`,
  });
});

router.get("/ops/jobs", (req: Request, res: Response) => {
  if (!readGuarded(req, res, "/ops/jobs")) return;
  const limit = Math.min(100, Number(req.query.limit ?? 25));
  res.json({ ok: true, jobs: listJobs(limit) });
});

router.get("/ops/jobs/:id", (req: Request, res: Response) => {
  if (!readGuarded(req, res, "/ops/jobs/:id")) return;
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ ok: false, error: "job-not-found", id: req.params.id });
    return;
  }
  res.json({
    ok: true,
    job,
    live: { running: isJobRunning(job.id) },
    plan: suggestPlan({ target: job.host, depth: "standard", tools: true }),
  });
});

router.post("/ops/jobs/:id/run", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason); return; }
  const job = await runJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ ok: false, error: "job-not-found" });
    return;
  }
  res.json({ ok: true, job });
});

for (const [verb, fn] of [
  ["pause", pauseJob],
  ["resume", resumeJob],
  ["cancel", cancelJob],
] as const) {
  router.post(`/ops/jobs/:id/${verb}`, (req: Request, res: Response) => {
    if (!opsAllowed(req)) { deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason); return; }
    const ok = fn(String(req.params.id));
    res.json({ ok, action: verb, id: req.params.id, job: ok ? getJob(String(req.params.id)) : null });
  });
}

router.post("/ops/jobs/:id/verify", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason); return; }
  const jobId = String(req.params.id);
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: "job-not-found" });
    return;
  }
  const only = req.body && (req.body as Record<string, unknown>)["findingId"];
  const targets = only ? job.findings.filter((f) => f.id === String(only)) : job.findings.filter((f) => !f.verified);
  const results = [];
  for (const f of targets.slice(0, 25)) {
    const r = await verifyFinding(jobId, f.id);
    results.push({ findingId: f.id, title: f.title, ...(r ?? { ok: false, reproduced: false, detail: "no-result" }) });
  }
  res.json({ ok: true, verified: results.filter((r) => r.reproduced).length, total: results.length, results, job: getJob(jobId) });
});

router.get("/ops/jobs/:id/report", (req: Request, res: Response) => {
  if (!readGuarded(req, res, "/ops/jobs/:id")) return;
  const jobId = String(req.params.id);
  const include = req.query.includeUnverified === "1";
  const md = buildReport(jobId, { includeUnverified: include });
  if (!md) {
    res.status(404).json({ ok: false, error: "job-not-found" });
    return;
  }
  if (req.query.format === "json") {
    const job = getJob(jobId)!;
    res.json({ ok: true, job, markdownLength: md.length, reportable: job.findings.filter((f) => f.verified).length });
    return;
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cybernova-${jobId}.md"`);
  res.send(md);
});

/**
 * Did the free install pick up its keys and its scope? Names only — a status
 * endpoint that echoed values would put secrets in logs and in the browser.
 */
/** Which bundle is running, and what this box can really do. Read-only, nothing secret. */
router.get("/ops/version", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...buildStamp() });
});

router.get("/ops/provision", (_req: Request, res: Response) => {
  res.json({ ok: true, ...(provisionStatus() ?? { keys: null, scope: null }), hint_ar: "المفاتيح من NOVA_KEYS_URL/NOVA_KEYS_FILE، والنطاقات من NOVA_SCOPE_DOMAINS (استطلاع بس)." });
});

/** Re-run provisioning without a restart — free hosts restart rarely and should not have to. */
router.post("/ops/provision/reload", async (_req: Request, res: Response) => {
  res.json({ ok: true, ...(await provisionOnBoot()) });
});

/**
 * The background sweep, on demand. Same code path the 3-minute daemon pulse
 * uses, exposed so a human can see what “always-on” will actually do before
 * trusting it — and so `NOVA_OPS_AUTONOMY=off` boxes can still be driven by hand.
 */
router.get("/ops/sweep", (_req: Request, res: Response) => {
  res.json({ ok: true, ...autonomySummary(), policy: "passive-by-default · one sweep per program per window · bounded tasks" });
});

router.post("/ops/sweep", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) {
    deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason);
    return;
  }
  const force = req.body?.force === true;
  const result = await runOpsSweep();
  if (!result.ran && force) {
    // `force` ignores the per-program cooldown, it does not ignore the scope gate.
    res.json({ ...result, forced: true, note: "force بيخطّي نافذة الاستراحة بس — البوابة والسقف فضلوا زي ما هم" });
    return;
  }
  res.json({ ...result, summary_ar: result.started.length ? `بدأت ${result.started.length} job حقيقي في الخلفية` : (result.reason ?? "مفيش شغل مستحق دلوقتي") });
});

router.get("/ops/stats", (req: Request, res: Response) => {
  if (!readGuarded(req, res, "/ops/stats")) return;
  const { active, snapshot, dir } = runnerStats();
  res.json({
    ok: true,
    runningJobs: active,
    throttle: snapshot,
    throttleByHost: throttleStats(),
    jobsDir: dir,
    pumpIntervalMs: 3000,
    // the manager page has to be able to say «إيه اللي مقفول ولماذا» without a
    // second request — exposure + autonomy are part of the machine's state.
    exposure: opsExposure(),
    autonomy: autonomySummary(),
  });
});

export default router;
