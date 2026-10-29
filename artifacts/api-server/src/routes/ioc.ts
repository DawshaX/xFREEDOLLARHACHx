import { Router } from "express";
import { db, iocTracker } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

const router = Router();

router.get("/ioc", async (req, res) => {
  try {
    const { type, severity, limit: lim } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(lim ?? "100"), 500);
    const conditions = [];
    if (type) conditions.push(eq(iocTracker.iocType, type));
    if (severity) conditions.push(eq(iocTracker.severity, severity));
    conditions.push(eq(iocTracker.isActive, true));

    const rows = await db
      .select()
      .from(iocTracker)
      .where(and(...conditions))
      .orderBy(desc(iocTracker.lastSeen))
      .limit(limit);

    res.json({ iocs: rows, total: rows.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب IOCs" });
  }
});

router.get("/ioc/stats", async (req, res) => {
  try {
    const byType = await db
      .select({ iocType: iocTracker.iocType, count: sql<number>`count(*)::int` })
      .from(iocTracker)
      .where(eq(iocTracker.isActive, true))
      .groupBy(iocTracker.iocType);

    const bySeverity = await db
      .select({ severity: iocTracker.severity, count: sql<number>`count(*)::int` })
      .from(iocTracker)
      .where(eq(iocTracker.isActive, true))
      .groupBy(iocTracker.severity);

    res.json({ byType, bySeverity });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب الإحصائيات" });
  }
});

router.post("/ioc", async (req, res) => {
  try {
    const { iocType, value, source, confidence, severity, description, relatedCves, tags } = req.body as {
      iocType: string; value: string; source?: string; confidence?: number;
      severity?: string; description?: string; relatedCves?: string[]; tags?: string[];
    };
    if (!iocType || !value) return res.status(400).json({ error: "النوع والقيمة مطلوبان" });

    const [created] = await db.insert(iocTracker).values({
      iocType,
      value,
      source: source ?? "manual",
      confidence: confidence ?? 0.8,
      severity: severity ?? "medium",
      description: description ?? "",
      relatedCves: relatedCves ?? [],
      tags: tags ?? [],
    }).returning();

    res.status(201).json({ ioc: created });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل إضافة IOC" });
  }
});

router.patch("/ioc/:id", async (req, res) => {
  try {
    const updates = req.body as Partial<typeof iocTracker.$inferInsert>;
    const [updated] = await db.update(iocTracker)
      .set({ ...updates, lastSeen: new Date() })
      .where(eq(iocTracker.id, req.params.id))
      .returning();
    res.json({ ioc: updated });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل تحديث IOC" });
  }
});

router.delete("/ioc/:id", async (req, res) => {
  try {
    await db.update(iocTracker).set({ isActive: false }).where(eq(iocTracker.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل تعطيل IOC" });
  }
});

router.post("/ioc/seed-from-cves", async (req, res) => {
  try {
    const { cveIds } = req.body as { cveIds?: string[] };
    if (!cveIds?.length) return res.json({ added: 0 });

    let added = 0;
    for (const cveId of cveIds.slice(0, 50)) {
      await db.insert(iocTracker).values({
        iocType: "cve",
        value: cveId,
        source: "nvd",
        confidence: 0.95,
        severity: "high",
        description: `مؤشر اختراق مرتبط بـ ${cveId}`,
        relatedCves: [cveId],
        tags: ["auto-seeded", "cve"],
      }).onConflictDoNothing();
      added++;
    }

    res.json({ added });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل بذر IOCs" });
  }
});

export default router;
