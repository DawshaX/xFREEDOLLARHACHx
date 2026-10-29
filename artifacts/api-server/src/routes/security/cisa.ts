import { Router, type IRouter } from "express";
import { fetchCisaKev } from "../../lib/security-tools";

const router: IRouter = Router();

router.get("/kev", async (_req, res) => {
  try {
    const data = await fetchCisaKev();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

router.get("/kev/search", async (req, res) => {
  try {
    const q = String(req.query["q"] ?? "").toLowerCase().trim();
    const data = (await fetchCisaKev()) as {
      vulnerabilities?: {
        cveID: string;
        vulnerabilityName: string;
        vendorProject: string;
        product: string;
        dueDate: string;
        shortDescription: string;
      }[];
    };
    const all = data.vulnerabilities ?? [];
    const filtered = q
      ? all.filter(
          (v) =>
            v.cveID.toLowerCase().includes(q) ||
            v.vulnerabilityName.toLowerCase().includes(q) ||
            v.vendorProject.toLowerCase().includes(q) ||
            v.product.toLowerCase().includes(q) ||
            (v.shortDescription ?? "").toLowerCase().includes(q),
        )
      : all;
    res.json({ count: filtered.length, total: all.length, results: filtered.slice(0, 100) });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

export default router;
