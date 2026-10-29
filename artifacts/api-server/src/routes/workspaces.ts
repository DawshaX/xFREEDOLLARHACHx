import { Router, type IRouter } from "express";
import { db, workspacesTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/workspaces", async (_req, res, next) => {
  try {
    const rows = await db.select().from(workspacesTable).orderBy(desc(workspacesTable.createdAt));
    res.json(
      rows.map((w) => ({
        id: w.id,
        name: w.name,
        color: w.color,
        active: w.active,
        createdAt: w.createdAt.toISOString(),
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.post("/workspaces", async (req, res, next) => {
  try {
    const { name, color } = req.body as { name: string; color: string };
    const [row] = await db.insert(workspacesTable).values({ name, color }).returning();
    res.json({
      id: row!.id,
      name: row!.name,
      color: row!.color,
      active: row!.active,
      createdAt: row!.createdAt.toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
