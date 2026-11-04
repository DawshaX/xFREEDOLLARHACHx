/**
 * Ingest the real CVE corpus.
 * ───────────────────────────
 * Pulls NVD 2.0 (the actual CVE database), joins CISA KEV (exploited in the wild)
 * and FIRST EPSS (exploit probability) on the CVE id, and writes:
 *
 *   state/vuln-corpus/cves.jsonl.gz     the rows (gzip JSONL)
 *   state/vuln-corpus-index.json        counted index: total, bySeverity, byYear,
 *                                       kev, epssScored, products, topProducts, at
 *
 * Modes
 *   --pages=N        NVD pages of 2,000 to pull (default 10 → up to 20,000 CVEs)
 *   --all            pull the whole database (paged until NVD says stop)
 *   --incremental    only CVEs modified since the last run (stored in the index)
 *   --deepen         continue the walk from state/vuln-corpus-index.json
 *                    (deepen.nextStartIndex), --pages at a time, merging onto the
 *                    published corpus. This is how the gap gets closed without a
 *                    run that has to last 40 minutes.
 *   --fixture=path   parse local JSON instead of the network (tests, no internet)
 *
 * NVD is slow-and-polite by design: 5 requests / 30 s without a key, 50 with one.
 * This script never hammers it — the delay is adaptive and printed.
 *
 * Exit code 1 when zero rows were produced (an empty corpus is a failure, not a
 * success with a zero in it).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const val = (name, dflt) => {
  const f = flag(name);
  if (!f) return dflt;
  const [, v] = f.split("=");
  return v ?? true;
};

// No index yet → this is the first pass. 25 pages = up to 50,000 CVEs, which a
// no-key NVD budget can finish in ~10 minutes; the weekly `--all` run goes deeper.
const wantedPages = Number(val("pages", 25));
// Never let one run eat the whole window: stop cleanly and write what we have.
const timeBudgetMin = Number(process.env.CORPUS_TIME_BUDGET_MIN || 25);
const mode = flag("deepen") ? "deepen" : flag("incremental") ? "incremental" : "full";
const fixture = val("fixture", null);
const apiKey = process.env.NVD_API_KEY || "";
const perPage = 2000;
const delayMs = apiKey ? 700 : 6500; // NVD: 50/30s with a key, 5/30s without

const esbuild = [
  path.join(root, "artifacts/api-server/node_modules/.bin/esbuild"),
  path.join(root, "node_modules/.pnpm/node_modules/.bin/esbuild"),
].find((p) => fs.existsSync(p));
if (!esbuild) throw new Error("esbuild not found — run pnpm install first");

const bundleDir = path.join(root, "artifacts/api-server/node_modules/.cache/vuln-corpus");
fs.mkdirSync(bundleDir, { recursive: true });
const bundle = path.join(bundleDir, "vuln-corpus.cjs");
execFileSync(
  esbuild,
  [
    path.join(root, "artifacts/api-server/src/lib/ops/vuln-corpus.ts"),
    "--bundle", "--platform=node", "--format=cjs", "--target=node22",
    `--outfile=${bundle}`, "--log-level=warning",
  ],
  { stdio: "inherit" },
);
const lib = createRequire(import.meta.url)(bundle);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 1 · KEV + EPSS joins (best-effort: a dead feed must not empty the corpus) ── */
let kev = new Map();
let epss = new Map();
if (!fixture) {
  try {
    kev = await lib.fetchKev();
    console.log(`KEV: ${kev.size} exploited-in-the-wild entries`);
  } catch (err) {
    console.log(`KEV unavailable (${err.message}) — rows will have no kev flag, and that is stated in the index`);
  }
  try {
    epss = await lib.fetchEpss();
    console.log(`EPSS: ${epss.size} scored CVEs`);
  } catch (err) {
    console.log(`EPSS unavailable (${err.message}) — no epss field, not guessed`);
  }
}

/* ── 2 · NVD ── */
const rows = new Map();
const previous = lib.readIndex();
let totalResults = 0;
let pages = 0;

if (fixture) {
  const raw = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const items = (raw.vulnerabilities ?? []).map((v) => v.cve ?? v);
  for (const item of items) {
    const row = lib.rowFromNvd(item, kev.get(item.id), epss.get(item.id));
    if (row) rows.set(row.id, row);
  }
  totalResults = items.length;
  pages = 1;
  console.log(`fixture: ${rows.size} rows parsed from ${fixture}`);
} else {
  // A fresh CI runner has no corpus file (it is gitignored). Merging a delta onto
  // nothing silently REPLACED 104,000 rows with 72 (measured: index total 72 at
  // 04:42Z). So: pull the published base first, or refuse to write a shrink.
  if ((mode === "incremental" || mode === "deepen") && !fs.existsSync(lib.corpusFile())) {
    console.log(`${mode} run on a clean runner — fetching the published corpus to merge onto`);
    const prov = await lib.provisionCorpus();
    console.log(`  ${prov.action}: ${prov.says_ar}`);
    if (!prov.ok) {
      console.error("no base corpus to merge onto — refusing to write a delta-only corpus");
      process.exit(1);
    }
  }
  const incrementalSince =
    mode === "incremental" && previous?.at
      ? new Date(Math.max(Date.parse(previous.at) - 5 * 60_000, Date.now() - 119 * 86_400_000)).toISOString()
      : undefined;
  if (mode === "incremental" && !incrementalSince) console.log("incremental requested with no previous index — doing a full pass");

  // A deepen run is a window of the same walk, not a new one: it starts where the
  // previous run stopped and merges onto the published corpus.
  const deepenFrom = mode === "deepen" ? Number(previous?.deepen?.nextStartIndex ?? 0) : 0;
  const maxPages = flag("all") ? 10_000 : wantedPages;
  const startedAt = Date.now();
  for (let page = 0; page < maxPages; page += 1) {
    if (Date.now() - startedAt > timeBudgetMin * 60_000) {
      console.log(`time budget (${timeBudgetMin} min) reached after ${pages} page(s) — writing what we have`);
      break;
    }
    const startIndex = deepenFrom + page * perPage;
    if (startIndex > 0) await sleep(delayMs);
    let res;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        res = await lib.fetchNvdPage({
          startIndex,
          resultsPerPage: perPage,
          apiKey,
          lastModStartDate: incrementalSince,
          lastModEndDate: incrementalSince ? new Date().toISOString() : undefined,
        });
        break;
      } catch (err) {
        const throttled = /HTTP (403|429|503)|fetch failed|timeout/i.test(err.message);
        if (attempt === 4 || !throttled) {
          console.log(`NVD page ${page + 1} failed: ${err.message} — stopping with what we have`);
          break;
        }
        const wait = 10_000 * attempt; // 10s · 20s · 30s — NVD asks for patience, not speed
        console.log(`NVD page ${page + 1} attempt ${attempt}: ${err.message} → retrying in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    if (!res) break;
    pages += 1;
    totalResults = res.totalResults || totalResults;
    for (const r of res.rows) rows.set(r.id, { ...r, kev: kev.has(r.id) ? true : r.kev, epss: epss.get(r.id) ?? r.epss });
    console.log(
      `page ${pages}: +${res.rows.length} rows (startIndex=${startIndex}) · total in NVD=${totalResults} · collected=${rows.size}`,
    );
    if (res.rows.length === 0) break;
    if (!flag("all") && startIndex + res.perPage >= totalResults) break;
  }
}

if (rows.size === 0) {
  // An incremental window with nothing new is the normal quiet case, not an error:
  // NVD was throttling or nothing changed in the last 30 minutes. Only a missing
  // corpus makes "no rows" a real failure.
  if (fs.existsSync(lib.corpusFile()) && fs.statSync(lib.corpusFile()).size > 1024) {
    console.log("no new CVEs in this window — existing corpus kept as is");
    console.log(`corpus on disk: ${lib.corpusStatus().total} rows @ ${lib.corpusStatus().at}`);
    process.exit(0);
  }
  console.error("no rows collected and no corpus on disk — refusing to write an empty corpus");
  process.exit(1);
}

/* ── 3 · write ── */
const baseTotal = Number(previous?.total ?? 0);
if (merges && previous?.at && baseTotal > 0 && rows.size < baseTotal * 0.5 && !fs.existsSync(lib.corpusFile())) {
  console.error(`refusing to write: ${rows.size} rows would replace ${baseTotal} (no base file to merge onto)`);
  process.exit(1);
}

const merges = (mode === "incremental" || mode === "deepen") && Boolean(previous?.at);
const index = lib.writeCorpus([...rows.values()], {
  mode: merges ? mode : "full",
  sources: ["NVD 2.0", "CISA KEV", "EPSS"],
  merge: merges,
});

// Record where the next deepen run should pick up. Writing this only after a
// successful write means a crashed run repeats its window instead of skipping it.
if (mode === "deepen" && !fixture) {
  const next = deepenFrom + pages * perPage;
  const wrapped = totalResults > 0 && next >= totalResults ? 0 : next;
  try {
    const file = path.join(root, "state/vuln-corpus-index.json");
    const cur = JSON.parse(fs.readFileSync(file, "utf8"));
    cur.deepen = {
      nextStartIndex: wrapped,
      windowPages: pages,
      walkedFrom: deepenFrom,
      nvdTotal: totalResults,
      // measured, not assumed: how much of NVD's own total the corpus holds
      coverage: totalResults > 0 ? Number((cur.total / totalResults).toFixed(4)) : null,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(cur, null, 2) + "\n");
    console.log(`deepen cursor → ${wrapped} of ${totalResults} (coverage ${cur.deepen.coverage})`);
  } catch (err) {
    console.log(`could not record the deepen cursor: ${err.message}`);
  }
}

console.log("\n== measured ==");
console.log(`rows stored      : ${index.total}`);
console.log(`critical / high  : ${index.bySeverity.critical ?? 0} / ${index.bySeverity.high ?? 0}`);
console.log(`KEV (exploited)  : ${index.kev}`);
console.log(`EPSS scored      : ${index.epssScored}`);
console.log(`distinct products: ${index.products}`);
console.log(`corpus file      : ${lib.corpusFile()} (${(index.files.bytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`index file       : ${lib.indexFile()}`);
console.log(`at               : ${index.at}`);
console.log(`\n${index.says_ar}`);
