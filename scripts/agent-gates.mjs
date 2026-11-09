#!/usr/bin/env node
/**
 * Run every gate the repo claims to have — one list, one entry point.
 * ────────────────────────────────────────────────────────────────────────
 * The `.github/workflows/agent-gates.yml` job used to hold its own copy of this
 * list. Two copies of a list drift, and a drifted list is worse than no list:
 * it reports green on a set of tests that is not the set anybody runs locally.
 *
 * So the list lives here and the workflow calls it. Locally:
 *
 *     node scripts/agent-gates.mjs            # everything
 *     node scripts/agent-gates.mjs --fast     # skip the slow structural audits
 *
 * Each gate is a separate process on purpose: a test that leaves state behind,
 * or crashes the module loader, must not take the rest of the run with it.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fast = process.argv.includes("--fast");

/** Tests that assert agent behaviour. Each one exists because of a real bug. */
const AGENT_GATES = [
  ["scripts/test-self-model.mjs", "self-model: numbers come from the registry"],
  ["scripts/test-claim-guard.mjs", "claim guard: an over-claim is caught, truth untouched"],
  ["scripts/test-sanitize-reply.mjs", "sanitizer: leaked reasoning stripped, real answers untouched"],
  ["scripts/test-memory-persistence.mjs", "memory: survives a restart, read back by a fresh process"],
  ["scripts/test-web-search.mjs", "web-search: keyless search, reasons on failure"],
  ["scripts/test-heuristic-plan.mjs", "planner: real tools, prose thoughts, no regex"],
  ["scripts/test-repeat-guard.mjs", "repeat guard: a failing step does not loop"],
  ["scripts/test-tool-labels.mjs", "labels: every tool has a readable Arabic name"],
  ["scripts/test-fleet-servers.mjs", "fleet: server registry and codespace bases"],
  ["scripts/test-nova-brain.mjs", "brain: the 15-minute loop"],
  ["scripts/test-nova-brain-edge.mjs", "brain edge: the serverless function"],
  ["scripts/test-vuln-corpus.mjs", "corpus: real NVD/KEV/EPSS reads"],
  ["scripts/test-memory-mirror.mjs", "memory: local + Supabase mirror"],
  ["scripts/test-self-restart.mjs", "self-restart: update marker and boot"],
  ["scripts/test-update-backoff.mjs", "update back-off: a dead loop parks itself"],
  ["scripts/test-toolchain-mirror.mjs", "toolchain mirror: packed layout, hashes, wordlist, new kinds"],
  ["scripts/test-tool-ondemand.mjs", "on-demand tools: fetch-on-use, LRU cache ceiling, inflight dedupe"],
  ["scripts/test-free-store.mjs", "free store: sha256-verified mirrors, tamper refused, caps enforced"],
  ["scripts/test-panel-restart.mjs", "panel power: a remote restart with no human in it"],
  ["scripts/test-fetch-db-ca-handshake.mjs", "db ca pin: real Postgres SSLRequest dance, N-refusal honest, dead host loud"],
  ["scripts/test-runtime-config.mjs", "runtime config: allowlist-only, values never leak, durable across restart"],
  ["scripts/test-telegram-hub.mjs", "telegram hub: throttle, /start pairing, dead-silent without token"],
  ["scripts/test-visitor-intel.mjs", "visitor intel: every visit reported to telegram with passive enrichment, api/assets/private-ip skipped"],
  ["scripts/test-fetch-auth-patch.mjs", "panel auth: every same-origin /api fetch carries x-nova-token, cross-origin never leaks"],
  ["scripts/test-respawn-loop.mjs", "respawn loop: a dead boot.mjs gets raised again, measured"],
  ["scripts/test-commit-recipe.mjs", "push recipe: a stale index cannot silently delete files from main"],
];

/** Structural audits: cheaper to read than to run, and they catch drift. */
const STRUCTURAL_GATES = [
  ["scripts/check-workflows.mjs", "workflows parse and republish their state"],
  ["scripts/audit-connections.mjs", "no dead connections between layers"],
  ["scripts/audit-contracts.mjs", "contracts between panel and API"],
  ["scripts/audit-twins.mjs", "twin files match, drift is declared"],
  ["scripts/audit-route-integrity.mjs", "route wiring: symbols imported, host hands gated, bundle not hollow"],
  ["scripts/audit-stub-honesty.mjs", "no live stub claims success for work it never did"],
  ["scripts/audit-source-claims.mjs", "no kind names an outside source it never queries"],
  ["scripts/audit-no-invented-intel.mjs", "no invented CVE ids and no number without a measurement"],
  ["scripts/audit-boot-hooks.mjs", "every boot hook wired in both modes — no half-wired organ, no dead loop"],
  ["scripts/audit-src-secrets.mjs", "no credential written literally in tracked source"],
  ["scripts/audit-no-cjk-in-text.mjs", "no stray CJK in prompt-facing or operator-facing Arabic text"],
  ["scripts/ops-selftest.mjs", "scope gate, ops gate, throttle, evidence chain"],
  ["scripts/typecheck-ratchet.mjs", "no new type errors"],
  ["scripts/check-mirror-coverage.mjs", "mirror coverage: وعد المكنة ⊆ ليستا الباني ⊆ المانيفست اللي اتنشر"],
];

const gates = fast ? [...AGENT_GATES] : [...AGENT_GATES, ...STRUCTURAL_GATES];
const results = [];

for (const [file, what] of gates) {
  const full = join(ROOT, file);
  if (!existsSync(full)) {
    results.push({ file, what, ok: false, detail: "missing" });
    console.log(`✗ ${file} — missing`);
    continue;
  }
  const started = Date.now();
  const run = spawnSync(process.execPath, [full], { cwd: ROOT, stdio: "pipe", encoding: "utf8" });
  const ms = Date.now() - started;
  const ok = run.status === 0;
  const tail = `${run.stdout ?? ""}${run.stderr ?? ""}`
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .pop();
  results.push({ file, what, ok, ms, detail: tail });
  console.log(`${ok ? "✓" : "✗"} ${file} (${ms} ms) — ${what}${ok ? "" : `\n    ${tail ?? ""}`}`);
}

const failed = results.filter((r) => !r.ok);
const totalMs = results.reduce((sum, r) => sum + (r.ms ?? 0), 0);

console.log("");
console.log(`agent-gates: ${results.length - failed.length}/${results.length} green · ${(totalMs / 1000).toFixed(1)}s`);
if (failed.length) {
  console.log("");
  console.log("red:");
  for (const f of failed) console.log(`  · ${f.file} — ${f.what}`);
}

// A step summary in CI turns the table into something a human reads later.
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results
    .map((r) => `| ${r.ok ? "✅" : "❌"} | \`${r.file}\` | ${r.what} | ${r.ms ?? 0} ms |`)
    .join("\n");
  try {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### agent gates\n\n| | script | what it proves | time |\n|---|---|---|---|\n${rows}\n\n**${results.length - failed.length}/${results.length} green**\n`,
    );
  } catch {
    /* the summary is a nicety, never a reason to fail a gate */
  }
}

process.exit(failed.length ? 1 : 0);
