import { Router, type IRouter } from "express";
import { db, agentTasksTable, agentTaskStepsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { resolveAi } from "../lib/ai";
import { TOOLS, runTool } from "../lib/agentTools";
import { buildIntelligentSecurityReply } from "./ollama-proxy";

const router: IRouter = Router();

router.get("/agent/tools", async (_req, res, next) => {
  try {
    return res.json(TOOLS.map((t) => ({
      name: t.name,
      category: t.category,
      description: t.description,
      riskLevel: t.riskLevel,
    })));
  } catch (e) { return next(e); }
});

router.get("/agent/tasks/:taskId/steps", async (req, res, next) => {
  try {
    const rows = await db.select().from(agentTaskStepsTable)
      .where(eq(agentTaskStepsTable.taskId, req.params.taskId))
      .orderBy(asc(agentTaskStepsTable.createdAt));
    return res.json(rows.map((s) => ({
      id: s.id,
      taskId: s.taskId,
      kind: s.kind,
      title: s.title,
      content: s.content,
      createdAt: s.createdAt.toISOString(),
    })));
  } catch (e) { return next(e); }
});

const SYSTEM_TOOLS = `أنت "CyberNova Agent" — وكيل أمني ذكي ومتقدم.
- ترد دائماً بالعربية الفصحى وبأسلوب تقني واضح.
- استخدم الأدوات المتاحة (search_cve_local, fetch_cve_live, search_mitre, search_cwe, search_github, search_exploitdb, fetch_url, dns_lookup, list_files, read_file, knowledge_search, run_shell, full_scan, hash_text) عند الحاجة.
- خطط بشكل صريح في رسالتك الأولى ثم نفّذ خطوة خطوة.
- لا تستخدم رموز إيموجي. استخدم Markdown منظم.
- عند الانتهاء قدّم خلاصة وتوصيات.`;

router.post("/agent/run", async (req, res, next) => {
  try {
    const { prompt, conversationId } = (req.body ?? {}) as { prompt: string; conversationId?: string };
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    // ── Standalone mode (no Postgres) ────────────────────────────────────────
    // Without DATABASE_URL every INSERT/UPDATE below would throw. In that mode we
    // still want the agent page to work, so the run is executed fully in memory
    // and the exact same response contract is returned.
    if (!process.env.DATABASE_URL) {
      const t0 = Date.now();
      const reply = buildStandaloneAgentAnswer(prompt);
      const toolResults = await runStandaloneTools(prompt);
      return res.json({
        taskId: `standalone-${t0}`,
        finalAnswer: toolResults.length
          ? `${reply}\n\n---\n\n### نتائج الأدوات\n${toolResults.map((r) => `- **${r.name}** → ${r.output.slice(0, 400)}`).join("\n")}`
          : reply,
        iterations: 1,
        mode: "standalone",
        steps: [
          {
            id: "1",
            taskId: `standalone-${t0}`,
            kind: "plan",
            title: "استلام المهمة",
            content: prompt,
            createdAt: new Date(t0).toISOString(),
          },
          {
            id: "2",
            taskId: `standalone-${t0}`,
            kind: "answer",
            title: "الإجابة النهائية",
            content: reply,
            createdAt: new Date(t0 + 1).toISOString(),
          },
        ],
      });
    }

    const [task] = await db.insert(agentTasksTable).values({
      conversationId: conversationId ?? null,
      title: prompt.slice(0, 80),
      agent: "orchestrator-v2",
      status: "running",
      progress: 5,
    }).returning();
    const taskId = task!.id;

    async function addStep(kind: string, title: string, content: string) {
      await db.insert(agentTaskStepsTable).values({ taskId, kind, title, content });
    }

    await addStep("plan", "استلام المهمة", prompt);

    const { client, model } = await resolveAi();

    const toolDefs = TOOLS.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    type Msg =
      | { role: "system"; content: string }
      | { role: "user"; content: string }
      | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
      | { role: "tool"; content: string; tool_call_id: string };

    const messages: Msg[] = [
      { role: "system", content: SYSTEM_TOOLS },
      { role: "user", content: prompt },
    ];

    let finalText = "";
    let iter = 0;
    const MAX = 8;

    while (iter < MAX) {
      iter++;
      let response;
      try {
        response = await client.chat.completions.create({
          model,
          max_completion_tokens: 1024,
          messages,
          ...(toolDefs.length ? { tools: toolDefs, tool_choice: "auto" } : {}),
        });
      } catch (err) {
        await addStep("observation", "خطأ في النموذج", (err as Error).message);
        finalText = `حدث خطأ في النموذج: ${(err as Error).message}`;
        break;
      }

      const choice = response.choices[0];
      const text = choice.message.content || "";
      const toolCalls = choice.message.tool_calls ?? [];

      if (text.trim()) {
        await addStep("thought", `تفكير ${iter}`, text);
      }

      if (choice.finish_reason !== "tool_calls" || toolCalls.length === 0) {
        finalText = text;
        break;
      }

      // Append assistant message with tool calls
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments || "{}"); } catch { input = {}; }
        await addStep("tool", `أداة: ${tc.function.name}`, JSON.stringify(input));
        let out = "";
        try {
          out = await runTool(tc.function.name, input);
        } catch (err) {
          out = `خطأ في الأداة: ${(err as Error).message}`;
        }
        await addStep("observation", `مخرجات: ${tc.function.name}`, out.slice(0, 4000));
        messages.push({ role: "tool", tool_call_id: tc.id, content: out.slice(0, 4000) });
      }

      await db.update(agentTasksTable).set({
        progress: Math.min(95, 5 + iter * 12),
        updatedAt: new Date(),
      }).where(eq(agentTasksTable.id, taskId));
    }

    await addStep("answer", "الإجابة النهائية", finalText);
    await db.update(agentTasksTable).set({
      status: "completed",
      progress: 100,
      output: finalText.slice(0, 8000),
      updatedAt: new Date(),
    }).where(eq(agentTasksTable.id, taskId));

    const steps = await db.select().from(agentTaskStepsTable)
      .where(eq(agentTaskStepsTable.taskId, taskId))
      .orderBy(asc(agentTaskStepsTable.createdAt));

    return res.json({
      taskId,
      finalAnswer: finalText,
      iterations: iter,
      steps: steps.map((s) => ({
        id: s.id,
        taskId: s.taskId,
        kind: s.kind,
        title: s.title,
        content: s.content,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (e) { return next(e); }
});

/**
 * Standalone (no-Postgres) agent answer. Reuses the same intelligent security
 * brain that powers the other agent endpoints so behaviour stays consistent.
 */
function buildStandaloneAgentAnswer(prompt: string): string {
  const brain = buildIntelligentSecurityReply([{ role: "user", content: prompt }]);
  return `### 🧠 CyberNova Agent v3 — وضع مستقل (بدون قاعدة بيانات)\n\n${brain}`;
}

/**
 * Runs only side-effect-free, offline-safe tools for the standalone agent run.
 * Network / shell tools are intentionally skipped so the endpoint can never
 * turn into an unexpected outbound action.
 */
async function runStandaloneTools(prompt: string): Promise<Array<{ name: string; output: string }>> {
  const results: Array<{ name: string; output: string }> = [];
  const safeTools = new Set(["search_cve_local", "search_mitre", "search_cwe", "knowledge_search", "hash_text"]);
  const candidates: Array<{ name: string; input: Record<string, unknown> }> = [];

  const cveMatch = prompt.match(/CVE-\d{4}-\d{4,7}/i);
  if (cveMatch) candidates.push({ name: "search_cve_local", input: { query: cveMatch[0] } });
  if (/mitre|att&ck|تكتيك/i.test(prompt)) candidates.push({ name: "search_mitre", input: { query: prompt.slice(0, 80) } });
  if (/cwe|ثغرة|فئة/i.test(prompt)) candidates.push({ name: "search_cwe", input: { query: prompt.slice(0, 80) } });

  for (const c of candidates.slice(0, 2)) {
    if (!safeTools.has(c.name)) continue;
    try {
      const out = await runTool(c.name, c.input);
      results.push({ name: c.name, output: String(out ?? "") });
    } catch {
      // Tool failures must never break the agent response
    }
  }
  return results;
}

export default router;
