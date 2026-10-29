import { Router, type IRouter } from "express";
import { db, webhooksTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/webhooks", async (_req, res, next) => {
  try {
    const rows = await db.select().from(webhooksTable).orderBy(desc(webhooksTable.createdAt));
    res.json(
      rows.map((w) => ({
        id: w.id,
        platform: w.platform,
        url: w.url,
        event: w.event,
        active: w.active,
        createdAt: w.createdAt.toISOString(),
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.post("/webhooks", async (req, res, next) => {
  try {
    const { platform, url, event } = req.body as { platform: string; url: string; event: string };
    const [row] = await db.insert(webhooksTable).values({ platform, url, event }).returning();
    res.json({
      id: row!.id,
      platform: row!.platform,
      url: row!.url,
      event: row!.event,
      active: row!.active,
      createdAt: row!.createdAt.toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
