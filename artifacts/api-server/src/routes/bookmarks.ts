import { Router, type IRouter } from "express";
import { db, bookmarksTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/bookmarks", async (_req, res, next) => {
  try {
    const rows = await db.select().from(bookmarksTable).orderBy(desc(bookmarksTable.createdAt));
    res.json(
      rows.map((b) => ({
        id: b.id,
        title: b.label,
        kind: b.kind,
        target: b.refId,
        createdAt: b.createdAt.toISOString(),
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.post("/bookmarks", async (req, res, next) => {
  try {
    const { title, kind, target } = req.body as { title: string; kind: string; target: string };
    const [row] = await db
      .insert(bookmarksTable)
      .values({ kind, refId: target, label: title })
      .returning();
    res.json({
      id: row!.id,
      title: row!.label,
      kind: row!.kind,
      target: row!.refId,
      createdAt: row!.createdAt.toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

router.delete("/bookmarks/:bookmarkId", async (req, res, next) => {
  try {
    await db.delete(bookmarksTable).where(eq(bookmarksTable.id, req.params.bookmarkId));
    res.json({ id: req.params.bookmarkId });
  } catch (e) {
    next(e);
  }
});

export default router;
