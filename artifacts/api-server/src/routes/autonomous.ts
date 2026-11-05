/**
 * الوضع المستقل — المسارات الحقيقية.
 *
 * قبل كده `/api/autonomous/enable|disable|stream` كانت بتتجاب من `stubs.ts`:
 * enable بيرد `{ok:true,active:true}` من غير أي أثر، والـstream بيبعت `: ping`
 * بس. يعني اللي بيضغط الزر في محطة العمل كان بيتأكد أنه فعّل حاجة وهي مش فعّالة.
 * الروترات دي اتركّبت قبل الـstubs (`routes/index.ts`) فاللي بيتنفّذ دلوقتي ده.
 */
import { Router } from "express";
import { requireOps } from "../lib/ops/gate";
import { autonomyStatus, setAutonomy, runAutonomyTickNow } from "../lib/autonomy-control";
import { subscribeAutonomyEvent, autonomyListenerCount } from "../lib/autonomy-events";
import { auditLog } from "../lib/audit";

const router = Router();

router.get("/autonomous/status", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await autonomyStatus()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// الكتابة في مفتيح الأتمتة = قرار تشغيل، مش قراءة → متبوّبة زي باقي اليدوات الخطرة.
router.post("/autonomous/enable", requireOps("autonomy"), async (req, res) => {
  const body = (req.body ?? {}) as { level?: unknown; note?: unknown };
  const r = await setAutonomy({ enabled: true, level: body.level === undefined ? undefined : String(body.level), note: body.note ? String(body.note) : undefined });
  auditLog({ ts: new Date().toISOString(), action: "autonomy_enable", data: { ok: r.ok, level: r.status.level, error: r.error ?? null } });
  res.status(r.ok ? 200 : 409).json({ ok: r.ok, status: r.status, error: r.error ?? null });
});

router.post("/autonomous/disable", requireOps("autonomy"), async (req, res) => {
  const body = (req.body ?? {}) as { note?: unknown };
  const r = await setAutonomy({ enabled: false, level: "off", note: body.note ? String(body.note) : undefined });
  auditLog({ ts: new Date().toISOString(), action: "autonomy_disable", data: { ok: r.ok, error: r.error ?? null } });
  res.status(r.ok ? 200 : 409).json({ ok: r.ok, status: r.status, error: r.error ?? null });
});

// دورة حالّية — عشان المستخدم يشوف نتيجة واحدة قدامه بدل ما يستنى اللفة الجاية
router.post("/autonomous/tick", requireOps("autonomy"), async (req, res) => {
  const body = (req.body ?? {}) as { target?: unknown };
  const r = await runAutonomyTickNow(body.target ? String(body.target) : undefined);
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, cycles: r.cycles ?? null, error: r.error ?? null, status: await autonomyStatus() });
});

/**
 * الـstream الحقيقي: أول حدث = الحالة المقاسة، وبعدين كل حدث من مجرّة الديمون.
 * مفيش «connected ✓» من غير مصدر — اللي بيتفرج يشوف كام دورة وemin آخر نبضة.
 */
router.get("/autonomous/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const send = (payload: unknown) => {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* مقفول */ }
  };
  try {
    send({ type: "status", data: await autonomyStatus(), at: new Date().toISOString() });
  } catch (e) {
    send({ type: "error", data: { error: e instanceof Error ? e.message : String(e) }, at: new Date().toISOString() });
  }
  const off = subscribeAutonomyEvent((e) => send({ type: e.type, data: e.detail ?? {}, at: e.at }));
  const ping = setInterval(() => {
    try { res.write(`: ping listeners=${autonomyListenerCount()} ${new Date().toISOString()}\n\n`); } catch { clearInterval(ping); }
  }, 25_000);
  req.on("close", () => { clearInterval(ping); off(); });
});

export default router;
