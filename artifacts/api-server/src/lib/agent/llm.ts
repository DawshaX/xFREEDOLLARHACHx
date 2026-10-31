/**
 * NOVA — LLM Bridge
 * ─────────────────
 * Zero-cost-first model access. Tries, in order:
 *   1. Ollama on your machine (free, offline) — OLLAMA_BASE_URL / settings
 *   2. Free-tier cloud APIs if keys exist in env
 *      (Groq, OpenRouter, Google Gemini via OpenAI-compatible endpoint, Mistral)
 *   3. Nothing available → caller falls back to the deterministic planner, so the
 *      agent still works end-to-end (tools are executed for real either way).
 */

import { getOllamaBaseUrl, getOllamaModel } from "../ollama-settings";
import { logger } from "../logger";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmProviderInfo {
  id: string;
  label: string;
  model: string;
  kind: "ollama" | "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  free: boolean;
}

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
  ms: number;
}

const TIMEOUT_MS = 20_000;
const SETTINGS_TIMEOUT_MS = 1_500;

/**
 * The settings store lives in Postgres. In standalone mode (no DATABASE_URL) the
 * read can stall, which would freeze the whole agent before the first token.
 * Always resolve provider config against a hard deadline.
 */
function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((v) => resolve(v))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

/** Ordered list of providers that are actually configured right now. */
export async function listConfiguredProviders(): Promise<LlmProviderInfo[]> {
  const providers: LlmProviderInfo[] = [];

  // 1. Local Ollama (always attempted — free & private)
  try {
    const envBase = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const envModel = process.env.OLLAMA_MODEL || "llama3.1";
    const baseUrl = await withDeadline(getOllamaBaseUrl(), SETTINGS_TIMEOUT_MS, envBase);
    const model = await withDeadline(getOllamaModel(), SETTINGS_TIMEOUT_MS, envModel);
    providers.push({
      id: "ollama",
      label: "Ollama (محلي مجاني)",
      model,
      kind: "ollama",
      baseUrl,
      free: true,
    });
  } catch {
    providers.push({
      id: "ollama",
      label: "Ollama (محلي مجاني)",
      model: process.env.OLLAMA_MODEL || "llama3.1",
      kind: "ollama",
      baseUrl: (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
      free: true,
    });
  }

  // 2. Free-tier cloud providers (only when the user supplies a key)
  const envProviders: Array<{ id: string; label: string; baseUrl: string; model: string; keys: string[] }> = [
    {
      id: "groq",
      label: "Groq (free tier)",
      baseUrl: "https://api.groq.com/openai/v1",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      keys: ["GROQ_API_KEY"],
    },
    {
      id: "openrouter",
      label: "OpenRouter (free models)",
      baseUrl: "https://openrouter.ai/api/v1",
      model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
      keys: ["OPENROUTER_API_KEY"],
    },
    {
      id: "gemini",
      label: "Google Gemini (free tier)",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    },
    {
      id: "mistral",
      label: "Mistral (free tier)",
      baseUrl: "https://api.mistral.ai/v1",
      model: process.env.MISTRAL_MODEL || "mistral-small-latest",
      keys: ["MISTRAL_API_KEY"],
    },
    {
      id: "together",
      label: "Together AI (free models)",
      baseUrl: "https://api.together.xyz/v1",
      model: process.env.TOGETHER_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
      keys: ["TOGETHER_API_KEY"],
    },
  ];

  for (const p of envProviders) {
    const key = p.keys.map((k) => process.env[k]).find((v) => v && v.trim().length > 8);
    if (!key) continue;
    providers.push({
      id: p.id,
      label: p.label,
      model: p.model,
      kind: "openai-compatible",
      baseUrl: p.baseUrl,
      apiKey: key.trim(),
      free: true,
    });
  }

  return providers;
}

async function callOpenAiCompatible(
  provider: LlmProviderInfo,
  messages: LlmMessage[],
  temperature = 0.6,
  maxTokens = 1400,
): Promise<string> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${provider.id} HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`${provider.id}: empty response`);
  return text;
}

async function callOllama(provider: LlmProviderInfo, messages: LlmMessage[], temperature = 0.6): Promise<string> {
  const res = await fetch(`${provider.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: false,
      options: { temperature, num_predict: 1400 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string }; response?: string };
  const text = data.message?.content ?? data.response ?? "";
  if (!text.trim()) throw new Error("ollama: empty response");
  return text;
}

/**
 * Ask the first working provider. Returns null when no model is reachable —
 * the caller then uses the deterministic planner (agent still fully works).
 */
export async function llmComplete(
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number; prefer?: string } = {},
): Promise<LlmResult | null> {
  const providers = await listConfiguredProviders();
  logger.info({ providers: providers.map((p) => `${p.id}:${p.baseUrl}`) }, "llm: providers resolved");
  const ordered = opts.prefer
    ? [...providers.filter((p) => p.id === opts.prefer), ...providers.filter((p) => p.id !== opts.prefer)]
    : providers;

  for (const provider of ordered) {
    const started = Date.now();
    logger.info({ provider: provider.id, kind: provider.kind }, "llm: attempt");
    try {
      const text =
        provider.kind === "ollama"
          ? await callOllama(provider, messages, opts.temperature)
          : await callOpenAiCompatible(provider, messages, opts.temperature, opts.maxTokens);
      logger.info({ provider: provider.id, ms: Date.now() - started }, "llm: success");
      return { text, provider: provider.id, model: provider.model, ms: Date.now() - started };
    } catch (err) {
      // Trying the next provider is a normal path (Ollama off, quota, offline…).
      logger.debug(
        { provider: provider.id, err: String((err as Error).message).slice(0, 120), ms: Date.now() - started },
        "llm provider unavailable",
      );
    }
  }
  return null;
}

/** Extract the first JSON object from a model reply (tolerates ``` fences). */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
