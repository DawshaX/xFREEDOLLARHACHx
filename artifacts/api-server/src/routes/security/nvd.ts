import { Router, type IRouter } from "express";
import { fetchEpss, nvdSearch } from "../../lib/security-tools";

const router: IRouter = Router();

router.get("/search", async (req, res) => {
  try {
    const q = String(req.query["q"] ?? req.query["keyword"] ?? "").trim();
    const cve = String(req.query["cveId"] ?? "").trim();
    const sevRaw = String(req.query["severity"] ?? "").toUpperCase().trim();
    const severity = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(sevRaw)
      ? (sevRaw as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW")
      : undefined;
    const days = Number(req.query["days"] ?? 0) || undefined;
    const limit = Number(req.query["limit"] ?? 30);
    const startIndex = Number(req.query["startIndex"] ?? 0) || undefined;
    const opts: Parameters<typeof nvdSearch>[0] = {
      severity,
      days,
      limit,
      startIndex,
    };
    if (cve && /^CVE-\d{4}-\d+$/i.test(cve)) opts.cveId = cve;
    else if (q) opts.keyword = q;
    const data = await nvdSearch(opts);
    res.json(data);
  } catch (e) {
    req.log.warn({ err: String(e) }, "nvd search failed");
    res.status(502).json({ error: String(e) });
  }
});

// Simple in-memory cache + retry to absorb NVD's strict rate limit (5 req / 30s without API key).
const nvdCache = new Map<string, { ts: number; status: number; body: string }>();
const NVD_CACHE_TTL = 60_000;

async function nvdRawFetch(qs: string, retries = 2): Promise<{ status: number; body: string }> {
  const cached = nvdCache.get(qs);
  if (cached && Date.now() - cached.ts < NVD_CACHE_TTL && cached.status === 200) {
    return { status: cached.status, body: cached.body };
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "CyberNova/5.0 (security-research)",
  };
  const k = process.env["NVD_API_KEY"];
  if (k) headers["apiKey"] = k;
  let lastErr: { status: number; body: string } = { status: 502, body: "" };
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(
        `https://services.nvd.nist.gov/rest/json/cves/2.0?${qs}`,
        { headers, signal: AbortSignal.timeout(20000) },
      );
      const body = await r.text();
      if (r.status === 200) {
        nvdCache.set(qs, { ts: Date.now(), status: r.status, body });
        return { status: r.status, body };
      }
      lastErr = { status: r.status, body };
      // 403 / 429 / 503 → backoff & retry
      if ([403, 429, 503].includes(r.status) && i < retries) {
        await new Promise((res) => setTimeout(res, 700 * (i + 1)));
        continue;
      }
      return lastErr;
    } catch (e) {
      lastErr = { status: 502, body: JSON.stringify({ error: String(e) }) };
      if (i < retries) await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  return lastErr;
}

function normalizeNvdDate(v: string, end: boolean): string {
  // NVD requires extended ISO with milliseconds, e.g. 2026-04-27T00:00:00.000
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return end ? `${v}T23:59:59.999` : `${v}T00:00:00.000`;
  }
  // Z-suffixed ISO from JS toISOString (e.g. 2026-04-27T00:00:00.000Z) → strip Z
  if (/Z$/.test(v) && /T/.test(v)) return v.replace(/Z$/, "");
  return v;
}

router.get("/raw", async (req, res) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v !== "string") continue;
    if (k === "pubStartDate" || k === "lastModStartDate") {
      params.set(k, normalizeNvdDate(v, false));
    } else if (k === "pubEndDate" || k === "lastModEndDate") {
      params.set(k, normalizeNvdDate(v, true));
    } else {
      params.set(k, v);
    }
  }
  const qs = params.toString();
  const out = await nvdRawFetch(qs);
  if (out.status !== 200) {
    req.log.warn({ status: out.status, qs, snippet: out.body.slice(0, 200) }, "nvd raw upstream error");
  }
  res.status(out.status).type("application/json").send(out.body);
});

router.get("/feed", async (req, res) => {
  try {
    const limit = Number(req.query["limit"] ?? 30);
    const data = await nvdSearch({ limit });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

router.get("/critical", async (_req, res) => {
  try {
    const data = await nvdSearch({ severity: "CRITICAL", days: 30, limit: 50 });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

router.get("/epss", async (req, res) => {
  try {
    const cves = String(req.query["cve"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const data = await fetchEpss(cves);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

export default router;
