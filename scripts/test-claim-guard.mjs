#!/usr/bin/env node
/**
 * The claim guard is the last line between the model and the human: it is what
 * stops NOVA from quoting a number it never measured.
 *
 * Measured 2026-11-06 on the live slot: the reply said «**3** ماكينة مسجّلة في
 * الأسطول» while `GET /api/fleet/mesh` said `machines.connected: 1`. The guard
 * did NOT fire — the model bolds its numbers, and the `**` sitting between `3`
 * and `ماكينة` broke the `\d+\s*unit` match. A guard that a formatting habit can
 * switch off is not a guard.
 *
 * These tests pin both halves of the contract:
 *   • an over-claim is caught, with or without markdown emphasis;
 *   • a truthful number is left byte-identical (the guard must never add noise
 *     to a correct answer).
 *
 *   node scripts/test-claim-guard.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";

const SRC = join(ROOT, "artifacts/api-server/src/lib/agent/claim-guard.ts");
const work = mkdtempSync(join(tmpdir(), "nova-claimguard-"));
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

const { auditClaims, enforceClaims } = await import(`file://${out}`);

/** A fixed measurement, so the test never depends on the machine it runs on. */
const MODEL = {
  machines: { connected: 1, connectedNames: ["self-node"] },
  tools: { count: 65 },
  corpus: { measured: true, total: 128526, ageMin: 5 },
  patterns: { total: 3354 },
  memory: { total: 0 },
};

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

// ── over-claims must be caught ────────────────────────────────────────────────
check("bold number + unit is caught (the live-slot regression)", () => {
  const v = auditClaims("معايا **3** ماكينة مسجّلة في الأسطول", MODEL);
  assert.equal(v.length, 1, "expected exactly one violation");
  assert.equal(v[0].kind, "fleet");
  assert.equal(v[0].claimed, 3);
  assert.equal(v[0].actual, 1);
});

check("plain number + unit is caught", () => {
  const v = auditClaims("معايا 3 ماكينة مسجّلة في الأسطول", MODEL);
  assert.equal(v.length, 1);
  assert.equal(v[0].claimed, 3);
});

check("Arabic-Indic digits are read as numbers", () => {
  const v = auditClaims("معايا ٣ ماكينات", MODEL);
  assert.equal(v.length, 1);
  assert.equal(v[0].claimed, 3);
});

check("over-claimed tool count is caught", () => {
  const v = auditClaims("عندي 70 أداة", MODEL);
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, "tools");
  assert.equal(v[0].claimed, 70);
});

check("the invented 168,682 corpus figure is caught", () => {
  const v = auditClaims("الفهرس فيه 168,682 ثغرة", MODEL);
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, "corpus");
  assert.equal(v[0].claimed, 168682);
});

// ── truthful numbers must pass through untouched ──────────────────────────────
check("a truthful fleet number is not flagged", () => {
  assert.deepEqual(auditClaims("معايا 1 ماكينة", MODEL), []);
});

check("a truthful tool count is not flagged", () => {
  assert.deepEqual(auditClaims("عندي 65 أداة", MODEL), []);
});

check("a truthful corpus figure is not flagged", () => {
  assert.deepEqual(auditClaims("الفهرس فيه 128,526 ثغرة", MODEL), []);
});

check("a correct reply is returned byte-identical", () => {
  const text = "أنا نوفا. عندي 65 أداة و1 ماكينة.";
  const out = enforceClaims(text, MODEL);
  assert.equal(out.text, text, "the guard must not touch a correct answer");
  assert.deepEqual(out.violations, []);
});

// ── the correction is additive and measured ───────────────────────────────────
check("a correction is appended, never a rewrite", () => {
  const text = "معايا **3** ماكينة";
  const out = enforceClaims(text, MODEL);
  assert.ok(out.text.startsWith(text), "the original reply must survive intact");
  assert.ok(out.text.includes("تصحيح مقاس"), "a measured correction block is appended");
  assert.ok(out.text.includes("1 جهاز"), "the correction quotes the measured number");
});

if (process.exitCode) {
  console.error(`\nclaim-guard: FAILED`);
  process.exit(1);
}
console.log(`✓ claim-guard: ${passed} checks — over-claims caught, truth untouched`);
