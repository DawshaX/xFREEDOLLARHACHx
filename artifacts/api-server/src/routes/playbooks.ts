import { Router, type IRouter } from "express";
import { db, playbooks, playbookSteps, playbookRuns } from "@workspace/db";
import { asc, desc, eq } from "drizzle-orm";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /playbooks  — list all playbooks
// ---------------------------------------------------------------------------
router.get("/playbooks", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(playbooks)
      .orderBy(desc(playbooks.updatedAt));
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /playbooks/:id  — playbook with steps
// ---------------------------------------------------------------------------
router.get("/playbooks/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [pb] = await db.select().from(playbooks).where(eq(playbooks.id, id));
    if (!pb) return res.status(404).json({ error: "not found" });
    const steps = await db
      .select()
      .from(playbookSteps)
      .where(eq(playbookSteps.playbookId, id))
      .orderBy(asc(playbookSteps.stepOrder));
    return res.json({ ...pb, steps });
  } catch (e) {
    return next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /playbooks  — create a playbook
// ---------------------------------------------------------------------------
router.post("/playbooks", async (req, res, next) => {
  try {
    const { title, description, category, tags, steps } = req.body as {
      title: string;
      description?: string;
      category?: string;
      tags?: string;
      steps?: Array<{
        title: string;
        toolName: string;
        toolInput?: string;
        expectedOutput?: string;
        continueOnError?: boolean;
      }>;
    };
    if (!title) return res.status(400).json({ error: "title required" });

    const [pb] = await db
      .insert(playbooks)
      .values({
        title,
        description: description ?? "",
        category: category ?? "general",
        tags: tags ?? "",
      })
      .returning();

    if (steps && steps.length > 0) {
      await db.insert(playbookSteps).values(
        steps.map((s, i) => ({
          playbookId: pb!.id,
          stepOrder: i,
          title: s.title,
          toolName: s.toolName,
          toolInput: s.toolInput ?? "{}",
          expectedOutput: s.expectedOutput ?? "",
          continueOnError: s.continueOnError ?? false,
        })),
      );
    }
    return res.json(pb);
  } catch (e) {
    return next(e);
  }
});

// ---------------------------------------------------------------------------
// DELETE /playbooks/:id
// ---------------------------------------------------------------------------
router.delete("/playbooks/:id", async (req, res, next) => {
  try {
    await db.delete(playbooks).where(eq(playbooks.id, Number(req.params.id)));
    return res.status(204).end();
  } catch (e) {
    return next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /playbooks/:id/runs  — execution history
// ---------------------------------------------------------------------------
router.get("/playbooks/:id/runs", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rows = await db
      .select()
      .from(playbookRuns)
      .where(eq(playbookRuns.playbookId, id))
      .orderBy(desc(playbookRuns.startedAt));
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Seed default playbooks (called from app.ts at boot)
// ---------------------------------------------------------------------------
const DEFAULT_PLAYBOOKS = [
  {
    title: "فحص نطاق كامل",
    description: "Reconnaissance شامل لنطاق هدف: DNS، Subdomains، Ports، SSL، Headers.",
    category: "recon",
    tags: "recon,scan,dns,ports",
    steps: [
      { title: "DNS lookup", toolName: "scan_dns", toolInput: '{"target":"{{target}}"}' },
      { title: "Subdomain enumeration", toolName: "scan_subdomains", toolInput: '{"target":"{{target}}"}' },
      { title: "Port scan", toolName: "scan_ports", toolInput: '{"target":"{{target}}"}' },
      { title: "SSL inspection", toolName: "scan_ssl", toolInput: '{"target":"{{target}}"}' },
      { title: "Security headers", toolName: "scan_headers", toolInput: '{"target":"https://{{target}}"}' },
    ],
  },
  {
    title: "مراقبة CVE يومية",
    description: "تحديث قاعدة CVE من NVD وتحقّق من CISA KEV.",
    category: "defense",
    tags: "cve,monitoring,daily",
    steps: [
      { title: "Fetch latest CVEs", toolName: "nvd_search", toolInput: '{"keyword":"critical","limit":20}' },
      { title: "Sync CISA KEV", toolName: "cisa_kev", toolInput: "{}" },
    ],
  },
  {
    title: "بحث استغلال CVE",
    description: "ابحث عن استغلالات معروفة لـ CVE معينة في GitHub و Exploit-DB.",
    category: "exploit",
    tags: "cve,exploit,research",
    steps: [
      { title: "Search GitHub for PoC", toolName: "github_search", toolInput: '{"query":"{{cve}} exploit"}' },
      { title: "Search Exploit-DB", toolName: "exploit_db_search", toolInput: '{"query":"{{cve}}"}' },
      { title: "Get EPSS score", toolName: "epss_score", toolInput: '{"cve":"{{cve}}"}' },
    ],
  },
];

export async function ensureDefaultPlaybooks(): Promise<void> {
  const existing = await db.select().from(playbooks).limit(1);
  if (existing.length > 0) return;
  for (const def of DEFAULT_PLAYBOOKS) {
    const [pb] = await db
      .insert(playbooks)
      .values({
        title: def.title,
        description: def.description,
        category: def.category,
        tags: def.tags,
        isAutoGenerated: false,
      })
      .returning();
    await db.insert(playbookSteps).values(
      def.steps.map((s, i) => ({
        playbookId: pb!.id,
        stepOrder: i,
        title: s.title,
        toolName: s.toolName,
        toolInput: s.toolInput,
      })),
    );
  }
}

export default router;
