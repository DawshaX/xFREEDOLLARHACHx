/**
 * Ops · The vulnerability corpus (CVE-scale, measured)
 * ────────────────────────────────────────────────────
 * What this replaces: `totalCves: 75879`, `nvdAdvisories: 75879`,
 * `cisaKev: 1284`, `exploitsCatalogued: 49217` — literals typed over a 22-row
 * array. The *integrations* in `live-vuln-ingestor.ts` were real (NVD, GHSA,
 * EPSS, CIRCL, OSV, DeFiLlama, Shodan, PayloadsAllTheThings), but each one pulled
 * 5–10 records per call to paint a "telemetry" panel. Nothing ever accumulated
 * into a corpus you could query by product or CVE.
 *
 * This module is the accumulation layer:
 *
 *   source   NVD 2.0 API (full + incremental by `lastModStartDate`),
 *            CISA KEV (exploited-in-the-wild), FIRST EPSS (exploit probability)
 *   shape    one flat row per CVE, CPE → (vendor, product, version) tokens,
 *            KEV flag + EPSS joined on the CVE id
 *   storage  gzipped JSONL + a small committed index, so a 300 k-row corpus does
 *            not have to live in git or in RAM
 *   truth    `corpusStatus()` only reports what the index file says, with `at`.
 *            An empty corpus says "not ingested", never a number.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import readline from "node:readline";

export type Sev = "critical" | "high" | "medium" | "low" | "none" | "unknown";

export interface CpeRef {
  vendor: string;
  product: string;
  version?: string;
}

export interface CorpusCve {
  id: string;
  /** CVSS base score from NVD (v3.1 → v3.0 → v2 fallback) */
  cvss?: number;
  sev: Sev;
  /** published / last modified, ISO */
  pub?: string;
  mod?: string;
  desc: string;
  cwe: string[];
  cpe: CpeRef[];
  /** exploited in the wild per CISA KEV */
  kev?: true;
  kevRansomware?: true;
  /** EPSS probability 0..1 */
  epss?: number;
  refs?: string[];
}

export interface CorpusIndex {
  version: number;
  at: string;
  sources: string[];
  total: number;
  bySeverity: Record<string, number>;
  byYear: Record<string, number>;
  kev: number;
  epssScored: number;
  /** distinct vendor:product pairs seen in CPE data */
  products: number;
  /** top products by CVE count — proves the CPE join works */
  topProducts: Array<{ product: string; count: number }>;
  files: { corpus: string; bytes: number; sha256?: string };
  /** how the corpus was produced: full dump or incremental delta */
  mode: "full" | "incremental" | "unknown";
  /**
   * Where the deep walk got to. It lives in the index because that is the only
   * file the CI job commits, and it has to survive every write: the ingest step
   * (a full pass) and the deepen step are two processes on the same runner, so a
   * full pass that dropped this key left the next step reading `undefined` and
   * restarting the walk at row 0 — measured on runs 41905819968 and 41907981906,
   * both `walkedFrom: 0 / nextStartIndex: 24000`, 24,000 rows re-fetched for 0
   * new rows while the cursor never moved.
   */
  deepen?: {
    nextStartIndex: number;
    windowPages: number;
    walkedFrom: number;
    nvdTotal: number;
    coverage: number;
    at: string;
  };
  says_ar: string;
}

/* ── paths ───────────────────────────────────────────────────────────────── */

export function corpusDir(): string {
  return (
    process.env.NOVA_CORPUS_DIR ||
    path.resolve(process.cwd(), process.env.NOVA_CORPUS_REL || "state/vuln-corpus")
  );
}
export function corpusFile(): string {
  return path.join(corpusDir(), "cves.jsonl.gz");
}
export function indexFile(): string {
  return (
    process.env.NOVA_CORPUS_INDEX ||
    path.resolve(process.cwd(), process.env.NOVA_CORPUS_INDEX_REL || "state/vuln-corpus-index.json")
  );
}

/* ── parsing: NVD 2.0, CISA KEV, EPSS ────────────────────────────────────── */

const SEV_ORDER: Sev[] = ["critical", "high", "medium", "low", "none", "unknown"];

function normSev(raw: unknown): Sev {
  const s = String(raw ?? "").toLowerCase();
  return (SEV_ORDER as readonly string[]).includes(s) ? (s as Sev) : "unknown";
}

function cvssOf(metrics: Record<string, unknown> | undefined): { score?: number; sev: Sev } {
  if (!metrics) return { sev: "unknown" };
  for (const key of ["cvssMetricV31", "cvssMetricV30", "cvssMetricV40", "cvssMetricV2"]) {
    const arr = metrics[key] as Array<Record<string, unknown>> | undefined;
    const first = arr?.[0];
    if (!first) continue;
    const data = (first["cvssData"] as Record<string, unknown> | undefined) ?? {};
    const score = Number(data["baseScore"]);
    const sev = normSev(data["baseSeverity"] ?? first["baseSeverity"]);
    if (Number.isFinite(score)) return { score, sev: sev === "unknown" ? "unknown" : sev };
  }
  return { sev: "unknown" };
}

/** `cpe:2.3:a:nginx:nginx:1.24.0:*:*:*:*:*:*:*` → {vendor, product, version} */
export function parseCpe(criteria: string): CpeRef | null {
  const parts = criteria.split(":");
  if (parts.length < 5 || parts[0] !== "cpe") return null;
  const vendor = parts[3] ?? "";
  const product = parts[4] ?? "";
  if (!product || product === "*") return null;
  const version = parts[5] && parts[5] !== "*" && parts[5] !== "-" ? parts[5] : undefined;
  return { vendor: vendor === "*" ? "" : vendor, product, version };
}

function englishDesc(descriptions: unknown): string {
  const arr = (descriptions as Array<Record<string, unknown>> | undefined) ?? [];
  const en = arr.find((d) => String(d["lang"]) === "en") ?? arr[0];
  return String(en?.["value"] ?? "").slice(0, 1200);
}

/** Turn one NVD `vulnerabilities[].cve` object into a corpus row. */
export function rowFromNvd(item: Record<string, unknown>, kev?: KevEntry, epss?: number): CorpusCve | null {
  const id = String(item["id"] ?? "");
  if (!/^CVE-\d{4}-\d{4,}$/.test(id)) return null;
  const { score, sev } = cvssOf(item["metrics"] as Record<string, unknown> | undefined);
  const weaknesses = (item["weaknesses"] as Array<Record<string, unknown>> | undefined) ?? [];
  const cwe: string[] = [];
  for (const w of weaknesses) {
    for (const d of ((w["description"] as Array<Record<string, unknown>> | undefined) ?? [])) {
      const v = String(d["value"] ?? "");
      if (/^CWE-\d+$/.test(v)) cwe.push(v);
    }
  }
  const cpe: CpeRef[] = [];
  const configs = (item["configurations"] as Array<Record<string, unknown>> | undefined) ?? [];
  const walk = (nodes: unknown): void => {
    for (const node of (nodes as Array<Record<string, unknown>> | undefined) ?? []) {
      const matches = (node["cpeMatch"] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const m of matches) {
        if (m["vulnerable"] === false) continue;
        const ref = parseCpe(String(m["criteria"] ?? ""));
        if (ref) cpe.push({ ...ref, version: ref.version ?? (m["versionEndExcluding"] ? `<${String(m["versionEndExcluding"])}` : undefined) });
      }
      if (node["children"]) walk(node["children"]);
    }
  };
  for (const c of configs) walk(c["nodes"]);

  const row: CorpusCve = {
    id,
    cvss: score,
    sev,
    pub: item["published"] ? String(item["published"]) : undefined,
    mod: item["lastModified"] ? String(item["lastModified"]) : undefined,
    desc: englishDesc(item["descriptions"]),
    cwe: [...new Set(cwe)].slice(0, 6),
    cpe: dedupeCpe(cpe).slice(0, 12),
  };
  if (kev) {
    row.kev = true;
    if (kev.ransomware) row.kevRansomware = true;
  }
  if (typeof epss === "number" && Number.isFinite(epss)) row.epss = epss;
  return row;
}

function dedupeCpe(list: CpeRef[]): CpeRef[] {
  const seen = new Set<string>();
  const out: CpeRef[] = [];
  for (const c of list) {
    const k = `${c.vendor}|${c.product}|${c.version ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export interface KevEntry {
  dateAdded?: string;
  ransomware: boolean;
}

export function parseKev(json: unknown): Map<string, KevEntry> {
  const out = new Map<string, KevEntry>();
  const arr = ((json as Record<string, unknown>)?.["vulnerabilities"] as Array<Record<string, unknown>> | undefined) ?? [];
  for (const v of arr) {
    const id = String(v["cveID"] ?? "");
    if (!id) continue;
    out.set(id, {
      dateAdded: v["dateAdded"] ? String(v["dateAdded"]) : undefined,
      ransomware: String(v["knownRansomwareCampaignUse"] ?? "").toLowerCase() === "known",
    });
  }
  return out;
}

/** EPSS publishes `model_version,score,percentile` with `cve,epss,percentile` rows. */
export function parseEpss(csv: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of csv.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.startsWith("model_version") || line.startsWith("cve,")) continue;
    const [id, score] = line.split(",");
    if (!id || !/^CVE-\d{4}-\d{4,}$/.test(id.trim())) continue;
    const n = Number(score);
    if (Number.isFinite(n)) out.set(id.trim(), n);
  }
  return out;
}

/* ── index ───────────────────────────────────────────────────────────────── */

export function buildIndex(rows: CorpusCve[], opts: { at?: string; mode?: CorpusIndex["mode"]; sources?: string[]; bytes?: number; sha256?: string } = {}): CorpusIndex {
  const bySeverity: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  const productCount = new Map<string, number>();
  let kev = 0;
  let epssScored = 0;
  for (const r of rows) {
    bySeverity[r.sev] = (bySeverity[r.sev] ?? 0) + 1;
    const year = r.id.slice(4, 8);
    byYear[year] = (byYear[year] ?? 0) + 1;
    if (r.kev) kev += 1;
    if (typeof r.epss === "number") epssScored += 1;
    for (const c of r.cpe) {
      const key = c.product;
      productCount.set(key, (productCount.get(key) ?? 0) + 1);
    }
  }
  const topProducts = [...productCount.entries()]
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
  const at = opts.at ?? new Date().toISOString();
  const total = rows.length;
  return {
    version: 1,
    at,
    sources: opts.sources ?? [],
    total,
    bySeverity,
    byYear,
    kev,
    epssScored,
    products: productCount.size,
    topProducts,
    files: { corpus: path.basename(corpusFile()), bytes: opts.bytes ?? 0, sha256: opts.sha256 },
    mode: opts.mode ?? "unknown",
    says_ar:
      total === 0
        ? "المكتبة فاضية — مفيش سحب حصل، والرقم صفر لأن مفيش بيانات مش لأن مفيش ثغرات"
        : `${total} ثغرة حقيقية · critical ${bySeverity["critical"] ?? 0} · high ${bySeverity["high"] ?? 0} · ` +
          `${kev} مستغلّة فعلياً (KEV) · ${epssScored} لها EPSS · ${productCount.size} منتج بـCPE · مزامنة ${at}`,
  };
}

export function readIndex(): CorpusIndex | null {
  try {
    const raw = JSON.parse(fs.readFileSync(indexFile(), "utf8")) as CorpusIndex;
    return raw && typeof raw.total === "number" ? raw : null;
  } catch {
    return null;
  }
}

export function corpusStatus(): {
  measured: boolean;
  total: number;
  at: string | null;
  ageMin: number | null;
  kev: number;
  bySeverity: Record<string, number>;
  products: number;
  bytes: number;
  filePresent: boolean;
  says_ar: string;
} {
  const idx = readIndex();
  const filePresent = fs.existsSync(corpusFile());
  if (!idx || idx.total === 0) {
    return {
      measured: false,
      total: 0,
      at: null,
      ageMin: null,
      kev: 0,
      bySeverity: {},
      products: 0,
      bytes: 0,
      filePresent,
      says_ar: "مفيش كوربوس — شغّل scripts/ingest-vuln-corpus.mjs (أو الـworkflow) الأول",
    };
  }
  const ageMin = Number.isFinite(Date.parse(idx.at)) ? Math.round((Date.now() - Date.parse(idx.at)) / 60_000) : null;
  return {
    measured: true,
    total: idx.total,
    at: idx.at,
    ageMin,
    kev: idx.kev,
    bySeverity: idx.bySeverity,
    products: idx.products,
    bytes: idx.files.bytes,
    filePresent,
    says_ar: idx.says_ar,
  };
}

/* ── query: product / CVE, streamed so a 300 k-row corpus fits in 300 MB ── */

export interface CorpusQuery {
  product?: string;
  cve?: string;
  minCvss?: number;
  kevOnly?: boolean;
  limit?: number;
  /**
   * نص حر: بيتطابق على id/الوصف/CWE — ده اللي يخلي /cve/db/search وagents
   * يدوروا جوا الخزنة الكاملة (332k+) مش بس باسم منتج.
   */
  text?: string;
  severity?: string;
  /** hard ceiling on rows read, so a lookup can never hang a job */
  maxScan?: number;
}

export async function queryCorpus(q: CorpusQuery): Promise<{ rows: CorpusCve[]; scanned: number; complete: boolean }> {
  const limit = Math.max(1, Math.min(q.limit ?? 20, 200));
  const maxScan = Math.max(1, q.maxScan ?? 400_000);
  const file = corpusFile();
  if (!fs.existsSync(file)) return { rows: [], scanned: 0, complete: false };
  const productNeedle = q.product?.trim().toLowerCase();
  const cveNeedle = q.cve?.trim().toUpperCase();
  const textNeedle = q.text?.trim().toLowerCase();
  const sevNeedle = q.severity?.trim().toLowerCase();
  const rows: CorpusCve[] = [];
  let scanned = 0;
  const stream = fs.createReadStream(file).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      // the ceiling belongs at the top: a corpus scan must stop even when nothing matches
      if (scanned >= maxScan) break;
      scanned += 1;
      let r: CorpusCve;
      try {
        r = JSON.parse(line) as CorpusCve;
      } catch {
        continue;
      }
      const hit =
        (cveNeedle && r.id === cveNeedle) ||
        (productNeedle &&
          r.cpe.some((c) => c.product.toLowerCase() === productNeedle || c.product.toLowerCase().includes(productNeedle))) ||
        (textNeedle &&
          (r.id.toLowerCase().includes(textNeedle) ||
            r.desc.toLowerCase().includes(textNeedle) ||
            r.cwe.some((w) => w.toLowerCase().includes(textNeedle))));
      if (!hit) continue;
      if (sevNeedle && sevNeedle !== "all" && r.sev.toLowerCase() !== sevNeedle) continue;
      if (q.kevOnly && !r.kev) continue;
      if (q.minCvss !== undefined && (r.cvss ?? 0) < q.minCvss) continue;
      rows.push(r);
      if (rows.length >= limit) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return { rows, scanned, complete: rows.length >= limit || scanned < maxScan };
}

/** Write rows as gzipped JSONL + the index next to it. Returns the index. */
export function writeCorpus(
  rows: CorpusCve[],
  opts: { mode?: CorpusIndex["mode"]; sources?: string[]; outDir?: string; merge?: boolean } = {},
): CorpusIndex {
  const dir = opts.outDir ?? corpusDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = opts.outDir ? path.join(dir, "cves.jsonl.gz") : corpusFile();

  let all = rows;
  if (opts.merge && fs.existsSync(target)) {
    // incremental sync: keep what we have, overwrite rows we just refreshed
    const fresh = new Map(rows.map((r) => [r.id, r]));
    const kept: CorpusCve[] = [];
    const existing = fs.readFileSync(target);
    const parsed = zlib.gunzipSync(existing).toString("utf8").split("\n");
    for (const line of parsed) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as CorpusCve;
        if (!fresh.has(r.id)) kept.push(r);
      } catch {
        /* skip a torn line */
      }
    }
    all = [...kept, ...rows];
  }

  const payload = all.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const gz = zlib.gzipSync(Buffer.from(payload, "utf8"), { level: 9 });
  fs.writeFileSync(target, gz);
  const sha256 = sha(gz);
  // Read the cursor BEFORE overwriting the index: buildIndex() derives everything it
  // knows from the rows, so `deepen` is not something it can recompute, and a write
  // that drops it silently restarts the walk at row 0 (see CorpusIndex.deepen).
  const carried = opts.outDir ? null : readIndex()?.deepen;
  const index = buildIndex(all, {
    mode: opts.mode ?? "unknown",
    sources: opts.sources ?? [],
    bytes: gz.length,
    sha256,
  });
  if (carried) index.deepen = carried;
  if (!opts.outDir) fs.writeFileSync(indexFile(), JSON.stringify(index, null, 2));
  return index;
}

function sha(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ── live sources (used by the ingest script, tested with fixtures) ──────── */

export const NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
export const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
export const EPSS_URL = "https://epss.cyentia.com/epss_scores-current.csv.gz";

export interface FetchOpts {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  /** ISO — only CVEs modified at/after this (incremental) */
  lastModStartDate?: string;
  lastModEndDate?: string;
  /** NVD window cannot exceed 120 days */
  startIndex?: number;
  resultsPerPage?: number;
  signal?: AbortSignal;
}

/** One page of NVD. Throws on a non-200 — the caller decides what to do. */
export async function fetchNvdPage(opts: FetchOpts = {}): Promise<{
  rows: CorpusCve[];
  totalResults: number;
  startIndex: number;
  perPage: number;
}> {
  const doFetch = opts.fetchImpl ?? fetch;
  const perPage = Math.min(Math.max(opts.resultsPerPage ?? 2000, 1), 2000);
  const qs = new URLSearchParams({
    resultsPerPage: String(perPage),
    startIndex: String(opts.startIndex ?? 0),
  });
  if (opts.lastModStartDate) qs.set("lastModStartDate", opts.lastModStartDate);
  if (opts.lastModEndDate) qs.set("lastModEndDate", opts.lastModEndDate);
  const res = await doFetch(`${NVD_URL}?${qs.toString()}`, {
    headers: {
      Accept: "application/json",
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    },
    signal: opts.signal ?? AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`NVD HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const vulns = (body["vulnerabilities"] as Array<Record<string, unknown>> | undefined) ?? [];
  const rows: CorpusCve[] = [];
  for (const v of vulns) {
    const cve = (v["cve"] as Record<string, unknown> | undefined) ?? {};
    const row = rowFromNvd(cve);
    if (row) rows.push(row);
  }
  return {
    rows,
    totalResults: Number(body["totalResults"] ?? 0),
    startIndex: Number(body["startIndex"] ?? 0),
    perPage: Number(body["resultsPerPage"] ?? perPage),
  };
}

export async function fetchKev(fetchImpl: typeof fetch = fetch): Promise<Map<string, KevEntry>> {
  const res = await fetchImpl(KEV_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`KEV HTTP ${res.status}`);
  return parseKev(await res.json());
}

export async function fetchEpss(fetchImpl: typeof fetch = fetch): Promise<Map<string, number>> {
  const res = await fetchImpl(EPSS_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`EPSS HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const csv = gz.length > 2 && gz[0] === 0x1f && gz[1] === 0x8b ? zlib.gunzipSync(gz).toString("utf8") : gz.toString("utf8");
  return parseEpss(csv);
}

/* ── provisioning: a fresh deploy must not be an empty corpus ───────────── */

/** Where the CI publishes the corpus (release asset, public, no token needed). */
export function defaultCorpusUrl(): string {
  return (
    process.env.NOVA_CORPUS_URL ||
    "https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/vuln-corpus/cves.jsonl.gz"
  );
}

/**
 * Rebuild the index from the corpus file on disk.
 * Needed whenever the corpus arrives without its index (a manual download, a fresh
 * release asset) — the counts must come from the bytes we actually hold.
 */
export async function rebuildIndex(opts: { mode?: CorpusIndex["mode"] } = {}): Promise<CorpusIndex | null> {
  const file = corpusFile();
  if (!fs.existsSync(file)) return null;
  const rows: CorpusCve[] = [];
  const stream = fs.createReadStream(file).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as CorpusCve);
      } catch {
        /* skip a torn line rather than losing the corpus */
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  const bytes = fs.statSync(file).size;
  const sha256 = sha(fs.readFileSync(file));
  const index = buildIndex(rows, { mode: opts.mode ?? "unknown", sources: ["local file"], bytes, sha256 });
  fs.mkdirSync(path.dirname(indexFile()), { recursive: true });
  fs.writeFileSync(indexFile(), JSON.stringify(index, null, 2));
  return index;
}

export async function provisionCorpus(opts: { url?: string; force?: boolean; minBytes?: number } = {}): Promise<{
  ok: boolean;
  action: "present" | "downloaded" | "skipped" | "failed";
  bytes: number;
  total: number;
  error?: string;
  says_ar: string;
}> {
  const url = opts.url ?? defaultCorpusUrl();
  const st = corpusStatus();
  const file = corpusFile();
  const minBytes = opts.minBytes ?? 1024;
  if (!opts.force && st.filePresent && fs.existsSync(file) && fs.statSync(file).size > minBytes) {
    return {
      ok: true,
      action: "present",
      bytes: fs.statSync(file).size,
      total: st.total,
      says_ar: `الكوربوس موجود على القرص (${st.total} CVE) — مش هننزّل تاني`,
    };
  }
  if (process.env.NOVA_CORPUS_AUTODOWNLOAD === "0") {
    return { ok: false, action: "skipped", bytes: 0, total: st.total, says_ar: "التحميل التلقائي مقفول (NOVA_CORPUS_AUTODOWNLOAD=0)" };
  }
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length <= minBytes) throw new Error(`file too small (${buf.length} bytes) — refusing to install a stub`);
    if (!(buf[0] === 0x1f && buf[1] === 0x8b)) throw new Error("not a gzip payload");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    // Without an index the corpus is unreadable-by-number: download it, and if the
    // release did not carry one, count the rows we just received.
    if (!fs.existsSync(indexFile())) {
      const idxUrl = url.replace(/cves\.jsonl\.gz$/, "vuln-corpus-index.json");
      let gotIndex = false;
      try {
        const idxRes = await fetch(idxUrl, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
        if (idxRes.ok) {
          const idxBuf = Buffer.from(await idxRes.arrayBuffer());
          JSON.parse(idxBuf.toString("utf8"));
          fs.mkdirSync(path.dirname(indexFile()), { recursive: true });
          fs.writeFileSync(indexFile(), idxBuf);
          gotIndex = true;
        }
      } catch {
        gotIndex = false;
      }
      if (!gotIndex) await rebuildIndex({ mode: "unknown" });
    }
    const after = corpusStatus();
    return {
      ok: true,
      action: "downloaded",
      bytes: buf.length,
      total: after.total,
      says_ar: `اتنزّل كوربوس ${(buf.length / 1048576).toFixed(2)} MB — الفهرس بيقول ${after.total} CVE`,
    };
  } catch (err) {
    return {
      ok: false,
      action: "failed",
      bytes: 0,
      total: st.total,
      error: (err as Error).message,
      says_ar: `تحميل الكوربوس فشل (${(err as Error).message}) — البرنامج شغال بس الاستعلام بيرجّع «مفيش بيانات» بصراحة`,
    };
  }
}

/**
 * تخفيف المضيف (`NOVA_CVE_SOURCE=ci`): الـCI (`vuln-corpus.yml` — كل 30 دقيقة على
 * رانرات جيت هاب المجانية) هو اللي بيبني الكوربوس من NVD/KEV/EPSS وبينشره release
 * asset. المكنة الضعيفة (0.4 CPU / ~460MB مقاسين) مش لازم تعيد ده بنفسها كل 5
 * دقايق: بنقرا فهرس المرآة الصغير، ولو مش أجدد من اللي عندنا نرجّع «fresh» — يعني
 * الخطوة المكررة بتكلّف GET واحدة صغيرة بدل 4 مصادر + zlib + كتابة قرص.
 * ولو أجدد: بننزّل بـ`provisionCorpus({force:true})` وبنكتب معاه الفهرس اللي
 * قريناه — لأن provision ما بيلمسش فهرس موجود، وفهرس قديم فوق بايتات جديدة =
 * إحصائيات بتكدب بصمت.
 */
export async function refreshCorpusFromRelease(opts: { url?: string } = {}): Promise<{
  ok: boolean;
  action: "fresh" | "downloaded" | "failed";
  remoteAt?: string;
  localAt?: string;
  total?: number;
  error?: string;
  says_ar: string;
}> {
  const url = opts.url ?? defaultCorpusUrl();
  const idxUrl = url.replace(/cves\.jsonl\.gz$/, "vuln-corpus-index.json");
  const localAt = String(readIndex()?.at || "");
  let idx: CorpusIndex | null = null;
  let remoteAt = "";
  let remoteTotal = 0;
  try {
    const res = await fetch(idxUrl, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    idx = (await res.json()) as CorpusIndex;
    remoteAt = String(idx?.at || "");
    remoteTotal = Number(idx?.total ?? 0);
    if (!remoteAt) throw new Error("فهرس المرآة مفيهوش at");
  } catch (err) {
    return {
      ok: false,
      action: "failed",
      error: (err as Error).message,
      says_ar: `فحص مرآة الكوربوس فشل (${(err as Error).message}) — الكوربوس المحلي باقي في الخدمة`,
    };
  }
  const remoteMs = Date.parse(remoteAt);
  const localMs = Date.parse(localAt);
  const haveCorpus = fs.existsSync(corpusFile()) && fs.statSync(corpusFile()).size > 1024;
  if (haveCorpus && Number.isFinite(remoteMs) && Number.isFinite(localMs) && remoteMs <= localMs) {
    return {
      ok: true,
      action: "fresh",
      remoteAt,
      localAt,
      total: remoteTotal,
      says_ar: `الكوربوس بجدّة المرآة أو أجدد (${localAt}) — مفيش تنزيل`,
    };
  }
  const dl = await provisionCorpus({ url, force: true });
  if (dl.ok && idx) {
    try {
      fs.mkdirSync(path.dirname(indexFile()), { recursive: true });
      fs.writeFileSync(indexFile(), JSON.stringify(idx, null, 2));
    } catch {
      /* القرص ضدنا — rebuildIndex بيلملم الفهرس من البايتات في أول قراية */
    }
  }
  return {
    ok: dl.ok,
    action: dl.ok ? "downloaded" : "failed",
    remoteAt,
    localAt,
    total: dl.total,
    error: dl.error,
    says_ar: dl.says_ar,
  };
}
