/**
 * Nova Learner — محرك التعلم الذاتي لـ CyberNova
 *
 * يحلل الثغرات الجديدة، يكتشف الأنماط، يدمج الذاكرة،
 * ويخزن المعرفة المكتسبة تلقائياً في قاعدة البيانات.
 */

import { desc, eq, gte, sql } from "drizzle-orm";
import { db, cves, botMemory, botAlerts, knowledgeTable } from "@workspace/db";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LearningResult {
  patternsFound: number;
  memoriesStored: number;
  insightsGenerated: number;
  errors: string[];
}

export interface GithubFinding {
  cveId: string;
  repoUrl: string;
  repoName: string;
  description: string;
  stars: number;
  language: string;
  topics: string[];
  storedAt: Date;
}

// ── CVE Pattern Learner ───────────────────────────────────────────────────────

const PATTERN_KEYWORDS: Record<string, string[]> = {
  "rce": ["remote code execution", "rce", "arbitrary code", "code execution", "command injection"],
  "sqli": ["sql injection", "sqli", "database injection", "sqlite injection"],
  "xss": ["cross-site scripting", "xss", "stored xss", "reflected xss"],
  "auth_bypass": ["authentication bypass", "auth bypass", "unauthenticated", "missing authentication"],
  "privilege_escalation": ["privilege escalation", "privesc", "local privilege", "elevation of privilege"],
  "path_traversal": ["path traversal", "directory traversal", "../", "file inclusion"],
  "ssrf": ["server-side request forgery", "ssrf", "internal network"],
  "deserialization": ["deserialization", "deserialize", "object injection"],
  "buffer_overflow": ["buffer overflow", "stack overflow", "heap overflow", "use-after-free"],
  "xxe": ["xml external entity", "xxe", "external entity"],
};

function detectPatterns(description: string): string[] {
  const lower = description.toLowerCase();
  return Object.entries(PATTERN_KEYWORDS)
    .filter(([, keywords]) => keywords.some(k => lower.includes(k)))
    .map(([pattern]) => pattern);
}

function extractAffectedProduct(description: string, cveId: string): string {
  const m = description.match(/(?:in|for|within|affecting)\s+([A-Z][a-zA-Z0-9\s\-_.]{2,40}?)(?:\s+(?:before|prior|through|version|v\d))/);
  if (m) return m[1].trim();
  const known = ["Apache", "Microsoft", "WordPress", "VMware", "Cisco", "FortiNet", "Ivanti", "GitLab", "GitHub", "Linux", "Windows", "Chrome", "Firefox", "OpenSSL", "Nginx", "Node.js"];
  const found = known.find(k => description.includes(k));
  if (found) return found;
  return cveId.split("-")[0] + "-product";
}

// ── Main Learning Functions ───────────────────────────────────────────────────

export async function learnFromRecentCves(hoursBack = 48): Promise<LearningResult> {
  const result: LearningResult = { patternsFound: 0, memoriesStored: 0, insightsGenerated: 0, errors: [] };
  const since = new Date(Date.now() - hoursBack * 3600_000);

  try {
    const recent = await db.select({
      id: cves.id,
      description: cves.description,
      severity: cves.severity,
      cvss: cves.cvss,
      source: cves.source,
      exploitType: cves.exploitType,
      affectedProducts: cves.affectedProducts,
    }).from(cves)
      .where(gte(cves.collectedAt, since))
      .orderBy(desc(cves.cvss))
      .limit(200);

    if (!recent.length) return result;

    const patternCounts: Record<string, number> = {};
    const productCounts: Record<string, number> = {};
    const severityCounts: Record<string, number> = {};
    const criticalCves: string[] = [];

    for (const cve of recent) {
      const desc_ = cve.description ?? "";
      const patterns = detectPatterns(desc_);

      for (const p of patterns) {
        patternCounts[p] = (patternCounts[p] ?? 0) + 1;
        result.patternsFound++;
      }

      const product = cve.affectedProducts ?? extractAffectedProduct(desc_, cve.id);
      if (product) productCounts[product] = (productCounts[product] ?? 0) + 1;

      const sev = cve.severity ?? "UNKNOWN";
      severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;

      if ((cve.cvss ?? 0) >= 9.0) criticalCves.push(cve.id);
    }

    // Store pattern insight
    const topPatterns = Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p, c]) => `${p}: ${c}`)
      .join(", ");

    await db.insert(botMemory).values({
      memoryType: "cve_pattern",
      key: `cve_patterns_${Date.now()}`,
      content: `تحليل ${recent.length} ثغرة خلال آخر ${hoursBack} ساعة:\n` +
        `• أبرز الأنماط: ${topPatterns}\n` +
        `• توزيع الخطورة: ${Object.entries(severityCounts).map(([s, c]) => `${s}=${c}`).join(", ")}\n` +
        `• أكثر المنتجات تأثراً: ${Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, c]) => `${p}(${c})`).join(", ")}\n` +
        `• ثغرات حرجة (CVSS≥9): ${criticalCves.slice(0, 10).join(", ")}`,
      context: `auto-learning from ${recent.length} CVEs (last ${hoursBack}h)`,
      confidence: 0.9,
      tags: "learning,cve,pattern,auto",
    });
    result.memoriesStored++;

    // Store critical CVE alert if many found
    if (criticalCves.length >= 5) {
      await db.insert(botAlerts).values({
        severity: "critical",
        title: `رصد ${criticalCves.length} ثغرة حرجة جديدة (CVSS≥9)`,
        message: `Nova Learner رصد ${criticalCves.length} ثغرة حرجة في آخر ${hoursBack} ساعة: ${criticalCves.slice(0, 5).join(", ")}...`,
        source: "nova-learner",
      });
    }

    // Store knowledge insight for top attack patterns
    const topPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
    if (topPattern) {
      const [pName, pCount] = topPattern;
      await db.insert(knowledgeTable).values({
        title: `نمط هجوم مرصود: ${pName.toUpperCase()} (${pCount} ثغرة)`,
        category: "threat-intel",
        content: `رصد Nova Learner ${pCount} ثغرة بنمط ${pName} في آخر ${hoursBack} ساعة.\n` +
          `الثغرات الحرجة المرتبطة: ${criticalCves.filter(id => {
            const c = recent.find(r => r.id === id);
            return c && detectPatterns(c.description ?? "").includes(pName);
          }).slice(0, 5).join(", ") || "لا يوجد"}\n` +
          `التوصية: مراجعة الأنظمة المعرضة لهجمات ${pName}.`,
        tags: ["auto-learning", "threat-intel", pName, "cve"],
      });
      result.insightsGenerated++;
    }

    result.memoriesStored++;
    logger.info({ analyzed: recent.length, patterns: result.patternsFound }, "Nova Learner: CVE analysis complete");
  } catch (err) {
    result.errors.push(String(err));
    logger.error({ err }, "Nova Learner: learnFromRecentCves failed");
  }

  return result;
}

// ── Memory Consolidator ───────────────────────────────────────────────────────

export async function consolidateMemory(): Promise<number> {
  let consolidated = 0;
  try {
    // Count memory by type
    const stats = await db
      .select({ memoryType: botMemory.memoryType, count: sql<number>`count(*)::int` })
      .from(botMemory)
      .groupBy(botMemory.memoryType);

    const totalMemories = stats.reduce((s, r) => s + r.count, 0);
    const summary = stats.map(r => `${r.memoryType}: ${r.count}`).join(", ");

    if (totalMemories < 5) return 0;

    // Get recent success patterns to consolidate
    const successes = await db.select()
      .from(botMemory)
      .where(eq(botMemory.memoryType, "success_pattern"))
      .orderBy(desc(botMemory.createdAt))
      .limit(30);

    if (successes.length >= 5) {
      const themes = successes
        .map(s => s.content.slice(0, 200))
        .join("\n---\n");

      await db.insert(botMemory).values({
        memoryType: "consolidated_insight",
        key: `consolidation_${Date.now()}`,
        content: `ملخص موحّد (${successes.length} نتيجة ناجحة):\n` +
          `إجمالي الذاكرة: ${totalMemories} إدخال — ${summary}\n\n` +
          `أبرز نتائج المهام الأخيرة:\n${themes.slice(0, 1500)}`,
        context: "auto-consolidation cycle",
        confidence: 0.85,
        tags: "consolidation,auto,memory",
      });
      consolidated++;
    }

    logger.info({ consolidated, totalMemories }, "Nova Learner: memory consolidation done");
  } catch (err) {
    logger.error({ err }, "Nova Learner: consolidateMemory failed");
  }
  return consolidated;
}

// ── GitHub PoC Hunter ─────────────────────────────────────────────────────────

interface GithubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics: string[];
}

export async function searchGitHubPoC(cveId: string): Promise<GithubFinding[]> {
  const findings: GithubFinding[] = [];
  try {
    const query = encodeURIComponent(`${cveId} exploit poc`);
    const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&per_page=5`;
    const r = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "CyberNova-Intel/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return findings;

    const data = await r.json() as { items?: GithubRepo[] };
    for (const repo of data.items ?? []) {
      if (repo.stargazers_count < 1) continue;
      findings.push({
        cveId,
        repoUrl: repo.html_url,
        repoName: repo.full_name,
        description: repo.description ?? "",
        stars: repo.stargazers_count,
        language: repo.language ?? "unknown",
        topics: repo.topics ?? [],
        storedAt: new Date(),
      });
    }
  } catch (err) {
    logger.warn({ cveId, err }, "GitHub PoC search failed");
  }
  return findings;
}

export async function runGitHubPocHunt(maxCves = 20): Promise<number> {
  let stored = 0;
  try {
    // Get top critical CVEs without PoC stored yet
    const targets = await db.select({ id: cves.id, cvss: cves.cvss })
      .from(cves)
      .where(eq(cves.severity, "CRITICAL"))
      .orderBy(desc(cves.cvss))
      .limit(maxCves);

    for (const target of targets) {
      const findings = await searchGitHubPoC(target.id);
      if (!findings.length) continue;

      // Store each finding as knowledge
      for (const f of findings.slice(0, 2)) {
        await db.insert(knowledgeTable).values({
          title: `[PoC] ${f.cveId} — ${f.repoName}`,
          category: "github-poc",
          content: `CVE: ${f.cveId}\nRepository: ${f.repoUrl}\nDescription: ${f.description}\nStars: ${f.stars}\nLanguage: ${f.language}\nTopics: ${f.topics.join(", ")}`,
          tags: ["github", "poc", "exploit", f.cveId, "auto-collected"],
        }).onConflictDoNothing();
        stored++;
      }

      // Also store in bot memory
      if (findings.length > 0) {
        await db.insert(botMemory).values({
          memoryType: "github_poc",
          key: `poc_${target.id}_${Date.now()}`,
          content: `وجدت ${findings.length} مستودع GitHub يحتوي على PoC لـ ${target.id}:\n` +
            findings.map(f => `• ${f.repoName} (⭐${f.stars}) — ${f.repoUrl}`).join("\n"),
          context: `auto GitHub PoC hunt — CVSS ${target.cvss}`,
          confidence: 0.8,
          tags: "github,poc,auto",
        });
      }

      // Small delay to avoid GitHub rate limiting
      await new Promise(r => setTimeout(r, 1200));
    }

    logger.info({ scanned: targets.length, stored }, "GitHub PoC hunt complete");
  } catch (err) {
    logger.error({ err }, "runGitHubPocHunt failed");
  }
  return stored;
}

// ── Security Blog Crawler ─────────────────────────────────────────────────────

interface BlogFinding {
  source: string;
  title: string;
  url: string;
  snippet: string;
}

const SECURITY_FEEDS = [
  { name: "CISA Advisories", url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json" },
  { name: "NVD Recent", url: "https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=10&noRejected=" },
];

export async function crawlSecurityIntel(): Promise<number> {
  let stored = 0;
  const findings: BlogFinding[] = [];

  // Crawl CISA KEV for recently added exploited CVEs
  try {
    const r = await fetch(SECURITY_FEEDS[0].url, { signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const data = await r.json() as { vulnerabilities?: Array<{ cveID: string; vulnerabilityName: string; shortDescription: string; dateAdded: string }> };
      const recent = (data.vulnerabilities ?? [])
        .filter(v => {
          const d = new Date(v.dateAdded);
          return Date.now() - d.getTime() < 7 * 86400_000;
        })
        .slice(0, 5);

      for (const v of recent) {
        findings.push({
          source: "CISA KEV",
          title: `[CISA KEV] ${v.cveID}: ${v.vulnerabilityName}`,
          url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog`,
          snippet: v.shortDescription ?? "",
        });
      }
    }
  } catch {
    // ignore
  }

  // Store findings to knowledge table
  for (const f of findings) {
    try {
      await db.insert(knowledgeTable).values({
        title: f.title,
        category: "threat-intel",
        content: `المصدر: ${f.source}\nالرابط: ${f.url}\n\n${f.snippet}`,
        tags: ["auto-crawled", "threat-intel", f.source.toLowerCase().replace(/\s+/g, "-")],
      }).onConflictDoNothing();
      stored++;
    } catch {
      // skip duplicates
    }
  }

  // Store summary to memory
  if (findings.length > 0) {
    await db.insert(botMemory).values({
      memoryType: "web_intel",
      key: `web_intel_${Date.now()}`,
      content: `مسح استخباراتي: وجدت ${findings.length} تحديث أمني:\n` +
        findings.map(f => `• ${f.title}`).join("\n"),
      context: "auto web intelligence crawl",
      confidence: 0.85,
      tags: "web-intel,auto,crawl",
    });
  }

  logger.info({ stored, findings: findings.length }, "Security intel crawl complete");
  return stored;
}

// ── CVE Deep Classifier ───────────────────────────────────────────────────────

export async function deepClassifyCves(limit = 100): Promise<number> {
  let updated = 0;
  try {
    const unclassified = await db.select({ id: cves.id, description: cves.description })
      .from(cves)
      .where(eq(cves.exploitType, "other"))
      .limit(limit);

    for (const c of unclassified) {
      const patterns = detectPatterns(c.description ?? "");
      if (patterns.length > 0) {
        await db.update(cves)
          .set({ exploitType: patterns[0] })
          .where(eq(cves.id, c.id));
        updated++;
      }
    }
    logger.info({ updated }, "Deep CVE classification done");
  } catch (err) {
    logger.error({ err }, "deepClassifyCves failed");
  }
  return updated;
}
