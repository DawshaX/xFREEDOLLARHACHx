/**
 * Vulnerability corpus test — parser, index, incremental merge, streaming query.
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs entirely on a local fixture (no network), so it proves the plumbing that
 * the CI ingest depends on:
 *   1. NVD JSON → rows, with CPE split into vendor/product/version
 *   2. index counts add up, KEV/EPSS joins land on the right ids
 *   3. gzip JSONL round-trips, hashes match
 *   4. `incremental` merge updates a row and adds a new one without losing the rest
 *   5. streaming query finds by product and by CVE id, honours minCvss, and never
 *      reads more than `maxScan`
 *   6. an empty corpus reports "not ingested", not "zero vulnerabilities"
 *   7. a fresh deploy provisions the corpus over HTTP and rebuilds its own index
 *   8. NOVA_CVE_SOURCE=ci: a weak box polls the small index (one GET when fresh)
 *      and only downloads when the mirror is actually newer, index in hand
 *
 * Run: node scripts/test-vuln-corpus.mjs
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
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nova-corpus-test-"));
process.env.NOVA_CORPUS_DIR = path.join(work, "corpus");
process.env.NOVA_CORPUS_INDEX = path.join(work, "index.json");


const bundleDir = path.join(root, "artifacts/api-server/node_modules/.cache/corpus-tests");
fs.mkdirSync(bundleDir, { recursive: true });
const bundle = path.join(bundleDir, `vuln-corpus-${process.pid}.cjs`);
bundleCli(root, [
    path.join(root, "artifacts/api-server/src/lib/ops/vuln-corpus.ts"),
    "--bundle", "--platform=node", "--format=cjs", "--target=node22",
    `--outfile=${bundle}`, "--log-level=warning",
  ],
  { stdio: "inherit" },
);
const lib = createRequire(import.meta.url)(bundle);

const checks = [];
const check = (name, ok, detail = "") => checks.push([name, Boolean(ok), detail]);

const nvd = (id, cvss, sev, criteria, desc) => ({
  id,
  published: "2024-03-01T00:00:00.000",
  lastModified: "2024-05-01T00:00:00.000",
  descriptions: [{ lang: "en", value: desc }],
  metrics: { cvssMetricV31: [{ cvssData: { baseScore: cvss, baseSeverity: sev } }] },
  weaknesses: [{ description: [{ value: "CWE-79" }, { value: "CWE-79" }, { value: "CWE-200" }] }],
  configurations: [{ nodes: [{ children: [{ cpeMatch: [{ vulnerable: true, criteria }] }] }] }],
});

const items = [
  nvd("CVE-2024-0001", 9.8, "CRITICAL", "cpe:2.3:a:nginx:nginx:1.24.0:*:*:*:*:*:*:*", "nginx resolver off-by-one"),
  nvd("CVE-2024-0002", 7.5, "HIGH", "cpe:2.3:a:apache:http_server:2.4.58:*:*:*:*:*:*:*", "httpd mod_proxy smuggling"),
  nvd("CVE-2024-0003", 5.3, "MEDIUM", "cpe:2.3:a:openssl:openssl:3.0.1:*:*:*:*:*:*:*", "openssl timing"),
  { id: "GHSA-not-a-cve", published: "2024-03-01T00:00:00.000", descriptions: [] },
];

/* 1 · CPE parsing */
const cpe = lib.parseCpe("cpe:2.3:a:apache:http_server:2.4.58:*:*:*:*:*:*:*");
check("parseCpe splits vendor/product/version", cpe?.vendor === "apache" && cpe?.product === "http_server" && cpe?.version === "2.4.58", JSON.stringify(cpe));
check("parseCpe rejects a non-CPE string", lib.parseCpe("not-a-cpe") === null);

/* 2 · rows + joins */
const kev = lib.parseKev({ vulnerabilities: [{ cveID: "CVE-2024-0001", knownRansomwareCampaignUse: "Known" }] });
const epss = lib.parseEpss("model_version,score,percentile\ncve,epss,percentile\nCVE-2024-0002,0.42,0.97\n");
check("parseKev maps the CVE id", kev.get("CVE-2024-0001")?.ransomware === true);
check("parseEpss maps the CVE id", epss.get("CVE-2024-0002") === 0.42);

const rows = items.map((i) => lib.rowFromNvd(i, kev.get(i.id), epss.get(i.id))).filter(Boolean);
check("non-CVE records are dropped", rows.length === 3 && !rows.some((r) => r.id.startsWith("GHSA")));
check("CWEs are de-duplicated", rows[0].cwe.length === 2, rows[0].cwe.join(","));
check("nested CPE configuration is walked", rows[1].cpe[0]?.product === "http_server");
check("KEV/Ransomware flags join onto the row", rows[0].kev === true && rows[0].kevRansomware === true);
check("EPSS joins onto the row", rows[1].epss === 0.42);

/* 3 · write + index */
const idx = lib.writeCorpus(rows, { mode: "full", sources: ["NVD 2.0"] });
const fileBytes = fs.statSync(lib.corpusFile()).size;
check("corpus file exists and is gzip", fs.readFileSync(lib.corpusFile())[0] === 0x1f);
check("index total matches rows written", idx.total === 3, `total=${idx.total}`);
check("index severity sums to total", Object.values(idx.bySeverity).reduce((a, b) => a + b, 0) === idx.total);
check("index counts KEV", idx.kev === 1);
check("index counts EPSS-scored", idx.epssScored === 1);
check("index records the corpus size on disk", idx.files.bytes === fileBytes, `${idx.files.bytes} vs ${fileBytes}`);
check("index has a sha256 of the file", /^[0-9a-f]{64}$/.test(idx.files.sha256));
const onDisk = zlib.gunzipSync(fs.readFileSync(lib.corpusFile())).toString("utf8").trim().split("\n");
check("gzip JSONL round-trips one row per line", onDisk.length === 3);

/* 4 · status */
const st = lib.corpusStatus();
check("status is measured with a timestamp", st.measured === true && Boolean(st.at), st.says_ar.slice(0, 60));
check("status says the real total", st.total === 3);

/* 5 · incremental merge */
const inc = lib.writeCorpus(
  [
    { ...rows[0], cvss: 9.9, sev: "critical" }, // refreshed row
    lib.rowFromNvd(nvd("CVE-2024-0004", 8.1, "HIGH", "cpe:2.3:a:redis:redis:7.0.0:*:*:*:*:*:*:*", "redis auth bypass")),
  ],
  { mode: "incremental", sources: ["NVD 2.0"], merge: true },
);
check("incremental merge keeps the untouched rows", inc.total === 4, `total=${inc.total}`);
const refreshed = (await lib.queryCorpus({ cve: "CVE-2024-0001" })).rows[0];
check("incremental merge overwrites the refreshed row", refreshed?.cvss === 9.9, `cvss=${refreshed?.cvss}`);

/* 6 · streaming queries */
const byProduct = await lib.queryCorpus({ product: "nginx", limit: 5 });
check("query by product finds the CVE", byProduct.rows[0]?.id === "CVE-2024-0001", JSON.stringify(byProduct.rows.map((r) => r.id)));
const byCve = await lib.queryCorpus({ cve: "cve-2024-0002" });
check("query by CVE id is case-insensitive", byCve.rows[0]?.id === "CVE-2024-0002");
const filtered = await lib.queryCorpus({ product: "nginx", minCvss: 10 });
check("minCvss filters out weaker rows", filtered.rows.length === 0);
const capped = await lib.queryCorpus({ product: "nothing-matches-this", maxScan: 2 });
check("maxScan caps how much is read", capped.scanned <= 2, `scanned=${capped.scanned}`);

/* 7 · an empty corpus is honest */
process.env.NOVA_CORPUS_DIR = path.join(work, "empty");
process.env.NOVA_CORPUS_INDEX = path.join(work, "missing-index.json");
const empty = lib.corpusStatus();
check("empty corpus is NOT measured", empty.measured === false && empty.total === 0);
check("empty corpus explains itself instead of printing 0 silently", /مفيش كوربوس/.test(empty.says_ar));

/* 8 · provisioning: a fresh deploy pulls the published corpus, then rebuilds the
      index from the bytes it received (a corpus without an index cannot answer) */
const http = await import("node:http");
const fresh = path.join(work, "fresh");
process.env.NOVA_CORPUS_DIR = fresh;
process.env.NOVA_CORPUS_INDEX = path.join(work, "fresh-index.json");
const server = http.createServer((req, res) => {
  const f = path.join(work, "corpus", "cves.jsonl.gz");
  res.writeHead(200, { "content-type": "application/gzip" });
  res.end(fs.readFileSync(f));
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const prov = await lib.provisionCorpus({ url: `http://127.0.0.1:${port}/cves.jsonl.gz`, minBytes: 64 });
server.close();
check("provision downloads the corpus", prov.action === "downloaded" && fs.existsSync(path.join(fresh, "cves.jsonl.gz")), prov.says_ar);
check("provision rebuilds the index it did not get", lib.corpusStatus().measured === true, `total=${lib.corpusStatus().total}`);
check("provision refuses a stub payload", (await lib.provisionCorpus({ url: `data:text/plain,hi`, force: true })).ok === false);

/* 9 · the ingest SCRIPT, end to end, not just the library it calls.
      A library test cannot see a broken script: `--deepen` shipped with `merges`
      used above its own `const`, so every ingest died with a ReferenceError in
      its temporal dead zone (measured: run 41877458865, 17:25Z, step failed).
      Fixture mode never touches the network, so this runs anywhere. */
const { spawnSync } = await import("node:child_process");
const scriptDir = path.join(work, "script");
process.env.NOVA_CORPUS_DIR = path.join(scriptDir, "corpus");
process.env.NOVA_CORPUS_INDEX = path.join(scriptDir, "index.json");
fs.mkdirSync(scriptDir, { recursive: true });
const fixtureFile = path.join(scriptDir, "nvd.json");
fs.writeFileSync(fixtureFile, JSON.stringify({ vulnerabilities: items.slice(0, 3).map((i) => ({ cve: i })) }));
const runIngest = (...flags) =>
  spawnSync(process.execPath, [path.join(root, "scripts/ingest-vuln-corpus.mjs"), `--fixture=${fixtureFile}`, ...flags], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
  });
const first = runIngest("--pages=1");
check("the ingest script runs (fixture, no network)", first.status === 0, (first.stderr || first.stdout).split("\n").filter(Boolean).slice(-1)[0]);
check("it wrote a corpus", fs.existsSync(path.join(scriptDir, "corpus", "cves.jsonl.gz")));
const afterFirst = lib.corpusStatus().total;
const deepen = runIngest("--deepen", "--pages=1");
check("--deepen runs instead of throwing in the dead zone", deepen.status === 0, (deepen.stderr || "").split("\n").filter(Boolean).slice(-1)[0]);
check("--deepen merges onto the corpus instead of replacing it", lib.corpusStatus().total === afterFirst, `before=${afterFirst} after=${lib.corpusStatus().total}`);
// The cursor block ran after the write and threw ReferenceError for three runs in
// a row (deepenFrom was declared inside the fetch block). Fixture mode now walks
// that block too, so this check is the regression test for it.
const idxAfterDeepen = JSON.parse(fs.readFileSync(process.env.NOVA_CORPUS_INDEX, "utf8"));
check(
  "--deepen records where the next window starts",
  Boolean(idxAfterDeepen.deepen) && typeof idxAfterDeepen.deepen.nextStartIndex === "number",
  `deepen=${JSON.stringify(idxAfterDeepen.deepen)}`,
);
// A window that starts inside the prefix we already hold re-fetches rows we have:
// run 41909776140 deepened from 24,000 with a 120,000-row corpus — 16,000 rows
// fetched, 0 new, byYear unchanged. The window must start at the end of the prefix.
check(
  "--deepen starts past the rows the corpus already holds",
  idxAfterDeepen.deepen.walkedFrom >= idxAfterDeepen.total && idxAfterDeepen.deepen.walkedFrom > 0,
  `walkedFrom=${idxAfterDeepen.deepen.walkedFrom} corpus=${idxAfterDeepen.total}`,
);
// A full pass runs as its own CI step, before the deepen step, on the same runner.
// buildIndex() cannot recompute the cursor, so a write that dropped it sent the next
// step back to row 0 — measured: runs 41905819968 and 41907981906 both reported
// walkedFrom 0 for the second run in a row, 24,000 rows re-fetched, 0 new.
const fullAfterDeepen = runIngest("--pages=1");
const idxAfterFull = JSON.parse(fs.readFileSync(process.env.NOVA_CORPUS_INDEX, "utf8"));
check(
  "a full pass keeps the deepen cursor instead of restarting the walk",
  fullAfterDeepen.status === 0 && idxAfterFull.deepen?.nextStartIndex === idxAfterDeepen.deepen.nextStartIndex,
  `before=${idxAfterDeepen.deepen.nextStartIndex} after=${idxAfterFull.deepen?.nextStartIndex ?? "dropped"}`,
);
// قِيس 2026-11-14: جولة full مخنوقة (5 صفحات = 10,000 صف) استبدلت كوربوس 118,000
// صف — الـrelease والـmirror والـindex اتضغطوا في run 43534463693. الانحدار ده:
// full اللي بيجمع أقل من اللي محتفظين بيه لازم يتراجع لدمج، والناتج مينفعش يصغّر.
const smallFixture = path.join(scriptDir, "nvd-small.json");
fs.writeFileSync(smallFixture, JSON.stringify({ vulnerabilities: items.slice(0, 2).map((i) => ({ cve: i })) }));
const throttled = runIngest(`--fixture=${smallFixture}`, "--pages=1");
check(
  "a throttled full pass merges instead of replacing a bigger corpus",
  throttled.status === 0 && lib.corpusStatus().total >= afterFirst,
  `status=${throttled.status} total=${lib.corpusStatus().total} base=${afterFirst} — ${(throttled.stderr || throttled.stdout).split("\n").filter(Boolean).slice(-1)[0] ?? ""}`,
);
const idxAfterThrottled = JSON.parse(fs.readFileSync(process.env.NOVA_CORPUS_INDEX, "utf8"));
check(
  "the throttled merge still carries the deepen cursor",
  idxAfterThrottled.deepen?.nextStartIndex === idxAfterDeepen.deepen.nextStartIndex,
  `before=${idxAfterDeepen.deepen.nextStartIndex} after=${idxAfterThrottled.deepen?.nextStartIndex ?? "dropped"}`,
);
const incr = runIngest("--incremental", "--pages=1");
check("--incremental runs and keeps the rows", incr.status === 0 && lib.corpusStatus().total === afterFirst, `total=${lib.corpusStatus().total}`);

/* 10 · NOVA_CVE_SOURCE=ci — a weak box must CONSUME the CI-built corpus, not
      rebuild it every 5 minutes (0.4 CPU / ~460MB measured on the Waifly
      container; the CI runner has 2 cores / 7GB, free). The poll reads the
      small remote index first: a no-op costs exactly ONE small GET (count the
      requests). And when the mirror IS newer, the index on disk must be the one
      we just read — a stale index over new bytes is a silent lie. */
const http2 = await import("node:http");
const padRows = [];
for (let i = 0; i < 200; i++) {
  padRows.push(lib.rowFromNvd(nvd(`CVE-2099-${String(i).padStart(4, "0")}`, 9.8, "CRITICAL", `cpe:2.3:a:padv${i}:padp${i}:1.0.${i}:*:*:*:*:*:*:*`, `padding row ${i} with enough entropy to resist gzip`), undefined, undefined));
}
const padGz = zlib.gzipSync(Buffer.from(padRows.filter(Boolean).map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8"), { level: 9 });
check("fixture corpus clears the 1KB anti-stub floor", padGz.length > 1024, `${padGz.length} bytes gz`);
const refreshDir = path.join(work, "refresh");
process.env.NOVA_CORPUS_DIR = refreshDir;
process.env.NOVA_CORPUS_INDEX = path.join(work, "refresh-index.json");
fs.mkdirSync(refreshDir, { recursive: true });
fs.writeFileSync(path.join(refreshDir, "cves.jsonl.gz"), padGz);
let remoteAt = "2024-01-01T00:00:00.000Z";
const remoteIndex = () => ({ version: 1, at: remoteAt, sources: ["fixture"], total: padRows.filter(Boolean).length, bySeverity: {}, byYear: {}, kev: 0, epssScored: 0, products: 0, topProducts: [], files: { corpus: "cves.jsonl.gz", bytes: padGz.length }, mode: "full", says_ar: "" });
let hits = 0;
const srv2 = http2.createServer((req, res) => {
  hits += 1;
  if (String(req.url).endsWith("cves.jsonl.gz")) { res.writeHead(200, { "content-type": "application/gzip" }); res.end(padGz); return; }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(remoteIndex()));
});
const port2 = await new Promise((r) => srv2.listen(0, "127.0.0.1", () => r(srv2.address().port)));
const base2 = `http://127.0.0.1:${port2}/cves.jsonl.gz`;
// the local index is NEWER than the mirror → a no-op: one request, bytes untouched
fs.writeFileSync(process.env.NOVA_CORPUS_INDEX, JSON.stringify({ ...remoteIndex(), at: "2099-01-01T00:00:00.000Z" }, null, 2));
hits = 0;
const noop = await lib.refreshCorpusFromRelease({ url: base2 });
check("a non-newer mirror is a one-GET no-op, not a rebuild", noop.action === "fresh" && hits === 1, `${noop.action} · hits=${hits} · ${noop.says_ar}`);
// the mirror is NEWER → pull it, and the index on disk must carry that timestamp
remoteAt = "2099-06-01T00:00:00.000Z";
hits = 0;
const got = await lib.refreshCorpusFromRelease({ url: base2 });
const writtenIdx = JSON.parse(fs.readFileSync(process.env.NOVA_CORPUS_INDEX, "utf8"));
check("a newer mirror is pulled and the index follows the new bytes", got.action === "downloaded" && writtenIdx.at === "2099-06-01T00:00:00.000Z", `${got.action} · hits=${hits} · indexAt=${writtenIdx.at}`);
check("the pulled corpus is measurable, not a stub", lib.corpusStatus().measured === true && lib.corpusStatus().total === padRows.filter(Boolean).length, `total=${lib.corpusStatus().total}`);
srv2.close();
// and the cron wiring itself: the box jobs answer to the two knobs
const cronSrc = fs.readFileSync(path.join(root, "artifacts/api-server/src/lib/nova-cron.ts"), "utf8");
check("cve_hunt can consume CI instead of re-hunting (NOVA_CVE_SOURCE=ci)", /NOVA_CVE_SOURCE/.test(cronSrc) && /refreshCorpusFromRelease/.test(cronSrc));
check("any cron job switches off without a code change (NOVA_CRON_OFF)", /NOVA_CRON_OFF/.test(cronSrc));

let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) {
    bad += 1;
    // TEST6: على CI اللوجس بتبقى صعبة الوصول — ::error:: بتحوّل كل فشل لتشريح
    // مقروء من annotations الـAPI بدل «exit code 1» صامتة.
    console.error(`::error title=corpus plumbing::${name}${detail ? ` — ${String(detail).replace(/\n/g, " ").slice(0, 600)}` : ""}`);
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad === 0 ? 0 : 1);
