import { Router } from "express";
import { auditLog } from "../lib/audit";
import { broadcastLiveEvent } from "./live-events";

const router = Router();

// Global kill switch state
export let killSwitchActive = false;
const sessionKills = new Set<string>();

export function isKilled(sessionId?: string): boolean {
  return killSwitchActive || (!!sessionId && sessionKills.has(sessionId));
}

export function resetKill(sessionId?: string): void {
  if (sessionId) sessionKills.delete(sessionId);
  else { killSwitchActive = false; sessionKills.clear(); }
}

// POST /api/kill-switch — emergency stop ALL
router.post("/kill-switch", (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) {
    sessionKills.add(sessionId);
  } else {
    killSwitchActive = true;
    setTimeout(() => { killSwitchActive = false; }, 30_000); // auto-reset after 30s
  }
  auditLog({ ts: new Date().toISOString(), sessionId, action: "kill_switch", data: { scope: sessionId || "global" } });
  broadcastLiveEvent({ type: "agent_alert", data: { title: "⛔ Kill Switch", message: "تم إيقاف كل العمليات فوراً", severity: "critical", ts: Date.now() }, ts: new Date().toISOString() });
  res.json({ ok: true, killed: true });
});

// POST /api/kill-switch/reset — re-enable
router.post("/kill-switch/reset", (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  resetKill(sessionId);
  res.json({ ok: true, active: false });
});

// GET /api/kill-switch/status
router.get("/kill-switch/status", (_req, res) => {
  res.json({ active: killSwitchActive, sessionKills: Array.from(sessionKills) });
});

export default router;
