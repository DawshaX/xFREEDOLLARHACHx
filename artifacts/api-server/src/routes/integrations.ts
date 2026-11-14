/**
 * TEST9 — راوت التطبيقات المتصلة: الحالة الحقيقية + الربط + الاختبار الحي.
 * كل رد بيرفع إشعارًا حيًا بالـlink — الإشعار بيودّي المالك للمكان نفسه.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { checkGate, tokenConfigured } from "../lib/ops/gate";
import { INTEGRATION_APPS, integrationsStatus, runIntegration, setIntegrationToken, listIntegrationOps } from "../lib/ops/integrations";
import { createPushNotification } from "../lib/push-hub";

const router: IRouter = Router();

/** بوابة الكتابة: نفس بوابات ops (توكن/جلسة المالك) — القراءة مفتوحة للجلسة. */
function writeGate(req: Request, res: Response, what: string): boolean {
  if (!tokenConfigured()) return true;
  const gate = checkGate(req as never, what);
  if (gate && gate.ok && gate.code === "allowed") return true;
  res.status(403).json({ ok: false, error: "owner_gate_required", what });
  return false;
}

router.get("/integrations", (_req: Request, res: Response) => {
  res.json({ ok: true, apps: integrationsStatus(), total: INTEGRATION_APPS.length });
});

router.get("/integrations/:id/ops", (req: Request, res: Response) => {
  res.json({ ok: true, id: req.params.id, ops: listIntegrationOps(String(req.params.id)) });
});

router.post("/integrations/connect", (req: Request, res: Response) => {
  if (!writeGate(req, res, "integrations connect")) return;
  const body = (req.body ?? {}) as { id?: string; token?: string };
  const r = setIntegrationToken(String(body.id ?? ""), String(body.token ?? ""));
  const app = INTEGRATION_APPS.find((a) => a.id === body.id);
  createPushNotification({
    kind: r.ok ? "success" : "error",
    title: `ربط ${app?.nameAr ?? body.id}`,
    body: r.saysAr,
    link: app?.panelLink ?? "/integrations",
  });
  res.json({ ok: r.ok, says_ar: r.saysAr, status: integrationsStatus().find((s) => s.id === body.id) });
});

router.post("/integrations/run", async (req: Request, res: Response) => {
  if (!writeGate(req, res, "integrations run")) return;
  const body = (req.body ?? {}) as { id?: string; op?: string; args?: Record<string, unknown> };
  if (!body.id || !body.op) {
    res.status(400).json({ ok: false, error: "id و op مطلوبين" });
    return;
  }
  const r = await runIntegration(String(body.id), String(body.op), body.args ?? {});
  const app = INTEGRATION_APPS.find((a) => a.id === body.id);
  createPushNotification({
    kind: r.ok ? "success" : "error",
    title: `${app?.nameAr ?? body.id} · ${body.op}`,
    body: r.saysAr,
    link: r.link,
  });
  res.json({ ok: r.ok, says_ar: r.saysAr, data: r.ok ? r.data : undefined, link: r.link });
});

export default router;
