#!/usr/bin/env node
/**
 * Prove the scan this job just ran is actually on the default branch.
 * ──────────────────────────────────────────────────────────────────
 * Measured problem this exists for: the hunt workflow's "commit the result" step
 * went green twice while `state/hunt-latest.json` on `origin/main` stayed at
 * 14:44Z. A step that says it published, and a file that did not move, cannot
 * both be true — so this reads the file back from the remote and compares the one
 * field that must change every run: `at`.
 *
 * Deliberately independent of `scripts/ci-commit.mjs`: if that helper's own
 * verification has a bug, this one still fails the build.
 *
 * Usage: node scripts/prove-published.mjs [path] [--branch main]
 * Exit: 0 = the remote copy is this run's · 1 = it is not · 2 = cannot tell.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const argv = process.argv.slice(2);
const bi = argv.indexOf("--branch");
const branch = bi >= 0 ? argv[bi + 1] : "main";
const file = argv.find((a, i) => !a.startsWith("--") && i !== bi + 1) ?? "state/hunt-latest.json";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

if (!fs.existsSync(file)) {
  console.error(`::error title=not published::${file} was not produced by this job`);
  process.exit(2);
}
const mine = JSON.parse(fs.readFileSync(file, "utf8"));

try {
  git(["fetch", "--quiet", "origin", branch]);
} catch (err) {
  console.error(`::error title=not published::could not fetch origin/${branch}: ${err.message}`);
  process.exit(2);
}

let theirs;
try {
  theirs = JSON.parse(git(["show", `origin/${branch}:${file}`]));
} catch (err) {
  console.error(`::error title=not published::origin/${branch} has no readable ${file}`);
  process.exit(1);
}

// The comparison key is the timestamp of the measurement, not the whole document:
// a later run may add fields, and that must not look like a different scan.
const mineAt = mine.at ?? null;
const theirsAt = theirs.at ?? null;
if (!mineAt) {
  console.error(`::error title=not published::${file} has no "at" — nothing to prove`);
  process.exit(2);
}
if (mineAt !== theirsAt) {
  console.error(`::error title=hunt not published::origin/${branch} has ${theirsAt}, this run measured ${mineAt}`);
  process.exit(1);
}

const findings = theirs.totals?.findings ?? 0;
const rated = theirs.totals?.rated ?? 0;
const budget = theirs.budgetMs ?? null;
console.log(
  `published: ${theirsAt} · findings ${findings} (high/critical ${rated}) · budget ${budget ?? "unrecorded"} ms · targets ${theirs.totals?.targets ?? "?"}`,
);
if (budget === null) {
  // Not a failure — the field is new — but silence would let it rot unnoticed.
  console.log("::warning title=budget not recorded::this run did not record budgetMs, so its runtime cannot be judged");
}
