import { Router, type IRouter } from "express";
import { desc, eq, like } from "drizzle-orm";
import { db, botMemory, botCronJobs, botAlerts } from "@workspace/db";
import { streamPlainText, chatRoundWithTools } from "../lib/ai-router-ollama-only";
import { AGENT_TOOLS, runTool, CLIENT_TOOL_NAMES } from "../lib/tools";

const router: IRouter = Router();

// ============================================================
// BOT MEMORY
// ============================================================

router.get("/bot/memory", async (req, res) => {
  const { type, q, limit } = req.query;
  let query = db.select().from(botMemory).$dynamic();
  if (type) {
    query = query.where(eq(botMemory.memoryType, String(type)));
  }
  if (q) {
    query = query.where(like(botMemory.content, `%${String(q)}%`));
  }
  const rows = await query
    .orderBy(desc(botMemory.updatedAt))
    .limit(Math.min(Number(limit ?? 50), 200));
  res.json(rows);
});

router.post("/bot/memory", async (req, res) => {
  const { memoryType, key, content, context, confidence, tags, sourceSessionId } = req.body ?? {};
  if (!memoryType || !key || !content) {
    res.status(400).json({ error: "memoryType, key, and content are required" });
    return;
  }
  const [row] = await db
    .insert(botMemory)
    .values({
      memoryType: String(memoryType),
      key: String(key),
      content: String(content),
      context: String(context ?? ""),
      confidence: Number(confidence ?? 1.0),
      tags: String(tags ?? ""),
      ...(sourceSessionId && { sourceSessionId: Number(sourceSessionId) }),
    })
    .returning();
  res.status(201).json(row);
});

router.delete("/bot/memory/:id", async (req, res) => {
  await db.delete(botMemory).where(eq(botMemory.id, Number(req.params.id)));
  res.status(204).end();
});

// ============================================================
// BOT CRON JOBS
// ============================================================

router.get("/bot/cron", async (_req, res) => {
  const rows = await db.select().from(botCronJobs).orderBy(desc(botCronJobs.createdAt));
  res.json(rows);
});

router.post("/bot/cron", async (req, res) => {
  const { name, description, cronExpression, prompt } = req.body ?? {};
  if (!name || !cronExpression || !prompt) {
    res.status(400).json({ error: "name, cronExpression, and prompt are required" });
    return;
  }
  const [row] = await db
    .insert(botCronJobs)
    .values({
      name: String(name),
      description: String(description ?? ""),
      cronExpression: String(cronExpression),
      prompt: String(prompt),
    })
    .returning();
  res.status(201).json(row);
});

router.put("/bot/cron/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, cronExpression, prompt, isEnabled } = req.body ?? {};
  const [updated] = await db
    .update(botCronJobs)
    .set({
      ...(name && { name: String(name) }),
      ...(description !== undefined && { description: String(description) }),
      ...(cronExpression && { cronExpression: String(cronExpression) }),
      ...(prompt && { prompt: String(prompt) }),
      ...(isEnabled !== undefined && { isEnabled: String(isEnabled) }),
    })
    .where(eq(botCronJobs.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.delete("/bot/cron/:id", async (req, res) => {
  await db.delete(botCronJobs).where(eq(botCronJobs.id, Number(req.params.id)));
  res.status(204).end();
});

router.post("/bot/cron/:id/trigger", async (req, res) => {
  const id = Number(req.params.id);
  const [job] = await db.select().from(botCronJobs).where(eq(botCronJobs.id, id));
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  send("cron_started", { jobId: id, name: job.name, prompt: job.prompt });

  try {
    const systemPrompt = `أنت CyberNova Bot — وكيل أمني ذاتي يعمل على مدار الساعة. تم تشغيلك بواسطة مهمة مجدولة (Cron Job).
المهمة: ${job.name}
الوصف: ${job.description}
لديك أدوات حقيقية لتنفيذ المهمة. نفّذ المطلوب وأرسل تقريراً موجزاً.`;

    const toolDefs = AGENT_TOOLS.filter((t) => !CLIENT_TOOL_NAMES.has(t.name));

    type MsgBlock =
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

    const history: Array<{ role: "user" | "assistant"; content: string | MsgBlock[] }> = [
      { role: "user", content: job.prompt },
    ];

    let iterations = 0;
    const MAX_ITER = 6;

    while (iterations < MAX_ITER) {
      iterations++;

      const round = await chatRoundWithTools({
        system: systemPrompt,
        messages: history,
        tools: toolDefs,
        maxTokens: 2048,
        onText: (delta) => {
          send("cron_delta", { text: delta });
        },
      });

      if (round.toolCalls.length === 0) {
        // Done
        send("cron_message", { text: round.text });
        if (round.text.length > 50) {
          await db.insert(botMemory).values({
            memoryType: "success_pattern",
            key: `cron_${job.name}_${Date.now()}`,
            content: round.text.slice(0, 2000),
            context: `Cron job: ${job.name}`,
            tags: "cron,auto",
          });
        }
        break;
      }

      // Append assistant message with tool calls
      history.push({ role: "assistant", content: round.assistantBlocks as MsgBlock[] });

      // Execute tools and collect results
      const toolResults: MsgBlock[] = [];
      for (const tc of round.toolCalls) {
        send("tool_call", { name: tc.name, input: tc.input });
        try {
          const result = await runTool(tc.name, tc.input);
          const content = JSON.stringify(result).slice(0, 4000);
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content });
          send("tool_result", { name: tc.name, result });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: `Error: ${String(err)}`,
            is_error: true,
          });
        }
      }

      history.push({ role: "user", content: toolResults });

      if (round.done) break;
    }

    await db
      .update(botCronJobs)
      .set({ lastRunAt: new Date(), lastStatus: "success", runCount: job.runCount + 1 })
      .where(eq(botCronJobs.id, id));

    send("cron_completed", { jobId: id, status: "success" });
  } catch (err) {
    await db
      .update(botCronJobs)
      .set({ lastRunAt: new Date(), lastStatus: "failed", runCount: job.runCount + 1 })
      .where(eq(botCronJobs.id, id));
    send("cron_error", { error: String(err) });
  }

  res.end();
});

// ============================================================
// BOT ALERTS
// ============================================================

router.get("/bot/alerts", async (req, res) => {
  const { unread, limit } = req.query;
  let query = db.select().from(botAlerts).$dynamic();
  if (unread === "true") {
    query = query.where(eq(botAlerts.isRead, "false"));
  }
  const rows = await query
    .orderBy(desc(botAlerts.createdAt))
    .limit(Math.min(Number(limit ?? 50), 200));
  res.json(rows);
});

router.post("/bot/alerts", async (req, res) => {
  const { severity, title, message, source, metadata } = req.body ?? {};
  if (!title || !message) {
    res.status(400).json({ error: "title and message are required" });
    return;
  }
  const [row] = await db
    .insert(botAlerts)
    .values({
      severity: String(severity ?? "info"),
      title: String(title),
      message: String(message),
      source: String(source ?? "bot"),
      metadata: JSON.stringify(metadata ?? {}),
    })
    .returning();
  res.status(201).json(row);
});

router.put("/bot/alerts/:id/read", async (req, res) => {
  await db
    .update(botAlerts)
    .set({ isRead: "true" })
    .where(eq(botAlerts.id, Number(req.params.id)));
  res.status(204).end();
});

router.put("/bot/alerts/read-all", async (_req, res) => {
  await db.update(botAlerts).set({ isRead: "true" });
  res.status(204).end();
});

router.delete("/bot/alerts/:id", async (req, res) => {
  await db.delete(botAlerts).where(eq(botAlerts.id, Number(req.params.id)));
  res.status(204).end();
});

router.get("/bot/status", async (_req, res) => {
  const memoryRows = await db.select().from(botMemory);
  const cronRows = await db.select().from(botCronJobs);
  const enabledCron = cronRows.filter((c) => c.isEnabled === "true");
  const unreadAlerts = await db
    .select()
    .from(botAlerts)
    .where(eq(botAlerts.isRead, "false"));

  const criticalAlerts = unreadAlerts.filter((a) => a.severity === "critical").length;
  const highAlerts = unreadAlerts.filter((a) => a.severity === "high").length;

  res.json({
    status: "online",
    uptime: process.uptime(),
    memory: { total: memoryRows.length },
    cronJobs: { total: cronRows.length, enabled: enabledCron.length },
    alerts: { unread: unreadAlerts.length, critical: criticalAlerts, high: highAlerts },
    availableTools: AGENT_TOOLS.length,
  });
});

export default router;
