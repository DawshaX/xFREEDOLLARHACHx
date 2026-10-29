import { Router, type IRouter } from "express";
import { db, cvesTable } from "@workspace/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

const router: IRouter = Router();

function categoryFor(score: number) {
  if (score >= 9) return "RCE";
  if (score >= 7.5) return "Privilege Escalation";
  if (score >= 6) return "XSS";
  if (score >= 4) return "Information Disclosure";
  return "Other";
}

function toDto(c: typeof cvesTable.$inferSelect) {
  return {
    id: c.cveId,
    cveId: c.cveId,
    severity: c.severity,
    score: c.cvssScore,
    description: c.description,
    publishedAt: c.publishedAt.toISOString(),
    source: c.source,
    category: categoryFor(c.cvssScore),
  };
}

router.get("/cves", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const severity = req.query.severity as string | undefined;
    const search = req.query.search as string | undefined;

    const filters = [] as ReturnType<typeof eq>[];
    if (severity) filters.push(eq(cvesTable.severity, severity));
    if (search)
      filters.push(
        or(
          ilike(cvesTable.cveId, `%${search}%`),
          ilike(cvesTable.description, `%${search}%`),
        )!,
      );

    const rows = await db
      .select()
      .from(cvesTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(cvesTable.publishedAt))
      .limit(limit);
    res.json(rows.map(toDto));
  } catch (e) {
    next(e);
  }
});

router.get("/cves/critical", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(cvesTable)
      .where(eq(cvesTable.severity, "critical"))
      .orderBy(desc(cvesTable.cvssScore), desc(cvesTable.publishedAt))
      .limit(20);
    res.json(rows.map(toDto));
  } catch (e) {
    next(e);
  }
});

router.get("/cves/recent", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(cvesTable)
      .orderBy(desc(cvesTable.publishedAt))
      .limit(15);
    res.json(rows.map(toDto));
  } catch (e) {
    next(e);
  }
});

router.get("/cves/:cveId", async (req, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(cvesTable)
      .where(eq(cvesTable.cveId, req.params.cveId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(toDto(row));
  } catch (e) {
    next(e);
  }
});

export default router;
