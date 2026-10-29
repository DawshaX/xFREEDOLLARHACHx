import { Router, type IRouter } from "express";
import { db, notificationsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/notifications", async (_req, res, next) => {
  try {
    const rows = await db.select().from(notificationsTable).orderBy(desc(notificationsTable.createdAt)).limit(100);
    res.json(
      rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        kind: n.kind,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.post("/notifications/:notificationId/read", async (req, res, next) => {
  try {
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.id, req.params.notificationId));
    res.json({ id: req.params.notificationId });
  } catch (e) {
    next(e);
  }
});

export default router;
