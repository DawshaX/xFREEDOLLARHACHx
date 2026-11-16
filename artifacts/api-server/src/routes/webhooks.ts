import { Router, type IRouter } from "express";
import { db, webhooksTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

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

/* TEST46 — عقدة الويب هوكس كاملة: PATCH (تفعيل/إيقاف) وDELETE — كانت الواجهة
 * بتناديهم ومافيش راوتر (بوابة api-freshness لقطتهم 10:20Z). نفس طبقة الDB. */
router.patch("/webhooks/:id", async (req, res, next) => {
  try {
    const id = req.params.id; // UUID — مفتاح نصي
    const { active } = req.body as { active?: boolean };
    const [row] = await db
      .update(webhooksTable)
      .set({ active: Boolean(active) })
      .where(eq(webhooksTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "not found" }); return; }
    res.json({
      id: row.id, platform: row.platform, url: row.url,
      event: row.event, active: row.active, createdAt: row.createdAt.toISOString(),
    });
  } catch (e) { next(e); }
});

router.delete("/webhooks/:id", async (req, res, next) => {
  try {
    const id = req.params.id; // UUID — مفتاح نصي
    const [row] = await db.delete(webhooksTable).where(eq(webhooksTable.id, id)).returning();
    res.json({ ok: Boolean(row), id });
  } catch (e) { next(e); }
});
