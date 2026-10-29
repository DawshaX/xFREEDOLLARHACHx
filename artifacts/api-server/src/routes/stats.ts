import { Router, type IRouter } from "express";
import { count, eq } from "drizzle-orm";
import { db, agentTasks, files, conversations, cves } from "@workspace/db";

const router: IRouter = Router();

router.get("/stats/dashboard", async (_req, res) => {
  const [taskTotal] = await db.select({ c: count() }).from(agentTasks);
  const [taskDone]  = await db.select({ c: count() }).from(agentTasks).where(eq(agentTasks.status, "completed"));
  const [fileTotal] = await db.select({ c: count() }).from(files);
  const [convTotal] = await db.select({ c: count() }).from(conversations);

  const [critRow] = await db.select({ c: count() }).from(cves).where(eq(cves.severity, "CRITICAL"));
  const [highRow] = await db.select({ c: count() }).from(cves).where(eq(cves.severity, "HIGH"));

  res.json({
    criticalCves:   Number(critRow?.c ?? 0),
    highCves:       Number(highRow?.c ?? 0),
    totalScans:     Number(taskTotal.c) + Number(fileTotal.c),
    agentTasks:     Number(taskTotal.c),
    completedTasks: Number(taskDone.c),
    filesStored:    Number(fileTotal.c),
    conversations:  Number(convTotal.c),
  });
});

export default router;
