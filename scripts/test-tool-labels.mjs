#!/usr/bin/env node
/**
 * Every tool the agent can run must have a name a human can read.
 * ──────────────────────────────────────────────────────────────────────────
 * The plan line and the tool bubbles now print «بحث في النت (web_search)»
 * instead of `web_search`. That only works while the label map keeps up with
 * the registry — and the map lives in the panel, the registry in the API, so
 * nothing forces them to agree. This gate does.
 *
 * Measured history: the self-model claimed 33 tools when the registry said 47,
 * because a number was typed once and never derived. Same class of drift.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { bundleCli } from "./lib/esbuild-runner.mjs";

process.env.NODE_ENV = "production";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "nova-labels-"));
const shim = 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);';

const toolsBundle = join(work, "tools.mjs");
bundleCli(ROOT, [
  join(ROOT, "artifacts/api-server/src/lib/agent/tools.ts"),
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--log-level=error",
  `--banner:js=${shim}`,
  `--outfile=${toolsBundle}`,
]);

const labelsBundle = join(work, "labels.mjs");
bundleCli(ROOT, [
  join(ROOT, "artifacts/kali-panel/src/lib/local-brain.ts"),
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--log-level=error",
  `--outfile=${labelsBundle}`,
]);

process.env.NOVA_STATE_DIR = join(work, "state");
const { AGENT_TOOLS } = await import(toolsBundle);
const { TOOL_TITLES_AR, toolTitleAr, toolLabelAr } = await import(labelsBundle);

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗   ${name}\n       ${err.message}`);
  }
};

const names = AGENT_TOOLS.map((t) => t.name).sort();
console.log(`tool labels — ${names.length} registered tools`);

test("the registry is not empty and has no duplicates", () => {
  assert.ok(names.length > 30, `only ${names.length} tools — the bundle probably failed`);
  assert.equal(new Set(names).size, names.length);
});

test("every registered tool has an Arabic label", () => {
  const missing = names.filter((n) => !TOOL_TITLES_AR[n]);
  assert.deepEqual(missing, [], `no label for: ${missing.join(", ")}`);
});

test("labels are Arabic, not the identifier repeated", () => {
  for (const name of names) {
    const label = TOOL_TITLES_AR[name];
    assert.match(label, /[\u0600-\u06FF]/, `${name} → «${label}» is not Arabic`);
    assert.notEqual(label, name, `${name} → label equals the tool name`);
  }
});

test("the rendered label keeps both the meaning and the mechanism", () => {
  const rendered = toolLabelAr("web_search");
  assert.match(rendered, /بحث/);
  assert.match(rendered, /web_search/, "the identifier must stay visible");
  // An unknown tool degrades to its own name rather than to a lie.
  assert.equal(toolTitleAr("not_a_tool"), "not_a_tool");
  assert.equal(toolLabelAr("not_a_tool"), "not_a_tool");
});

test("no label collides with another tool's label", () => {
  const seen = new Map();
  for (const name of names) {
    const label = TOOL_TITLES_AR[name];
    if (seen.has(label)) {
      assert.fail(`«${label}» is used by both ${seen.get(label)} and ${name}`);
    }
    seen.set(label, name);
  }
});

console.log(`\ntool-labels: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
