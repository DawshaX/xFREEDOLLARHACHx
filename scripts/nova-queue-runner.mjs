#!/usr/bin/env node
/**
 * NOVA queue runner — the "one place" plane.
 * ──────────────────────────────────────────
 * The premise: a free host is either tiny, sleeping, or card-gated. GitHub is the
 * one place that gives an unlimited, always-available, root-level machine for a
 * public repository. So the queue lives in the repo, and this script turns a
 * GitHub-hosted machine into a real NOVA worker: it boots the actual engine
 * (routes, gates, scope checks, evidence writer — no reimplementation), runs the
 * queued missions through the HTTP API exactly like the panel would, installs real
 * security tools on the runner so the tool kinds are not skipped, and publishes
 * the report + machine-readable results where the Pages site can serve them.
 *
 * Queue file (default state/nova-queue.json):
 *   { "version": 1, "missions": [ {
 *       "id": "unique-string",            // optional; generated if absent
 *       "title": "…", "objective": "…",   // what the mission is
 *       "target": "example.com",          // host under authorization
 *       "depth": "passive|standard|deep", // active depths still need scope consent
 *       "tools": true,                    // try the real binaries (nmap/nuclei/…)
 *       "programId": "…",                 // reuse an existing authorized program
 *       "status": "queued|running|done|failed|skipped"
 *     } ] }
 *
 * Safety, stated because it is the part everyone skips:
 *   • Every mission goes through /api/ops/* — the same authorization gate, the same
 *     per-program rate limit, the same "active depth needs written consent" rule.
 *     This script adds no capability; it only drives the engine from a machine
 *     that has the tools installed.
 *   • A GitHub runner's source IP belongs to GitHub. Active probing from it is
 *     GitHub-visible abuse regardless of what the target allows, so `tools: true`
 *     is refused here unless NOVA_RUNNER_ALLOW_ACTIVE=1 is set by a human.
 *   • A failing mission never reddens the whole run: it is marked `failed` with
 *     the reason in the queue file, and a ::warning:: annotation is emitted.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const QUEUE = arg("queue", "state/nova-queue.json");
const OUT = arg("out", "artifacts/kali-panel/public/nova-runs");
const BASE = String(arg("url", `http://127.0.0.1:${process.env.SERVER_PORT || 8080}/api`)).replace(/\/$/, "");
const TOKEN = arg("token", process.env.NOVA_EXEC_TOKEN || "");
const WAIT = Number(arg("wait", "600")); // seconds per mission
const LIMIT = Number(arg("limit", "6")); // missions per run
// Where the report is reachable from the browser, once Pages publishes OUT.
const REPORT_BASE = arg("reportBase", "/xFREEDOLLARHACHx/nova-runs");
const ALLOW_ACTIVE = ["1", "true", "yes"].includes(String(process.env.NOVA_RUNNER_ALLOW_ACTIVE || "").toLowerCase());

const log = (...a) => console.log("[nova-runner]", ...a);
const warn = (m) => console.log(`::warning::${m}`);

async function api(p, { method = "GET", body } = {}) {
  const headers = {
    // The gate treats a cross-origin request as hostile; this process is the
    // origin, so say so instead of disabling the gate in CI.
    Origin: BASE.replace(/\/api$/, ""),
    ...(TOKEN ? { "x-nova-token": TOKEN, Authorization: `Bearer ${TOKEN}` } : {}),
    ...(body ? { "content-type": "application/json" } : {}),
  };
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  }).catch((e) => ({ failed: true, status: 0, _err: String(e && e.message || e) }));
  if (res.failed) return { ok: false, status: 0, error: res._err, body: null };
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 400) }; }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, body: parsed, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEngine(maxMs = 45_000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const h = await api("/health").catch(() => ({ ok: false }));
    if (h && (h.ok || h.status)) return h.status;
    await sleep(700);
  }
  return 0;
}

function readQueue() {
  if (!fs.existsSync(QUEUE)) {
    log(`no queue file at ${QUEUE} — nothing to do`);
    return { version: 1, missions: [] };
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(QUEUE, "utf8")); }
  catch (e) { warn(`queue file is not valid JSON: ${e.message}`); return { version: 1, missions: [] }; }
  if (!Array.isArray(raw.missions)) raw.missions = [];
  return raw;
}

function writeQueue(q) {
  fs.mkdirSync(path.dirname(QUEUE), { recursive: true });
  fs.writeFileSync(QUEUE, JSON.stringify(q, null, 2) + "\n");
}

const short = (s, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Tool kinds need binaries; the workflow installs them before calling us. */
function toolchainReport() {
  const bins = ["nmap", "nuclei", "httpx", "subfinder", "katana", "ffuf", "dnsx", "naabu"];
  const found = [];
  for (const b of bins) {
    for (const dir of ["/usr/local/bin", "/usr/bin", "/opt/tools"]) {
      if (fs.existsSync(path.join(dir, b))) { found.push(b); break; }
    }
  }
  return found;
}

async function runMission(m, idx) {
  const id = String(m.id || `q-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${idx}`);
  const target = String(m.target || "").trim();
  if (!target) return { id, status: "skipped", error: "مفيش target في البند" };

  const wantActive = m.depth === "standard" || m.depth === "deep" || Boolean(m.active);
  const hasTools = toolchainReport();
  // The tool kinds (nuclei/httpx/subfinder/…) touch the target, so they ride the
  // same gate as an active depth: installed binaries are not permission.
  const wantTools = m.tools === true && hasTools.length > 0 && ALLOW_ACTIVE;
  const depth = wantActive ? m.depth : (m.depth || "passive");

  if (wantActive && !ALLOW_ACTIVE) {
    return {
      id, status: "skipped",
      error: "العمق النشط مرفوض من جهاز جيت-هَب: IP المصدر بتاع GitHub، وأي مسح نشط من هنا يعتبر إساءة في حق المنصة حتى لو الهدف مصرّح. شغّل نفس المهمة من نود دائم (Waifly/GratisVPS/Oracle) أو ارفع القيد بوعى: NOVA_RUNNER_ALLOW_ACTIVE=1",
    };
  }

  // 1) authorization first — the same discover the panel calls
  let programId = m.programId ? String(m.programId) : null;
  if (!programId) {
    const disc = await api("/ops/programs/discover", { method: "POST", body: { target } });
    const p = disc.body?.program || disc.body;
    if (p?.id) programId = String(p.id);
    else if (!disc.ok) log(`discover ${target} → HTTP ${disc.status} ${short(disc.body?.error || disc.text, 90)}`);
  }

  // 2) create the job (the engine applies the plan, the throttle and the scope gate)
  const created = await api("/ops/jobs", {
    method: "POST",
    body: {
      name: short(m.title || `بعثة ${id}`, 90),
      objective: String(m.objective || m.title || ""),
      target,
      programId: programId || undefined,
      depth,
      tools: wantTools,
      // `tools: false` keeps the plan inside what a GitHub IP may lawfully do
      _toolsOnRunner: hasTools.length,
      taskIds: Array.isArray(m.taskIds) && m.taskIds.length ? m.taskIds : undefined,
    },
  });
  const job = created.body?.job || created.body;
  const jobId = job?.id;
  if (!created.ok || !jobId) {
    return { id, status: "failed", error: `POST /ops/jobs → HTTP ${created.status} · ${short(created.body?.error || created.text, 160)}` };
  }

  // 3) execute it here: this machine has the toolchain
  const run = await api(`/ops/jobs/${jobId}/run`, { method: "POST", body: {} });
  if (!run.ok) log(`run → HTTP ${run.status} ${short(run.body?.error, 90)}`);

  // 4) wait for the spine to finish (it persists evidence as it goes)
  const until = Date.now() + WAIT * 1000;
  let last = null;
  while (Date.now() < until) {
    const j = await api(`/ops/jobs/${jobId}`);
    last = j.body?.job || j.body;
    if (last && ["done", "failed", "cancelled", "error"].includes(String(last.status))) break;
    await sleep(2500);
  }
  if (!last || !["done", "failed"].includes(String(last.status))) {
    return { id, jobId, status: "failed", error: `المهمة لسه شغالة بعد ${WAIT} ثانية — ارفع --wait لو طبيعية كده` };
  }

  // 5) publish: markdown report + a trimmed machine-readable twin
  const md = await api(`/ops/jobs/${jobId}/report`);
  const tasks = Array.isArray(last.tasks) ? last.tasks : [];
  const findings = tasks.flatMap((t) => (Array.isArray(t.findings) ? t.findings.map((f) => ({ ...f, kind: t.kind })) : []));
  const counts = {
    tasks: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    findings: findings.length,
    verified: findings.filter((f) => f.verified || f.reproduced).length,
    ms: tasks.reduce((a, t) => a + (Number(t.ms) || 0), 0),
  };
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString();
  const body = typeof md.text === "string" && md.text.trim().startsWith("#")
    ? md.text
    : `# تقرير NOVA — ${m.title || id}\n\n- job: \`${jobId}\`\n- target: \`${target}\`\n- depth: ${depth}\n- tasks: ${counts.done}/${counts.tasks} · findings: ${counts.findings} (${counts.verified} متأكد)\n\n_التقرير الخام مش مقروء من /report — التفاصيل في JSON المرفق._\n`;
  const header = `\n---\n- نُفّذ على: GitHub Actions (nood دائم = مفيش) · ${stamp}\n- أدوات موجودة على النود: ${hasTools.length ? hasTools.join(", ") : "ولا واحدة (العمق السلبي مالوش داعي)"}\n- ملاحظة: مصدر الطلب IP بتاع جيت-هَب، فده مستوى استطلاع مش اختراق.\n`;
  fs.writeFileSync(path.join(OUT, `${id}.md`), body + header);
  const trimmed = {
    id, jobId, title: m.title || null, target, depth, at: stamp,
    status: String(last.status), counts,
    plan: last.plan ? { kinds: last.plan.kinds, why: last.plan.why } : null,
    tasks: tasks.map((t) => ({ kind: t.kind, status: t.status, ms: t.ms, summary: short(t.summary, 220), error: short(t.error, 160) })),
    findings: findings.map((f) => ({
      kind: f.kind, severity: f.severity, title: f.title, titleAr: f.titleAr,
      confidence: f.confidence, verified: Boolean(f.verified || f.reproduced),
      cwe: f.cwe, evidence: f.evidence,
    })),
    report: `${REPORT_BASE}/${id}.md`,
  };
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(trimmed, null, 2) + "\n");
  return { id, jobId, status: counts.failed === counts.tasks ? "failed" : "done", report: `${REPORT_BASE}/${id}.md`, counts };
}

function updateIndex() {
  if (!fs.existsSync(OUT)) return;
  const ids = fs.readdirSync(OUT).filter((f) => f.endsWith(".json") && f !== "index.json").sort().reverse();
  const runs = ids.slice(0, 40).map((f) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
      return {
        id: j.id, title: j.title, target: j.target, at: j.at, status: j.status,
        findings: j.counts?.findings ?? 0, verified: j.counts?.verified ?? 0,
        report: j.report,
      };
    } catch { return null; }
  }).filter(Boolean);
  const next = { updatedAt: new Date().toISOString(), runs };
  const idxPath = path.join(OUT, "index.json");
  // Only rewrite when the content actually changed. An index that churns on every
  // run means an empty run still produces a commit — and a commit re-triggers this
  // workflow. Idempotence is what makes the loop terminate on its own.
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(idxPath, "utf8")); } catch { /* first time */ }
  const same = prev && JSON.stringify(prev.runs) === JSON.stringify(next.runs);
  if (same) { log(`index.json: من غير تغيير (${runs.length} بعثة)`); return; }
  fs.writeFileSync(idxPath, JSON.stringify(next, null, 2) + "\n");
  log(`index.json: ${runs.length} بعثة`);
}

function stepSummary(rows) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file || !rows.length) return;
  const lines = [
    "## 🛰️ NOVA — طابور GitHub (السيرفر اللي مفيش فيه سيرفر)",
    "",
    "| البعثة | الحالة | tasks | findings | متأكد | تقرير |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${short(r.title || r.id, 46)} | ${r.status} | ${r.counts ? `${r.counts.done}/${r.counts.tasks}` : "—"} | ${r.counts?.findings ?? "—"} | ${r.counts?.verified ?? "—"} | ${r.report ? `[${r.id}](${r.report})` : "—"} |`),
    "",
    `_الأدوات على النود: ${toolchainReport().join(", ") || "مفيش"} · العمق النشط مسموح؟ ${ALLOW_ACTIVE ? "أيوه (قيدتُه يدويًا)" : "لأ — IP بتاع جيت-هَب"}`,
  ];
  fs.appendFileSync(file, lines.join("\n") + "\n");
}

async function main() {
  const q = readQueue();
  const pending = q.missions.filter((m) => (m.status || "queued") === "queued").slice(0, LIMIT);
  const health = await waitForEngine();
  const engine = health ? `HTTP ${health}` : "مفيش محرك — هاشتغل على الوضع المباشر؟ لأ، لازم محرك";
  log(`queue=${QUEUE} · pending=${q.missions.filter((m) => (m.status || "queued") === "queued").length} · this run=${pending.length}`);
  log(`engine ${BASE} → ${engine} · tools: ${toolchainReport().join(", ") || "none"}`);
  if (!health) {
    warn("the engine never answered /api/health — boot it (SERVER_PORT + node dist/index.mjs) before the runner");
    process.exit(2);
  }
  if (!pending.length) { log("مفيش مهام في الطابور — تمام"); return; }

  const rows = [];
  for (const [i, m] of pending.entries()) {
    m.status = "running";
    m.startedAt = new Date().toISOString();
    log(`▶ ${m.id || `mission ${i + 1}`} · ${m.target} · depth=${m.depth || "passive"}`);
    let out;
    try { out = await runMission(m, i); }
    catch (e) { out = { id: String(m.id || `mission-${i}`), status: "failed", error: String(e?.message || e) }; }
    Object.assign(m, {
      status: out.status, jobId: out.jobId ?? m.jobId ?? null, report: out.report ?? null,
      error: out.error ?? null, finishedAt: new Date().toISOString(),
      counts: out.counts ?? m.counts ?? null,
    });
    rows.push({ ...out, title: m.title });
    log(`◀ ${out.id} → ${out.status}${out.error ? ` · ${short(out.error, 120)}` : ""}${out.report ? ` · ${out.report}` : ""}`);
    if (out.status === "failed") warn(`mission ${out.id}: ${short(out.error, 160)}`);
    writeQueue(q); // keep progress durable even if the next mission explodes
  }
  updateIndex();
  stepSummary(rows);
  const bad = rows.filter((r) => r.status === "failed").length;
  log(`done: ${rows.filter((r) => r.status === "done").length} · failed: ${bad} · skipped: ${rows.filter((r) => r.status === "skipped").length}`);
}

main().then(() => process.exit(0)).catch((e) => {
  // The runner must never eat the pipeline: a crash here is reported, not hidden.
  console.log(`::error::nova-queue-runner crashed: ${String(e?.stack || e)}`);
  try { updateIndex(); } catch { /* nothing else to do */ }
  process.exit(0);
});

export { api, toolchainReport, short };
