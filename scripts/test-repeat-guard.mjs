#!/usr/bin/env node
/**
 * The repeat guard exists because of one measured transcript (2026-11-05):
 * the same red pair — fleet_list then fleet_profile — came back turn after
 * turn, both failing for the single reason "no agent is connected". A loop
 * that repeats a call which cannot succeed reads as work but is not.
 *
 * Five promises, all checked here without touching the network:
 *   1. the same call in one turn is deduped;
 *   2. a step that needs an agent is skipped when fleet_list just failed;
 *   3. a call that failed moments ago is not re-run on its own;
 *   4. "جرب تاني" overrides promise 3 — a human retry always runs;
 *   5. the skip reasons are prose the user can read, with no regex source.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";
const SRC = join(ROOT, "artifacts/api-server/src/lib/agent/core.ts");
const work = mkdtempSync(join(tmpdir(), "nova-guard-"));
const out = join(work, "bundle.mjs");
// esbuild is resolved by ./lib/esbuild-runner.mjs: Node API first, CLI second.
const shim = 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);';
bundleCli(ROOT, [SRC, "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--banner:js=${shim}`, `--outfile=${out}`]);

process.env.NOVA_SERVERS_FILE = join(work, "servers.json");
process.env.NOVA_STATE_DIR = join(work, "state");
process.env.NOVA_MEMORY_FILE = join(work, "state/nova-memory.json");

const {
  stepSignature,
  recordAttempt,
  findRecentFailure,
  resetAttempts,
  shouldSkipStep,
  wantsRetry,
  heuristicPlan,
  REPEAT_WINDOW_MS,
} = await import(out);

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
};

console.log("repeat guard — a failing call must not loop");

test("signature ignores argument order but not values", () => {
  assert.equal(stepSignature("fleet_list", {}), "fleet_list()");
  assert.equal(stepSignature("x", { a: 1, b: 2 }), stepSignature("x", { b: 2, a: 1 }));
  assert.notEqual(stepSignature("x", { a: 1 }), stepSignature("x", { a: 2 }));
  assert.notEqual(stepSignature("x", {}), stepSignature("y", {}));
});

test("the same call twice in one turn is deduped", () => {
  resetAttempts("s1");
  const seen = new Set([stepSignature("fleet_list", {})]);
  const d = shouldSkipStep({ sessionId: "s1", tool: "fleet_list", args: {}, seenThisTurn: seen });
  assert.ok(d, "expected a skip decision");
  assert.match(d.reason, /مرتين/);
});

test("a profile without an agent is skipped with the list's real reason", () => {
  resetAttempts("s2");
  const failed = new Map([["fleet_list", "مفيش أي جهاز متصل حالياً"]]);
  const d = shouldSkipStep({
    sessionId: "s2",
    tool: "fleet_profile",
    args: {},
    title: "بصمة جهاز",
    failedThisTurn: failed,
  });
  assert.ok(d);
  assert.match(d.reason, /مفيش أي جهاز متصل حالياً/, "the reason must be quoted, not summarised away");
  assert.match(d.reason, /بصمة جهاز/, "the human-readable title must be used");
});

test("a call that failed a minute ago is not silently re-run", () => {
  resetAttempts("s3");
  recordAttempt("s3", "fleet_list", {}, false, "مفيش أي جهاز متصل حالياً");
  const prev = findRecentFailure("s3", "fleet_list", {});
  assert.ok(prev, "the failure should still be inside the window");
  const d = shouldSkipStep({ sessionId: "s3", tool: "fleet_list", args: {} });
  assert.ok(d);
  assert.match(d.thought, /جرب تاني/, "the thought must tell the user how to override it");

  // Outside the window the same call is allowed again.
  const later = Date.now() + REPEAT_WINDOW_MS + 1000;
  assert.equal(shouldSkipStep({ sessionId: "s3", tool: "fleet_list", args: {}, now: later }), null);
});

test("«جرب تاني» always runs, and an explicit retry is detected", () => {
  resetAttempts("s4");
  recordAttempt("s4", "fleet_list", {}, false, "مفيش أي جهاز متصل");
  assert.equal(wantsRetry("جرب تاني"), true);
  assert.equal(wantsRetry("try again please"), true);
  assert.equal(wantsRetry("اعرض قائمة الأجهزة"), false);
  const d = shouldSkipStep({ sessionId: "s4", tool: "fleet_list", args: {}, retrying: true });
  assert.equal(d, null, "a human retry must not be blocked");

  // A success clears the failure for that call.
  recordAttempt("s4", "fleet_list", {}, true, "2 جهاز متصل");
  assert.equal(findRecentFailure("s4", "fleet_list", {}), undefined);
});

test("skip text is prose — no regex source, no raw signature", () => {
  resetAttempts("s5");
  recordAttempt("s5", "fleet_list", {}, false, "مفيش أي جهاز متصل");
  const d = shouldSkipStep({ sessionId: "s5", tool: "fleet_list", args: {}, title: "قائمة الأجهزة" });
  assert.ok(d);
  for (const text of [d.reason, d.thought]) {
    assert.doesNotMatch(text, /\(\?:|\\s|\|/, `leaked regex/source: ${text}`);
    assert.doesNotMatch(text, /fleet_list\(\)/, "the raw signature must not be shown");
  }
});

test("planning with no connected agent asks for one step, not two", () => {
  const plan = heuristicPlan("كم جهاز عندي في الأسطول؟");
  const names = plan.steps.map((s) => s.tool);
  assert.ok(names.includes("fleet_list"), `expected fleet_list, got ${names.join(",")}`);
  assert.ok(
    !names.includes("fleet_profile") && !names.includes("fleet_exec"),
    `no agent is connected, so nothing may depend on one: ${names.join(",")}`,
  );
});

console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length) {
  for (const f of failures) console.error(f.err?.stack ?? f.err);
  process.exit(1);
}
