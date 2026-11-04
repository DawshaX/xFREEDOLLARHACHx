/**
 * The panel's view of the real vulnerability corpus.
 * ─────────────────────────────────────────────────
 * Before this file the panel printed a hand-written galaxy — `total: 76680`,
 * `critical: 12140`, `high: 27430`, `medium: 25620`, `low: 11490`, `inKev: 1480`
 * — which adds up to 76,680 and describes nothing at all. The numbers came from
 * `scripts/make-panel-corpus.mjs` never running, and from constants typed by hand.
 *
 * Rule here: the panel shows **only** what `state/vuln-corpus-live.json` says.
 * When that file is missing (or says `measured: false`), every consumer displays
 * "غير مقاس" instead of a number. A dashboard that cannot be wrong is worth more
 * than one that always looks impressive.
 */
export interface CorpusRow {
  id: string;
  cvss: number | null;
  sev: string;
  desc: string;
  cwe: string[];
  kev: boolean;
  epss: number | null;
  pub: string | null;
  products: string[];
  refs: string[];
}

export interface CorpusLive {
  measured: boolean;
  at: string | null;
  total: number;
  bySeverity: Record<string, number>;
  kev: number;
  epssScored: number;
  products: number;
  sources: string[];
  rows: CorpusRow[];
  saysAr: string;
}

const NOT_MEASURED: CorpusLive = {
  measured: false,
  at: null,
  total: 0,
  bySeverity: {},
  kev: 0,
  epssScored: 0,
  products: 0,
  sources: [],
  rows: [],
  saysAr: "الكوربوس مش مقاس — مفيش ملف بيانات حقيقي على القرص",
};

let snapshot: CorpusLive = NOT_MEASURED;
let loading: Promise<CorpusLive> | null = null;
const listeners = new Set<(c: CorpusLive) => void>();

function basePath(): string {
  // Vite injects the site base; the panel is served from a sub-path on Pages.
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return b.endsWith("/") ? b : `${b}/`;
}

function normalize(raw: unknown): CorpusLive {
  const r = (raw ?? {}) as Record<string, unknown>;
  const total = Number(r["total"] ?? 0);
  if (!Number.isFinite(total) || total <= 0 || r["measured"] === false) {
    return { ...NOT_MEASURED, saysAr: String(r["says_ar"] ?? NOT_MEASURED.saysAr) };
  }
  return {
    measured: true,
    at: r["at"] ? String(r["at"]) : null,
    total,
    bySeverity: (r["bySeverity"] as Record<string, number>) ?? {},
    kev: Number(r["kev"] ?? 0),
    epssScored: Number(r["epssScored"] ?? 0),
    products: Number(r["products"] ?? 0),
    sources: (r["sources"] as string[]) ?? [],
    rows: ((r["rows"] as CorpusRow[]) ?? []).slice(0, 2000),
    saysAr: String(r["says_ar"] ?? ""),
  };
}

/** Load once; every later call returns the cached snapshot (and notifies listeners). */
export function loadCorpusLive(force = false): Promise<CorpusLive> {
  if (!force && loading) return loading;
  loading = fetch(`${basePath()}state/vuln-corpus-live.json?t=${Date.now()}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      snapshot = normalize(j);
      for (const fn of listeners) fn(snapshot);
      return snapshot;
    })
    .catch(() => {
      snapshot = NOT_MEASURED;
      return snapshot;
    });
  return loading;
}

export function corpusSnapshot(): CorpusLive {
  return snapshot;
}

export function onCorpusChange(fn: (c: CorpusLive) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Total, or null when nothing was measured — never a pretty placeholder. */
export function corpusTotal(): number | null {
  return snapshot.measured ? snapshot.total : null;
}

export function corpusLabelAr(): string {
  return snapshot.measured ? `${snapshot.total.toLocaleString("en-US")}+ ثغرة` : "غير مقاس";
}

export function corpusSeverity(level: "critical" | "high" | "medium" | "low"): number | null {
  if (!snapshot.measured) return null;
  return snapshot.bySeverity[level] ?? 0;
}

export function corpusKev(): number | null {
  return snapshot.measured ? snapshot.kev : null;
}

/** Human sentence for banners: what we have, when we got it, from where. */
export function corpusSaysAr(): string {
  if (!snapshot.measured) return snapshot.saysAr;
  const age = snapshot.at ? Math.round((Date.now() - Date.parse(snapshot.at)) / 60_000) : null;
  const when = age == null ? "" : age < 60 ? ` · قبل ${age} دقيقة` : ` · قبل ${Math.round(age / 60)} ساعة`;
  return `${snapshot.total.toLocaleString("en-US")} ثغرة حقيقية (KEV ${snapshot.kev}) · ${snapshot.sources.join(" + ")}${when}`;
}
