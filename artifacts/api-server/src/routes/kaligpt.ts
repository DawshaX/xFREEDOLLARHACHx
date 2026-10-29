import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import { resolveAi } from "../lib/ai";

const router: IRouter = Router();

const KALI_SYSTEM = `أنت "KaliGPT" — مساعد ذكاء اصطناعي متخصص في Kali Linux واختبار الاختراق الأخلاقي والأمن السيبراني الهجومي.
- أجب دائماً بالعربية الفصحى الواضحة، مع مصطلحات تقنية بالإنجليزية بين قوسين عند الحاجة.
- خبرتك تشمل: nmap, metasploit, burp suite, sqlmap, hydra, wireshark, john, hashcat, aircrack-ng, gobuster, nikto, OWASP ZAP، استغلال ثغرات الويب (XSS, SQLi, SSRF, RCE, IDOR, XXE)، تصعيد الصلاحيات في Linux/Windows، Active Directory attacks، تجاوز AV/EDR، Pivoting، Lateral Movement.
- قدّم أوامر جاهزة للنسخ مع شرح مختصر لكل علم/Flag.
- عند طلب اختبار اختراق، اطلب نطاق الاستهداف والاختصاص المسموح به أولاً.
- استخدم تنسيق Markdown مع code blocks و\`bash\` highlighting.
- التزم بالأخلاق المهنية: لا تساعد على اختراق أنظمة بدون إذن صريح.`;

router.get("/kaligpt/conversations", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.createdAt));
    res.json(rows.filter((r) => r.title && r.title.startsWith("[KaliGPT]")));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/kaligpt/conversations", async (req, res) => {
  try {
    const baseTitle = String(req.body?.title || "محادثة جديدة");
    const title = `[KaliGPT] ${baseTitle}`;
    const [row] = await db
      .insert(conversations)
      .values({ title })
      .returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/kaligpt/conversations/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [c] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (!c) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);
    res.json({ ...c, messages: msgs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/kaligpt/conversations/:id", async (req, res) => {
  try {
    await db.delete(conversations).where(eq(conversations.id, Number(req.params.id)));
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/kaligpt/conversations/:id/messages", async (req, res) => {
  const id = Number(req.params.id);
  const content = String(req.body?.content || "").trim();
  if (!content) {
    res.status(400).json({ error: "content required" });
    return;
  }
  const [c] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  if (!c) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db.insert(messages).values({ conversationId: id, role: "user", content });

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
      content: m.content,
    }));

    let assistantText = "";

    const stream = await client.chat.completions.create({
      model,
      max_completion_tokens: 1024,
      stream: true,
      messages: [
        { role: "system", content: KALI_SYSTEM },
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
    send("error", { error: err instanceof Error ? err.message : "Unknown" });
    res.end();
  }
});

/**
 * Save user + assistant messages directly (no Ollama call).
 * Used when the browser streams from Ollama directly.
 */
router.post("/kaligpt/conversations/:id/save-messages", async (req, res) => {
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
