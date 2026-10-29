/**
 * Keys management API — status, add, delete, test, refresh
 */

import { Router, type IRouter } from "express";
import {
  getKeyManagerStatus,
  runKeyManagerCycle,
  saveProviderKey,
  deleteProviderKey,
  type ProviderKeyStatus,
} from "../lib/key-manager";
import { type ProviderId } from "../lib/ai-router-ollama-only";

const router: IRouter = Router();

const VALID_PROVIDER_IDS: ProviderId[] = ["ollama-local"];

/** Get full key manager status: all providers with health */
router.get("/keys/status", (_req, res) => {
  const status = getKeyManagerStatus();
  const working = status.providers.filter((p: ProviderKeyStatus) => p.healthy === true).length;
  const total = status.providers.filter((p: ProviderKeyStatus) => p.available).length;
  res.json({
    ...status,
    summary: {
      total,
      working,
      failed: total - working,
    },
  });
});

/** Trigger an immediate refresh cycle */
router.post("/keys/refresh", async (_req, res) => {
  try {
    await runKeyManagerCycle();
    res.json({ ok: true, status: getKeyManagerStatus() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Save a new API key for a provider */
router.post("/keys/:providerId", async (req, res) => {
  const id = req.params.providerId as ProviderId;
  if (!VALID_PROVIDER_IDS.includes(id)) {
    res.status(400).json({ error: `Invalid provider id: ${id}` });
    return;
  }
  const key = String(req.body?.key || "").trim();
  if (!key) {
    res.status(400).json({ error: "key is required" });
    return;
  }
  try {
    await saveProviderKey(id, key);
    // Refresh to validate the new key
    await runKeyManagerCycle();
    res.json({ ok: true, providerId: id, status: getKeyManagerStatus() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Delete a provider's key */
router.delete("/keys/:providerId", async (req, res) => {
  const id = req.params.providerId as ProviderId;
  if (!VALID_PROVIDER_IDS.includes(id)) {
    res.status(400).json({ error: `Invalid provider id: ${id}` });
    return;
  }
  try {
    await deleteProviderKey(id);
    res.json({ ok: true, providerId: id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
