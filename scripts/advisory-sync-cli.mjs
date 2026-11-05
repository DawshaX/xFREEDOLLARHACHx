/**
 * CLI: sync the advisory corpus the app ships with.
 *   GITHUB_TOKEN=… NOVA_ADVISORY_MIN_SEVERITY=high node scripts/advisory-sync-cli.mjs [pages]
 * Prints only measured numbers. Writes NOVA_ADVISORY_CACHE (default state/advisory-cache.json).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";
const pages = Number(process.argv[2] ?? process.env.PAGES ?? 20);

const dir = path.join(root, "artifacts/api-server/node_modules/.cache/adv-cli");
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, "advisory-library.cjs");
bundleCli(root, [
    path.join(root, "artifacts/api-server/src/lib/ops/advisory-library.ts"),
    "--bundle", "--platform=node", "--format=cjs", "--target=node22",
    `--outfile=${out}`, "--log-level=warning",
  ],
  { stdio: "inherit" },
);

const lib = createRequire(import.meta.url)(out);
const res = await lib.syncAdvisories({ pages });
const st = lib.libraryStatus();
console.log(`${res.ok ? "ok" : "FAILED"} · pages=${res.pages_fetched} · rows=${res.cache.total} · ${res.error ?? "no error"}`);
console.log(st.says_ar);
if (!res.ok) process.exit(1);
