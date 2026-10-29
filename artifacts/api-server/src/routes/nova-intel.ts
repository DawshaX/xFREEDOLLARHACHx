/**
 * Nova Intelligence Routes — Memory, Knowledge, Learner API
 */
import { Router } from "express";
import {
  saveMemoryLite, searchMemoryLite, getMemoryLite, getMemoryStats,
  addKnowledge, searchKnowledge, getKnowledge, learnFromCves,
} from "../lib/nova-learner-lite";

const router = Router();

// ── Memory ────────────────────────────────────────────────────────────────────

// GET /api/nova-intel/memory
router.get("/nova-intel/memory", (req, res) => {
  const type  = req.query.type  as string | undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
  res.json({ memory: getMemoryLite(type, limit), stats: getMemoryStats() });
});

// POST /api/nova-intel/memory
router.post("/nova-intel/memory", (req, res) => {
  const { type = "general", key, content, context = "", tags = [], confidence = 0.8 } = req.body as {
    type?: string; key?: string; content: string; context?: string; tags?: string[]; confidence?: number;
  };
  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }
  const id = saveMemoryLite({ type, key: key ?? `mem_${Date.now()}`, content, context, tags, confidence });
  res.json({ ok: true, id });
});

// GET /api/nova-intel/memory/search
router.get("/nova-intel/memory/search", (req, res) => {
  const q = String(req.query.q ?? "");
  if (!q) { res.json({ results: [] }); return; }
  res.json({ results: searchMemoryLite(q, parseInt(String(req.query.limit ?? "10"))) });
});

// GET /api/nova-intel/memory/stats
router.get("/nova-intel/memory/stats", (_req, res) => {
  res.json(getMemoryStats());
});

// ── Knowledge ─────────────────────────────────────────────────────────────────

// GET /api/nova-intel/knowledge
router.get("/nova-intel/knowledge", (req, res) => {
  const category = req.query.category as string | undefined;
  const limit    = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
  res.json({ knowledge: getKnowledge(category, limit) });
});

// POST /api/nova-intel/knowledge
router.post("/nova-intel/knowledge", (req, res) => {
  const { title, category = "general", content, tags = [] } = req.body as {
    title: string; category?: string; content: string; tags?: string[];
  };
  if (!title || !content) { res.status(400).json({ error: "title and content required" }); return; }
  const id = addKnowledge({ title, category, content, tags });
  res.json({ ok: true, id });
});

// GET /api/nova-intel/knowledge/search
router.get("/nova-intel/knowledge/search", (req, res) => {
  const q        = String(req.query.q ?? "");
  const category = req.query.category as string | undefined;
  if (!q) { res.json({ results: [] }); return; }
  res.json({ results: searchKnowledge(q, category, parseInt(String(req.query.limit ?? "20"))) });
});

// ── Learning ──────────────────────────────────────────────────────────────────

// POST /api/nova-intel/learn/cves — trigger CVE learning cycle
router.post("/nova-intel/learn/cves", async (req, res) => {
  const cves = req.body.cves as Array<{ id: string; description: string; cvss?: number; severity?: string }> | undefined;
  if (!cves?.length) { res.status(400).json({ error: "cves array required" }); return; }
  const result = await learnFromCves(cves);
  res.json({ ok: true, ...result });
});

export default router;
