#!/usr/bin/env node
/**
 * Leave a readable trace when a step dies.
 * ────────────────────────────────────────
 * Job logs from this repository cannot be retrieved: `gh run view --log` returns
 * nothing and the artifact download dies with EOF (measured repeatedly). So a step
 * that fails and prints nothing useful leaves *no* evidence — which is how the
 * corpus deepen failed twice (runs 41889863716 and 41896545563) with the same
 * anonymous "Process completed with exit code 1".
 *
 * This script takes the step's captured output and writes it into the repo, where
 * it can be read back like any other state file:
 *
 *   node scripts/record-failure.mjs --step "deepen" --log "$RUNNER_TEMP/deepen.log" \
 *        --out state/corpus-last-failure.json [--commit] [--keep=120]
 *
 * The tail is bounds-checked (`--keep` lines, 200 KB), secrets are not scrubbed
 * because nothing here reads the environment — only the log file it is given.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
// `--step deepen` and `--step=deepen` must both work: the first version only
// understood the `=` form and silently recorded the step as the string "true".
const arg = (k, d) => {
  const i = argv.findIndex((a) => a === `--${k}` || a.startsWith(`--${k}=`));
  if (i < 0) return d;
  const hit = argv[i];
  if (hit.includes("=")) return hit.split("=").slice(1).join("=");
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
};
const step = String(arg("step", "unknown step"));
const logFile = arg("log", null);
const out = path.resolve(root, String(arg("out", "state/last-failure.json")));
const keep = Number(arg("keep", 120));
const doCommit = argv.includes("--commit");

let tail = "";
let bytes = 0;
if (logFile && fs.existsSync(String(logFile))) {
  const raw = fs.readFileSync(String(logFile), "utf8");
  bytes = Buffer.byteLength(raw);
  const lines = raw.split("\n");
  tail = lines.slice(-keep).join("\n").slice(-200_000);
}

const record = {
  at: new Date().toISOString(),
  step,
  run: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  job: process.env.GITHUB_JOB ?? null,
  sha: process.env.GITHUB_SHA ?? null,
  log: logFile ? { file: String(logFile), bytes, keptLines: keep } : null,
  tail,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
const rel = path.relative(root, out);
console.log(`recorded the failure of "${step}" → ${rel} (${bytes} bytes of log, ${tail.split("\n").length} lines kept)`);
console.log(`::error title=step failed::${step} — ${(tail.split("\n").filter(Boolean).pop() || "no output captured").slice(0, 300)}`);

if (doCommit) {
  // Best effort on purpose: if this fails we already have the annotation above.
  try {
    execFileSync(process.execPath, ["scripts/ci-commit.mjs", "--message", `chore: record the failure of "${step}" [skip ci]`, rel], {
      cwd: root,
      stdio: "inherit",
    });
  } catch (e) {
    console.log(`could not commit the failure record: ${e?.message?.slice(0, 200)}`);
  }
}
