import { Router, type IRouter } from "express";
import { pool, DB_SSL_MODE, DB_SSL_NOTE_AR, DB_SSL_CA_SOURCE } from "@workspace/db";
import { getPlatformControlSnapshot } from "../lib/standalone-api";
import { getConnectedAgentList } from "./local-agent";

const router: IRouter = Router();

/**
 * قياس حيّ لقابلية قاعدة البيانات (N1) — SELECT 1 بمهلة قصيرة.
 * النتيجة بتتقاس وقت الطلب، مش بتتخزن ولا بتتفترض.
 */
async function probeDb(): Promise<
  | { reachable: true; sslMode: string; caSource: string | null; noteAr: string; ms: number }
  | { reachable: false; sslMode: string; caSource: string | null; noteAr: string; errorCode: string }
> {
  const started = Date.now();
  try {
    const timeout = new Promise<never>((_r, rej) =>
      setTimeout(() => rej(new Error("db-probe-timeout")), 1200),
    );
    await Promise.race([pool.query("select 1"), timeout]);
    return { reachable: true, sslMode: DB_SSL_MODE, caSource: DB_SSL_CA_SOURCE, noteAr: DB_SSL_NOTE_AR, ms: Date.now() - started };
  } catch (e) {
    const code =
      (e as { code?: string })?.code ||
      (e instanceof Error && e.message === "db-probe-timeout" ? "PROBE_TIMEOUT" : "DB_ERROR");
    return { reachable: false, sslMode: DB_SSL_MODE, caSource: DB_SSL_CA_SOURCE, noteAr: DB_SSL_NOTE_AR, errorCode: code };
  }
}

router.get("/healthz", async (_req, res) => {
  const dbProbe = await probeDb();
  res.json({ status: "ok", db: dbProbe });
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
