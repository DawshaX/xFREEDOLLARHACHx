/**
 * NOVA — Agent Core (plan → execute → explain)
 * ────────────────────────────────────────────
 * One loop, two brains:
 *   • LLM brain  — when Ollama or a free-tier key is reachable, the model writes a
 *                  JSON plan (which tools + args) and later explains the results.
 *   • Heuristic brain — deterministic Arabic/English intent router used when no
 *                  model is reachable. It executes the SAME real tools, so the
 *                  agent keeps working fully offline (GitHub Pages included).
 *
 * Everything is streamed as structured events so the UI can show the agent
 * thinking, calling a tool, and reading its output live.
 */

import { NOVA_SYSTEM_PROMPT, NOVA_SYSTEM_PROMPT_SHORT } from "./persona";
import { buildSelfModel, selfModelPrompt, type SelfModel } from "./self-model";
import {
  AGENT_TOOLS,
  AGENT_TOOL_NAMES,
  runAgentTool,
  toolCatalogueForPrompt,
  extractTarget,
  type ToolRunResult,
} from "./tools";
import { llmComplete, extractJson } from "./llm";
import { saveMemory, getAllMemories } from "../../routes/memory";
import { remember, memoryContextFor, memoryStats, initMemory } from "./memory-store";
import { getMissionsState, recordMissionCommand } from "../standalone-api";
import { broadcastEvent } from "../ws-hub";
import { broadcastLiveEvent } from "./../../routes/live-events";
import { getConnectedAgentList } from "../../routes/local-agent";

export type AgentEvent =
  | { type: "ready"; sessionId: string; mode: "llm" | "heuristic"; provider: string; model: string; tools: number }
  | { type: "thought"; text: string }
  | { type: "plan"; steps: Array<{ tool: string; args: Record<string, unknown> }> }
  | { type: "tool_call"; id: string; name: string; title: string; args: Record<string, unknown>; risk: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; ms: number; dataPreview: string }
  | { type: "confirm_required"; id: string; name: string; title: string; args: Record<string, unknown>; risk: string; reason: string }
  | { type: "delta"; text: string }
  | { type: "memory"; id: string; title: string }
  | { type: "done"; sessionId: string; mode: string; toolCount: number; ms: number; provider: string }
  | { type: "error"; message: string };

/* ── repeat guard ────────────────────────────────────────────────────────── */

/**
 * Measured 2026-11-05 in a live transcript: the same failing step came back
 * turn after turn — `fleet_list` then `fleet_profile`, both red, both for the
 * single reason "no agent is connected". Repeating a call that cannot succeed
 * is not a retry, it is a loop that *looks* like work, and it teaches the user
 * to stop reading the tool bubbles.
 *
 * Three promises, each one testable without a network:
 *   1. identical steps inside one turn run once;
 *   2. a step whose prerequisite already failed is skipped with that reason;
 *   3. a step that failed a minute ago is not re-run unless the human says so.
 */
export const REPEAT_WINDOW_MS = 10 * 60 * 1000;

export interface ToolAttempt {
  at: number;
  ok: boolean;
  summary: string;
}

const attempts = new Map<string, Map<string, ToolAttempt>>();

/** Stable key for "the same call": tool plus its args, key order normalised. */
export function stepSignature(tool: string, args?: Record<string, unknown> | null): string {
  const a = args ?? {};
  const body = Object.keys(a)
    .sort()
    .map((k) => `${k}=${JSON.stringify(a[k])}`)
    .join(",");
  return `${tool}(${body})`;
}

export function recordAttempt(
  sessionId: string,
  tool: string,
  args: Record<string, unknown> | null | undefined,
  ok: boolean,
  summary: string,
  now = Date.now(),
): void {
  let bucket = attempts.get(sessionId);
  if (!bucket) {
    bucket = new Map();
    attempts.set(sessionId, bucket);
  }
  bucket.set(stepSignature(tool, args), { at: now, ok, summary });
}

/** The previous failure for this exact call, if it is still inside the window. */
export function findRecentFailure(
  sessionId: string,
  tool: string,
  args: Record<string, unknown> | null | undefined,
  now = Date.now(),
  windowMs = REPEAT_WINDOW_MS,
): ToolAttempt | undefined {
  const hit = attempts.get(sessionId)?.get(stepSignature(tool, args));
  if (!hit || hit.ok) return undefined;
  if (now - hit.at > windowMs) return undefined;
  return hit;
}

/** "جرب تاني"/"retry" is the human overriding promise 3 — never guess it. */
export function wantsRetry(message: string): boolean {
  return /(?:جرب|جرّب|حاول|اعد|أعد|عيد|كرر|تاني|تانى|مرة\s*تانية|\bretry\b|\bagain\b|try\s+again)/i.test(message);
}

export function resetAttempts(sessionId?: string): void {
  if (sessionId) attempts.delete(sessionId);
  else attempts.clear();
}

/** Steps that cannot possibly work while their prerequisite is down. */
const REQUIRES_AGENT = new Set(["fleet_profile", "fleet_exec"]);

export interface SkipDecision {
  reason: string;
  /** Shown to the user as the thinking line — so it must read as prose. */
  thought: string;
}

/**
 * Decide whether a planned step should be skipped. Pure: the caller records
 * attempts, this only reads them. Never returns a skip for a human-requested
 * retry, so «جرب تاني» always really re-runs.
 */
export function shouldSkipStep(input: {
  sessionId: string;
  tool: string;
  args?: Record<string, unknown> | null;
  title?: string;
  seenThisTurn?: Iterable<string>;
  failedThisTurn?: Map<string, string>;
  retrying?: boolean;
  now?: number;
}): SkipDecision | null {
  const {
    sessionId,
    tool,
    args,
    title,
    seenThisTurn,
    failedThisTurn,
    retrying = false,
    now = Date.now(),
  } = input;
  const signature = stepSignature(tool, args);
  const label = title && title.trim() ? title.trim() : tool;

  if (seenThisTurn) {
    for (const seen of seenThisTurn) {
      if (seen === signature) {
        return {
          reason: `«${label}» مخططة مرتين في نفس الطلب — نفّذتها مرة واحدة، مش هعيدها.`,
          thought: `الخطوة «${label}» مكررة جوه نفس الخطة — بنفّذها مرة واحدة بس وأكمّل.`,
        };
      }
    }
  }

  if (REQUIRES_AGENT.has(tool) && failedThisTurn?.has("fleet_list")) {
    return {
      reason: `«${label}» محتاجة جهاز متصل، و«قائمة الأجهزة» فشلت في نفس الطلب: ${failedThisTurn.get("fleet_list")}`,
      thought: `مش هجرب «${label}» وأنا عارف إن مفيش جهاز متصل — نفس سبب فشل قائمة الأجهزة.`,
    };
  }

  if (!retrying) {
    const prev = findRecentFailure(sessionId, tool, args, now);
    if (prev) {
      const mins = Math.max(1, Math.round((now - prev.at) / 60_000));
      return {
        reason: `«${label}» جرّبتها قبل ${mins} دقيقة بنفس الطلب وفشلت: ${prev.summary} — مش هكررها لوحدي.`,
        thought: `جربت «${label}» قبل ${mins} دقيقة ولسه نفس السبب (${prev.summary}). مش هعيد نفس المحاولة — لو عايز محاولة جديدة اكتب «جرب تاني».`,
      };
    }
  }

  return null;
}

export interface AgentRunOptions {
  sessionId?: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  emit: (event: AgentEvent) => void;
  /** Force the deterministic brain (used by tests / air-gapped mode). */
  forceHeuristic?: boolean;
  maxSteps?: number;
  /**
   * Tools the human has already approved for this turn. Anything that declares
   * `risk: "sensitive"` (running commands on a real machine, killing processes…)
   * is NOT executed until its name shows up here, so the chat can never touch a
   * connected box by surprise — it must ask first and be told "yes".
   */
  approved?: string[];
}

interface PlannedStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentRunResult {
  mode: "llm" | "heuristic";
  provider: string;
  toolsUsed: string[];
  reply: string;
  ms: number;
}

/* ── context ─────────────────────────────────────────────────────────────── */

/** Compact, failure-proof summary of the connected machines. */
function safeFleetSummary(): string {
  try {
    const agents = getConnectedAgentList();
    if (agents.length === 0) return "لا يوجد (شغّل nova-agent.js على أي جهاز لربطه)";
    return `${agents.length} جهاز — ${agents
      .slice(0, 6)
      .map((a) => `${a.hostname}(${a.platform})`)
      .join(", ")}`;
  } catch {
    return "غير متاح";
  }
}

/**
 * Everything NOVA knows before it answers: live platform state + the durable
 * long-term memory (ranked against the current question and target).
 */
function buildContextBlock(query = ""): string {
  const missions = getMissionsState();
  const active = missions[0];
  const stats = memoryStats();
  const longTerm = memoryContextFor(query, active?.target ?? undefined, 8);
  const fleet = safeFleetSummary();
  return [
    `# سياق المنصة الآن`,
    `- الهدف النشط: ${active?.target ?? "غير محدد"} (${active?.name ?? "—"})`,
    `- الأجهزة المتصلة الآن: ${fleet}`,
    `- نتائج مسجلة في المهمة: ${active?.findings.length ?? 0}`,
    `- ذاكرتك طويلة الأمد: ${stats.total} ذكرى (${stats.pinned} مثبتة) — تفضل بعد إعادة التشغيل`,
    longTerm || "# الذاكرة طويلة الأمد فارغة حتى الآن",
  ].join("\n");
}

/* ── heuristic planner (works with zero models) ──────────────────────────── */

const INTENT: Array<{ test: RegExp; tools: (msg: string) => PlannedStep[] }> = [
  {
    test: /(?:نطاقات فرعية|subdomains?|subdomain)/i,
    tools: (msg) => {
      const host = extractTarget(msg);
      return host ? [{ tool: "subdomain_enum", args: { domain: host } }] : [];
    },
  },
  {
    test: /CVE-\d{4}-\d{4,7}/i,
    tools: (msg) => [{ tool: "cve_lookup", args: { cveId: (msg.match(/CVE-\d{4}-\d{4,7}/i) ?? [""])[0] } }],
  },
  {
    test: /(?:منافذ|بورت|ports?)/i,
    tools: (msg) => {
      const host = extractTarget(msg);
      return host ? [{ tool: "port_scan", args: { host } }] : [];
    },
  },
  {
    test: /(?:شهادة|ssl|tls|certificate)/i,
    tools: (msg) => {
      const host = extractTarget(msg);
      return host ? [{ tool: "tls_audit", args: { host } }] : [];
    },
  },
  {
    test: /(?:ترويسات|headers?|hsts|csp)/i,
    tools: (msg) => {
      const host = extractTarget(msg);
      return host ? [{ tool: "http_headers_audit", args: { host } }] : [];
    },
  },
  {
    test: /(?:افحص|فحص|استطلاع|recon|scan|حلل|analyse|analyze)/i,
    tools: (msg) => {
      const host = extractTarget(msg);
      if (!host) return [];
      const steps: PlannedStep[] = [
        { tool: "set_active_target", args: { target: host } },
        { tool: "recon_target", args: { target: host } },
      ];
      if (/(?:منافذ|بورت|ports?)/i.test(msg)) steps.push({ tool: "port_scan", args: { host } });
      if (/(?:نطاقات|subdomain)/i.test(msg)) steps.push({ tool: "subdomain_enum", args: { domain: host } });
      return steps;
    },
  },
  {
    test: /(?:exploit|poc|استغلال)/i,
    tools: (msg) => [{ tool: "exploit_search", args: { query: cleanQuery(msg) } }],
  },
  {
    test: /github/i,
    tools: (msg) => [{ tool: "github_search", args: { query: cleanQuery(msg) } }],
  },

  {
    test: /(?:منتديات|منتدى|forum|منتدى هاكرز|هاكرز)/i,
    tools: (msg) => [{ tool: "forum_search", args: { query: cleanQuery(msg), limit: 8 } }],
  },
  {
    test: /(?:ثغرات|ثغرة|vulnerab|cve)/i,
    tools: (msg) => [{ tool: "vuln_search", args: { keyword: cleanQuery(msg), limit: 8 } }],
  },
  {
    test: /(?:أدوات|ادوات|kali|أداة|tool)/i,
    tools: (msg) => [{ tool: "kali_toolbox", args: { query: cleanQuery(msg), target: extractTarget(msg) ?? undefined } }],
  },
  {
    // "run `uname -a` on the machines" → real fleet_exec (gated by approval).
    // «الأسطول» is the word the panel itself uses for the fleet, and it was
    // missing here — so "كم جهاز في الأسطول؟" fell through to the generic
    // context plan. Same class of gap as the bare-domain search hijack.
    test: /(?:الأجهزة|الاجهزة|أجهزة|اجهزة|الماكينات|ماكينات|الأسطول|اسطول|أسطول|devices?|fleet|كمبيوتر|computers?|سيرفرات|servers?|remote|ريموت)/i,
    tools: (msg) => {
      const cmd = extractFleetCommand(msg);
      // A profile or a remote command needs a machine to exist first. Planning
      // the pair when nothing is connected produces two red bubbles for ONE
      // cause — measured in a live transcript on 2026-11-05. With no agent we
      // plan the single honest step and let the answer carry the install
      // command, instead of pretending to try twice.
      const connected = getConnectedAgentList().length > 0;
      if (!cmd) {
        return connected
          ? [{ tool: "fleet_list", args: {} }, { tool: "fleet_profile", args: {} }]
          : [{ tool: "fleet_list", args: {} }];
      }
      return connected
        ? [{ tool: "fleet_list", args: {} }, { tool: "fleet_exec", args: { command: cmd } }]
        : [{ tool: "fleet_list", args: {} }];
    },
  },
  {
    // A bare "نفّذ `whoami`" with no machine mentioned still means the fleet.
    test: /(?:نفّذ|نفذ|شغّل|شغل|اعمل|run|execute|exec)\s+(?:الأمر|الامر|command|دي|ده|كود|امر|أمر)?\s*`[^`]+`/i,
    tools: (msg) => {
      const cmd = extractFleetCommand(msg);
      return cmd ? [{ tool: "fleet_exec", args: { command: cmd } }] : [];
    },
  },
  {
    // Recall must be checked BEFORE save, otherwise "تفتكر ايه عني" (what do you
    // remember about me?) matches the save verb "افتكر" and stores a memory.
    test: /(?:تفتكر|تتذكر|فاكر|فاتكر|تذكر|\bذكرى|ذاكرت|الذاكرة|\bmemory\b|what do you remember|\brecall\b)/i,
    tools: (msg) => {
      const q = cleanQuery(
        msg
          .replace(/(?:انت\s*)?(?:تفتكر|تتذكر|فاكر|فاتكر)\s*(?:ايه|إيه|ايوه|عن|حاجة|حاجه)?/gi, " ")
          .replace(/(?:ايه|إيه)\s*(?:اللي)?/gi, " ")
          .replace(/\s+/g, " "),
      );
      return [{ tool: "memory_search", args: { query: q || msg } }];
    },
  },
  {
    test: /(?:^|[\s،,])(?:احفظ|سجّل|سجل|remember|حفظ)(?![\p{L}])/iu,
    tools: (msg) => {
      // "احفظ ان ..." → keep the payload, not the command verb.
      const body =
        msg
          .replace(/^\s*(?:من فضلك\s*|please\s*)?(?:احفظ|سجّل|سجل|remember|حفظ|افتكر)\s*/i, "")
          .replace(/^\s*(?:اني|أني|إني|انه|أنه|إنه|ان|أن|إن|that|ه)\s+/i, "")
          .trim() || msg;
      const isPreference = /(?:انا\s*(?:افضل|أفضل|بحب|عايز|محتاج)|دايماً|دائماً|دائما|كل مرة|always|prefer|i want you to)/i.test(msg);
      return [{
        tool: "memory_save",
        args: {
          title: body.slice(0, 70),
          content: body,
          kind: isPreference ? "preference" : "fact",
          importance: isPreference ? 9 : 7,
        },
      }];
    },
  },
  {
    test: /(?:الهدف النشط|حدد هدف|set target|active target)/i,
    tools: (msg) => {
      const host = extractTarget(msg);
      return host ? [{ tool: "set_active_target", args: { target: host } }] : [{ tool: "mission_status", args: {} }];
    },
  },
  {
    test: /(?:المهمة|mission|findings|النتائج)/i,
    tools: () => [{ tool: "mission_status", args: {} }],
  },
  {
    test: /(?:حالة المنصة|status|صحة|health|إحصائ)/i,
    tools: () => [{ tool: "platform_status", args: {} }],
  },
  {
    test: /(?:كيف أحمي|إصلاح|ترقيع|remediat|fix|حماية)/i,
    tools: (msg) => [{ tool: "knowledge_search", args: { query: cleanQuery(msg) } }],
  },
  {
    // General "look it up" is the request people send most, and it used to
    // produce a counter-question because there was no search tool at all.
    // Placed last so every specialised intent above still wins.
    // Explicit search VERBS only. A bare product name used to match here —
    // «google.com» went to web search instead of recon, which is the worst kind
    // of fix: it looked like it worked.
    test: /(?:ابحث|دوّر|دور\s+على|هات\s*لي|هاتلى|جيب\s*لي|search\s+for|search|look\s*up|find\s+(?:me\s+)?(?:a|some))/i,
    tools: (msg) => [{ tool: "web_search", args: { query: cleanQuery(msg), limit: 8 } }],
  },
];

function cleanQuery(msg: string): string {
  return msg
    .replace(/CVE-\d{4}-\d{4,7}/gi, " ")
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    .replace(/\b((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/gi, " ")
    .replace(/(?:من فضلك|لو سمحت|يا نوفا|please|could you|can you)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "أمن سيبراني";
}

/**
 * Pull the shell command out of a natural-language request.
 * Handles backticks first ("نفّذ `uname -a` على الأجهزة"), then "نفّذ <cmd> على/في …".
 */
export function extractFleetCommand(message: string): string | null {
  const ticked = message.match(/`([^`]{1,400})`/);
  if (ticked) return ticked[1].trim();
  const after = message.match(
    /(?:نفّذ|نفذ|شغّل|شغل|اعمل|run|execute|exec)\s+(?:الأمر|الامر|command|التالى|التالي)?\s*([^\n]{1,300}?)\s*(?:\s+(?:على|علي|في|فى|داخل|عند|across|on)\b|$)/i,
  );
  const raw = after?.[1]?.trim();
  if (!raw) return null;
  // Reject prose ("uname -a على الأجهزة" is fine, "الاجهزة المتصلة" is not a command).
  if (!/[a-z0-9_.\-]/i.test(raw)) return null;
  // Cut the trailing Arabic prose: "uname -a على الأجهزة" → "uname -a".
  const tokens = raw.split(/\s+/);
  const kept: string[] = [];
  for (const t of tokens) {
    if (/[\u0600-\u06FF]/.test(t)) break;
    if (/^(?:on|across|in)$/i.test(t)) break;
    kept.push(t);
  }
  const stop = kept.join(" ").trim();
  if (!stop || stop.length > 200) return null;
  if (/^(?:الأجهزة|الاجهزة|أجهزة|اجهزة|الأجهزه|fleet|devices?)$/i.test(stop)) return null;
  return stop;
}

// «مرحبا» was missing here, and it is the first word of the transcript this
// whole round started from («مرحببببببا»). A greeting the router does not
// recognise becomes a memory search and a platform status call — two tools for
// somebody who only said hello. `مرحب+ا*` is deliberate: people type the extra
// letters, and a router that only accepts the dictionary spelling is a router
// that ignores them.
const SMALL_TALK = /^(?:مرحب+ا*|أهلا|اهلا|أهلاً|هلا|السلام|سلام|صباح|مساء|هاي|hi|hello|hey|ازيك|إزيك|عامل ايه)/i;

/**
 * Is this greeting *only* a greeting?
 *
 * «مرحببببببا» is. «مرحبا، دوّر على CVE-2024-3094» is not — and treating it as
 * one is how a hello used to swallow the request behind it.
 */
export function greetingOnly(message: string): boolean {
  const msg = String(message ?? "").trim();
  if (!SMALL_TALK.test(msg)) return false;
  const rest = msg
    .replace(SMALL_TALK, " ")
    .replace(/(?:يا\s*نوفا|نوفا|يا\s*بطل|يا\s*صاحبي|كيفك|كيف\s*الحال|عامل\s*ايه|ازيك|إزيك|بخير|الحمد\s*لله)/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return rest.length === 0;
}

export function heuristicPlan(message: string): { thought: string; steps: PlannedStep[] } {
  const msg = message.trim();
  if (!msg) return { thought: "مفيش طلب واضح.", steps: [] };

  const host = extractTarget(msg);
  if (greetingOnly(msg) && !host) {
    return { thought: "المستخدم بيسلّم — أرد بشكل شخصي وأعرض اللي أقدر أعمله.", steps: [] };
  }
  if (/(?:انت مين|من أنت|مين انت|who are you|شخصيتك)/i.test(msg)) {
    return { thought: "المستخدم بيسأل عن كياني — أعرض شخصيتي وقدراتي وقواعدي.", steps: [] };
  }

  const steps: PlannedStep[] = [];
  // Human-readable names of the intents that fired. The regex source used to be
  // printed here, and it went straight to the user's screen:
  //   «[مسار: (?:أدوات|ادوات|kali|أداة|t + (?:ابحث|دوّر...»
  // A planner that leaks its own source code into the chat reads as broken,
  // whatever the plan underneath was doing right.
  const labels: string[] = [];
  const INTENT_LABEL = (rule: RegExp): string => {
    const src = rule.source;
    if (/subdomain|نطاقات/.test(src)) return "تعداد نطاقات فرعية";
    if (/CVE-/.test(src)) return "قاعدة ثغرات";
    if (/منافذ|بورت|ports?/.test(src)) return "فحص منافذ";
    if (/shهاد|ssl|tls/i.test(src)) return "فحص شهادة TLS";
    if (/ترويسات|headers/i.test(src)) return "ترويسات الأمان";
    if (/شهيرة|شائع|common|popular/i.test(src)) return "منافذ شائعة";
    if (/أدوات|ادوات|kali/i.test(src)) return "ترسانة الأدوات";
    if (/exploit|استغلال/i.test(src)) return "استغلالات معروفة";
    if (/github/i.test(src)) return "مستودعات GitHub";
    if (/ثغرات|vuln/i.test(src)) return "بحث ثغرات";
    if (/ذاكرت|memory|فاكر/i.test(src)) return "ذاكرتي";
    if (/مهم|mission|target|هدف/i.test(src)) return "مهمة نشطة";
    if (/ابحث|دوّر|search/i.test(src)) return "بحث في النت";
    if (/حالة المنصة|status|health/i.test(src)) return "حالة المنصة";
    return "تحليل الطلب";
  };
  for (const rule of INTENT) {
    if (!rule.test.test(msg)) continue;
    const planned = rule.tools(msg);
    if (!planned.length) continue;
    for (const step of planned) {
      if (!AGENT_TOOL_NAMES.includes(step.tool)) continue;
      if (steps.some((s) => s.tool === step.tool && JSON.stringify(s.args) === JSON.stringify(step.args))) continue;
      steps.push(step);
    }
    labels.push(INTENT_LABEL(rule.test));
    if (steps.length >= 4) break;
  }

  if (steps.length === 0 && host) {
    steps.push({ tool: "set_active_target", args: { target: host } }, { tool: "recon_target", args: { target: host } });
    labels.push("هدف مكتشف");
  }
  if (steps.length === 0) {
    steps.push({ tool: "memory_search", args: { query: msg.slice(0, 80) } }, { tool: "platform_status", args: {} });
    labels.push("سياق عام");
  }

  const plan = host
    ? `الطلب فيه هدف واضح (${host}) — هبدأ بالاستطلاع الحقيقي وأبني عليه.`
    : labels.some((l) => l === "بحث في النت")
      ? "دوّر في طلب بحث — هرجع بنتائج حقيقية من النت، مش بقائمة اقتراحات."
      : "هرتّب الطلب على أدواتي الحقيقية وأشوف النتيجة قبل أي استنتاج.";
  return {
    thought: `${plan}${labels.length ? ` — ${labels.join(" + ")}` : ""}`,
    steps: steps.slice(0, 5),
  };
}

/* ── identity, answered from the model ───────────────────────────────────── */

/**
 * «انت مين» and «تقدر تعمل ايه» must never go to a model.
 *
 * Measured 2026-11-05 in a live transcript: the answer to «انت مين» was
 * «أنا نوفا، كيان ذكي وشريك أمني داخل CyberNova» — true, and useless. The next
 * question, «تقدر تحمل ادوات؟», produced a bubble with nothing in it. A model
 * asked about itself answers from whatever text is nearest; the numbers it
 * gives are decoration.
 *
 * So the two questions that define the agent are answered by measurement: the
 * tool count, the corpus size, the fleet, the memory and the ops kinds all come
 * from buildSelfModel() at the moment of asking, and the limits are stated in
 * the same breath. It reads like a person because the facts are its own.
 */
export const SELF_QUESTION =
  /(?:انت\s*مين|مين\s*انت|من\s*(?:أنت|انت)|who\s+are\s+you|عرّ?ف\s*(?:ني|نفسك)|قدراتك|إمكانياتك|امكانياتك|شخصيتك|تقدر\s*(?:تعمل|تعملي|توصل|تشغل|تنفذ|تنفّذ)\s*(?:ايه|إيه|ايه\?|اية|اي)|بتقدر\s*تعمل\s*(?:ايه|إيه)|(?:تقدر|بتقدر|بتقدري)\s*(?:تشتغل|تشغّل|تشغل|تعمل|تنفّذ|تنفذ)\s*(?:على|علي|فى|في|ب)?\s*(?:metasploit|burp|بورب|كالي|kali)|(?:تحمل|تحمّل|تحميل|تنصيب|تثبت|تنزل)\s*(?:لي\s*)?(?:ادوات|أدوات|كالي|kali)|what\s+can\s+you\s+do)/i;

/**
 * «مرحببببببا» deserves better than «كيف يمكنني مساعدتك اليوم؟».
 *
 * The live transcript opened with exactly that: a warm greeting, answered by a
 * generic assistant line that could have come from any product. The greeting is
 * the one place where the agent can introduce what it actually is in two lines,
 * so it is answered from the same measurement as identity — short, in the
 * conversation's own dialect, with numbers that are true right now.
 */
export function greetingAnswer(model: SelfModel = buildSelfModel()): string {
  const corpus = model.corpus.measured
    ? `فهرس **${model.corpus.total.toLocaleString("en-US")}** ثغرة حقيقية`
    : "فهرس ثغرات لسه بيتزامن";
  const fleet = model.machines.registered ? `**${model.machines.registered}** ماكينة مسجّلة` : "مفيش ماكينة متصلة لسه";
  return [
    "أهلاً بيك 👋 أنا **نوفا** — بشتغل مش بتتكلم بس.",
    "",
    `معايا دلوقتي **${model.tools.count}** أداة حقيقية، و${corpus}، و${fleet}.`,
    "",
    "اكتب «انت مين» لو عايز التفاصيل كاملة، أو ابعتلي نطاق زي `example.com` وأنا أبدأ استطلاع حقيقي حالاً.",
  ].join("\n");
}

export function identityAnswer(model: SelfModel = buildSelfModel()): string {
  const topCategories = Object.entries(model.tools.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat, n]) => `${cat} ${n}`)
    .join(" · ");
  const corpusLine = model.corpus.measured
    ? `فهرس **${model.corpus.total.toLocaleString("en-US")}** ثغرة حقيقية (NVD + KEV + EPSS) — بفتش جواه، مش بتخيل.`
    : "فهرس الثغرات لسه مش متزامن على السيرفر ده، فمش هدّعي إني بفتش فيه.";
  const fleetLine = model.machines.registered
    ? `**${model.machines.registered}** ماكينة مسجّلة في الأسطول${model.machines.names.length ? ` (${model.machines.names.slice(0, 3).join(" · ")})` : ""} — الأوامر عليها بتشتغل لحظة اتصال الوكيل.`
    : "الأسطول جاهز بس مفيش ماكينة مسجّلة — أول ما تضيف واحدة أقدر أنفّذ عليها أوامر حقيقية.";

  return [
    `أنا **نوفا** — العقل اللي جوه CyberNova، مش بوت ردود. كل حاجة تحت دي **مقاسة الآن**، مش محفوظة:`,
    `- **${model.tools.count}** أداة حقيقية مسجّلة باسمها${topCategories ? ` (${topCategories})` : ""}.`,
    `- ${corpusLine}`,
    `- ${fleetLine}`,
    model.memory.total
      ? `- ذاكرتي فيها **${model.memory.total}** ذكرى من شغلنا، بتفضل بعد إعادة التشغيل.`
      : "- ذاكرتي لسه فاضية — أول حاجة نحفظها هتفضل بعد الريستارت.",
    model.opsKinds ? `- **${model.opsKinds}** نوع عملية على برامج مصرّح بها (مش تخمين).` : "",
    "**اللي مش بعمله وهقوله على طول:**",
    ...model.cannotDo.slice(0, 3).map((c) => `- ${c}`),
    "**عايز تشوفني شغالة دلوقتي؟** ابعتلي نطاق زي `example.com` وأنا أعمل استطلاع حقيقي، أو اكتب «دوّر على …» وأجيب من النت بنتائج مش اقتراحات.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/* ── thought hygiene ─────────────────────────────────────────────────────── */

/**
 * The thinking line is streamed straight into a one-line bubble in the chat, so
 * whatever a model copies out of its own prompt becomes user-visible text.
 * Measured 2026-11-05: the bubble showed regex source
 * («[مسار: (?:أدوات|ادوات|kali…») — the planner's own pattern, leaked verbatim.
 * The deterministic planner no longer builds such a string, but the LLM planner
 * can return anything at all, so the last stop before the screen is a sanitiser:
 * no fences, no JSON, no regex source, one line, Arabic, capped.
 */
export function cleanThought(raw: string, fallback = "هرتّب الطلب على أدواتي الحقيقية وأشوف النتيجة قبل أي استنتاج."): string {
  let t = String(raw ?? "").trim();
  if (!t) return fallback;

  t = t.replace(/```[\s\S]*?```/g, " "); // fenced blocks
  t = t.replace(/\{\s*"[\s\S]*?\}/g, " "); // JSON objects
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[{}\[\],]+$/.test(l) && !/^"?(tool|args|steps|thought)"?\s*:/.test(l) && !/(?:^|\s)(?:tool|args)\s*:/.test(l));
  t = lines.join(" ");

  // Regex source: "(?:" , "\s", "[a-z]+?", "(?:أ|ب)" … none of it belongs on screen.
  if (/\(\?:|\\[swdb]|\[[^\]]{1,40}\]\s*[?+*]/.test(t)) t = t.replace(/\(\?:[^)]*\)/g, " ").replace(/\\[swdb]/g, " ");
  // Whatever a stripped pattern leaves behind ("[مسار: ] على الطلب") is debris,
  // not prose — brackets in a one-line thought are never load-bearing.
  t = t.replace(/\[[^\]]{0,80}\]/g, " ").replace(/\s+/g, " ").trim();

  // The prompt demands Arabic; a stray English sentence reads as a second voice.
  // Fewer than a dozen Arabic letters means what survived is mostly pattern/JSON
  // residue, and the fallback says more than the leftovers do.
  const arabic = t.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  if (arabic < 12) return fallback;

  if (t.length > 220) {
    const cut = t.slice(0, 220);
    const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("،"), cut.lastIndexOf("—"), cut.lastIndexOf(" "));
    t = `${cut.slice(0, stop > 80 ? stop : 220).trim()}…`;
  }
  return t || fallback;
}

/* ── LLM planner ─────────────────────────────────────────────────────────── */

const PLAN_INSTRUCTIONS = `أعد **JSON فقط** (بدون أي شرح خارج الـ JSON) بهذا الشكل:
{"thought": "سطر أو سطرين بالعربي عن خطتك", "steps": [{"tool": "اسم_الأداة", "args": {...}}], "answer_if_no_tools": "رد نصي فقط إذا لم تحتج أدوات"}

قواعد:
- استخدم أدوات حقيقية فقط من القائمة. لا تخترع أسماء.
- أقصى عدد خطوات 4.
- لو السؤال عام/تحية/تعريف بشخصيتك → steps فارغة واكتب الرد في answer_if_no_tools.
- **حقل thought بالعربي دايماً** — ده بيتعرض للمستخدم حرفياً، والإنجليزي هنا بيبان كلغة تانية وسط الكلام.
- لو المستخدم سأل «تقدر تعمل إيه» أو «قدراتك» → **اقرا قسم «من أنت الآن» في السياق ورد منه**، مش من الذاكرة العامة.
- لو الطلب ينفّذ بأداة موجودة (بحث/جلب صفحة/فحص) → نفّذها. **ما تسألش «تقصد إيه»** إلا لو مفيش هدف خالص.
- لو فيه نطاق أو CVE في الطلب، نفّذ الأداة المناسبة ولا تجاوب من ذاكرتك.`;

async function llmPlan(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  selfModel: ReturnType<typeof buildSelfModel>,
): Promise<{ thought: string; steps: PlannedStep[]; directAnswer?: string; provider: string; model: string } | null> {
  const messages = [
    {
      role: "system" as const,
      content: `${NOVA_SYSTEM_PROMPT_SHORT}\n\n${selfModelPrompt(selfModel)}\n\n# أدواتك\n${toolCatalogueForPrompt()}\n\n${buildContextBlock(message)}\n\n${PLAN_INSTRUCTIONS}`,
    },
    ...history.slice(-4).map((h) => ({ role: h.role, content: h.content.slice(0, 1200) })),
    { role: "user" as const, content: message },
  ];
  const result = await llmComplete(messages, { temperature: 0.3, maxTokens: 700 });
  if (!result) return null;
  const parsed = extractJson<{ thought?: string; steps?: Array<{ tool?: string; args?: Record<string, unknown> }>; answer_if_no_tools?: string }>(result.text);
  if (!parsed) return null;
  const steps = (parsed.steps ?? [])
    .filter((s) => s?.tool && AGENT_TOOL_NAMES.includes(String(s.tool)))
    .slice(0, 4)
    .map((s) => ({ tool: String(s.tool), args: (s.args ?? {}) as Record<string, unknown> }));
  return {
    thought: String(parsed.thought ?? "تمام، هبدأ بالخطة."),
    steps,
    directAnswer: parsed.answer_if_no_tools ? String(parsed.answer_if_no_tools) : undefined,
    provider: result.provider,
    model: result.model,
  };
}

/* ── explanation ─────────────────────────────────────────────────────────── */

function preview(data: unknown): string {
  try {
    const s = JSON.stringify(data);
    return s.length > 700 ? `${s.slice(0, 700)}…` : s;
  } catch {
    return String(data).slice(0, 400);
  }
}

function heuristicAnswer(message: string, results: Array<{ name: string; ok: boolean; summary: string; data: unknown }>): string {
  if (results.length === 0) {
    if (SMALL_TALK.test(message.trim())) {
      const sm = buildSelfModel();
      return [
        `أهلاً بيك 👋 أنا **نوفا** — شريكك في المنصة، مش مجرد بوت أوامر.`,
        "",
        `عندي دلوقتي **${sm.tools.count} أداة حقيقية**، و${sm.corpus.measured ? `فهرس **${sm.corpus.total.toLocaleString("en-US")} ثغرة**` : "فهرس ثغرات لسه مش متزامن"}، و${sm.machines.registered} ماكينة في الأسطول.`,
        "",
        "أقدر أشتغل فعلياً على: استطلاع نطاق (DNS + TLS + ترويسات)، فحص منافذ محدود، تعداد نطاقات فرعية، بحث ثغرات، جلب صفحات من النت، GitHub، وذاكرة دائمة.",
        "",
        "**الخطوة التالية المقترحة:** ابعتلي نطاق مثل `example.com` وأقولك نتيجة الاستطلاع كاملة.",
      ].join("\n");
    }
    // Built from the measured self-model, not from a paragraph typed once:
    // «33 أداة» lived in this string long after the registry said 47.
    const m = buildSelfModel();
    return [
      `أنا **نوفا** — كيان ذكي داخل CyberNova، بشتغل بأدوات حقيقية وأشرح كل خطوة.`,
      "",
      `- عندي **${m.tools.count} أداة حقيقية** مسجّلة، مش كلام: استطلاع، DNS، TLS، ترويسات، منافذ، نطاقات فرعية، بحث ثغرات، جلب صفحات من النت، GitHub، وذاكرة دائمة.`,
      m.corpus.measured
        ? `- ببحث جوّه **${m.corpus.total.toLocaleString("en-US")} ثغرة** حقيقية (NVD + KEV + EPSS) بدل تخمين.`
        : "- فهرس الثغرات لسه مش متزامن على السيرفر ده — البحث هيقولك «مفيش بيانات» بصراحة.",
      m.machines.registered
        ? `- عندي **${m.machines.registered} ماكينة** في الأسطول (${m.machines.names.slice(0, 3).join(" · ")}).`
        : "- الأسطول جاهز بس مفيش ماكينة مسجّلة — ضيف ماكينة وأنا أنفّذ عليها أوامر حقيقية.",
      m.memory.total
        ? `- ذاكرتي فيها **${m.memory.total} ذكرى** من شغلنا السابق.`
        : "- ذاكرتي لسه فاضية — أول حاجة نحفظها هتفضل بعد إعادة التشغيل.",
      "",
      "**مش بقدر:** أشغّل Metasploit/Burp على السيرفر ده (مفيش root ولا مساحة)، أو أوصل لجهاز مش متصل بالوكيل.",
      "",
      "**الخطوة التالية المقترحة:** ابعتلي نطاق مثل `example.com` وأنا أبدأ الاستطلاع فوراً، أو قولي «دوّر على …» وأنا أجيب من النت.",
    ].join("\n");
  }

  const lines: string[] = [];
  const failed = results.filter((r) => !r.ok);
  const okCount = results.length - failed.length;

  // Every step was skipped by the repeat guard: the answer is the reason, said
  // once, plus the one word that re-arms the run. Anything longer would be a
  // summary of work that deliberately did not happen.
  const skipped = results.filter((r) => r.summary.startsWith("⏭️"));
  if (skipped.length > 0 && skipped.length === results.length) {
    return [
      "مش هعيد نفس المحاولة — جرّبتها قبل كده قريب ولسه نفس السبب:",
      "",
      ...skipped.map((r) => `- **${r.name}:** ${r.summary.replace(/^⏭️\s*/, "")}`),
      "",
      "**الخطوة التالية المقترحة:** عالج السبب اللي فوق، وبعدها اكتب «جرب تاني» وأنا أعيد المحاولة فوراً.",
    ].join("\n");
  }

  lines.push(`تمام، نفّذت **${results.length}** أداة (${okCount} نجحت${failed.length ? ` · ${failed.length} فشلت` : ""}). دي القراءة:`);
  lines.push("");

  for (const r of results) {
    lines.push(`### ${r.ok ? "✅" : "⚠️"} ${r.name}`);
    lines.push(r.summary);
    lines.push("");
  }

  const recon = results.find((r) => r.name === "recon_target" && r.ok);
  if (recon) {
    const data = recon.data as { headers?: { missing?: string[]; score?: string }; tls?: { validTo?: string; authorizationError?: string | null } };
    const missing = data?.headers?.missing ?? [];
    lines.push("## القراءة الأمنية");
    if (missing.length) {
      lines.push(`- **ترويسات ناقصة (${missing.length}):** ${missing.join(", ")} — أول ما يحتاج معالجة.`);
    } else {
      lines.push("- الترويسات الأساسية موجودة — مش معناها كمال، بس مش ناقصة الحاجات الحرجة.");
    }
    lines.push(
      data?.tls?.authorizationError
        ? `- **الشهادة فيها مشكلة:** ${data.tls.authorizationError}`
        : `- الشهادة سارية حتى **${data?.tls?.validTo ?? "غير معروف"}**.`,
    );
    lines.push("- الاستطلاع ده سطحي ومقصود: بيوريك الشكل الخارجي بدون أي أذى للهدف.");
    lines.push("");
  }

  if (failed.length) {
    lines.push("## اللي فشل وليه");
    for (const f of failed) lines.push(`- **${f.name}:** ${f.summary}`);
    lines.push("");
  }

  lines.push("## الخطوة التالية المقترحة");
  if (recon) {
    lines.push("نكمّل بفحص المنافذ المحدود + تعداد النطاقات الفرعية، وبعدها نسجّل النتائج في المهمة ونولّد تقرير قانوني جاهز للإرسال.");
  } else if (results.some((r) => r.name === "cve_lookup" || r.name === "vuln_search")) {
    lines.push("نشوف لو الثغرة لسه مؤثرة على نسختك الفعلية، ونجهّز كود الترقيع (Remediation) قبل أي إبلاغ.");
  } else {
    lines.push("ابعتلي نطاقاً لاستطلاعه فعلياً، أو CVE لنبحث عنها في NVD.");
  }
  return lines.join("\n");
}

/* ── main loop ───────────────────────────────────────────────────────────── */

let memoryBooted = false;

/** Approvals that were asked for and never answered (surfaced by /nova-core/pending). */
export const pendingApprovals: Array<{ sessionId: string; tool: string; args: Record<string, unknown>; at: number }> = [];

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  if (!memoryBooted) {
    memoryBooted = true;
    try {
      initMemory();
    } catch {
      /* store failures must never block a reply */
    }
  }
  const started = Date.now();
  const sessionId = opts.sessionId || `nova-${Date.now()}`;
  const history = opts.history ?? [];
  const message = (opts.message ?? "").trim();

  /**
   * What NOVA is, measured at the moment of the ask.
   *
   * Built once per turn (not per prompt) so the plan, the direct answer and the
   * explanation all describe the SAME machine — and so a capability question can
   * never be answered with the hardcoded «33 أداة» that was three releases out
   * of date.
   */
  let selfModel: ReturnType<typeof buildSelfModel>;
  try {
    selfModel = buildSelfModel();
  } catch {
    // A self-model that cannot be built must not silence the agent: fall back to
    // a minimal one whose numbers come straight from the tool registry.
    selfModel = {
      tools: { count: AGENT_TOOLS.length, names: AGENT_TOOLS.map((t) => t.name), byCategory: {} },
      machines: { registered: 0, names: [] },
      corpus: { measured: false, total: 0, ageMin: null },
      memory: { total: 0, pinned: 0 },
      opsKinds: 0,
      // مش مقاس — بنقول كده في السطر، مافيش افتراض «موجودة» ولا «ناقصاه».
      securityTools: { present: [], missing: [], provisionable: false, writable: false, scriptFound: false },
      canDo: [`تشغيل ${AGENT_TOOLS.length} أداة حقيقية`],
      cannotDo: ["قراءة حالة المنصة الآن — تعذّرت"],
    };
  }

  if (!message) {
    opts.emit({ type: "error", message: "مفيش رسالة — اكتب طلبك." });
    return { mode: "heuristic", provider: "none", toolsUsed: [], reply: "", ms: 0 };
  }

  let plan: { thought: string; steps: PlannedStep[]; directAnswer?: string } | null = null;
  let mode: "llm" | "heuristic" = "heuristic";
  let provider = "nova-builtin";
  let model = "nova-heuristic";

  if (!opts.forceHeuristic) {
    const llm = await llmPlan(message, history, selfModel);
    if (llm && (llm.steps.length > 0 || llm.directAnswer)) {
      plan = llm;
      mode = "llm";
      provider = llm.provider;
      model = llm.model;
    }
  }
  if (!plan) {
    const h = heuristicPlan(message);
    plan = h;
    mode = "heuristic";
  }

  opts.emit({
    type: "ready",
    sessionId,
    mode,
    provider,
    model,
    tools: AGENT_TOOLS.length,
  });
  opts.emit({ type: "thought", text: cleanThought(plan.thought) });

  // Direct answer without tools (identity / chit-chat / general question)
  if (plan.steps.length === 0) {
    let reply = plan.directAnswer?.trim() || "";
    // Self-knowledge is not a generation task. Even with a live model available,
    // «انت مين» and «تقدر تعمل ايه» are answered from the measurement — that is
    // the only way the numbers in the answer are the numbers in the registry.
    if (SELF_QUESTION.test(message) && !extractTarget(message)) {
      reply = identityAnswer(selfModel);
      provider = `${provider}+self-model`;
    } else if (greetingOnly(message) && !extractTarget(message) && !extractFleetCommand(message)) {
      // A greeting is an introduction, not a question to the model.
      reply = greetingAnswer(selfModel);
      provider = `${provider}+self-model`;
    }
    if (!reply) {
      const llm = await llmComplete(
        [
          { role: "system", content: `${NOVA_SYSTEM_PROMPT}\n\n${selfModelPrompt(selfModel)}\n\n${buildContextBlock(message)}` },
          ...history.slice(-4).map((h) => ({ role: h.role, content: h.content.slice(0, 1200) })),
          { role: "user", content: message },
        ],
        { temperature: 0.7 },
      );
      reply = llm?.text?.trim() || heuristicAnswer(message, []);
      if (llm) provider = llm.provider;
    }
    if (!reply.trim()) {
      // Measured 2026-11-05: two bubbles in a live transcript were literally
      // empty. An empty answer is indistinguishable from "the program is dead",
      // so say what happened instead of saying nothing.
      reply = `معلش، المزوّد رجّع رد فاضي المرة دي (${provider}). جرّب تبعت السؤال تاني، أو خلّي الصياغة فيها هدف واضح وأنا أبدأ فوراً.\n\n**الخطوة التالية المقترحة:** اكتب مثلًا «استطلع example.com» أو «دوّر على CVE-2024-3094».`;
    }
    // SSE frames the chunks; no artificial sleep between them — fast reception.
    for (const chunk of splitChunks(reply)) {
      opts.emit({ type: "delta", text: chunk });
    }
    opts.emit({ type: "done", sessionId, mode, toolCount: 0, ms: Date.now() - started, provider });
    return { mode, provider, toolsUsed: [], reply, ms: Date.now() - started };
  }

  // Execute the plan
  opts.emit({ type: "plan", steps: plan.steps });
  const results: Array<{ name: string; ok: boolean; summary: string; data: unknown }> = [];
  const maxSteps = Math.min(opts.maxSteps ?? 5, 6);
  const retrying = wantsRetry(message);
  const seenThisTurn = new Set<string>();
  const failedThisTurn = new Map<string, string>();

  for (const [idx, step] of plan.steps.slice(0, maxSteps).entries()) {
    const spec = AGENT_TOOLS.find((t) => t.name === step.tool);
    const id = `${idx + 1}-${step.tool}`;

    // ── repeat guard ────────────────────────────────────────────────────────
    // Checked BEFORE the tool_call event, so the UI never shows a step starting
    // that we already know cannot run. The skip is itself reported, with the
    // real reason, because silently dropping a step would be its own lie.
    const skip = shouldSkipStep({
      sessionId,
      tool: step.tool,
      args: step.args,
      title: spec?.title,
      seenThisTurn,
      failedThisTurn,
      retrying,
    });
    if (skip) {
      seenThisTurn.add(stepSignature(step.tool, step.args));
      results.push({ name: step.tool, ok: false, summary: `⏭️ ${skip.reason}`, data: null });
      opts.emit({ type: "thought", text: skip.thought });
      opts.emit({
        type: "tool_result",
        id,
        name: step.tool,
        ok: false,
        summary: `⏭️ ${skip.reason}`,
        ms: 0,
        dataPreview: "",
      });
      broadcastLiveEvent({
        type: "tool_result",
        data: { tool: step.tool, ok: false, summary: skip.reason, ms: 0, skipped: true, ts: Date.now() },
        ts: new Date().toISOString(),
      });
      continue;
    }
    seenThisTurn.add(stepSignature(step.tool, step.args));

    opts.emit({
      type: "tool_call",
      id,
      name: step.tool,
      title: spec?.title ?? step.tool,
      args: step.args,
      risk: spec?.risk ?? "safe",
    });
    broadcastLiveEvent({
      type: "tool_start",
      data: { tool: step.tool, args: step.args, agent: "nova", ts: Date.now() },
      ts: new Date().toISOString(),
    });

    // ── human-in-the-loop gate ────────────────────────────────────────────
    // Sensitive tools stop here and ask. The client answers by re-sending the
    // same message with `approve: [tool]`; only then does anything execute.
    const risk = String(spec?.risk ?? "safe");
    if (risk === "sensitive" && !(opts.approved ?? []).includes(step.tool)) {
      const reason = `الأداة «${spec?.title ?? step.tool}» حساسة — ممكن تنفّذ أوامر على جهاز حقيقي. محتاج موافقتك قبل التنفيذ.`;
      opts.emit({ type: "confirm_required", id, name: step.tool, title: spec?.title ?? step.tool, args: step.args, risk, reason });
      pendingApprovals.push({ sessionId, tool: step.tool, args: step.args, at: Date.now() });
      results.push({ name: step.tool, ok: false, summary: "⏸️ متوقفة لحد ما توافق على التنفيذ", data: null });
      continue;
    }

    let result: ToolRunResult;
    try {
      result = await runAgentTool(step.tool, step.args);
    } catch (err) {
      result = { ok: false, summary: `خطأ غير متوقع: ${(err as Error).message}`, data: null, ms: 0 };
    }

    results.push({ name: step.tool, ok: result.ok, summary: result.summary, data: result.data });
    recordAttempt(sessionId, step.tool, step.args, result.ok, result.summary);
    if (!result.ok) failedThisTurn.set(step.tool, result.summary);
    opts.emit({
      type: "tool_result",
      id,
      name: step.tool,
      ok: result.ok,
      summary: result.summary,
      ms: result.ms,
      dataPreview: preview(result.data),
    });
    broadcastLiveEvent({
      type: "tool_result",
      data: { tool: step.tool, ok: result.ok, summary: result.summary, ms: result.ms, ts: Date.now() },
      ts: new Date().toISOString(),
    });
    broadcastEvent({ type: "agent_tool_result", agent: "nova", tool: step.tool, ok: result.ok, ts: Date.now() });

    if (step.tool === "recon_target" || step.tool === "port_scan" || step.tool === "subdomain_enum") {
      recordMissionCommand(
        `nova:${step.tool} ${JSON.stringify(step.args)}`,
        result.summary,
      );
    }
  }

  // Explain the results
  let reply = "";
  if (mode === "llm") {
    const llm = await llmComplete(
      [
        {
          role: "system",
          content: `${NOVA_SYSTEM_PROMPT}\n\n${selfModelPrompt(selfModel)}\n\n# مخرجات أدواتك الحقيقية الآن (استخدمها كما هي، لا تخترع غيرها)\n${results
            .map((r) => `## ${r.name} (${r.ok ? "نجحت" : "فشلت"}): ${r.summary}\n${preview(r.data).slice(0, 1500)}`)
            .join("\n\n")}\n\n# سياق\n${buildContextBlock(message)}`,
        },
        { role: "user", content: `${message}\n\nفسّر النتائج باختصار، اذكر المهم والخطورة، واختم بخطوة تالية واحدة.` },
      ],
      { temperature: 0.5, maxTokens: 1200 },
    );
    reply = llm?.text?.trim() ?? "";
    if (llm) provider = llm.provider;
  }
  if (!reply.trim()) {
    reply = heuristicAnswer(message, results);
    if (!reply.trim()) {
      reply = `نفّذت ${results.length} أداة بس مقدرتش أصيغ ملخص من المزوّد. النتائج الخام في تبويب الأدوات فوق.\n\n**الخطوة التالية المقترحة:** اطلب مني نتيجة أداة واحدة بالاسم وأنا أشرحها بالتفصيل.`;
    }
  }

  // SSE frames the chunks; no artificial sleep between them — fast reception.
  for (const chunk of splitChunks(reply)) {
    opts.emit({ type: "delta", text: chunk });
  }

  // ── Long-term memory: this is what makes NOVA remember across restarts ──
  try {
    const scope = cleanScope(extractTarget(message) ?? getMissionsState()[0]?.target);
    const summary = results.map((r) => `${r.name} → ${r.summary}`).join(" | ").slice(0, 1800);

    // 1) A session record (searchable transcript digest).
    const sessionRec = remember({
      kind: "session",
      title: `جلسة نوفا: ${message.slice(0, 60)}`,
      content: `سؤال: ${message}\nالأدوات: ${results.map((r) => r.name).join(", ") || "بدون"}\nالنتائج: ${summary}\nالرد: ${reply.slice(0, 700)}`,
      scope,
      tags: ["session", ...results.map((r) => r.name)],
      importance: 5,
      source: "agent",
    });

    // 2) A lesson whenever a tool actually produced something durable.
    const facts = results.filter((r) => r.ok && r.name !== "platform_status");
    if (facts.length) {
      remember({
        kind: "lesson",
        title: `نتيجة ${facts[0].name} على ${scope}`,
        content: facts.map((r) => `${r.name}: ${r.summary}`).join("\n").slice(0, 1500),
        scope,
        tags: ["auto", ...facts.map((r) => r.name)],
        importance: 6,
        source: "agent-auto",
      });
    }

    // Mirror into the platform feed so /memory keeps working unchanged.
    try {
      saveMemory("session", sessionRec.title, sessionRec.content.slice(0, 1200), "nova,session,longterm", 6, false);
    } catch {
      /* best-effort */
    }
    opts.emit({ type: "memory", id: sessionRec.id, title: sessionRec.title });
  } catch {
    /* memory is best-effort — never fail a run because of it */
  }

  const out: AgentRunResult = {
    mode,
    provider,
    toolsUsed: results.map((r) => r.name),
    reply,
    ms: Date.now() - started,
  };
  opts.emit({ type: "done", sessionId, mode, toolCount: results.length, ms: out.ms, provider });
  return out;
}

/* ── utils ───────────────────────────────────────────────────────────────── */

function splitChunks(text: string, size = 48): string[] {
  if (!text) return [];
  return text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [text];
}

/** A stable scope key: bare hostname when we can find one, otherwise "global". */
function cleanScope(raw: string | undefined | null): string {
  if (!raw) return "global";
  let v = String(raw).trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(v)) v = new URL(v).hostname;
  } catch {
    /* keep as-is */
  }
  const host = v.match(/^([a-z0-9][a-z0-9.-]*\.[a-z]{2,24})/);
  if (host) return host[1];
  return v.length > 0 && v.length <= 60 ? v : "global";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
