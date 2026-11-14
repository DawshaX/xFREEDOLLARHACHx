import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db, agentTasks, agentSteps } from "@workspace/db";
import { streamPlainText } from "../lib/ai-router-ollama-only";
import { saveMemory as saveMemoryRoute } from "../routes/memory";
import { z } from "zod";

const CreateAgentTaskBody = z.object({ goal: z.string(), feedback: z.string().optional() });

const router: IRouter = Router();

interface PlannedStep {
  title: string;
  description: string;
}

async function planSteps(
  goal: string,
  feedback?: string,
  prior?: PlannedStep[],
): Promise<PlannedStep[]> {
  let userPrompt = `الهدف:\n${goal}`;
  if (prior && prior.length) {
    userPrompt += `\n\nالخطة السابقة:\n${prior
      .map((s, i) => `${i + 1}. ${s.title} — ${s.description}`)
      .join("\n")}`;
  }
  if (feedback) {
    userPrompt += `\n\nملاحظات/تعديلات من المستخدم:\n${feedback}`;
  }
  const { text } = await streamPlainText({
    system:
      "أنت مخطّط وكيل ذكاء اصطناعي ذاتي. للهدف المعطى، اكتب خطة مكوّنة من 3-7 خطوات واقعية ومحددة. أعد JSON فقط: مصفوفة عناصر فيها {title (عنوان قصير بالعربية), description (فقرة واضحة بالعربية تشرح ماذا سيحدث ولماذا)}. لا تضف أي نص خارج المصفوفة.",
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 2048,
  });
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as PlannedStep[];
  } catch {}
  return [{ title: "تحليل الهدف", description: goal }];
}

router.get("/agent/tasks", async (_req, res) => {
  const rows = await db
    .select()
    .from(agentTasks)
    .orderBy(desc(agentTasks.createdAt));
  res.json(rows);
});

router.post("/agent/tasks", async (req, res) => {
  const body = CreateAgentTaskBody.parse(req.body);
  const goal = body.goal;

  const [task] = await db
    .insert(agentTasks)
    .values({
      title: goal.slice(0, 80),
      description: goal,
      status: "planned",
    })
    .returning();

  const steps = await planSteps(goal);
  const inserted = await db
    .insert(agentSteps)
    .values(
      steps.map((s, i) => ({
        taskId: task.id,
        orderIndex: i,
        title: s.title || `Step ${i + 1}`,
        description: s.description || "",
        status: "pending",
        output: "",
      })),
    )
    .returning();

  res.status(201).json({ ...task, steps: inserted });
});

router.get("/agent/tasks/:id", async (req, res) => {
  const id = String(req.params.id);
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, id));
  if (!task) { res.status(404).json({ error: "Not found" }); return; }
  const steps = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.taskId, id))
    .orderBy(asc(agentSteps.orderIndex));
  res.json({ ...task, steps });
});

router.delete("/agent/tasks/:id", async (req, res) => {
  const id = String(req.params.id);
  await db.delete(agentTasks).where(eq(agentTasks.id, id));
  res.status(204).end();
});

// PATCH a single pending step (edit title/description before approval)
router.patch("/agent/tasks/:id/steps/:stepId", async (req, res) => {
  const stepId = String(req.params.stepId);
  const { title, description } = req.body as {
    title?: string;
    description?: string;
  };
  const patch: Record<string, string> = {};
  if (typeof title === "string" && title.trim()) patch.title = title.trim();
  if (typeof description === "string") patch.description = description;
  if (!Object.keys(patch).length) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(agentSteps)
    .set(patch)
    .where(eq(agentSteps.id, stepId))
    .returning();
  res.json(updated);
});

// Skip a step (mark as skipped without executing)
router.post("/agent/tasks/:id/steps/:stepId/skip", async (req, res) => {
  const stepId = String(req.params.stepId);
  const [updated] = await db
    .update(agentSteps)
    .set({ status: "skipped", output: "تم التخطّي بطلب من المستخدم" })
    .where(eq(agentSteps.id, stepId))
    .returning();
  res.json(updated);
});

// Re-plan: regenerate steps based on optional feedback. Replaces all pending/skipped steps.
router.post("/agent/tasks/:id/replan", async (req, res) => {
  const id = String(req.params.id);
  const { feedback } = req.body as { feedback?: string };
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, id));
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const existing = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.taskId, id))
    .orderBy(asc(agentSteps.orderIndex));
  const prior = existing.map((s) => ({
    title: s.title,
    description: s.description,
  }));
  const newSteps = await planSteps(task.description, feedback, prior);
  // Delete only non-completed steps so we keep history
  for (const s of existing) {
    if (s.status !== "completed") {
      await db.delete(agentSteps).where(eq(agentSteps.id, s.id));
    }
  }
  const completedCount = existing.filter((s) => s.status === "completed").length;
  const inserted = await db
    .insert(agentSteps)
    .values(
      newSteps.map((s, i) => ({
        taskId: id,
        orderIndex: completedCount + i,
        title: s.title || `خطوة ${completedCount + i + 1}`,
        description: s.description || "",
        status: "pending",
        output: "",
      })),
    )
    .returning();
  await db
    .update(agentTasks)
    .set({ status: "planned" })
    .where(eq(agentTasks.id, id));
  const all = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.taskId, id))
    .orderBy(asc(agentSteps.orderIndex));
  res.json({ ...task, steps: all, newStepIds: inserted.map((s) => s.id) });
});

// Run ONE single step (SSE stream for live tokens). Approval gateway used by chat UI.
router.post("/agent/tasks/:id/steps/:stepId/run", async (req, res) => {
  const id = String(req.params.id);
  const stepId = String(req.params.stepId);
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, id));
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [step] = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.id, stepId));
  if (!step || step.taskId !== id) {
    res.status(404).json({ error: "Step not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  await db
    .update(agentSteps)
    .set({ status: "running", output: "" })
    .where(eq(agentSteps.id, stepId));
  await db
    .update(agentTasks)
    .set({ status: "running" })
    .where(eq(agentTasks.id, id));
  send("step_started", { stepId, title: step.title });

  try {
    const { text: output, provider } = await streamPlainText({
      system: `أنت تنفّذ خطوة واحدة من خطة وكيل ذاتي للهدف: "${task.description}". قدّم النتيجة الفعلية للخطوة باللغة العربية بشكل ملموس وتقني وكامل.`,
      messages: [
        {
          role: "user",
          content: `الخطوة ${step.orderIndex + 1}: ${step.title}\n\nالتفاصيل: ${step.description}`,
        },
      ],
      maxTokens: 4096,
      onText: (d) => send("step_delta", { stepId, text: d }),
    });
    send("provider_used", { stepId, provider: provider.id });
    await db
      .update(agentSteps)
      .set({ status: "completed", output })
      .where(eq(agentSteps.id, stepId));
    send("step_completed", { stepId, output });

    // If all non-skipped steps are done, mark task completed
    const remaining = await db
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.taskId, id));
    if (remaining.every((s) => s.status === "completed" || s.status === "skipped")) {
      await db
        .update(agentTasks)
        .set({ status: "completed" })
        .where(eq(agentTasks.id, id));
      send("task_completed", { taskId: id });
    }
    res.end();
  } catch (err) {
    await db
      .update(agentSteps)
      .set({
        status: "failed",
        output: err instanceof Error ? err.message : "Unknown error",
      })
      .where(eq(agentSteps.id, stepId));
    send("error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    res.end();
  }
});

router.post("/agent/tasks/:id/run", async (req, res) => {
  const id = String(req.params.id);
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, id));
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  const steps = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.taskId, id))
    .orderBy(asc(agentSteps.orderIndex));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  await db
    .update(agentTasks)
    .set({ status: "running" })
    .where(eq(agentTasks.id, id));
  send("task_started", { taskId: id, totalSteps: steps.length });

  try {
    for (const step of steps) {
      if (step.status === "completed" || step.status === "skipped") {
        send("step_skipped", { stepId: step.id });
        continue;
      }
      await db
        .update(agentSteps)
        .set({ status: "running" })
        .where(eq(agentSteps.id, step.id));
      send("step_started", { stepId: step.id, title: step.title });

      const { text: output, provider } = await streamPlainText({
        system: `أنت تنفّذ خطوة واحدة من خطة وكيل ذاتي للهدف: "${task.description}". قدّم النتيجة الفعلية للخطوة باللغة العربية بشكل ملموس وتقني وكامل.`,
        messages: [
          {
            role: "user",
            content: `الخطوة ${step.orderIndex + 1}: ${step.title}\n\nالتفاصيل: ${step.description}`,
          },
        ],
        maxTokens: 4096,
        onText: (d) => send("step_delta", { stepId: step.id, text: d }),
      });
      send("provider_used", { stepId: step.id, provider: provider.id });

      await db
        .update(agentSteps)
        .set({ status: "completed", output })
        .where(eq(agentSteps.id, step.id));
      send("step_completed", { stepId: step.id, output });
    }

    await db
      .update(agentTasks)
      .set({ status: "completed" })
      .where(eq(agentTasks.id, id));
    send("task_completed", { taskId: id });
    res.end();
  } catch (err) {
    await db
      .update(agentTasks)
      .set({ status: "failed" })
      .where(eq(agentTasks.id, id));
    send("error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    res.end();
  }
});

export default router;

/* ── TEST9 «فروع المهمات + الدوّن» ──────────────────────────────────────────
 * الفرع = مهمة ابنة بـmetadata.parentTaskId — بلا تغيير سكيما (pgbTree
 * metadata jsonb). الدوّن = سجل تعلّم دائم في الذاكرة بنطاق task:<id> —
 * «وكل الي عملو وبيعملو وهيعلمو» بيرجع في اليوميات. كل فعل بيرفع إشعارًا
 * حيًا بـlink يودّي المالك لصفحة المهمات. */
import { createPushNotification } from "../lib/push-hub";
import { remember, listMemories } from "../lib/agent/memory-store";

function taskParentId(t: { metadata?: unknown }): string | null {
  const m = (t?.metadata ?? {}) as { parentTaskId?: string };
  return typeof m.parentTaskId === "string" ? m.parentTaskId : null;
}

router.get("/agent/tasks/:id/branches", async (req, res) => {
  const id = String(req.params.id);
  const all = await db.select().from(agentTasks).orderBy(desc(agentTasks.createdAt));
  const branches = all.filter((t) => taskParentId(t) === id);
  res.json({ ok: true, branches });
});

router.post("/agent/tasks/:id/branches", async (req, res) => {
  const id = String(req.params.id);
  const [parent] = await db.select().from(agentTasks).where(eq(agentTasks.id, id));
  if (!parent) { res.status(404).json({ ok: false, error: "المهمة الأم مش موجودة" }); return; }
  const body = z.object({ goal: z.string().min(2) }).parse(req.body);

  const [branch] = await db
    .insert(agentTasks)
    .values({
      title: body.goal.slice(0, 80),
      description: `⤷ فرع من «${parent.title}»: ${body.goal}`,
      status: "planned",
      metadata: { parentTaskId: id },
    })
    .returning();

  let steps: Array<{ id: string; title: string; status: string }> = [];
  try {
    const planned = await planSteps(body.goal);
    const inserted = await db
      .insert(agentSteps)
      .values(planned.map((s, i) => ({ taskId: branch.id, orderIndex: i, title: s.title || `خطوة ${i + 1}`, description: s.description || "", status: "pending", output: "" })))
      .returning();
    steps = inserted.map((s) => ({ id: s.id, title: s.title, status: s.status }));
  } catch {
    // المخطّط مش متاح (موديل غايب) — فرع بصدق: خطوة واحدة معلّقة بلا ادعاء.
    const [only] = await db.insert(agentSteps).values({ taskId: branch.id, orderIndex: 0, title: body.goal.slice(0, 80), description: "المخطّط الذكي غير متاح — الخطوة واحدة حتى يتاح", status: "pending", output: "" }).returning();
    steps = [{ id: only.id, title: only.title, status: only.status }];
  }

  try {
    remember({ kind: "event", title: `فرع مهمة: ${body.goal.slice(0, 60)}`, content: `اتفتح فرع تحت «${parent.title}»`, scope: `task:${id}`, importance: 5, source: "agent" });
  } catch { /* best-effort */ }
  createPushNotification({ kind: "success", title: "مهمات الأجينت", body: `فرع جديد اتعمل: ${body.goal.slice(0, 70)}`, link: "/agent-pro" });
  res.status(201).json({ ok: true, branch: { ...branch, steps } });
});

router.post("/agent/tasks/:id/notes", async (req, res) => {
  const id = String(req.params.id);
  const [task] = await db.select().from(agentTasks).where(eq(agentTasks.id, id));
  if (!task) { res.status(404).json({ ok: false, error: "المهمة مش موجودة" }); return; }
  const body = z.object({ content: z.string().min(2), title: z.string().optional() }).parse(req.body);
  const rec = remember({ kind: "lesson", title: body.title?.slice(0, 80) ?? `دوّن: ${task.title.slice(0, 60)}`, content: body.content, scope: `task:${id}`, importance: 7, source: "owner" });
  try { saveMemoryRoute("lesson", rec.title, rec.content, `task:${id},longterm`, 7, false); } catch { /* mirror best-effort */ }
  createPushNotification({ kind: "success", title: "دوّن المهمة", body: `اتسجّل تعلّم دائم تحت «${task.title.slice(0, 60)}»`, link: "/agent-pro" });
  res.status(201).json({ ok: true, note: rec });
});

router.get("/agent/tasks/:id/journal", async (req, res) => {
  const id = String(req.params.id);
  const [task] = await db.select().from(agentTasks).where(eq(agentTasks.id, id));
  if (!task) { res.status(404).json({ ok: false, error: "المهمة مش موجودة" }); return; }
  const steps = await db.select().from(agentSteps).where(eq(agentSteps.taskId, id)).orderBy(asc(agentSteps.orderIndex));
  const all = await db.select().from(agentTasks).orderBy(desc(agentTasks.createdAt));
  const branches = all.filter((t) => taskParentId(t) === id).map((t) => ({ id: t.id, title: t.title, status: t.status }));
  const memories = listMemories({ scope: `task:${id}`, sort: "recent", limit: 30 });
  res.json({ ok: true, task, steps, branches, learnings: memories.items.map((m) => ({ id: m.id, title: m.title, content: m.content, kind: m.kind, ts: m.createdAt ?? m.id })) });
});
