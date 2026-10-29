/**
 * Nova Cron Routes — Scheduler Management API
 */
import { Router } from "express";
import { getJobs, enableJob, triggerJob } from "../lib/nova-cron";
import { logger } from "../lib/logger";

const router = Router();

// GET /api/nova/cron/jobs — list all jobs
router.get("/nova/cron/jobs", (_req, res) => {
  res.json({ jobs: getJobs(), count: getJobs().length });
});

// POST /api/nova/cron/jobs/:id/trigger — run job now
router.post("/nova/cron/jobs/:id/trigger", async (req, res) => {
  const { id } = req.params;
  logger.info({ id }, "Manual cron trigger");
  const result = await triggerJob(id);
  res.json(result);
});

// PATCH /api/nova/cron/jobs/:id — enable/disable job
router.patch("/nova/cron/jobs/:id", (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body as { enabled: boolean };
  const ok = enableJob(id, enabled);
  res.json({ ok, id, enabled });
});

export default router;
