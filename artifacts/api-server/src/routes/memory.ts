/**
 * Persistent Memory & Notes Store — in-memory + WebSocket/SSE broadcast
 * Supports both:
 *  - UI Memory/Notes schema: { id, kind, title, content, pinned, createdAt }
 *  - Agent Memory schema:    { id, memoryType, key, content, tags, importance, ts, createdAt }
 */
import { Router } from "express";
import { broadcastLiveEvent } from "./live-events";
import { broadcastEvent } from "../lib/ws-hub";

const router = Router();

export interface UnifiedMemoryEntry {
  id: string;
  kind: string;
  memoryType: string;
  title: string;
  key: string;
  content: string;
  tags: string;
  pinned: boolean;
  importance: number;
  usedCount: number;
  ts: number;
  createdAt: string;
  updatedAt: string;
}

const memoryStore: UnifiedMemoryEntry[] = [
  {
    id: "mem-1",
    kind: "project",
    memoryType: "project",
    title: "منهجية صيد الثغرات القانوني (HackerOne & Google VRP)",
    key: "methodology:bug-bounty-rules",
    content:
      "الالتزام الكامل بنطاق البرنامج (In-Scope)، استخدام حسابات اختبار شخصية فقط لإثبات IDOR/BOLA، عدم استخدام أتمتة عنيفة، وتوثيق كل خطوة مع كود الترقيع المقترح (Remediation Diff).",
    tags: "bug-bounty,hackerone,google-vrp,rules",
    pinned: true,
    importance: 10,
    usedCount: 5,
    ts: Date.now() - 3600_000,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: "mem-2",
    kind: "fact",
    memoryType: "intel",
    title: "قائمة فحص الثغرات عالية المكافأة (High-Bounty Checklist)",
    key: "checklist:high-bounty-vulns",
    content:
      "1. IDOR / BOLA في نقاط نهاية API (تغيير معرفات الموارد بين حسابين).\n2. SSRF في جلب الروابط أو Webhooks أو تحويل PDF.\n3. Race Conditions (TOCTOU) في الكوبونات والرصيد.\n4. Prototype Pollution / Mass Assignment في JSON body.",
    tags: "idor,ssrf,race-condition,owasp",
    pinned: true,
    importance: 9,
    usedCount: 4,
    ts: Date.now() - 1800_000,
    createdAt: new Date(Date.now() - 1800_000).toISOString(),
    updatedAt: new Date(Date.now() - 1800_000).toISOString(),
  },
  {
    id: "mem-3",
    kind: "preference",
    memoryType: "preference",
    title: "إعدادات التزامن الحي (WebSocket + Agents + Notes)",
    key: "system:ws-sync-active",
    content:
      "جميع الوكلاء (NovaAgent, LiveAgent, KaliGPT) والملاحظات ومتتبع المهام متصلة عبر ناقل WebSocket الداخلي لتسجيل كل فحص أو ملاحظة تلقائياً.",
    tags: "websocket,agents,sync",
    pinned: false,
    importance: 8,
    usedCount: 2,
    ts: Date.now() - 600_000,
    createdAt: new Date(Date.now() - 600_000).toISOString(),
    updatedAt: new Date(Date.now() - 600_000).toISOString(),
  },
];

let nextId = 4;

function normalizeKind(raw?: string): string {
  if (!raw) return "fact";
  if (["fact", "project", "preference", "contact"].includes(raw)) return raw;
  if (raw === "intel" || raw === "cve" || raw === "success_pattern") return "fact";
  if (raw === "target" || raw === "mission" || raw === "scan") return "project";
  return "fact";
}

export interface SaveMemoryOptions {
  kind?: string;
  memoryType?: string;
  title?: string;
  key?: string;
  content: string;
  tags?: string | string[];
  importance?: number;
  pinned?: boolean;
}

export function saveMemory(
  memoryTypeOrOpts: string | SaveMemoryOptions,
  keyArg?: string,
  contentArg?: string,
  tagsArg: string | string[] = "",
  importanceArg = 5,
  pinnedArg = false,
): UnifiedMemoryEntry {
  const memoryType =
    typeof memoryTypeOrOpts === "string"
      ? memoryTypeOrOpts
      : memoryTypeOrOpts.memoryType || memoryTypeOrOpts.kind || "project";
  const key =
    typeof memoryTypeOrOpts === "string"
      ? keyArg || "ملاحظة أمنية"
      : memoryTypeOrOpts.title || memoryTypeOrOpts.key || "ملاحظة أمنية";
  const content =
    typeof memoryTypeOrOpts === "string"
      ? contentArg || ""
      : memoryTypeOrOpts.content || "";
  const rawTags =
    typeof memoryTypeOrOpts === "string"
      ? tagsArg
      : memoryTypeOrOpts.tags || "";
  const tags = Array.isArray(rawTags) ? rawTags.join(",") : String(rawTags);
  const importance =
    typeof memoryTypeOrOpts === "string"
      ? importanceArg
      : Number(memoryTypeOrOpts.importance ?? 7);
  const pinned =
    typeof memoryTypeOrOpts === "string"
      ? pinnedArg
      : Boolean(memoryTypeOrOpts.pinned);

  const kind = normalizeKind(memoryType);
  const existing = memoryStore.find((m) => m.key === key || m.title === key);
  const nowIso = new Date().toISOString();
  if (existing) {
    existing.content = content;
    existing.tags = tags || existing.tags;
    existing.importance = Math.min(10, Math.max(existing.importance, importance));
    existing.usedCount += 1;
    existing.ts = Date.now();
    existing.updatedAt = nowIso;
    broadcastLiveEvent({
      type: "memory_saved",
      data: {
        id: existing.id,
        memoryType: existing.memoryType,
        kind: existing.kind,
        key: existing.key,
        title: existing.title,
        content: content.slice(0, 200),
        updated: true,
        ts: existing.ts,
      },
      ts: nowIso,
    });
    broadcastEvent({
      type: "memory_saved",
      memory: existing,
      ts: existing.ts,
    });
    return existing;
  }

  const entry: UnifiedMemoryEntry = {
    id: `mem-${nextId++}`,
    kind,
    memoryType: memoryType || kind,
    title: key,
    key,
    content,
    tags: tags || kind,
    pinned,
    importance,
    usedCount: 1,
    ts: Date.now(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  memoryStore.unshift(entry);
  broadcastLiveEvent({
    type: "memory_saved",
    data: {
      id: entry.id,
      memoryType: entry.memoryType,
      kind: entry.kind,
      key: entry.key,
      title: entry.title,
      content: content.slice(0, 200),
      updated: false,
      ts: entry.ts,
    },
    ts: nowIso,
  });
  broadcastEvent({
    type: "memory_saved",
    memory: entry,
    ts: entry.ts,
  });
  return entry;
}

export function searchMemory(query: string, type?: string): UnifiedMemoryEntry[] {
  const q = query.toLowerCase();
  return memoryStore
    .filter((m) => {
      const typeMatch = !type || m.memoryType === type || m.kind === type;
      const textMatch =
        !q ||
        m.key.toLowerCase().includes(q) ||
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.toLowerCase().includes(q);
      return typeMatch && textMatch;
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importance - a.importance || b.ts - a.ts)
    .slice(0, 50);
}

export function getAllMemories(): UnifiedMemoryEntry[] {
  return [...memoryStore].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.ts - a.ts,
  );
}

export const getAllMemory = getAllMemories;

export function getMemoryCount(): number {
  return memoryStore.length;
}

router.get("/memory", (req, res) => {
  const { q = "", search = "", type } = req.query as { q?: string; search?: string; type?: string };
  const queryText = search || q;
  const results = queryText || type ? searchMemory(queryText, type) : getAllMemories();
  res.json(results);
});

router.post("/memory", (req, res) => {
  const body = (req.body ?? {}) as {
    kind?: string;
    title?: string;
    memoryType?: string;
    key?: string;
    content?: string;
    tags?: string;
    importance?: number;
    pinned?: boolean;
  };
  const titleOrKey = (body.title || body.key || "ملاحظة أمنية").trim();
  const content = (body.content || "").trim();
  if (!content) {
    res.status(400).json({ error: "content required" });
    return;
  }
  const typeOrKind = body.kind || body.memoryType || "fact";
  const entry = saveMemory(
    typeOrKind,
    titleOrKey,
    content,
    body.tags ?? typeOrKind,
    body.importance ?? 6,
    Boolean(body.pinned),
  );
  res.status(201).json(entry);
});

router.patch("/memory/:id/pin", (req, res) => {
  const id = String(req.params.id);
  const item = memoryStore.find((m) => String(m.id) === id);
  if (!item) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }
  const body = (req.body ?? {}) as { pinned?: boolean };
  item.pinned = body.pinned !== undefined ? Boolean(body.pinned) : !item.pinned;
  item.updatedAt = new Date().toISOString();
  broadcastEvent({ type: "memory_pinned", id: item.id, pinned: item.pinned, ts: Date.now() });
  res.json({ id: item.id, pinned: item.pinned });
});

router.delete("/memory/:id", (req, res) => {
  const id = String(req.params.id);
  const idx = memoryStore.findIndex((m) => String(m.id) === id);
  if (idx >= 0) memoryStore.splice(idx, 1);
  broadcastEvent({ type: "memory_deleted", id, ts: Date.now() });
  res.json({ ok: true, id });
});

router.delete("/memory", (_req, res) => {
  memoryStore.length = 0;
  res.json({ ok: true });
});

router.get("/memory/stats", (_req, res) => {
  const byType: Record<string, number> = {};
  for (const m of memoryStore) {
    byType[m.kind] = (byType[m.kind] || 0) + 1;
  }
  res.json({ total: memoryStore.length, byType });
});

export default router;
