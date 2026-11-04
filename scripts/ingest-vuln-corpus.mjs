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
  path.join(root, "node_modules/.bin/esbuild"),
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
// A crash is a reason too. Without these, an uncaught throw (a corrupt gzip, a
// write that fails) exits 1 with nothing but GitHub's own "Process completed with
// exit code 1" — which is exactly what run 41896545563 left behind.
for (const [event, handler] of [
  ["uncaughtException", (err) => reportCrash("uncaughtException", err)],
  ["unhandledRejection", (err) => reportCrash("unhandledRejection", err)],
]) process.on(event, handler);

function reportCrash(kind, err) {
  const message = String(err?.stack || err?.message || err).slice(0, 1200);
  console.error(`${kind}: ${message}`);
  console.error(`::error title=corpus ingest crashed::${kind} — ${message.replace(/\n/g, " ").slice(0, 700)}`);
  try {
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**corpus ingest crashed** (${kind})\n\n\`\`\`\n${message}\n\`\`\`\n`);
    }
  } catch {
    /* nothing left to try */
  }
  process.exit(1);
}

// A failed ingest must say why in a place that can be read back. These job logs
// are not retrievable through the API (measured: `gh run view --log` empty,
// artifact download dies with EOF), but annotations are — so every exit 1 is
// announced as one, with the state that produced it.
function die(reason, detail) {
  const line = `${reason} — ${JSON.stringify(detail)}`;
  console.error(line);
  console.error(`::error title=corpus ingest::${line.replace(/\n/g, " ").slice(0, 800)}`);
  try {
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) fs.appendFileSync(summary, `\n**corpus ingest failed**\n\n- reason: ${reason}\n- detail: \`${JSON.stringify(detail)}\`\n`);
  } catch {
    /* the exit code is the contract */
  }
  process.exit(1);
}

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
let lastPageError = null;
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
      die("no base corpus to merge onto — refusing to write a delta-only corpus", {
        mode,
        corpusFile: lib.corpusFile(),
        provision: prov,
      });
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
        lastPageError = err.message;
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
    const kept = lib.corpusStatus();
    // "kept as is" is true but not the whole truth: a deepen pass that collected
    // nothing did not advance the cursor either. Say both, in the summary, so a
    // throttled window cannot pass for progress.
    const didNotAdvance = mode === "deepen" || mode === "incremental";
    const line = didNotAdvance
      ? `${mode} collected 0 rows — cursor/coverage unchanged${lastPageError ? ` (NVD: ${lastPageError})` : ""}`
      : "no new CVEs in this window — existing corpus kept as is";
    console.log(line);
    console.log(`corpus on disk: ${kept.total} rows @ ${kept.at}`);
    try {
      if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `\n**corpus ${mode}: nothing advanced**\n\n- ${line}\n- corpus on disk: ${kept.total} rows @ ${kept.at}\n- pages fetched: ${pages} · NVD total: ${totalResults || "unknown"}\n- cursor: unchanged\n`,
        );
      }
    } catch {
      /* the exit code is the contract */
    }
    process.exit(0);
  }
  die("no rows collected and no corpus on disk — refusing to write an empty corpus", {
    mode,
    pages,
    nvdTotal: totalResults,
    deepenFrom,
    corpusFile: lib.corpusFile(),
  });
}

/* ── 3 · write ── */
const merges = (mode === "incremental" || mode === "deepen") && Boolean(previous?.at);
const baseTotal = Number(previous?.total ?? 0);
// Declared before the guard that reads it: the first version of this patch had it
// below, so `merges` was in its temporal dead zone and every ingest died with
// "Cannot access 'merges' before initialization" (measured: run 41877458865).
if (merges && previous?.at && baseTotal > 0 && rows.size < baseTotal * 0.5 && !fs.existsSync(lib.corpusFile())) {
  die("refusing to write a shrink", {
    rows: rows.size,
    baseTotal,
    mode,
    corpusFile: lib.corpusFile(),
    previousAt: previous?.at ?? null,
  });
}

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
