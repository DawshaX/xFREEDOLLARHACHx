import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, conversations, messages, files } from "@workspace/db";
import { z } from "zod";
import { resolveAi } from "../lib/ai";

const CreateAnthropicConversationBody = z.object({ title: z.string().optional() });
const SendAnthropicMessageBody = z.object({
  role: z.enum(["user", "assistant"]).default("user"),
  content: z.string(),
  model: z.string().optional(),
});

const router: IRouter = Router();

router.get("/anthropic/conversations", async (_req, res) => {
  const rows = await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.createdAt));
  res.json(rows);
});

router.post("/anthropic/conversations", async (req, res) => {
  const body = CreateAnthropicConversationBody.parse(req.body);
  const [row] = await db
    .insert(conversations)
    .values({ title: body.title })
    .returning();
  res.status(201).json(row);
});

router.get("/anthropic/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);
  res.json({ ...conv, messages: msgs });
});

router.delete("/anthropic/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(conversations).where(eq(conversations.id, id));
  res.status(204).end();
});

router.get("/anthropic/conversations/:id/messages", async (req, res) => {
  const id = Number(req.params.id);
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);
  res.json(msgs);
});

router.post("/anthropic/conversations/:id/messages", async (req, res) => {
  const id = Number(req.params.id);
  const body = SendAnthropicMessageBody.parse(req.body);

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }

  // Fetch attachment context
  let attachmentContext = "";
  if (body.attachmentIds && body.attachmentIds.length > 0) {
    for (const fid of body.attachmentIds) {
      const [f] = await db.select().from(files).where(eq(files.id, fid));
      if (!f) continue;
      attachmentContext += `\n\n[Attached file: ${f.name} (${f.mimeType}, ${f.size} bytes)]`;
      if (f.mimeType.startsWith("text/") || f.mimeType.includes("json")) {
        try {
          const decoded = Buffer.from(f.contentBase64, "base64").toString("utf8");
          attachmentContext += `\n\`\`\`\n${decoded.slice(0, 8000)}\n\`\`\``;
        } catch {}
      }
    }
  }

  const userContent = body.content + attachmentContext;
  await db.insert(messages).values({
    conversationId: id,
    role: "user",
    content: body.content,
  });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { client, model } = await resolveAi();

    const formatted = history.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.id === history[history.length - 1].id ? userContent : m.content,
    }));

    let assistantText = "";

    const stream = await client.chat.completions.create({
      model,
      max_completion_tokens: 1024,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are CyberNova's AI security analyst. Reply in the same language as the user (default Arabic). Be concise, technical, and reference CVEs / OWASP when relevant.",
        },
        ...formatted,
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        assistantText += delta;
        send("delta", { text: delta });
      }
    }

    const [saved] = await db
      .insert(messages)
      .values({
        conversationId: id,
        role: "assistant",
        content: assistantText,
      })
      .returning();

    send("done", { message: saved });
    res.end();
  } catch (err) {
    send("error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    res.end();
  }
});

/**
 * Save user + assistant messages directly (no Ollama call).
 * Used when the browser streams from Ollama directly.
 */
router.post("/anthropic/conversations/:id/save-messages", async (req, res) => {
  const id = Number(req.params.id);
  const { userContent, assistantContent } = req.body as {
    userContent: string;
    assistantContent: string;
  };
  if (!userContent || !assistantContent) {
    res.status(400).json({ error: "userContent and assistantContent required" });
    return;
  }
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!c) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(messages).values({ conversationId: id, role: "user", content: userContent });
  const [saved] = await db
    .insert(messages)
    .values({ conversationId: id, role: "assistant", content: assistantContent })
    .returning();
  res.json(saved);
});

export default router;
