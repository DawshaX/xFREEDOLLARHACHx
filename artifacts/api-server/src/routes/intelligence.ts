/**
 * Intelligence Routes — واجهة برمجية لمحرك التعلم الذكي
 */

import { Router, type IRouter } from "express";
import { desc, eq, like, sql } from "drizzle-orm";
import { db, botMemory, knowledgeTable, cves, botAlerts } from "@workspace/db";
import {
  learnFromRecentCves,
  consolidateMemory,
  runGitHubPocHunt,
  crawlSecurityIntel,
  deepClassifyCves,
} from "../lib/nova-learner";

const router: IRouter = Router();

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get("/intelligence/stats", async (_req, res) => {
  const [memCount]    = await db.select({ c: sql<number>`count(*)::int` }).from(botMemory);
  const [knowledgeCount] = await db.select({ c: sql<number>`count(*)::int` }).from(knowledgeTable);
  const [pocCount]    = await db.select({ c: sql<number>`count(*)::int` }).from(knowledgeTable).where(eq(knowledgeTable.category, "github-poc"));
  const [threatCount] = await db.select({ c: sql<number>`count(*)::int` }).from(knowledgeTable).where(eq(knowledgeTable.category, "threat-intel"));
  const [patternCount] = await db.select({ c: sql<number>`count(*)::int` }).from(botMemory).where(eq(botMemory.memoryType, "cve_pattern"));
  const [githubCount]  = await db.select({ c: sql<number>`count(*)::int` }).from(botMemory).where(eq(botMemory.memoryType, "github_poc"));
  const [webCount]     = await db.select({ c: sql<number>`count(*)::int` }).from(botMemory).where(eq(botMemory.memoryType, "web_intel"));
  const [cveTotal]     = await db.select({ c: sql<number>`count(*)::int` }).from(cves);

  const memByType = await db
    .select({ memoryType: botMemory.memoryType, count: sql<number>`count(*)::int` })
    .from(botMemory)
    .groupBy(botMemory.memoryType);

  res.json({
    totalMemories:   memCount?.c ?? 0,
    totalKnowledge:  knowledgeCount?.c ?? 0,
    githubPocs:      pocCount?.c ?? 0,
    threatIntel:     threatCount?.c ?? 0,
    cvePatterns:     patternCount?.c ?? 0,
    githubMemories:  githubCount?.c ?? 0,
    webIntelItems:   webCount?.c ?? 0,
    totalCves:       cveTotal?.c ?? 0,
    memoryByType:    memByType,
  });
});

// ── Memory (full list with filters) ──────────────────────────────────────────

router.get("/intelligence/memory", async (req, res) => {
  const { type, q, limit = "50", offset = "0" } = req.query;
  let query = db.select().from(botMemory).$dynamic();
  if (type) query = query.where(eq(botMemory.memoryType, String(type)));
  if (q)    query = query.where(like(botMemory.content, `%${String(q)}%`));

  const rows = await query
    .orderBy(desc(botMemory.createdAt))
    .limit(Math.min(Number(limit), 100))
    .offset(Number(offset));

  res.json(rows);
});

// ── Knowledge (GitHub PoCs + threat intel) ────────────────────────────────────

router.get("/intelligence/knowledge", async (req, res) => {
  const { category, q, limit = "50" } = req.query;
  let query = db.select().from(knowledgeTable).$dynamic();
  if (category) query = query.where(eq(knowledgeTable.category, String(category)));
  if (q) query = query.where(
    sql`(${knowledgeTable.title} ILIKE ${"%" + String(q) + "%"} OR ${knowledgeTable.content} ILIKE ${"%" + String(q) + "%"})`
  );

  const rows = await query
    .orderBy(desc(knowledgeTable.createdAt))
    .limit(Math.min(Number(limit), 100));

  res.json(rows);
});

// ── Trigger Actions ───────────────────────────────────────────────────────────

router.post("/intelligence/learn", async (_req, res) => {
  const start = Date.now();
  const result = await learnFromRecentCves(48);
  res.json({ ...result, durationMs: Date.now() - start });
});

router.post("/intelligence/github-scan", async (_req, res) => {
  const start = Date.now();
  const stored = await runGitHubPocHunt(15);
  res.json({ stored, durationMs: Date.now() - start });
});

router.post("/intelligence/web-crawl", async (_req, res) => {
  const start = Date.now();
  const stored = await crawlSecurityIntel();
  res.json({ stored, durationMs: Date.now() - start });
});

router.post("/intelligence/consolidate", async (_req, res) => {
  const start = Date.now();
  const consolidated = await consolidateMemory();
  res.json({ consolidated, durationMs: Date.now() - start });
});

router.post("/intelligence/classify-cves", async (_req, res) => {
  const start = Date.now();
  const updated = await deepClassifyCves(200);
  res.json({ updated, durationMs: Date.now() - start });
});

// ── Recent Alerts ─────────────────────────────────────────────────────────────

router.get("/intelligence/alerts", async (req, res) => {
  const { limit = "20" } = req.query;
  const rows = await db.select().from(botAlerts)
    .orderBy(desc(botAlerts.createdAt))
    .limit(Math.min(Number(limit), 50));
  res.json(rows);
});

export default router;
