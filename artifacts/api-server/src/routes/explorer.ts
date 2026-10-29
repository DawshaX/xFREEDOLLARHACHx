/**
 * Nova Explorer API Routes
 * SSE-based live progress + manual triggers + stats
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, knowledgeTable } from "@workspace/db";
import { sql, like, or } from "drizzle-orm";
import { runExplorer, type ExplorerTask } from "../lib/nova-explorer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Track running tasks to prevent duplicates
const runningTasks = new Set<string>();
let lastRunResults: { task: string; collected: number; skipped: number; at: string }[] = [];

// ── Status & Stats ─────────────────────────────────────────────────────────────

router.get("/explorer/status", async (_req: Request, res: Response) => {
  try {
    // Count by category prefix
    const rows = await db.execute(
      sql`SELECT 
        category,
        COUNT(*)::int as count
      FROM ${knowledgeTable}
      WHERE category LIKE 'payloads/%' 
         OR category LIKE 'wordlists/%'
         OR category LIKE 'repos/%'
         OR category LIKE 'cheatsheets/%'
         OR category LIKE 'techniques/%'
         OR category LIKE 'frameworks/%'
         OR category LIKE 'advisories/%'
         OR category LIKE 'stats/%'
      GROUP BY category
      ORDER BY count DESC
      LIMIT 50`
    );

    const totalAutoExplorer = await db.execute(
      sql`SELECT COUNT(*)::int as count FROM ${knowledgeTable} 
          WHERE ${knowledgeTable.tags}::text LIKE '%auto-explorer%'`
    );

    const total = await db.execute(
      sql`SELECT COUNT(*)::int as count FROM ${knowledgeTable}`
    );

    const byCategory: Record<string, number> = {};
    for (const row of rows.rows as Array<{ category: string; count: number }>) {
      byCategory[row.category] = row.count;
    }

    res.json({
      running: [...runningTasks],
      lastRunResults,
      stats: {
        total: (total.rows[0] as { count: number })?.count ?? 0,
        autoExplored: (totalAutoExplorer.rows[0] as { count: number })?.count ?? 0,
        byCategory,
      },
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── List All Sources (what would be crawled) ───────────────────────────────────

router.get("/explorer/sources", (_req: Request, res: Response) => {
  res.json({
    sources: [
      {
        id: "payloads",
        name: "Raw Payloads (PAT + SecLists)",
        description: "SQL Injection, XSS, SSRF, Command Injection, Path Traversal payloads من PayloadsAllTheThings و SecLists",
        itemCount: 11,
        interval: "daily",
        tags: ["payloads", "sqli", "xss", "ssrf", "cmdi"],
      },
      {
        id: "github-repos",
        name: "GitHub Security Repos Index",
        description: "أهم 16 مستودع أمني: Nuclei, BloodHound, Metasploit, Mimikatz, CrackMapExec, Impacket...",
        itemCount: 16,
        interval: "weekly",
        tags: ["github", "repos", "tools"],
      },
      {
        id: "cheatsheets",
        name: "OWASP Cheat Sheets",
        description: "أوراق مرجعية OWASP كاملة: SQL Injection, XSS, Auth, SSRF, JWT, Docker, Crypto...",
        itemCount: 8,
        interval: "weekly",
        tags: ["owasp", "cheatsheets", "prevention"],
      },
      {
        id: "techniques",
        name: "Attack Techniques (PAT Markdown)",
        description: "تقنيات هجومية كاملة: Linux/Windows PrivEsc, Active Directory, Cloud AWS, SSTI, XXE, GraphQL...",
        itemCount: 12,
        interval: "daily",
        tags: ["techniques", "privesc", "ad", "cloud"],
      },
      {
        id: "github-topics",
        name: "GitHub Topic Discovery",
        description: "اكتشاف مستودعات GitHub عبر مواضيع: penetration-testing, red-team, bug-bounty, osint...",
        itemCount: 8,
        interval: "weekly",
        tags: ["github", "discovery", "pentesting"],
      },
      {
        id: "exploit-db",
        name: "Exploit-DB Advisories",
        description: "أحدث الـ exploits من exploit-db.com مع التصنيفات والمنصات",
        itemCount: 20,
        interval: "6h",
        tags: ["exploit-db", "exploits", "advisories"],
      },
      {
        id: "mitre",
        name: "MITRE ATT&CK Framework",
        description: "كامل إطار MITRE ATT&CK Enterprise — التكتيكات والتقنيات مصنّفة",
        itemCount: 200,
        interval: "weekly",
        tags: ["mitre", "framework", "tactics"],
      },
      {
        id: "cve-stats",
        name: "NVD CVE Statistics",
        description: "إحصاءات CVE السنوية من NIST NVD مع أمثلة على أخطر الثغرات",
        itemCount: 2,
        interval: "daily",
        tags: ["nvd", "statistics", "cve"],
      },
    ],
  });
});

// ── SSE Live Run ───────────────────────────────────────────────────────────────

router.get("/explorer/run", (req: Request, res: Response) => {
  const task = (req.query["task"] as ExplorerTask) ?? "all";
  const taskKey = `explorer-${task}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (runningTasks.has(taskKey)) {
    send({ type: "error", message: "Task already running" });
    res.end();
    return;
  }

  runningTasks.add(taskKey);
  send({ type: "log", message: `[NOVA EXPLORER] Starting task: ${task}` });

  const startTime = Date.now();

  void runExplorer(task, (msg) => {
    if (!res.writableEnded) {
      send({ type: "log", message: msg });
    }
  }).then((results) => {
    const totalCollected = results.reduce((s, r) => s + r.collected, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);

    // Update last run results
    for (const r of results) {
      lastRunResults.unshift({ task: r.source, collected: r.collected, skipped: r.skipped, at: new Date().toISOString() });
    }
    lastRunResults = lastRunResults.slice(0, 50);

    send({
      type: "done",
      results,
      summary: { totalCollected, totalSkipped, duration: Date.now() - startTime },
    });

    logger.info({ task, totalCollected, totalSkipped }, "Nova Explorer: SSE run complete");
    res.end();
  }).catch((err) => {
    send({ type: "error", message: String(err) });
    res.end();
    logger.error({ err }, "Nova Explorer: SSE run failed");
  }).finally(() => {
    runningTasks.delete(taskKey);
  });

  req.on("close", () => {
    runningTasks.delete(taskKey);
    logger.info({ task }, "Nova Explorer: SSE client disconnected");
  });
});

// ── Search Knowledge (with category filter) ────────────────────────────────────

router.get("/explorer/knowledge", async (req: Request, res: Response) => {
  try {
    const { category, q, limit = "50" } = req.query as Record<string, string>;

    let query = db.select().from(knowledgeTable).$dynamic();

    if (category && category !== "all") {
      query = query.where(like(knowledgeTable.category, `${category}%`));
    } else if (q) {
      query = query.where(
        or(
          like(knowledgeTable.title, `%${q}%`),
          like(knowledgeTable.content, `%${q}%`),
        )!
      );
    }

    const rows = await query.limit(Math.min(Number(limit), 200));
    res.json(rows.map(r => ({
      id: r.id, title: r.title, category: r.category,
      content: r.content.slice(0, 500), tags: r.tags,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
