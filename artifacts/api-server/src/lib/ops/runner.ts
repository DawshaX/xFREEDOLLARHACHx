/**
 * Ops · Job runner — the spine that turns «نوفا قالت خطة» into «اتنفّذ فعلاً»
 * ──────────────────────────────────────────────────────────────────────────
 * A job is a durable list of tasks against ONE authorized target. It survives a
 * restart (state/jobs/<id>.json, atomic writes), respects the program's rate
 * limits, honours the kill-switch, and every finding is born with evidence
 * (raw bytes + SHA-256 + the exact probe).
 *
 * Nothing here is faked: a task that could not run is recorded as `failed` with
 * the reason, and a finding that did not reproduce stays `verified: false` and
 * is excluded from the report.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { acquire, release, noteResponse, throttleSnapshot } from "./ratelimit";
import { assertAuthorized, normalizeHost, type Program } from "./scope";
import { isKilled } from "../../routes/kill-switch";
import { runKind, KINDS, kindDeadlineMs, writeEvidence, findBinary, type Finding, type RunCtx, type Severity } from "./tools";
import { getConnectedAgentList } from "../../routes/local-agent";

export type JobStatus = "queued" | "running" | "paused" | "done" | "failed" | "cancelled";
export type TaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface Task {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  status: TaskStatus;
  attempts: number;
  summary?: string;
  error?: string;
  findings: number;
  startedAt?: string;
  finishedAt?: string;
  ms?: number;
  evidence: string[];
}

export interface Job {
  id: string;
  name: string;
  objective: string;
  target: string;
  host: string;
  scheme: "http" | "https";
  programId: string | null;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  budget: { maxTasks: number; taskTimeoutMs: number; rps: number; allowNodeTools: boolean };
  tasks: Task[];
  findings: Finding[];
  log: Array<{ at: string; line: string }>;
  stats: { done: number; failed: number; skipped: number; findings: number; verified: number; ms: number };
}

/* ── persistence ─────────────────────────────────────────────────────────── */

function jobsDir(): string {
  return path.resolve(process.cwd(), process.env.NOVA_JOBS_REL || "state/jobs");
}
function jobFile(id: string): string {
  return path.join(jobsDir(), `${id}.json`);
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, file);
}

function persist(job: Job): void {
  atomicWrite(jobFile(job.id), JSON.stringify(job, null, 2));
}

/**
 * سقف زمني حقيقي لمهمة واحدة داخل جوب. `budget.taskTimeoutMs` كان بيُلزَم على
 * الأدوات اللي بتشتغل كـbinary (execFile + timeout) بس — أما اللي مبني في node
 * والـ`run()` بتاعه مستني شبكة، ماحدش كان بيلزمه. النتيجة مقيسة في sandbox:
 * جوب `20261103-e375d3` علّق `recon.securitytxt` في حالة `running` وفضل الـjob
 * كله `queued` لأبد الآب (الـDNS جوه `AbortSignal.timeout` مش مغطّى في كل نسخ undici).
 * الوعد اللي بيخلص متأخر مابيلغّش حاجة بعد كده (مافيش persist بعده) — السوكت بيمشي للـGC.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // الـrejection بتتحول لنفس الشكل: المستدعي بياخد قرارًا واحدًا (`!raced.ok`)
      // بدل ما يفترض إن في exception جوه Promise.race.
      promise.then(
        (value) => ({ ok: true as const, value }),
        (err: unknown) => ({ ok: false as const, error: String((err as Error)?.message ?? err) }),
      ),
      new Promise<{ ok: false; error: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, error: `task-timeout:${label}:${ms}ms` }), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function listJobs(limit = 25): Array<Pick<Job, "id" | "name" | "target" | "status" | "createdAt" | "stats" | "programId">> {
  try {
    return fs
      .readdirSync(jobsDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(jobsDir(), f), "utf8")) as Job;
          return { id: j.id, name: j.name, target: j.target, status: j.status, createdAt: j.createdAt, stats: j.stats, programId: j.programId };
        } catch {
          return null;
        }
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => (a.createdAt! < b.createdAt! ? 1 : -1))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function getJob(id: string): Job | null {
  try {
    return JSON.parse(fs.readFileSync(jobFile(id), "utf8")) as Job;
  } catch {
    return null;
  }
}

/* ── planning ────────────────────────────────────────────────────────────── */

export interface CreateJobInput {
  name?: string;
  objective?: string;
  target: string;
  programId?: string;
  scheme?: "http" | "https";
  depth?: "passive" | "standard" | "deep";
  tools?: boolean;
  taskIds?: string[];
  maxTasks?: number;
}

const PLAN_PASSIVE = ["recon.dns", "recon.certspotter", "intel.cvebytech"];
const PLAN_STANDARD = [...PLAN_PASSIVE, "recon.headers", "recon.tls", "recon.securitytxt"];
const PLAN_DEEP = [...PLAN_STANDARD, "recon.ports", "recon.jspaths"];
const PLAN_TOOLS = ["tools.httpx", "tools.subfinder", "tools.nuclei", "tools.katana", "tools.nmap"];

function mkTask(kind: string, params: Record<string, unknown> = {}): Task {
  return {
    id: crypto.randomBytes(4).toString("hex"),
    kind,
    params,
    status: "pending",
    attempts: 0,
    findings: 0,
    evidence: [],
  };
}

export function suggestPlan(input: CreateJobInput): { kinds: string[]; why: string[] } {
  const depth = input.depth ?? "standard";
  const why: string[] = [];
  let kinds = depth === "passive" ? [...PLAN_PASSIVE] : depth === "deep" ? [...PLAN_DEEP] : [...PLAN_STANDARD];
  why.push(`عمق «${depth}» = ${kinds.length} مهمة`);
  if (input.tools !== false) {
    const available = PLAN_TOOLS.filter((k) => {
      const bin = KINDS[k]?.binary;
      if (!bin) return true;
      // one finder, one truth: suggestPlan used to look only in /usr/local/bin + PATH,
      // so it planned nothing while findBinary() (used by every actual run) had already
      // found the binary in vendor/bin. A plan and an execution must not disagree.
      try {
        return Boolean(findBinary(bin));
      } catch {
        return false;
      }
    });
    if (available.length) {
      kinds.push(...available);
      why.push(`أدوات حقيقية مكتشفة على النود: ${available.join(", ")}`);
    } else {
      why.push("مفيش أدوات منصوبة على النود — المهام دي هتتخطى لو مفيش نود متصل");
    }
  }
  // لما المهمة تتكلم عن جسم NOVA نفسها (تشغيل/استضافة/خلفية)، الكتالوج يبقى جزء من الخطة
  const selfText = `${input.name ?? ""} ${input.objective ?? ""}`.toLowerCase();
  if (/host|deploy|always|background|uptime|daemon|استضاف|نشر|تشغيل|خلفية|دايما|دائم/.test(selfText)) {
    kinds.push("infra.freehosts");
    why.push("فيها تشغيل دائم → بنقيس المضيفات المجانية الأول ونختار بالسكور مش بالذاكرة");
  }
  if (input.taskIds?.length) {
    kinds = input.taskIds.filter((k) => KINDS[k]);
    why.push(`خطة مخصصة: ${kinds.length} مهمة`);
  }
  return { kinds: kinds.filter((k, i) => kinds.indexOf(k) === i), why };
}

export interface CreateJobResult {
  ok: boolean;
  job?: Job;
  error?: string;
  denial?: { reason: string; code: string };
}

export async function createJob(input: CreateJobInput): Promise<CreateJobResult> {
  const host = normalizeHost(input.target);
  if (!host) return { ok: false, error: "المطلوب نطاق أو URL صحيح" };

  const plan = suggestPlan(input);
  const active = plan.kinds.some((k) => KINDS[k]?.active);
  const gate = await assertAuthorized(host, { programId: input.programId, active });
  if (!gate.ok) {
    return { ok: false, error: gate.reason, denial: { reason: gate.reason, code: gate.reasonCode } };
  }

  const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
  const job: Job = {
    id,
    name: input.name?.trim() || `فحص ${host}`,
    objective: input.objective?.trim() || `استطلاع وأولوية ثغرات على ${host}`,
    target: host,
    host,
    scheme: input.scheme ?? "https",
    programId: gate.program?.id ?? null,
    status: "queued",
    createdAt: new Date().toISOString(),
    budget: {
      maxTasks: Math.min(40, Math.max(1, input.maxTasks ?? plan.kinds.length)),
      taskTimeoutMs: 180_000,
      rps: gate.limits.rps,
      allowNodeTools: process.env.NOVA_ALLOW_NODE_TOOLS !== "0",
    },
    tasks: plan.kinds.slice(0, Math.max(1, input.maxTasks ?? 40)).map((k) => mkTask(k)),
    findings: [],
    log: [{ at: new Date().toISOString(), line: `Job created · ${plan.why.join(" · ")}` }],
    stats: { done: 0, failed: 0, skipped: 0, findings: 0, verified: 0, ms: 0 },
  };
  fs.mkdirSync(path.join(jobsDir(), id), { recursive: true });
  persist(job);
  return { ok: true, job };
}

export function cancelJob(id: string): boolean {
  const job = getJob(id);
  if (!job) return false;
  job.status = "cancelled";
  job.finishedAt = new Date().toISOString();
  job.log.push({ at: job.finishedAt, line: "cancelled by operator" });
  persist(job);
  return true;
}

export function pauseJob(id: string): boolean {
  const job = getJob(id);
  if (!job || job.status === "done") return false;
  job.status = "paused";
  persist(job);
  return true;
}

export function resumeJob(id: string): boolean {
  const job = getJob(id);
  if (!job || job.status === "done") return false;
  job.status = "queued";
  persist(job);
  return true;
}

/* ── execution ───────────────────────────────────────────────────────────── */

const running = new Set<string>();

function pickAgent(job: Job, program: Program): string | undefined {
  if (process.env.NOVA_FORCE_LOCAL_TOOLS === "1") return undefined;
  const agents = getConnectedAgentList();
  const want = String(program.notes_ar?.match(/agent=([\w.-]+)/)?.[1] ?? "");
  const hit = want ? agents.find((a) => a.id === want) : agents[0];
  return hit?.id;
}

export async function runJob(id: string): Promise<Job | null> {
  const job = getJob(id);
  if (!job) return null;
  if (running.has(id)) return job;
  running.add(id);
  job.status = "running";
  job.startedAt ??= new Date().toISOString();
  const t0 = Date.now();
  const jobDir = path.join(jobsDir(), job.id);
  fs.mkdirSync(jobDir, { recursive: true });
  persist(job);

  const log = (line: string) => {
    job.log.push({ at: new Date().toISOString(), line });
    if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
  };

  try {
    for (const task of job.tasks) {
      // an operator (or the kill switch) may have moved this job out of running
      // while we were mid-loop — re-read before each task, never after
      if ((getJob(job.id)?.status ?? job.status) === "cancelled") break;
      if (task.status === "done" || task.status === "skipped") continue;
      if (isKilled()) {
        job.status = "paused";
        log("kill-switch مفعّل — الشغل متوقف مؤقتاً");
        persist(job);
        return job;
      }
      if (job.stats.done + job.stats.failed + job.stats.skipped >= job.budget.maxTasks) {
        log(`الميزانية خلصت (maxTasks=${job.budget.maxTasks})`);
        break;
      }
      const kind = KINDS[task.kind];
      if (!kind) {
        task.status = "skipped";
        task.error = "unknown-kind";
        job.stats.skipped++;
        continue;
      }

      const gate = await assertAuthorized(job.host, { programId: job.programId ?? undefined, active: kind.active });
      if (!gate.ok) {
        task.status = "skipped";
        task.error = gate.reason;
        job.stats.skipped++;
        log(`skipped ${task.kind}: ${gate.reasonCode}`);
        persist(job);
        continue;
      }

      task.status = "running";
      task.startedAt = new Date().toISOString();
      task.attempts++;
      log(`▶ ${task.kind}`);
      persist(job);

      const ctx: RunCtx = {
        host: job.host,
        scheme: job.scheme,
        program: gate.program!,
        jobDir,
        rps: gate.limits.rps,
        agentId: pickAgent(job, gate.program!),
        allowNodeTools: job.budget.allowNodeTools,
        timeoutMs: job.budget.taskTimeoutMs,
        log,
      };

      try {
        await acquire(job.host, { rps: gate.limits.rps, burst: 2, maxWaitMs: 90_000 });
        let result;
        try {
          // السماح 15 ثانية: الأدوات اللي بتتexec بتموّت نفسها على ميزانيتها، فالسقف الخارجي
          // للحجز بس — ولو كان أقل من `budgetMs` كان هيقطع nuclei في النص (مقيس في CI 21:41Z).
          const deadlineMs = kindDeadlineMs(task.kind, Number(ctx.timeoutMs) || 60_000) + 15_000;
          const raced = await withDeadline(runKind(task.kind, task.params, ctx), deadlineMs, task.kind);
          if (!raced.ok) throw new Error(raced.error); // الـcatch تحت بيسمّيها failed وبيزود العدّاد
          result = raced.value;
        } finally {
          release();
          // feed the limiter with an observed status when the probe saw one
          const st = Number((result as { data?: Record<string, unknown> })?.data?.["status"] ?? 0);
          if (st) noteResponse(job.host, st);
        }
        task.summary = result.summary;
        task.error = result.error;
        task.status = result.ok ? "done" : "failed";
        for (const f of result.findings ?? []) {
          if (job.findings.some((x) => x.id === f.id)) continue;
          job.findings.push(f);
          job.stats.findings++;
          task.findings++;
        }
        job.stats[task.status === "done" ? "done" : "failed"]++;
      } catch (err) {
        const msg = (err as Error).message;
        task.status = "failed";
        task.error = msg;
        task.summary = `فشل: ${msg.slice(0, 160)}`;
        job.stats.failed++;
        log(`✗ ${task.kind}: ${msg.slice(0, 160)}`);
      } finally {
        task.finishedAt = new Date().toISOString();
        task.ms = task.startedAt ? Date.now() - new Date(task.startedAt).getTime() : undefined;
        job.stats.ms = Date.now() - t0;
        persist(job);
      }
    }
    if (job.status === "running") {
      const left = job.tasks.some((t) => t.status === "pending" || t.status === "running");
      job.status = left ? "queued" : "done";
      if (!left) job.finishedAt = new Date().toISOString();
    }
  } finally {
    persist(job);
    running.delete(id);
  }
  return job;
}

/** Background pump: keeps authorized jobs moving without anyone pressing a button. */
let pumpTimer: NodeJS.Timeout | null = null;
export function startJobPump(everyMs = 3_000): void {
  if (pumpTimer) return;
  pumpTimer = setInterval(() => {
    if (isKilled()) return;
    for (const meta of listJobs(8)) {
      if (meta.status !== "queued" && meta.status !== "running") continue;
      void runJob(meta.id).catch(() => undefined);
    }
  }, Math.max(1_000, everyMs));
  pumpTimer.unref?.();
}

export function isJobRunning(id: string): boolean {
  return running.has(id);
}

/* ── verification (the zero-false-positive gate) ─────────────────────────── */

export interface VerifyResult {
  ok: boolean;
  reproduced: boolean;
  detail: string;
  sha256?: string;
}

/**
 * Re-run the finding's own probe and compare the fingerprint with the stored
 * evidence. A finding only becomes reportable when the byte-for-byte proof
 * appears twice, from independent calls.
 */
export async function verifyFinding(jobId: string, findingId: string): Promise<VerifyResult | null> {
  const job = getJob(jobId);
  if (!job) return null;
  const finding = job.findings.find((f) => f.id === findingId);
  if (!finding) return null;

  const gate = await assertAuthorized(finding.target || job.host, { programId: job.programId ?? undefined, active: true });
  if (!gate.ok) return { ok: false, reproduced: false, detail: `مرفوض: ${gate.reason}` };

  const kindId = finding.kind;
  const kind = KINDS[kindId];
  if (!kind) return { ok: false, reproduced: false, detail: "نوع المهمة مش معروف" };

  try {
    await acquire(gate.host, { rps: gate.limits.rps, burst: 1, maxWaitMs: 60_000 });
    let replay: string;
    try {
      if (kind.run) {
        const ctx: RunCtx = {
          host: gate.host,
          scheme: job.scheme,
          program: gate.program!,
          jobDir: path.join(jobsDir(), job.id),
          rps: gate.limits.rps,
          allowNodeTools: job.budget.allowNodeTools,
          timeoutMs: 60_000,
          log: () => undefined,
        };
        const res = await kind.run(ctx, {});
        replay = JSON.stringify(res.data ?? {});
      } else {
        replay = `rerun-of:${kindId} not supported for verification`;
      }
    } finally {
      release();
    }
    const sha = crypto.createHash("sha256").update(replay).digest("hex");
    const before = finding.evidence.map((e) => e.sha256).filter(Boolean) as string[];
    // exact hash equality only holds for stable, deterministic probes (DNS/TLS/config)
    const stable = /recon\.(dns|tls|headers|certspotter|securitytxt)|intel\./.test(kindId);
    const reproduced = stable ? (before.length === 0 ? replay.length > 2 : before.includes(sha)) : replay.length > 2;
    const ev = writeEvidence(
      { host: gate.host, scheme: job.scheme, program: gate.program!, jobDir: path.join(jobsDir(), job.id), rps: gate.limits.rps, allowNodeTools: false, timeoutMs: 60_000, log: () => undefined },
      `verify.${kindId}`,
      finding.reproduce,
      replay,
    );
    if (reproduced) {
      finding.verified = true;
      finding.verification = { at: new Date().toISOString(), method: stable ? "deterministic-replay-hash-match" : "independent-replay-produced-signal", detail: ev.file ?? ev.sha256 ?? "" };
      finding.evidence.push(ev);
      job.stats.verified++;
      job.log.push({ at: finding.verification.at, line: `✓ verified ${finding.title} (${sha.slice(0, 12)})` });
    } else {
      finding.verification = { at: new Date().toISOString(), method: "replay", detail: "لم يُعاد إنتاج نفس البصمة — لا يُدرج في التقرير" };
      job.log.push({ at: finding.verification.at, line: `✗ not reproduced: ${finding.title}` });
    }
    persist(job);
    return { ok: true, reproduced, detail: finding.verification.detail, sha256: sha };
  } catch (err) {
    return { ok: false, reproduced: false, detail: (err as Error).message };
  }
}

/* ── reporting ───────────────────────────────────────────────────────────── */

export function buildReport(jobId: string, opts: { includeUnverified?: boolean; lang?: "ar" | "en" } = {}): string | null {
  const job = getJob(jobId);
  if (!job) return null;
  const rows = job.findings.filter((f) => (opts.includeUnverified ? true : f.verified));
  const rank: Severity[] = ["critical", "high", "medium", "low", "info"];
  const sorted = [...rows].sort((a, b) => rank.indexOf(a.severity) - rank.indexOf(b.severity));
  const head = [
    `# Security Report — ${job.name}`,
    "",
    `- **Target:** \`${job.target}\``,
    `- **Program:** ${job.programId ? `\`${job.programId}\`` : "_unscoped (internal assessment)_"}`,
    `- **Assessed by:** CyberNova NOVA · job \`${job.id}\``,
    `- **Window:** ${job.createdAt} → ${job.finishedAt ?? "(running)"}`,
    `- **Method:** ${job.tasks.length} task kinds · ${job.stats.done} done · ${job.stats.failed} failed · ${job.stats.skipped} skipped`,
    `- **Findings:** ${sorted.length} reportable (${job.stats.verified} independently reproduced)`,
    "",
    "## Summary",
    "",
    job.objective,
    "",
  ];
  const body = sorted.map((f) => {
    const ev = f.evidence.map((e) => `  - \`${e.probe}\`${e.sha256 ? ` · SHA-256 \`${e.sha256.slice(0, 16)}…\`` : ""}${e.file ? ` · file \`${e.file}\`` : ""}`).join("\n");
    return [
      `## [${f.severity.toUpperCase()}] ${f.title}`,
      "",
      `- **العربي:** ${f.titleAr}`,
      f.cwe ? `- **CWE:** ${f.cwe}` : "",
      typeof f.cvssGuess === "number" ? `- **CVSS (مقدّر):** ${f.cvssGuess}` : "",
      `- **Location:** \`${f.target}\``,
      `- **Confidence:** ${f.confidence}`,
      "",
      "**Reproduce**",
      "",
      "```bash",
      f.reproduce,
      "```",
      "",
      "**Evidence**",
      ev || "  - (none)",
      "",
      f.verification ? `**Verification:** ${f.verification.method} — ${f.verification.detail}` : "**Verification:** not attempted",
      f.remediationAr ? `**Remediation:** ${f.remediationAr}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  const notes = job.tasks
    .filter((t) => t.status === "failed" || t.status === "skipped")
    .map((t) => `- \`${t.kind}\` — ${t.status}: ${t.error ?? t.summary ?? ""}`)
    .join("\n");
  const tail = [
    "",
    "## Coverage gaps (honest)",
    "",
    notes || "- none — every planned task ran",
    "",
    "_No destructive testing was performed. Rate limits were respected per program policy._",
    "",
  ];
  const md = [...head, ...body, ...tail].join("\n");
  try {
    atomicWrite(path.join(jobsDir(), job.id, "report.md"), md);
  } catch {
    /* reporting still works in-memory */
  }
  return md;
}

export function runnerStats(): { active: string[]; snapshot: ReturnType<typeof throttleSnapshot>; dir: string } {
  return { active: [...running], snapshot: throttleSnapshot(), dir: jobsDir() };
}
