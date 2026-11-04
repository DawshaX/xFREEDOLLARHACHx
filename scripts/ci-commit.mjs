#!/usr/bin/env node
/**
 * Commit from CI without lying about it.
 * ──────────────────────────────────────
 * Three defects were measured in this file's history, each one a green step that
 * had not done its job:
 *
 *   1. `git commit` failed when a bot landed in the same minute → the job went red
 *      intermittently, so its measurements could not be trusted.
 *   2. `git rebase -X ours` kept *origin's* copy (in a rebase "ours" is the side
 *      being replayed onto), emptied the measurement commit, dropped it, and
 *      `git push` still exited 0 printing "Everything up-to-date". Run
 *      41873260816: the commit step was green and state/hunt-latest.json never
 *      moved.
 *   3. Losing the race exited 0 on purpose, so "the next run will publish it" and
 *      "it landed" looked identical in the job list — except nobody reads logs.
 *
 * So a green exit is now a promise: **this commit is on origin/<branch>**. It is
 * proven by fetching the branch back and comparing it to HEAD. When that fails the
 * step goes red *and* emits an `::error` annotation, which is readable through the
 * API even though these job logs are not.
 *
 * Usage:
 *   node scripts/ci-commit.mjs --message "…" pathA pathB …
 *   --allow-empty     nothing changed is fine (exit 0)
 *   --best-effort     never fail; cosmetic jobs only, never measurements
 *
 * Exit codes: 0 = verified on the remote · 1 = did not land · 2 = bad invocation.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const argv = process.argv.slice(2);
const mi = argv.indexOf("--message");
const has = (f) => argv.includes(`--${f}`);
const allowEmpty = has("allow-empty");
const bestEffort = has("best-effort");

// A workflow `env:` value is not a shell: "chore(hunt): measured scan $(date -u …)"
// was committed literally (main, b1a0cbb). The stamp is produced here instead.
const rawMessage = mi >= 0 ? argv[mi + 1] : "chore(ci): automated update";
const stamp = new Date().toISOString().replace(":00.", ":").slice(0, 16) + "Z";
const message = /\$\(date/.test(rawMessage)
  ? `${rawMessage.replace(/\s*\$\(date(?:\s+-u)?[^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()} ${stamp}`
  : rawMessage;

const files = argv.filter((a, i) => !a.startsWith("--") && i !== mi + 1);
const branch = process.env.CI_BRANCH || "main";
const attempts = [];

if (files.length === 0) {
  console.error("ci-commit: no paths given");
  process.exit(2);
}

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

/** A failure the next reader can see without the job log. */
function fail(outcome, detail) {
  attempts.push({ outcome, detail });
  const said = `ci-commit: ${outcome} — ${detail} (run ${process.env.GITHUB_RUN_ID ?? "local"})`;
  console.error(said);
  console.error(`::error title=ci-commit::${outcome}: ${detail.replace(/\n/g, " ").slice(0, 400)}`);
  try {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY ?? "/dev/stderr",
      `\n**ci-commit: ${outcome}**\n\n- message: \`${message}\`\n- files: ${files.join(", ")}\n- ${detail}\n- attempts: ${JSON.stringify(attempts)}\n`,
    );
  } catch {
    /* the summary is a nicety, the exit code is the contract */
  }
  process.exit(bestEffort ? 0 : 1);
}

// `-f` because several of these are gitignored on purpose (corpora are big); the
// workflow decides what ships and passes those paths explicitly.
const add = git(["add", "-f", ...files], { allowFail: true });
if (!add.ok) {
  // A pathspec that matches nothing (an evidence dir with no files yet) must not
  // abort the commit of the paths that do exist: retry each path on its own.
  console.log("ci-commit: adding paths individually (a pathspec did not match)");
  for (const f of files) git(["add", "-f", f], { allowFail: true });
}

const unchanged = git(["diff", "--cached", "--quiet", "--", ...files], { allowFail: true });
if (unchanged.ok) {
  if (allowEmpty) {
    console.log("ci-commit: nothing changed (allowed)");
    process.exit(0);
  }
  // For a measurement this is a failure, not a quiet success: the file this job
  // was supposed to publish is byte-identical to what is already committed, which
  // means the job did not measure anything new.
  fail("nothing-to-commit", `none of ${files.join(", ")} differ from HEAD`);
}

git(["config", "user.name", "nova-ci-bot"]);
git(["config", "user.email", "bot@users.noreply.github.com"]);
const commit = git(["commit", "-m", message], { allowFail: true });
if (!commit.ok) fail("commit-failed", commit.out.trim().split("\n").slice(-3).join(" "));
console.log(`ci-commit: committed ${files.length} path(s)`);

for (let attempt = 1; attempt <= 3; attempt += 1) {
  git(["fetch", "--quiet", "origin", branch], { allowFail: true });
  // In a rebase "theirs" is the side being replayed — the commit we just made — so
  // `-X theirs` keeps the file we just measured when a bot touched the same path.
  // `-X ours` did the opposite: it kept origin's copy, the measurement commit went
  // empty, rebase dropped it, and the push still exited 0.
  const rebase = git(["rebase", "-X", "theirs", `origin/${branch}`], { allowFail: true });
  if (!rebase.ok && /CONFLICT/.test(rebase.out)) {
    git(["rebase", "--abort"], { allowFail: true });
    attempts.push({ attempt, rebase: "conflict" });
    console.log("ci-commit: rebase conflicted — retrying with a fresh fetch");
    continue;
  }
  if (!rebase.ok) attempts.push({ attempt, rebase: rebase.out.trim().split("\n")[0] });

  const push = git(["push", "origin", `HEAD:${branch}`], { allowFail: true });
  if (!push.ok) {
    attempts.push({ attempt, push: push.out.trim().split("\n").slice(-1)[0] ?? "rejected" });
    console.log(`ci-commit: push rejected on attempt ${attempt} — another job wrote first, retrying`);
    continue;
  }

  // A push that succeeds is not a change that landed: after an aggressive rebase
  // the commit can be empty and `Everything up-to-date` still exits 0. Verify
  // against the remote, never against the exit code.
  git(["fetch", "--quiet", "origin", branch], { allowFail: true });
  const landed = git(["rev-parse", `origin/${branch}`], { allowFail: true });
  const mine = git(["rev-parse", "HEAD"], { allowFail: true });
  const match = landed.ok && mine.ok && landed.out.trim() === mine.out.trim();
  attempts.push({ attempt, push: "ok", verified: match });
  if (match) {
    console.log(`ci-commit: pushed on attempt ${attempt} and verified on origin/${branch} at ${mine.out.trim().slice(0, 8)}`);
    process.exit(0);
  }
  console.log(
    `ci-commit: push reported ok but origin/${branch} is at ${(landed.out ?? "").trim().slice(0, 8) || "an unknown sha"} — retrying`,
  );
}

fail("push-failed", `origin/${branch} does not match HEAD after 3 attempts`);
