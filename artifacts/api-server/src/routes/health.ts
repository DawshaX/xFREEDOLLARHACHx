import { Router, type IRouter } from "express";
import { getPlatformControlSnapshot } from "../lib/standalone-api";
import { getConnectedAgentList } from "./local-agent";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

/** لقطة حالة المنصة — كل حقل فيها متقاس من مخازن السيرفر نفسها. */
router.get(["/status", "/platform/snapshot"], (_req, res) => {
  res.json(getPlatformControlSnapshot());
});

/** نفس اللقطة + حالة الأسطول المقاسة (عدد الأجهزة المتصلة مش رقم مكتوب). */
router.get("/platform/summary", (_req, res) => {
  const snapshot = getPlatformControlSnapshot();
  const agents = getConnectedAgentList();
  const configured = Number(process.env.NOVA_FLEET_AGENTS);
  const targetAgents = Number.isSafeInteger(configured) && configured > 0 ? configured : 10;
  res.json({
    ok: true,
    measured: true,
    ts: snapshot.ts,
    platform: snapshot,
    fleet: {
      connectedAgents: agents.length,
      targetAgents,
      targetMet: agents.length >= targetAgents,
      machines: agents.map((agent) => ({
        id: String(agent.id ?? "agent"),
        hostname: String(agent.hostname ?? "unknown"),
        platform: String(agent.platform ?? "unknown"),
        connectedAt: agent.connectedAt ?? null,
      })),
    },
  });
});

export default router;
