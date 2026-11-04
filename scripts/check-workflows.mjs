#!/usr/bin/env node
/**
 * Validate every workflow file before it silently breaks at push time.
 * ────────────────────────────────────────────────────────────────────
 * Measured failure this exists for: a `run: node … --message "chore(corpus): …"`
 * inside YAML made the colon parse as a nested mapping, so GitHub rejected the
 * whole file — the workflow name fell back to its path and every scheduled run
 * failed instantly. CI should have caught that in the PR, not in production.
 *
 * Runs on every push to main and in the live-audit quality gate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".github/workflows");

/**
 * `yaml` exports parse(); `js-yaml` exports load() — same job, different name.
 * Measured 2026-11-04: with js-yaml installed this loader returned it happily and
 * then every file died with "yaml.mod.parse is not a function", i.e. 0/17 valid.
 * The shim keeps one call site (`yaml.mod.parse`) and teaches it both shapes.
 */
function normalize(name, mod) {
  if (typeof mod.parse === "function") return mod;
  if (typeof mod.load === "function") return { ...mod, parse: (s) => mod.load(s) };
  throw new Error(`${name} exposes neither parse() nor load()`);
}

function loadYaml() {
  const req = createRequire(import.meta.url);
  // pnpm keeps packages under .pnpm/<pkg>@<ver>/node_modules/<pkg>; look for the
  // parser the workspace already depends on before giving up.
  const base = path.join(root, "node_modules/.pnpm");
  // A plain `npm install yaml` (no pnpm store) must be enough to run this check:
  // the flat layout was the only one the loader could not see.
  for (const name of ["yaml", "js-yaml"]) {
    try {
      return { name, mod: normalize(name, req(path.join(root, "node_modules", name))) };
    } catch {
      /* not in the flat layout — try the pnpm store */
    }
  }
  if (!fs.existsSync(base)) return null;
  for (const name of ["yaml", "js-yaml"]) {
    const hit = fs.readdirSync(base).find((d) => d === name || d.startsWith(`${name}@`));
    if (!hit) continue;
    try {
      return { name, mod: normalize(name, req(path.join(base, hit, "node_modules", name))) };
    } catch {
      /* next */
    }
  }
  return null;
}

function findPkg(name) {
  const base = path.join(root, "node_modules/.pnpm");
  if (!fs.existsSync(base)) return `${name}@0/node_modules/${name}`;
  const hit = fs.readdirSync(base).find((d) => d === name || d.startsWith(`${name}@`));
  return hit ? `${hit}/node_modules/${name}` : `${name}@0/node_modules/${name}`;
}

const yaml = loadYaml();
if (!yaml) {
  console.log("check-workflows: no YAML parser available — skipping (install deps first)");
  process.exit(0);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

function safeLoad(file) {
  try {
    return yaml.mod.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
let bad = 0;
for (const f of files) {
  const full = path.join(dir, f);
  try {
    const doc = yaml.mod.parse(fs.readFileSync(full, "utf8"));
    if (!doc || typeof doc.name !== "string") throw new Error("missing top-level `name:`");
    if (!doc.on) throw new Error("missing `on:` trigger");
    if (!doc.jobs || Object.keys(doc.jobs).length === 0) throw new Error("no jobs");
  } catch (err) {
    bad += 1;
    console.log(`✗ ${f}: ${String(err.message).split("\n")[0]}`);
  }
}

/**
 * A stateful job that both queues (concurrency) and decides its NEXT step from a
 * file it committed must start from the current origin/main, not from the commit
 * it was queued with. GitHub keeps the queue-time SHA: run 41905819968 was queued
 * at 20:21:25 on 27a0fede, started at 20:31:07 after the 20:30:56 index commit,
 * and re-walked the same 24,000-row window (walkedFrom 0 twice) because the
 * deepen cursor still read "none" in its checkout.
 *
 * The rule is stated as a shape, not a file list: any workflow with `concurrency:`
 * that runs scripts/ci-commit.mjs must contain a step that moves the tree to
 * origin/main. Silent exemption would be the same bug with better manners.
 */
const stateful = files.map((f) => ({ f, raw: fs.readFileSync(path.join(dir, f), "utf8") })).filter(
  ({ raw }) => /^\s*concurrency:/m.test(raw) && /ci-commit\.mjs/.test(raw),
);
const stale = stateful.filter(({ raw }) => !/git reset --hard[^\n]*origin\//.test(raw));
for (const { f } of stale) {
  bad += 1;
  console.log(`✗ ${f}: commits state and reads it back, but never resets to origin/main after a queued start`);
}

/**
 * The other half of the same bug: a workflow that commits state with `[skip ci]`
 * is telling GitHub "do not start anything for this commit" — and that includes
 * the Pages deploy. Measured 2026-11-04 21:36Z: the corpus index was committed
 * with 144,000 rows while the live site still answered 120,000 from the 21:11
 * deploy, so anyone reading the dashboard saw yesterday's numbers labelled live.
 *
 * Rule: every workflow that pushes a `[skip ci]` state commit must be named in
 * some other workflow's `workflow_run.workflows`, so the site rebuilds after it
 * instead of waiting for the next human push.
 */
const skipCi = files
  .map((f) => ({ f, doc: safeLoad(path.join(dir, f)) }))
  .filter(({ doc }) => doc && JSON.stringify(doc).includes("[skip ci]"));
const runTriggers = new Set();
for (const f of files) {
  const doc = safeLoad(path.join(dir, f));
  const on = doc && (doc.on ?? doc[true]);
  const wr = on && on.workflow_run;
  for (const w of (wr && wr.workflows) || []) runTriggers.add(w);
}
const unpublished = skipCi.filter(({ doc }) => !runTriggers.has(doc.name));
for (const { f, doc } of unpublished) {
  bad += 1;
  console.log(`✗ ${f}: commits "[skip ci]" state but no workflow_run trigger republishes it ("${doc.name}")`);
}

console.log(
  `check-workflows: ${files.length - bad}/${files.length} valid` +
    ` · ${stateful.length - stale.length}/${stateful.length} stateful jobs start from origin/main` +
    ` · ${skipCi.length - unpublished.length}/${skipCi.length} skip-ci state commits republished by Pages`,
);
process.exit(bad === 0 ? 0 : 1);
