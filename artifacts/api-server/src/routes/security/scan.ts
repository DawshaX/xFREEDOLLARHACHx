import { Router, type IRouter } from "express";
import {
  fullScan,
  scanDirectories,
  scanDns,
  scanHeaders,
  scanPorts,
  scanSsl,
  scanSubdomains,
  type ScanOptions,
} from "../../lib/security-tools";

const router: IRouter = Router();

function cleanHost(t: string) {
  return t.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

router.post("/full", async (req, res) => {
  const target = String(req.body?.target ?? "").trim();
  if (!target) { res.status(400).json({ error: "missing target" }); return; }
  const opts = (req.body?.options ?? {}) as ScanOptions;
  try {
    const result = await fullScan(target, opts);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/dns", async (req, res) => {
  const t = cleanHost(String(req.query["target"] ?? ""));
  if (!t) { res.status(400).json({ error: "missing target" }); return; }
  res.json(await scanDns(t));
});

router.get("/ports", async (req, res) => {
  const t = cleanHost(String(req.query["target"] ?? ""));
  if (!t) { res.status(400).json({ error: "missing target" }); return; }
  const portsStr = String(req.query["ports"] ?? "").trim();
  const ports = portsStr
    ? portsStr.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0 && n < 65536)
    : undefined;
  res.json({ host: t, open: await scanPorts(t, ports) });
});

router.get("/ssl", async (req, res) => {
  const t = cleanHost(String(req.query["target"] ?? ""));
  if (!t) { res.status(400).json({ error: "missing target" }); return; }
  res.json(await scanSsl(t));
});

router.get("/headers", async (req, res) => {
  const t = cleanHost(String(req.query["target"] ?? ""));
  if (!t) { res.status(400).json({ error: "missing target" }); return; }
  res.json(await scanHeaders(t));
});

router.get("/subdomains", async (req, res) => {
  const t = cleanHost(String(req.query["target"] ?? ""));
  if (!t) { res.status(400).json({ error: "missing target" }); return; }
  res.json({ host: t, subdomains: await scanSubdomains(t) });
});

router.get("/directories", async (req, res) => {
  const t = cleanHost(String(req.query["target"] ?? ""));
  if (!t) { res.status(400).json({ error: "missing target" }); return; }
  res.json({ host: t, paths: await scanDirectories(`https://${t}`) });
});

export default router;
