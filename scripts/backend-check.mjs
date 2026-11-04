#!/usr/bin/env node
/**
 * Prove the backend is real, from outside it.
 * ──────────────────────────────────────────
 * Every claim in the panel about "الباك إند حي" comes from this probe: it calls
 * the deployed edge function and records what came back. If the numbers here are
 * zero, the panel says zero — no green light without a response.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.NOVA_BACKEND || "https://dbaaclqycsiefjwjfavf.supabase.co/functions/v1/ops-api";
const checks = [];
let failed = 0;

async function probe(name, pathname, expect) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${pathname}`, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => null);
    const ok = res.ok && expect(body);
    if (!ok) failed += 1;
    checks.push({ name, status: res.status, ms: Date.now() - started, ok, sample: JSON.stringify(body)?.slice(0, 220) });
    return body;
  } catch (err) {
    failed += 1;
    checks.push({ name, status: 0, ms: Date.now() - started, ok: false, sample: err.message });
    return null;
  }
}

const health = await probe("health", "/health", (b) => b?.ok === true);
const hunt = await probe("hunt", "/hunt", (b) => b !== null && "findings" in b);
const organs = await probe("organs", "/organs", (b) => Array.isArray(b?.organs));
const corpus = await probe("corpus?q=nginx", "/corpus?q=nginx&limit=3", (b) => Array.isArray(b?.rows));

/* ── CSV mirrors ────────────────────────────────────────────────────────────
   Google Sheets cannot parse JSON, but `=IMPORTDATA(<url>)` reads CSV and
   re-fetches on its own. These three files are that bridge: a spreadsheet that
   stays in sync without a single API key. */
const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const outDir = path.join(root, "state");

fs.writeFileSync(
  path.join(outDir, "organs.csv"),
  toCsv([
    ["organ", "status", "detail", "source", "at"],
    ...(organs?.organs ?? []).map((o) => [o.id, o.status, o.detail, o.source, o.at]),
  ]),
);
fs.writeFileSync(
  path.join(outDir, "hunt-findings.csv"),
  toCsv([
    ["host", "template", "severity", "matched_at", "verified"],
    ...(hunt?.findings ?? []).map((f) => [f.host, f.template, f.severity, f.matched_at, f.verified]),
  ]),
);
fs.writeFileSync(
  path.join(outDir, "hunt-runs.csv"),
  toCsv([
    ["at", "targets", "findings", "high_critical", "says_ar"],
    ...(hunt?.run
      ? [[hunt.run.at, hunt.run.totals?.targets ?? "", hunt.run.totals?.findings ?? "", hunt.run.totals?.rated ?? "", hunt.run.says_ar ?? ""]]
      : []),
  ]),
);

const report = {
  at: new Date().toISOString(),
  backend: BASE,
  verdict: failed === 0 ? "GREEN" : "RED",
  counts: health?.counts ?? null,
  corpusSample: corpus?.rows?.length ?? 0,
  checks,
};
fs.mkdirSync(path.join(root, "state"), { recursive: true });
fs.writeFileSync(path.join(root, "state/backend-health.json"), JSON.stringify(report, null, 2) + "\n");

for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name} · HTTP ${c.status} · ${c.ms}ms · ${c.sample}`);
console.log(`backend: ${report.verdict} · ${JSON.stringify(report.counts ?? {})}`);
process.exit(failed === 0 ? 0 : 1);
