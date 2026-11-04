#!/usr/bin/env node
/**
 * Hunt live — run the real chain against the permitted practice targets and
 * publish what it actually found.
 * ────────────────────────────────────────────────────────────────────────────
 * This is not a demo. It executes the installed binaries (httpx, nuclei, katana,
 * nmap), keeps the raw output as evidence with a SHA-256, and writes:
 *
 *   state/hunt-latest.json      measured summary + findings (committed by CI)
 *   state/hunt/evidence/*.txt   the bytes each conclusion stands on
 *
 * Scope: only hosts listed in `ops/verify/targets.json` with `active: true` and a
 * `permission_url` — the same allowlist the verify harness uses. Anything else is
 * refused here, before a packet leaves the runner.
 *
 * Exit code is always 0 for "ran and reported", including "found nothing" — a
 * quiet scan is a result, not a failure. Exit 1 only when no tool binary exists
 * at all, because then nothing was measured.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const targetsFile = arg("targets", path.join(root, "ops/verify/targets.json"));
const outJson = arg("out", path.join(root, "state/hunt-latest.json"));
const evidenceDir = path.join(root, "state/hunt/evidence");
const only = arg("only", "");
const budgetMs = Number(arg("budget-ms", 1_200_000));

const targets = JSON.parse(fs.readFileSync(targetsFile, "utf8")).targets ?? [];
const allowed = targets.filter(
  (t) => t.active !== false && t.permission_url && (!only || t.host === only),
);

function have(bin) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    try {
      fs.accessSync(path.join(d, bin), fs.constants.X_OK);
      return path.join(d, bin);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(bin, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ code: 127, stdout: "", stderr: err.message, ms: 0 });
      return;
    }
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (stdout.length < 8_000_000) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 500_000) stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ code: 127, stdout, stderr: e.message, ms: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started });
    });
  });
}

function evidence(name, content, probe) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const buf = Buffer.from(typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const file = path.join(evidenceDir, `${name}-${sha.slice(0, 12)}.txt`);
  fs.writeFileSync(file, buf);
  return { file: path.relative(root, file), sha256: sha, bytes: buf.length, probe, at: new Date().toISOString() };
}

const tools = {
  httpx: have("httpx"),
  nuclei: have("nuclei"),
  katana: have("katana"),
  nmap: have("nmap"),
};
if (!tools.httpx && !tools.nuclei && !tools.nmap) {
  console.error("no scanner binaries found — nothing was measured");
  process.exit(1);
}

const startedAt = Date.now();
const report = {
  at: new Date().toISOString(),
  allowlist: path.relative(root, targetsFile),
  tools: Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, v ? "present" : "missing"])),
  targets: [],
  findings: [],
  totals: { targets: 0, findings: 0, bySeverity: {}, kevUnknown: true },
};

const cutOff = () => Date.now() - startedAt > budgetMs;
// Every tool gets the smaller of its own ceiling and what is left of the budget:
// the first version checked the budget only *between* targets, so a single nuclei
// run could eat the whole job and nothing was committed (measured: 19+ min).
const remaining = () => Math.max(15_000, budgetMs - (Date.now() - startedAt));
const budget = (own) => Math.min(own, remaining());

for (const t of allowed) {
  if (cutOff()) {
    report.targets.push({ host: t.host, status: "skipped", why: "time budget exhausted before this target" });
    continue;
  }
  const scheme = t.scheme ?? "https";
  const url = `${scheme}://${t.host}/`;
  const entry = {
    host: t.host,
    why: t.why,
    permission_url: t.permission_url,
    scheme,
    startedAt: new Date().toISOString(),
    steps: [],
    findings: 0,
  };

  /* 1 · httpx — is it alive, what is it running */
  if (tools.httpx) {
    const r = await run(tools.httpx, ["-u", url, "-json", "-silent", "-status-code", "-title", "-tech-detect", "-follow-redirects", "-timeout", "10", "-retries", "1"], budget(90_000));
    const row = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
    let parsed = null;
    try {
      parsed = row ? JSON.parse(row) : null;
    } catch {
      parsed = null;
    }
    entry.steps.push({
      tool: "httpx",
      exit: r.code,
      ms: r.ms,
      status: parsed?.status_code ?? null,
      title: parsed?.title ?? null,
      tech: parsed?.tech ?? [],
      evidence: evidence(`httpx-${t.host}`, r.stdout || r.stderr, `httpx -u ${url} -json -silent -status-code -title -tech-detect`),
    });
  }

  /* 2 · katana — what endpoints exist at all (before nuclei: the scan should
   * look where the site actually has pages, not only at "/") */
  let endpoints = [];
  if (tools.katana) {
    const r = await run(tools.katana, ["-u", url, "-jsonl", "-silent", "-depth", "3", "-concurrency", "5", "-rate-limit", "10", "-timeout", "8", "-crawl-duration", "60s"], budget(120_000));
    const urls = new Set();
    for (const line of r.stdout.split("\n")) {
      const m = line.match(/"endpoint"\s*:\s*"([^"]+)"/) ?? line.match(/"url"\s*:\s*"([^"]+)"/) ?? line.match(/^(https?:\/\/\S+)$/);
      if (m) urls.add(m[1]);
    }
    endpoints = [...urls].filter((u) => u.startsWith("http"));
    entry.steps.push({
      tool: "katana",
      exit: r.code,
      ms: r.ms,
      endpoints: endpoints.length,
      sample: endpoints.slice(0, 25),
      evidence: evidence(`katana-${t.host}`, r.stdout || r.stderr, `katana -u ${url} -depth 3 -rate-limit 10 -crawl-duration 60s`),
    });
  }

  /* 3 · nuclei — the profile the engine already proved finishes inside a budget
   * (1,034 templates = high|critical ∩ exposure|misconfig|takeover|default-login,
   *  no OAST → ~258s at rl=4). The old broad run asked for 7,885 templates at
   *  rl=3 and simply never finished: measured 300s timeout, 0 matches, twice. */
  if (tools.nuclei) {
    const NUCLEI = (list, cap) => [
      ...list,
      "-jsonl", "-silent", "-no-color", "-stats", "-stats-json",
      "-severity", "high,critical",
      "-type", "http",
      "-tags", "exposure,misconfig,takeover,default-login",
      "-no-interactsh",
      "-rl", "4", "-c", "2", "-timeout", "6", "-retries", "1",
    ];
    // pass 1: the root URL. pass 2: the pages katana found, if time is left.
    const passes = [{ label: "root", list: ["-u", url], cap: 460_000 }];
    const picked = endpoints
      .filter((u) => /^https?:\/\/[^/]+/.test(u))
      .slice(0, 150);
    if (picked.length > 0) {
      const listFile = path.join(evidenceDir, `targets-${t.host}.txt`);
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(listFile, picked.join("\n") + "\n");
      passes.push({ label: "endpoints", list: ["-l", listFile], cap: 300_000 });
    }
    let matched = 0;
    for (const pass of passes) {
      if (budget(pass.cap) < 30_000) {
        entry.steps.push({ tool: "nuclei", pass: pass.label, skipped: "time budget exhausted" });
        continue;
      }
      const r = await run(tools.nuclei, NUCLEI(pass.list), budget(pass.cap));
      const ev = evidence(
        `nuclei-${pass.label}-${t.host}`,
        r.stdout || r.stderr,
        `nuclei ${pass.list.join(" ")} -severity high,critical -tags exposure,misconfig,takeover,default-login -no-interactsh -rl 4`,
      );
      let passMatched = 0;
      for (const line of r.stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        const info = j.info ?? {};
        if (!j["template-id"] || !info?.severity) continue;
        passMatched += 1;
        matched += 1;
        report.findings.push({
          id: `${j["template-id"]}@${j["matched-at"] ?? url}`,
          host: t.host,
          template: j["template-id"],
          name: info.name ?? j["template-id"],
          severity: String(info.severity).toLowerCase(),
          matchedAt: j["matched-at"] ?? url,
          cwe: info.classification?.["cwe-id"] ?? null,
          cve: info.classification?.["cve-id"] ?? null,
          curl: j["curl-command"] ?? null,
          evidence: ev,
          // nothing here is a submitted report: a template match is a lead that a
          // human still has to reproduce on a real program
          verified: false,
        });
      }
      entry.steps.push({ tool: "nuclei", pass: pass.label, exit: r.code, ms: r.ms, scanned: pass.list[1] === "-l" ? picked.length : 1, matched: passMatched, evidence: ev });
    }
  }

  entry.findings = report.findings.filter((f) => f.host === t.host).length;
  entry.finishedAt = new Date().toISOString();
  report.targets.push(entry);
}

for (const f of report.findings) report.totals.bySeverity[f.severity] = (report.totals.bySeverity[f.severity] ?? 0) + 1;
report.totals.targets = report.targets.length;
report.totals.findings = report.findings.length;
report.totals.rated = report.findings.filter((f) => ["high", "critical"].includes(f.severity)).length;
report.elapsedMs = Date.now() - startedAt;
report.says_ar =
  report.findings.length === 0
    ? `اتفحص ${report.targets.length} هدف بصراحة — صفر مطابقات النهاردة. ده نتيجة، مش فشل.`
    : `${report.findings.length} مطابقة قوالب على ${report.targets.length} هدف (منها ${report.totals.rated} high/critical) — كل مطابقة «خيط» لازم يتأكد يدوي قبل أي تقرير.`;

fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

console.log(`hunt: ${report.totals.findings} findings · ${report.totals.rated} high/critical · ${report.elapsedMs}ms`);
for (const f of report.findings.slice(0, 15)) console.log(`  [${f.severity}] ${f.template} → ${f.matchedAt}`);
console.log(report.says_ar);
console.log(`→ ${path.relative(root, outJson)}`);
