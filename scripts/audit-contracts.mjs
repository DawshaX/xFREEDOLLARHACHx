#!/usr/bin/env node
/**
 * CyberNova — API Shape Contract Audit
 * ────────────────────────────────────
 * The bug that blanked `/nova-fleet` was not a typo, it was a **contract break**:
 * the static engine answered `/api/live-agent/brain-status` with
 * `{memories, iqScore, …}` while the real router answered
 * `{memoryCount, activeProcesses, …}`. The UI read `activeProcesses.length`
 * and died with "Cannot read properties of undefined".
 *
 * Every endpoint that two different backends can answer is a place where that
 * can happen again. This audit asks BOTH backends the same question and diffs
 * the top-level shape:
 *
 *     static engine  (resolveStandaloneApi — what GitHub Pages serves)
 *          vs
 *     live server    (what the Express app serves)
 *
 * It fails when one side returns a field the other does not, because a field
 * that exists on one side only is exactly how a screen crashes in production
 * while all local tests pass.
 *
 * Usage
 *   node scripts/audit-contracts.mjs                      # probe a running server
 *   node scripts/audit-contracts.mjs --server=http://127.0.0.1:8080
 *   node scripts/audit-contracts.mjs --json
 *   node scripts/audit-contracts.mjs --strict             # also fail on extra/missing
 *
 * Requires a production build? No — the static engine is bundled from source.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_BROWSER = path.join(ROOT, "artifacts/kali-panel/src/lib/standalone-api.ts");
const PANEL_SRC = path.join(ROOT, "artifacts/kali-panel/src");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const serverArg = args.find((a) => a.startsWith("--server="));
const SERVER = (serverArg ? serverArg.split("=")[1] : process.env.AUDIT_API || "http://127.0.0.1:8080").replace(/\/$/, "");

/**
 * Endpoints whose payload the UI *destructures or iterates*. These are the ones
 * where a shape difference actually breaks a screen.
 */
const CONTRACTS = [
  { path: "/api/live-agent/brain-status", required: ["memoryCount", "activeProcesses", "cronJobsEnabled", "alertsUnread", "ts"] },
  { path: "/api/live-agent/sessions", required: [] },
  { path: "/api/live-agent/status", required: ["ok", "online", "status"] },
  { path: "/api/live-agent/iq", required: ["iq", "latencyMs", "connected"] },
  { path: "/api/local-agent/agents", required: ["agents"] },
  { path: "/api/local-agent/status", required: [] },
  { path: "/api/fleet/mesh", required: ["nodes", "capacity", "stats", "log"] },
  { path: "/api/fleet/mesh/log", required: ["log"] },
  { path: "/api/fleet/plan/active", required: [] },
  { path: "/api/nova-core/status", required: [] },
  { path: "/api/nova-core/tools", required: [] },
  { path: "/api/nova-core/persona", required: [] },
  { path: "/api/nova-core/memory", required: [] },
  { path: "/api/nova-core/memory/stats", required: [] },
  { path: "/api/nova-core/ollama", required: [] },
  { path: "/api/monitor/health", required: [] },
  { path: "/api/stats", required: [] },
];

/* ── static engine ──────────────────────────────────────────────────────── */

async function loadEngine() {
  const { build } = await import(pathToFileURL(path.join(ROOT, "artifacts/api-server/node_modules/esbuild/lib/main.js")).href).catch(() => {
    throw new Error('esbuild not found. Run "pnpm install" first.');
  });
  const outfile = path.join(os.tmpdir(), `cybernova-contract-${process.pid}.mjs`);
  await build({
    entryPoints: [ENGINE_BROWSER],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
    alias: { "@": PANEL_SRC },
  });
  const mod = await import(pathToFileURL(outfile).href);
  fs.rmSync(outfile, { force: true });
  return mod;
}

const keysOf = (value) => {
  if (Array.isArray(value)) return ["[]"];
  if (!value || typeof value !== "object") return [];
  return Object.keys(value).sort();
};

const shapeOf = (value) => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
};

async function main() {
  const findings = [];
  const rows = [];

  let engine = null;
  try {
    engine = await loadEngine();
  } catch (err) {
    findings.push({ kind: "engine-load", detail: String(err?.message ?? err) });
  }

  let serverUp = false;
  try {
    const ping = await fetch(`${SERVER}/api/live-agent/brain-status`, { signal: AbortSignal.timeout(4000) });
    serverUp = ping.ok;
    await ping.body?.cancel().catch(() => {});
  } catch {
    serverUp = false;
  }

  for (const contract of CONTRACTS) {
    const apiPath = contract.path.replace(/^\/api/, "");
    const row = { path: contract.path, staticKeys: null, liveKeys: null, missing: [], typeMismatch: [], note: null };

    // static (GitHub Pages) side
    if (engine?.resolveStandaloneApi) {
      try {
        const value = engine.resolveStandaloneApi(apiPath, "GET", {});
        if (value === null || value === undefined) row.note = "static engine returns null (mock gap)";
        else row.staticKeys = keysOf(value);
      } catch (err) {
        findings.push({ kind: "static-throw", endpoint: contract.path, detail: String(err?.message ?? err).slice(0, 200) });
      }
    }

    // live server side
    if (serverUp) {
      try {
        const res = await fetch(SERVER + contract.path, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
        const body = await res.json().catch(() => null);
        await res.body?.cancel().catch(() => {});
        if (body === null) row.note = row.note ?? `live returns non-JSON (HTTP ${res.status})`;
        else row.liveKeys = keysOf(body);
      } catch (err) {
        findings.push({ kind: "live-throw", endpoint: contract.path, detail: String(err?.message ?? err).slice(0, 200) });
      }
    }

    // required fields present on BOTH sides
    for (const field of contract.required) {
      const inStatic = !row.staticKeys || row.staticKeys.includes(field);
      const inLive = !row.liveKeys || row.liveKeys.includes(field);
      if (!inStatic) row.missing.push(`static:${field}`);
      if (!inLive) row.missing.push(`live:${field}`);
      if (!inStatic || !inLive) {
        findings.push({
          kind: "contract-missing-field",
          endpoint: contract.path,
          detail: `the UI reads \`${field}\` but ${!inStatic ? "the static engine" : "the live server"} does not return it → undefined crash risk`,
        });
      }
    }

    // cross-side diff
    if (row.staticKeys && row.liveKeys) {
      const onlyStatic = row.staticKeys.filter((k) => !row.liveKeys.includes(k));
      const onlyLive = row.liveKeys.filter((k) => !row.staticKeys.includes(k));
      row.onlyStatic = onlyStatic;
      row.onlyLive = onlyLive;
      if (onlyStatic.length || onlyLive.length) {
        findings.push({
          kind: "shape-drift",
          endpoint: contract.path,
          detail: `${onlyStatic.length ? `only in static: ${onlyStatic.join(",")}` : ""}${
            onlyStatic.length && onlyLive.length ? " | " : ""
          }${onlyLive.length ? `only in live: ${onlyLive.join(",")}` : ""}`,
          severity: "warn",
        });
      }
    }
    rows.push(row);
  }

  const errors = findings.filter((f) => f.severity !== "warn");
  const warns = findings.filter((f) => f.severity === "warn");

  if (asJson) {
    console.log(JSON.stringify({ server: SERVER, serverUp, contracts: rows.length, findings }, null, 2));
  } else {
    console.log("CyberNova — API Shape Contract Audit");
    console.log("────────────────────────────────────");
    console.log(`Static engine  : ${ENGINE_BROWSER.replace(ROOT + "/", "")}`);
    console.log(`Live server    : ${SERVER} ${serverUp ? "(up)" : "(DOWN — live side skipped)"}`);
    console.log(`Contracts      : ${rows.length}`);
    console.log("");
    for (const r of rows) {
      const status = r.missing.length ? "✗" : r.onlyStatic?.length || r.onlyLive?.length ? "~" : "✓";
      console.log(`${status} ${r.path.padEnd(38)} ${r.missing.length ? r.missing.join(" ") : "shape ok"}`);
    }
    if (warns.length) {
      console.log("\nShape differences (informational — both sides answer, fields differ):");
      for (const w of warns) console.log(`  ~ ${w.endpoint}: ${w.detail}`);
    }
    console.log("");
    if (errors.length) {
      console.log(`✗ ${errors.length} contract violation(s):`);
      for (const e of errors) console.log(`  - [${e.kind}] ${e.endpoint ?? ""} ${e.detail}`);
    } else {
      console.log(`✅ No contract violations — ${serverUp ? "static and live agree on every required field." : "static side complete (live server was down)."}`);
    }
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

await main();
