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
import { resolveOllamaBase, preferredOllamaModel } from "./ollama-manager";
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

  // 1. Local Ollama — free, private, and auto-discovered (works inside Docker too)
  try {
    const envBase = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const discovered = await resolveOllamaBase();
    const baseUrl = discovered ?? (await withDeadline(getOllamaBaseUrl(), SETTINGS_TIMEOUT_MS, envBase));
    const model = discovered
      ? await preferredOllamaModel()
      : await withDeadline(getOllamaModel(), SETTINGS_TIMEOUT_MS, process.env.OLLAMA_MODEL || "qwen2.5:3b");
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
      model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
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
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      keys: ["GROQ_API_KEY"],
    },
    {
      id: "openrouter",
      label: "OpenRouter (free models)",
      baseUrl: "https://openrouter.ai/api/v1",
      model: process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free",
      keys: ["OPENROUTER_API_KEY"],
    },
    {
      id: "gemini",
      label: "Google Gemini (free tier)",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
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
    {
      // Free tier, very fast inference; OpenAI-compatible so no extra code path.
      id: "cerebras",
      label: "Cerebras (free tier)",
      baseUrl: "https://api.cerebras.ai/v1",
      model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
      keys: ["CEREBRAS_API_KEY"],
    },
    {
      // GitHub Models: free with any GitHub token, rate-limited per day.
      // The token is read from the environment only — never logged, never stored.
      id: "github-models",
      label: "GitHub Models (free with token)",
      baseUrl: "https://models.github.ai/inference",
      model: process.env.GITHUB_MODELS_MODEL || "openai/gpt-4o-mini",
      keys: ["GITHUB_MODELS_TOKEN"],
    },
  ];

  // OpenAI stays last: it is the only paid option, so it is a true last resort.
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 8) {
    envProviders.push({
      id: "openai",
      label: "OpenAI (مدفوع — آخر خيار)",
      baseUrl: "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      keys: ["OPENAI_API_KEY"],
    });
  }

  for (const p of envProviders) {
    const key = p.keys.map((k) => process.env[k]).find((v) => v && v.trim().length > 8);
    if (!key) continue;
    // Any OpenAI-compatible endpoint can be substituted at runtime, e.g.
    // GROQ_BASE_URL=http://my-proxy/v1 — useful for a self-hosted gateway, a
    // mirror, or pointing a slot at another machine in the fleet.
    const override = (process.env[`${p.id.toUpperCase().replace(/-/g, "_")}_BASE_URL`] || "").trim();
    providers.push({
      id: p.id,
      label: p.label,
      model: process.env[`${p.id.toUpperCase().replace(/-/g, "_")}_MODEL`] || p.model,
      kind: "openai-compatible",
      baseUrl: override ? override.replace(/\/$/, "") : p.baseUrl,
      apiKey: key.trim(),
      free: true,
    });
  }

  return providers;
}

/**
 * ── Model auto-healing ────────────────────────────────────────────────────────
 * Providers retire model ids without warning: Groq decommissioned
 * llama-3.3-70b-versatile on 2026-08-16, Google retired gemini-2.0-flash, and
 * OpenRouter rotates which slugs are free. A hardcoded id therefore rots into a
 * 404 that looks like a broken key.
 *
 * When a model is rejected we ask the provider what it *does* serve
 * (`GET /models`, which every OpenAI-compatible API exposes), pick the best
 * chat model from a preference list, retry once, and remember the choice.
 */

const MODEL_CACHE = new Map<string, string>();

/** Preferred ids per provider, best first. Substring match against /models. */
const MODEL_PREFERENCE: Record<string, string[]> = {
  groq: ["gpt-oss-120b", "gpt-oss-20b", "qwen3", "llama-3.3-70b", "llama-3.1-8b"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-flash"],
  openrouter: [
    "gpt-oss-120b:free",
    "qwen3-coder:free",
    "qwen3-next-80b:free",
    "llama-3.3-70b-instruct:free",
    "gemma-4-31b-it:free",
    "openrouter/free",
  ],
  openai: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
  cerebras: ["llama-3.3-70b", "gpt-oss-120b", "qwen-3"],
  mistral: ["mistral-small", "open-mistral"],
  together: ["Llama-3.3-70B", "gpt-oss-120b"],
  "github-models": ["gpt-4o-mini", "gpt-4.1-mini", "Phi-4"],
};

const NOT_CHAT = /embed|whisper|tts|audio|image|dall|moderation|guard|rerank|vision-ocr|realtime|search|transcribe|clip|lyria/i;

function isModelRejection(message: string): boolean {
  return /model|404|not found|does not exist|no longer available|unavailable for free|decommission|deprecat/i.test(message) &&
    !/401|403|invalid api key|unauthor/i.test(message);
}

/** Ask the provider which models this key may call. Returns [] when unsupported. */
async function listProviderModels(provider: LlmProviderInfo): Promise<string[]> {
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
    const ids = (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    if (ids.length) return ids;
    // Google's native shape: models/gemini-2.5-flash
    return (data.models ?? []).map((m) => (m.name ?? "").replace(/^models\//, "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** Best chat model this provider actually serves, or null. */
async function discoverModel(provider: LlmProviderInfo): Promise<string | null> {
  const available = (await listProviderModels(provider)).filter((id) => !NOT_CHAT.test(id));
  if (available.length === 0) return null;
  const pref = MODEL_PREFERENCE[provider.id] ?? [];
  for (const wanted of pref) {
    const hit = available.find((id) => id.toLowerCase().includes(wanted.toLowerCase()));
    if (hit) return hit;
  }
  return available[0] ?? null;
}

/**
 * Keys that the provider itself rejected (401/403). Retrying them on every
 * message wastes a round-trip and, worse, makes the panel look like it is
 * "trying" a provider that can never answer. Remembered for the process.
 */
const AUTH_REJECTED = new Map<string, string>();

export function providerAuthError(providerId: string): string | null {
  return AUTH_REJECTED.get(providerId) ?? null;
}

function isAuthRejection(message: string): boolean {
  return /\b401\b|\b403\b|incorrect api key|invalid api key|invalid_api_key|unauthor|permission/i.test(message);
}

function isRateLimited(message: string): boolean {
  return /\b429\b|rate.?limit|too many requests|quota|exceeded/i.test(message);
}

/** The model to use: env override → learned choice → configured → discovered. */
export async function resolveModel(provider: LlmProviderInfo): Promise<string> {
  const learned = MODEL_CACHE.get(provider.id);
  if (learned) return learned;
  MODEL_CACHE.set(provider.id, provider.model);
  return provider.model;
}

/**
 * One completion with self-correction: if the model id is rejected, discover a
 * working one, retry once, and keep it for the life of the process.
 */
export async function completeWithProvider(
  provider: LlmProviderInfo,
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ text: string; model: string; ms: number; healed?: boolean }> {
  const started = Date.now();
  const model = await resolveModel(provider);

  const attempt = async (useModel: string): Promise<string> =>
    provider.kind === "ollama"
      ? callOllama({ ...provider, model: useModel }, messages, opts.temperature)
      : callOpenAiCompatible({ ...provider, model: useModel }, messages, opts.temperature, opts.maxTokens, opts.timeoutMs);

  const rejected = AUTH_REJECTED.get(provider.id);
  if (rejected) throw new Error(`${provider.id}: المفتاح مرفوض (${rejected}) — تم تجاهله`);

  try {
    const text = await attempt(model);
    return { text, model, ms: Date.now() - started };
  } catch (err) {
    const msg = String((err as Error).message ?? "");

    if (isAuthRejection(msg)) {
      AUTH_REJECTED.set(provider.id, msg.slice(0, 90));
      logger.warn({ provider: provider.id }, "llm: key rejected — provider disabled for this process");
      throw err;
    }

    // A retired model id: ask the provider what it serves, then retry there.
    if (isModelRejection(msg)) {
      const healedModel = await discoverModel(provider);
      if (healedModel && healedModel !== model) {
        logger.warn({ provider: provider.id, from: model, to: healedModel }, "llm: model retired, auto-switched");
        const text = await attempt(healedModel);
        MODEL_CACHE.set(provider.id, healedModel);
        return { text, model: healedModel, ms: Date.now() - started, healed: true };
      }
      throw err;
    }

    // A rate-limited free model is not a broken provider: the next free one on
    // the same key usually answers immediately.
    if (isRateLimited(msg)) {
      const candidates = (await discoverModelList(provider)).filter((id) => id !== model).slice(0, 3);
      for (const alt of candidates) {
        try {
          const text = await attempt(alt);
          MODEL_CACHE.set(provider.id, alt);
          logger.warn({ provider: provider.id, from: model, to: alt }, "llm: rate-limited model, switched");
          return { text, model: alt, ms: Date.now() - started, healed: true };
        } catch {
          continue;
        }
      }
    }
    throw err;
  }
}

/** Chat-capable models for a provider, preference-ordered, de-duplicated. */
async function discoverModelList(provider: LlmProviderInfo): Promise<string[]> {
  const available = (await listProviderModels(provider)).filter((id) => !NOT_CHAT.test(id));
  const pref = MODEL_PREFERENCE[provider.id] ?? [];
  const ordered: string[] = [];
  for (const wanted of pref) {
    for (const id of available) {
      if (id.toLowerCase().includes(wanted.toLowerCase()) && !ordered.includes(id)) ordered.push(id);
    }
  }
  for (const id of available) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

/** Model ids this key can actually use (for the panel / diagnostics). */
export async function availableModelsFor(providerId: string): Promise<string[]> {
  const providers = await listConfiguredProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return [];
  return (await listProviderModels(provider)).filter((id) => !NOT_CHAT.test(id));
}

async function callOpenAiCompatible(
  provider: LlmProviderInfo,
  messages: LlmMessage[],
  temperature = 0.6,
  maxTokens = 1400,
  timeoutMs = TIMEOUT_MS,
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
    signal: AbortSignal.timeout(timeoutMs),
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
      const out = await completeWithProvider(provider, messages, {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      });
      logger.info({ provider: provider.id, model: out.model, healed: out.healed, ms: Date.now() - started }, "llm: success");
      return { text: out.text, provider: provider.id, model: out.model, ms: Date.now() - started };
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
