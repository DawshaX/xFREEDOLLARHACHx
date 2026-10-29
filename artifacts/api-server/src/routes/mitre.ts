import { Router, type IRouter } from "express";
import { db, mitreTechniquesTable } from "@workspace/db";
import { and, ilike, eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/mitre/techniques", async (req, res, next) => {
  try {
    const tactic = req.query.tactic as string | undefined;
    const search = req.query.search as string | undefined;
    const filters = [];
    if (tactic) filters.push(eq(mitreTechniquesTable.tactic, tactic));
    if (search) filters.push(ilike(mitreTechniquesTable.name, `%${search}%`));
    const rows = await db
      .select()
      .from(mitreTechniquesTable)
      .where(filters.length ? and(...filters) : undefined);
    res.json(
      rows.map((t) => ({
        id: t.techniqueId,
        name: t.name,
        tactic: t.tactic,
        description: t.description,
        platforms: t.platforms,
      })),
    );
  } catch (e) {
    next(e);
  }
});

export default router;
