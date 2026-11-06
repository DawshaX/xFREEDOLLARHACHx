#!/usr/bin/env node
/**
 * Memory must survive a restart. That is the whole point of it.
 *
 * Measured 2026-11-06: a memory written through `POST /api/memory` was gone
 * after the process restarted. The route kept its records in a module-level
 * array and never called `lib/agent/memory-store` — the layer that owns
 * `state/nova-memory.json` and the Supabase mirror. The write looked successful
 * and the data was never on disk.
 *
 * This test pins the property, not the implementation: write through the store,
 * throw the process away, read it back from a fresh one.
 *
 *   node scripts/test-memory-persistence.mjs
 */
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";

const work = mkdtempSync(join(tmpdir(), "nova-mempersist-"));
const FILE = join(work, "nova-memory.json");
const SRC = join(ROOT, "artifacts/api-server/src/lib/agent/memory-store.ts");
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

const env = { ...process.env, NOVA_MEMORY_FILE: FILE, NOVA_MEMORY_MIRROR: "0" };

// ── process 1: write ─────────────────────────────────────────────────────────
const writer = `
import { remember, flushMemory } from ${JSON.stringify(`file://${out}`)};
remember({ kind: "preference", title: "test-persist", content: "المستخدم بيحب التقارير بالعربي", importance: 8 });
flushMemory();
console.log("written");
`;
execFileSync(process.execPath, ["--input-type=module", "-e", writer], { env, stdio: "pipe" });

assert.ok(existsSync(FILE), "the memory file must exist on disk after a write");
const onDisk = JSON.parse(readFileSync(FILE, "utf8"));
assert.ok(
  onDisk.records.some((r) => r.title === "test-persist"),
  "the written record must be in the file, not only in RAM",
);

// ── process 2: a brand-new process reads it back ─────────────────────────────
const reader = `
import { recall } from ${JSON.stringify(`file://${out}`)};
const hits = recall("test-persist", { limit: 5 });
const hit = hits.find((h) => h.title === "test-persist");
if (!hit) { console.error("NOT FOUND"); process.exit(1); }
console.log(JSON.stringify({ content: hit.content }));
`;
const raw = execFileSync(process.execPath, ["--input-type=module", "-e", reader], {
  env,
  stdio: "pipe",
}).toString();
const { content } = JSON.parse(raw.trim());
assert.equal(content, "المستخدم بيحب التقارير بالعربي", "the content must come back intact");

console.log("✓ memory persistence: written to disk, read back by a fresh process");
