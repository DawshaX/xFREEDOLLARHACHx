#!/usr/bin/env node
/**
 * A model's thinking is not its answer.
 *
 * Measured 2026-11-06 on the live slot, the reply to «انت عامل ايه» opened with:
 *   «اج أدوات. هرد عليه بالعربي المصري وأقولو إني جاهز لأي مهمة. أنا تمام يا حمو…»
 * The first sentence is the model narrating its plan. It appears BEFORE the real
 * answer, so it is the first thing the human reads — and it makes a working
 * agent look broken.
 *
 * These tests pin both halves: the leak is removed, and a real answer is left
 * byte-identical (the sanitiser must never eat content).
 *
 *   node scripts/test-sanitize-reply.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";

const SRC = join(ROOT, "artifacts/api-server/src/lib/agent/sanitize-reply.ts");
const work = mkdtempSync(join(tmpdir(), "nova-sanitize-"));
const out = join(work, "bundle.mjs");

const shim = 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);';
bundleCli(ROOT, [
  SRC,
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--log-level=error",
  `--banner:js=${shim}`,
  `--outfile=${out}`,
]);

const { sanitizeReply } = await import(`file://${out}`);

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
};

// ── the live-slot regression ─────────────────────────────────────────────────
check("the observed plan preamble is stripped", () => {
  const raw = "هرد عليه بالعربي المصري وأقولو إني جاهز لأي مهمة. أنا تمام يا حمو، كل الأنظمة على ما يرام.";
  const { text, removed } = sanitizeReply(raw);
  assert.ok(removed.includes("plan-preamble"), "the preamble must be identified");
  assert.ok(!text.includes("هرد عليه"), "the plan sentence must be gone");
  assert.ok(text.startsWith("أنا تمام"), "the real answer must survive");
});

check("a fenced reasoning block is stripped", () => {
  const raw = "<thought>the user wants a status report</thought>كل الأنظمة شغّالة.";
  const { text, removed } = sanitizeReply(raw);
  assert.ok(removed.includes("fenced-reasoning"));
  assert.equal(text, "كل الأنظمة شغّالة.");
});

check("a duplicated paragraph is collapsed", () => {
  const raw = "الأسطول متصل.\n\nالأسطول متصل.";
  const { text, removed } = sanitizeReply(raw);
  assert.ok(removed.includes("duplicate-paragraph"));
  assert.equal(text, "الأسطول متصل.");
});

// ── a real answer must pass through untouched ────────────────────────────────
check("a clean answer is returned byte-identical", () => {
  const raw = "أنا نوفا. الأسطول فيه جهاز واحد متصل، وعندي 65 أداة.";
  const { text, removed } = sanitizeReply(raw);
  assert.equal(text, raw);
  assert.deepEqual(removed, []);
});

check("the word «هقول» mid-answer is not treated as a preamble", () => {
  const raw = "لو حبيت هقولك على التفاصيل: الأسطول متصل بجهاز واحد.";
  const { text } = sanitizeReply(raw);
  assert.equal(text, raw, "only a LEADING preamble may be stripped");
});

check("an empty reply is never produced", () => {
  const raw = "هرد عليه بالعربي.";
  const { text } = sanitizeReply(raw);
  assert.ok(text.trim().length > 0, "stripping must never empty the reply");
});

if (process.exitCode) {
  console.error("\nsanitize-reply: FAILED");
  process.exit(1);
}
console.log(`✓ sanitize-reply: ${passed} checks — leaks stripped, real answers untouched`);
