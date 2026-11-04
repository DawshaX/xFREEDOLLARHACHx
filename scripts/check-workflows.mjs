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

function loadYaml() {
  const req = createRequire(import.meta.url);
  // pnpm keeps packages under .pnpm/<pkg>@<ver>/node_modules/<pkg>; look for the
  // parser the workspace already depends on before giving up.
  const base = path.join(root, "node_modules/.pnpm");
  // A plain `npm install yaml` (no pnpm store) must be enough to run this check:
  // the flat layout was the only one the loader could not see.
  for (const name of ["yaml", "js-yaml"]) {
    try {
      return { name, mod: req(path.join(root, "node_modules", name)) };
    } catch {
      /* not in the flat layout — try the pnpm store */
    }
  }
  if (!fs.existsSync(base)) return null;
  for (const name of ["yaml", "js-yaml"]) {
    const hit = fs.readdirSync(base).find((d) => d === name || d.startsWith(`${name}@`));
    if (!hit) continue;
    try {
      return { name, mod: req(path.join(base, hit, "node_modules", name)) };
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
console.log(`check-workflows: ${files.length - bad}/${files.length} valid`);
process.exit(bad === 0 ? 0 : 1);
