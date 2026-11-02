/**
 * Live-verification report reader.
 * ───────────────────────────────
 * `scripts/verify-live.mjs` (run by `.github/workflows/live-verify.yml`) executes the real
 * toolchain and the real ops spine against hosts whose owners published permission to be
 * scanned, and commits `state/verified-live.json`. This module is the only thing the brain
 * reads to answer «أدواتك شغالة فعلاً؟» — so the answer is a measurement with a timestamp,
 * not a claim about how the code is written.
 *
 * Rules this file exists to enforce:
 *   • Missing report = NOT measured (`unknown`), never `down`. A fresh deploy has no
 *     verification yet, and shouting "broken" about that would train people to ignore it.
 *   • A stale report degrades honestly: `fresh` goes false after `maxAgeH` (default 30 h —
 *     the workflow runs every 6 h, so 30 h means at least one missed run).
 *   • It never invents numbers: whatever the report says is what the organ says.
 */
import fs from "node:fs";
import path from "node:path";

export interface VerifyRow {
  layer: string;
  check: string;
  status: "pass" | "fail" | "blocked" | "review";
  detail?: string;
  at?: string;
  jobId?: string;
}

export interface LiveVerifyReport {
  version: number;
  at: string;
  verdict: "GREEN" | "AMBER" | "RED" | "NO_NETWORK" | "UNSAFE" | string;
  counts: { pass: number; fail: number; blocked: number; review: number };
  meta?: { tools?: string[]; engine?: string; host?: string };
  rows?: VerifyRow[];
}

const FILE = process.env.NOVA_VERIFY_FILE || "state/verified-live.json";
const MAX_AGE_H = Number(process.env.NOVA_VERIFY_MAX_AGE_H || 30);

let cache: { at: number; report: LiveVerifyReport | null } | null = null;
const TTL_MS = 60_000;

/** Reads the committed report, or null when it does not exist / cannot be parsed. */
export function readLiveVerify(): LiveVerifyReport | null {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.report;
  let report: LiveVerifyReport | null = null;
  try {
    const p = path.resolve(process.cwd(), FILE);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      if (raw && typeof raw === "object" && typeof raw.at === "string") report = raw as LiveVerifyReport;
    }
  } catch {
    report = null; // a half-written commit must not break the snapshot
  }
  cache = { at: Date.now(), report };
  return report;
}

export interface LiveVerifyView {
  measured: boolean;
  fresh: boolean;
  ageMin: number | null;
  verdict: string | null;
  counts: LiveVerifyReport["counts"] | null;
  tools: string[];
  failedChecks: string[];
  at: string | null;
}

export function liveVerifyView(report = readLiveVerify()): LiveVerifyView {
  if (!report) {
    return {
      measured: false, fresh: false, ageMin: null, verdict: null, counts: null,
      tools: [], failedChecks: [], at: null,
    };
  }
  const ageMin = Math.round((Date.now() - Date.parse(report.at)) / 60_000);
  return {
    measured: true,
    fresh: Number.isFinite(ageMin) && ageMin < MAX_AGE_H * 60,
    ageMin: Number.isFinite(ageMin) ? ageMin : null,
    verdict: String(report.verdict ?? "UNKNOWN"),
    counts: report.counts ?? null,
    tools: report.meta?.tools ?? [],
    failedChecks: (report.rows ?? []).filter((r) => r.status === "fail").map((r) => `${r.layer}/${r.check}`),
    at: report.at,
  };
}

/** One Arabic sentence the brain can say out loud. Built from the data, never hardcoded. */
export function liveVerifySays(v: LiveVerifyView): string {
  if (!v.measured) return "سلسلة الأدوات ما اتقاستش على أهداف حية لحد دلوقتي — شغّل live-verify";
  const c = v.counts;
  const age = v.ageMin == null ? "" : v.ageMin < 60 ? `من ${v.ageMin} دقيقة` : `من ${Math.round(v.ageMin / 60)} ساعة`;
  if (v.verdict === "UNSAFE") return "⚠ البوابة سايبة فحص نشط على هدف من غير إذن — وقف كل حاجة";
  if (v.verdict === "GREEN") return `مقاس ${age}: ${c?.pass} فحص عدّى على أهداف مسموح بها — الأدوات والسلسلة الكاملة شغالين${v.tools.length ? ` (${v.tools.slice(0, 5).join("·")})` : ""}`;
  if (v.verdict === "RED") return `مقاس ${age}: ${c?.fail} فحص واقع — ${v.failedChecks.slice(0, 3).join(" · ") || "شوف التقرير"}`;
  if (v.verdict === "NO_NETWORK") return `مقاس ${age}: مفيش خروج للإنترنت من هنا — القياس ماحصلش، مش الأدوات بايظة`;
  return `مقاس ${age}: ${c?.pass ?? 0}✓ / ${c?.review ?? 0}؟ — ناطّر مراجعة (${v.failedChecks.slice(0, 2).join(" · ") || "amber"})`;
}
