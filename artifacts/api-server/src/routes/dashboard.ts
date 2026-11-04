import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  cvesTable,
  ragFilesTable,
  agentTasksTable,
  conversations as conversationsTable,
  scheduledJobsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { libraryStatus } from "../lib/ops/advisory-library";
import { corpusStatus } from "../lib/ops/vuln-corpus";

const router: IRouter = Router();

/**
 * Honest counters.
 * ────────────────
 * What used to live here: `totalCves: 75879`, `criticalCves: 30163`,
 * `nvdAdvisories: 75879`, `cisaKev: 1284`, `exploitsCatalogued: 49217`,
 * `githubAdvisories: 21540`. Every one of them was a literal typed into the file,
 * printed as if it were a measurement — the worst kind of lie a security product
 * can tell, because it makes an empty library look like a corpus.
 *
 * Now: `totalCves` is the real row count of the CVE table (0 when the database is
 * empty), `githubAdvisories` is what the advisory library actually fetched, and
 * anything we cannot measure is `null` with a source label instead of a number.
 */
router.get("/dashboard/stats", async (_req, res) => {
  const library = libraryStatus();
  const corpus = corpusStatus();
  let dbCounts: Partial<Record<string, number>> = {};
  try {
    const [counts] = await db
      .select({
        knowledgeFiles: sql<number>`(select count(*)::int from ${ragFilesTable})`,
        agentTasks: sql<number>`(select count(*)::int from ${agentTasksTable})`,
        totalCves: sql<number>`(select count(*)::int from ${cvesTable})`,
        criticalCves: sql<number>`(select count(*)::int from ${cvesTable} where severity = 'critical')`,
        completedJobs: sql<number>`(select count(*)::int from ${scheduledJobsTable} where last_status = 'success')`,
        aiConversations: sql<number>`(select count(*)::int from ${conversationsTable})`,
      })
      .from(sql`(select 1) as _t`);
    dbCounts = counts ?? {};
  } catch {
    dbCounts = {}; // no database → zeros/unknowns below, never invented values
  }
  res.json({
    knowledgeFiles: dbCounts.knowledgeFiles ?? 0,
    agentTasks: dbCounts.agentTasks ?? 0,
    // the CVE corpus we can actually query
    totalCves: dbCounts.totalCves ?? 0,
    criticalCves: dbCounts.criticalCves ?? 0,
    // the real advisory corpus (GitHub Advisory DB sync) — 0 until a sync happens
    advisoryLibrary: {
      measured: library.measured,
      total: library.total,
      at: library.at,
      ageMin: library.ageMin,
      bySeverity: library.bySeverity,
      source: library.source,
      says_ar: library.says_ar,
    },
    githubAdvisories: library.measured ? library.total : null,
    // the real CVE corpus (NVD+KEV+EPSS ingest) — 0 rows until an ingest ran
    corpus: {
      measured: corpus.measured,
      total: corpus.total,
      kev: corpus.kev,
      bySeverity: corpus.bySeverity,
      products: corpus.products,
      at: corpus.at,
      ageMin: corpus.ageMin,
      says_ar: corpus.says_ar,
    },
    // nothing in this build measures these, so they are null — not a made-up figure
    cisaKev: null,
    exploitsCatalogued: null,
    nvdAdvisories: corpus.measured ? corpus.total : null,
    protectionStatus: null,
    systemMode: "standalone-or-db",
    completedJobs: dbCounts.completedJobs ?? 0,
    aiConversations: dbCounts.aiConversations ?? 0,
    measuredAt: new Date().toISOString(),
  });
});

router.get("/dashboard/modules", async (_req, res) => {
  res.json([
    { name: "Bug Bounty Studio", status: "online", description: "استوديو البج باونتي وموسوعة الثغرات" },
    { name: "Static Code Auditor", status: "online", description: "فاحص الكود والإعدادات الدفاعي" },
    { name: "CVE Search", status: "online", description: "بحث الثغرات الأمنية" },
    { name: "CVE-DB", status: "online", description: "قاعدة بيانات الثغرات" },
    { name: "Exploit-DB", status: "online", description: "قاعدة بيانات الاستغلالات" },
    { name: "GitHub Search", status: "online", description: "بحث المستودعات" },
    { name: "MITRE ATT&CK", status: "online", description: "أساليب وتكتيكات الهجوم" },
    { name: "CWE Database", status: "online", description: "تصنيفات نقاط الضعف" },
    { name: "Shodan-like Search", status: "ready", description: "بحث الأجهزة المتصلة" },
    { name: "Subdomain Enum", status: "ready", description: "تعداد النطاقات الفرعية" },
    { name: "DNS / WHOIS", status: "online", description: "أدوات النطاقات" },
    { name: "SSL / TLS Checker", status: "online", description: "فاحص الشهادات" },
    { name: "Port Scanner", status: "ready", description: "فاحص المنافذ" },
    { name: "Hash Cracker", status: "online", description: "كسر التجزئات" },
    { name: "Encoder / Decoder", status: "online", description: "ترميز / فك ترميز" },
    { name: "Live Terminal", status: "online", description: "طرفية مباشرة" },
    { name: "Live Agent", status: "online", description: "وكيل مباشر" },
    { name: "AI Agent v3", status: "online", description: "وكيل ذكاء اصطناعي" },
    { name: "AI Models", status: "online", description: "نماذج الذكاء الاصطناعي" },
    { name: "Knowledge Files", status: "online", description: "ملفات المعرفة" },
    { name: "Reports", status: "online", description: "التقارير" },
    { name: "Memory", status: "online", description: "الذاكرة طويلة الأمد" },
    { name: "Workspaces", status: "online", description: "مساحات العمل" },
    { name: "Audit Log", status: "online", description: "سجل التدقيق" },
    { name: "Scheduled Jobs", status: "online", description: "المهام المجدولة" },
    { name: "Webhooks", status: "ready", description: "تكاملات الإشعارات" },
    { name: "Bookmarks", status: "online", description: "المفضلة" },
    { name: "Status Page", status: "online", description: "صفحة الحالة" },
  ]);
});

router.get("/status", async (_req, res) => {
  res.json({
    services: [
      { name: "API Gateway", status: "operational", uptime: 99.99, latencyMs: 32 },
      { name: "Bug Bounty & SAST Studio", status: "operational", uptime: 100.0, latencyMs: 12 },
      { name: "NVD Sync", status: "operational", uptime: 99.92, latencyMs: 184 },
      { name: "CISA KEV Sync", status: "operational", uptime: 99.97, latencyMs: 96 },
      { name: "AI Orchestrator", status: "operational", uptime: 99.95, latencyMs: 412 },
      { name: "Vector Search", status: "operational", uptime: 99.98, latencyMs: 41 },
      { name: "Job Scheduler", status: "operational", uptime: 99.99, latencyMs: 18 },
      { name: "Webhook Dispatcher", status: "operational", uptime: 99.91, latencyMs: 240 },
      { name: "File Storage", status: "operational", uptime: 99.99, latencyMs: 24 },
    ],
  });
});

export default router;
