import { Router } from "express";
import { runOsvSync, fetchOsvByEcosystem, osvLookup } from "../lib/osv-intel";

const router = Router();

router.post("/osv/sync", async (req, res) => {
  try {
    const total = await runOsvSync();
    res.json({ total, message: `OSV: تمت مزامنة ${total} ثغرة جديدة من المكتبات مفتوحة المصدر` });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشلت مزامنة OSV" });
  }
});

router.post("/osv/ecosystem", async (req, res) => {
  try {
    const { ecosystem, packageName } = req.body as { ecosystem: string; packageName?: string };
    if (!ecosystem) return res.status(400).json({ error: "ecosystem مطلوب" });
    const added = await fetchOsvByEcosystem(ecosystem, packageName);
    res.json({ added, message: `OSV ${ecosystem}: أضيف ${added} ثغرة` });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل جلب OSV" });
  }
});

router.get("/osv/lookup/:id", async (req, res) => {
  try {
    const data = await osvLookup(req.params.id);
    if (!data) return res.status(404).json({ error: "لم يُعثر على الثغرة في OSV" });
    res.json({ vuln: data });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "فشل البحث في OSV" });
  }
});

export default router;
