import { Router, type IRouter } from "express";
import { db, cweTable } from "@workspace/db";
import { ilike } from "drizzle-orm";

const router: IRouter = Router();

router.get("/cwe", async (req, res, next) => {
  try {
    const search = req.query.search as string | undefined;
    const rows = await db
      .select()
      .from(cweTable)
      .where(search ? ilike(cweTable.name, `%${search}%`) : undefined);
    res.json(
      rows.map((c) => ({
        id: c.cweId,
        name: c.name,
        abstraction: c.abstraction,
        description: c.description,
      })),
    );
  } catch (e) {
    next(e);
  }
});

export default router;
