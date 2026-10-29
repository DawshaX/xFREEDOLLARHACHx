/**
 * Multi-AI Route — Nova queries multiple free AI providers
 * POST /api/multi-ai/chat          — stream from best available provider
 * POST /api/multi-ai/consensus     — query N providers in parallel, stream each
 * GET  /api/multi-ai/providers     — list all providers + availability
 * POST /api/multi-ai/providers/:id/key — save API key for a provider
 * POST /api/multi-ai/providers/:id/toggle — enable/disable a provider
 * POST /api/multi-ai/providers/:id/model — set preferred model
 * GET  /api/multi-ai/providers/:id/models — list available free models
 */

import { Router } from "express";
import {
  listMultiProviders,
  setMultiProviderEnabled,
  saveProviderApiKey,
  streamFromBestProvider,
  queryMultipleProviders,
  pickBestProviderForTask,
  NOVA_SYSTEM_PROMPT,
  type MultiProviderId,
} from "../lib/ai-multi-router";
import { logger } from "../lib/logger";
import { db, settings } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// ── GET /api/multi-ai/providers ───────────────────────────────────────────────
router.get("/multi-ai/providers", async (_req, res) => {
  try {
    const providers = await listMultiProviders();
    res.json({
      providers,
      availableCount: providers.filter(p => p.available).length,
      enabledCount: providers.filter(p => p.available && p.enabled).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "multi-ai/providers error");
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/multi-ai/providers/:id/models ────────────────────────────────────
router.get("/multi-ai/providers/:id/models", async (req, res) => {
  const providers = await listMultiProviders();
  const p = providers.find(x => x.id === req.params.id);
  if (!p) { res.status(404).json({ error: "Provider not found" }); return; }
  res.json({ id: p.id, models: p.freeModels, defaultModel: p.defaultModel });
});

// ── POST /api/multi-ai/providers/:id/toggle ───────────────────────────────────
router.post("/multi-ai/providers/:id/toggle", async (req, res) => {
  const id = req.params.id as MultiProviderId;
  const enabled = req.body?.enabled !== false;
  await setMultiProviderEnabled(id, enabled);
  res.json({ id, enabled });
});

// ── POST /api/multi-ai/providers/:id/key ─────────────────────────────────────
router.post("/multi-ai/providers/:id/key", async (req, res) => {
  const id = req.params.id as MultiProviderId;
  const { key } = req.body as { key?: string };
  if (!key?.trim()) { res.status(400).json({ error: "key is required" }); return; }
  await saveProviderApiKey(id, key.trim());
  res.json({ id, saved: true });
});

// ── POST /api/multi-ai/providers/:id/model ────────────────────────────────────
router.post("/multi-ai/providers/:id/model", async (req, res) => {
  const id = req.params.id as MultiProviderId;
  const { model } = req.body as { model?: string };
  if (!model?.trim()) { res.status(400).json({ error: "model is required" }); return; }
  await db.insert(settings).values({ key: `multi_model_${id}`, value: model.trim() })
    .onConflictDoUpdate({ target: settings.key, set: { value: model.trim(), updatedAt: new Date() } });
  res.json({ id, model: model.trim() });
});

// ── POST /api/multi-ai/chat  (SSE streaming) ─────────────────────────────────
router.post("/multi-ai/chat", async (req, res) => {
  const {
    messages,
    system,
    maxTokens,
    preferProvider,
    taskType,
  } = req.body as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    system?: string;
    maxTokens?: number;
    preferProvider?: MultiProviderId;
    taskType?: "code" | "analysis" | "fast" | "creative" | "security";
  };

  if (!messages?.length) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Pick best provider for task if not specified
    let preferred = preferProvider;
    if (!preferred && taskType) {
      preferred = (await pickBestProviderForTask(taskType)) ?? undefined;
    }

    send("status", { status: "thinking", provider: preferred ?? "auto" });

    let fullText = "";
    const result = await streamFromBestProvider({
      system: system ?? NOVA_SYSTEM_PROMPT,
      messages,
      maxTokens,
      preferProvider: preferred,
      onText: (delta, providerId) => {
        fullText += delta;
        send("delta", { delta, provider: providerId });
      },
    });

    send("done", {
      text: fullText,
      provider: result.provider,
      chars: fullText.length,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send("error", { error: msg });
    logger.error({ err: msg }, "multi-ai/chat error");
  } finally {
    res.end();
  }
});

// ── POST /api/multi-ai/consensus  (SSE — N providers in parallel) ─────────────
router.post("/multi-ai/consensus", async (req, res) => {
  const {
    messages,
    maxProviders,
    timeoutMs,
  } = req.body as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    maxProviders?: number;
    timeoutMs?: number;
  };

  if (!messages?.length) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send("status", { status: "querying_multiple", count: maxProviders ?? 3 });

    const result = await queryMultipleProviders({
      messages,
      maxProviders: maxProviders ?? 3,
      timeoutMs: timeoutMs ?? 30_000,
      onChunk: (provider, delta) => {
        send("chunk", { provider, delta });
      },
    });

    send("consensus", {
      responses: result.responses.map(r => ({
        provider: r.provider,
        model: r.model,
        latencyMs: r.latencyMs,
        chars: r.text.length,
        preview: r.text.slice(0, 300),
      })),
      synthesis: result.synthesis,
      bestProvider: result.responses[0]?.provider,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send("error", { error: msg });
  } finally {
    res.end();
  }
});

export default router;
