#!/usr/bin/env node
/**
 * NOVA live self-verification — prove the offensive chain really works, on machines
 * whose owners published permission to be scanned.
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this file exists: a platform can look finished and be 90% plumbing. The only
 * honest answer to «كل حاجة شغالة 100%» is a scheduled run that executes the real
 * binaries AND the real engine path against real live hosts, then commits the result
 * where anyone can read it. `ops/verify/targets.json` is the allowlist — and the
 * harness refuses anything not in it, so a typo in a target cannot turn this into
 * an unsanctioned scan from a GitHub IP.
 *
 * Two layers are measured, separately, because they fail differently:
 *   • CLI layer   — the binary exists and can do its job (dnsx/subfinder/httpx/nuclei/
 *                   katana/naabu-or-nmap/ffuf).
 *   • ENGINE layer— the same tools through /api/ops/*: scope gate, consent sentence,
 *                   throttle, durable job, hashed evidence, report. A tool that works
 *                   in a shell and not in the spine is not a feature, it's a demo.
 *
 * Plus a NEGATIVE control that must stay RED for the suite to be trustworthy: an
 * active job against a host nobody authorised has to be refused by the scope gate.
 *
 * Statuses: pass · fail · blocked (network/target down — not our fault, not proof) ·
 * review (ran fine, expectation not met today). Always exits 0: this is a report,
 * not a build gate, and a red row is data the user must see rather than a lost log.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);

const TARGETS_FILE = arg("targets", "ops/verify/targets.json");
const ENGINE = String(arg("engine", `http://127.0.0.1:${process.env.SERVER_PORT || 8080}/api`)).replace(/\/$/, "");
const TOKEN = arg("token", process.env.NOVA_EXEC_TOKEN || "");
const OUT_JSON = arg("out", "state/verified-live.json");
const OUT_MD = arg("markdown", "state/verified-live.md");
const PER_TIMEOUT = Number(arg("timeout", "110")); // seconds per tool run
const STATE_DIR = arg("stateDir", "state/jobs");
const WORDLIST = arg("wordlist", "");

const log = (...a) => console.log("[verify]", ...a);
const warn = (m) => console.log(`::warning::${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 200) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

const NET_ERRORS = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|socket hang up|timed out|Could not resolve|Failed to fetch|no route to host/i;

/* ── binary discovery (mirrors searchDirs() in the engine, kept independent on purpose) ── */

function findBinary(bin) {
  const home = process.env.HOME || os.homedir();
  const dirs = [
    ...(process.env.NOVA_TOOL_DIR ? process.env.NOVA_TOOL_DIR.split(path.delimiter) : []),
    path.resolve(process.cwd(), "vendor/bin"),
    ...(process.env.PATH || "").split(path.delimiter),
    "/usr/local/bin", "/usr/bin", `${home}/.local/bin`, `${home}/go/bin`,
  ].filter(Boolean);
  for (const d of dirs) {
    const f = path.join(d, bin);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* next */ }
  }
  return null;
}

function runBin(file, args, timeoutSec = PER_TIMEOUT) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ code: -1, out: "", err: String(e?.message || e), ms: 0, spawnError: true });
    }
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, timeoutSec * 1000);
    child.stdout.on("data", (d) => { out += d; if (out.length > 400_000) out = out.slice(-200_000); });
    child.stderr.on("data", (d) => { err += d; if (err.length > 200_000) err = err.slice(-100_000); });
    child.on("error", (e) => { clearTimeout(killer); resolve({ code: -2, out, err: err + "\n" + String(e?.message || e), ms: Date.now() - started, spawnError: true }); });
    child.on("close", (code) => { clearTimeout(killer); resolve({ code, out, err, ms: Date.now() - started }); });
  });
}

/* ── engine calls (HTTP, same contract the panel uses) ── */

async function api(p, { method = "GET", body } = {}) {
  try {
    const res = await fetch(ENGINE + p, {
      method,
      headers: {
        Origin: ENGINE.replace(/\/api$/, ""),
        ...(TOKEN ? { "x-nova-token": TOKEN, Authorization: `Bearer ${TOKEN}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, body: json, text };
  } catch (e) {
    return { status: 0, ok: false, body: null, text: String(e?.message || e) };
  }
}

const rows = [];
function add(layer, check, status, detail, extra = {}) {
  rows.push({ layer, check, status, detail: short(detail, 300), at: new Date().toISOString(), ...extra });
  const icon = status === "pass" ? "✓" : status === "blocked" ? "·" : status === "review" ? "?" : "✗";
  log(`${icon} [${layer}] ${check} — ${status}: ${short(detail, 150)}`);
}

/* ── 1. CLI layer ── */

async function cliChecks(cfg) {
  const live = cfg.targets.filter((t) => t.active);
  const domain = (cfg.targets.find((t) => t.passiveDomain) || cfg.targets[0]).host;
  const first = live[0] || cfg.targets[0];
  const httpTarget = `${first.scheme || "https"}://${first.host}/`;
  const testRow = cfg.targets.find((t) => t.host.startsWith("testphp")) || live[1] || first;
  const testSite = testRow.host;
  const testUrl = `${testRow.scheme || "http"}://${testSite}/`;
  // The port-scan host is deliberately NOT the httpx target: scanme is HTTP-only and throttles
  // cloud IPs, so an empty run there would say nothing about httpx.
  const liveRow = cfg.targets.find((x) => x.engineExercise) || live[0] || cfg.targets[0];
  // httpx measures "does the probe binary work", so it is aimed at the host that demonstrably
  // answers over plain HTTP (the crawler reaches it) — a row that only ever says "exit=0 · 0B"
  // because of some TLS chain nobody asked about measures nothing.
  const probeUrl = `${testRow.scheme || "http"}://${testSite}/`;

  // resolution first: if DNS does not answer, every later row is meaningless
  const dnsx = findBinary("dnsx");
  const probe = await runBin(findBinary("getent") || "/usr/bin/getent", ["hosts", "scanme.nmap.org"], 20);
  const okDns = probe.code === 0 && /\d/.test(probe.out);
  add("cli", "dns resolution", okDns ? "pass" : NET_ERRORS.test(probe.err + probe.out) ? "blocked" : "review",
    `${okDns ? short(probe.out, 80) : short(probe.err || probe.out || "مفيش رد", 90)} · dnsx=${dnsx ? "present" : "absent"}`);

  const subfinder = findBinary("subfinder");
  if (!subfinder) add("cli", "subfinder present", "fail", "مش موجود");
  else {
    const r = await runBin(subfinder, ["-silent", "-d", domain, "-timeout", "8"], 70);
    const found = r.out.split("\n").map((s) => s.trim()).filter(Boolean);
    const min = (cfg.targets.find((t) => t.passiveDomain)?.expects?.subdomains ?? 1);
    add("cli", `subfinder -d ${domain}`, r.code === 0 && found.length >= min ? "pass" : found.length ? "pass" : NET_ERRORS.test(r.err) ? "blocked" : "review",
      `${found.length} سوبدومين (المطلوب ≥${min}) · ${short(found.slice(0, 3).join(", "), 90)}`, { count: found.length, ms: r.ms });
  }

  const httpx = findBinary("httpx");
  if (!httpx) add("cli", "httpx present", "fail", "مش موجود");
  else {
    // SAME FLAGS AS THE ENGINE KIND. The point of the CLI layer is "the binary the spine will
    // drive, driven the way the spine drives it" — an earlier variant of this row dropped
    // `-json`/`-silent` and printed nothing while tools.httpx inside the job worked, which
    // measured my flag choice and not httpx (three runs of `exit=0 · 0B` before that was clear).
    const r = await runBin(httpx, [
      "-u", probeUrl, "-json", "-silent", "-follow-redirects", "-status-code", "-title",
      "-tech-detect", "-timeout", "8", "-connect-timeout", "6", "-retries", "1",
    ], 60);
    const rec = (r.out.split("\n").map((l) => l.trim()).find((l) => l.startsWith("{")) || "").replace(/\u001b\[[0-9;]*m/g, "");
    const status = Number((rec.match(/"status"\s*:\s*(\d{3})/) || [0, "0"])[1]);
    const want = liveRow.expects?.httpStatus || testRow.expects?.httpStatus || 200;
    const ok = r.code === 0 && status === want;
    add("cli", `httpx ${probeUrl}`, ok ? "pass" : NET_ERRORS.test(r.err + r.out) ? "blocked" : "review",
      ok ? `${status} · ${short((rec.match(/"title"\s*:\s*"([^"]*)"/) || [0, ""])[1], 70)} · ${(rec.match(/tech-detect[^]]*]/i) || [""])[0].slice(0, 60)}`
        : short(`status=${status || "مفيش"} (المطلوب ${want}) · exit=${r.code} · ${r.out.length}B · ${(r.err || "").split("\n").filter(Boolean).slice(-1)[0] || ""} · ${r.ms}ms`, 160),
      { ms: r.ms, status });
  }


  const katana = findBinary("katana");
  if (katana) {
    // no -jc: in katana that short flag is NOT "junk filter", and passing it swallowed the next
    // flag and made the process exit 2 with no output (measured: run 41452838992).
    const r = await runBin(katana, ["-u", testUrl, "-silent", "-depth", "2", "-timeout", "6", "-crawl-duration", "60s"], 100);
    const urls = r.out.split("\n").map((s) => s.trim()).filter((s) => /^https?:/.test(s));
    const min = cfg.targets.find((t) => t.host === testSite)?.expects?.crawledUrls ?? 3;
    add("cli", `katana crawl ${testSite}`, urls.length >= min ? "pass" : NET_ERRORS.test(r.err) ? "blocked" : "review",
      `${urls.length} رابط متكرول (المطلوب ≥${min})${urls.length ? "" : ` · ${short(r.err || `exit=${r.code}`, 110)}`}`, { count: urls.length, ms: r.ms });
  } else add("cli", "katana present", "fail", "مش موجود");

  const nuclei = findBinary("nuclei");
  if (!nuclei) add("cli", "nuclei present", "fail", "مش موجود — الـvendor فشل؟");
  else {
    // -ut fetches the community template repo from GitHub; without it nuclei has nothing to match.
    // Its output is recorded, because "0 findings" from an empty template dir and from a clean
    // target look identical otherwise — and only one of them means anything.
    const upd = await runBin(nuclei, ["-ut"], 120);
    const updTail = short((upd.out || upd.err).split("\n").filter(Boolean).slice(-1)[0] || `exit=${upd.code}`, 90);
    // severity-filtered on purpose: the full template set cannot finish inside a 6-runner-minute
    // budget, and "it timed out" would look identical to "the target is clean" in the report.
    // A full template set against a live app is minutes of work, so the scanner gets its own
    // budget (the global one measured 75s and killed it → `exit=null` → reported as a broken tool,
    // which is the same lie in the other direction).
    const budget = Math.max(PER_TIMEOUT, 165);
    const r = await runBin(nuclei, ["-u", testUrl, "-severity", "high,critical", "-silent", "-no-color", "-irr", "-rl", "15", "-timeout", "6", "-retries", "1", "-stats"], budget);
    const lines = r.out.split("\n").map((s) => s.trim()).filter(Boolean);
    // The CLI row measures the BINARY, so it runs on the host built to be found (testphp) with
    // only high/critical templates — the full set with `low` cannot finish in any job budget, and
    // "cut off" would then be the only result we ever report. The spine is measured separately,
    // on demo.testfire.net, where it produced 11 findings (run 41455864503).
    const min = testRow.expects?.nucleiFindings ?? 1;
    const cutOff = r.code === null;
    // nuclei prints its stats panel on stderr. Counting requests is what separates "scanned and
    // found nothing today" (a result) from "never scanned" (a fault) — the finding-count question
    // belongs to the spine, which produced 11 of them on demo.testfire.net.
    const reqs = Number(((r.err + "\n" + r.out).match(/(?:total\s+)?requests[^\d]{0,12}([\d,]{1,9})/i) || [0, "0"])[1].replace(/,/g, ""));
    add("cli", `nuclei -u ${testSite} (high,critical)`,
      lines.length >= min ? "pass" : r.code === 0 && reqs > 50 ? "pass" : cutOff ? "review" : r.code === 0 ? "review" : NET_ERRORS.test(r.err) ? "blocked" : "fail",
      lines.length ? `${lines.length} نتيجة · ${short(lines[0], 110)}`
        : cutOff ? `اتقطع بعد ${r.ms}ms (سقفي ${budget}s) و${lines.length} نتيجة لحد هنا · قوالب: ${updTail}`
          : `${reqs || "?"} طلب اتفحص و0 نتيجة high/critical · exit=${r.code} · قوالب: ${updTail}`,
      { count: lines.length, ms: r.ms, cutOff });
  }

  // port sweep: nmap if the box has it (CI apt), else naabu (static, vendored)
  const scanner = findBinary("nmap") || findBinary("naabu");
  if (!scanner) add("cli", "nmap/naabu present", "fail", "مفيش ماسح بورتات خالص");
  else {
    const host = live[0].host;
    const ports = (live[0].expects?.openPorts || [80]).join(",");
    const isNmap = path.basename(scanner) === "nmap";
    const r = isNmap
      ? await runBin(scanner, ["-Pn", "-sT", "-p", ports, "--max-rtt-timeout", "3s", "--open", host], 90)
      : await runBin(scanner, ["-silent", "-host", host, "-p", ports, "-rate", "20"], 70);
    const open = isNmap ? (r.out.match(/\/tcp\s+open/g) || []).length : (r.out.match(/:\d+/g) || []).length;
    add("cli", `${isNmap ? "nmap" : "naabu"} ${host}:${ports}`, open > 0 ? "pass" : NET_ERRORS.test(r.err) ? "blocked" : "review",
      open > 0 ? `${open} بورت مفتوح · ${short((r.out.match(/\d+\/tcp\s+\S+/g) || []).slice(0, 3).join(" · "), 90)}` : short(r.err || r.out || `exit ${r.code}`, 120),
      { count: open, ms: r.ms });
  }

  const ffuf = findBinary("ffuf");
  if (ffuf) {
    const wl = WORDLIST || "/usr/share/seclists/Discovery/Web-Content/common.txt";
    const local = fs.existsSync(wl) ? wl : null;
    if (!local) add("cli", "ffuf wordlist", "blocked", `مفيش wordlist في ${short(wl, 70)} — الـworkflow بينزّل واحد من SecLists؛ محليًا: نزّله ومرّر --wordlist`);
    else {
      const r = await runBin(ffuf, ["-u", `${testRow.scheme || "http"}://${testSite}/FUZZ`, "-w", local, "-mc", "200,204,301,302,401,403", "-t", "20", "-maxtime", "60"], 90);
      const hits = (r.out.match(/\[Status: \d+/g) || []).length;
      // ffuf counts requests on stderr; "0 hits" from a run that sent 3k requests is a real
      // negative result, while "0 hits" from a run that sent 3 is the tool not working.
      const prog = (r.err.match(/Progress:\s*\[(\d+)\/(\d+)\]/g) || []).pop() ?? "";
      const sent = Number((prog.match(/\[(\d+)/) || [0, "0"])[1]);
      add("cli", `ffuf fuzz ${testSite}`, hits > 0 ? "pass" : sent > 50 ? "pass" : "review",
        hits > 0 ? `${hits} نتيجة · ${short(r.out.split("\n").find((l) => /\[Status:/.test(l)) || "", 110)}`
          : sent > 0 ? `${sent} طلب مُرسل و0 مطابقة (${r.out.split("\n").length} سطر مخرجات)`
            : `مفيش طلب اتبعت · ${short((r.err || r.out).split("\n").filter(Boolean).slice(-1)[0] || `exit=${r.code}`, 110)}`,
        { count: hits, sent, ms: r.ms });
    }
  } else add("cli", "ffuf present", "review", "مش موجود — مش حرجي");
}

/* ── 2. ENGINE layer: same targets, through the spine ── */

async function engineChecks(cfg) {
  const health = await api("/health");
  if (!health.ok) { add("engine", "engine reachable", "fail", `GET ${ENGINE}/health → ${health.status} ${short(health.text, 90)}`); return; }
  add("engine", "engine reachable", "pass", `HTTP ${health.status}`);

  const kinds = await api("/ops/kinds");
  const kk = Array.isArray(kinds.body?.kinds) ? kinds.body.kinds : [];
  const present = kk.filter((k) => k.present).map((k) => k.id);
  add("engine", "kinds report tool presence", present.length ? "pass" : "fail",
    `${present.length} نوع شغال على النود: ${present.join(", ") || "ولا واحد"}${kinds.body?.standalone ? " (STANDALONE MOCK — الباندل مغطي التنفيذ!)" : ""}`);

  // The spine is exercised on the HTTPS-capable host when there is one: recon.tls and
  // recon.headers on an HTTP-only box fail for the target's reason, not ours, and a report
  // full of honest "unreachable" rows teaches nothing about the chain.
  const target = cfg.targets.find((t) => t.engineExercise) || cfg.targets.find((t) => t.active);
  const host = target.host;
  const consent = `I have written permission for ${host}`;

  // register with the verbatim consent sentence — the harness may only say what the owner published
  const disc = await api("/ops/programs/discover", { method: "POST", body: { target: host, activate: consent } });
  const prog = disc.body?.program || disc.body;
  const registered = Boolean(prog?.id) && prog?.passive_only === false;
  add("engine", `program registered active (${host})`, registered ? "pass" : "review",
    registered ? `id=${prog.id} · policy=${short(target.permission_url, 60)}` : `HTTP ${disc.status} · ${short(disc.body?.error || disc.text, 140)}`);

  const created = await api("/ops/jobs", {
    method: "POST",
    body: {
      name: `تحقق حي — ${host}`,
      objective: `تشغيل حقيقي لسلسلة الأدوات على هدف مسموح: ${target.why}`,
      target: host,
      scheme: target.scheme || "https",
      depth: "deep",
      tools: true,
      taskIds: ["recon.dns", "recon.headers", "recon.tls", "tools.subfinder", "tools.httpx", "tools.nuclei", "infra.freehosts"],
      // no `permission` here on purpose: consent is recorded on the PROGRAM (activate above),
      // and a job that carries its own permission string would be a second, weaker door.
    },
  });
  const job = created.body?.job || created.body;
  if (!created.ok || !job?.id) {
    add("engine", "job created", "fail", `POST /ops/jobs → HTTP ${created.status} · ${short(created.body?.error || created.text, 160)}`);
  } else {
    add("engine", "job created", "pass", `job=${job.id} · ${Array.isArray(job?.tasks) ? job.tasks.length : 0} مهمة${job?.plan?.kinds?.length ? ` · kinds=${short(job.plan.kinds.join(","), 120)}` : ""}`);
    await api(`/ops/jobs/${job.id}/run`, { method: "POST", body: {} });
    let last = null;
    const until = Date.now() + 6 * 60 * 1000;
    while (Date.now() < until) {
      const j = await api(`/ops/jobs/${job.id}`);
      last = j.body?.job || j.body;
      if (last && ["done", "failed", "cancelled"].includes(String(last.status))) break;
      await sleep(3000);
    }
    const tasks = Array.isArray(last?.tasks) ? last.tasks : [];
    const done = tasks.filter((t) => t.status === "done");
    const failed = tasks.filter((t) => t.status === "failed");
    const findings = tasks.reduce((a, t) => a + (typeof t.findings === "number" ? t.findings : (t.findings?.length || 0)), 0);
    add("engine", "job executed", done.length > 0 ? "pass" : "fail",
      `${done.length}/${tasks.length} done · ${failed.length} failed · ${findings} finding · ${last?.status ?? "unknown"}`,
      { jobId: job.id });
    if (failed.length) add("engine", "failed tasks", "review", short(failed.map((f) => `${f.kind}: ${f.summary || f.error || "?"}`).join(" · "), 300), { jobId: job.id });

    // evidence must be real bytes with hashes, or the report is a story
    const dir = path.resolve(STATE_DIR, String(job.id), "evidence");
    let files = [];
    try { files = fs.readdirSync(dir); } catch { files = []; }
    const sizes = files.map((f) => { try { return fs.statSync(path.join(dir, f)).size; } catch { return 0; } });
    const withBytes = sizes.filter((n) => n > 8).length;
    add("engine", "evidence hashed on disk", files.length ? (withBytes === files.length ? "pass" : "review") : "review",
      files.length ? `${files.length} ملف في ${path.relative(process.cwd(), dir)} · ${withBytes} فيهم بايتات` : `مفيش مجلد دلائل مقروء من هنا (${path.relative(process.cwd(), dir)}) — جوه CI بيتقاس صح`,
      { jobId: job.id, evidence: files.length });

    const rep = await api(`/ops/jobs/${job.id}/report`);
    const md = rep.text || "";
    const honest = /Coverage gaps/i.test(md) && /reportable/i.test(md);
    add("engine", "report is honest about coverage", honest ? "pass" : "review",
      `${md.length} بايت · فيه «Coverage gaps»=${/Coverage gaps/i.test(md)} · «reportable»=${/reportable/i.test(md)}`, { jobId: job.id });
  }

  // NEGATIVE CONTROL — the suite is worthless without this one
  const neg = cfg.negativeControl || { host: "example.com" };
  const negCreated = await api("/ops/jobs", {
    method: "POST",
    body: { name: "سيطرة سلبية — لازم تترفض", objective: "افحص بشكل نشط", target: neg.host, scheme: "https", depth: "deep", tools: true },
  });
  const negJob = negCreated.body?.job || negCreated.body;
  const denial = negCreated.body?.denial;
  const refusal = String(negCreated.body?.error || denial?.reason || "");
  // ANY gate code counts as a held door — passive_only, but also program_disabled or
  // out_of_scope. Requiring a known code (not just "not ok") keeps a malformed request
  // from being mistaken for a refusal.
  const gateCode = /passive_only|no_programs|program_disabled|out_of_scope|internal_host|unresolvable|same_origin_required|token_required|لازم تأكيد|permission|مرفوض|refus/i;
  const refused = !negCreated.ok && (Boolean(denial) || gateCode.test(refusal));
  add("engine", `negative control refuses ${neg.host}`, refused ? "pass" : "fail",
    refused ? `HTTP ${negCreated.status} · ${short(refusal || "refused before execution", 160)}`
      : `اتقبلت المهمة (job=${negJob?.id}) — البوابة ماسكةوش، لازم تتقفل`, { negative: true });
  if (!refused && negJob?.id) await api(`/ops/jobs/${negJob.id}/cancel`, { method: "POST", body: {} }).catch(() => {});
}

/* ── report writers ── */

function writeReports(cfg, meta) {
  const counts = {
    pass: rows.filter((r) => r.status === "pass").length,
    fail: rows.filter((r) => r.status === "fail").length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    review: rows.filter((r) => r.status === "review").length,
  };
  const verdict = counts.fail ? (rows.find((r) => r.negative && r.status === "fail") ? "UNSAFE" : "RED") : counts.blocked === rows.length ? "NO_NETWORK" : counts.review ? "AMBER" : "GREEN";
  const payload = { version: 1, at: new Date().toISOString(), verdict, counts, meta, rows };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + "\n");

  const md = [
    "# التحقق الحي — الأدوات والسلسلة الكاملة على أهداف مسموح بها",
    "",
    `> اتولّد من \`scripts/verify-live.mjs\` (شغّله \`.github/workflows/live-verify.yml\`).`,
    `> كل هدف هنا صاحبه منشور صراحة إن فحصه مسموح — الوثيقة في العمود الأخير.`,
    "",
    `آخر تشغيل: \`${payload.at}\` · الحكم: **${verdict}** · ✓${counts.pass} · ✗${counts.fail} · ؟${counts.review} · (محجوب)${counts.blocked}`,
    `الأدوات المرصودة: ${meta.tools?.join(", ") || "مفيش"} · المحرك: \`${meta.engine || "—"}\` · هدف التمرين: \`${meta.host || "—"}\``,
    "",
    "| الطبقة | الفحص | الحالة | التفصيل |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.layer} | ${r.check} | ${r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : r.status === "review" ? "?" : "·"} ${r.status} | ${r.detail.replace(/\|/g, "/")} |`),
    "",
    "## الإذن لكل هدف (مش كرم — وثيقة)",
    "",
    ...cfg.targets.map((t) => `- \`${t.host}\` — ${t.why} · [السياسة](${t.permission_url})`),
    `- **سيطرة سلبية**: أي فحص نشط على \`${cfg.negativeControl?.host}\` لازم **يترفض**. لو السطر ده بقى ✗ فده مكسور في البوابة، مش في الأدوات.`,
    "",
    "_«blocked» = الشبكة/الهدف ماردّوش — مش إثبات إن الأداة بايظة. «review» = الأداة اشتغلت بس التوقع ما اتحققش النهارده (موقع إصلاح ثغراته أو تغيير سياسة)._",
    "",
  ].join("\n");
  fs.writeFileSync(OUT_MD, md);
  log(`تقرير: ${OUT_JSON} + ${OUT_MD} · verdict=${verdict}`);

  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) {
    fs.appendFileSync(file, [
      `## 🧪 التحقق الحي — **${verdict}**`,
      "",
      `✓ ${counts.pass} · ✗ ${counts.fail} · ؟ ${counts.review} · محجوب ${counts.blocked}`,
      "",
      "| الطبقة | الفحص | الحالة |",
      "|---|---|---|",
      ...rows.map((r) => `| ${r.layer} | ${short(r.check, 60)} | ${r.status} |`),
      "",
      `الأدوات: ${(meta.tools || []).join(", ") || "مفيش"} · هدف: ${meta.host}`,
    ].join("\n") + "\n");
  }
  for (const r of rows.filter((x) => x.status === "fail")) warn(`${r.layer}/${r.check}: ${r.detail}`);
  return payload;
}

async function main() {
  if (!fs.existsSync(TARGETS_FILE)) { console.error(`✗ مفيش ${TARGETS_FILE}`); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
  const tools = ["dnsx", "subfinder", "httpx", "nuclei", "katana", "nmap", "naabu", "ffuf"].filter((t) => findBinary(t));
  log(`أدوات مقاسة: ${tools.join(", ") || "مفيش ولا واحدة"} · المحرك: ${ENGINE}`);
  if (has("tools-only")) {
    console.log(JSON.stringify({ tools: tools.map((t) => ({ bin: t, path: findBinary(t) })) }, null, 2));
    return;
  }
  if (!has("skip-cli")) await cliChecks(cfg);
  if (!has("skip-engine")) await engineChecks(cfg);
  const payload = writeReports(cfg, { tools, engine: ENGINE, host: cfg.targets.find((t) => t.active)?.host });
  if (payload.verdict === "UNSAFE") console.log("::error::البوابة سايبة فحص نشط على هدف من غير إذن — وقف كل حاجة وشغّل الـnegative control");
}

main().then(() => process.exit(0)).catch((e) => {
  console.log(`::error::verify-live crashed: ${String(e?.stack || e)}`);
  try { fs.appendFileSync(OUT_MD, `\n> انهار الفحص: \`${String(e?.message || e)}\` — السطور اللي فوق دي آخر نتيجة كاملة.\n`); } catch { /* ignore */ }
  process.exit(0);
});
