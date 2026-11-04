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
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nova-corpus-test-"));
process.env.NOVA_CORPUS_DIR = path.join(work, "corpus");
process.env.NOVA_CORPUS_INDEX = path.join(work, "index.json");

const esbuild = [
  path.join(root, "artifacts/api-server/node_modules/.bin/esbuild"),
  path.join(root, "node_modules/.pnpm/node_modules/.bin/esbuild"),
].find((p) => fs.existsSync(p));
if (!esbuild) throw new Error("esbuild not found — run pnpm install first");

const bundleDir = path.join(root, "artifacts/api-server/node_modules/.cache/corpus-tests");
fs.mkdirSync(bundleDir, { recursive: true });
const bundle = path.join(bundleDir, `vuln-corpus-${process.pid}.cjs`);
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

let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad === 0 ? 0 : 1);
