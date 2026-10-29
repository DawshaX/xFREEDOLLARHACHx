/**
 * Nova Risk Engine — محرك المخاطر الديناميكي
 *
 * يحسب أولوية كل ثغرة بناءً على:
 *  • CVSS score         → وزن 35%
 *  • EPSS score         → وزن 25%
 *  • موجودة في CISA KEV → +20 نقطة
 *  • لها exploit عام    → +12 نقطة
 *  • لها PoC على GitHub → +8 نقطة
 *  • تأثر على Assets    → +0-10 نقطة
 */

import { db, cves, riskScores, assets, botMemory } from "@workspace/db";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { logger } from "./logger";

// ── Risk Formula ─────────────────────────────────────────────────────────────

function computeRiskScore(params: {
  cvss: number;
  epss: number;
  isInKev: boolean;
  hasPublicExploit: boolean;
  hasPoc: boolean;
  affectedAssets: number;
}): { score: number; label: string } {
  let score = 0;
  score += (params.cvss / 10) * 35;
  score += Math.min(params.epss * 25, 25);
  if (params.isInKev) score += 20;
  if (params.hasPublicExploit) score += 12;
  if (params.hasPoc) score += 8;
  score += Math.min(params.affectedAssets * 2, 10);
  score = Math.min(Math.round(score), 100);

  let label: string;
  if (score >= 80) label = "CRITICAL";
  else if (score >= 60) label = "HIGH";
  else if (score >= 40) label = "MEDIUM";
  else label = "LOW";

  return { score, label };
}

// ── CISA KEV list cache ──────────────────────────────────────────────────────

let kevSet: Set<string> = new Set();
let kevFetchedAt = 0;

async function refreshKevSet(): Promise<void> {
  if (Date.now() - kevFetchedAt < 30 * 60_000) return;
  try {
    const r = await fetch("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", {
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return;
    const data = await r.json() as { vulnerabilities?: Array<{ cveID: string }> };
    kevSet = new Set((data.vulnerabilities ?? []).map(v => v.cveID));
    kevFetchedAt = Date.now();
    logger.info({ total: kevSet.size }, "Risk Engine: KEV set refreshed");
  } catch {
    // use stale
  }
}

// ── Asset Match ──────────────────────────────────────────────────────────────

async function findAffectedAssets(cveDescription: string, techStack: string[]): Promise<string[]> {
  const allAssets = await db.select({ id: assets.id, techStack: assets.techStack }).from(assets).where(eq(assets.isActive, true));
  const lower = cveDescription.toLowerCase();
  const matched: string[] = [];
  for (const asset of allAssets) {
    const stack = (asset.techStack as string[]) ?? [];
    if (stack.some(t => lower.includes(t.toLowerCase()))) {
      matched.push(asset.id);
    }
  }
  // Also check passed techStack
  for (const asset of allAssets) {
    const stack = (asset.techStack as string[]) ?? [];
    if (techStack.some(t => stack.some(s => s.toLowerCase().includes(t.toLowerCase())))) {
      if (!matched.includes(asset.id)) matched.push(asset.id);
    }
  }
  return matched;
}

// ── Main Scoring Function ────────────────────────────────────────────────────

export async function scoreOneCve(cveId: string): Promise<void> {
  const [cve] = await db.select().from(cves).where(eq(cves.id, cveId)).limit(1);
  if (!cve) return;

  await refreshKevSet();

  const epss = (cve.epssScore as unknown as number) ?? 0;
  const isInKev = kevSet.has(cveId);
  const hasPoc = !!cve.pocUrl;
  const hasPublicExploit = cve.source === "ExploitDB" || hasPoc ||
    (cve.exploitType !== "other" && cve.exploitType !== null && cve.exploitType !== "");

  const desc_ = cve.description ?? "";
  const affectedAssets = await findAffectedAssets(desc_, []);
  const { score, label } = computeRiskScore({
    cvss: cve.cvss ?? 0,
    epss,
    isInKev,
    hasPublicExploit,
    hasPoc,
    affectedAssets: affectedAssets.length,
  });

  await db.insert(riskScores).values({
    cveId,
    cvss: cve.cvss ?? 0,
    epssScore: epss,
    isInKev,
    hasPublicExploit,
    hasPoc,
    affectedAssets,
    riskScore: score,
    riskLabel: label,
  }).onConflictDoUpdate({
    target: riskScores.cveId,
    set: {
      cvss: cve.cvss ?? 0,
      epssScore: epss,
      isInKev,
      hasPublicExploit,
      hasPoc,
      affectedAssets,
      riskScore: score,
      riskLabel: label,
      lastUpdated: new Date(),
    },
  });
}

export async function scoreTopCves(limit = 500): Promise<number> {
  await refreshKevSet();
  const topCves = await db.select({ id: cves.id, cvss: cves.cvss, epssScore: cves.epssScore, source: cves.source, pocUrl: cves.pocUrl, description: cves.description, exploitType: cves.exploitType })
    .from(cves)
    .orderBy(desc(cves.cvss))
    .limit(limit);

  let scored = 0;
  for (const cve of topCves) {
    const epss = (cve.epssScore as unknown as number) ?? 0;
    const isInKev = kevSet.has(cve.id);
    const hasPoc = !!cve.pocUrl;
    const hasPublicExploit = cve.source === "ExploitDB" || hasPoc || (!!cve.exploitType && cve.exploitType !== "other");
    const affectedAssets = await findAffectedAssets(cve.description ?? "", []);
    const { score, label } = computeRiskScore({ cvss: cve.cvss ?? 0, epss, isInKev, hasPublicExploit, hasPoc, affectedAssets: affectedAssets.length });

    await db.insert(riskScores).values({ cveId: cve.id, cvss: cve.cvss ?? 0, epssScore: epss, isInKev, hasPublicExploit, hasPoc, affectedAssets, riskScore: score, riskLabel: label })
      .onConflictDoUpdate({ target: riskScores.cveId, set: { riskScore: score, riskLabel: label, isInKev, hasPublicExploit, hasPoc, affectedAssets, lastUpdated: new Date() } });
    scored++;
  }

  logger.info({ scored }, "Risk Engine: scoring batch complete");
  return scored;
}

export async function getRiskStats() {
  const byLabel = await db
    .select({ riskLabel: riskScores.riskLabel, count: sql<number>`count(*)::int` })
    .from(riskScores)
    .groupBy(riskScores.riskLabel);

  const inKev = await db.select({ c: sql<number>`count(*)::int` }).from(riskScores).where(eq(riskScores.isInKev, true));
  const withExploit = await db.select({ c: sql<number>`count(*)::int` }).from(riskScores).where(eq(riskScores.hasPublicExploit, true));
  const topRisk = await db.select().from(riskScores).orderBy(desc(riskScores.riskScore)).limit(10);

  return { byLabel, inKev: inKev[0]?.c ?? 0, withExploit: withExploit[0]?.c ?? 0, topRisk };
}
