/**
 * AI provider route — Ollama-only.
 * All AI features use the local Ollama server.
 * No external providers (Anthropic, OpenAI, Gemini, etc.) are used.
 */
import { Router, type IRouter } from "express";
import { db, settings } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/ai/providers
// Returns Ollama as the only provider.
// ---------------------------------------------------------------------------
router.get("/ai/providers", async (_req, res, next) => {
  try {
    const { getOllamaBaseUrl, getOllamaModel } = await import("../lib/ollama-settings");
    const base = await getOllamaBaseUrl();
    const model = await getOllamaModel();

    let available = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      available = r.ok;
    } catch {
      available = false;
    }

    res.json({
      providers: [{ id: "ollama", name: "Ollama (Local)", configured: available, model }],
      current: { provider: "ollama", model },
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai/provider — set Ollama base URL / model
// ---------------------------------------------------------------------------
router.post("/ai/provider", async (req, res, next) => {
  try {
    const { model } = req.body as { provider?: string; model?: string };

    if (model) {
      await db
        .insert(settings)
        .values({ key: "ollamaModel", value: model })
        .onConflictDoUpdate({ target: settings.key, set: { value: model } });
    }

    const { invalidateOllamaCache } = await import("../lib/ollama-settings");
    invalidateOllamaCache();
    const { getOllamaModel } = await import("../lib/ollama-settings");
    res.json({ ok: true, current: { provider: "ollama", model: model ?? await getOllamaModel() } });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/ai/keys — no external keys needed
// ---------------------------------------------------------------------------
router.get("/ai/keys", (_req, res) => {
  res.json([]);
});

// POST /api/ai/keys — no-op, external keys not used
router.post("/ai/keys", (_req, res) => {
  res.json({ ok: true, message: "External API keys are not used. Only Ollama local is supported." });
});

// DELETE /api/ai/keys/:name — no-op
router.delete("/ai/keys/:name", (_req, res) => {
  res.status(204).end();
});

export default router;
