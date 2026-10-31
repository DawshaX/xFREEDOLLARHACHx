#!/usr/bin/env node
/**
 * CyberNova — Connection & Contract Audit
 * ────────────────────────────────────────
 * Verifies that every API endpoint the UI calls is actually wired, and that the
 * two backends (static GitHub Pages engine ↔ Express API server) stay identical.
 *
 * What it checks
 *   1. Call-site discovery  — every `/api/...` used by the frontend (fetch /
 *      EventSource / WebSocket / sseStream / jsonRequest …).
 *   2. Static-engine coverage — `resolveStandaloneApi()` must answer every
 *      call site, otherwise GitHub Pages silently falls back to `{ ok: true }`
 *      and pages render empty.
 *   3. Engine drift — `artifacts/kali-panel/src/lib/standalone-api.ts` (browser)
 *      and `artifacts/api-server/src/lib/standalone-api.ts` (server) must be
 *      byte-identical, they are the same contract engine.
 *   4. Live server (optional) — with `--server=http://127.0.0.1:8080` every GET
 *      call site is hit and any 4xx/5xx is reported.
 *
 * Usage
 *   node scripts/audit-connections.mjs
 *   node scripts/audit-connections.mjs --server=http://127.0.0.1:8080
 *   node scripts/audit-connections.mjs --json  > audit-report.json
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PANEL_SRC = path.join(ROOT, "artifacts/kali-panel/src");
const ENGINE_BROWSER = path.join(PANEL_SRC, "lib/standalone-api.ts");
const ENGINE_SERVER = path.join(ROOT, "artifacts/api-server/src/lib/standalone-api.ts");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const serverArg = args.find((a) => a.startsWith("--server="));
const serverBase = serverArg ? serverArg.split("=")[1].replace(/\/$/, "") : null;

/* ── 1. Discover call sites ───────────────────────────────────────────────── */

const FILES = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) FILES.push(p);
  }
})(PANEL_SRC);

const SKIP = new Set(["lib/standalone-api.ts", "setup.ts"]);

function discoverCallSites() {
  const sites = new Map();
  for (const file of FILES) {
    const rel = path.relative(PANEL_SRC, file);
    if (SKIP.has(rel)) continue;
    let src = fs.readFileSync(file, "utf8");
    src = src
      .replace(/\$\{API_BASE\}/g, "")
      .replace(/\$\{base\}/g, "")
      .replace(/\$\{BASE\}/g, "")
      .replace(/\bAPI_BASE\b/g, "/api")
      .replace(/\bAPI\(\s*(["'`])([^"'`]*)\1\s*\)/g, (_m, _q, p) => JSON.stringify("/api" + p));

    const re = /(["'`])([^"'`\n]*\/api\/[^"'`\n]*)\1/g;
    let m;
    while ((m = re.exec(src))) {
      const raw = m[2];
      if (!raw.startsWith("/api/")) continue; // ignore absolute third-party URLs
      if (/^\/api\/(v\d|profile|account|users|invoices|webhook\/preview)/.test(raw)) {
        // Documentation examples inside the vulnerability encyclopedia.
        if (/(BugBountyStudio|cyber-corpus-2099)/.test(rel)) continue;
      }
      if (raw.length > 90) continue;

      let p = raw.replace(/\$\{[^}]*\}/g, "1");
      const qIdx = p.indexOf("?");
      if (qIdx >= 0) p = p.slice(0, qIdx);
      if (p === "/api" || p === "/api/") continue;

      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 300);
      const methodMatch = after.match(/method:\s*["']([A-Z]+)["']/);
      const method = (methodMatch ? methodMatch[1] : "GET").toUpperCase();
      const key = `${method} ${p}`;
      if (!sites.has(key)) sites.set(key, { method, path: p, files: new Set() });
      sites.get(key).files.add(rel);
    }
  }
  return [...sites.values()].map((s) => ({ ...s, files: [...s.files] }));
}

/* ── 2. Bundle the static engine so it can be executed in Node ────────────── */

async function loadEngine() {
  const esbuildPath = path.join(ROOT, "artifacts/api-server/node_modules/.bin/esbuild");
  const { build } = await import(
    pathToFileURL(path.join(ROOT, "artifacts/api-server/node_modules/esbuild/lib/main.js")).href
  ).catch(async () => {
    throw new Error(`esbuild not found (${esbuildPath}). Run "pnpm install" first.`);
  });
  const outfile = path.join(os.tmpdir(), `cybernova-engine-${process.pid}.mjs`);
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

/* ── 3. Checks ────────────────────────────────────────────────────────────── */

async function main() {
  const findings = [];
  const callSites = discoverCallSites();

  // 3a. Engine drift
  const hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const drift = hash(ENGINE_BROWSER) !== hash(ENGINE_SERVER);
  if (drift) {
    findings.push({
      kind: "engine-drift",
      detail:
        "artifacts/kali-panel/src/lib/standalone-api.ts and artifacts/api-server/src/lib/standalone-api.ts differ — run: cp artifacts/kali-panel/src/lib/standalone-api.ts artifacts/api-server/src/lib/standalone-api.ts",
    });
  }

  // Bare API *prefixes* (e.g. `const API = "/api/nova-core"`) are constants, not routes.
  const API_PREFIXES = new Set(["/api/nova-core", "/api/nova", "/api/agent", "/api/nova-intel"]);

  // 3b. Static engine coverage
  let missing = [];
  try {
    const { resolveStandaloneApi } = await loadEngine();
    // SSE/NDJSON streaming endpoints are answered by dedicated stream handlers
    // (setup.ts on GitHub Pages, app.ts on the API server) — not the JSON engine.
    const streaming = /(stream|events|sse|exec-stream)$|\/auto-chat$/;
    for (const site of callSites) {
      // SSE endpoints are served by dedicated stream handlers (setup.ts / app.ts),
      // not by the JSON engine — skip them here.
      if (streaming.test(site.path)) continue;
      // NOVA's agent stream is served by the dedicated SSE handler (setup.ts on the
      // static build, app.ts on the server) — it is not a JSON engine route.
      if (site.path === "/api/nova-core/chat") continue;
      if (API_PREFIXES.has(site.path)) continue;
      if (site.path === "/api/ws" || site.path === "/api/local-agent/ws") continue;
      let result = null;
      try {
        result = resolveStandaloneApi(site.path, site.method, {
          target: "example.com",
          query: "test",
          prompt: "status",
          content: "status",
          message: "status",
          url: "https://example.com",
          enabled: true,
        });
      } catch (err) {
        findings.push({ kind: "engine-throw", endpoint: `${site.method} ${site.path}`, detail: String(err?.message ?? err), files: site.files });
        continue;
      }
      if (result === null) missing.push(site);
    }
  } catch (err) {
    findings.push({ kind: "engine-load", detail: String(err?.message ?? err) });
  }

  for (const site of missing) {
    findings.push({
      kind: "static-missing",
      endpoint: `${site.method} ${site.path}`,
      detail: "resolveStandaloneApi() returns null → GitHub Pages answers with a generic empty payload",
      files: site.files,
    });
  }

  // 3c. Live server probe
  // NOVA Core endpoints are addressed through a variable base (`${base}/nova-core/…`),
  // so they never show up as literal `/api/…` call sites. Probe them explicitly.
  const EXTRA_PROBES = [
    { method: "GET", path: "/api/nova-core/status", files: ["artifacts/kali-panel/src/lib/nova-core.ts"] },
    { method: "GET", path: "/api/nova-core/tools", files: ["artifacts/kali-panel/src/lib/nova-core.ts"] },
    { method: "GET", path: "/api/nova-core/persona", files: ["artifacts/api-server/src/routes/nova-core.ts"] },
    { method: "GET", path: "/api/nova-core/memory", files: ["artifacts/kali-panel/src/pages/NovaMemory.tsx"] },
    { method: "GET", path: "/api/nova-core/memory/stats", files: ["artifacts/kali-panel/src/pages/NovaMemory.tsx"] },
    { method: "GET", path: "/api/nova-core/ollama", files: ["artifacts/api-server/src/routes/nova-core.ts"] },
    // Fleet endpoints are addressed through `const API = "/api"` in the UI, so
    // they never appear as literal call sites either.
    { method: "GET", path: "/api/local-agent/agents", files: ["artifacts/kali-panel/src/components/desktop/NovaFleetPanel.tsx"] },
    { method: "GET", path: "/api/local-agent/download-nova-agent", files: ["artifacts/api-server/src/routes/local-agent.ts"] },
    { method: "GET", path: "/api/local-agent/download-agent", files: ["artifacts/kali-panel/src/components/desktop/NovaFleetPanel.tsx"] },
    // Fleet mesh — the bus that connects every agent to every other agent.
    { method: "GET", path: "/api/fleet/mesh", files: ["artifacts/kali-panel/src/pages/NovaFleetUnified.tsx"] },
    { method: "GET", path: "/api/fleet/mesh/log", files: ["artifacts/api-server/src/routes/fleet-mesh.ts"] },
    { method: "GET", path: "/api/fleet/plan/active", files: ["artifacts/api-server/src/routes/fleet-mesh.ts"] },
    { method: "POST", path: "/api/fleet/broadcast", files: ["artifacts/kali-panel/src/pages/NovaFleetUnified.tsx"], body: { command: "echo audit", approve: false } },
    { method: "POST", path: "/api/fleet/plan", files: ["artifacts/kali-panel/src/pages/NovaFleetUnified.tsx"], body: { goal: "audit probe" } },
    { method: "POST", path: "/api/fleet/mesh/send", files: ["artifacts/api-server/src/routes/fleet-mesh.ts"], body: { from: "audit", to: "nova", text: "probe" } },
  ];
  const serverResults = [];
  const skipped = [];
  if (serverBase) {
    for (const site of [...callSites, ...EXTRA_PROBES]) {
      if (!["GET", "DELETE"].includes(site.method)) continue;
      if (/(stream|events|sse|exec-stream|screenshot)$/.test(site.path)) continue;
      // WebSocket endpoints never answer a plain GET — probing them is a false positive.
      if (site.path === "/api/ws" || site.path === "/api/local-agent/ws") continue;
      // /api/proxy needs a `?url=` argument; probing it bare always returns 400.
      if (site.path === "/api/proxy") continue;
      // Bare API *prefixes* (e.g. `const API = "/api/nova-core"`) are not routes.
      if (API_PREFIXES.has(site.path)) continue;
      try {
        const res = await fetch(serverBase + site.path, {
          method: site.method,
          signal: AbortSignal.timeout(8000),
          headers: { accept: "application/json" },
        });
        await res.body?.cancel().catch(() => {});
        serverResults.push({ endpoint: `${site.method} ${site.path}`, status: res.status });
        // Collection-scoped routes (`/api/missions/1`) legitimately 404 when the
        // store is empty — that is data, not a broken connection. Confirm by
        // asking the parent collection before reporting a finding.
        if (res.status === 404 && /\/\d+$/.test(site.path)) {
          try {
            const parent = site.path.replace(/\/\d+$/, "");
            const listRes = await fetch(serverBase + parent, { signal: AbortSignal.timeout(8000) });
            const json = await listRes.json().catch(() => null);
            await listRes.body?.cancel().catch(() => {});
            if (Array.isArray(json) && json.length === 0) {
              skipped.push({ endpoint: `${site.method} ${site.path}`, reason: `${parent} is empty` });
              continue;
            }
          } catch {
            /* fall through to the normal finding */
          }
        }
        if (res.status >= 400) {
          findings.push({
            kind: "server-error",
            endpoint: `${site.method} ${site.path}`,
            detail: `HTTP ${res.status}`,
            files: site.files,
          });
        }
      } catch (err) {
        serverResults.push({ endpoint: `${site.method} ${site.path}`, status: "network-error" });
        findings.push({
          kind: "server-unreachable",
          endpoint: `${site.method} ${site.path}`,
          detail: String(err?.name ?? err),
          files: site.files,
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    callSites: callSites.length,
    engineDrift: drift,
    staticMissing: missing.length,
    serverProbed: serverResults.length,
    skipped,
    findings,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("CyberNova — Connection & Contract Audit");
    console.log("───────────────────────────────────────");
    console.log(`Frontend call sites discovered : ${callSites.length}`);
    console.log(`Engine drift (panel ↔ server)  : ${drift ? "DRIFTED ✗" : "in sync ✓"}`);
    console.log(`Static engine gaps             : ${missing.length}`);
    if (serverBase) console.log(`Live server probes             : ${serverResults.length}`);
    console.log("");

    if (findings.length === 0) {
      console.log("✅ All connections verified — no gaps found.");
    } else {
      for (const f of findings) {
        console.log(`✗ [${f.kind}] ${f.endpoint ?? ""}`);
        if (f.detail) console.log(`    ${f.detail}`);
        if (f.files?.length) console.log(`    used by: ${f.files.slice(0, 4).join(", ")}`);
      }
      console.log(`\n${findings.length} finding(s).`);
    }
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(2);
});
