import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db, cves, cveSyncJobs, pool } from "@workspace/db";
import { cveMonitor } from "../lib/cve-monitor";

const router: IRouter = Router();

// ── Enhanced DB stats (source breakdown + exploit type breakdown) ─────────────
router.get("/cve/db/stats", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const { rows: [tot] }  = await client.query("SELECT COUNT(*) AS total FROM cves");
      const { rows: sevRows } = await client.query("SELECT severity, COUNT(*) AS cnt FROM cves GROUP BY severity");
      const { rows: srcRows } = await client.query("SELECT source, COUNT(*) AS cnt FROM cves GROUP BY source ORDER BY cnt DESC");
      const { rows: etRows }  = await client.query("SELECT exploit_type, COUNT(*) AS cnt FROM cves WHERE exploit_type IS NOT NULL GROUP BY exploit_type ORDER BY cnt DESC LIMIT 20");
      const { rows: [lh] }   = await client.query("SELECT COUNT(*) AS cnt FROM cves WHERE collected_at >= NOW() - INTERVAL '1 hour'");
      const { rows: [ld] }   = await client.query("SELECT COUNT(*) AS cnt FROM cves WHERE collected_at >= NOW() - INTERVAL '24 hours'");
      const { rows: latestRows } = await client.query(
        "SELECT id, severity, cvss, published_at, source, exploit_type, epss_score, poc_url FROM cves ORDER BY collected_at DESC LIMIT 20"
      );
      const { rows: topEpssRows } = await client.query(
        "SELECT id, severity, cvss, exploit_type, epss_score FROM cves WHERE epss_score IS NOT NULL ORDER BY epss_score DESC LIMIT 10"
      );

      const bySeverity: Record<string, number> = {};
      for (const r of sevRows as Array<Record<string,unknown>>) bySeverity[String(r.severity)] = Number(r.cnt);

      const bySource: Record<string, number> = {};
      for (const r of srcRows as Array<Record<string,unknown>>) bySource[String(r.source)] = Number(r.cnt);

      const byExploitType: Record<string, number> = {};
      for (const r of etRows as Array<Record<string,unknown>>) byExploitType[String(r.exploit_type)] = Number(r.cnt);

      res.json({
        total:    Number((tot as Record<string,unknown>)?.total ?? 0),
        lastHour: Number((lh  as Record<string,unknown>)?.cnt   ?? 0),
        lastDay:  Number((ld  as Record<string,unknown>)?.cnt   ?? 0),
        bySeverity,
        bySource,
        byExploitType,
        latest: (latestRows as Array<Record<string,unknown>>).map(r => ({
          id:          r.id,
          severity:    r.severity,
          cvss:        Number(r.cvss ?? 0),
          publishedAt: r.published_at,
          source:      r.source ?? "NVD",
          exploitType: r.exploit_type,
          epssScore:   r.epss_score ? Number(r.epss_score) : null,
          pocUrl:      r.poc_url,
        })),
        topEpss: (topEpssRows as Array<Record<string,unknown>>).map(r => ({
          id:          r.id,
          severity:    r.severity,
          cvss:        Number(r.cvss ?? 0),
          exploitType: r.exploit_type,
          epssScore:   Number(r.epss_score ?? 0),
        })),
      });
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── SSE stream (must be before /cve/:id to avoid param capture) ───────────────
router.get("/cve/stream", (req, res) => {
  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache, no-transform");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  cveMonitor.addClient(res);
  res.write("retry: 3000\n\n");
  const ka = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { clearInterval(ka); } }, 5000);
  req.on("close", () => { clearInterval(ka); cveMonitor.removeClient(res); });
});

// ── Local CVE search ──────────────────────────────────────────────────────────
router.get("/cve/db/search", async (req, res) => {
  const q        = String(req.query.q        || "").trim();
  const severity = String(req.query.severity || "").toUpperCase();
  const source   = String(req.query.source   || "").trim();
  const exploitType = String(req.query.exploitType || "").trim();
  const minCvss  = Number(req.query.minCvss  || 0);
  const limit    = Math.min(Number(req.query.limit  || 50), 500);
  const offset   = Math.max(Number(req.query.offset || 0), 0);

  const conditions = [];
  if (q)           conditions.push(or(ilike(cves.description, `%${q}%`), ilike(cves.id, `%${q}%`)));
  if (severity && severity !== "ALL") conditions.push(eq(cves.severity, severity));
  if (source   && source   !== "ALL") conditions.push(eq(cves.source, source));
  if (exploitType && exploitType !== "ALL") conditions.push(eq(cves.exploitType, exploitType));
  if (minCvss > 0) conditions.push(gte(cves.cvss, minCvss));

  const where = conditions.length ? and(...conditions) : undefined;
  const rows  = await db.select().from(cves).where(where).orderBy(desc(cves.collectedAt)).limit(limit).offset(offset);
  const [tot] = await db.select({ c: count() }).from(cves).where(where);
  res.json({ total: Number(tot?.c || 0), items: rows });
});

// ── Recent CVEs (local DB first, NVD live as secondary attempt) ───────────────
router.get("/cve/recent", async (req, res) => {
  const severity = String(req.query.severity || "CRITICAL").toUpperCase();
  const limit    = Math.min(Number(req.query.limit || 20), 100);

  // Always serve from local DB — fast and reliable
  const rows = await db.select().from(cves)
    .where(eq(cves.severity, severity as "CRITICAL"))
    .orderBy(desc(cves.collectedAt))
    .limit(limit);

  const items = rows.map(r => ({
    id: r.id,
    description: r.description ?? "",
    cvss: r.cvss ?? 0,
    severity: r.severity,
    publishedAt: r.publishedAt?.toISOString() ?? r.collectedAt?.toISOString() ?? "",
    url: `https://nvd.nist.gov/vuln/detail/${r.id}`,
  }));

  res.json(items);
});

// ── Search live NVD ───────────────────────────────────────────────────────────
router.get("/cve/search", async (req, res) => {
  try {
    const q     = String(req.query.q || "");
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const url   = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(q)}&resultsPerPage=${limit}`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`NVD ${r.status}`);
    const data = await r.json() as { vulnerabilities?: Array<{ cve: { id: string; descriptions: Array<{ lang: string; value: string }>; published: string; metrics?: { cvssMetricV31?: Array<{ cvssData: { baseScore: number } }> } } }> };
    const items = (data.vulnerabilities ?? []).map(v => {
      const desc = v.cve.descriptions.find(d => d.lang === "en")?.value ?? "";
      const cvss = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ?? 0;
      const sev  = cvss >= 9 ? "CRITICAL" : cvss >= 7 ? "HIGH" : cvss >= 4 ? "MEDIUM" : "LOW";
      return { id: v.cve.id, description: desc, cvss, severity: sev, publishedAt: v.cve.published, url: `https://nvd.nist.gov/vuln/detail/${v.cve.id}` };
    });
    res.json(items);
  } catch (err) { res.status(502).json({ error: String(err) }); }
});

// ── CVE detail (must be AFTER all specific /cve/* routes) ────────────────────
router.get("/cve/:id", async (req, res) => {
  const [row] = await db.select().from(cves).where(eq(cves.id, req.params.id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── CVE sync job status ───────────────────────────────────────────────────────
router.get("/cve/sync/status", async (_req, res) => {
  const [job] = await db.select().from(cveSyncJobs).orderBy(desc(cveSyncJobs.startedAt)).limit(1);
  res.json(job || null);
});

// ── Sync trigger (NVD bulk) ───────────────────────────────────────────────────
let activeSync: Promise<void> | null = null;

async function runSync(maxItems: number) {
  const [job] = await db.insert(cveSyncJobs).values({ status: "running" }).returning();
  const NVD_KEY = process.env.NVD_API_KEY || "";
  try {
    const pageSize = 2000;
    let startIndex = 0, total = Infinity, pages = 0, fetched = 0;
    while (startIndex < Math.min(total, maxItems)) {
      const params = new URLSearchParams({ resultsPerPage: String(pageSize), startIndex: String(startIndex) });
      const headers: Record<string,string> = { Accept: "application/json" };
      if (NVD_KEY) headers["apiKey"] = NVD_KEY;
      const r = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?${params}`, { headers, signal: AbortSignal.timeout(30000) });
      if (!r.ok) { if (pages === 0) throw new Error(`NVD ${r.status}`); break; }
      const data = await r.json() as { totalResults?: number; vulnerabilities?: Array<{ cve: { id: string; descriptions: Array<{ lang: string; value: string }>; metrics?: { cvssMetricV31?: Array<{ cvssData: { baseScore: number } }>; cvssMetricV2?: Array<{ cvssData: { baseScore: number } }> }; published: string; lastModified: string } }> };
      total = data.totalResults ?? total;
      const items = (data.vulnerabilities ?? []).map(v => {
        const desc = v.cve.descriptions.find(d => d.lang === "en")?.value ?? "";
        const cvss = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ?? v.cve.metrics?.cvssMetricV2?.[0]?.cvssData.baseScore ?? 0;
        const sev  = cvss >= 9 ? "CRITICAL" : cvss >= 7 ? "HIGH" : cvss >= 4 ? "MEDIUM" : "LOW";
        return { id: v.cve.id, description: desc, cvss, severity: sev, publishedAt: new Date(v.cve.published), lastModifiedAt: new Date(v.cve.lastModified), url: `https://nvd.nist.gov/vuln/detail/${v.cve.id}`, source: "NVD" };
      });
      if (items.length === 0) break;
      const CHUNK = 200;
      for (let i = 0; i < items.length; i += CHUNK) {
        await db.insert(cves).values(items.slice(i, i + CHUNK)).onConflictDoNothing();
      }
      fetched += items.length; pages += 1; startIndex += pageSize;
      await db.update(cveSyncJobs).set({ totalFetched: fetched, totalAvailable: total === Infinity ? 0 : total, pagesDone: pages }).where(eq(cveSyncJobs.id, job.id));
      await new Promise(r => setTimeout(r, NVD_KEY ? 700 : 6500));
    }
    await db.update(cveSyncJobs).set({ status: "completed", finishedAt: new Date() }).where(eq(cveSyncJobs.id, job.id));
  } catch (err) {
    await db.update(cveSyncJobs).set({ status: "failed", lastError: err instanceof Error ? err.message : String(err), finishedAt: new Date() }).where(eq(cveSyncJobs.id, job.id));
  } finally { activeSync = null; }
}

router.post("/cve/sync", async (req, res) => {
  const maxItems = Math.min(Math.max(Number(req.body?.maxItems) || 10000, 100), 250000);
  if (activeSync) { res.status(409).json({ error: "Sync already running" }); return; }
  activeSync = runSync(maxItems);
  res.status(202).json({ started: true, maxItems });
});

// ── Daily breakdown (last 30 days) ───────────────────────────────────────────
router.get("/cve/db/daily", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT
          TO_CHAR(DATE(COALESCE(published_at, collected_at)), 'YYYY-MM-DD') AS day,
          severity,
          COUNT(*)::int AS cnt
        FROM cves
        WHERE COALESCE(published_at, collected_at) >= NOW() - INTERVAL '30 days'
        GROUP BY day, severity
        ORDER BY day DESC
      `);
      const { rows: totRows } = await client.query(`
        SELECT
          TO_CHAR(DATE(COALESCE(published_at, collected_at)), 'YYYY-MM-DD') AS day,
          COUNT(*)::int AS total
        FROM cves
        WHERE COALESCE(published_at, collected_at) >= NOW() - INTERVAL '30 days'
        GROUP BY day
        ORDER BY day DESC
      `);
      const byDay: Record<string, Record<string, number> & { total?: number }> = {};
      for (const r of rows as Array<{ day: string; severity: string; cnt: number }>) {
        if (!byDay[r.day]) byDay[r.day] = {};
        byDay[r.day][r.severity] = r.cnt;
      }
      for (const r of totRows as Array<{ day: string; total: number }>) {
        if (byDay[r.day]) byDay[r.day].total = r.total;
        else byDay[r.day] = { total: r.total };
      }
      const days = Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => b.day.localeCompare(a.day));
      res.json({ days });
    } finally { client.release(); }
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── Manual hunt trigger ───────────────────────────────────────────────────────
router.post("/cve/hunt/trigger", async (_req, res) => {
  const result = await cveMonitor.hunt();
  res.json(result);
});

// ── Legacy hunt endpoint (kept for compat) ────────────────────────────────────
router.get("/cve/hunt", async (_req, res) => {
  try {
    const result = await cveMonitor.hunt();
    const [stats] = await db.select({ c: sql<number>`count(*)` }).from(cves);
    res.json({ ...result, totalInDb: Number(stats?.c ?? 0), huntedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── Payload templates for a CVE or exploit type ───────────────────────────────
router.get("/cve/payloads/:exploitType", async (req, res) => {
  const { getPayloads } = await import("../lib/cve-classifier");
  const type = decodeURIComponent(req.params.exploitType) as Parameters<typeof getPayloads>[0];
  res.json({ exploitType: type, payloads: getPayloads(type) });
});

export default router;
