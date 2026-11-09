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
 *   GET   /api/ops/findings/status      حالة خزانة النتائج (المخزن الوحيد)
 *   GET   /api/ops/findings             النتايج مجمّعة من كل المهام (+ الكتالوج القديم)
 *   POST  /api/ops/findings/sync        يلمّ شغل المحرك في الخزانة — idempotent
 *   GET   /api/ops/findings/:key/report-draft  مسودة إفصاح (409 لو مش مثبتة)
 *   GET   /api/ops/hunt/candidates      مرشّحين من كتالوج المكافآت (سياق، بلا إذن)
 *   POST  /api/ops/hunt/plan            نطاق → security.txt + خطة أنواع، من غير تسجيل
 *   GET   /api/ops/tools                الأدوات المقاسة على المكنة دي (موجود/ناقص)
 *   POST  /api/ops/tools/provision      ينزّل الأدوات الثابتة في vendor/bin (مُبوّب)
 */
import { Router, type Request, type Response } from "express";
import { catalogStatus, lookupBountyProgram, huntCandidates } from "../lib/ops/bounty-catalog";
import { listVault, syncFromJobs, draftReport, vaultStatus } from "../lib/ops/findings-vault";
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
import { fetchList, listInventory, listSources, readFreeStore } from "../lib/ops/wordlist";
import { provisionToolchain, toolchainStatus, VENDORABLE } from "../lib/ops/toolchain";
import { checkGate, opsExposure } from "../lib/ops/gate";
import { ALLOWED_KEYS, hydrateRuntimeConfig, runtimeConfigStatus, setRuntimeConfig } from "../lib/ops/runtime-config";
import { measureStateFootprint, pruneState, lastPrune } from "../lib/ops/state-prune";
import { provisionOnBoot, provisionStatus } from "../lib/ops/keys-source";
import { autonomySummary, runOpsSweep } from "../lib/ops/autonomy";
import { maskProgram, maskSession, hasSession } from "../lib/ops/session";
import { libraryStatus, lookupCve, lookupProduct, syncAdvisories } from "../lib/ops/advisory-library";
import { corpusStatus, readIndex, queryCorpus } from "../lib/ops/vuln-corpus";
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

/**
 * كوربوس الثغرات الحقيقي (NVD + KEV + EPSS).
 * GET /api/ops/corpus                العدد المقاس + توزيعه + تاريخ السحب
 * GET /api/ops/corpus?product=nginx  ثغرات منتج معيّن من الكوربوس
 * GET /api/ops/corpus?cve=CVE-2024-3094
 */
router.get("/ops/corpus", async (req: Request, res: Response) => {
  const st = corpusStatus();
  const index = readIndex();
  const product = String(req.query.product ?? "").trim();
  const cve = String(req.query.cve ?? "").trim();
  let query: Awaited<ReturnType<typeof queryCorpus>> | null = null;
  if (product || cve) {
    query = await queryCorpus({
      product: product || undefined,
      cve: cve || undefined,
      minCvss: req.query.minCvss === undefined ? undefined : Number(req.query.minCvss),
      kevOnly: req.query.kev === "1",
      limit: req.query.limit === undefined ? 20 : Number(req.query.limit),
    });
  }
  res.json({
    ok: true,
    ...st,
    byYear: index?.byYear ?? null,
    topProducts: index?.topProducts ?? null,
    sources: index?.sources ?? null,
    mode: index?.mode ?? null,
    query,
    how_ar:
      "المصدر NVD 2.0 + CISA KEV + EPSS. الرقم من ملف الفهرس المكتوب بالسحب، مش تقدير. " +
      "لو القرص مش فيه الملف: نزّله من release tag «vuln-corpus» أو شغّل scripts/ingest-vuln-corpus.mjs",
  });
});

/**
 * مكتبة الإشعارات — الرقم اللي بيتعرض هو اللي اتجاب فعلاً، مع وقته.
 * GET  /api/ops/advisories          الحالة + التوزيع
 * GET  /api/ops/advisories/lookup   ?product=nginx | ?cve=CVE-2026-12345
 * POST /api/ops/advisories/sync     مزامنة حقيقية من GitHub Advisory DB
 */
router.get("/ops/advisories", (req: Request, res: Response) => {
  const st = libraryStatus();
  const product = String(req.query.product ?? "").trim();
  const cve = String(req.query.cve ?? "").trim();
  res.json({
    ok: true,
    ...st,
    lookup: product ? lookupProduct(product, 20) : cve ? [lookupCve(cve)].filter(Boolean) : null,
    how_ar: "المصدر: api.github.com/advisories — الرقم ده اللي اتسحب فعلاً، مش تقدير. مزامنة: POST /api/ops/advisories/sync",
  });
});

router.post("/ops/advisories/sync", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) {
    deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason);
    return;
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const pages = b.pages === undefined ? 10 : Number(b.pages);
  const result = await syncAdvisories({ pages, since: b.since ? String(b.since) : undefined });
  const st = libraryStatus();
  res.status(result.cache.total > 0 ? 200 : 502).json({
    ok: result.ok,
    pages_fetched: result.pages_fetched,
    total: result.cache.total,
    bySeverity: result.cache.bySeverity,
    at: result.cache.at || null,
    error: result.error ?? null,
    status: st,
    note_ar: result.ok
      ? `اتسحب ${result.cache.total} إشعار حقيقي في ${result.pages_fetched} صفحة — ده اللي في المكتبة دلوقتي، مش إجمالي العالم.`
      : "المزامنة فشلت — المكتبة القديمة زي ما هي، مفيش أرقام جديدة اتكتبت.",
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

/* ── findings vault: الخزانة الوحيدة، والمسودة بميولها مش بالكلام ──────────────── */

// حالة الخزانة: موجودة؟ كام نتيجة؟ كام واحدة متأكد منها؟ (القراءة مفتوحة زي باقي الـGETs)
router.get("/ops/findings/status", (_req: Request, res: Response) => {
  res.json({ ok: true, ...vaultStatus() });
});

router.get("/ops/findings", (req: Request, res: Response) => {
  const q = {
    host: String(req.query.host || ""),
    severity: String(req.query.severity || ""),
    verifiedOnly: req.query.verified === "true" || req.query.verified === "1",
    limit: Number(req.query.limit) || undefined,
  };
  res.json({ ok: true, ...listVault(q) });
});

/**
 * يلمّ نتائج كل المهام المرصودة في الخزانة. كتابة على `state/` — فالـtoken مطلوب.
 * idempotent بالقياس: تشغيله مرّتين بيضيف `occurrences` ومابيضاعف السطور (محروس في live-verify).
 */
router.post("/ops/findings/sync", (req: Request, res: Response) => {
  if (!opsAllowed(req)) {
    deny(res, checkGate(req, "ops").how || checkGate(req, "ops").reason);
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const r = syncFromJobs({ limit: Number(body.limit) || undefined });
  try {
    broadcastEvent("nova-ops", { type: "findings.synced", total: r.total, verified: r.verified });
  } catch {
    /* الناقلة best-effort؛ الملف هو الحقيقة */
  }
  res.json({ ok: true, ...r });
});

/**
 * مسودة إفصاح لنتيجة واحدة. **409 بالاسم** لو ماعدش إنتاجها — لأن مسودة «ربما»
 * بتدخل عند آدمي بيقرأ، وده أسوأ من مافيش مسودة.
 */
router.get("/ops/findings/:key/report-draft", (req: Request, res: Response) => {
  const d = draftReport(String(req.params.key));
  if (!d.ok) {
    res.status(d.error === "not-found" ? 404 : 409).json({ ...d, key: req.params.key });
    return;
  }
  res.json({ ok: true, key: req.params.key, length: (d.markdown || "").length, markdown: d.markdown });
});

/* ── hunt surface: من الكتالوج لهدف مختار بخطّة، مش بالعكس ─────────────────────── */

/**
 * `GET /api/ops/hunt/candidates?limit=12&minEfficiency=80&platform=hackerone&q=nba`
 * بيشيل اللي مالبهاش مكافأة والموقوفة/المقفولة استقبال، وبردّب على جودة الاستجابة الأول.
 * الرد نفسه بيقول بصراحة: ولا سطر هنا إذن (`consented:false` متفرض، مش مقروء).
 */
router.get("/ops/hunt/candidates", (req: Request, res: Response) => {
  const c = huntCandidates({
    limit: Number(req.query.limit) || undefined,
    platform: String(req.query.platform || ""),
    minEfficiency: req.query.minEfficiency === undefined ? undefined : Number(req.query.minEfficiency),
    q: String(req.query.q || ""),
    includeClosed: req.query.includeClosed === "true" || req.query.includeClosed === "1",
  });
  const hosts = new Set<string>();
  try {
    for (const p of loadPrograms().programs || []) {
      for (const h of [...(p.hosts || []), ...(p.exact || [])]) hosts.add(String(h).replace(/^\*\./, "").toLowerCase());
    }
  } catch {
    /* مافيش سجل برامج بعد — مسجّل:false لكل مرشّح، وده رد صحيح مش فشل */
  }
  const items = c.items.map((x) => ({ ...x, registered: x.sample_hosts.some((h) => hosts.has(String(h).replace(/^\*\./, "").toLowerCase())) }));
  res.json({
    ok: true,
    ...c,
    items,
    permissionModel: "الكتالوج سياق بس: `consented:false` و`mode:\"passive_only\"` بيتفرضوا في كل سطر. الفحص النشط محتاج الإذن المكتوب في program_discover.",
  });
});

/**
 * `POST /api/ops/hunt/plan { target }` → قراءة security.txt + مطابقة الكتالوج + خطة
 * الأنواع، **من غير ما يسجّل حاجة**. الده كان الناقص: عندك 746 برنامج ومافيش طريق
 * يقولي «إيه اللي يوصلني لخطة على واحد منهم» بطلب واحد.
 */
router.post("/ops/hunt/plan", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const target = String(body.target ?? body.host ?? "");
  const proposal = await discoverProgram(target, { register: false });
  const plan = proposal.ok && proposal.program ? suggestPlan({ target: proposal.host, depth: body.depth ? String(body.depth) as never : undefined, tools: body.tools === true }) : null;
  res.status(proposal.ok ? 200 : 400).json({ ok: proposal.ok, host: proposal.host, proposal, plan });
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
    // masks `session` on every program: a reader learns that a credential exists
    // and its fingerprint, never the credential.
    programs: file.programs.map((p) => maskProgram(p)),
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
    // Authenticated scanning. Stored, never echoed: the response below goes through
    // maskProgram() so only header names + a fingerprint come back.
    session: (b.session ?? undefined) as import("../lib/ops/session").ProgramSession | undefined,
    policy_url: b.policy_url ? String(b.policy_url) : st.url,
    enabled: b.enabled !== false,
    notes_ar: b.notes_ar ? String(b.notes_ar) : st.found ? `security.txt: ${st.contact.join(" , ")}`.slice(0, 200) : undefined,
  });
  res.json({
    ok: true,
    program: maskProgram(program),
    securityTxt: { found: st.found, contact: st.contact, url: st.url ?? null },
    session: {
      ...maskSession(program.session),
      how_ar: hasSession(program.session)
        ? "الجلسة اتحفظت — الأفواج الجاية هتشتغل بيها. القيمة نفسها مش بتترجع من الـAPI أبداً."
        : "مفيش جلسة — الفحص anonymous (كل حاجة ورا login مش هتتشاف).",
    },
  });
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

/* ── الإيدين: الأدوات الحقيقية على المكنة دي ───────────────────────────────────
 * دي الطبقة اللي بتحوّل «مافيش أدوات» من عذر لتفاصيل: القراءة دايمًا مفتوحة
 * (زي /api/ops/version) عشان المحرك والصفحة يقولوا الحجم الحقيقي، والتنزيل
 * خلف البوابة لأنه spawn فعلي. مافيش رد هنا بيؤكد نجاح من غير قياس —
 * toolchainStatus() بيقرا القرص، والحالة بعد provisioning بتتقاس من جديد. */

/* ── قناة الضبط الدائمة (POST gated · GET booleans فقط — القيم عمرها ما ترجع) ──
 * السبب المقاس: توكن تليجرام اتسلّم في الشات 2026-11-09، وحوّالين الـenv على
 * المضيف المجاني محتاجين إيد. ده بديل آمن: CI بدفع الإعداد بالتوكن التنفيذي،
 * والسيرفر يقفله في الذاكرة الدائمة (Supabase Edge) فينجو من الريستارت. */

router.get("/ops/config/status", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    // بيرجع «موجود؟» بس — عمر أي رد ما يحتوي القيمة نفسها.
    keys: runtimeConfigStatus(),
    allowedKeys: Object.entries(ALLOWED_KEYS).map(([k, s]) => ({ key: k, labelAr: s.labelAr, sensitive: Boolean(s.sensitive) })),
    hydrated: true,
  });
});

router.post("/ops/config", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, "ضبط إعدادات دائمة = كتابة على المكنة، فمحتاج NOVA_EXEC_TOKEN زي أي كتابة تانية."); return; }
  const key = String(req.body?.key || "").trim();
  const value = String(req.body?.value ?? "");
  const r = await setRuntimeConfig(key, value);
  if (!r.ok) { res.status(400).json({ ok: false, error: "invalid", reasonAr: r.reasonAr, status: runtimeConfigStatus() }); return; }
  broadcastEvent("nova-ops", { type: "runtime-config", key, set: Boolean(value.trim()) });
  res.json({ ok: true, key, status: runtimeConfigStatus() });
});

/* رسالة اختبار حقيقية عبر القناة بعد الضبط — تقيس end-to-end لا تتظاهر. */
/* حالة قناة التليجرام الحقيقية — getMe/getUpdates متقاسَين لحظيًا، من غير التوكن نفسه. */
router.get("/ops/telegram/status", async (_req: Request, res: Response) => {
  try {
    const { telegramStatus } = await import("../lib/ops/telegram");
    res.json({ ok: true, ...(await telegramStatus()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/ops/config/test-telegram", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, "إرسال اختباري = كتابة، فمحتاج NOVA_EXEC_TOKEN زي أي كتابة تانية."); return; }
  const { notifyTelegram, telegramConfigured } = await import("../lib/ops/telegram");
  if (!telegramConfigured()) {
    res.status(400).json({ ok: false, reasonAr: "مفيش botToken عند العقدة — احفظه الأول (من هنا أو من خطوة CI اليدوية)" });
    return;
  }
  const sent = await notifyTelegram(
    "config.test",
    "🧪 <b>NOVA</b> — رسالة اختبار من لوحة الإعدادات: قناة التليجرام شغالة end-to-end ✓",
    { minIntervalMs: 15_000 },
  );
  res.json({
    ok: sent,
    ...(sent ? {} : { reasonAr: "التليجرام لم يقبل أو الـchat_id لسه مجهول — ابعت /start للبوت من تليجرامك ثم أعد المحاولة" }),
  });
});

router.get("/ops/tools", (_req: Request, res: Response) => {
  const st = toolchainStatus();
  res.json({ ok: true, ...st, kinds: toolStatus(), catalogue: [...VENDORABLE], env: { NOVA_TOOL_DIR: process.env.NOVA_TOOL_DIR || null } });
});

/**
 * `POST /api/ops/tools/provision {only?: "nuclei,httpx"}`
 * بيشغّل `scripts/fetch-toolchain.mjs` (نسخ ثابتة من GitHub، بلا root، بلا shell)
 * وبيرجّع القياس **بعد** التنفيذ، مش ادعاء. الباندل اللي مالوش `ops/` بيردّ
 * `vendorer-missing` بدل ما يخترع نجاحًا.
 */
router.post("/ops/tools/provision", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, "تنزيل أدوات = تشغيل عملية على المكنة، فمحتاج NOVA_EXEC_TOKEN زي أي كتابة تانية."); return; }
  const only = String(req.body?.only || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  const rec = await provisionToolchain({ only: only.length ? only : undefined });
  broadcastEvent("nova-ops", { type: "toolchain", ok: rec.ok, installed: rec.installed, total: rec.total, ms: rec.ms });
  res.status(rec.ok ? 200 : 502).json({ ok: rec.ok, ran: rec.ran ?? false, record: rec, status: toolchainStatus() });
});

/* ── القرايات: إيه المدمج، إيه المنجلب، وإيه اللي ماجاش ────────────────────────
 * التخزين المجاني (جيت هاب/درايف/دروبوكس) بقى جزء من التصميم لأن سلوت المكنة
 * 1024MB و460MB رام (متقاس)، فملف 1.9MB مش من العقل إنه يركب في كل حزمة. والقراءة
 * هنا مفتوحة زي `/api/ops/tools`: كل رقم فيها محسوب من القرص، والمرآات المُعلَنة
 * بتتقال كأسماء — «مبنزّلهاش» مش «نزّلناها فاضية». */

/* ── القرص: قياس بصمة الحالة + تنظيف سياسي معلن (مش حذف عشوائي) ─────── */
router.get("/ops/state", (_req: Request, res: Response) => {
  res.json({ ok: true, footprint: measureStateFootprint(), lastPrune: lastPrune(), noteAr: "الذاكرة/الإعدادات بتتعاكس تلقائيًا على Supabase Edge (برّه القرص)؛ هنا بنقيس اللي فاضل محليًا وننظفه بسياسة معلنة." });
});

router.post("/ops/state/prune", (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, "حذف أدلة = كتابة على قرص المكنة، فمحتاج NOVA_EXEC_TOKEN زي أي كتابة تانية."); return; }
  const report = pruneState();
  broadcastEvent("nova-ops", { type: "state-prune", removed: report.removed, freedBytes: report.freedBytes, kept: report.kept });
  res.json({ ok: true, report });
});

router.get("/ops/wordlists", (_req: Request, res: Response) => {
  const inv = listInventory();
  const store = readFreeStore();
  res.json({
    ok: true,
    ...inv,
    provenance: store?.source ?? null,
    policy: store?.policy ?? null,
    declared: store ? Object.keys(store.files || {}).map((n) => ({ name: n, sources: listSources(store, n).map((x) => x.provider) })) : [],
    env: { NOVA_WORDLIST: process.env.NOVA_WORDLIST || null, NOVA_WORDLIST_SIZE: process.env.NOVA_WORDLIST_SIZE || null },
  });
});

/**
 * `POST /api/ops/wordlists/fetch {name?, timeoutMs?, maxBytes?}`
 * بيجيب ملفًا من المرآة ويحقّق `sha256` المستودع **قبل** أي استعمال؛ الفشل بيرجّع
 * سطر لكل مصدر. الكتابة دي شبكة على المكنة فهي ورا `NOVA_EXEC_TOKEN` زي provisioning.
 */
router.post("/ops/wordlists/fetch", async (req: Request, res: Response) => {
  if (!opsAllowed(req)) { deny(res, "تنزيل قايمة من التخزين المجاني = عملية شبكة على المكنة، فمحتاج NOVA_EXEC_TOKEN."); return; }
  const name = String(req.body?.name || "nova-subdomains-xl.txt").trim();
  const timeoutMs = Number(req.body?.timeoutMs) || undefined;
  const maxBytes = Number(req.body?.maxBytes) || undefined;
  const rec = await fetchList(name, { timeoutMs, maxBytes });
  broadcastEvent("nova-ops", { type: "wordlist", name, verified: rec.verified, bytes: rec.bytes, source: rec.source });
  res.status(rec.verified ? 200 : 502).json({ ok: rec.verified, record: rec, inventory: listInventory() });
});

export default router;
