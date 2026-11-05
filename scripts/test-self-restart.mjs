#!/usr/bin/env node
/**
 * Offline checks for self-restart — the loop that makes a shipped release the
 * release that is actually running.
 *
 * Why these exist: on 2026-11-05 the live slot installed three releases while
 * the process kept answering with code from 01:26. Every status field was green
 * because every field described the *disk*. These tests pin the difference
 * between the disk and the running process, and pin the refusal paths so a
 * reload loop can never be shipped by accident.
 *
 *   node scripts/test-self-restart.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";
const SRC = join(ROOT, "artifacts/api-server/src/lib/self-restart.ts");
const work = mkdtempSync(join(tmpdir(), "nova-self-restart-"));
const out = join(work, "bundle.mjs");

// esbuild is resolved by ./lib/esbuild-runner.mjs: Node API first, CLI second.
bundleCli(ROOT, [SRC, "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--outfile=${out}`]);

// The bundle dir the module will inspect: a build.json + state/ next to it.
const bundleDir = join(work, "bundle");
mkdirSync(join(bundleDir, "state"), { recursive: true });
writeFileSync(
  join(bundleDir, "build.json"),
  JSON.stringify({ name: "nova-24-7", commit: "aaaaaaaabbbbbbbb", builtAt: "2026-11-05T01:26:03.000Z" }),
);
process.chdir(bundleDir);
process.env.NOVA_STATIC_DIR = join(bundleDir, "public");
delete process.env.NOVA_STATE_DIR;
delete process.env.NOVA_MEMORY_FILE;
delete process.env.NOVA_ENTRY;
delete process.env.NOVA_RESPAWN_COUNT;

const mod = await import(out);

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

test("bootBuild() reads build.json from the bundle dir", () => {
  const boot = mod.bootBuild();
  assert.equal(boot.builtAt, "2026-11-05T01:26:03.000Z");
  assert.equal(boot.dir, bundleDir);
});

test("bootBuild() is a snapshot — a later build.json does not change it", () => {
  writeFileSync(
    join(bundleDir, "build.json"),
    JSON.stringify({ name: "nova-24-7", commit: "ccccccccdddddddd", builtAt: "2026-11-05T02:34:39.000Z" }),
  );
  assert.equal(mod.bootBuild().builtAt, "2026-11-05T01:26:03.000Z", "boot must stay frozen at import");
  assert.equal(mod.diskBuild().builtAt, "2026-11-05T02:34:39.000Z", "disk must be re-read");
});

test("buildDrift() reports stale when the disk moved and the process did not", () => {
  const drift = mod.buildDrift();
  assert.equal(drift.stale, true);
  assert.equal(drift.boot.builtAt, "2026-11-05T01:26:03.000Z");
  assert.equal(drift.disk.builtAt, "2026-11-05T02:34:39.000Z");
  assert.ok(Date.parse(drift.startedAt) > 0);
});

test("buildDrift() is not stale when disk and process agree", () => {
  const back = mkdtempSync(join(tmpdir(), "nova-same-"));
  writeFileSync(join(back, "build.json"), JSON.stringify({ commit: "x", builtAt: "2026-11-05T02:34:39.000Z" }));
  // diskBuild() looks at cwd first, so emulate the agreement by restoring the
  // boot value on the same path the module already knows.
  writeFileSync(
    join(bundleDir, "build.json"),
    JSON.stringify({ name: "nova-24-7", commit: "aaaaaaaabbbbbbbb", builtAt: "2026-11-05T01:26:03.000Z" }),
  );
  assert.equal(mod.buildDrift().stale, false);
});

test("restartMarkerPaths() points at boot.mjs's watch file", () => {
  const paths = mod.restartMarkerPaths();
  assert.ok(paths.includes(join(bundleDir, "state", ".nova-restart")), paths.join(" | "));
});

test("writeRestartMarker() actually writes a file the supervisor can stat", () => {
  const written = mod.writeRestartMarker();
  assert.ok(written.length >= 1);
  const marker = join(bundleDir, "state", ".nova-restart");
  assert.ok(written.includes(marker), written.join(" | "));
  const body = readFileSync(marker, "utf8");
  assert.match(body, /pid=\d+/);
});

test("writeRestartMarker() changes mtime on every call", () => {
  const marker = join(bundleDir, "state", ".nova-restart");
  const before = readFileSync(marker, "utf8");
  mod.writeRestartMarker();
  assert.notEqual(readFileSync(marker, "utf8"), before, "content must differ so mtime changes");
});

test("requestReload() reports reloaded:false when nothing restarts us", async () => {
  let seen = null;
  mod.requestReload({ verifyMs: 10, then: (info) => (seen = info) });
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(seen, "callback must run when the process is still alive");
  assert.equal(seen.reloaded, false);
});

test("canSelfRespawn() refuses while the process is young", () => {
  const check = mod.canSelfRespawn();
  assert.equal(check.ok, false);
  assert.match(check.reason, /ثانية/);
});

test("canSelfRespawn() refuses after three attempts", () => {
  const savedUptime = process.uptime;
  process.uptime = () => 600;
  process.env.NOVA_RESPAWN_COUNT = "3";
  try {
    const check = mod.canSelfRespawn();
    assert.equal(check.ok, false);
    assert.match(check.reason, /3/);
  } finally {
    process.uptime = savedUptime;
    delete process.env.NOVA_RESPAWN_COUNT;
  }
});

test("canSelfRespawn() refuses when no entry file exists", () => {
  const savedUptime = process.uptime;
  process.uptime = () => 600;
  process.argv[1] = join(work, "does-not-exist.mjs");
  try {
    const check = mod.canSelfRespawn();
    assert.equal(check.ok, false);
    assert.match(check.reason, /nova-app\.mjs/);
  } finally {
    process.uptime = savedUptime;
  }
});

test("selfRespawn() refuses instead of spawning when the guard says no", () => {
  const res = mod.selfRespawn();
  assert.equal(res.ok, false);
  assert.ok(res.reason.length > 0);
});

test("restartHistory() records what was attempted", () => {
  const history = mod.restartHistory();
  assert.ok(history.length >= 1);
  assert.ok(history.every((h) => typeof h.at === "string" && typeof h.what === "string"));
});

console.log(`\nself-restart: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n✗ ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
