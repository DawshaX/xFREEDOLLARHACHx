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
    // «إجمالي CVEs» = المخزن الكامل (الكوربوس) مش صفوف الجدول المتزامن لوحده —
    // كان بيعرض 39,815 والحقيقة 332,347.
    totalCves: corpus.measured ? Math.max(dbCounts.totalCves ?? 0, corpus.total) : (dbCounts.totalCves ?? 0),
    criticalCves: corpus.measured
      ? Math.max(dbCounts.criticalCves ?? 0, corpus.bySeverity["critical"] ?? 0)
      : (dbCounts.criticalCves ?? 0),
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

/*
 * الحالة دي كانت راجعة تمانية سطور «operational / 99.99% / 32ms» مكتوبة حرفيًا
 * في الكود — أي حد يفتح `/api/dashboard/status` بيطلع مطمن على خدمات ما اتجرّبش
 * ولا واحد منها. النسخة دي بتقيس اللي يمكن قياسه فعلًا:
 *   • API Gateway: طلب حقيقي على /healthz بنفس العملية، بزمن مقاس.
 *   • NVD Sync / CISA KEV: نضارة الملفات اللي CI بينشرها (state/*.json) + آخر فشل.
 *   • File Storage: المجلد قابل للكتابة؟ (اختبار فعلي، مش افتراض)
 *   • الباقي: «notWired» صريح — مش موجود في النسخة دي، ونقطة.
 * uptime مش محسوب: مافيش سجل تشغيلي، فالرقم «مش مقاس» مش 99.9%.
 */
router.get("/status", async (_req, res) => {
  const fs = await import("node:fs");
  const pathMod = await import("node:path");
  const now = Date.now();
  const readAgeHours = (rel: string): { at: string | null; ageH: number | null; exists: boolean } => {
    try {
      const full = pathMod.resolve(process.cwd(), rel);
      const raw = JSON.parse(fs.readFileSync(full, "utf8")) as { at?: string };
      const at = raw?.at ?? null;
      const ageH = at ? Math.round(((now - Date.parse(at)) / 3_600_000) * 10) / 10 : null;
      return { at, ageH, exists: true };
    } catch {
      return { at: null, ageH: null, exists: false };
    }
  };

  const port = Number(process.env.PORT ?? 3000);
  let gateway: { status: string; latencyMs: number | null; note: string } = {
    status: "unknown",
    latencyMs: null,
    note: "القياس اتعملش",
  };
  const t0 = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/healthz`, { signal: AbortSignal.timeout(2500) });
    gateway = {
      status: r.ok ? "operational" : "degraded",
      latencyMs: Date.now() - t0,
      note: r.ok ? `HTTP ${r.status}` : `HTTP ${r.status}`,
    };
  } catch (err) {
    gateway = { status: "down", latencyMs: null, note: `مفيش رد على 127.0.0.1:${port} — ${(err as Error).name}` };
  }

  const nvd = readAgeHours("state/vuln-corpus-index.json");
  const kev = readAgeHours("state/advisory-cache.json");
  const nvdFail = readAgeHours("state/corpus-last-failure.json");
  const dirWritable = (() => {
    try {
      const probe = pathMod.resolve(process.cwd(), "state", ".status-probe");
      fs.writeFileSync(probe, "1");
      fs.rmSync(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  })();

  res.json({
    measured: true,
    at: new Date().toISOString(),
    services: [
      { name: "API Gateway", status: gateway.status, uptime: null, latencyMs: gateway.latencyMs, note: gateway.note },
      {
        name: "NVD Sync",
        status: nvd.ageH !== null && nvd.ageH < 24 ? "operational" : nvd.exists ? "stale" : "missing",
        uptime: null,
        latencyMs: null,
        note: nvd.at ? `آخر نشر ${nvd.at}${nvdFail.exists ? " · فيه فشل مسجّل" : ""}` : "مفيش ملف state/vuln-corpus-index.json",
        lastPublishAgeHours: nvd.ageH,
      },
      {
        name: "GitHub Advisories / KEV corpus",
        status: kev.ageH !== null && kev.ageH < 24 ? "operational" : kev.exists ? "stale" : "missing",
        uptime: null,
        latencyMs: null,
        note: kev.at ? `آخر نشر ${kev.at}` : "مفيش ملف state/advisory-cache.json",
        lastPublishAgeHours: kev.ageH,
      },
      { name: "File Storage", status: dirWritable ? "operational" : "degraded", uptime: null, latencyMs: null, note: dirWritable ? "state/ قابل للكتابة" : "state/ مش قابل للكتابة" },
      { name: "Bug Bounty & SAST Studio", status: "notWired", uptime: null, latencyMs: null, note: "مافيش خدمة مستقلة بالاسم ده — كتالوج البرامج بيتقرأ من /api/ops/programs مباشرة" },
      { name: "CISA KEV Sync", status: "notWired", uptime: null, latencyMs: null, note: "التغذية جاية عبر advisory-cache من CI، مش service منفصل" },
      { name: "AI Orchestrator", status: "notWired", uptime: null, latencyMs: null, note: "المجلس الحيّ بيتقاس من /api/council/ping" },
      { name: "Vector Search", status: "notWired", uptime: null, latencyMs: null, note: "البحث المتجهي مش موصول في النسخة دي" },
      { name: "Job Scheduler", status: process.env.NOVA_CRON_ENABLED === "1" ? "operational" : "disabled", uptime: null, latencyMs: null, note: "مبني على NOVA_CRON_ENABLED" },
      { name: "Webhook Dispatcher", status: "notWired", uptime: null, latencyMs: null, note: "مفيش مُرسل شغال في المحرك" },
    ],
  });
});

export default router;
