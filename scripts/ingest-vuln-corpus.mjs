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
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";
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


const bundleDir = path.join(root, "artifacts/api-server/node_modules/.cache/vuln-corpus");
fs.mkdirSync(bundleDir, { recursive: true });
const bundle = path.join(bundleDir, "vuln-corpus.cjs");
bundleCli(root, [
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
// Declared here, not inside the fetch block: the cursor-recording block after the
// write reads it, and a `const` inside the `else` scope made that block throw
// "ReferenceError: deepenFrom is not defined" — after the corpus was written and
// before the index could be committed. Measured: runs 41889863716, 41896545563,
// 41902320281 — all three deepen failures were this one line.
// A deepen window that starts inside the prefix we already hold is pure re-fetch.
// The full pass (push events) fetches pages 1..60, i.e. NVD rows 0..120,000, and NVD
// orders by publish date, so the corpus is a contiguous prefix of length `total`.
// Deepening from a cursor below that prefix can only re-read rows already in the file:
// measured on run 41909776140 (cursor 24,000, corpus 120,000) — 8 pages, 16,000 rows
// fetched, 0 new, byYear unchanged. Advancing the cursor is the whole point, so the
// window starts at the end of what we hold, whichever is further along.
const deepenCursor = Number(previous?.deepen?.nextStartIndex ?? 0);
// The old `Math.max(deepenCursor, previous.total)` assumed the corpus is a
// contiguous publish-ordered prefix — measured FALSE (byYear hole 2010-2022;
// runs 01:57/02:28/02:40 orbited held regions with +172K cursor and ZERO new
// rows, and the wrap-to-0 kept snapping back to total). Skip-ahead over
// heldIds makes ANY start position safe — held windows cost ~2 pages of 40K
// jumps — so the cursor is now followed honestly, wherever it points.
const deepenFrom = mode === "deepen" ? deepenCursor : 0;
// الموضع الفعلي للمشي (module scope عشان كتلة الكيرسر تقراه حتى في fixture mode):
// بيتقدم بصفوف حقيقية أو بقفزة 40K على منطقة dupes — مش بـpages×perPage.
let walkIndex = deepenFrom;

if (fixture) {
  const raw = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const items = (raw.vulnerabilities ?? []).map((v) => v.cve ?? v);
  for (const item of items) {
    const row = lib.rowFromNvd(item, kev.get(item.id), epss.get(item.id));
    if (row) rows.set(row.id, row);
  }
  totalResults = items.length;
  pages = 1;
  // fixture mode "walks" the whole window in one shot: the cursor must record
  // that we passed it, exactly like a real walk past these rows would.
  walkIndex = deepenFrom + totalResults;
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
  // previous run stopped (deepenFrom, module scope) and merges onto the corpus.
  // قِيس 2026-11-14 02:40 (شكوى المالك «لسة مزادوش فوق ال300 ألف»): قاعدة
  // `deepenFrom + page*perPage` بتفترض أن الكوربوس prefix متصل بترتيب النشر —
  // والقياس أثبت العكس: byYear على الكوربوس الفعلي بيبيّن ثقب 2010-2022 كامل
  // (85,693..220,000) والكيرسر كان بيدور في المنطقة المحفوظة (كل صفحة dupes)
  // فيتقدم الـcursor بلا أي صفوف جديدة (جولتا 01:57 و02:28: +172K cursor،
  // صفر صفوف). العلاج المقاس: حمّل معرّفات الموجود مرة واحدة، ولو صفحة كام
  // dupes اقفز 40,000 بدل ما تزحف، والكيرسر يسجّل الموضع الفعلي للمشي.
  let heldIds = null;
  if (mode === "deepen" && fs.existsSync(lib.corpusFile()) && fs.statSync(lib.corpusFile()).size > 1024) {
    try {
      heldIds = new Set(
        zlib
          .gunzipSync(fs.readFileSync(lib.corpusFile()))
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l).id;
            } catch {
              return null;
            }
          })
          .filter(Boolean),
      );
      console.log(`held-ids loaded for the deepen walk: ${heldIds.size} rows already on disk`);
    } catch (err) {
      heldIds = null;
      console.log(`held-ids load failed (${err.message}) — the walk crawls without skip-ahead`);
    }
  }
  const maxPages = flag("all") ? 10_000 : wantedPages;
  const startedAt = Date.now();
  for (let page = 0; page < maxPages; page += 1) {
    if (Date.now() - startedAt > timeBudgetMin * 60_000) {
      console.log(`time budget (${timeBudgetMin} min) reached after ${pages} page(s) — writing what we have`);
      break;
    }
    const startIndex = walkIndex;
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
    const newCount = heldIds ? res.rows.filter((r) => !heldIds.has(r.id)).length : res.rows.length;
    console.log(
      `page ${pages}: +${res.rows.length} rows (${newCount} NEW, startIndex=${startIndex}) · total in NVD=${totalResults} · collected=${rows.size}`,
    );
    if (res.rows.length === 0) break;
    // الصفحة كلها dupes = بنمشي في منطقة محفوظة — اقفز بدل ما تزحف 2K/صفحة
    // (قِيس: 43 صفحة dupes كانت هتاكل 4.7 دقيقة قبل الثقب). قفزة 40K توصل
    // أول صف جديد في ~3 صفحات، وتسيب جولات الميزانية للصفوف الفعلية.
    if (newCount === 0 && res.rows.length > 0 && !flag("all")) walkIndex += 40_000;
    else walkIndex += res.rows.length || perPage;
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
const baseTotal = Number(previous?.total ?? 0);
// قِيس 2026-11-14 (شكوى المالك الخامسة): جولات الـpush بتشغّل MODE=full وmerge:false،
// ولما NVD خانقت النافذة جمعت 5 صفحات بس (10,000 صف) — والكتابة استبدلت كوربوس
// 118,000 صف بعشرة آلاف! (release+mirror+index اتضغطوا في run 43534463693 00:45Z،
// و before كده 156K→118K في run 43533574132). full المخنوق لازم يتراجع لدمج،
// مش يستبدل: الكوربوس اللي على القرص (الم provisions) أغلى من أي نافذة جزئية.
const fullThrottled = mode === "full" && Boolean(previous?.at) && baseTotal > 0 && rows.size < baseTotal;
if (fullThrottled) {
  console.log(
    `full pass collected ${rows.size} rows < ${baseTotal} already held — NVD throttled the walk; ` +
      `degrading this pass to a merge so a partial rebuild can never replace a bigger corpus`,
  );
}
const merges = ((mode === "incremental" || mode === "deepen") && Boolean(previous?.at)) || fullThrottled;
// The invariant is not "half the base" — it is: a write that ends below what we
// already held is a shrink, full stop. With the corpus file on disk, merge:true
// keeps every existing row (writeCorpus), so it can only grow — no guard needed.
// Without the file, a delta smaller than the base would REPLACE the held corpus
// (measured: 104,000 rows replaced by 72 at 04:42Z, and again 118,000 → 10,000
// on 2026-11-14) — that is a die, not a write.
if (merges && previous?.at && baseTotal > 0 && rows.size < baseTotal && !fs.existsSync(lib.corpusFile())) {
  die("refusing to write a shrink", {
    rows: rows.size,
    baseTotal,
    mode,
    corpusFile: lib.corpusFile(),
    previousAt: previous?.at ?? null,
  });
}
// The merges line sits directly above its first read (the guard), so `merges`
// cannot hit a temporal dead zone — that TDZ killed run 41877458865.

const index = lib.writeCorpus([...rows.values()], {
  mode: merges ? mode : "full",
  sources: ["NVD 2.0", "CISA KEV", "EPSS"],
  merge: merges,
});

// Record where the next deepen run should pick up. Writing this only after a
// successful write means a crashed run repeats its window instead of skipping it.
// Runs in fixture mode too, against lib.indexFile() — the path follows
// NOVA_CORPUS_INDEX, so a test can exercise this block without touching the real
// index. It was guarded by `!fixture` while also computing `next` outside the try,
// which is why no test ever saw the ReferenceError this block threw.
if (mode === "deepen") {
  try {
    const next = walkIndex;
    const wrapped = totalResults > 0 && next >= totalResults ? 0 : next;
    const file = lib.indexFile();
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
