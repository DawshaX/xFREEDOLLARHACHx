/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  NOVA MULTI-AI ROUTER  —  Free-Tier Provider Swarm
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Supports (all free-tier / no-pay):
 *   • Groq         — llama-3.1-8b-instant / mixtral-8x7b-32768 (ultra-fast)
 *   • OpenRouter   — meta-llama/llama-3.1-8b-instruct:free + many free models
 *   • Together AI  — meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo (free)
 *   • HuggingFace  — Qwen/Qwen2.5-72B-Instruct, microsoft/Phi-3.5-mini
 *   • Mistral      — mistral-small-latest (free tier)
 *   • Google Gemini— gemini-2.0-flash-lite (generous free quota)
 *   • Ollama Local — any locally installed model (zero cost, always free)
 *
 * Routing strategy:
 *   1. Priority order based on speed + capability
 *   2. Auto-fallback on error / quota
 *   3. Parallel consensus mode: query N providers simultaneously
 *   4. Nova synthesises the best answer herself
 * ══════════════════════════════════════════════════════════════════════════════
 */

import OpenAI from "openai";
import { db, settings, botMemory } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// ── Provider Definitions ─────────────────────────────────────────────────────

export type MultiProviderId =
  | "groq"
  | "openrouter"
  | "together"
  | "huggingface"
  | "mistral"
  | "gemini"
  | "ollama-local";

export interface MultiProviderInfo {
  id: MultiProviderId;
  displayName: string;
  emoji: string;
  description: string;
  baseURL: string;
  envKey: string;
  defaultModel: string;
  freeModels: string[];
  available: boolean;
  enabled: boolean;
  latencyMs?: number;
  lastError?: string;
  exhaustedUntil?: number;
  speed: "ultra" | "fast" | "normal" | "slow";
  specialty: string;
}

const PROVIDER_DEFS: Omit<MultiProviderInfo, "available" | "enabled" | "latencyMs" | "lastError" | "exhaustedUntil">[] = [
  {
    id: "groq",
    displayName: "Groq ⚡",
    emoji: "⚡",
    description: "الأسرع في العالم — LPU inference chip",
    baseURL: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    defaultModel: "llama-3.1-8b-instant",
    freeModels: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"],
    speed: "ultra",
    specialty: "سرعة فائقة، مناسب للأوامر السريعة والتحليل الفوري",
  },
  {
    id: "openrouter",
    displayName: "OpenRouter 🌐",
    emoji: "🌐",
    description: "بوابة لأكثر من 200 نموذج — نماذج مجانية متعددة",
    baseURL: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "meta-llama/llama-3.1-8b-instruct:free",
    freeModels: [
      "meta-llama/llama-3.1-8b-instruct:free",
      "mistralai/mistral-7b-instruct:free",
      "google/gemma-2-9b-it:free",
      "qwen/qwen-2.5-7b-instruct:free",
      "microsoft/phi-3-mini-128k-instruct:free",
    ],
    speed: "fast",
    specialty: "تنوع هائل في النماذج، مجاني 100%",
  },
  {
    id: "together",
    displayName: "Together AI 🤝",
    emoji: "🤝",
    description: "نماذج مفتوحة المصدر بسرعة عالية",
    baseURL: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY",
    defaultModel: "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo",
    freeModels: ["meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"],
    speed: "fast",
    specialty: "نماذج مرئية + نصية، مجاني بحد يومي",
  },
  {
    id: "huggingface",
    displayName: "HuggingFace 🤗",
    emoji: "🤗",
    description: "أكبر مستودع نماذج في العالم",
    baseURL: "https://api-inference.huggingface.co/v1",
    envKey: "HF_TOKEN",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    freeModels: ["Qwen/Qwen2.5-72B-Instruct", "microsoft/Phi-3.5-mini-instruct", "mistralai/Mistral-7B-Instruct-v0.3"],
    speed: "normal",
    specialty: "أكبر اختيار من النماذج، مجاني بحساب HF",
  },
  {
    id: "mistral",
    displayName: "Mistral AI 🇫🇷",
    emoji: "🇫🇷",
    description: "نماذج أوروبية متميزة في الكود والتحليل",
    baseURL: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    defaultModel: "mistral-small-latest",
    freeModels: ["mistral-small-latest", "open-mistral-7b", "open-mixtral-8x7b"],
    speed: "fast",
    specialty: "ممتاز للكود والأمن السيبراني",
  },
  {
    id: "gemini",
    displayName: "Google Gemini ✨",
    emoji: "✨",
    description: "جيميناي من جوجل — مجاني وسريع",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash-lite",
    freeModels: ["gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-flash-8b"],
    speed: "fast",
    specialty: "قدرات multimodal ومجاني بكميات كبيرة",
  },
  {
    id: "ollama-local",
    displayName: "Ollama Local 🏠",
    emoji: "🏠",
    description: "نموذج محلي على جهازك — خصوصية كاملة",
    baseURL: "http://127.0.0.1:11434/v1",
    envKey: "OLLAMA_BASE_URL",
    defaultModel: "dolphin-llama3",
    freeModels: ["dolphin-llama3", "llama3", "mistral", "codellama", "qwen2.5-coder"],
    speed: "slow",
    specialty: "خصوصية تامة، يعمل بدون إنترنت",
  },
];

// ── Cooldown Cache ────────────────────────────────────────────────────────────
const COOLDOWN_MS = 30 * 60 * 1000; // 30 min
const exhaustionCache = new Map<MultiProviderId, { until: number; reason: string }>();

// ── DB helpers ────────────────────────────────────────────────────────────────
async function getSetting(key: string): Promise<string | undefined> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, key));
    return rows[0]?.value;
  } catch { return undefined; }
}

async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(settings).values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

// ── API Key resolution ────────────────────────────────────────────────────────
async function getApiKey(id: MultiProviderId): Promise<string | null> {
  const def = PROVIDER_DEFS.find(p => p.id === id)!;
  // DB first (user can paste key in UI), then env
  const fromDb = await getSetting(`api_key_${id}`);
  if (fromDb && fromDb.trim()) return fromDb.trim();
  const fromEnv = process.env[def.envKey];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  // Ollama doesn't need a key
  if (id === "ollama-local") return "ollama";
  return null;
}

// ── Availability Check ────────────────────────────────────────────────────────
const availCache = new Map<MultiProviderId, { ok: boolean; ts: number }>();

async function checkAvailable(id: MultiProviderId): Promise<boolean> {
  const cached = availCache.get(id);
  if (cached && Date.now() - cached.ts < 60_000) return cached.ok;

  const apiKey = await getApiKey(id);
  if (!apiKey) {
    availCache.set(id, { ok: false, ts: Date.now() });
    return false;
  }

  if (id === "ollama-local") {
    const base = (await getSetting("ollamaBaseUrl")) || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      const ok = r.ok;
      availCache.set(id, { ok, ts: Date.now() });
      return ok;
    } catch {
      availCache.set(id, { ok: false, ts: Date.now() });
      return false;
    }
  }

  // For all other providers, having a key means available
  availCache.set(id, { ok: true, ts: Date.now() });
  return true;
}

// ── Build provider info list ──────────────────────────────────────────────────
export async function listMultiProviders(): Promise<MultiProviderInfo[]> {
  return Promise.all(
    PROVIDER_DEFS.map(async (def) => {
      const available = await checkAvailable(def.id);
      const enabled = (await getSetting(`multi_provider_${def.id}_enabled`)) !== "false";
      const ex = exhaustionCache.get(def.id);
      const now = Date.now();
      return {
        ...def,
        available,
        enabled,
        ...(ex && ex.until > now ? { exhaustedUntil: ex.until, lastError: ex.reason } : {}),
      };
    })
  );
}

export async function setMultiProviderEnabled(id: MultiProviderId, enabled: boolean): Promise<void> {
  await setSetting(`multi_provider_${id}_enabled`, enabled ? "true" : "false");
}

export async function saveProviderApiKey(id: MultiProviderId, key: string): Promise<void> {
  await setSetting(`api_key_${id}`, key);
  availCache.delete(id); // force recheck
}

function markExhausted(id: MultiProviderId, reason: string): void {
  exhaustionCache.set(id, { until: Date.now() + COOLDOWN_MS, reason: reason.slice(0, 300) });
  void db.insert(botMemory).values({
    memoryType: "error_pattern",
    key: `multi_provider_exhausted_${id}`,
    content: `Provider ${id} cooldown 30min: ${reason.slice(0, 500)}`,
    context: "ai-multi-router",
    tags: "provider,quota,auto",
  }).catch(() => {});
}

function isQuotaError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  const status = e?.status ?? 0;
  const msg = (e?.message || "");
  if (status === 402 || status === 403 || status === 429) return true;
  return /budget|quota|exceed|rate.?limit|credit|FREE_TIER|too many/i.test(msg);
}

// ── Build OpenAI-compatible client ───────────────────────────────────────────
async function buildClient(id: MultiProviderId): Promise<OpenAI> {
  const def = PROVIDER_DEFS.find(p => p.id === id)!;
  const apiKey = await getApiKey(id);
  let baseURL = def.baseURL;

  if (id === "ollama-local") {
    const base = (await getSetting("ollamaBaseUrl")) || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    baseURL = `${base}/v1`;
  }

  return new OpenAI({
    apiKey: apiKey || "no-key",
    baseURL,
    defaultHeaders: id === "openrouter" ? {
      "HTTP-Referer": "https://cybernova.app",
      "X-Title": "CyberNova AI",
    } : undefined,
  });
}

async function getModelForProvider(id: MultiProviderId): Promise<string> {
  const custom = await getSetting(`multi_model_${id}`);
  if (custom) return custom;
  const def = PROVIDER_DEFS.find(p => p.id === id)!;
  return def.defaultModel;
}

// ── Get usable providers (priority order) ────────────────────────────────────
async function getUsableProviders(): Promise<MultiProviderInfo[]> {
  const all = await listMultiProviders();
  const PRIORITY_ORDER: MultiProviderId[] = [
    "groq", "openrouter", "mistral", "gemini", "together", "huggingface", "ollama-local"
  ];
  return PRIORITY_ORDER
    .map(id => all.find(p => p.id === id))
    .filter((p): p is MultiProviderInfo => !!p && p.available && p.enabled && !p.exhaustedUntil);
}

// ── Nova system persona ───────────────────────────────────────────────────────
export const NOVA_SYSTEM_PROMPT = `أنتِ نوفا — وكيلة الذكاء الاصطناعي المتكاملة لمنصة CyberNova الأمنية.

شخصيتك:
- ذكية، سريعة، مباشرة — ترد في ثوانٍ
- خبيرة في الأمن السيبراني: اختبار الاختراق، تحليل الثغرات، الطب الشرعي الرقمي
- تفكر بصوت عالٍ: تشرح خطتها قبل التنفيذ
- تتحدث العربية والإنجليزية بطلاقة
- صريحة في قدراتها — لا تتظاهر بمعرفة ما لا تعرفه

قدراتك:
- تحليل الأنظمة وكشف الثغرات
- تنفيذ أوامر shell على جهاز Kali عبر WebSocket
- البحث في قواعد بيانات CVE/CISA/ExploitDB
- كتابة كود Python/Bash/PowerShell للاختبار
- تحليل نتائج nmap/nikto/gobuster/sqlmap
- استشارة نماذج AI متعددة والدمج بينها

عند تلقي طلب:
1. فكّر (🧠 التحليل): ماذا يريد المستخدم؟
2. خطّط (📋 الخطة): ما الخطوات؟
3. نفّذ (⚡ التنفيذ): نفّذ الخطة
4. اشرح (📊 النتيجة): لخّص ما وجدت

دائماً أخبر المستخدم بالنموذج الذي يردّ من خلاله.`;

// ── Stream plain text (single provider) ──────────────────────────────────────
export interface MultiStreamOpts {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  onText?: (delta: string, provider: MultiProviderId) => void;
  onDone?: (text: string, provider: MultiProviderId) => void;
  preferProvider?: MultiProviderId;
}

export async function streamFromBestProvider(opts: MultiStreamOpts): Promise<{ text: string; provider: MultiProviderId }> {
  const usable = await getUsableProviders();

  // Prefer specific provider if requested
  const ordered = opts.preferProvider
    ? [
        ...(usable.filter(p => p.id === opts.preferProvider)),
        ...usable.filter(p => p.id !== opts.preferProvider),
      ]
    : usable;

  if (ordered.length === 0) {
    throw new Error(
      "❌ لا يوجد أي نموذج AI متاح حالياً.\n\n" +
      "لتفعيل نموذج مجاني:\n" +
      "• Groq: احصل على مفتاح من console.groq.com (مجاني)\n" +
      "• OpenRouter: من openrouter.ai (مجاني)\n" +
      "• Gemini: من aistudio.google.com (مجاني)\n\n" +
      "أو شغّل Ollama محلياً: ollama serve"
    );
  }

  const errors: string[] = [];
  const system = opts.system ?? NOVA_SYSTEM_PROMPT;
  const maxTokens = opts.maxTokens ?? 8192;

  for (const provider of ordered) {
    try {
      const client = await buildClient(provider.id);
      const model = await getModelForProvider(provider.id);
      const start = Date.now();

      const stream = await client.chat.completions.create({
        model,
        max_completion_tokens: maxTokens,
        stream: true,
        messages: [
          { role: "system", content: system },
          ...opts.messages,
        ],
      });

      let buf = "";
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          buf += delta;
          opts.onText?.(delta, provider.id);
        }
      }

      const ms = Date.now() - start;
      // Update latency in cache
      const cached = availCache.get(provider.id);
      if (cached) availCache.set(provider.id, { ...cached, ts: Date.now() });
      logger.info({ provider: provider.id, model, ms, chars: buf.length }, "Multi-AI stream complete");

      opts.onDone?.(buf, provider.id);
      return { text: buf, provider: provider.id };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${provider.id}] ${msg.slice(0, 200)}`);
      if (isQuotaError(err)) markExhausted(provider.id, msg);
      logger.warn({ provider: provider.id, err: msg.slice(0, 200) }, "Multi-AI provider failed, trying next");
      continue;
    }
  }

  throw new Error(`❌ فشلت جميع نماذج AI المتاحة:\n${errors.join("\n")}`);
}

// ── Parallel consensus: query multiple providers at once ─────────────────────
export interface ConsensusOpts {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxProviders?: number;
  timeoutMs?: number;
  onChunk?: (provider: MultiProviderId, delta: string) => void;
}

export interface ConsensusResult {
  responses: Array<{ provider: MultiProviderId; text: string; model: string; latencyMs: number }>;
  synthesis: string;
}

export async function queryMultipleProviders(opts: ConsensusOpts): Promise<ConsensusResult> {
  const usable = await getUsableProviders();
  const providers = usable.slice(0, opts.maxProviders ?? 3);

  if (providers.length === 0) throw new Error("لا توجد نماذج AI متاحة");

  const timeout = opts.timeoutMs ?? 30_000;
  const results: ConsensusResult["responses"] = [];

  // Query all in parallel with timeout
  await Promise.allSettled(
    providers.map(async (provider) => {
      const start = Date.now();
      try {
        const client = await buildClient(provider.id);
        const model = await getModelForProvider(provider.id);
        const stream = await client.chat.completions.create({
          model,
          max_completion_tokens: 4096,
          stream: true,
          messages: [
            { role: "system", content: NOVA_SYSTEM_PROMPT },
            ...opts.messages,
          ],
        });

        let text = "";
        const timer = setTimeout(() => { /* stream aborts naturally */ }, timeout);
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            text += delta;
            opts.onChunk?.(provider.id, delta);
          }
        }
        clearTimeout(timer);
        results.push({ provider: provider.id, text, model, latencyMs: Date.now() - start });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isQuotaError(err)) markExhausted(provider.id, msg);
      }
    })
  );

  if (results.length === 0) throw new Error("فشلت جميع النماذج في الاستجابة");

  // Pick the longest/best response as the synthesis (simplest heuristic)
  results.sort((a, b) => b.text.length - a.text.length);
  const synthesis = results[0].text;

  return { responses: results, synthesis };
}

// ── Nova self-awareness: pick best model for task ────────────────────────────
export async function pickBestProviderForTask(taskType: "code" | "analysis" | "fast" | "creative" | "security"): Promise<MultiProviderId | null> {
  const usable = await getUsableProviders();
  if (usable.length === 0) return null;

  const preferences: Record<string, MultiProviderId[]> = {
    code:     ["mistral", "groq", "openrouter", "together", "huggingface", "gemini"],
    analysis: ["gemini", "openrouter", "groq", "together", "mistral", "huggingface"],
    fast:     ["groq", "openrouter", "mistral", "gemini", "together", "huggingface"],
    creative: ["openrouter", "gemini", "together", "groq", "mistral", "huggingface"],
    security: ["groq", "mistral", "openrouter", "gemini", "together", "huggingface"],
  };

  for (const preferred of (preferences[taskType] || preferences.fast)) {
    const found = usable.find(p => p.id === preferred);
    if (found) return found.id;
  }
  return usable[0]?.id ?? null;
}
