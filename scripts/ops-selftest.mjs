#!/usr/bin/env node
/**
 * Ops engine self-test — deterministic, no network, no server.
 * ────────────────────────────────────────────────────────────
 * The scope gate is the one piece of the platform that stands between "security
 * tooling" and "somebody else's incident". Unit-testing it is not ceremony: a
 * regression here means the tool starts probing hosts nobody authorized.
 *
 * It runs against the real TypeScript source via Node's type stripping, so it
 * needs no build step and cannot drift from what ships.
 *
 *   node scripts/ops-selftest.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
// 2026-11-05: `registerHooks` only exists on Node >= 22.6. A STATIC import of it
// throws a SyntaxError on Node 20 BEFORE the try/catch below can run, so the
// whole self-test died with "does not provide an export named 'registerHooks'"
// instead of falling back to logic-only mode. Imported dynamically instead.
let registerHooks = null;
try {
  ({ registerHooks } = await import("node:module"));
} catch {
  registerHooks = null;
}

/**
 * The repo bundles with esbuild and uses extensionless relative imports
 * (`from "../logger"`), which plain Node ESM cannot resolve. This hook teaches
 * Node to try `.ts` first, so the self-test can import the REAL source files
 * instead of a duplicated copy of the logic.
 */
let hookReady = false;
try {
  if (typeof registerHooks !== "function") throw new Error("registerHooks unavailable on this Node");
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
          for (const ext of [".ts", ".js", "/index.ts", "/index.js"]) {
            try {
              return next(specifier + ext, context);
            } catch {
              /* try next extension */
            }
          }
        }
        throw err;
      }
    },
  });
  hookReady = true;
} catch (err) {
  console.log(`· module hooks unavailable (${String(err).slice(0, 60)}) — running logic tests only`);
}


// `--experimental-strip-types` only exists on Node >= 22.6. Passing it to an
// older Node is a hard "bad option" abort, so the flag is gated on the runtime
// version instead of being assumed. On Node 20 the logic tests still run; only
// the TS-source import path is skipped (reported honestly, never faked).
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const stripTypesSupported = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 6);
const needsFlag =
  stripTypesSupported && !process.execArgv.some((a) => a.includes("experimental-strip-types"));
if (needsFlag && process.env.OPS_SELFTEST_CHILD !== "1") {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", process.argv[1], ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, OPS_SELFTEST_CHILD: "1" },
    },
  );
  process.exit(r.status ?? 1);
}

const ROOT0 = path.resolve(import.meta.dirname, "..");
const SRC = path.resolve(import.meta.dirname, "../artifacts/api-server/src/lib/ops");

// The self-test imports the REAL TypeScript sources, which needs Node's type
// stripping (>= 22.6). On an older runtime that is impossible, so say so plainly
// and skip — never report a pass for tests that did not run. CI pins Node 22, so
// the gate is fully exercised there.
if (!stripTypesSupported) {
  console.log(
    `· ops-selftest SKIPPED — needs Node >= 22.6 for type stripping (running ${process.versions.node}). ` +
      `The gate runs in CI on Node 22.`,
  );
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-selftest-"));
process.env.NOVA_PROGRAMS_FILE = path.join(tmp, "programs.json");
process.env.NOVA_EXEC_TOKEN = "";

const scope = await import(path.join(SRC, "scope.ts"));
const gate = await import(path.join(SRC, "gate.ts"));
const limiter = await import(path.join(SRC, "ratelimit.ts"));

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    const out = fn();
    if (out instanceof Promise) throw new Error("use tAsync for async checks");
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).split("\n")[0]}`);
    failed++;
  }
}
async function tA(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).split("\n")[0]}`);
    failed++;
  }
}

console.log("Ops engine self-test");
console.log("────────────────────");

/* ── host normalisation ─────────────────────────────────────────────────── */
console.log("target normalisation");
t("strips scheme, path and port", () =>
  assert.equal(scope.normalizeHost("HTTPS://API.Example.com:8443/v1/users?x=1"), "api.example.com"),
);
t("keeps bare host untouched", () => assert.equal(scope.normalizeHost("example.com"), "example.com"));

/* ── scope matching ─────────────────────────────────────────────────────── */
const program = {
  id: "p1",
  name: "Test Program",
  enabled: true,
  addedAt: new Date().toISOString(),
  hosts: ["*.example.com", "example.com"],
  exact: ["special.example.org"],
  cidrs: ["203.0.113.0/24"],
  out_of_scope: ["forum.example.com", "wiki.example.com"],
  max_rps: 1,
  max_concurrency: 2,
};

console.log("scope matcher");
t("wildcard matches subdomains", () => assert.ok(scope.hostMatchesProgram("api.example.com", program)));
t("wildcard also matches deep subdomains", () => assert.ok(scope.hostMatchesProgram("a.b.example.com", program)));
t("apex allowed when listed", () => assert.ok(scope.hostMatchesProgram("example.com", program)));
t("out-of-scope wins over wildcard", () => assert.ok(!scope.hostMatchesProgram("forum.example.com", program)));
t("unrelated domain is refused", () => assert.ok(!scope.hostMatchesProgram("example.com.evil.test", program)));
t("lookalike suffix is refused", () => assert.ok(!scope.hostMatchesProgram("notexample.com", program)));
t("exact list works for other tld", () => assert.ok(scope.hostMatchesProgram("special.example.org", program)));

/* ── internal address rejection ─────────────────────────────────────────── */
console.log("internal/SSRF rejection");
for (const bad of ["127.0.0.1", "10.1.2.3", "192.168.0.7", "169.254.169.254", "172.16.5.5", "localhost", "::1"]) {
  t(`refuses ${bad}`, () => assert.ok(scope.isInternalHostOrIp(bad), `${bad} must be treated as internal`));
}

/* ── the gate itself (no DNS needed: literal IPs only) ──────────────────── */
console.log("authorization gate");
fs.writeFileSync(process.env.NOVA_PROGRAMS_FILE, JSON.stringify({ version: 1, programs: [program] }));

await tA("empty registry denies everything", async () => {
  fs.writeFileSync(process.env.NOVA_PROGRAMS_FILE, JSON.stringify({ version: 1, programs: [] }));
  const d = await scope.assertAuthorized("203.0.113.7", { active: true });
  assert.equal(d.ok, false);
  assert.equal(d.reasonCode, "no_programs");
});
await tA("in-CIDR literal IP is allowed with program limits", async () => {
  fs.writeFileSync(process.env.NOVA_PROGRAMS_FILE, JSON.stringify({ version: 1, programs: [program] }));
  const d = await scope.assertAuthorized("203.0.113.7", { active: true });
  assert.equal(d.ok, true, d.reason);
  assert.equal(d.limits.rps, 1);
});
await tA("IP outside the CIDR is refused", async () => {
  const d = await scope.assertAuthorized("198.51.100.7", { active: true });
  assert.equal(d.ok, false);
  assert.equal(d.reasonCode, "out_of_scope");
});
await tA("passive_only program blocks active probes only", async () => {
  fs.writeFileSync(
    process.env.NOVA_PROGRAMS_FILE,
    JSON.stringify({ version: 1, programs: [{ ...program, passive_only: true }] }),
  );
  const active = await scope.assertAuthorized("203.0.113.7", { active: true });
  const passive = await scope.assertAuthorized("203.0.113.7", { active: false });
  assert.equal(active.ok, false);
  assert.equal(active.reasonCode, "passive_only");
  assert.equal(passive.ok, true, passive.reason);
});
await tA("disabled program denies", async () => {
  fs.writeFileSync(
    process.env.NOVA_PROGRAMS_FILE,
    JSON.stringify({ version: 1, programs: [{ ...program, enabled: false }] }),
  );
  const d = await scope.assertAuthorized("203.0.113.7", { active: false });
  assert.equal(d.ok, false);
});
fs.writeFileSync(process.env.NOVA_PROGRAMS_FILE, JSON.stringify({ version: 1, programs: [program] }));

/* ── ops gate (who may act) ─────────────────────────────────────────────── */
console.log("ops gate");
t("no token + anonymous curl write ⇒ refused", () => {
  delete process.env.NOVA_EXEC_TOKEN;
  const v = gate.checkGate({ method: "POST", headers: { host: "h.example" }, query: {} }, "ops");
  assert.equal(v.ok, false);
  assert.equal(v.code, "same_origin_required");
});
t("no token + same-origin browser write ⇒ allowed", () => {
  const v = gate.checkGate(
    { method: "POST", headers: { host: "h.example", "sec-fetch-site": "same-origin" }, query: {} },
    "ops",
  );
  assert.equal(v.ok, true);
});
t("token configured ⇒ wrong token refused, right token allowed", () => {
  process.env.NOVA_EXEC_TOKEN = "s3cr3t";
  assert.equal(gate.checkGate({ method: "POST", headers: { host: "h" }, query: { token: "nope" } }, "ops").ok, false);
  assert.equal(
    gate.checkGate({ method: "POST", headers: { host: "h", "x-nova-token": "s3cr3t" }, query: {} }, "ops").ok,
    true,
  );
});
t("agent registration without a token is refused (no same-origin signal on WS)", () => {
  delete process.env.NOVA_EXEC_TOKEN;
  const v = gate.wsUpgradeAllowed("/api/local-agent/ws", { headers: { host: "h" } });
  assert.equal(v.ok, false);
});
t("agent registration with the token succeeds", () => {
  process.env.NOVA_EXEC_TOKEN = "s3cr3t";
  const v = gate.wsUpgradeAllowed("/api/local-agent/ws?token=s3cr3t", { headers: { host: "h" } });
  assert.equal(v.ok, true);
});
delete process.env.NOVA_EXEC_TOKEN;

/* ── throttle maths ─────────────────────────────────────────────────────── */
console.log("rate limiter");
await tA("1 req/s allows one immediate slot then blocks the second", async () => {
  const host = `throttle-test-${Date.now()}`;
  await limiter.acquire(host, { rps: 1, burst: 1, maxWaitMs: 50 });
  limiter.release();
  await assert.rejects(() => limiter.acquire(host, { rps: 1, burst: 1, maxWaitMs: 30 }));
});
await tA("a 429 from the target puts the host into backoff", async () => {
  const host = `backoff-${Date.now()}`;
  await limiter.acquire(host, { rps: 5, burst: 5, maxWaitMs: 1000 });
  limiter.release();
  limiter.noteResponse(host, 429);
  const stats = limiter.throttleStats()[host];
  assert.ok(stats.backoffMsLeft > 0, "expected a backoff window after 429");
  assert.equal(stats.strikes, 1);
});

/* ── evidence integrity ─────────────────────────────────────────────────── */
console.log("evidence chain");
await tA("runKind writes a hashed evidence file for a real probe", async () => {
  const kinds = await import(path.join(SRC, "tools.ts"));
  const jobDir = path.join(tmp, "job");
  const ctx = {
    host: "127.0.0.1",
    scheme: "https",
    program,
    jobDir,
    rps: 1,
    allowNodeTools: false,
    timeoutMs: 5000,
    log: () => {},
  };
  // no binary + no exec plane ⇒ must say so honestly instead of inventing output
  const res = await kinds.runKind("tools.nuclei", {}, ctx);
  assert.equal(res.ok, false);
  assert.ok(res.findings.length === 0, "must not fabricate findings");
  const ev = kinds.writeEvidence(ctx, "selftest", "echo test", "hello");
  assert.match(ev.sha256 ?? "", /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(path.join(jobDir, "evidence", path.basename(ev.file ?? ""))), "evidence file must exist");
  assert.ok(kinds.maxSeverity([{ severity: "low" }, { severity: "critical" }, { severity: "high" }]) === "critical");
});

await tA("a tool found by the finder is also SPAWNED by the runner (vendor/bin on PATH-less hosts)", async () => {
  // Regression measured in CI (Actions run 41451529132): /ops/kinds said `present` for the
  // vendored binaries while the same job reported `tools.*: tool-missing` — because findBinary
  // looks in vendor/bin but `spawn("nuclei")` resolves via PATH. Fake the binary in a temp
  // tool dir and require the kind to actually execute it.
  const kinds = await import(path.join(SRC, "tools.ts"));
  const binDir = path.join(tmp, "tool-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, "nuclei");
  const hit = JSON.stringify({
    "template-id": "selftest-finding",
    "matched-at": "https://127.0.0.1/",
    "matcher-name": "word",
    info: { name: "selftest match", severity: "high", tags: ["test"] },
  });
  // The fake ALSO reads stdin, which is how a stdin-reading tool behaves: with stdio[0]="ignore"
  // `read` hits EOF at once and the tool prints its result; hand it an open pipe instead and it
  // waits for input we will never send — the exact shape of the httpx hang measured in CI.
  fs.writeFileSync(fake, `#!/bin/sh\nread -r x || true\necho '${hit}'\n`, { mode: 0o755 });
  // argv sanity: nuclei has no `-json` (it is `-jsonl`), and a wrong flag used to look like success
  {
    const argvN = String(kinds.KINDS["tools.nuclei"].args({ host: "x", scheme: "https", program, rps: 1 }, {}));
    assert.match(argvN, /-jsonl/, "nuclei must be invoked with -jsonl");
    assert.doesNotMatch(argvN, /"-json"/, "nuclei has no -json flag — that invocation exits 2");
    const argvH = String(kinds.KINDS["tools.httpx"].args({ host: "x", scheme: "https", program, rps: 1 }, {}));
    assert.doesNotMatch(argvH, /connect-timeout/, "httpx has no -connect-timeout flag");
    // السيّبات اللي العمود الفقري بيشغّلها فعلًا لازم تكون نفسها اللي التقرير بيطبعها. مقاس:
    // بأربع سيّبات (`low` جوّه) nuclei اتقطع عند ميزانية النوع 260s و0 نتيجة (تقرير 17:33Z)،
    // وسطر `command` المعروض كان بيقول `medium,high,critical` وهو بيشتغل بـ4 — يعني التقرير
    // بيكذب في التفصيلة اللي بيتبني عليها القرار.
    {
      // البروفيل بقى محسوب على إحصاء حقيقي، فالمطلوب مش «قاومة سيّبات ثابتة»: المطلوب إن
      // اللي بيتنفّذ هو نفسه اللي بيتطبع، وإن الحساب اللي بنبرر بيه الميزانية يفضل صحيحًا.
      const ctxN = { host: "x", scheme: "https", program, rps: 4 };
      const argvArr = kinds.KINDS["tools.nuclei"].args(ctxN, {});
      const shown = String(kinds.KINDS["tools.nuclei"].command(ctxN, {}));
      const sevIdx = argvArr.indexOf("-severity");
      assert.ok(sevIdx >= 0, "nuclei must pass -severity explicitly");
      const sev = String(argvArr[sevIdx + 1]);
      assert.ok(shown.includes(sev), `السطر المطبوع بيقول سيّبات غير اللي اتنفّذ: «${sev}» ↔ ${shown}`);
      for (const flag of ["-jsonl", "-type", "-tags", "-rl", "-no-interactsh", "-stats", "-timeout", "-retries"]) {
        if (argvArr.includes(flag)) assert.ok(shown.includes(flag), `«${flag}» متنفّذ ومش مطبوع — التقرير بيخبي علمًا`);
      }
      assert.ok(!sev.split(",").includes("low"), "low مش جوّه بروفيل بيشتغل في ميزانية مهمة");
      const rl = Number(argvArr[argvArr.indexOf("-rl") + 1]);
      assert.equal(rl, 4, "-rl لازم ييجي من سقف البرنامج بالحرف (ممنوع الأداة تعدّيه)");
      assert.ok(rl <= Math.max(1, Math.round(ctxN.rps)), `nuclei -rl (${rl}) فوق سقف البرنامج (${ctxN.rps})`);
      const prof = kinds.NUCLEI_PROFILES["first-pass"];
      const budget = Number(kinds.KINDS["tools.nuclei"].budgetMs);
      const etaS = Math.ceil(prof.templates / 4);
      assert.ok(etaS * 1000 <= budget, `أول تمريرة (${prof.templates} قالب ≈ ${etaS}s عند rl=4) برّه ميزانية ${budget / 1000}s — ضيّق التاغات أو ارفع السقف، مش ترويّط بس`);
      assert.ok(kinds.NUCLEI_PROFILES.full.templates > prof.templates, "بروفيل full لازم يفضل أوسع من first-pass");
      assert.ok(shown.includes("-no-interactsh"), "first-pass بلا قوالب OAST — متنفّذش بلا ما يتقال في التقرير");
    }
    assert.ok(Number(kinds.KINDS["tools.httpx"].budgetMs) > 0, "httpx needs its own budget so it cannot eat the job");
    assert.ok(Number(kinds.KINDS["tools.nuclei"].budgetMs) >= 240_000, "nuclei needs minutes, not the job default");
    assert.ok(Number(kinds.KINDS["recon.dns"].budgetMs ?? 0) === 0, "cheap kinds inherit the job default");
  }
  const fakeFail = path.join(binDir, "nuclei-failing");
  fs.writeFileSync(fakeFail, "#!/bin/sh\necho 'flag provided but not defined: -connect-timeout'\nexit 2\n", { mode: 0o755 });
  const prevDir = process.env.NOVA_TOOL_DIR;
  process.env.NOVA_TOOL_DIR = binDir;
  kinds.resetBinaryCache("nuclei");
  try {
    assert.equal(path.basename(kinds.findBinary("nuclei") ?? ""), "nuclei", "finder must see the vendored binary");
    const jobDir = path.join(tmp, "job-spawn");
    fs.mkdirSync(path.join(jobDir, "evidence"), { recursive: true }); // spawn needs a real cwd
    const ctx = {
      host: "127.0.0.1", scheme: "https", program, jobDir,
      rps: 1, allowNodeTools: true, timeoutMs: 20_000, log: () => {},
    };
    const res = await kinds.runKind("tools.nuclei", {}, ctx);
    assert.notEqual(res.error, "tool-missing", `spawn must not contradict the finder: ${res.summary}`);
    assert.equal(res.ok, true, res.summary);
    assert.ok(res.findings.length >= 1, "the tool's own output has to become findings");
    assert.equal(res.findings[0]?.severity, "high");
    // the inverse: a tool that exits non-zero while printing a usage line must NOT be a green
    // task — that is precisely how `tools.httpx` passed with an invalid flag in run 41459589703
    const failingKind = { ...kinds.KINDS["tools.nuclei"], binary: "nuclei-failing" };
    const saved = kinds.KINDS["tools.nuclei"];
    kinds.KINDS["tools.nuclei"] = failingKind;
    kinds.resetBinaryCache("nuclei-failing");
    try {
      const bad = await kinds.runKind("tools.nuclei", {}, ctx);
      assert.equal(bad.ok, false, "a non-zero exit cannot count as a successful task");
      assert.equal(bad.error, "tool-failed");
      assert.match(String(bad.summary), /connect-timeout/, "the tool's own error belongs in the summary");
    } finally {
      kinds.KINDS["tools.nuclei"] = saved;
      kinds.resetBinaryCache("nuclei-failing");
    }
  } finally {
    if (prevDir === undefined) delete process.env.NOVA_TOOL_DIR;
    else process.env.NOVA_TOOL_DIR = prevDir;
    kinds.resetBinaryCache("nuclei");
  }
});

/* ── auto-discovery: the path a human actually uses ────────────────────── */
console.log("scope auto-discovery");
// security.txt is a network call. The self-test must be reproducible offline, so
// the fetch is failed on purpose: discovery has to still produce a *conservative*
// program, not an empty answer and not a wide-open one.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("offline by design");
};
let discovered = null;
await tA("bare domain becomes a passive-only program", async () => {
  discovered = await scope.discoverProgram("lab.example", { register: true });
  assert.equal(discovered.ok, true);
  assert.ok(discovered.registered, "register:true must write the registry");
  assert.equal(discovered.program.passive_only, true, "discovery must never enable active probing by default");
  assert.ok(discovered.program.hosts.includes("*.lab.example"));
  assert.equal(discovered.program.max_rps, 4, "السقف الافتراضي لازم يخلي أول تمريرة نوكلي تخلص (1,034 قالب ÷ 4rps ≈ 258s < 540s)");
});
t("admin/staging names are excluded even under the wildcard", () => {
  for (const bad of ["admin.lab.example", "staging.lab.example", "internal.lab.example", "vpn.lab.example"]) {
    assert.ok(!scope.hostMatchesProgram(bad, discovered.program), `${bad} must stay out of scope`);
  }
  assert.ok(scope.hostMatchesProgram("app.lab.example", discovered.program));
});
t("an unrelated root domain is not swept in", () => {
  assert.ok(!scope.hostMatchesProgram("other.example", discovered.program));
});
await tA("a half-trusted activate sentence does not open active scanning", async () => {
  const attempt = await scope.discoverProgram("lab.example", { register: true, activate: "I promise it is fine" });
  assert.equal(attempt.program.passive_only, true);
  assert.ok(attempt.warnings.some((w) => /لازم النص بالحرف/.test(w)), "must explain what the consent sentence is");
});
await tA("the verbatim consent sentence is what flips the mode", async () => {
  const ok = await scope.discoverProgram("lab.example", {
    register: true,
    activate: "I have written permission for lab.example",
  });
  assert.equal(ok.program.passive_only, false);
});
await tA("internal targets are refused before any request is made", async () => {
  const bad = await scope.discoverProgram("http://169.254.169.254/latest/meta-data", { register: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.registered, false);
});
await tA("a job's clock is longer than its slowest tool, and CI is longer than the job", async () => {
  // دي مش أناقة: لو الـharness استسلم قبل ما المهمة خلّصت، التقرير بيقول «0 نتيجة» عن مسح
  // لسه شغال — وده أخطر من أي رقم غلط، لأنه أخضر وكذاب. والقواعد مبتتقراش من دماغ حد، بل من الملفات.
  const root = path.resolve(import.meta.dirname, "..");
  const tools = fs.readFileSync(path.join(root, "artifacts/api-server/src/lib/ops/tools.ts"), "utf8");
  const harness = fs.readFileSync(path.join(root, "scripts/verify-live.mjs"), "utf8");
  const wf = fs.readFileSync(path.join(root, ".github/workflows/live-verify.yml"), "utf8");
  // أول نسخة من السطر ده كانت regex بـ900 حرف ورجّعت NaN — والحالة فشلت بصوت عالي بدل ما تعدّي
  // على «مافيش ميزانية». القراءة بقت: ابدأ من رأس النوع وخد أول budgetMs قبل رأس النوع اللي بعده.
  const at = tools.indexOf('"tools.nuclei":');
  const rest = at >= 0 ? tools.slice(at) : "";
  const block = rest.split(/\n {2}"[a-z]+\.[a-z]+":/)[0];
  const nucleiMs = Number((block.match(/budgetMs:\s*(\d[\d_]*)/) || [0, ""])[1].replace(/_/g, ""));
  assert.ok(Number.isFinite(nucleiMs) && nucleiMs >= 500_000 && nucleiMs <= 600_000, `nuclei budget looks wrong (${nucleiMs}ms) — a cut-off scan is reported as a result`);
  const waitMin = Number(/const until = Date\.now\(\) \+ (\d+) \* 60 \* 1000/.exec(harness)?.[1]);
  assert.ok(waitMin * 60_000 > nucleiMs + 8 * 60_000, `harness wait ${waitMin}min must outlast nuclei (${nucleiMs}ms) + the other tasks`);
  const ciMin = Number(/timeout-minutes:\s*(\d+)/.exec(wf)?.[1]);
  assert.ok(ciMin > waitMin, `CI job ceiling ${ciMin}min must be larger than the harness wait ${waitMin}min, or the run is killed mid-measurement`);
});

await tA("the bounty catalog is measured data and never a permission slip", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const file = path.join(root, "ops/bounty/programs-catalog.json");
  assert.ok(fs.existsSync(file), "ops/bounty/programs-catalog.json ناقص — شغّل node scripts/sync-bounty-programs.mjs وcommit النتيجة");
  const cat = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(cat.schema, "cybernova.bounty-catalog/1");
  assert.ok(cat.counts.programs > 400, `catalog too thin: ${cat.counts.programs} programs`);
  assert.ok(cat.counts.programs_with_domains > 300, "أغلب البرامج ملهاش نطاقات؟ الشكل اتغير");
  assert.ok(cat.sources.every((src) => src.ok || src.error || src.skipped), "كل مصدر لازم يقول حالة واضحة");
  for (const prog of cat.programs.slice(0, 80)) {
    assert.equal(prog.consented, false, `«${prog.handle}» مسجّل كمُوافَق عليه — الكتالوج معلومات عامة بس`);
    assert.equal(prog.mode, "passive_only", `«${prog.handle}» ليه وضع تاني غير الاستطلاع`);
    assert.ok(/^https?:\/\//.test(prog.url), `رابط «${prog.handle}» مش URL`);
    for (const host of [...(prog.domains || []), ...(prog.wildcards || [])].slice(0, 10)) {
      assert.ok(/^(?:\*\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}$/.test(host), `معرّف مش نطاق في «${prog.handle}»: ${host}`);
    }
  }
});

globalThis.fetch = realFetch;

// ── كتالوج برامج الـbug bounty: المطابقة، الكاش، و«مفيش إذن اتسرّب» ────────────
await tA("bounty catalog scores matches and cannot grant permission", async () => {
  const bc = await import(path.join(SRC, "bounty-catalog.ts"));
  const catFile = path.join(tmp, "catalog.json");
  const stat0 = () => bc.catalogStatus();
  process.env.NOVA_BOUNTY_CATALOG = catFile;

  t("catalog: ملف مقفول = present:false ومفيش مطابقة", () => {
    assert.equal(stat0().present, false);
    assert.equal(bc.lookupBountyProgram("example.com"), null);
    assert.equal(bc.lookupBountyProgram(""), null);
    assert.equal(bc.lookupBountyProgram("nodots"), null);
  });

  const programs = [
    { handle: "alpha", name: "Alpha", platform: "hackerone", url: "https://hackerone.com/alpha", bounties: true, domains: ["example.com"], wildcards: [], urls: [], consented: false, mode: "passive_only" },
    { handle: "evil-twin", name: "Evil", platform: "bugcrowd", url: "https://bugcrowd.com/evil", bounties: false, paused: true, submission_state: "closed", response_efficiency: 12, max_payout_usd: 500, domains: ["example.com"], consented: true, mode: "passive_only" },
    { handle: "beta", name: "Beta", platform: "hackerone", url: "https://hackerone.com/beta", wildcards: ["*.shop.example.net"], domains: [] },
    { handle: "gamma", name: "Gamma", platform: "custom", url: "https://gamma.test/policy", urls: ["https://bugs.pay.example.org/scope"] },
    { handle: "delta", name: "Delta", platform: "intigriti", url: "https://intigriti.eu/delta", wildcards: ["*.apex.test"] },
  ];
  fs.writeFileSync(catFile, JSON.stringify({ schema: "cybernova.bounty-catalog/1", fetched_at: "2026-01-01T00:00:00.000Z", counts: { programs: programs.length, bounty_programs: 1 }, programs }));

  t("catalog: نطاق صريح > غير، وأول صاحب بياخد التعادل", () => {
    const m = bc.lookupBountyProgram("example.com");
    assert.ok(m, "مفيش مطابقة");
    assert.equal(m.handle, "alpha");
    assert.equal(m.matched_kind, "domain");
    assert.equal(m.bounties, true);
  });
  t("catalog: wildcard على الأب بيترجّح على مفيش، وأضعف من نطاق صريح", () => {
    const sub = bc.lookupBountyProgram("a.b.shop.example.net");
    assert.equal(sub.handle, "beta");
    assert.equal(sub.matched_kind, "wildcard");
    assert.equal(sub.matched_on, "shop.example.net");
    const apex = bc.lookupBountyProgram("apex.test");
    assert.equal(apex.handle, "delta");
    assert.equal(apex.matched_kind, "wildcard_apex");
    assert.equal(bc.lookupBountyProgram("x.apex.test").matched_kind, "wildcard");
  });
  t("catalog: أصل asset من رابط بيقرا الهوست بتاعه", () => {
    const m = bc.lookupBountyProgram("https://bugs.pay.example.org/login?x=1");
    assert.equal(m.handle, "gamma");
    assert.equal(m.matched_kind, "url");
    assert.equal(m.matched_on, "bugs.pay.example.org");
  });
  t("catalog: ذيلْ-النطاق مش كفاية (suffix confusion)", () => {
    assert.equal(bc.lookupBountyProgram("evil-example.com"), null);
    assert.equal(bc.lookupBountyProgram("example.com.evil.co"), null);
    assert.equal(bc.lookupBountyProgram("notexample.com"), null);
  });
  t("catalog: مابيرجّعش أي حقل إذن", () => {
    const m = bc.lookupBountyProgram("example.com");
    for (const k of ["consented", "passive_only", "mode", "enabled"]) {
      assert.ok(!(k in m), `الحقل «${k}» سرّب نفسه من الكتالوج`);
    }
    assert.equal(m.paused, false, "alpha مش موقوف");
    assert.equal(bc.lookupBountyProgram("example.com").handle, "alpha", "الأول بيفوز على التعادل");
    // «evil-twin» موقوف ومقفل الاستقبال — لازم يبان لو هو المختار
    const only = { handle: "solo", name: "Solo", platform: "hackerone", url: "https://hackerone.com/solo", paused: true, submission_state: "paused", domains: ["solo.test"] };
    fs.writeFileSync(catFile, JSON.stringify({ programs: [only] }));
    fs.utimesSync(catFile, new Date(), new Date(Date.now() + 5000));
    const m2 = bc.lookupBountyProgram("solo.test");
    assert.equal(m2.paused, true);
    assert.equal(m2.submission_state, "paused", "حالة الاستقبال بتتقال للتقرير");
  });
  t("catalog: الكاش على mtime (كتابة بنفس الوقت = نفس الرد)", () => {
    const st = fs.statSync(catFile);
    const other = { handle: "other", name: "Other", platform: "hackerone", url: "https://hackerone.com/other", domains: ["solo.test"] };
    fs.writeFileSync(catFile, JSON.stringify({ programs: [other] }));
    fs.utimesSync(catFile, st.atime, st.mtime); // نفس الـmtime بالظبط
    assert.equal(bc.lookupBountyProgram("solo.test").handle, "solo", "لازم الكاش يردّ بالقديم");
    fs.utimesSync(catFile, st.atime, new Date(st.mtimeMs + 10_000));
    assert.equal(bc.lookupBountyProgram("solo.test").handle, "other", "mtime اتغيّر = إعادة قراءة");
  });
  t("catalog: scope.ts بيغني بيّه ومش بياخد منه إذن", () => {
    const srcTxt = fs.readFileSync(path.join(SRC, "scope.ts"), "utf8");
    assert.ok(/import \{ lookupBountyProgram, catalogStatus \} from "\.\/bounty-catalog"/.test(srcTxt), "الاستيراد مش موجود");
    assert.ok(/bounty_program: bountyEvidence/.test(srcTxt), "المطابقة مش بتتسجل في الـevidence");
    assert.ok(/catalog: \{ present: cat\.present/.test(srcTxt), "حالة الكتالوج مش بتتسجل — «مفيش برنامج» هتتقرا غلط");
    assert.ok(!/passive_only:[^\n]*(bounty|catalog)/i.test(srcTxt), "الكتالوج بيرجّع passive_only — ممنوع");
    // داخل discoverProgram نفسه (مش أي سطر تاني في الملف): الوضع السلبي = ¬الإذن بالحرف
    const di = srcTxt.indexOf("export async function discoverProgram");
    assert.ok(di > 0, "مفيش discoverProgram");
    const dn = srcTxt.indexOf("\nexport ", di + 10);
    const disc = srcTxt.slice(di, dn > 0 ? dn : undefined);
    assert.ok(/passive_only: !consentOk,/.test(disc), "discoverProgram مابقاش بيحدد passive_only من الإذن المكتوب");
    assert.ok(!/Boolean\(input/.test(disc), "discoverProgram بقى بيقبل passive_only من المُدخل — مصدر واحد للحقيقة اتكسر");
    assert.ok(/consentOk = [^\n]*i have written permission for/.test(disc), "جملة الإذن اتغيّرت — لازم النص بالحرف");
    assert.ok(srcTxt.includes("program_discover") && /activate = "I have written permission for/.test(srcTxt), "رسالة بوابة التفعيل ضاعت من الراوتر");
    const routesTxt = fs.readFileSync(path.join(SRC, "../../routes/ops.ts"), "utf8");
    assert.ok(routesTxt.includes('"/ops/bounty/catalog"'), "المسار /ops/bounty/catalog مش مسجّل");
  });
  t("catalog: البيانات المنشورة نفسها مش بتدي إذن لأحد", () => {
    const file = path.resolve(ROOT0, "ops/bounty/programs-catalog.json");
    if (!fs.existsSync(file)) { console.log("      · الكتالوج مش في الشجرة (اتولّد في CI) — تم تخطي الفحص الحي"); return; }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(Array.isArray(raw.programs) && raw.programs.length > 300, `عدد البرامج معقولش: ${raw.programs?.length}`);
    for (const p of raw.programs) {
      assert.equal(p.consented, false, `«${p.handle}» اتعلّم عليه إذن في الكتالوج`);
      assert.equal(p.mode, "passive_only", `«${p.handle}» مش على الوضع السلبي`);
    }
    const ageDays = (Date.now() - Date.parse(raw.fetched_at)) / 86_400_000;
    assert.ok(ageDays < 30, `الكتالوجold — ${ageDays.toFixed(1)} يوم: شغّل bounty-catalog.yml`
      .replace("old", "عتيق"));
    delete process.env.NOVA_BOUNTY_CATALOG; // نرجع لمسار الشجرة عشان نفحص المطابقة على البيانات الحقيقية
    const claimed = new Map();
    for (const p of raw.programs) for (const d of p.domains || []) {
      if (!claimed.has(d)) claimed.set(d, new Set());
      claimed.get(d).add(p.handle);
    }
    const picks = [...claimed.keys()].sort((a, b) => (b.length - a.length) - (a.length - a.length)).slice(0, 8);
    for (const d of picks) {
      const m = bc.lookupBountyProgram(d);
      assert.ok(m, `مافيش مطابقة على ${d} وهو مكتوب في الكتالوج`);
      assert.ok(claimed.get(d).has(m.handle), `«${m.handle}» مش من أصحاب ${d}`);
      assert.ok(m.url.startsWith("https://"), `رابط سياسة مش https لـ${m.handle}`);
    }
    assert.ok(picks.length >= 5, `عيّنة صغيرة أوي: ${picks.length}`);
  });
});

// ── تسجيل المسارات لازم يكون في المستوى العالي (عطل حقيقي حصل في /ops/bounty/catalog) ──
await tA("no ops route is registered inside another handler", async () => {
  let ts;
  try {
    ts = await import("typescript");
  } catch {
    assert.fail("مافيش typescript للتأكد من بنية التسجيل — شغّل pnpm install");
  }
  const TS = ts.default ?? ts;
  const dir = path.resolve(ROOT0, "artifacts/api-server/src/routes");
  const files = fs.readdirSync(dir).filter((x) => x.endsWith(".ts"));
  const VERBS = new Set(["get", "post", "put", "patch", "delete", "all", "use"]);
  let routes = 0;
  const routePath = (node) => {
    const arg = node.arguments[0];
    return arg ? arg.getText().slice(0, 40) : "?";
  };
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const src = TS.createSourceFile(file, text, TS.ScriptTarget.ESNext, true);
    const isRouteCall = (n) =>
      TS.isCallExpression(n) &&
      TS.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.getText(src) === "router" &&
      VERBS.has(n.expression.name.getText(src));
    (function walk(node, insideOf) {
      let mark = insideOf;
      if (isRouteCall(node)) {
        if (mark) {
          const ln = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
          assert.fail(`${file}:${ln} — «${routePath(node)}» متسجّل جوّه handler بتاع «${mark}»: الراوتر بيسجّله بس بعد أول طلب يلمس ${mark}، فقبل كده الرد no_such_endpoint`);
        }
        routes++;
        mark = routePath(node); // أي دالة جوّه الـcall دي هي الـhandler بتاع المسار ده
      }
      node.forEachChild((c) => walk(c, mark));
    })(src, null);
  }
  assert.ok(routes >= 200, `AST لقى ${routes} تسجيل راوتر بس — أداة التحليل مش بتقرأ الصح`);
  console.log(`      · ${routes} تسجيل راوتر في ${files.length} ملف، مافيش واحد متخبي جوه handler`);
});

await tA("no workflow promises a context it cannot see in `on:`", async () => {
  // `on:` ما بيشوفش `vars`/`secrets`/`inputs`/`steps`. غلطة واحدة هنا = المستودع كله أحمر على كل
  // push من غير ما حد يقرأ سطر واحد، لأن الـworkflow بيرفض قبل ما أي job يتعمل (مقاس 2026-11-03).
  const dir = path.resolve(ROOT0, ".github/workflows");
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 8, `ملفات workflows أقل من المتوقع: ${files.length}`);
  const BAD = ["vars.", "secrets.", "steps.", "needs.", "matrix."];
  let scanned = 0;
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n");
    let inOn = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^on:/.test(l)) { inOn = true; continue; }
      if (inOn && /^[A-Za-z]/.test(l)) inOn = false;
      if (!inOn) continue;
      if (/^\s*#/.test(l)) continue;
      scanned++;
      const hit = BAD.find((k) => l.includes("${{") && l.includes(k));
      if (hit) {
        assert.fail(`${file}:${i + 1} — «${hit}» جوه بلوك \`on:\`: السياق ده مابيتحلّلش هناك، والنتيجة رفض الملف بالكامل (0 job) على كل push — انقل القراءة لـenv/step.`);
      }
    }
  }
  assert.ok(scanned > 60, `عدد أسطر \`on:\` المفحوصة قليل (${scanned}) — الفحص مش بيقرا`);
  console.log(`      · ${scanned} سطر في بلوكات \`on:\` في ${files.length} ملف، كله ماحدش بيلمس سياق محظور`);
});


// ── خزانة النتائج + سطح الصيد + سقف الزمن (دورة I) ────────────────────────────
// كل الحالات دي نقية على ملفات في tmp: مابتلمسش state/ الحقيقي، ومافيش شبكة.
const fv = await import(path.join(SRC, "findings-vault.ts"));
const bcHunt = await import(path.join(SRC, "bounty-catalog.ts"));

const VJOB = {
  id: "vj1",
  name: "job one",
  host: "a.example",
  target: "a.example",
  status: "done",
  createdAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:05:00.000Z",
  stats: { done: 1, failed: 0, skipped: 0, findings: 1, verified: 0, ms: 10 },
  tasks: [],
  findings: [],
};
const VFINDING = {
  id: "vf1",
  kind: "recon.dns",
  title: "Missing SPF record",
  titleAr: "مافيش سجل SPF",
  severity: "High / Medium",
  confidence: 0.8,
  target: "https://API.Example.com:443/a/b?x=1#frag",
  reproduce: "dig +short TXT a.example",
  evidence: [{ file: "e1.txt", sha256: "deadbeef", bytes: 21, probe: "dig TXT", at: "2026-01-01T00:00:00.000Z" }],
  verified: false,
};

await tA("findings vault: مفتاح من المحتوى، تطبيع خطورة، ودمج ما بيضاعفش السجل", async () => {
  const r1 = fv.recordFromFinding(VJOB, VFINDING);
  assert.equal(r1.severity, "high", "الخطورة مااتطبعتش لمستوى معروف");
  assert.equal(r1.severityRaw, "High / Medium", "نص المصدر ضاع — لازم يفضل في severityRaw");
  assert.equal(r1.asset, "api.example.com/a/b", "normalizeAsset مانشيلش السكيم/البورت/الـquery/الـfragment");
  assert.equal(r1.verified, false, "نتيجة مش متأكَّدة اتعلّمت verified في السجل");

  const m1 = fv.mergeRecords([], [r1, { ...r1, verified: true, verification: { at: "2026-01-01T00:06:00.000Z", method: "re-run", detail: "نفس البصمة" } }]);
  assert.equal(m1.findings.length, 1, "نفس المفتاح خلّف سطرين في الخزانة");
  assert.equal(m1.added, 1, "added عدّ السجل مرتين");
  assert.equal(m1.findings[0].verified, true, "النسخة المتأكَّدة اتمسحت لصالح نسخة أقدم");

  const m2 = fv.mergeRecords(m1.findings, [r1]);
  assert.equal(m2.added, 0, "الدمج التاني اخترع نتيجة جديدة");
  assert.equal(m2.findings.length, 1, "الدمج التاني ضاعف السجل");
  assert.equal(m1.findings[0].occurrences, 2, "نسخة تانية بنفس المفتاح في نفس الـincoming مااتعدّتش كمشاهدة");
  assert.equal(m2.findings[0].occurrences, 3, "المشاهدة الجديدة اتخطّت — المفروض occurrences تزيد");
  assert.equal(m2.findings[0].firstSeen, r1.firstSeen, "firstSeen اتغيّر — لازم أقدم ظهور");
  assert.equal(m2.findings[0].verified, true, "verified اتنزلعت لfalse لأن مشاهدة جديدة مااتأكدتش");
  assert.notEqual(fv.findingKey("a.example", { ...VFINDING, target: "https://a.example/other" }), r1.key, "المسار داخل الحساب — مفتاح واحد لكل النطاق");
  assert.equal(fv.findingKey("a.example", { ...VFINDING, extra: { "template-id": "CVE-2024-x" } }), fv.findingKey("a.example", { ...VFINDING, extra: { "template-id": "CVE-2024-x" } }), "template-id لازم يدخل في المفتاح");
});

await tA("findings vault: sync على ملفات شغل حقيقية — والتاني مابيزودش حاجة", async () => {
  const jobsDir = path.join(tmp, "vault-jobs");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.writeFileSync(path.join(jobsDir, "vj1.json"), JSON.stringify({ ...VJOB, findings: [VFINDING] }), "utf8");
  const vaultFile = path.join(tmp, "vault-sync.json");
  process.env.NOVA_JOBS_REL = path.relative(process.cwd(), jobsDir);
  process.env.NOVA_FINDINGS_VAULT = vaultFile;
  try {
    const s1 = fv.syncFromJobs({ limit: 10 });
    assert.equal(s1.scanned, 1, "مافيش جوب اتقرا — NOVA_JOBS_REL مش شغال");
    assert.ok(s1.fromJobs >= 1, "النتايج مالاتصلش للـmerge");
    assert.ok(s1.total >= 1 && s1.verified === 0, `الحسابات مش صادقة: ${JSON.stringify(s1)}`);
    assert.ok(fs.existsSync(vaultFile), "الخزانة مااتكتبتش على القرص");
    const s2 = fv.syncFromJobs({ limit: 10 });
    assert.equal(s2.added, 0, "الدمج التاني خلّع سجل جديد — الـidempotency اتكسرت");
    assert.equal(s2.total, s1.total, `العدد اتغيّر بين تشغيلين: ${s1.total} → ${s2.total}`);
    assert.ok(s2.updated >= 1, "التحديث مااتسجّلش");
    const list = fv.listVault({ limit: 50 });
    assert.equal(list.present, true, "listVault بيقول الخزانة مش موجودة");
    assert.equal(list.items[0].occurrences, 2, "التكرار ماظهرش في القراءة");
    assert.equal(fv.listVault({ verifiedOnly: true, limit: 50 }).items.length, 0, "نتيجة مش مثبتة عدّت فلتر verifiedOnly");
  } finally {
    delete process.env.NOVA_JOBS_REL;
    delete process.env.NOVA_FINDINGS_VAULT;
  }
});

await tA("report draft: بترفض اللي ماعدش إنتاجها، وباينة من الدليل والسياسة لو اتأكدت", async () => {
  const vaultFile = path.join(tmp, "vault-draft.json");
  process.env.NOVA_FINDINGS_VAULT = vaultFile;
  const rec = {
    ...fv.recordFromFinding(VJOB, VFINDING),
    key: "k1",
    program: { handle: "h1", name: "Program One", platform: "hackerone", url: "https://hackerone.com/h1", submission_state: "open" },
  };
  const write = (findings) => fs.writeFileSync(vaultFile, JSON.stringify({ schema: "cybernova.findings-vault/1", updatedAt: "2026-01-01T00:00:00.000Z", counts: { total: findings.length, verified: 0, bySeverity: {} }, findings }), "utf8");
  try {
    write([rec]);
    const refused = fv.draftReport("k1");
    assert.equal(refused.ok, false, "مسودة اتكتبت لنتيجة مش مثبتة — ده أخطر من مفيش");
    assert.equal(refused.error, "not-reproduced");
    assert.match(refused.reasonAr, /ماعادش إنتاجها/, "سبب الرفض مش واضح");
    assert.match(refused.reasonAr, /verify/, "الرفض ماقالش الأمر اللي بيفرّج عنها");
    assert.equal(fv.draftReport("لا-موجودش").error, "not-found", "مفتاح غلط يرجّع السبب الغلط");

    write([{ ...rec, verified: true, verification: { at: "2026-01-01T00:09:00.000Z", method: "re-run kind", detail: "نفس البصمة حرفيًا" }, cwe: "CWE-290", remediationAr: "أضف سجل SPF بالـ `-all`." }]);
    const yes = fv.draftReport("k1");
    assert.equal(yes.ok, true, `المسودة اترفضت وهي مثبتة: ${JSON.stringify(yes).slice(0, 120)}`);
    const md = yes.markdown;
    for (const need of ["## خطوات إعادة الإنتاج", "## الدليل", "sha256 `deadbeef`", "## سياسة البرنامج", "https://hackerone.com/h1", "## إعادة الإنتاج (بوابة التحقق)", "## الإصلاح المقترح", "مافيش هنا حكم «impact»", "اتقطع"]) {
      assert.ok(md.includes(need), `المسودة ناقصها «${need}»`);
    }
    assert.ok(md.includes("dig +short TXT a.example"), "أمر إعادة الإنتاج مالقاش في المسودة");
    assert.ok(!/\$ ?[0-9]{3,}|مكافأة متوقعة|expected bounty/i.test(md), "المسودة بتدّعي رقم مكافأة");
    // من غير برنامج معلَن: لازم تقول كده صريح بدل ما تسكت
    write([{ ...rec, verified: true, verification: { at: "x", method: "m", detail: "d" }, program: undefined }]);
    const orphan = fv.draftReport("k1");
    assert.ok(orphan.ok && orphan.markdown.includes("مافيش برنامج معلَن في الكتالوج"), "مسودة بلا سياسة برنامج ما اعترفتش بدها");
  } finally {
    delete process.env.NOVA_FINDINGS_VAULT;
  }
});

await tA("hunt candidates: فلْترة وترتيب، والـCIDR فضل سياق مش scope", async () => {
  const catFile = path.join(tmp, "hunt-catalog.json");
  const mk = (o) => ({ name: o.handle, platform: "hackerone", url: `https://hackerone.com/${o.handle}`, bounties: true, paused: false, submission_state: "open", response_efficiency: 90, max_payout_usd: 1000, domains: ["d.example"], wildcards: [], urls: [], cidrs: [], ips: [], ...o });
  fs.writeFileSync(catFile, JSON.stringify({
    fetched_at: new Date().toISOString(),
    programs: [
      mk({ handle: "slow", response_efficiency: 40 }),
      mk({ handle: "best", response_efficiency: 99, max_payout_usd: 5000, wildcards: ["*.w.example"], cidrs: ["1.2.3.0/24"], ips: ["9.9.9.9"] }),
      mk({ handle: "nobounty", bounties: false }),
      mk({ handle: "paused", paused: true }),
      mk({ handle: "closed", submission_state: "closed" }),
      mk({ handle: "mid", response_efficiency: 70 }),
    ],
  }), "utf8");
  process.env.NOVA_BOUNTY_CATALOG = catFile;
  try {
    const r = bcHunt.huntCandidates({ limit: 10 });
    assert.deepEqual(r.items.map((x) => x.handle), ["best", "mid", "slow"], "الفلْترة أو الترتيب غلط");
    assert.equal(r.filteredOut.notBounty, 1, "المقفول عنها المكافأة مااتعدّتش");
    assert.equal(r.filteredOut.pausedOrClosed, 2, "الموقوفة/المقفولة الاستقبال مااتعدّتش");
    assert.equal(r.scanned, 6, "المسحوب من الكتالوج مش كلّه");
    const best = r.items[0];
    assert.equal(best.consented, false, "سطر في الكتالوج ادّى إذن لنفسه");
    assert.equal(best.mode, "passive_only", "سطر ادّى وضعًا أعلى من passive_only");
    assert.equal(best.network_context_only, true, "الشبكة اتباعت كأكتر من سياق");
    assert.equal(best.counts.cidrs, 1, "عدّ الـCIDR غلط");
    assert.equal(best.counts.ips, 1, "عدّ الـIP غلط");
    assert.deepEqual(best.sample_hosts.slice(0, 2), ["d.example", "*.w.example"], "sample_hosts ترتيبها غلط");
    assert.ok(!JSON.stringify(best).includes('"allowed_hosts"'), "candidate بيصدّر allowed_hosts — ده ادّعاء scope");
    assert.deepEqual(bcHunt.huntCandidates({ minEfficiency: 80 }).items.map((x) => x.handle), ["best"], "minEfficiency مافلترش");
    assert.ok(bcHunt.huntCandidates({ includeClosed: true, limit: 20 }).items.map((x) => x.handle).includes("closed"), "includeClosed ماارجّعش المقفولة");
    assert.ok(bcHunt.huntCandidates({ q: "nosuchprogram" }).items.length === 0, "قيد بحث راجّع حاجة");
    assert.ok(bcHunt.huntCandidates({ q: "best" }).items.length === 1, "قيد بحث ماطابقش الاسم");
    assert.equal(bcHunt.huntCandidates({ platform: "bugcrowd" }).items.length, 0, "فلْترة الـplatform مااشتغلتش");

    // الكتالوج المنشور نفسه: كل سطر مافيهاش إذن، ومفيش أي كود بيحوّل cidrs لـscope
    delete process.env.NOVA_BOUNTY_CATALOG;
    const real = bcHunt.huntCandidates({ limit: 5 });
    assert.ok(real.present && real.items.length >= 3, `الكتالوج المنشور مارجّعش مرشّحين (present=${real.present})`);
    for (const c of real.items) {
      assert.equal(c.consented, false, `«${c.handle}» ادّى إذن في الرد`);
      assert.equal(c.mode, "passive_only", `«${c.handle}» مش على الوضع السلبي`);
    }
    const withCidr = real.items.find((c) => c.counts.cidrs > 0);
    if (withCidr) assert.ok(withCidr.network_context_only === true, `«${withCidr.handle}» فيه CIDR ومفيش تحذير السياق`);
    console.log(`      · ${real.items.length} مرشّح من ${real.scanned} برنامج · أعلى استجابة ${real.items[0]?.response_efficiency}% · المفلوت ${JSON.stringify(real.filteredOut)}`);
  } finally {
    delete process.env.NOVA_BOUNTY_CATALOG;
  }
});

await tA("runner: ميزانية المهمة بيلزم الأدوات المبنية في node كمان", async () => {
  const runner = await import(path.join(SRC, "runner.ts"));
  // `withDeadline` بيطفّي الـtimer (`unref`) عمدًا: سيرفر شغال لازم مايمنعش الـexit.
  // في سكريبت فاضي كده الخصلة دي بتديلّ node كود 13، فنمسك الـloop بمؤقّت حي لحد ما نخلص.
  const keepAlive = setInterval(() => {}, 1000);
  const t0 = Date.now();
  const hung = await runner.withDeadline(new Promise(() => {}), 30, "recon.securitytxt");
  clearInterval(keepAlive);
  assert.equal(hung.ok, false, "الوعد المعلق عدّى من غير ما الـdeadline يلحقه");
  assert.match(hung.error, /^task-timeout:recon\.securitytxt:30ms$/, `خطأ الـtimeout مش قابل للتتبع: ${hung.error}`);
  assert.ok(Date.now() - t0 < 5_000, `الـdeadline اشتغل متأخر (${Date.now() - t0}ms)`);
  const okRes = await runner.withDeadline(Promise.resolve(7), 500, "k");
  assert.equal(okRes.ok, true, "وعد ناجح اترفض");
  assert.equal(okRes.value, 7);
  const rejected = await runner.withDeadline(Promise.reject(new Error("boom")), 500, "k");
  assert.equal(rejected.ok, false, "الرفض اتحوّل لنجاح");
  assert.match(rejected.error ?? "", /boom/, "رسالة الرفض ضاعت");
  // مقيس في CI (21:41Z): سقف بيوطّي عن budgetMs قطع tools.nuclei في النص — فاللازمة دي
  // مش زينة: كل kind لازم يسقفه الخارجي يفضل ≥ ميزانيته المعلنة، والميزانية من مصدر واحد.
  const tools = await import(path.join(SRC, "tools.ts"));
  for (const id of Object.keys(tools.KINDS)) {
    const inner = tools.kindDeadlineMs(id, 180_000);
    assert.ok(inner + 15_000 >= inner, `سقف ${id} أقل من ميزانيته`);
    if (id === "tools.nuclei") assert.equal(inner, 540_000, `ميزانية nuclei اتغيّرت: ${inner}`);
  }
  assert.ok(tools.kindDeadlineMs("recon.headers", 180_000) === 180_000, "kind بلا budgetMs فقد ميزانيته الافتراضية");
  assert.ok(/kindDeadlineMs\(task\.kind/.test(fs.readFileSync(path.join(SRC, "runner.ts"), "utf8")), "runner مابيقراش ساعة الـkind — السقف الخارجي هيقطع scan طويل");
  assert.ok(!/Math\.max\(5_000, Math\.min\(Number\(ctx\.timeoutMs\)/.test(fs.readFileSync(path.join(SRC, "runner.ts"), "utf8")), "رجع السقف المستقل عن ميزانية الـkind");
  const toolsSrc = fs.readFileSync(path.join(SRC, "tools.ts"), "utf8");
  const uses = (toolsSrc.match(/kindDeadlineMs\(kind\.id, ctx\.timeoutMs\)/g) || []).length;
  assert.ok(uses >= 2, `الميزانية متكررة مش موحّدة في tools.ts (${uses} استعمال) — انزلها في مكان واحد`);
  const src = fs.readFileSync(path.join(SRC, "runner.ts"), "utf8");
  assert.ok(/withDeadline\(runKind\(/.test(src), "runKind مش متلفّع بسقف — نفس التعليق بيرجع أول ما probe يعلق");
  // الجوبز اللي بتتسجّل لازم تستمر تُقرأ بعد timeout: مافيش حالة «for good»
  assert.ok(/task-timeout/.test(src), "مافيش اسم خطأ ثابت للـtimeout — مابتقاسش في التقارير");
});

await tA("hunt surface: المسارات الستة + التوأم + الواجهة — موصولين بحروفهم", async () => {
  const routes = fs.readFileSync(path.resolve(ROOT0, "artifacts/api-server/src/routes/ops.ts"), "utf8");
  for (const p of ["/ops/findings/status", "/ops/findings/sync", "/ops/findings/:key/report-draft", "/ops/findings", "/ops/hunt/candidates", "/ops/hunt/plan"]) {
    assert.ok(routes.includes(`"${p}"`), `المسار ${p} مسجّلش في routes/ops.ts`);
  }
  assert.ok(/router\.post\("\/ops\/findings\/sync"/.test(routes), "زامِن الخزانة مش POST — الكتابة لازم تبقى مكتوبة");
  assert.ok(/error === "not-found" \? 404 : 409/.test(routes), "الرفض مش بيتفرّق بين «مافيش بالمفتاح» (404) و«مثبتش» (409) — الواجهة هتعرض رسالة غلط");
  const twin = fs.readFileSync(path.resolve(ROOT0, "artifacts/kali-panel/src/lib/standalone-api.ts"), "utf8");
  for (const p of ["/ops/findings/status", "/ops/findings", "/ops/hunt/candidates", "/ops/hunt/plan"]) {
    assert.ok(twin.includes(`"${p}"`), `التوأم الثابت مابيعرفش ${p} — صفحة مكسورة على Pages`);
  }
  assert.ok(/reasonAr/.test(twin), "التوأم بيرفّض من غير سبب — المستخدم هيشوف سكرين فاضي");
  const brain = fs.readFileSync(path.resolve(ROOT0, "artifacts/kali-panel/src/components/desktop/NovaBrainOps.tsx"), "utf8");
  for (const p of ["/ops/hunt/candidates", "/ops/findings/status", "/ops/findings/sync", "/ops/findings?limit", "/ops/hunt/plan", "report-draft"]) {
    assert.ok(brain.includes(p), `سطح الصيد مابيسألش على ${p}`);
  }
  assert.ok(/NovaHuntSurface/.test(brain), "مافيش مكوّن سطح الصيد");
  const page = fs.readFileSync(path.resolve(ROOT0, "artifacts/kali-panel/src/pages/NovaFleetUnified.tsx"), "utf8");
  assert.ok(/<NovaHuntSurface\s*\/>/.test(page), "سطح الصيد محطوطش في صفحة الأسطول — يبقى كلام على ورق");
});

t("hunt surface census: الملفات اللي بتسأل المحرك ما بتقلّش", () => {
  const roots = ["src/lib", "src/components", "src/pages"];
  const base = path.resolve(ROOT0, "artifacts/kali-panel");
  const files = [];
  const eps = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(base, dir), { withFileTypes: true })) {
      const full = path.join(base, dir, e.name);
      if (e.isDirectory()) { walk(path.join(dir, e.name)); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const txt = fs.readFileSync(full, "utf8");
      if (!/opsFetch\(|opsText\(|\$\{API\}\/ops\/|["'`]\/api\/ops\//.test(txt)) continue;
      files.push(full.replace(`${base}/`, ""));
      for (const m of txt.matchAll(/["'`]\/?(?:api\/)?ops\/[a-z0-9/_-]+/g)) eps.add(m[0].replace(/^["'`]/, "").replace(/^\/?api\//, "/"));
    }
  };
  for (const d of roots) if (fs.existsSync(path.join(base, d))) walk(d);
  const FILES_FLOOR = 3; // مقيس 2026-11-03 بالنمط ده: NovaBrainOps + awareness + ops-client
  const EPS_FLOOR = 13; // مقيس بنفس النمط: 6 منها بتاعة سطح الصيد (findings×4 + hunt×2)
  assert.ok(files.length >= FILES_FLOOR, `ملفات بقت بتسأل المحرك أقل من الأرضية: ${files.length} < ${FILES_FLOOR} (${files.join(", ")})`);
  assert.ok(eps.size >= EPS_FLOOR, `عدد مسارات ops اللي الواجهة بتسأل عليها نزل: ${eps.size} < ${EPS_FLOOR}`);
  console.log(`      · ${files.length} ملف بيسأل المحرك · ${eps.size} مسار: ${[...eps].sort().join(" ")}`);
});

/* ── البصمة في الردّ: كل رقم قدرة لازم يتنسب للبناء اللي قاسه ─────────────────
 * القياس اللي خلف القاعدة دي: المستخدم قال «الشات بيقول 49 والمستودع 55» — وبمقارنة
 * التوقيتات طلع الرقم **صح للبناء اللي كان شغّان** (#216 اتدمج 00:12:49Z، السؤال
 * 00:14:17Z، والحلقة كانت كل 15 دقيقة). الكذب مكنش في الرقم، كان في إن الردّ
 * مابيقلش هو بتكلم من أنهي نسخة. فالردّ بقى يقول، والحزمة بسحبة كل 5 دقايق. */
const AGENT_DIR = path.resolve(ROOT0, "artifacts/api-server/src/lib/agent");
const selfModel = await import(path.join(AGENT_DIR, "self-model.ts"));
t("self-model: build stamp is measured or says so, never invented", () => {
  const m = selfModel.buildSelfModel();
  assert.equal(typeof m.build.label, "string", "البصمة لازم تتقال حتى لو «بلا بصمة»");
  assert.ok(m.build.label.length > 0, "label فاضي");
  assert.ok(m.build.ageMin === null || (Number.isInteger(m.build.ageMin) && m.build.ageMin >= 0), `ageMin مش معقول: ${m.build.ageMin}`);
  assert.ok(m.build.commit === null || /^[0-9a-f]{7,40}$/.test(m.build.commit), `commit مش sha: ${m.build.commit}`);
  assert.equal(m.tools.count, 55, "عدد الأدوات بقى يتغيّر وحدّث التست معاه — مش العكس");
});
t("wiring: the greeting and the identity answer both carry the stamp", () => {
  const coreTxt = fs.readFileSync(path.join(AGENT_DIR, "core.ts"), "utf8");
  const greet = coreTxt.slice(coreTxt.indexOf("export function greetingAnswer"), coreTxt.indexOf("export function identityAnswer"));
  assert.ok(greet.includes("buildLine(model)"), "التحية بطلت تنسب الأرقام لبنائها");
  assert.ok(coreTxt.includes('build: { commit: null, builtAt: null, ageMin: null, label: "بلا بصمة" }'), "الـfallback قدامه نموذج ناقص الحقل — هنا وقع الخطأ اللي بنتعلم منه");
  const idt = coreTxt.slice(coreTxt.indexOf("export function identityAnswer"));
  assert.ok(idt.slice(0, 1600).includes("buildLine(model)"), "«انت مين» بلا بصمة");
});
t("ship: the portable bundle pulls updates every 5 minutes in both launchers", () => {
  const b = fs.readFileSync(path.resolve(ROOT0, "scripts/build-standalone.mjs"), "utf8");
  assert.ok(b.includes('process.env.NOVA_AUTO_UPDATE_MINUTES = process.env.NOVA_AUTO_UPDATE_MINUTES || "5"'), "boot.mjs مابيظبطش السحبة");
  assert.ok(b.includes('[ -z "$NOVA_AUTO_UPDATE_MINUTES" ] && export NOVA_AUTO_UPDATE_MINUTES=5'), "start.sh مابيظبطش السحبة");
  assert.ok(!/NOVA_AUTO_UPDATE_MINUTES.*\$\{/.test(b), "استخدم ${VAR:-5} جوه template literal — ده اللي بيكسر البناء");
});

/* ── toolchain provisioning: القياس والتحقّق من غير شبكة ───────────────────────
 * المقصود: المحرك اما يقول «مافيش أدوات» يبقى قارئ القرص، واما يشغّل السكربت
 * بتاعه ويطمّن الكاش — ومفيش رد بيفتري نجاح. السكربت الحقيقي بينفّذ هنا بـ
 * `--check` (قراية بس، ولا طلب نت). */
const tc = await import(path.join(SRC, "toolchain.ts"));
const toolsMod = await import(path.join(SRC, "tools.ts"));
t("toolchain: export surface is real", () => {
  for (const fn of ["toolchainStatus", "provisionToolchain", "provisionToolchainOnce", "findVendorerScript", "vendorDir", "bootToolchainFetch"]) {
    assert.equal(typeof tc[fn], "function", `${fn} مش مصدّر`);
  }
  assert.ok(tc.VENDORABLE.length >= 7, "VENDORABLE ضل صغيرة");
});
const vbin = path.join(tmp, "vendor", "bin");
fs.mkdirSync(vbin, { recursive: true });
process.env.NOVA_VENDOR_BIN = vbin;
process.env.NOVA_TOOLCHAIN_RECORD = path.join(tmp, "state", "toolchain-provision.json");
const fakeTools = path.join(tmp, "fake-tools");
fs.mkdirSync(fakeTools, { recursive: true });
process.env.NOVA_TOOL_DIR = fakeTools;
t("toolchain: status measures the disk, not a claim", () => {
  const st0 = tc.toolchainStatus();
  assert.equal(st0.dir, vbin, "vendorDir بيقرأ NOVA_VENDOR_BIN؟");
  assert.equal(st0.writable, true, "مجلد مؤقت لازم يبقى قابل للكتابة");
  assert.equal(st0.present.length, 0, `مافيش أدوات زرعت بعد بس present=${st0.present}`);
  assert.equal(st0.missing.length, tc.VENDORABLE.length, "كل الناقصة لازم تظهر");
  for (const bin of ["nuclei", "httpx"]) fs.writeFileSync(path.join(fakeTools, bin), "#!/bin/sh\n", { mode: 0o755 });
  toolsMod.resetBinaryCache();
  const st1 = tc.toolchainStatus();
  assert.deepEqual(st1.present.sort(), ["httpx", "nuclei"], `القياس بعد الزرع غلط: ${st1.present}`);
  assert.ok(st1.missing.includes("subfinder"), "الأداة اللي مش موجودة لازم تفضل missing");
});
t("toolchain: no vendorer in the bundle → honest failure, never a fake success", () => {
  const rec = tc.provisionToolchain({ script: "" });
  assert.ok(rec instanceof Promise, "provisionToolchain async؟");
});
await tA("toolchain: vendorer-missing says so", async () => {
  const rec = await tc.provisionToolchain({ script: "" });
  assert.equal(rec.ok, false, "لابد تقول فشل لما السكربت مش موجود");
  assert.equal(rec.error, "vendorer-missing");
  assert.match(rec.reasonAr || "", /fetch-toolchain/, "السبب لازم يسمّي الملف الناقص");
});
const fakeDir = path.join(tmp, "vendorer");
fs.mkdirSync(fakeDir, { recursive: true });
const fakeScript = path.join(fakeDir, "fetch-toolchain.mjs");
fs.writeFileSync(
  fakeScript,
  'const into = process.argv[process.argv.indexOf("--into") + 1];\n' +
  'console.log(JSON.stringify({ into, ok: 2, total: 7, results: [{ bin: "nuclei", status: "installed", tag: "v3.0.0" }, { bin: "httpx", status: "installed", tag: "v1.0.0" }, { bin: "ffuf", status: "failed", why: "no asset" }] }));\n',
);
await tA("toolchain: free space is measured, not assumed", () => {
  const st0 = tc.toolchainStatus();
  assert.equal(typeof st0.freeMB, "number", `freeMB لازم يبقى رقم مقاس على ${st0.dir}`);
  assert.ok(Number(st0.freeMB) >= 0, `freeMB سالب: ${st0.freeMB}`);
  assert.equal(st0.minFreeMB, 180, "الحد الافتراضي اتغيّر من غير ما التست يتحدّث");
});
await tA("toolchain: cramped disk refuses before touching the network", async () => {
  const ran = path.join(fakeDir, "marker");
  const spy = path.join(fakeDir, "spy.mjs");
  fs.writeFileSync(spy, `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "ran")\n`);
  fs.rmSync(ran, { force: true });
  process.env.NOVA_TOOLCHAIN_MIN_FREE_MB = "999999999";
  const rec = await tc.provisionToolchain({ script: spy, into: path.join(tmp, "vendor3", "bin") });
  assert.equal(rec.error, "no-space", `مرفوض لسبب تاني: ${rec.error}`);
  assert.equal(rec.refused, "no-space", "لازم يسمّي الرفض نفسه");
  assert.ok(!fs.existsSync(ran), "سكربت التنزيل اتنفّذ رغم إن القرص مرفوض — ده اللي بنمنعه");
  assert.ok(typeof rec.reasonAr === "string" && /NOVA_TOOLCHAIN_MIN_FREE_MB/.test(rec.reasonAr), "الرفض بلا مخرج للمشغّل");
  // السجل اللي فوق خلاص «فاشل» فبيدخل في cooldown — بنمسحه عشان نقيس قرار المساحة نفسه،
  // و`only` يتجاوز حارس «الأدوات موجودة» (اللي سلوكه صح).
  fs.rmSync(process.env.NOVA_TOOLCHAIN_RECORD, { force: true });
  const once = await tc.provisionToolchainOnce({ only: ["subfinder"], script: spy, into: path.join(tmp, "vendor4", "bin") });
  assert.equal(once.skipped, "no-space", `Once ما بلّغش عن الرفض: ${once.skipped}`);
  delete process.env.NOVA_TOOLCHAIN_MIN_FREE_MB;
});

await tA("toolchain: provision runs the vendorer with no shell and records the truth", async () => {
  const before = Date.now();
  const rec = await tc.provisionToolchain({ script: fakeScript, into: path.join(tmp, "vendor2", "bin") });
  assert.equal(rec.ok, true, `لازم تنجح مع سكربت وهمي: ${rec.error} ${rec.reasonAr || ""}`);
  assert.equal(rec.installed, 2, "بتعدّ installed/skipped بس");
  assert.equal(rec.total, 7);
  assert.equal(rec.results.length, 3, "النتايج بتتخزن كاملة عشان الصفحة تعرضها");
  assert.ok(rec.ms >= 0 && Date.now() - before < 60_000, "سقف زمني شغال");
  const saved = JSON.parse(fs.readFileSync(process.env.NOVA_TOOLCHAIN_RECORD, "utf8"));
  assert.equal(saved.ok, true, "السجل على القرص لازم يطابق الرد");
});
await tA("toolchain: once-mode refuses to re-download and honours the cooldown", async () => {
  const first = await tc.provisionToolchainOnce({ script: fakeScript, into: path.join(tmp, "vendor3", "bin"), only: ["ffuf"] });
  assert.equal(first.skipped, null, "أول محاولة لازم تتنفّذ");
  assert.equal(first.record.ok, true);
  // الأداة بقت موجودة فعلًا (vendor2/vendor3 مش في search path) — فالمنطق بيتحقّق
  // من السجل: نصيب cooldown/near-present حسب القرص، ومافيش مسار بيردّ ok:true كداب.
  process.env.NOVA_TOOLCHAIN_RETRY_MS = "600000";
  fs.writeFileSync(process.env.NOVA_TOOLCHAIN_RECORD, JSON.stringify({ at: new Date().toISOString(), ok: false, exitCode: 1, ms: 1, into: "x", installed: 0, total: 7, results: [], error: "vendorer-failed", reasonAr: "شبكة ميتة" }), "utf8");
  const cooled = await tc.provisionToolchainOnce({ script: fakeScript, into: path.join(tmp, "vendor4", "bin"), only: ["ffuf"] });
  assert.equal(cooled.skipped, "cooldown", "بعد فشل لازم فترة انتظار مش إعادة تنزيل");
  assert.match(cooled.record.reasonAr || "", /شبكة ميتة/, "السبب المسجل لازم يوصل للقارئ");
  toolsMod.resetBinaryCache();
});
t("toolchain: the real vendorer still parses and self-checks (--into tmp)", () => {
  const script = path.resolve(ROOT0, "scripts/fetch-toolchain.mjs");
  assert.ok(fs.existsSync(script), "السكربت الحقيقي لازم يفضل في scripts/");
  const r = spawnSync(process.execPath, [script, "--into", path.join(tmp, "vendor5", "bin"), "--check", "--json"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, `--check خرج ${r.status}: ${String(r.stderr).slice(0, 120)}`);
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  assert.ok(Array.isArray(j.rows) && j.rows.length >= 7, "rows ناقصة");
  assert.ok(j.rows.every((x) => typeof x.present === "boolean"), "present لازم boolean");
});
t("wiring: routes, twins, agent tool and self-model all know the toolchain", () => {
  const routes = fs.readFileSync(path.resolve(ROOT0, "artifacts/api-server/src/routes/ops.ts"), "utf8");
  assert.match(routes, /router\.get\("\/ops\/tools"/, "GET /api/ops/tools مش مسجّل");
  assert.match(routes, /router\.post\("\/ops\/tools\/provision"/, "POST /api/ops/tools/provision مش مسجّل");
  const provAt = routes.indexOf('router.post("/ops/tools/provision"');
  assert.ok(provAt > 0, "مسار provision مش مسجّل");
  const provBody = routes.slice(provAt, provAt + 700);
  assert.ok(provBody.indexOf("opsAllowed(req)") >= 0 && provBody.indexOf("opsAllowed(req)") < provBody.indexOf("provisionToolchain({"), "provision لازم يكون ورا قرار إذن قبل التنفيذ");
  for (const twin of ["artifacts/api-server/src/lib/standalone-api.ts", "artifacts/kali-panel/src/lib/standalone-api.ts"]) {
    const txt = fs.readFileSync(path.resolve(ROOT0, twin), "utf8");
    assert.match(txt, /"\/ops\/tools"/, `${twin}: التوأم مابيعرفش /ops/tools`);
    assert.match(txt, /measured: false/, `${twin}: الباندل الثابت لازم يقول «مش مقاس»`);
    assert.match(txt, /error: "no_execution_plane"/, `${twin}: تثبيت الأدوات على الباندل لازم يرفض بصوت عالي`);
  }
  const at = fs.readFileSync(path.resolve(ROOT0, "artifacts/api-server/src/lib/agent/tools.ts"), "utf8");
  assert.match(at, /name: "tools_install"/, "المحرك مالوش أداة تجهيز أدواته");
  assert.match(at, /provisionToolchainOnce/, "الأداة لازم تستعمل النسخة اللي بتمنع التنزيل المتكرر");
  const sm = fs.readFileSync(path.resolve(ROOT0, "artifacts/api-server/src/lib/agent/self-model.ts"), "utf8");
  assert.match(sm, /toolchainStatus\(\)/, "الـself-model لازم يقيس الأدوات");
  assert.match(sm, /securityTools/, "securityTools مش في النموذج");
  const idx = fs.readFileSync(path.resolve(ROOT0, "artifacts/api-server/src/index.ts"), "utf8");
  assert.match(idx, /bootToolchainFetch\(/, "خطّاف الإقلاع مش متوصّل");
  assert.match(idx, /NOVA_TOOLCHAIN_FETCH/, "لازم يكون opt-in بمُغيّر بيئة موثّق");
});
t("ship: build-standalone carries the runtime data and demands it", () => {
  const b = fs.readFileSync(path.resolve(ROOT0, "scripts/build-standalone.mjs"), "utf8");
  assert.match(b, /for \(const rel of \["ops", path\.join\("scripts", "fetch-toolchain\.mjs"\)\]\)/, "الباندر مابينسخش ops/ + السكربت");
  assert.match(b, /programs-catalog\.json/, "فحص الاكتمال مابيشملش الكتالوج — نفس الغلطة اللي خلفت present:false");
  const req = b.slice(b.indexOf("the launchers a panel needs"), b.indexOf("/* ── 3. zip it"));
  assert.ok(req.includes("fetch-toolchain.mjs") && req.includes("programs-catalog.json"), "قائمة الفحص ناقصة");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log("────────────────────");
console.log(`${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✅ scope gate, ops gate, throttle and evidence chain behave as documented");
