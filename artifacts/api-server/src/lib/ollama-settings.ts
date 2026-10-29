/**
 * Centralized Ollama settings reader.
 * Reads ollamaBaseUrl and ollamaModel from the DB (with 15s cache).
 * All server-side code should use these helpers — never hardcode the URL.
 */

import { db, settings } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "dolphin-llama3";

interface OllamaSettings {
  baseUrl: string;
  model: string;
  cachedAt: number;
}

let _cache: OllamaSettings | null = null;
const CACHE_TTL = 15_000; // 15 seconds

async function readFromDb(): Promise<OllamaSettings> {
  const rows = await db.select().from(settings);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  return {
    baseUrl: (map.ollamaBaseUrl?.startsWith("http") ? map.ollamaBaseUrl : process.env.OLLAMA_BASE_URL ?? DEFAULT_URL).replace(/\/$/, ""),
    model: map.ollamaModel?.trim() || process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    cachedAt: Date.now(),
  };
}

async function getCached(): Promise<OllamaSettings> {
  if (_cache && Date.now() - _cache.cachedAt < CACHE_TTL) return _cache;
  try {
    _cache = await readFromDb();
  } catch {
    _cache = {
      baseUrl: (process.env.OLLAMA_BASE_URL ?? DEFAULT_URL).replace(/\/$/, ""),
      model: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
      cachedAt: Date.now(),
    };
  }
  return _cache;
}

/** Invalidate the cache so the next call reads fresh DB values */
export function invalidateOllamaCache(): void {
  _cache = null;
}

export async function getOllamaBaseUrl(): Promise<string> {
  return (await getCached()).baseUrl;
}

export async function getOllamaModel(): Promise<string> {
  return (await getCached()).model;
}

export async function getOllamaSettings(): Promise<{ baseUrl: string; model: string }> {
  const c = await getCached();
  return { baseUrl: c.baseUrl, model: c.model };
}
