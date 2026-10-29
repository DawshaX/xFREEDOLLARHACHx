import { Router, type IRouter } from "express";
import { fetchUrlAsText } from "../../lib/security-tools";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const url = String(req.query["url"] ?? "").trim();
    if (!url) { res.status(400).json({ error: "missing url" }); return; }
    if (!/^https?:\/\//i.test(url))
      { res.status(400).json({ error: "url must start with http(s)://" }); return; }
    const data = await fetchUrlAsText(url);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

router.post("/", async (req, res) => {
  try {
    const url = String(req.body?.url ?? "").trim();
    if (!url) { res.status(400).json({ error: "missing url" }); return; }
    if (!/^https?:\/\//i.test(url))
      { res.status(400).json({ error: "url must start with http(s)://" }); return; }
    const data = await fetchUrlAsText(url);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

export default router;
