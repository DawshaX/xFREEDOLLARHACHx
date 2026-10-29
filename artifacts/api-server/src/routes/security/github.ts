import { Router, type IRouter } from "express";
import { githubAdvisories, githubSearch } from "../../lib/security-tools";

const router: IRouter = Router();

router.get("/search", async (req, res) => {
  try {
    const q = String(req.query["q"] ?? "").trim();
    const typeRaw = String(req.query["type"] ?? "repositories");
    const type: "repositories" | "code" =
      typeRaw === "code" ? "code" : "repositories";
    const perPage = Number(req.query["per_page"] ?? 15);
    if (!q) { res.status(400).json({ error: "missing q" }); return; }
    const data = await githubSearch({ q, type, perPage });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

router.get(/^\/raw\/.*/, async (req, res) => {
  try {
    const subPath = req.path.replace(/^\/raw/, "");
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === "string") params.set(k, v);
    }
    const qs = params.toString();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "CyberNova/5.0",
    };
    const tok = process.env["GITHUB_TOKEN"];
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
    const r = await fetch(
      `https://api.github.com${subPath}${qs ? `?${qs}` : ""}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    res.status(r.status).type("application/json").send(await r.text());
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

router.get("/advisories", async (req, res) => {
  try {
    const perPage = Number(req.query["per_page"] ?? 10);
    const data = await githubAdvisories(perPage);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

export default router;
