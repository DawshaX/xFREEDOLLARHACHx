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

/**
 * /stats — الرقم الكبير اللي أي شاشة ملخّص بتقراه (كان في عقد الـAPI ومالوش
 * راوت على السيرفر الحقيقي: 404 مقاسة 2026-11-17، و`/stats/dashboard` بس كانت
 * موجودة). بترجّع نفس أرقام /stats/dashboard على المستوى الأعلى + العدّادات
 * اللي الداشبورد بيستخدمها. أي مصدر مش مقاس بيرجع `null` — مش صفر كذّاب.
 */
router.get("/stats", async (_req, res) => {
  const q = async (fn: () => Promise<{ c: unknown }[] | undefined>) => {
    try {
      const rows = await fn();
      return Number((rows?.[0] as { c?: unknown })?.c ?? 0);
    } catch {
      return null; // مفيش قاعدة بيانات (standalone) → null مش 0
    }
  };
  const [taskTotal, taskDone, fileTotal, convTotal, critRow, highRow] = await Promise.all([
    q(() => db.select({ c: count() }).from(agentTasks)),
    q(() => db.select({ c: count() }).from(agentTasks).where(eq(agentTasks.status, "completed"))),
    q(() => db.select({ c: count() }).from(files)),
    q(() => db.select({ c: count() }).from(conversations)),
    q(() => db.select({ c: count() }).from(cves).where(eq(cves.severity, "CRITICAL"))),
    q(() => db.select({ c: count() }).from(cves).where(eq(cves.severity, "HIGH"))),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    criticalCves: critRow,
    highCves: highRow,
    totalScans: taskTotal === null || fileTotal === null ? null : taskTotal + fileTotal,
    agentTasks: taskTotal,
    completedTasks: taskDone,
    filesStored: fileTotal,
    conversations: convTotal,
    database: taskTotal === null ? "absent (standalone mode)" : "connected",
    measuredAt: new Date().toISOString(),
  });
});

export default router;
