import { Router, type IRouter } from "express";
import { db, auditLogTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/audit", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const rows = await db.select().from(auditLogTable).orderBy(desc(auditLogTable.createdAt)).limit(limit);
    res.json(
      rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        target: r.target ?? "",
        result: r.result,
        detail: r.detail ?? "",
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (e) {
    next(e);
  }
});

export default router;
