#!/usr/bin/env node
/**
 * The deterministic planner is what answers when every model is down — and it is
 * also what produces the "thinking" line the user reads. Two properties matter:
 *
 *   1. the thought must be Arabic prose, never a regex source or a tool name;
 *   2. a "look it up" request must reach a search tool, not come back as a
 *      counter-question.
 *
 * Both were measured broken on 2026-11-05 in a live transcript.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "artifacts/api-server/src/lib/agent/core.ts");
const work = mkdtempSync(join(tmpdir(), "nova-plan-"));
const out = join(work, "bundle.mjs");
const esbuild = join(ROOT, "node_modules/.pnpm/node_modules/.bin/esbuild");
assert.ok(existsSync(esbuild), "esbuild binary not found — run pnpm install first");
const shim = 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);';
execFileSync(esbuild, [SRC, "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--banner:js=${shim}`, `--outfile=${out}`]);

process.env.NOVA_SERVERS_FILE = join(work, "servers.json");
process.env.NOVA_STATE_DIR = join(work, "state");
process.env.NOVA_MEMORY_FILE = join(work, "state/nova-memory.json");

const { heuristicPlan, cleanThought } = await import(out);

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

test("the thought never leaks a regex", () => {
  for (const q of [
    "ابحث عن ادوات مجانية",
    "استطلع google.com",
    "منافذ السيرفر",
    "CVE-2024-3094",
    "السلام عليكم",
    "انت مين",
  ]) {
    const plan = heuristicPlan(q);
    assert.ok(!plan.thought.includes("(?:"), `regex leaked for «${q}»: ${plan.thought}`);
    assert.ok(!plan.thought.includes("[مسار:"), `the old marker leaked for «${q}»`);
    assert.ok(plan.thought.length > 5, `empty thought for «${q}»`);
  }
});

test("«ابحث عن …» plans a real search, never a clarification", () => {
  const plan = heuristicPlan("ابحث عن ادوات مجانية لتشغيل وكيل على سيرفر");
  assert.ok(plan.steps.some((s) => s.tool === "web_search"), JSON.stringify(plan.steps));
});

test("«دوّر على …» also reaches the search tool", () => {
  const plan = heuristicPlan("دوّر على بدائل مجانية لـ Ollama");
  assert.ok(plan.steps.some((s) => s.tool === "web_search"), JSON.stringify(plan.steps));
});

test("a bare domain still goes to recon, not to search", () => {
  // Not example.com: `extractTarget` deliberately ignores reserved test names,
  // so using it here would test the wrong thing.
  const plan = heuristicPlan("google.com");
  assert.ok(plan.steps.some((s) => s.tool === "recon_target"), JSON.stringify(plan.steps));
  assert.ok(!plan.steps.some((s) => s.tool === "web_search"));
});

test("the thought bubble can never show model residue", () => {
  const fallback = "هرتّب الطلب على أدواتي الحقيقية وأشوف النتيجة قبل أي استنتاج.";
  // The exact shape that reached the screen on 2026-11-05.
  assert.equal(cleanThought("[مسار: (?:أدوات|ادوات|kali|أداة|tool)] على الطلب"), fallback);
  // A planner that answers in JSON or English is not speaking to the user.
  assert.equal(cleanThought('{"tool": "fleet_list", "args": {}}'), fallback);
  assert.equal(cleanThought("Let me plan this step by step."), fallback);
  assert.equal(cleanThought(""), fallback);
  // Real Arabic survives — one line, no fences.
  assert.equal(
    cleanThought("هبدأ باستطلاع النطاق\nوبعدها هقرا الترويسات"),
    "هبدأ باستطلاع النطاق وبعدها هقرا الترويسات",
  );
  assert.ok(cleanThought("أ".repeat(400)).length <= 221, "long thoughts are capped");
});

test("every planned step is a real registered tool", () => {
  const { AGENT_TOOLS } = globalThis.__tools ?? {};
  for (const q of ["ابحث عن ثغرات nginx", "استطلع google.com", "الوضع عامل ايه"]) {
    const plan = heuristicPlan(q);
    assert.ok(plan.steps.length >= 1, q);
    for (const s of plan.steps) assert.equal(typeof s.tool, "string");
  }
});

console.log(`\nheuristic-plan: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n✗ ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
