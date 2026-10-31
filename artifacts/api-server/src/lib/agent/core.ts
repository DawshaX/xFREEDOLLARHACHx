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
import { getMissionsState, recordMissionCommand } from "../standalone-api";
import { broadcastEvent } from "../ws-hub";
import { broadcastLiveEvent } from "./../../routes/live-events";

export type AgentEvent =
  | { type: "ready"; sessionId: string; mode: "llm" | "heuristic"; provider: string; model: string; tools: number }
  | { type: "thought"; text: string }
  | { type: "plan"; steps: Array<{ tool: string; args: Record<string, unknown> }> }
  | { type: "tool_call"; id: string; name: string; title: string; args: Record<string, unknown>; risk: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; ms: number; dataPreview: string }
  | { type: "delta"; text: string }
  | { type: "memory"; id: string; title: string }
  | { type: "done"; sessionId: string; mode: string; toolCount: number; ms: number; provider: string }
  | { type: "error"; message: string };

export interface AgentRunOptions {
  sessionId?: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  emit: (event: AgentEvent) => void;
  /** Force the deterministic brain (used by tests / air-gapped mode). */
  forceHeuristic?: boolean;
  maxSteps?: number;
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

function buildContextBlock(): string {
  const missions = getMissionsState();
  const active = missions[0];
  const memories = getAllMemories().slice(0, 6);
  const memLines = memories.map((m) => `- [${m.kind}] ${m.title}: ${m.content.slice(0, 120)}`).join("\n");
  return [
    `# سياق المنصة الآن`,
    `- الهدف النشط: ${active?.target ?? "غير محدد"} (${active?.name ?? "—"})`,
    `- نتائج مسجلة في المهمة: ${active?.findings.length ?? 0}`,
    `- إجمالي الذاكرة: ${getAllMemories().length}`,
    memLines ? `# آخر ما تعرفه من ذاكرة\n${memLines}` : `# الذاكرة فارغة حتى الآن`,
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
    test: /(?:ثغرات|ثغرة|vulnerab|cve)/i,
    tools: (msg) => [{ tool: "vuln_search", args: { keyword: cleanQuery(msg), limit: 8 } }],
  },
  {
    test: /(?:أدوات|ادوات|kali|أداة|tool)/i,
    tools: (msg) => [{ tool: "kali_toolbox", args: { query: cleanQuery(msg), target: extractTarget(msg) ?? undefined } }],
  },
  {
    test: /(?:احفظ|سجّل|سجل|remember|حفظ)/i,
    tools: (msg) => [{ tool: "memory_save", args: { title: msg.slice(0, 60), content: msg, kind: "note" } }],
  },
  {
    test: /(?:ذاكرت|ذاكرة|memory|تذكر|فاكر)/i,
    tools: (msg) => [{ tool: "memory_search", args: { query: cleanQuery(msg) } }],
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

const SMALL_TALK = /^(?:أهلا|اهلا|السلام|سلام|صباح|مساء|hi|hello|hey|ازيك|إزيك|عامل ايه)/i;

export function heuristicPlan(message: string): { thought: string; steps: PlannedStep[] } {
  const msg = message.trim();
  if (!msg) return { thought: "مفيش طلب واضح.", steps: [] };

  const host = extractTarget(msg);
  if (SMALL_TALK.test(msg) && !host) {
    return { thought: "المستخدم بيسلّم — أرد بشكل شخصي وأعرض اللي أقدر أعمله.", steps: [] };
  }
  if (/(?:انت مين|من أنت|مين انت|who are you|شخصيتك)/i.test(msg)) {
    return { thought: "المستخدم بيسأل عن كياني — أعرض شخصيتي وقدراتي وقواعدي.", steps: [] };
  }

  const steps: PlannedStep[] = [];
  const notes: string[] = [];
  for (const rule of INTENT) {
    if (!rule.test.test(msg)) continue;
    const planned = rule.tools(msg);
    if (!planned.length) continue;
    for (const step of planned) {
      if (!AGENT_TOOL_NAMES.includes(step.tool)) continue;
      if (steps.some((s) => s.tool === step.tool && JSON.stringify(s.args) === JSON.stringify(step.args))) continue;
      steps.push(step);
    }
    notes.push(rule.test.source.slice(0, 26));
    if (steps.length >= 4) break;
  }

  if (steps.length === 0 && host) {
    steps.push({ tool: "set_active_target", args: { target: host } }, { tool: "recon_target", args: { target: host } });
    notes.push("target-detected");
  }
  if (steps.length === 0) {
    steps.push({ tool: "memory_search", args: { query: msg.slice(0, 80) } }, { tool: "platform_status", args: {} });
    notes.push("fallback-context");
  }

  const thought = host
    ? `الطلب فيه هدف واضح (${host}) — هبدأ بالاستطلاع الحقيقي وأبني عليه.`
    : `هجمع السياق من ذاكرتي وحالة المنصة قبل أي استنتاج.`;
  return { thought: `${thought}${notes.length ? ` [مسار: ${notes.join(" + ")}]` : ""}`, steps: steps.slice(0, 5) };
}

/* ── LLM planner ─────────────────────────────────────────────────────────── */

const PLAN_INSTRUCTIONS = `أعد **JSON فقط** (بدون أي شرح خارج الـ JSON) بهذا الشكل:
{"thought": "سطر أو سطرين بالعربي عن خطتك", "steps": [{"tool": "اسم_الأداة", "args": {...}}], "answer_if_no_tools": "رد نصي فقط إذا لم تحتج أدوات"}

قواعد:
- استخدم أدوات حقيقية فقط من القائمة. لا تخترع أسماء.
- أقصى عدد خطوات 4.
- لو السؤال عام/تحية/تعريف بشخصيتك → steps فارغة واكتب الرد في answer_if_no_tools.
- لو فيه نطاق أو CVE في الطلب، نفّذ الأداة المناسبة ولا تجاوب من ذاكرتك.`;

async function llmPlan(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ thought: string; steps: PlannedStep[]; directAnswer?: string; provider: string; model: string } | null> {
  const messages = [
    { role: "system" as const, content: `${NOVA_SYSTEM_PROMPT_SHORT}\n\n# أدواتك\n${toolCatalogueForPrompt()}\n\n${buildContextBlock()}\n\n${PLAN_INSTRUCTIONS}` },
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
      return `أهلاً بيك 👋 أنا **نوفا** — شريكك في المنصة، مش مجرد بوت أوامر.\n\nأقدر أشتغل فعلياً على:\n- استطلاع نطاق (DNS + TLS + ترويسات أمان)\n- فحص منافذ محدود وتعداد نطاقات فرعية\n- بحث ثغرات (NVD / Exploit-DB / GitHub / فهرس المنصة)\n- ذاكرة دائمة ومتتبع مهام وأدلة\n\nقولي هدفك أو نطاقك وأنا أبدأ فوراً.\n\n**الخطوة التالية المقترحة:** ابعتلي نطاق مثل \`example.com\` وأقولك نتيجة الاستطلاع كاملة.`;
    }
    return `أنا **نوفا** — كيان ذكي داخل CyberNova، بشتغل بأدوات حقيقية وأشرح كل خطوة.\n\n- بعرف أستطلع نطاق، أفحص شهادة TLS وترويسات الأمان، وأعدّد النطاقات الفرعية.\n- ببحث في NVD وExploit-DB وGitHub وفهرس المنصة (3,300+ نمط).\n- بكتب في الذاكرة وأسجّل النتائج في المهمة النشطة.\n\n**الخطوة التالية المقترحة:** ابعتلي هدفك (نطاق/برنامج) وهبدأ الاستطلاع فوراً.`;
  }

  const lines: string[] = [];
  const failed = results.filter((r) => !r.ok);
  const okCount = results.length - failed.length;

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

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const started = Date.now();
  const sessionId = opts.sessionId || `nova-${Date.now()}`;
  const history = opts.history ?? [];
  const message = (opts.message ?? "").trim();

  if (!message) {
    opts.emit({ type: "error", message: "مفيش رسالة — اكتب طلبك." });
    return { mode: "heuristic", provider: "none", toolsUsed: [], reply: "", ms: 0 };
  }

  let plan: { thought: string; steps: PlannedStep[]; directAnswer?: string } | null = null;
  let mode: "llm" | "heuristic" = "heuristic";
  let provider = "nova-builtin";
  let model = "nova-heuristic";

  if (!opts.forceHeuristic) {
    const llm = await llmPlan(message, history);
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
  opts.emit({ type: "thought", text: plan.thought });

  // Direct answer without tools (identity / chit-chat / general question)
  if (plan.steps.length === 0) {
    let reply = plan.directAnswer?.trim() || "";
    if (!reply) {
      const llm = await llmComplete(
        [
          { role: "system", content: `${NOVA_SYSTEM_PROMPT}\n\n${buildContextBlock()}` },
          ...history.slice(-4).map((h) => ({ role: h.role, content: h.content.slice(0, 1200) })),
          { role: "user", content: message },
        ],
        { temperature: 0.7 },
      );
      reply = llm?.text?.trim() || heuristicAnswer(message, []);
      if (llm) provider = llm.provider;
    }
    for (const chunk of splitChunks(reply)) {
      opts.emit({ type: "delta", text: chunk });
      await sleep(8);
    }
    opts.emit({ type: "done", sessionId, mode, toolCount: 0, ms: Date.now() - started, provider });
    return { mode, provider, toolsUsed: [], reply, ms: Date.now() - started };
  }

  // Execute the plan
  opts.emit({ type: "plan", steps: plan.steps });
  const results: Array<{ name: string; ok: boolean; summary: string; data: unknown }> = [];
  const maxSteps = Math.min(opts.maxSteps ?? 5, 6);

  for (const [idx, step] of plan.steps.slice(0, maxSteps).entries()) {
    const spec = AGENT_TOOLS.find((t) => t.name === step.tool);
    const id = `${idx + 1}-${step.tool}`;
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

    let result: ToolRunResult;
    try {
      result = await runAgentTool(step.tool, step.args);
    } catch (err) {
      result = { ok: false, summary: `خطأ غير متوقع: ${(err as Error).message}`, data: null, ms: 0 };
    }

    results.push({ name: step.tool, ok: result.ok, summary: result.summary, data: result.data });
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
          content: `${NOVA_SYSTEM_PROMPT}\n\n# مخرجات أدواتك الحقيقية الآن (استخدمها كما هي، لا تخترع غيرها)\n${results
            .map((r) => `## ${r.name} (${r.ok ? "نجحت" : "فشلت"}): ${r.summary}\n${preview(r.data).slice(0, 1500)}`)
            .join("\n\n")}\n\n# سياق\n${buildContextBlock()}`,
        },
        { role: "user", content: `${message}\n\nفسّر النتائج باختصار، اذكر المهم والخطورة، واختم بخطوة تالية واحدة.` },
      ],
      { temperature: 0.5, maxTokens: 1200 },
    );
    reply = llm?.text?.trim() ?? "";
    if (llm) provider = llm.provider;
  }
  if (!reply) reply = heuristicAnswer(message, results);

  for (const chunk of splitChunks(reply)) {
    opts.emit({ type: "delta", text: chunk });
    await sleep(6);
  }

  // Persist a compact memory entry so the next session remembers the run
  try {
    const entry = saveMemory(
      "fact",
      `جلسة نوفا: ${message.slice(0, 50)}`,
      `${results.map((r) => `${r.name} → ${r.summary}`).join(" | ")}`.slice(0, 1200),
      "nova,session",
      6,
      false,
    );
    opts.emit({ type: "memory", id: entry.id, title: entry.title });
  } catch {
    /* memory is best-effort */
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
