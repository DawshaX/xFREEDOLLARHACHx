import { Router } from "express";
import { db, evidence } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { scanTarget } from "../lib/active-scanner";
import { generateScanReport } from "../lib/llm-analyzer";

const router = Router();

router.get("/evidence", async (req, res) => {
  try {
    const { scanId, severity, limit: lim } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(lim ?? "100"), 500);

    const conditions = [];
    if (scanId) conditions.push(eq(evidence.scanId, scanId));
    if (severity) conditions.push(eq(evidence.severity, severity));

    const rows = await db
      .select()
      .from(evidence)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(evidence.createdAt))
      .limit(limit);

    res.json({ evidence: rows, total: rows.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب الأدلة" });
  }
});

router.get("/evidence/scans", async (req, res) => {
  try {
    const rows = await db
      .selectDistinctOn([evidence.scanId], {
        scanId: evidence.scanId,
        targetUrl: evidence.targetUrl,
        createdAt: evidence.createdAt,
      })
      .from(evidence)
      .orderBy(evidence.scanId, desc(evidence.createdAt))
      .limit(50);
    res.json({ scans: rows });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب جلسات الفحص" });
  }
});

router.post("/evidence/scan", async (req, res) => {
  try {
    const { url, assetId } = req.body as { url: string; assetId?: string };
    if (!url) return res.status(400).json({ error: "URL مطلوب" });

    let targetUrl = url;
    if (!targetUrl.startsWith("http")) targetUrl = `https://${targetUrl}`;

    req.log.info({ url: targetUrl }, "Starting active scan");
    const result = await scanTarget({ url: targetUrl, assetId });

    const findings = result.findings.map(f => ({
      title: f.title,
      severity: f.severity,
      description: f.description,
      url: targetUrl,
    }));

    let aiReport = "";
    if (findings.length > 0) {
      aiReport = await generateScanReport(result.scanId, findings).catch(() => "");
    }

    res.json({
      scanId: result.scanId,
      target: result.target,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      totalChecks: result.totalChecks,
      findings: result.findings,
      totalFindings: result.findings.length,
      aiReport,
      severity: {
        critical: result.findings.filter(f => f.severity === "critical").length,
        high: result.findings.filter(f => f.severity === "high").length,
        medium: result.findings.filter(f => f.severity === "medium").length,
        low: result.findings.filter(f => f.severity === "low").length,
        info: result.findings.filter(f => f.severity === "info").length,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل الفحص: " + String(err) });
  }
});

router.patch("/evidence/:id/verify", async (req, res) => {
  try {
    const { isVerified, isFalsePositive } = req.body as { isVerified?: boolean; isFalsePositive?: boolean };
    const [updated] = await db.update(evidence)
      .set({ isVerified: isVerified ?? false, isFalsePositive: isFalsePositive ?? false })
      .where(eq(evidence.id, req.params.id))
      .returning();
    res.json({ evidence: updated });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل تحديث الدليل" });
  }
});

router.delete("/evidence/:id", async (req, res) => {
  try {
    await db.delete(evidence).where(eq(evidence.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل حذف الدليل" });
  }
});

export default router;
