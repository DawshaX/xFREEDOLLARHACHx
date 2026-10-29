import { Router } from "express";

const router = Router();

interface MemoryEntry {
  id: number;
  memoryType: string;
  key: string;
  content: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

let nextId = 1;
const memories = new Map<number, MemoryEntry>();

router.get("/memory", (req, res) => {
  const { limit = "50", type, search } = req.query as { limit?: string; type?: string; search?: string };
  let items = [...memories.values()].sort((a, b) => b.id - a.id);
  if (type) items = items.filter((m) => m.memoryType === type);
  if (search) {
    const s = search.toLowerCase();
    items = items.filter((m) => m.key.toLowerCase().includes(s) || m.content.toLowerCase().includes(s));
  }
  res.json(items.slice(0, Number(limit)));
});

router.post("/memory", (req, res) => {
  const { memoryType = "fact", key, content, tags = "" } = req.body as {
    memoryType?: string; key: string; content: string; tags?: string;
  };
  if (!key || !content) { res.status(400).json({ error: "key and content required" }); return; }

  const existing = [...memories.values()].find((m) => m.key === key && m.memoryType === memoryType);
  if (existing) {
    existing.content = content;
    existing.tags = tags;
    existing.updatedAt = new Date().toISOString();
    res.json(existing);
    return;
  }

  const entry: MemoryEntry = {
    id: nextId++,
    memoryType,
    key,
    content,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memories.set(entry.id, entry);
  res.json(entry);
});

router.put("/memory/:id", (req, res) => {
  const id = Number(req.params.id);
  const entry = memories.get(id);
  if (!entry) { res.status(404).json({ error: "not found" }); return; }
  const { content, tags, key } = req.body as { content?: string; tags?: string; key?: string };
  if (content !== undefined) entry.content = content;
  if (tags !== undefined) entry.tags = tags;
  if (key !== undefined) entry.key = key;
  entry.updatedAt = new Date().toISOString();
  res.json(entry);
});

router.delete("/memory/:id", (req, res) => {
  const id = Number(req.params.id);
  memories.delete(id);
  res.json({ ok: true, id });
});

router.get("/memory/stats", (_req, res) => {
  const items = [...memories.values()];
  const byType: Record<string, number> = {};
  for (const m of items) {
    byType[m.memoryType] = (byType[m.memoryType] || 0) + 1;
  }
  res.json({ total: items.length, byType });
});

export function saveMemory(memoryType: string, key: string, content: string, tags = ""): MemoryEntry {
  const existing = [...memories.values()].find((m) => m.key === key && m.memoryType === memoryType);
  if (existing) {
    existing.content = content;
    existing.tags = tags;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }
  const entry: MemoryEntry = {
    id: nextId++,
    memoryType,
    key,
    content,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memories.set(entry.id, entry);
  return entry;
}

export function searchMemory(query: string, limit = 10): MemoryEntry[] {
  const q = query.toLowerCase();
  return [...memories.values()]
    .filter((m) => m.key.toLowerCase().includes(q) || m.content.toLowerCase().includes(q) || m.tags.toLowerCase().includes(q))
    .slice(0, limit);
}

export function getMemoryCount(): number {
  return memories.size;
}

export function getAllMemory(): MemoryEntry[] {
  return [...memories.values()].sort((a, b) => b.id - a.id);
}

export default router;
