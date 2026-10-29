import { Router, type IRouter } from "express";
import { db, scheduledJobsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

const toDto = (j: typeof scheduledJobsTable.$inferSelect) => ({
  id: j.id,
  name: j.name,
  cron: j.cron,
  target: j.target,
  enabled: j.enabled,
  nextRunAt: (j.nextRunAt ?? new Date(Date.now() + 3600 * 1000)).toISOString(),
  lastStatus: j.lastStatus,
  createdAt: j.createdAt.toISOString(),
});

router.get("/jobs", async (_req, res, next) => {
  try {
    const rows = await db.select().from(scheduledJobsTable).orderBy(desc(scheduledJobsTable.createdAt));
    res.json(rows.map(toDto));
  } catch (e) {
    next(e);
  }
});

router.post("/jobs", async (req, res, next) => {
  try {
    const { name, cron, target } = req.body as { name: string; cron: string; target: string };
    const [row] = await db
      .insert(scheduledJobsTable)
      .values({ name, cron, target, nextRunAt: new Date(Date.now() + 3600 * 1000) })
      .returning();
    res.json(toDto(row!));
  } catch (e) {
    next(e);
  }
});

router.post("/jobs/:jobId/toggle", async (req, res, next) => {
  try {
    const [existing] = await db
      .select()
      .from(scheduledJobsTable)
      .where(eq(scheduledJobsTable.id, req.params.jobId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const [row] = await db
      .update(scheduledJobsTable)
      .set({ enabled: !existing.enabled })
      .where(eq(scheduledJobsTable.id, req.params.jobId))
      .returning();
    res.json(toDto(row!));
  } catch (e) {
    next(e);
  }
});

export default router;
