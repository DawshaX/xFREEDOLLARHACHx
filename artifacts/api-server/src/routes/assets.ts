import { Router } from "express";
import { db, assets } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/assets", async (req, res) => {
  try {
    const all = await db.select().from(assets).orderBy(desc(assets.createdAt));
    res.json({ assets: all, total: all.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب الأصول" });
  }
});

router.post("/assets", async (req, res) => {
  try {
    const { name, description, techStack, domains, ips, category, criticality, owner, notes, tags } = req.body as {
      name: string; description?: string; techStack?: string[]; domains?: string[]; ips?: string[];
      category?: string; criticality?: string; owner?: string; notes?: string; tags?: string[];
    };
    if (!name) return res.status(400).json({ error: "الاسم مطلوب" });

    const [created] = await db.insert(assets).values({
      name,
      description: description ?? "",
      techStack: techStack ?? [],
      domains: domains ?? [],
      ips: ips ?? [],
      category: category ?? "web",
      criticality: criticality ?? "medium",
      owner: owner ?? "",
      notes: notes ?? "",
      tags: tags ?? [],
    }).returning();

    res.status(201).json({ asset: created });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل إنشاء الأصل" });
  }
});

router.put("/assets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body as Partial<typeof assets.$inferInsert>;
    const [updated] = await db.update(assets).set({ ...updates, updatedAt: new Date() }).where(eq(assets.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "الأصل غير موجود" });
    res.json({ asset: updated });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل تحديث الأصل" });
  }
});

router.delete("/assets/:id", async (req, res) => {
  try {
    await db.delete(assets).where(eq(assets.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل حذف الأصل" });
  }
});

export default router;
