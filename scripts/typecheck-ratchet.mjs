#!/usr/bin/env node
/**
 * Typecheck ratchet — fails only when the error count goes UP.
 * ────────────────────────────────────────────────────────────
 * `pnpm run typecheck` currently fails on 99 pre-existing errors in the
 * api-server (drizzle `eq(uuid, number)` and `req.query` string|string[]).
 * Turning CI red today teaches nobody anything; it just trains everyone to
 * merge anyway. So CI reports the number, blocks regressions, and the
 * baseline in `state/typecheck-baseline.json` ratchets DOWN as they get fixed.
 *
 *   node scripts/typecheck-ratchet.mjs            # check against baseline
 *   node scripts/typecheck-ratchet.mjs --update   # write current count as baseline
 *
 * Exit codes: 0 = at or below baseline · 1 = regression · 2 = could not run tsc
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_FILE = path.join(ROOT, "state", "typecheck-baseline.json");
const PACKAGES = ["artifacts/api-server", "artifacts/kali-panel"];

function runPackage(pkg) {
  const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  // `lib/db` is a composite project: without its .d.ts the api-server count jumps
  // by ~50 phantom TS6305 errors, and the ratchet cries wolf. Emit them if absent.
  if (pkg === "artifacts/api-server" && !fs.existsSync(path.join(ROOT, "lib", "db", "dist", "index.d.ts"))) {
    spawnSync(process.execPath, [tsc, "-p", path.join(ROOT, "lib", "db", "tsconfig.json")], { cwd: ROOT, timeout: 180_000 });
  }
  const res = spawnSync(
    process.execPath,
    ["--max-old-space-size=4096", tsc, "-p", "tsconfig.json", "--noEmit"],
    { cwd: path.join(ROOT, pkg), encoding: "utf8", timeout: 900_000 },
  );
  if (res.error) return { pkg, error: `tsc could not run: ${res.error.message}`, count: null };
  const raw = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  // Errors raised *inside* node_modules are not the project's to fix: CI installs
  // with --no-frozen-lockfile, so a `@types/*` minor bump can add a typing error in
  // a dependency and turn the whole deploy red for something nobody changed. Those
  // lines are counted separately and reported, never blocked on.
  const out = raw
    .split("\n")
    .filter((l) => !/node_modules/.test(l))
    .join("\n");
  const depNoise = (raw.match(/error TS\d+/g) ?? []).length - (out.match(/error TS\d+/g) ?? []).length;
  const count = (out.match(/error TS\d+/g) ?? []).length;
  const byCode = {};
  for (const m of out.matchAll(/error (TS\d+)/g)) byCode[m[1]] = (byCode[m[1]] ?? 0) + 1;
  const byFile = {};
  for (const m of out.matchAll(/^([^\s(]+)\(\d+,\d+\): error TS/gm)) byFile[m[1]] = (byFile[m[1]] ?? 0) + 1;
  return {
    pkg,
    count,
    depNoise,
    byCode,
    byFile,
    sample: out.split("\n").filter((l) => /error TS/.test(l)).slice(0, 12),
    exitStatus: res.status,
    killed: res.signal ? String(res.signal) : null,
  };
}

const results = PACKAGES.map(runPackage);
const total = results.reduce((n, r) => n + (r.count ?? 0), 0);

let baseline = { total: 0, perPackage: {}, updatedAt: null, note: "no baseline file — first run" };
if (fs.existsSync(BASELINE_FILE)) {
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  } catch {
    /* keep default */
  }
}

const limit = Number(baseline.total ?? 0);
console.log("CyberNova — typecheck ratchet");
console.log("─────────────────────────────");
for (const r of results) {
  if (r.error) {
    console.log(`✗ ${r.pkg}: ${r.error}`);
    console.log("::error::typecheck could not run in this environment — the gate is broken, not the code");
    process.exit(2);
  }
  if (r.killed) {
    // OOM-killed tsc (a real risk on CI runners for the panel) is not a regression.
    console.log(`! ${r.pkg}: tsc died with ${r.killed}; counting what it printed (${r.count})`);
    console.log(`::warning::tsc for ${r.pkg} was killed (${r.killed}) — partial count only`);
  }
  const noise = r.depNoise ? ` (+${r.depNoise} in node_modules, ignored)` : "";
  console.log(`${r.count === 0 ? "✓" : "·"} ${r.pkg.padEnd(24)} ${r.count} error(s)${noise}`);
}
console.log(`\ntotal: ${total} · baseline: ${limit} (updated ${baseline.updatedAt ?? "never"})`);

if (process.argv.includes("--update")) {
  const next = {
    total,
    perPackage: Object.fromEntries(results.map((r) => [r.pkg, r.count])),
    updatedAt: new Date().toISOString(),
    note: "lower this number as errors are fixed; CI blocks when total exceeds it",
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`✓ baseline written: ${total}`);
  process.exit(0);
}

if (total > limit) {
  const detail = results.find((r) => (r.count ?? 0) > (baseline.perPackage?.[r.pkg] ?? 0));
  console.log(`\n✗ REGRESSION: +${total - limit} type error(s) vs baseline.`);
  if (detail) {
    console.log(`  worst file: ${Object.entries(detail.byFile ?? {}).sort((a, b) => b[1] - a[1])[0] ?? "—"}`);
    for (const line of (detail.sample ?? []).slice(0, 6)) console.log(`  ${line}`);
  }
  console.log(`\n  fix them, or (only if you are deliberately landing a known debt) run:`);
  console.log(`    node scripts/typecheck-ratchet.mjs --update && git add state/typecheck-baseline.json`);
  process.exit(1);
}
if (total < limit) {
  console.log(`\n✅ ${limit - total} fewer error(s) than baseline — nice. Ratchet it down:`);
  console.log(`    node scripts/typecheck-ratchet.mjs --update && git add state/typecheck-baseline.json`);
} else {
  console.log("\n✅ At baseline — no new type errors.");
}
