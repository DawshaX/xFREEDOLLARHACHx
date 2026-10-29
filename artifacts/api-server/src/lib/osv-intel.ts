/**
 * OSV Intel — Google Open Source Vulnerabilities Integration
 * https://osv.dev/docs/
 *
 * مجاني، بدون API key، متخصص في ثغرات المكتبات مفتوحة المصدر.
 */

import { db, cves, botMemory } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const OSV_API = "https://api.osv.dev/v1";

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  severity?: Array<{ type: string; score: string }>;
  published?: string;
  modified?: string;
  aliases?: string[];
  references?: Array<{ url: string; type: string }>;
  affected?: Array<{
    package?: { name: string; ecosystem: string };
    ranges?: Array<{ type: string; events: Array<{ introduced?: string; fixed?: string }> }>;
  }>;
  database_specific?: { severity?: string; cwe_ids?: string[] };
}

function extractCvss(vuln: OsvVuln): number {
  for (const sev of vuln.severity ?? []) {
    if (sev.type === "CVSS_V3" || sev.type === "CVSS_V2") {
      const parts = sev.score.split("/");
      for (const p of parts) {
        const v = parseFloat(p);
        if (!isNaN(v) && v > 0 && v <= 10) return v;
      }
    }
  }
  const label = (vuln.database_specific?.severity ?? "").toUpperCase();
  if (label === "CRITICAL") return 9.5;
  if (label === "HIGH") return 7.5;
  if (label === "MEDIUM") return 5.0;
  if (label === "LOW") return 2.0;
  return 0;
}

function cvssToSeverity(cvss: number): string {
  if (cvss >= 9.0) return "CRITICAL";
  if (cvss >= 7.0) return "HIGH";
  if (cvss >= 4.0) return "MEDIUM";
  if (cvss > 0) return "LOW";
  return "UNKNOWN";
}

async function upsertOsvVuln(vuln: OsvVuln): Promise<boolean> {
  try {
    const cveAlias = (vuln.aliases ?? []).find(a => a.startsWith("CVE-")) ?? vuln.id;
    const existing = await db.select({ id: cves.id }).from(cves).where(eq(cves.id, cveAlias)).limit(1);
    if (existing.length > 0) return false;

    const cvss = extractCvss(vuln);
    const severity = cvssToSeverity(cvss);
    const desc = vuln.details ?? vuln.summary ?? "";
    const affected = vuln.affected?.map(a => a.package?.name).filter(Boolean).join(", ") ?? "";
    const ref = vuln.references?.[0]?.url ?? `https://osv.dev/vulnerability/${vuln.id}`;

    await db.insert(cves).values({
      id: cveAlias,
      description: desc.slice(0, 2000),
      cvss,
      severity,
      publishedAt: new Date(vuln.published ?? Date.now()),
      lastModifiedAt: new Date(vuln.modified ?? Date.now()),
      url: ref,
      source: "OSV",
      affectedProducts: affected,
      cweIds: vuln.database_specific?.cwe_ids,
      collectedAt: new Date(),
    }).onConflictDoNothing();

    return true;
  } catch {
    return false;
  }
}

// ── Query OSV by ecosystem ───────────────────────────────────────────────────

export async function fetchOsvByEcosystem(ecosystem: string, packageName?: string): Promise<number> {
  let added = 0;
  try {
    const body: Record<string, unknown> = {
      ecosystem,
      ...(packageName ? { query: { package: { name: packageName, ecosystem } } } : {}),
    };
    const url = packageName ? `${OSV_API}/query` : `${OSV_API}/vulns?ecosystem=${ecosystem}&page_size=100`;

    let r: Response;
    if (packageName) {
      r = await fetch(`${OSV_API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: { name: packageName, ecosystem } }),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    }

    if (!r.ok) return 0;
    const data = await r.json() as { vulns?: OsvVuln[] };
    for (const vuln of data.vulns ?? []) {
      if (await upsertOsvVuln(vuln)) added++;
    }
  } catch (err) {
    logger.warn({ ecosystem, err }, "OSV fetch failed");
  }
  return added;
}

// ── Batch fetch for major ecosystems ────────────────────────────────────────

export async function runOsvSync(): Promise<number> {
  let total = 0;
  const ecosystems = ["npm", "PyPI", "Go", "Maven", "RubyGems", "NuGet", "Packagist", "Linux"];

  for (const eco of ecosystems) {
    try {
      const added = await fetchOsvByEcosystem(eco);
      if (added > 0) {
        total += added;
        logger.info({ ecosystem: eco, added }, "OSV: synced");
      }
      await new Promise(r => setTimeout(r, 800));
    } catch {
      // continue
    }
  }

  if (total > 0) {
    await db.insert(botMemory).values({
      memoryType: "web_intel",
      key: `osv_sync_${Date.now()}`,
      content: `OSV مزامنة: أضافت ${total} ثغرة جديدة من مكتبات مفتوحة المصدر (npm, PyPI, Go, Maven, ...)`,
      context: "auto OSV sync",
      confidence: 0.9,
      tags: "osv,open-source,auto",
    });
  }

  logger.info({ total }, "OSV sync complete");
  return total;
}

// ── Lookup single CVE on OSV ─────────────────────────────────────────────────

export async function osvLookup(cveId: string): Promise<OsvVuln | null> {
  try {
    const r = await fetch(`${OSV_API}/vulns/${cveId}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json() as OsvVuln;
  } catch {
    return null;
  }
}
