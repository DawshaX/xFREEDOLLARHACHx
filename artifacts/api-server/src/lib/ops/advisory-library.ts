/**
 * Ops · The advisory library, measured instead of asserted
 * ────────────────────────────────────────────────────────
 * The app used to print `totalCves: 75879`, `githubAdvisories: 21540`,
 * `cisaKev: 1284`, `exploitsCatalogued: 49217` — four hardcoded integers over a
 * 22-row hand-written array. Nothing was behind those numbers, and a security
 * product that inflates its own coverage is worse than one that has none.
 *
 * This module replaces the counters with a real corpus:
 *
 *   • source      GitHub Advisory Database (`GET /api.github.com/advisories`) —
 *                 free, no key, CVE + GHSA + CVSS + CWE + affected packages
 *   • storage     one compact JSON cache, path from NOVA_ADVISORY_CACHE
 *   • truth rule  `measured` is false until a sync really happened; the counts
 *                 are always "what we fetched, when", never "the universe"
 *
 * Nothing here invents a CVE: a row exists only if GitHub returned it, and the
 * `at` timestamp is the moment of the HTTP call.
 */
import fs from "node:fs";
import path from "node:path";

export interface AdvisoryRow {
  id: string; // GHSA-x…
  cve?: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  cvss?: number;
  cwes: string[];
  packages: string[]; // "npm:lodash", "pip:django" …
  published?: string;
  url?: string;
}

export interface AdvisoryCache {
  version: number;
  /** when the HTTP call that produced this cache finished */
  at: string;
  source: string;
  pages: number;
  /** rows actually stored — the only honest number to print */
  total: number;
  bySeverity: Record<string, number>;
  byEcosystem: Record<string, number>;
  /** set when the corpus was filtered (e.g. "high" = critical+high only) */
  filter?: string;
  advisories: AdvisoryRow[];
}

const SEVERITIES = ["critical", "high", "medium", "low", "unknown"] as const;
type Sev = (typeof SEVERITIES)[number];

export function cachePath(): string {
  return (
    process.env.NOVA_ADVISORY_CACHE ||
    path.resolve(process.cwd(), process.env.NOVA_ADVISORY_REL || "state/advisory-cache.json")
  );
}

const EMPTY: AdvisoryCache = {
  version: 1,
  at: "",
  source: "api.github.com/advisories",
  pages: 0,
  total: 0,
  bySeverity: {},
  byEcosystem: {},
  advisories: [],
};

let cache: AdvisoryCache | null = null;
let cacheAt = 0;
const TTL = 60_000;

export function loadAdvisories(force = false): AdvisoryCache {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache;
  let file: AdvisoryCache = { ...EMPTY };
  try {
    const p = cachePath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as AdvisoryCache;
      if (raw && Array.isArray(raw.advisories)) file = { ...EMPTY, ...raw };
    }
  } catch {
    file = { ...EMPTY }; // a half-written cache is not a corpus
  }
  cache = file;
  cacheAt = Date.now();
  return file;
}

/** `Link: <…&after=abc>; rel="next", <…>; rel="last"` → the next URL, or null. */
function nextLink(header: string): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function sevOf(raw: unknown): Sev {
  const s = String(raw ?? "").toLowerCase();
  return (SEVERITIES as readonly string[]).includes(s) ? (s as Sev) : "unknown";
}

function compact(a: Record<string, unknown>): AdvisoryRow | null {
  const id = String(a["ghsa_id"] ?? "");
  if (!id) return null;
  const cvss = (a["cvss"] as Record<string, unknown> | undefined) ?? {};
  const vulns = (a["vulnerabilities"] as Array<Record<string, unknown>> | undefined) ?? [];
  const packages: string[] = [];
  for (const v of vulns) {
    const pkg = (v["package"] as Record<string, unknown> | undefined) ?? {};
    const eco = String(pkg["ecosystem"] ?? "");
    const name = String(pkg["name"] ?? "");
    if (name) packages.push(eco ? `${eco.toLowerCase()}:${name}` : name);
  }
  const cwes = ((a["cwes"] as Array<Record<string, unknown>> | undefined) ?? [])
    .map((c) => String(c["cwe_id"] ?? ""))
    .filter(Boolean);
  const score = Number(cvss["score"]);
  return {
    id,
    cve: a["cve_id"] ? String(a["cve_id"]) : undefined,
    summary: String(a["summary"] ?? "").slice(0, 400),
    severity: sevOf(a["severity"]),
    cvss: Number.isFinite(score) ? score : undefined,
    cwes,
    packages: [...new Set(packages)],
    published: a["published_at"] ? String(a["published_at"]) : undefined,
    url: a["html_url"] ? String(a["html_url"]) : undefined,
  };
}

export interface SyncOpts {
  /** how many pages of 100 to pull (default 10 = up to 1,000 advisories) */
  pages?: number;
  token?: string;
  /** ISO date — only advisories published/updated at or after this */
  since?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Pull pages from the GitHub Advisory Database. No token → 60 requests/hour, so
 * the default is deliberately small; CI passes GITHUB_TOKEN and can go deeper.
 */
export async function syncAdvisories(opts: SyncOpts = {}): Promise<{
  ok: boolean;
  cache: AdvisoryCache;
  error?: string;
  pages_fetched: number;
}> {
  const doFetch = opts.fetchImpl ?? fetch;
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  const pagesWanted = Math.max(1, Math.min(opts.pages ?? 10, 60));
  const rows = new Map<string, AdvisoryRow>();
  let pagesFetched = 0;
  let error: string | undefined;

  // GitHub's advisories endpoint does NOT paginate with `?page=`: passing it is
  // silently ignored and every "page" returns page 1 (measured: page1.first ==
  // page2.first == GHSA-gh9r-c94j-cmp5). It uses cursor pagination — `?after=…`
  // via the `Link: rel="next"` header — which is what we follow below.
  const first = new URLSearchParams({ per_page: "100" });
  if (opts.since) first.set("published", `>=${opts.since}`);
  let nextUrl: string | null = `https://api.github.com/advisories?${first.toString()}`;

  for (let page = 1; page <= pagesWanted && nextUrl; page += 1) {
    const url = nextUrl;
    let res: Response;
    try {
      res = await doFetch(url, {
          headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "CyberNova/advisory-library",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      error = `fetch failed: ${(err as Error).message}`;
      break;
    }
    if (!res.ok) {
      error = `HTTP ${res.status}${res.status === 403 ? " (rate limit — set GITHUB_TOKEN)" : ""}`;
      break;
    }
    const body = (await res.json().catch(() => null)) as Array<Record<string, unknown>> | null;
    if (!Array.isArray(body)) {
      error = "response was not an array";
      break;
    }
    pagesFetched += 1;
    for (const a of body) {
      const row = compact(a);
      if (row) rows.set(row.id, row);
    }
    nextUrl = nextLink(res.headers.get("link") ?? "");
    if (body.length === 0) break;
  }

  // NOVA_ADVISORY_MIN_SEVERITY=high keeps only what a hunter can act on: the cache
  // then fits in the repo/bundle without pretending it is the whole database.
  const floor = String(process.env.NOVA_ADVISORY_MIN_SEVERITY ?? "").toLowerCase();
  const keepSet: Sev[] =
    floor === "high" ? ["high", "critical"] : floor === "critical" ? ["critical"] : [...SEVERITIES];
  const advisories = [...rows.values()].filter((a) => keepSet.includes(a.severity));
  const bySeverity: Record<string, number> = {};
  const byEcosystem: Record<string, number> = {};
  for (const a of advisories) {
    bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    for (const p of a.packages) {
      const eco = p.includes(":") ? p.split(":")[0] : "unscoped";
      byEcosystem[eco] = (byEcosystem[eco] ?? 0) + 1;
    }
  }

  // A failed sync must never wipe a good corpus: keep the old rows, refresh the
  // timestamp only when something actually arrived.
  const previous = loadAdvisories();
  const next: AdvisoryCache =
    advisories.length === 0 && previous.advisories.length > 0
      ? previous
      : {
          version: 1,
          at: new Date().toISOString(),
          source: "api.github.com/advisories",
          pages: pagesFetched,
          total: advisories.length,
          bySeverity,
          byEcosystem,
          filter: floor || undefined,
          advisories,
        };

  if (next !== previous) {
    try {
      const p = cachePath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(next));
    } catch (err) {
      error = `${error ? `${error} · ` : ""}cache write failed: ${(err as Error).message}`;
    }
    cache = next;
    cacheAt = Date.now();
  }

  return { ok: advisories.length > 0 && !error, cache: next, error, pages_fetched: pagesFetched };
}

export interface LibraryStatus {
  /** false until a real sync happened — never a claim, always a measurement */
  measured: boolean;
  total: number;
  at: string | null;
  ageMin: number | null;
  pages: number;
  filter?: string;
  bySeverity: Record<string, number>;
  byEcosystem: Record<string, number>;
  source: string;
  says_ar: string;
}

export function libraryStatus(): LibraryStatus {
  const c = loadAdvisories();
  const measured = c.total > 0 && Boolean(c.at);
  const ageMin = measured ? Math.round((Date.now() - Date.parse(c.at)) / 60_000) : null;
  const crit = c.bySeverity["critical"] ?? 0;
  const high = c.bySeverity["high"] ?? 0;
  return {
    measured,
    total: c.total,
    at: measured ? c.at : null,
    ageMin,
    pages: c.pages,
    filter: c.filter,
    bySeverity: c.bySeverity,
    byEcosystem: c.byEcosystem,
    source: c.source,
    says_ar: measured
      ? `${c.total} إشعار حقيقي في الكاش (critical ${crit} · high ${high}${c.filter ? ` · مفلتر: ${c.filter}+` : ""}) من ${c.source} · آخر مزامنة ${ageMin != null && ageMin < 60 ? `${ageMin} دقيقة` : `${Math.round((ageMin ?? 0) / 60)} ساعة`}`
      : "المكتبة مش متزامنة — الرقم صفر لأن مفيش بيانات، مش لأن مفيش ثغرات. شغّل POST /api/ops/advisories/sync",
  };
}

/* ── lookups used by findings, never to invent one ───────────────────────── */

/** Match a detected product/banner against affected packages and summaries. */
export function lookupProduct(product: string, limit = 10): AdvisoryRow[] {
  const needle = product.trim().toLowerCase().split(/[\s/]/)[0];
  if (needle.length < 3) return [];
  const hits = loadAdvisories().advisories.filter(
    (a) =>
      a.packages.some((p) => p.toLowerCase().split(":").pop() === needle) ||
      a.summary.toLowerCase().includes(needle),
  );
  return hits
    .sort((a, b) => (b.cvss ?? 0) - (a.cvss ?? 0) || String(b.published).localeCompare(String(a.published)))
    .slice(0, limit);
}

export function lookupCve(cveId: string): AdvisoryRow | null {
  const id = cveId.trim().toUpperCase();
  if (!/^CVE-\d{4}-\d{4,}$/.test(id)) return null;
  return loadAdvisories().advisories.find((a) => a.cve?.toUpperCase() === id) ?? null;
}

/** Severity split of what is in the library, for the panel's honest badges. */
export function coverageSummary(): {
  measured: boolean;
  total: number;
  exploitableHint: number;
  says_ar: string;
} {
  const s = libraryStatus();
  const critHigh = (s.bySeverity["critical"] ?? 0) + (s.bySeverity["high"] ?? 0);
  return {
    measured: s.measured,
    total: s.total,
    exploitableHint: critHigh,
    says_ar: s.says_ar,
  };
}
