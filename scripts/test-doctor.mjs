#!/usr/bin/env node
/**
 * Offline checks for the doctor — the one request that says what is broken.
 *
 * The rule these pin: a check that cannot measure must say so (`warn`), never
 * report `ok`. A doctor that paints green on an unmeasured subsystem is worse
 * than no doctor, because it converts "unknown" into "fine".
 *
 *   node scripts/test-doctor.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "artifacts/api-server/src/lib/doctor.ts");
const work = mkdtempSync(join(tmpdir(), "nova-doctor-"));
// Built inside the repo (not /tmp) with packages external: the module graph pulls
// `pg` through the corpus/settings layers, and a bundle in /tmp cannot resolve it.
const out = join(work, "doctor.mjs");

const esbuild = join(ROOT, "node_modules/.pnpm/node_modules/.bin/esbuild");
assert.ok(existsSync(esbuild), "esbuild binary not found — run pnpm install first");
// Fully bundled (the graph reaches Postgres/logger layers), with a `require`
// shim so the CJS dependencies inside it load from an ESM bundle.
const shim = 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);';
execFileSync(esbuild, [
  SRC,
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--log-level=error",
  `--banner:js=${shim}`,
  `--outfile=${out}`,
]);

// The logger picks a pretty transport in dev; in a bare node process there is
// no transport module to load. Production behaviour is the JSON one.
process.env.NODE_ENV = "production";
const state = join(work, "state");
mkdirSync(state, { recursive: true });
process.env.NOVA_MEMORY_FILE = join(state, "nova-memory.json");
process.env.NOVA_SERVERS_FILE = join(work, "servers.json");
process.env.NOVA_CORPUS_FILE = join(work, "corpus.json");
process.env.NOVA_STATE_DIR = state;

const mod = await import(out);

let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const report = await mod.runDoctor();
const byId = (id) => report.checks.find((c) => c.id === id);

await test("every check has the required fields", () => {
  assert.ok(report.checks.length >= 6);
  for (const c of report.checks) {
    assert.ok(c.id && c.label && c.value, `missing identity on ${c.id}`);
    assert.ok(["ok", "warn", "fail"].includes(c.state), `bad state on ${c.id}`);
    assert.ok(typeof c.says_ar === "string" && c.says_ar.length > 10, `no sentence on ${c.id}`);
  }
});

await test("every fail carries an exact fix, never a generic advice line", () => {
  const fails = report.checks.filter((c) => c.state === "fail");
  for (const c of fails) {
    assert.ok(c.fix_ar && c.fix_ar.length > 5, `${c.id} failed without a fix`);
  }
});

await test("counts and score are arithmetic, not decoration", () => {
  const ok = report.checks.filter((c) => c.state === "ok").length;
  const warn = report.checks.filter((c) => c.state === "warn").length;
  const fail = report.checks.filter((c) => c.state === "fail").length;
  assert.equal(report.counts.ok, ok);
  assert.equal(report.counts.warn, warn);
  assert.equal(report.counts.fail, fail);
  assert.equal(report.counts.total, report.checks.length);
  assert.equal(report.score, Math.round((ok / report.checks.length) * 100));
  assert.equal(report.ready, fail === 0);
});

await test("a missing build.json is a warning, never a green build", () => {
  const c = byId("build");
  assert.ok(c);
  assert.notEqual(c.state, "ok");
  assert.match(c.says_ar, /build\.json/);
});

await test("an empty memory file is called out as empty, not as healthy", () => {
  writeFileSync(process.env.NOVA_MEMORY_FILE, "");
  return mod.runDoctor().then((r) => {
    const c = r.checks.find((x) => x.id === "memory");
    assert.equal(c.state, "warn");
    assert.match(c.value, /0 bytes/);
  });
});

await test("a non-empty memory file becomes ok", async () => {
  writeFileSync(process.env.NOVA_MEMORY_FILE, JSON.stringify([{ text: "ذكرى" }]));
  const r = await mod.runDoctor();
  assert.equal(r.checks.find((x) => x.id === "memory").state, "ok");
});

await test("no machines registered is a fail with a POST command in the fix", async () => {
  const r = await mod.runDoctor();
  const c = r.checks.find((x) => x.id === "machines");
  assert.equal(c.state, "fail");
  assert.match(c.fix_ar, /\/api\/fleet\/servers/);
});

await test("the summary sentence follows the worst state", async () => {
  const r = await mod.runDoctor();
  if (r.ready) {
    assert.match(r.says_ar, /سليمة|تنبيه/);
  } else {
    const firstFail = r.checks.find((c) => c.state === "fail");
    assert.ok(r.says_ar.includes(firstFail.label), `summary should name ${firstFail.label}`);
  }
});

await test("the report is serialisable (the panel destructures it as JSON)", () => {
  const json = JSON.stringify(report);
  assert.ok(json.length > 200);
  const back = JSON.parse(json);
  assert.equal(back.score, report.score);
});

console.log(`\ndoctor: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n✗ ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
