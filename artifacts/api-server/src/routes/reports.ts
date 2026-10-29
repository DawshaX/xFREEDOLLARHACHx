import { Router, type IRouter } from "express";
import { db, reportsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { getOllamaBaseUrl, getOllamaModel } from "../lib/ollama-settings";

const router: IRouter = Router();

async function ollamaGenerate(prompt: string): Promise<string> {
  const OLLAMA_BASE = await getOllamaBaseUrl();
  const OLLAMA_MODEL = await getOllamaModel();
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.4, num_predict: 4096 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return data.response ?? "";
}

router.get("/reports", async (_req, res, next) => {
  try {
    const rows = await db.select().from(reportsTable).orderBy(desc(reportsTable.createdAt)).limit(100);
    res.json(rows.map(r => ({
      id: r.id, title: r.title, target: r.target, kind: r.kind,
      summary: r.summary, markdown: r.markdown,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (e) { return next(e); }
});

router.post("/reports", async (req, res, next) => {
  try {
    const body = req.body as { title: string; target: string; kind: string; notes?: string };

    const prompt = `أنت محلل أمني محترف متخصص في الأمن السيبراني.
اكتب تقريرًا ${body.kind} احترافيًا باللغة العربية بصيغة Markdown يحتوي على:

# ${body.title}

## ملخص تنفيذي
## النطاق والأهداف
## المنهجية المتبعة
## النتائج والثغرات
(تصنيف لكل ثغرة: حرج/عالي/متوسط/منخفض مع CVSS)
## التوصيات والحلول
## الخلاصة

الهدف: ${body.target}
نوع التقرير: ${body.kind}
ملاحظات: ${body.notes ?? "لا توجد"}

اكتب التقرير الآن بشكل مفصّل واحترافي:`;

    let markdown = "";
    let summary = "";

    try {
      markdown = await ollamaGenerate(prompt);
      summary = markdown.split("\n").filter(l => l.trim()).slice(0, 5).join(" ").slice(0, 300);
    } catch (err) {
      const model = await getOllamaModel();
      markdown = `# ${body.title}\n\n## ملاحظة\nتعذر توليد التقرير بـ Ollama: ${(err as Error).message}\n\nتأكد من تشغيل Ollama مع نموذج ${model}.\n\n## الهدف\n${body.target}\n\n## نوع التقرير\n${body.kind}`;
      summary = "تقرير محلي — Ollama غير متاح.";
    }

    const [row] = await db.insert(reportsTable).values({
      title: body.title, target: body.target, kind: body.kind, summary, markdown,
    }).returning();

    res.json({
      id: row!.id, title: row!.title, target: row!.target, kind: row!.kind,
      summary: row!.summary, markdown: row!.markdown,
      createdAt: row!.createdAt.toISOString(),
    });
  } catch (e) { return next(e); }
});

router.delete("/reports/:id", async (req, res, next) => {
  try {
    const { eq } = await import("drizzle-orm");
    await db.delete(reportsTable).where(eq(reportsTable.id, Number(req.params["id"])));
    res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
