/**
 * Server-side Ollama streaming proxy.
 *
 * POST /api/ollama/chat/stream
 *   → Forwards to Ollama at the configured URL, streams tokens back as NDJSON.
 *   → No CORS needed — browser calls /api (same origin), server calls Ollama.
 *
 * GET /api/ollama/probe
 *   → Quick server-side connectivity check: returns {connected, models, latencyMs}.
 */

import { Router, type IRouter } from "express";
import { setOllamaBusy } from "../lib/cron-scheduler";
import { getOllamaBaseUrl as getOllamaUrl, getOllamaModel } from "../lib/ollama-settings";

const router: IRouter = Router();

/** Quick connectivity probe — returns JSON */
router.get("/ollama/probe", async (_req, res) => {
  const base = await getOllamaUrl();
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2_000);
    const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) {
      res.json({ connected: false, base, error: `HTTP ${r.status}` });
      return;
    }
    const data = (await r.json()) as { models?: Array<{ name: string }> };
    res.json({
      connected: true,
      base,
      latencyMs: Date.now() - start,
      models: (data.models ?? []).map((m) => m.name),
    });
  } catch (err) {
    res.json({
      connected: false,
      base,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
});

/** Streaming chat proxy — SSE stream of tokens */
router.post("/ollama/chat/stream", async (req, res) => {
  const body = req.body as {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    apiBase?: string;
    options?: Record<string, unknown>;
  };

  const messages = body.messages ?? [];
  // Always use the server-configured URL (DB or env) — never trust browser-supplied apiBase
  // because localStorage on Replit always has http://127.0.0.1:11434 (Replit's localhost, not user's machine)
  const base = (await getOllamaUrl()).replace(/\/$/, "");
  const model = body.model ?? (await getOllamaModel());

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders?.();

  // Mark Ollama as busy to prevent cron jobs from queuing behind this request
  setOllamaBusy(true);
  const ctrl = new AbortController();
  req.on("close", () => { ctrl.abort(); setOllamaBusy(false); });

  // Send keepalive pings every 5s so the browser/proxy never drops the connection
  const flush = () => {
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  };
  const pingInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(JSON.stringify({ ping: true }) + "\n");
      flush();
    }
  }, 5000);

  let ollamaResp: Response;
  try {
    ollamaResp = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { num_predict: 600, num_ctx: 4096, ...(body.options ?? {}) },
      }),
    });
  } catch (err) {
    clearInterval(pingInterval);
    if (!res.writableEnded) {
      res.write(JSON.stringify({ error: err instanceof Error ? err.message : "Ollama unreachable" }) + "\n");
      res.end();
    }
    return;
  }

  if (!ollamaResp.ok) {
    clearInterval(pingInterval);
    const txt = await ollamaResp.text().catch(() => "");
    if (!res.writableEnded) {
      res.write(JSON.stringify({ error: `Ollama HTTP ${ollamaResp.status}: ${txt.slice(0, 200)}` }) + "\n");
      res.end();
    }
    return;
  }

  const reader = ollamaResp.body?.getReader();
  if (!reader) {
    clearInterval(pingInterval);
    res.write(JSON.stringify({ error: "No response body from Ollama" }) + "\n");
    res.end();
    return;
  }

  const dec = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const raw = dec.decode(value, { stream: true });
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const json = JSON.parse(t) as {
            message?: { content?: string };
            done?: boolean;
            error?: string;
          };
          if (json.error) {
            res.write(JSON.stringify({ error: json.error }) + "\n");
            break;
          }
          const token = json.message?.content ?? "";
          if (token || json.done) {
            res.write(JSON.stringify({ token, done: json.done ?? false }) + "\n");
          }
        } catch {
          // partial JSON line, skip
        }
      }
      flush();
    }
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) {
      req.log?.warn({ err }, "Ollama stream error");
    }
  } finally {
    clearInterval(pingInterval);
    reader.releaseLock();
    setOllamaBusy(false);
    if (!res.writableEnded) res.end();
  }
});

export default router;
