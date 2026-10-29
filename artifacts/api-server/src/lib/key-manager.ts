/**
 * CyberNova Auto Key Manager
 *
 * - Tests all configured AI providers every 10 minutes
 * - Auto-revives providers that recover from errors
 * - Tracks provider health in memory
 * - Provides status API for the UI
 * - Integrates 5 free providers: Groq, Mistral, OpenRouter, Together, DeepSeek
 */

import { eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";
import { logger } from "./logger";
import {
  listEnabledProviders,
  markProviderExhausted,
  reviveProvider,
} from "./ai-router-ollama-only";

// Key manager supports more providers than the ollama-only router; use string
type ProviderId = string;

export interface ProviderKeyStatus {
  id: ProviderId;
  displayName: string;
  family: string;
  available: boolean;
  enabled: boolean;
  healthy: boolean | null;
  latencyMs?: number;
  error?: string;
  lastTestedAt?: string;
  freeInfo?: string;
  signupUrl?: string;
}

/** URLs to sign up for free keys */
const SIGNUP_URLS: Partial<Record<ProviderId, string>> = {
  "groq-user": "https://console.groq.com",
  "mistral-user": "https://console.mistral.ai",
  "openrouter-user": "https://openrouter.ai/keys",
  "together-user": "https://api.together.xyz",
  "deepseek-user": "https://platform.deepseek.com",
  "anthropic-user": "https://console.anthropic.com",
  "openai-user": "https://platform.openai.com/api-keys",
  "gemini-user": "https://aistudio.google.com/app/apikey",
};

const healthCache = new Map<ProviderId, ProviderKeyStatus>();
let lastCycleAt: string | null = null;
let isRunning = false;

/** Get the current health snapshot */
export function getKeyManagerStatus(): { lastCycleAt: string | null; providers: ProviderKeyStatus[] } {
  return {
    lastCycleAt,
    providers: Array.from(healthCache.values()),
  };
}

/** Test a specific provider by making a tiny API call */
async function testProvider(id: ProviderId): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    // We use a minimal fetch to the provider's endpoint to check key validity
    const settingKeyMap: Partial<Record<ProviderId, string>> = {
      "groq-user": "groqKey",
      "mistral-user": "mistralKey",
      "openrouter-user": "openrouterKey",
      "together-user": "togetherKey",
      "deepseek-user": "deepseekKey",
      "anthropic-user": "anthropicKey",
      "openai-user": "openaiKey",
      "gemini-user": "geminiKey",
    };
    const envKeyMap: Partial<Record<ProviderId, string>> = {
      "groq-user": "GROQ_API_KEY",
      "mistral-user": "MISTRAL_API_KEY",
      "openrouter-user": "OPENROUTER_API_KEY",
      "together-user": "TOGETHER_API_KEY",
      "deepseek-user": "DEEPSEEK_API_KEY",
      "anthropic-user": "ANTHROPIC_API_KEY",
      "openai-user": "OPENAI_API_KEY",
      "gemini-user": "GEMINI_API_KEY",
    };
    const testEndpoints: Partial<Record<ProviderId, { url: string; authType: "bearer" | "x-api-key" | "gemini" }>> = {
      "groq-user": { url: "https://api.groq.com/openai/v1/models", authType: "bearer" },
      "mistral-user": { url: "https://api.mistral.ai/v1/models", authType: "bearer" },
      "openrouter-user": { url: "https://openrouter.ai/api/v1/models", authType: "bearer" },
      "together-user": { url: "https://api.together.xyz/v1/models", authType: "bearer" },
      "deepseek-user": { url: "https://api.deepseek.com/v1/models", authType: "bearer" },
      "anthropic-user": { url: "https://api.anthropic.com/v1/models", authType: "x-api-key" },
      "openai-user": { url: "https://api.openai.com/v1/models", authType: "bearer" },
    };

    const settingKey = settingKeyMap[id];
    const envKey = envKeyMap[id];
    if (!settingKey && !envKey) {
      // Replit or Ollama providers — skip direct test
      return { healthy: true, latencyMs: 0 };
    }

    const apiKey = settingKey
      ? ((await db.select().from(settings).where(eq(settings.key, settingKey)))[0]?.value ?? "")
      : "";
    const finalKey = apiKey || (envKey ? (process.env[envKey] ?? "") : "");

    if (!finalKey) {
      return { healthy: false, latencyMs: Date.now() - start, error: "No API key configured" };
    }

    const endpoint = testEndpoints[id];
    if (!endpoint) {
      return { healthy: true, latencyMs: Date.now() - start };
    }

    const headers: Record<string, string> = {
      "User-Agent": "CyberNova-KeyManager/2.0",
    };
    if (endpoint.authType === "bearer") {
      headers["Authorization"] = `Bearer ${finalKey}`;
    } else if (endpoint.authType === "x-api-key") {
      headers["x-api-key"] = finalKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (endpoint.authType === "gemini") {
      endpoint.url = `${endpoint.url}?key=${finalKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(endpoint.url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    // 200 = key works, 401 = key invalid, 403 = key invalid, 429 = rate limited (key valid)
    if (resp.status === 200 || resp.status === 429) {
      return { healthy: true, latencyMs };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { healthy: false, latencyMs, error: `Invalid API key (HTTP ${resp.status})` };
    }
    // Other statuses treat as unknown
    return { healthy: true, latencyMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { healthy: false, latencyMs: Date.now() - start, error: msg.slice(0, 200) };
  }
}

/** Run a full health check cycle */
export async function runKeyManagerCycle(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const providers = await listEnabledProviders();
    const now = new Date().toISOString();

    for (const p of providers) {
      if (!p.available) {
        healthCache.set(p.id, {
          id: p.id,
          displayName: p.displayName ?? p.id,
          family: p.family,
          available: false,
          enabled: p.enabled,
          healthy: null,
          freeInfo: p.freeInfo,
          signupUrl: SIGNUP_URLS[p.id],
          lastTestedAt: now,
        });
        continue;
      }

      const { healthy, latencyMs, error } = await testProvider(p.id);

      if (healthy && p.exhaustedUntil) {
        // Provider recovered — revive it
        reviveProvider(p.id);
        logger.info({ provider: p.id }, "Provider recovered, revived from exhaustion");
      } else if (!healthy && !p.exhaustedUntil) {
        markProviderExhausted(p.id, error ?? "Health check failed");
        logger.warn({ provider: p.id, error }, "Provider marked exhausted after health check failure");
      }

      healthCache.set(p.id, {
        id: p.id,
        displayName: p.displayName ?? p.id,
        family: p.family,
        available: p.available,
        enabled: p.enabled,
        healthy,
        latencyMs,
        error,
        freeInfo: p.freeInfo,
        signupUrl: SIGNUP_URLS[p.id],
        lastTestedAt: now,
      });
    }

    lastCycleAt = now;
    logger.info({ cycle: now }, "Key manager cycle complete");
  } catch (err) {
    logger.error({ err }, "Key manager cycle error");
  } finally {
    isRunning = false;
  }
}

/** Save a new key to DB settings */
export async function saveProviderKey(providerId: ProviderId, key: string): Promise<void> {
  const settingKeyMap: Partial<Record<ProviderId, string>> = {
    "groq-user": "groqKey",
    "mistral-user": "mistralKey",
    "openrouter-user": "openrouterKey",
    "together-user": "togetherKey",
    "deepseek-user": "deepseekKey",
    "anthropic-user": "anthropicKey",
    "openai-user": "openaiKey",
    "gemini-user": "geminiKey",
  };
  const settingKey = settingKeyMap[providerId];
  if (!settingKey) throw new Error(`No setting key for provider ${providerId}`);

  await db
    .insert(settings)
    .values({ key: settingKey, value: key.trim() })
    .onConflictDoUpdate({ target: settings.key, set: { value: key.trim(), updatedAt: new Date() } });

  // Clear any exhaustion so the provider is immediately tried
  reviveProvider(providerId);
}

/** Delete a provider's key */
export async function deleteProviderKey(providerId: ProviderId): Promise<void> {
  const settingKeyMap: Partial<Record<ProviderId, string>> = {
    "groq-user": "groqKey",
    "mistral-user": "mistralKey",
    "openrouter-user": "openrouterKey",
    "together-user": "togetherKey",
    "deepseek-user": "deepseekKey",
    "anthropic-user": "anthropicKey",
    "openai-user": "openaiKey",
    "gemini-user": "geminiKey",
  };
  const settingKey = settingKeyMap[providerId];
  if (!settingKey) return;
  await db.delete(settings).where(eq(settings.key, settingKey));
}

/** Start the background auto-refresh loop (call once on server start) */
export function startKeyManagerLoop(): void {
  // Run immediately
  void runKeyManagerCycle();

  // Then every 10 minutes
  setInterval(() => {
    void runKeyManagerCycle();
  }, 10 * 60 * 1000);

  logger.info("Key manager started (10-minute refresh cycle)");
}
