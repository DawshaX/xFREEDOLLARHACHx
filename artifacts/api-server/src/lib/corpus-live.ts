/**
 * Server-side view of the real vulnerability corpus.
 * ────────────────────────────────────────────────
 * `artifacts/kali-panel/src/lib/standalone-api.ts` and this package's copy must stay
 * byte-identical (scripts/audit-connections.mjs enforces it), so both files import
 * `./corpus-live` and each package supplies its own implementation of the same
 * small surface. Browser: fetch a generated JSON. Server: read the ingested corpus.
 *
 * Same rule on both sides: no corpus → `null`, never a pretty number.
 */
import fs from "node:fs";
import path from "node:path";
import { corpusStatus, readIndex, corpusDir } from "./ops/vuln-corpus";

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
  /* TEST7 «اجمع الثغرات»: تقدم تغطية قاعدة NVD من كيرسر الـwalk — الحقلان
   * مش موجودين في سناب اللوحة الساكنة فبيفضلوا undefined هناك (صدق). */
  nvdTotal?: number | null;
  coverage?: number | null;
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
  saysAr: "الكوربوس مش مقاس — مفيش كوربوس متنزّل على السيرفر",
};

let snapshot: CorpusLive = NOT_MEASURED;

function refresh(): CorpusLive {
  const st = corpusStatus();
  const idx = readIndex();
  snapshot = st.measured
    ? {
        measured: true,
        at: st.at,
        total: st.total,
        bySeverity: st.bySeverity,
        kev: st.kev,
        epssScored: idx?.epssScored ?? 0,
        products: st.products,
        sources: idx?.sources ?? ["NVD 2.0", "CISA KEV", "EPSS"],
        rows: [],
        saysAr: st.says_ar,
        nvdTotal: st.nvdTotal,
        coverage: st.coverage,
      }
    : { ...NOT_MEASURED, saysAr: st.says_ar };
  return snapshot;
}

export function loadCorpusLive(): Promise<CorpusLive> {
  return Promise.resolve(refresh());
}

export function corpusSnapshot(): CorpusLive {
  return snapshot.measured ? snapshot : refresh();
}

export function onCorpusChange(): () => void {
  return () => undefined; // the server reads on demand; there is nothing to notify
}

export function corpusTotal(): number | null {
  const s = corpusSnapshot();
  return s.measured ? s.total : null;
}

export function corpusLabelAr(): string {
  const t = corpusTotal();
  return t === null ? "غير مقاس" : `${t.toLocaleString("en-US")}+ ثغرة`;
}

export function corpusSeverity(level: "critical" | "high" | "medium" | "low"): number | null {
  const s = corpusSnapshot();
  return s.measured ? (s.bySeverity[level] ?? 0) : null;
}

export function corpusKev(): number | null {
  const s = corpusSnapshot();
  return s.measured ? s.kev : null;
}

export function corpusSaysAr(): string {
  const s = corpusSnapshot();
  return s.measured ? s.saysAr : s.saysAr;
}

/** TEST5 «مركز نتايج حية»: آخر كسب مقاس من تنزيل مرآة الكوربوس.
 * السيرفر يقرأ state/vuln-corpus/last-gain.json (بكتبه provisionCorpus بعد
 * كل تنزيل ناجح) — نسخة اللوحة في التوأم يخليها null لأنها بتاخد الأرقام
 * جاهزة من /api/cve/db/stats. */
export interface CorpusLastGain { at: string; before: number; after: number; gained: number; via: string }

export function corpusLastGain(): CorpusLastGain | null {
  try {
    const file = path.join(corpusDir(), "last-gain.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CorpusLastGain;
    if (typeof raw?.at !== "string" || typeof raw?.gained !== "number") return null;
    return raw;
  } catch {
    return null;
  }
}
