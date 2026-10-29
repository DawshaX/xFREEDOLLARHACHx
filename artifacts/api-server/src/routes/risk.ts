import { Router } from "express";
import { db, riskScores, cves } from "@workspace/db";
import { desc, eq, sql, gte } from "drizzle-orm";
import { scoreTopCves, getRiskStats, scoreOneCve } from "../lib/risk-engine";
import { runLlmAnalysisBatch, checkOllamaAvailable, generateScanReport } from "../lib/llm-analyzer";

const router = Router();

router.get("/risk/stats", async (req, res) => {
  try {
    const stats = await getRiskStats();
    const ollama = await checkOllamaAvailable();
    res.json({ ...stats, ollama });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب إحصائيات المخاطر" });
  }
});

router.get("/risk/top", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "50")), 200);
    const minScore = parseFloat(String(req.query["minScore"] ?? "0"));

    const top = await db
      .select({
        rs: riskScores,
        description: cves.description,
        publishedAt: cves.publishedAt,
        source: cves.source,
        url: cves.url,
      })
      .from(riskScores)
      .leftJoin(cves, eq(riskScores.cveId, cves.id))
      .where(minScore > 0 ? gte(riskScores.riskScore, minScore) : undefined)
      .orderBy(desc(riskScores.riskScore))
      .limit(limit);

    res.json({ results: top, total: top.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب أعلى المخاطر" });
  }
});

router.get("/risk/kev", async (req, res) => {
  try {
    const kevItems = await db
      .select({ rs: riskScores, description: cves.description, publishedAt: cves.publishedAt, url: cves.url })
      .from(riskScores)
      .leftJoin(cves, eq(riskScores.cveId, cves.id))
      .where(eq(riskScores.isInKev, true))
      .orderBy(desc(riskScores.riskScore))
      .limit(100);

    res.json({ kev: kevItems, total: kevItems.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب KEV" });
  }
});

router.post("/risk/score-batch", async (req, res) => {
  try {
    const limit = parseInt(String(req.body?.["limit"] ?? "200"));
    const scored = await scoreTopCves(limit);
    res.json({ scored, message: `تم تسجيل ${scored} ثغرة` });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل التقييم الجماعي" });
  }
});

router.post("/risk/score/:cveId", async (req, res) => {
  try {
    await scoreOneCve(req.params.cveId);
    const [score] = await db.select().from(riskScores).where(eq(riskScores.cveId, req.params.cveId)).limit(1);
    res.json({ score });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل تقييم الثغرة" });
  }
});

router.post("/risk/analyze-llm", async (req, res) => {
  try {
    const limit = parseInt(String(req.body?.["limit"] ?? "10"));
    const analyzed = await runLlmAnalysisBatch(limit);
    res.json({ analyzed, message: `تم تحليل ${analyzed} ثغرة بـ Llama3` });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل تحليل LLM" });
  }
});

router.post("/risk/report", async (req, res) => {
  try {
    const { scanId, findings } = req.body as { scanId: string; findings: Array<{ title: string; severity: string; description: string; url: string }> };
    const report = await generateScanReport(scanId ?? "manual", findings ?? []);
    res.json({ report });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل توليد التقرير" });
  }
});

export default router;
