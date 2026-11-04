/**
 * Build the panel's vulnerability dataset from the REAL corpus.
 * ─────────────────────────────────────────────────────────────
 * The panel used to print a hand-written galaxy: `total: 76680`,
 * `critical: 12140, high: 27430, medium: 25620, low: 11490` — numbers that add up
 * to exactly 76,680 and describe nothing. This script replaces that dataset with
 * one derived from `state/vuln-corpus/cves.jsonl.gz` (NVD + KEV + EPSS):
 *
 *   public/state/vuln-corpus-live.json
 *     { measured, at, total, bySeverity, kev, epssScored, products,
 *       rows: [top N by KEV → CVSS → EPSS] }
 *
 * No corpus on disk → the file says `measured: false` and the panel says
 * "not measured". It never falls back to a pretty number.
 *
 * Run: node scripts/make-panel-corpus.mjs [--rows=800]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argRows = process.argv.find((a) => a.startsWith("--rows="));
const wantRows = Number(argRows?.split("=")[1] ?? 800);

const corpus = process.env.NOVA_CORPUS_DIR
  ? path.join(process.env.NOVA_CORPUS_DIR, "cves.jsonl.gz")
  : path.join(root, "state/vuln-corpus/cves.jsonl.gz");
const indexFile = process.env.NOVA_CORPUS_INDEX || path.join(root, "state/vuln-corpus-index.json");
const out = path.join(root, "artifacts/kali-panel/public/state/vuln-corpus-live.json");

function write(payload) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

if (!fs.existsSync(corpus)) {
  write({
    measured: false,
    at: null,
    total: 0,
    bySeverity: {},
    kev: 0,
    epssScored: 0,
    products: 0,
    rows: [],
    says_ar: "مفيش كوربوس على القرص — اللوحة بتقول «مش مقاس» بدل ما تعرض رقم مكتوب بالإيد",
  });
  process.exit(0);
}

let idx = null;
try {
  idx = JSON.parse(fs.readFileSync(indexFile, "utf8"));
} catch {
  idx = null;
}

const rows = [];
const stream = fs.createReadStream(corpus).pipe(zlib.createGunzip());
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let r;
  try {
    r = JSON.parse(line);
  } catch {
    continue;
  }
  rows.push({
    id: r.id,
    cvss: r.cvss ?? null,
    sev: r.sev,
    desc: String(r.desc ?? "").slice(0, 260),
    cwe: (r.cwe ?? []).slice(0, 3),
    kev: Boolean(r.kev),
    epss: typeof r.epss === "number" ? r.epss : null,
    pub: r.pub ?? null,
    products: (r.cpe ?? []).map((c) => c.product).filter(Boolean).slice(0, 3),
    refs: (r.refs ?? []).slice(0, 2),
  });
}
rl.close();
stream.destroy();

// Order the sample by what a hunter acts on first: exploited in the wild, then
// the highest score, then the most likely to be exploited.
const top = rows
  .sort((a, b) => Number(b.kev) - Number(a.kev) || (b.cvss ?? 0) - (a.cvss ?? 0) || (b.epss ?? 0) - (a.epss ?? 0))
  .slice(0, wantRows);

// If the corpus on disk is smaller than the index says, the dataset is a slice:
// say so instead of publishing 72 rows as "the whole database".
const bySeverity = idx?.bySeverity ?? {};
const total = idx?.total ?? rows.length;
const kev = idx?.kev ?? rows.filter((r) => r.kev).length;
const epssScored = idx?.epssScored ?? rows.filter((r) => r.epss !== null).length;
const products = idx?.products ?? new Set(rows.flatMap((r) => r.products)).size;
const at = idx?.at ?? new Date().toISOString();

write({
  measured: total > 0,
  at,
  total,
  bySeverity,
  kev,
  epssScored,
  products,
  mode: idx?.mode ?? "unknown",
  sources: idx?.sources ?? ["NVD 2.0", "CISA KEV", "EPSS"],
  sample: top.length,
  complete: !idx || rows.length >= (idx.total ?? 0),
  rows: top,
  says_ar: `${total} ثغرة حقيقية من NVD · ${kev} مستغلّة فعلياً (KEV) · ${products} منتج · مزامنة ${at}`,
});
