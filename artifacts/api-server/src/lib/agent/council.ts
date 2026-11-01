/**
 * NOVA — The Council (multi-model deliberation)
 * ─────────────────────────────────────────────
 * One model can be confidently wrong. Several models disagreeing is a *signal*:
 * it tells you where the answer is uncertain, and which part to verify with a
 * real tool before trusting it.
 *
 * This module runs the same question past every model that is actually
 * configured (each one costs nothing on its free tier), in parallel, then:
 *
 *   1. Cross-checks the answers against each other (lexical agreement score).
 *   2. Asks a *different* model to judge them — not the author of the best
 *      answer, so it cannot simply nod at its own text.
 *   3. Returns one final answer plus the list of disagreements, so NOVA can say
 *      "the models agree here, and they split here — that is what we verify
 *      with a tool" instead of pretending to be certain.
 *
 * Honest limits, stated once and never blurred:
 *   • Council members are free-tier models. Their disagreement highlights risk;
 *     it does not make a finding true.
 *   • Nothing here "finds zero-days". A zero-day is proved by evidence from real
 *     execution (recon tools, crash analysis, differential testing) and by
 *     reproducing it. The council is a *thinking accelerator*, the tools are the
 *     proof.
 *   • With zero keys configured there is nothing to ask, and this returns a
 *     clear, actionable error instead of a fake answer.
 */

import { listConfiguredProviders, completeWithProvider, type LlmMessage, type LlmProviderInfo } from "./llm";
import { logger } from "../logger";

export interface CouncilMemberAnswer {
  provider: string;
  label: string;
  model: string;
  ok: boolean;
  text: string;
  ms: number;
  error?: string;
}

export interface CouncilReport {
  ok: boolean;
  question: string;
  members: CouncilMemberAnswer[];
  /** 0..1 — rough lexical overlap between members. Low means "verify this". */
  agreement: number;
  agreementLabel: "متوافقون" | "اختلاف جزئي" | "اختلاف كبير" | "صوت واحد";
  /** The judge model that produced `answer` (null when only one member answered). */
  judge: { provider: string; model: string } | null;
  /** Final answer, ready to show. */
  answer: string;
  /** Points where members disagreed — what deserves a real tool check. */
  disagreements: string[];
  ms: number;
  /** Present when ok=false. */
  error?: string;
  hint?: string;
}

const MEMBER_TIMEOUT_MS = Number(process.env.NOVA_COUNCIL_TIMEOUT_MS || 30_000);
const DEFAULT_MEMBERS = Number(process.env.NOVA_COUNCIL_MEMBERS || 3);

/** Providers that can actually be asked right now, fastest-first. */
const PRIORITY = ["groq", "cerebras", "github-models", "openrouter", "gemini", "mistral", "together", "openai", "ollama"];

export async function councilMembers(limit = DEFAULT_MEMBERS): Promise<LlmProviderInfo[]> {
  const all = await listConfiguredProviders();
  const ranked = [...all].sort((a, b) => {
    const ia = PRIORITY.indexOf(a.id);
    const ib = PRIORITY.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return ranked.slice(0, Math.max(1, limit));
}

/** One provider, one answer, hard deadline. Never throws. */
async function askOne(
  provider: LlmProviderInfo,
  messages: LlmMessage[],
  temperature: number,
): Promise<CouncilMemberAnswer> {
  const started = Date.now();
  const base = { provider: provider.id, label: provider.label, model: provider.model };
  try {
    // completeWithProvider also self-heals a retired model id (404 → discover →
    // retry), so one dead model name cannot silently remove a council seat.
    const out = await completeWithProvider(provider, messages, {
      temperature,
      maxTokens: 1600,
      timeoutMs: MEMBER_TIMEOUT_MS,
    });
    return { ...base, model: out.model, ok: true, text: out.text, ms: Date.now() - started };
  } catch (err) {
    return { ...base, ok: false, text: "", ms: Date.now() - started, error: String((err as Error).message).slice(0, 200) };
  }
}

async function openAiChat(provider: LlmProviderInfo, messages: LlmMessage[], temperature: number): Promise<string> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({ model: provider.model, messages, temperature, max_tokens: 1600 }),
    signal: AbortSignal.timeout(MEMBER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${provider.id} HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 140)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`${provider.id}: empty response`);
  return text.trim();
}

async function ollamaChat(provider: LlmProviderInfo, messages: LlmMessage[], temperature: number): Promise<string> {
  const res = await fetch(`${provider.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
    body: JSON.stringify({ model: provider.model, messages, stream: false, options: { temperature, num_predict: 1600 } }),
    signal: AbortSignal.timeout(MEMBER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content ?? "";
  if (!text.trim()) throw new Error("ollama: empty response");
  return text.trim();
}

/* ── agreement scoring (cheap, deterministic, no extra API call) ─────────── */

const STOP = new Set(
  "the a an and or of to in is are was were be been for on at by with from this that it as not no yes ou et un une le la les де и не в на".split(
    " ",
  ),
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Mean Jaccard overlap across every pair of members. 1 = same words. */
function agreementScore(answers: CouncilMemberAnswer[]): number {
  const sets = answers.filter((a) => a.ok && a.text).map((a) => tokens(a.text));
  if (sets.length < 2) return answers.length === 1 ? 1 : 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      let inter = 0;
      for (const w of a) if (b.has(w)) inter++;
      const union = a.size + b.size - inter;
      sum += union > 0 ? inter / union : 0;
      pairs++;
    }
  }
  return pairs > 0 ? Number((sum / pairs).toFixed(2)) : 0;
}

function labelFor(score: number, count: number): CouncilReport["agreementLabel"] {
  if (count < 2) return "صوت واحد";
  if (score >= 0.45) return "متوافقون";
  if (score >= 0.22) return "اختلاف جزئي";
  return "اختلاف كبير";
}

/**
 * Pull the disagreement bullets out of a judge reply.
 * Prefers the "## الاختلاف" section and stops at the next heading, so the final
 * answer never leaks into the list of open questions.
 */
function extractDisagreements(text: string): string[] {
  const headings = [...text.matchAll(/^#{1,4}\s*(.+)$/gm)];
  const start = headings.find((h) => /اختلاف|disagree/i.test(h[1]));
  let body = "";
  if (start && start.index !== undefined) {
    const after = headings.find((h) => (h.index ?? 0) > start.index!);
    body = text.slice(start.index! + start[0].length, after?.index ?? text.length);
  } else {
    body = text;
  }
  const out: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^[\s\-*•\d.)]+/, "").trim();
    if (line.startsWith("#")) continue;
    if (line.length > 12 && line.length < 300) out.push(line);
    if (out.length >= 6) break;
  }
  return out;
}

const JUDGE_INSTRUCTIONS = `أنت الآن **قاضي مجلس نماذج** — مهمتك ليست الإجابة من جديد، بل الحكم على إجابات عدة نماذج.

أمامك سؤال المستخدم وإجابات النماذج. اكتب ردك بهذا الشكل بالحرف:

## الحكم
(أي إجابة هي الأصح ولماذا — سطرين كحد أقصى، واذكر اسم النموذج)

## الاتفاق
(النقاط التي اتفقت عليها النماذج — نقاط قصيرة)

## الاختلاف
(النقاط التي اختلفت فيها — كل نقطة في سطر، واذكر ما يجب التحقق منه بأداة حقيقية)

## الإجابة النهائية
(الإجابة الكاملة الموثوقة، بصوت نوفا: مباشر، دقيق، بلا حشو. لو أي جزء غير مؤكد قل ذلك صراحةً بدل تخمينه)

قواعد: لا تخترع معلومات جديدة. إن كانت كل الإجابات ضعيفة قل ذلك. الرد بالعربية إلا لو سأل المستخدم بغيرها.`;

/**
 * Run the council: parallel answers → different model judges → one answer.
 * Falls back to the best single answer when only one model is available.
 */
export async function runCouncil(
  messages: LlmMessage[],
  opts: { members?: number; temperature?: number; system?: string } = {},
): Promise<CouncilReport> {
  const started = Date.now();
  const question = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const members = await councilMembers(opts.members ?? DEFAULT_MEMBERS);
  const usable = members.filter((m) => m.kind === "openai-compatible" || m.id === "ollama");

  if (usable.length === 0) {
    return {
      ok: false,
      question,
      members: [],
      agreement: 0,
      agreementLabel: "صوت واحد",
      judge: null,
      answer: "",
      disagreements: [],
      ms: Date.now() - started,
      error: "مفيش أي نموذج لغوي متاح — المجلس محتاج مفتاح واحد على الأقل.",
      hint: "أسهل مفتاح مجاني: GROQ_API_KEY من console.groq.com (بدون كارت) · أو GEMINI_API_KEY من aistudio.google.com · أو GITHUB_MODELS_TOKEN لو عندك توكن GitHub.",
    };
  }

  const withSystem: LlmMessage[] = opts.system
    ? [{ role: "system", content: opts.system }, ...messages.filter((m) => m.role !== "system")]
    : messages;

  const answers = await Promise.all(
    usable.map((p) => askOne(p, withSystem, opts.temperature ?? 0.4)),
  );

  const good = answers.filter((a) => a.ok && a.text);
  const agreement = agreementScore(good);
  const agreementLabel = labelFor(agreement, good.length);

  if (good.length === 0) {
    return {
      ok: false,
      question,
      members: answers,
      agreement: 0,
      agreementLabel,
      judge: null,
      answer: "",
      disagreements: [],
      ms: Date.now() - started,
      error: "كل النماذج فشلت في الرد.",
      hint: answers.map((a) => `${a.provider}: ${a.error}`).join(" · ").slice(0, 400),
    };
  }

  // A single voice needs no judge.
  if (good.length === 1) {
    return {
      ok: true,
      question,
      members: answers,
      agreement: 1,
      agreementLabel: "صوت واحد",
      judge: null,
      answer: good[0].text,
      disagreements: [],
      ms: Date.now() - started,
      hint: "نموذج واحد متاح — ضيف مفتاح تاني والمجلس يبقى تصويت حقيقي.",
    };
  }

  // Judge = a model that is NOT the longest answer's author, when possible.
  const longest = [...good].sort((a, b) => b.text.length - a.text.length)[0];
  const judgeCandidates = usable.filter((p) => p.id !== longest.provider);
  const judgeProvider = judgeCandidates[0] ?? usable[0];

  const brief = good
    .map((a, i) => `### نموذج ${i + 1} — ${a.provider} (${a.model})\n${a.text.slice(0, 2600)}`)
    .join("\n\n");

  const judgeMessages: LlmMessage[] = [
    { role: "system", content: JUDGE_INSTRUCTIONS },
    { role: "user", content: `## سؤال المستخدم\n${question.slice(0, 4000)}\n\n## إجابات النماذج\n${brief}` },
  ];

  const verdict = await askOne(judgeProvider, judgeMessages, 0.2);

  if (!verdict.ok || !verdict.text) {
    logger.warn({ provider: judgeProvider.id, err: verdict.error }, "council judge failed — using longest answer");
    return {
      ok: true,
      question,
      members: answers,
      agreement,
      agreementLabel,
      judge: null,
      answer: longest.text,
      disagreements: [],
      ms: Date.now() - started,
      hint: `القاضي (${judgeProvider.id}) فشل، فالعرض ده أطول إجابة. ${verdict.error ?? ""}`.trim(),
    };
  }

  return {
    ok: true,
    question,
    members: answers,
    agreement,
    agreementLabel,
    judge: { provider: verdict.provider, model: verdict.model },
    answer: verdict.text,
    disagreements: extractDisagreements(verdict.text),
    ms: Date.now() - started,
  };
}

/**
 * Race every provider and return the first usable answer.
 * Same quality gate as the sequential path, but a dead provider no longer costs
 * a full timeout before the next one is tried.
 */
export async function fastComplete(
  messages: LlmMessage[],
  opts: { temperature?: number } = {},
): Promise<{ text: string; provider: string; model: string; ms: number; losers: string[] } | null> {
  const started = Date.now();
  const members = await councilMembers(9);
  if (members.length === 0) return null;

  const losers: string[] = [];
  return new Promise((resolve) => {
    let settled = false;
    let done = 0;

    const finish = (value: Awaited<ReturnType<typeof fastComplete>>) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    for (const provider of members) {
      void askOne(provider, messages, opts.temperature ?? 0.6).then((res) => {
        done++;
        if (res.ok && res.text) {
          finish({ text: res.text, provider: res.provider, model: res.model, ms: Date.now() - started, losers: [...losers] });
        } else {
          losers.push(`${res.provider}: ${res.error ?? "no answer"}`);
        }
        if (done === members.length) finish(null);
      });
    }
  });
}

/**
 * Ping every council seat with one real request and report the truth.
 *
 * Why this exists: a dashboard that only checks "is a key set?" will happily
 * show four green lights for four revoked keys. This asks each model a trivial
 * question and reports the HTTP outcome and real latency, so a wrong key is
 * visible in seconds instead of after a confusing reply.
 */
export async function pingCouncil(): Promise<{
  ok: boolean;
  seats: Array<{ provider: string; model: string; ok: boolean; ms: number; detail: string }>;
  working: number;
  total: number;
  verdict: string;
}> {
  const members = await councilMembers(9);
  const pinged = await Promise.all(
    members.map(async (p) => {
      // Same code path as a real council call, so the ping cannot disagree with
      // what the council will actually do — including model auto-healing.
      const res = await askOne(p, [{ role: "user", content: "Reply with the single word: OK" }], 0);
      return {
        provider: res.provider,
        model: res.model,
        ok: res.ok,
        ms: res.ms,
        detail: res.ok ? res.text.slice(0, 40) || "ok" : (res.error ?? "failed"),
      };
    }),
  );

  const working = pinged.filter((p) => p.ok).length;
  const verdict =
    working >= 3
      ? `المجلس جاهز للتصويت: ${working} نماذج ردّت فعلاً.`
      : working === 2
        ? "نموذجان بيردّوا فعلاً — تصويت + حكم متبادل، كفاية."
        : working === 1
          ? "نموذج واحد بيرد فعلاً. الباقي مفتاحه غلط أو منتهي أو الحصة خلصت."
          : "مفيش أي نموذج بيرد — راجع المفاتيح في ملف .env (لازم تبقى صح ومفعّلة).";

  return { ok: working > 0, seats: pinged, working, total: pinged.length, verdict };
}
