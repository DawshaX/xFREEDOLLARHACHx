#!/usr/bin/env node
/**
 * NOVA — API crawl (find 500s before a user does)
 * ───────────────────────────────────────────────
 * Walks every read-only endpoint the panel actually calls and reports the HTTP
 * status. A 4xx is usually correct behaviour (needs a parameter, unknown id),
 * a **5xx is a bug** — that is what this prints in red.
 *
 *   node scripts/crawl-api.mjs                       # http://127.0.0.1:8080
 *   CRAWL_URL=http://node.example:27214 node scripts/crawl-api.mjs
 *   CRAWL_URL=... CRAWL_VERBOSE=1 node scripts/crawl-api.mjs
 *
 * Exit code: 0 when no 5xx, 1 otherwise — so CI can gate on it.
 */

const BASE = (process.env.CRAWL_URL || process.env.AUDIT_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const VERBOSE = process.env.CRAWL_VERBOSE === "1";
const TIMEOUT = Number(process.env.CRAWL_TIMEOUT_MS || 15000);

/** Read-only GETs (nothing here mutates state). */
const GETS = [
  "/api/health",
  "/api/nova-core/status",
  "/api/nova-core/persona",
  "/api/nova-core/tools",
  "/api/nova-core/storage",
  "/api/nova-core/self-check",
  "/api/nova-core/council",
  "/api/nova-core/council/ping",
  "/api/nova-core/memory",
  "/api/nova-core/memory/stats",
  "/api/nova-core/memory/export",
  "/api/nova-core/ollama",
  "/api/nova/gateway/status",
  "/api/multi-ai/providers",
  "/api/local-agent/agents",
  "/api/local-agent/download-nova-agent",
  "/api/fleet/mesh",
  "/api/stats/dashboard",
  "/api/cve/db/stats",
  "/api/cve/db/search?severity=CRITICAL&limit=3",
  "/api/cves/stats",
  "/api/corpus/stats",
  "/api/missions",
  "/api/evidence",
  "/api/findings",
  "/api/knowledge/search?q=dns&limit=3",
  "/api/memory",
  "/api/memory/search?q=test",
  "/api/notifications",
  "/api/processes",
  "/api/system/info",
  "/api/network/interfaces",
  "/api/settings",
  "/api/tools",
  "/api/scanner/status",
  "/api/nuclei/templates",
  "/api/cwe",
  "/api/mitre",
  "/api/vulnerabilities",
  "/api/explorer/status",
  "/api/agent/tasks",
  "/api/live-agent/sessions",
  "/api/events/history",
  "/api/nova-intel/status",
  "/api/nova/gateway/probe",
];

const results = [];
let worst = 0;

for (const path of GETS) {
  let status = 0;
  let detail = "";
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(TIMEOUT) });
    status = res.status;
    const body = await res.text();
    // A 200 that is actually the SPA means the route does not exist.
    if (/<!DOCTYPE html>/i.test(body.slice(0, 200))) detail = "SPA page (route missing?)";
    else if (status >= 400) detail = body.replace(/\s+/g, " ").slice(0, 110);
  } catch (err) {
    status = -1;
    detail = err.message.slice(0, 80);
  }
  results.push({ path, status, detail });
  if (status >= 500 || status === -1) worst = 1;
}

const bad = results.filter((r) => r.status >= 500 || r.status === -1);
const spa = results.filter((r) => r.detail.startsWith("SPA"));
const ok = results.filter((r) => r.status >= 200 && r.status < 300 && !r.detail.startsWith("SPA"));

for (const r of results) {
  const isBad = r.status >= 500 || r.status === -1;
  const isSpa = r.detail.startsWith("SPA");
  if (!VERBOSE && !isBad && !isSpa) continue;
  const mark = isBad ? "✗ 5xx" : isSpa ? "… SPA" : "⚠ 4xx";
  console.log(`${mark}  ${String(r.status).padStart(4)}  ${r.path}${r.detail && !isSpa ? `  ${r.detail}` : ""}`);
}

console.log("─".repeat(70));
console.log(`${ok.length}/${results.length} answered properly · ${bad.length} server error(s) · ${spa.length} missing route(s)`);
if (bad.length) {
  console.log("\nServer errors (fix these first):");
  for (const b of bad) console.log(`  ${b.path} → ${b.status} ${b.detail}`);
}
process.exit(worst);
