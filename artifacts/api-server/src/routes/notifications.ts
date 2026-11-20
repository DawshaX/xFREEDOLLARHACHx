import { Router, type IRouter } from "express";
import { db, notificationsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { readNovaEvents } from "../lib/ops/nova-events";

const router: IRouter = Router();

router.get("/notifications", async (_req, res, next) => {
  /* Standalone (مفيش DATABASE_URL): الجدول مش موجود — لكن مركز الإشعارات
   * لازم يشتغل. المصدر الحقيقي هنا هو نبض الخلفية بتاع session-nexus:
   * كرون + مراقبون + صيد + حصاد الخزنة — كلها أحداث حصلت فعلاً على الجهاز. */
  if (!process.env.DATABASE_URL) {
    /* سجل الأحداث الدائم (state/events.jsonl) أولًا — طلب المالك: كل حاجة
     * تمت/بتتم تظهر هنا (تثبيت · تشغيل · بث · تحديث). بعده نبض الخلفية. */
    const fileEvents = readNovaEvents(120).map((ev) => ({
      id: ev.id,
      title: ev.title,
      body: ev.detail,
      kind: ev.kind,
      read: false,
      createdAt: ev.ts,
      source: "nova-events",
    }));
    try {
      const { getNexusSnapshot } = await import("../lib/agent/session-nexus");
      const snap = getNexusSnapshot();
      const nexusEvents = snap.recentBackground.map((ev) => ({
        id: ev.id,
        title: ev.title,
        body: ev.detail,
        kind: ev.kind,
        read: false,
        createdAt: typeof ev.ts === "number" ? new Date(ev.ts).toISOString() : String(ev.ts),
        source: ev.source,
      }));
      res.json([...fileEvents, ...nexusEvents].slice(0, 120));
      return;
    } catch (e) {
      res.json(fileEvents);
      return;
    }
  }
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
  if (!process.env.DATABASE_URL) { res.json({ id: req.params.notificationId, standalone: true }); return; }
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
