import { Router, type IRouter } from "express";
import { db, agentTasksTable, agentTaskStepsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { resolveAi } from "../lib/ai";
import { TOOLS, runTool } from "../lib/agentTools";

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
    const { prompt, conversationId } = req.body as { prompt: string; conversationId?: string };
    if (!prompt) return res.status(400).json({ error: "prompt required" });

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

export default router;
