#!/usr/bin/env node
/**
 * Commit from CI without losing the race.
 * ──────────────────────────────────────
 * Measured problem: the hunt workflow found 0 findings, wrote them, and the
 * `git commit` step **failed** — because the Cloud-Brain pulse (`chore(main):
 * checkpoint [skip ci]`) or a merge landed in the same minute. The second run
 * succeeded by luck. A job that only sometimes commits its measurement is a job
 * whose measurements you cannot trust.
 *
 * This helper makes the write path deterministic:
 *   1. stage exactly the paths it was given
 *   2. commit (skip when nothing changed)
 *   3. fetch → rebase with `-X ours` for the files we just produced → retry on
 *      rejection with fresh fetch, up to 3 times
 *   4. never exit non-zero for "a bot pushed first" — that is a race, not a bug
 *
 * Usage: node scripts/ci-commit.mjs --message "…" pathA pathB …
 */
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const mi = argv.indexOf("--message");
// A workflow `env:` value is not a shell: "$(date …)" would be committed
// literally (measured: a commit titled "measured scan $(date -u …)").
const rawMessage = mi >= 0 ? argv[mi + 1] : "chore(ci): automated update";
const stamp = new Date().toISOString().replace(":00.", ":").slice(0, 16) + "Z";
const message = /\$\(date/.test(rawMessage) ? `${rawMessage.replace(/\s*\$\(date[^)]*\)\s*/g, " ").trim()} ${stamp}` : rawMessage;
const files = argv.filter((a, i) => !a.startsWith("--") && i !== mi + 1);
const branch = process.env.CI_BRANCH || "main";

function git(args, { allowFail = false } = {}) {
  try {
    return {
      ok: true,
      out: execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    };
  } catch (err) {
    if (!allowFail) throw err;
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

if (files.length === 0) {
  console.error("ci-commit: no paths given");
  process.exit(2);
}

// `-f` because several of these are gitignored on purpose (corpora are big);
// the workflow decides what ships, and it passes those paths explicitly.
const add = git(["add", "-f", ...files], { allowFail: true });
if (!add.ok) {
  console.error(add.out);
  process.exit(1);
}

const staged = git(["diff", "--cached", "--quiet", "--", ...files], { allowFail: true });
if (staged.ok) {
  console.log("ci-commit: nothing changed");
  process.exit(0);
}

git(["config", "user.name", "nova-ci-bot"]);
git(["config", "user.email", "bot@users.noreply.github.com"]);
git(["commit", "-m", message]);
console.log(`ci-commit: committed ${files.length} path(s)`);

for (let attempt = 1; attempt <= 3; attempt += 1) {
  git(["fetch", "--quiet", "origin", branch], { allowFail: true });
  // `-X ours` keeps the file we just measured when a bot touched the same path;
  // anything else in the tree still rebases normally.
  const rebase = git(["rebase", "-X", "ours", `origin/${branch}`], { allowFail: true });
  if (!rebase.ok && /CONFLICT/.test(rebase.out)) {
    git(["rebase", "--abort"], { allowFail: true });
    console.log("ci-commit: rebase conflicted — retrying with a fresh fetch");
    continue;
  }
  const push = git(["push", "origin", `HEAD:${branch}`], { allowFail: true });
  if (push.ok) {
    console.log(`ci-commit: pushed on attempt ${attempt}`);
    process.exit(0);
  }
  console.log(`ci-commit: push rejected on attempt ${attempt} — another job wrote first, retrying`);
}

// Losing a race must not fail the build: the next scheduled run republishes.
console.log("ci-commit: could not push after 3 attempts — the next run will publish this measurement");
process.exit(0);
