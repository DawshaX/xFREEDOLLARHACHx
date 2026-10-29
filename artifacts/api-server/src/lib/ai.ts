/**
 * Ollama-only AI resolver.
 * All chats use the local Ollama server at http://127.0.0.1:11434
 * No external providers (Anthropic, OpenAI, Gemini, etc.) are used.
 */

import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";

import { getOllamaBaseUrl, getOllamaModel as getOllamaModelSetting } from "./ollama-settings";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "dolphin-llama3";

export type Provider = "ollama";

export interface ResolvedAi {
  client: OpenAI;
  model: string;
  provider: Provider;
  isOpenAI: true;
}

async function getSetting(key: string): Promise<string | undefined> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, key));
    return rows[0]?.value;
  } catch {
    return undefined;
  }
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Returns an OpenAI-compatible client pointing to local Ollama.
 * Used by all chat routes (anthropic.ts, kaligpt.ts, bot.ts, etc.)
 */
export async function resolveAi(): Promise<ResolvedAi> {
  const base = await getOllamaBaseUrl();
  const model = await getOllamaModelSetting();

  const client = new OpenAI({
    apiKey: "ollama",
    baseURL: `${base}/v1`,
  });

  return { client, model, provider: "ollama", isOpenAI: true };
}

/**
 * Provider status — only Ollama is supported.
 */
export async function getProviderStatus(): Promise<
  Array<{ provider: string; configured: boolean; lastError?: string }>
> {
  const base = await getOllamaBaseUrl();
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
  return [
    {
      provider: "ollama",
      configured: available,
      ...(available ? {} : { lastError: "Ollama not reachable at " + base }),
    },
  ];
}

export async function markProviderFailed(_provider: string, _reason: string): Promise<void> {
  // no-op for Ollama-only setup
}

// Ensure default values exist in DB — only inserts if the key is NOT already set.
// This preserves any user-configured URL/model from the Settings page.
async function setSettingIfMissing(key: string, value: string): Promise<void> {
  const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (existing.length === 0) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing();
  }
}

export async function forceOllamaDefault(): Promise<void> {
  try {
    // Only write defaults for keys that don't exist yet — never overwrite user changes
    await setSettingIfMissing("provider", "ollama");
    await setSettingIfMissing("ollamaBaseUrl", OLLAMA_BASE_URL);
    await setSettingIfMissing("ollamaModel", OLLAMA_MODEL);
    await setSettingIfMissing("provider_ollama-local_enabled", "true");
  } catch {
    // ignore
  }
}
