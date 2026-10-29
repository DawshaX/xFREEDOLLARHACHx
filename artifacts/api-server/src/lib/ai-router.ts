/**
 * Ollama-only AI router for local Llama3 model.
 *
 * Supports:
 *   - Ollama (local Llama3 model)
 *
 * Public API:
 *   - listEnabledProviders(): provider snapshot for the UI
 *   - streamPlainText({...}): text streaming with Ollama
 *   - chatWithTools({...}): tool-calling loop with Ollama
 */

import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { db, settings, botMemory } from "@workspace/db";
import type { ToolDef } from "./tools";

export type ProviderId = "ollama-local";

export interface ProviderInfo {
  id: ProviderId;
  family: "ollama";
  source: "local";
  available: boolean;
  enabled: boolean;
  exhaustedUntil?: number;
  lastError?: string;
  displayName?: string;
  freeInfo?: string;
}

/** Cached availability of the Ollama server (re-checked every 60s). */
let ollamaCache: { available: boolean; checkedAt: number } = {
  available: false,
  checkedAt: 0,
};

/** Get the Ollama base URL — reads user-configured URL from DB first */
async function getOllamaBase(): Promise<string> {
  const fromDb = await getSetting("ollamaBaseUrl");
  return (fromDb || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (now - ollamaCache.checkedAt < 60_000) return ollamaCache.available;
  const base = await getOllamaBase();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    ollamaCache = { available: r.ok, checkedAt: now };
  } catch {
    ollamaCache = { available: false, checkedAt: now };
  }
  return ollamaCache.available;
}

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const exhaustionCache = new Map<ProviderId, { until: number; reason: string }>();

/** Detect quota/budget/rate errors that should trigger rotation. */
export function isQuotaError(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { message?: string; type?: string } };
  const status = e?.status ?? 0;
  const msg =
    (e?.message || "") + " " + (e?.error?.message || "") + " " + (e?.error?.type || "");
  if (status === 402 || status === 403 || status === 429) return true;
  return /budget|quota|exceed|tier|rate.?limit|insufficient.?credit|FREE_TIER/i.test(msg);
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

export async function isProviderEnabled(id: ProviderId): Promise<boolean> {
  const v = await getSetting(`provider_${id}_enabled`);
  return v !== "false";
}

export async function setProviderEnabled(id: ProviderId, enabled: boolean): Promise<void> {
  await setSetting(`provider_${id}_enabled`, enabled ? "true" : "false");
}

/** Revive a provider that was previously exhausted */
export function reviveProvider(id: ProviderId): void {
  exhaustionCache.delete(id);
}

async function buildProviderInfo(id: ProviderId): Promise<ProviderInfo> {
  const family: ProviderInfo["family"] = "ollama";
  const source: ProviderInfo["source"] = "local";

  const DISPLAY_NAMES: Record<ProviderId, string> = {
    "ollama-local": "Ollama (Local Llama3)",
  };

  let available = false;
  if (id === "ollama-local") {
    available = await isOllamaAvailable();
  }

  const enabled = await isProviderEnabled(id);
  const ex = exhaustionCache.get(id);
  const now = Date.now();
  if (ex && ex.until > now) {
    return {
      id, family, source, available, enabled,
      exhaustedUntil: ex.until,
      lastError: ex.reason,
      displayName: DISPLAY_NAMES[id],
    };
  }
  if (ex) exhaustionCache.delete(id);
  return { id, family, source, available, enabled, displayName: DISPLAY_NAMES[id] };
}

const ALL_PROVIDERS: ProviderId[] = ["ollama-local"];

export async function listEnabledProviders(): Promise<ProviderInfo[]> {
  return Promise.all(ALL_PROVIDERS.map((id) => buildProviderInfo(id)));
}

/** Get providers usable RIGHT NOW (available + enabled + not exhausted). */
async function getUsableProviders(): Promise<ProviderInfo[]> {
  const all = await listEnabledProviders();
  return all.filter((p) => p.available && p.enabled && !p.exhaustedUntil);
}

export function markProviderExhausted(id: ProviderId, reason: string): void {
  exhaustionCache.set(id, { until: Date.now() + COOLDOWN_MS, reason: reason.slice(0, 300) });
  void (async () => {
    try {
      await db.insert(botMemory).values({
        memoryType: "error_pattern",
        key: `provider_exhausted_${id}`,
        content: `Provider ${id} cooldown for 1h: ${reason.slice(0, 1000)}`,
        context: "auto-rotation",
        tags: "provider,quota,auto",
      });
    } catch {
      // ignore
    }
  })();
}

// ---------------------------------------------------------------------------
// Client builders
// ---------------------------------------------------------------------------

async function buildOllamaClient(): Promise<OpenAI> {
  const base = await getOllamaBase();
  return new OpenAI({ apiKey: "ollama", baseURL: `${base}/v1` });
}

// ---------------------------------------------------------------------------
// Default models per family
// ---------------------------------------------------------------------------

export const DEFAULT_MODELS: Record<ProviderInfo["family"], string> = {
  ollama: process.env.OLLAMA_MODEL || "dolphin-llama3",
};

async function modelFor(family: ProviderInfo["family"]): Promise<string> {
  const userModel = await getSetting(`model_${family}`);
  if (userModel) return userModel;
  return DEFAULT_MODELS[family];
}

/** Build an OpenAI-compatible client for a given provider */
async function buildClientForProvider(_provider: ProviderInfo): Promise<{ client: OpenAI; isAnthropic: boolean }> {
  const client = await buildOllamaClient();
  return { client, isAnthropic: false };
}

// ---------------------------------------------------------------------------
// Plain text streaming (no tools)
// ---------------------------------------------------------------------------

export interface PlainMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamPlainOpts {
  system: string;
  messages: PlainMessage[];
  maxTokens?: number;
  onText?: (delta: string) => void;
}

export interface StreamPlainResult {
  text: string;
  provider: ProviderInfo;
}

export async function streamPlainText(opts: StreamPlainOpts): Promise<StreamPlainResult> {
  const usable = await getUsableProviders();
  if (usable.length === 0) {
    const base = await getOllamaBase();
    throw new Error(
      `❌ Ollama غير متاح على ${base}.\n` +
      `تأكد من تشغيل Ollama بـ:\n  OLLAMA_ORIGINS="*" ollama serve`
    );
  }
  const maxTokens = opts.maxTokens ?? 4096;
  const errors: string[] = [];

  for (const provider of usable) {
    try {
      const { client } = await buildClientForProvider(provider);
      const model = await modelFor(provider.family);

      const oc = client as OpenAI;
      const stream = await oc.chat.completions.create({
        model,
        max_completion_tokens: maxTokens,
        stream: true,
        messages: [
          { role: "system", content: opts.system },
          ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      });
      let buf = "";
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) { buf += delta; opts.onText?.(delta); }
      }
      return { text: buf, provider };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${provider.id}] ${msg.slice(0, 200)}`);
      if (isQuotaError(err)) {
        markProviderExhausted(provider.id, msg);
      }
      continue;
    }
  }

  const detail = errors.length ? `\n\nالأخطاء:\n${errors.join("\n")}` : "";
  throw new Error(`❌ Failed to connect to Ollama service.${detail}`);
}

// ---------------------------------------------------------------------------
// Tool calling — unified across providers
// ---------------------------------------------------------------------------

export type ToolMessageRole = "user" | "assistant";

export interface AnthropicLikeMessage {
  role: ToolMessageRole;
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
        | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
      >;
}

export interface ChatToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatRoundResult {
  text: string;
  toolCalls: ChatToolCall[];
  done: boolean;
  provider: ProviderInfo;
  assistantBlocks:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      >;
}

export interface ChatRoundOpts {
  system: string;
  messages: AnthropicLikeMessage[];
  tools: ToolDef[];
  maxTokens?: number;
  onText?: (delta: string) => void;
}

function toOpenAITools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

type OpenAIChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; content: string; tool_call_id: string };

function toOpenAIMessages(system: string, messages: AnthropicLikeMessage[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "user") {
      const textParts: string[] = [];
      for (const block of m.content) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "tool_result") {
          out.push({ role: "tool", tool_call_id: block.tool_use_id, content: block.content });
        }
      }
      if (textParts.length) out.push({ role: "user", content: textParts.join("\n") });
    } else {
      const textParts: string[] = [];
      const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
      for (const block of m.content) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "tool_use") {
          toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
        }
      }
      out.push({ role: "assistant", content: textParts.join("\n") || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    }
  }
  return out;
}

/**
 * Run ONE round of a tool-using chat with Ollama.
 */
export async function chatRoundWithTools(opts: ChatRoundOpts): Promise<ChatRoundResult> {
  const usable = await getUsableProviders();
  if (usable.length === 0) {
    const base = await getOllamaBase();
    throw new Error(
      `❌ Ollama غير متاح على ${base}.\n` +
      `تأكد من تشغيل Ollama بـ:\n  OLLAMA_ORIGINS="*" ollama serve`
    );
  }
  const maxTokens = opts.maxTokens ?? 4096;
  const errors: string[] = [];

  for (const provider of usable) {
    try {
      const model = await modelFor(provider.family);
      const { client } = await buildClientForProvider(provider);
      const oc = client as OpenAI;
      const oaMsgs = toOpenAIMessages(opts.system, opts.messages);
      const response = await oc.chat.completions.create({
        model,
        max_completion_tokens: maxTokens,
        messages: oaMsgs,
        tools: toOpenAITools(opts.tools),
        tool_choice: "auto",
      });
      const choice = response.choices[0];
      const text = choice.message.content || "";
      const toolCalls: ChatToolCall[] = [];
      const blocks: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }> = [];
      if (text) { blocks.push({ type: "text", text }); opts.onText?.(text); }
      for (const tc of choice.message.tool_calls || []) {
        if (tc.type !== "function") continue;
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments || "{}"); } catch { input = {}; }
        const call = { id: tc.id, name: tc.function.name, input };
        toolCalls.push(call);
        blocks.push({ type: "tool_use", ...call });
      }
      return {
        text,
        toolCalls,
        done: choice.finish_reason !== "tool_calls" || toolCalls.length === 0,
        provider,
        assistantBlocks: blocks,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If model doesn't support tools, fallback to plain text without tools
      if (/does not support tool/i.test(msg)) {
        try {
          const plainMsgs: PlainMessage[] = [];
          for (const m of opts.messages) {
            if (typeof m.content === "string") {
              plainMsgs.push({ role: m.role, content: m.content });
            } else {
              const textParts: string[] = [];
              for (const block of m.content) {
                if (block.type === "text") textParts.push(block.text);
                else if (block.type === "tool_result") textParts.push(`[Tool Result: ${block.content}]`);
              }
              plainMsgs.push({ role: m.role, content: textParts.join("\n") });
            }
          }
          const result = await streamPlainText({
            system: opts.system + "\n\nNote: You do not have access to tools. Respond with text only.",
            messages: plainMsgs,
            maxTokens,
            onText: opts.onText,
          });
          return {
            text: result.text,
            toolCalls: [],
            done: true,
            provider: result.provider,
            assistantBlocks: result.text,
          };
        } catch (fallbackErr) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          errors.push(`[${provider.id}] Tool fallback failed: ${fbMsg.slice(0, 200)}`);
          continue;
        }
      }
      errors.push(`[${provider.id}] ${msg.slice(0, 200)}`);
      if (isQuotaError(err)) {
        markProviderExhausted(provider.id, msg);
      }
      continue;
    }
  }

  const detail = errors.length ? `\n\nالأخطاء:\n${errors.join("\n")}` : "";
  throw new Error(`❌ Failed to connect to Ollama service.${detail}`);
}
