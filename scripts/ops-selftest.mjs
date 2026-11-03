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
import { registerHooks } from "node:module";

/**
 * The repo bundles with esbuild and uses extensionless relative imports
 * (`from "../logger"`), which plain Node ESM cannot resolve. This hook teaches
 * Node to try `.ts` first, so the self-test can import the REAL source files
 * instead of a duplicated copy of the logic.
 */
let hookReady = false;
try {
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


const needsFlag = !process.execArgv.some((a) => a.includes("experimental-strip-types"));
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
  // لسه شغال — وده أخطر من أي رقم غلط، لأنه أخضر وكذاب. والقواعد متاقرأش من脑子، بل من الملفات.
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
    assert.ok(/catalog: \{ present: cat\.present/.test(srcTxt), "حالة الكتالوج مش بتتسجل — «مفيش برنامج» هتتب读رها غلط".replace("读","قرا"));
    assert.ok(!/passive_only:[^\n]*(bounty|catalog)/i.test(srcTxt), "الكتالوج بيرجّع passive_only — ممنوع");
    // داخل discoverProgram نفسه (مش أي سطر تاني في الملف): الوضع السلبي = ¬الإذن بالحرف
    const di = srcTxt.indexOf("export async function discoverProgram");
    assert.ok(di > 0, "مفيش discoverProgram");
    const dn = srcTxt.indexOf("\nexport ", di + 10);
    const disc = srcTxt.slice(di, dn > 0 ? dn : undefined);
    assert.ok(/passive_only: !consentOk,/.test(disc), "discoverProgram مابقاش بيحدد passive_only من الإذن المكتوب");
    assert.ok(!/Boolean\(input/.test(disc), "discoverProgram بقى بيقبل passive_only من المُدخل — مصدر واحد للحقيقة اتكسر");
    assert.ok(/consentOk = [^\n]*i have written permission for/.test(disc), "جملة الإذن اتغيّرت — لازم النص بالحرف");
    assert.ok(srcTxt.includes("program_discover") && /activate = "I have written permission for/.test(srcTxt), "رسالة بوابة التفعيل ات失ت".replace("失","فقدها"));
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log("────────────────────");
console.log(`${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✅ scope gate, ops gate, throttle and evidence chain behave as documented");
