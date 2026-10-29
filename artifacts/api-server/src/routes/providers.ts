import { Router, type IRouter } from "express";
import { getProviderStatus } from "../lib/ai";
import {
  listEnabledProviders,
  setProviderEnabled,
  streamPlainText,
  type ProviderId,
} from "../lib/ai-router-ollama-only";

const router: IRouter = Router();

const VALID_PROVIDER_IDS: ProviderId[] = ["ollama-local"];

/** Simple status — only Ollama is supported. */
router.get("/providers/status", async (_req, res) => {
  const list = await getProviderStatus();
  res.json({
    providers: list,
    activeCount: list.filter((p) => p.configured).length,
    timestamp: new Date().toISOString(),
  });
});

/** Detailed provider list for the Settings UI. */
router.get("/providers/detailed", async (_req, res) => {
  const list = await listEnabledProviders();
  res.json({
    providers: list.map((p) => ({
      id: p.id,
      family: p.family,
      source: p.source,
      available: p.available,
      enabled: p.enabled,
      displayName: p.displayName,
      ...(p.exhaustedUntil ? { exhaustedUntil: p.exhaustedUntil } : {}),
      ...(p.lastError ? { lastError: p.lastError } : {}),
    })),
    timestamp: new Date().toISOString(),
  });
});

router.post("/providers/:id/toggle", async (req, res) => {
  const id = req.params.id as ProviderId;
  if (!VALID_PROVIDER_IDS.includes(id)) {
    res.status(400).json({ error: "Invalid provider id. Only ollama-local is supported." });
    return;
  }
  const enabled = req.body?.enabled !== false;
  await setProviderEnabled(id, enabled);
  res.json({ id, enabled });
});

/** Quick health check: send a 1-token prompt and report success/failure. */
router.post("/providers/test/:id", async (req, res) => {
  const id = req.params.id as ProviderId;
  if (!VALID_PROVIDER_IDS.includes(id)) {
    res.status(400).json({ error: "Invalid provider id. Only ollama-local is supported." });
    return;
  }
  try {
    const start = Date.now();
    const result = await streamPlainText({
      system: "You are a health check. Reply with exactly: OK",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
    });
    const ms = Date.now() - start;
    res.json({
      ok: true,
      askedFor: id,
      respondedBy: result.provider.id,
      latencyMs: ms,
      sample: result.text.slice(0, 40),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, askedFor: id, error: msg });
  }
});

export default router;
