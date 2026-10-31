/**
 * NOVA — Long-Term Memory Store
 * ─────────────────────────────
 * Durable, on-disk memory that survives restarts, redeploys and months of idle
 * time. This is what makes NOVA keep *knowing* instead of resetting every chat.
 *
 * Design notes
 *  • Single JSON file (`state/nova-memory.json`) written atomically (tmp+rename)
 *    with debounced batching, so a crash never leaves a half-written file.
 *  • Five memory kinds, each with its own retention policy:
 *      fact      — durable truths about targets/programs/people (kept forever)
 *      preference— how the user likes to be talked to / what they always want
 *      lesson    — what worked, what failed and why (kept, decays in ranking)
 *      event     — a run/tool execution record (kept, pruned by count)
 *      session   — a rolling summary of a conversation (kept, pruned by count)
 *  • Retrieval is a transparent scoring function (token overlap + importance +
 *    recency + pin + scope match). No embeddings, no API keys, no cost.
 *  • Every mutation bumps a `seq`, so the UI can show "what NOVA learned and when".
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type MemoryKind = "fact" | "preference" | "lesson" | "event" | "session";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  /** Scope groups memories by subject — usually a target/domain, or "global". */
  scope: string;
  title: string;
  content: string;
  tags: string[];
  /** 1..10 — drives pruning and ranking. */
  importance: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** How many times recall returned this record. */
  hits: number;
  lastUsedAt: string | null;
  /** Optional hard expiry (ISO). Facts never expire unless set. */
  expiresAt?: string;
  source?: string;
  seq: number;
}

interface MemoryFile {
  version: 2;
  seq: number;
  records: MemoryRecord[];
}

interface StoreOptions {
  file: string;
  maxRecords: number;
  writeDelayMs: number;
}

const DEFAULT_FILE = process.env.NOVA_MEMORY_FILE
  ? path.resolve(process.env.NOVA_MEMORY_FILE)
  : path.resolve(process.cwd(), "state/nova-memory.json");

const OPTS: StoreOptions = {
  file: DEFAULT_FILE,
  maxRecords: Number(process.env.NOVA_MEMORY_MAX || 5000),
  writeDelayMs: 400,
};

/** Per-kind caps (the global cap still applies on top). */
const KIND_CAPS: Partial<Record<MemoryKind, number>> = {
  event: 1200,
  session: 400,
  lesson: 800,
};

let store: MemoryFile = { version: 2, seq: 0, records: [] };
let loaded = false;
let writeTimer: NodeJS.Timeout | null = null;
let dirty = false;
let lastWriteError: string | null = null;

/* ── persistence ──────────────────────────────────────────────────────────── */

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(OPTS.file, "utf8");
    const parsed = JSON.parse(raw) as MemoryFile;
    if (parsed && Array.isArray(parsed.records)) {
      store = {
        version: 2,
        seq: Number(parsed.seq ?? 0),
        records: parsed.records.map((r) => ({
          ...r,
          tags: Array.isArray(r.tags) ? r.tags : [],
          scope: normaliseScope(r.scope),
        })),
      };
      return;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // Corrupt file: keep it for forensics instead of silently deleting it.
      try {
        fs.renameSync(OPTS.file, `${OPTS.file}.corrupt-${Date.now()}`);
      } catch {
        /* ignore */
      }
      lastWriteError = `memory file unreadable (${code}) — started a fresh store, old file kept aside`;
    }
  }
  store = { version: 2, seq: 0, records: [] };
}

function flushNow(): void {
  if (!dirty) return;
  try {
    fs.mkdirSync(path.dirname(OPTS.file), { recursive: true });
    const tmp = `${OPTS.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
    fs.renameSync(tmp, OPTS.file); // atomic on the same filesystem
    dirty = false;
    lastWriteError = null;
  } catch (err) {
    lastWriteError = (err as Error).message;
  }
}

function scheduleWrite(): void {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushNow();
  }, OPTS.writeDelayMs);
  writeTimer.unref?.();
}

/** Force a synchronous flush — used on shutdown and by the backup endpoint. */
export function flushMemory(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flushNow();
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const STOP = new Set([
  "من", "في", "على", "عن", "الى", "إلى", "مع", "ده", "دي", "هو", "هي", "ان", "أن",
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.\-_/]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function hash(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

function nowIso(): string {
  return new Date().toISOString();
}

function daysAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

/** Normalises a scope to a bare host (or "global") — heals legacy/odd values. */
function normaliseScope(raw: string | undefined | null): string {
  if (!raw) return "global";
  let v = String(raw).trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(v)) v = new URL(v).hostname;
  } catch {
    /* keep as-is */
  }
  const host = v.match(/^([a-z0-9][a-z0-9.-]*\.[a-z]{2,24})/);
  if (host) return host[1];
  return v.length > 0 && v.length <= 60 && !/\s/.test(v) ? v : "global";
}

function isExpired(r: MemoryRecord): boolean {
  return Boolean(r.expiresAt && new Date(r.expiresAt).getTime() < Date.now());
}

/* ── pruning ──────────────────────────────────────────────────────────────── */

function prune(): void {
  const before = store.records.length;
  store.records = store.records.filter((r) => r.pinned || !isExpired(r));

  for (const [kind, cap] of Object.entries(KIND_CAPS) as Array<[MemoryKind, number]>) {
    const ofKind = store.records.filter((r) => r.kind === kind && !r.pinned);
    if (ofKind.length <= cap) continue;
    const drop = new Set(
      ofKind
        .slice()
        .sort((a, b) => a.importance - b.importance || Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
        .slice(0, ofKind.length - cap)
        .map((r) => r.id),
    );
    store.records = store.records.filter((r) => r.pinned || !drop.has(r.id));
  }

  if (store.records.length > OPTS.maxRecords) {
    const keep = store.records
      .slice()
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.importance - a.importance || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      })
      .slice(0, OPTS.maxRecords);
    store.records = keep;
  }

  if (store.records.length !== before) {
    store.seq += 1;
    scheduleWrite();
  }
}

/* ── public API ───────────────────────────────────────────────────────────── */

export interface RememberInput {
  kind: MemoryKind;
  title: string;
  content: string;
  scope?: string;
  tags?: string[];
  importance?: number;
  pinned?: boolean;
  source?: string;
  ttlDays?: number;
}

/**
 * Writes a memory. Duplicate detection: same kind + scope + title refreshes the
 * existing record (content replaced, importance raised) instead of piling up.
 */
export function remember(input: RememberInput): MemoryRecord {
  load();
  const kind = input.kind;
  const scope = normaliseScope(input.scope);
  const title = input.title.trim().slice(0, 200) || "(بدون عنوان)";
  const content = input.content.trim().slice(0, 20_000);
  const importance = Math.min(10, Math.max(1, input.importance ?? (kind === "fact" ? 7 : 5)));
  const tags = Array.from(new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 24);
  const at = nowIso();

  const existing = store.records.find(
    (r) => r.kind === kind && r.scope === scope && r.title.toLowerCase() === title.toLowerCase(),
  );
  if (existing) {
    existing.content = content;
    existing.tags = Array.from(new Set([...existing.tags, ...tags]));
    existing.importance = Math.max(existing.importance, importance);
    existing.pinned = existing.pinned || Boolean(input.pinned);
    existing.updatedAt = at;
    existing.lastUsedAt = at;
    existing.source = input.source ?? existing.source;
    if (input.ttlDays) existing.expiresAt = new Date(Date.now() + input.ttlDays * 86_400_000).toISOString();
    store.seq += 1;
    existing.seq = store.seq;
    scheduleWrite();
    prune();
    return existing;
  }

  const rec: MemoryRecord = {
    id: `mem_${hash(`${kind}|${scope}|${title}|${at}`)}`,
    kind,
    scope,
    title,
    content,
    tags,
    importance,
    pinned: Boolean(input.pinned),
    createdAt: at,
    updatedAt: at,
    hits: 0,
    lastUsedAt: null,
    source: input.source,
    expiresAt: input.ttlDays ? new Date(Date.now() + input.ttlDays * 86_400_000).toISOString() : undefined,
    seq: ++store.seq,
  };
  store.records.push(rec);
  scheduleWrite();
  prune();
  return rec;
}

export interface RecallOptions {
  scope?: string;
  kinds?: MemoryKind[];
  limit?: number;
  minScore?: number;
  /** Include records from every scope (default false → soft scope match, not a hard filter). */
  anyScope?: boolean;
  /** Bump hit counters on returned records (default true). */
  markUsed?: boolean;
}

export interface RecallHit extends MemoryRecord {
  score: number;
  why: string;
}

/**
 * Transparent ranking: token overlap (title weighs double), importance, recency,
 * scope match, pin bonus. Everything explainable in the `why` field.
 */
export function recall(query: string, opts: RecallOptions = {}): RecallHit[] {
  load();
  const limit = Math.min(50, Math.max(1, opts.limit ?? 8));
  const minScore = opts.minScore ?? 0.01;
  const qTokens = tokens(query).slice(0, 24);
  const qSet = new Set(qTokens);
  const scope = opts.scope?.toLowerCase();
  const rows = store.records.filter(
    (r) => !isExpired(r) && (!opts.kinds || opts.kinds.includes(r.kind)),
  );

  if (qSet.size === 0) {
    // No query → the most important recent memories.
    const hits = rows
      .map((r) => ({
        ...r,
        score: r.importance / 10 + 1 / (1 + daysAgo(r.updatedAt)),
        why: "بدون كلمة بحث: أهم وأحدث ما أعرفه",
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (opts.markUsed !== false) touch(hits);
    return hits;
  }

  const hits: RecallHit[] = [];
  for (const r of rows) {
    const titleTokens = new Set(tokens(r.title));
    const bodyTokens = new Set([...tokens(r.content.slice(0, 4000)), ...tokens(r.tags.join(" ")), ...tokens(r.scope)]);
    let overlap = 0;
    let inTitle = 0;
    for (const t of qSet) {
      if (titleTokens.has(t)) inTitle += 1;
      else if (bodyTokens.has(t)) overlap += 1;
    }
    const direct = r.title.toLowerCase().includes(query.trim().toLowerCase()) && query.trim().length > 2;
    if (overlap === 0 && inTitle === 0 && !direct) continue;

    const relevance = (inTitle * 2 + overlap) / Math.max(3, qSet.size);
    const importance = r.importance / 10;
    const recency = 1 / (1 + daysAgo(r.updatedAt) / 14);
    const scopeFactor = scope && r.scope === scope ? 0.22 : 0;
    const pinBonus = r.pinned ? 0.25 : 0;
    const useBonus = Math.min(0.1, r.hits * 0.01);
    const score = relevance * 0.55 + importance * 0.2 + recency * 0.15 + scopeFactor + pinBonus + useBonus;

    if (score < minScore) continue;
    hits.push({
      ...r,
      score: Number(score.toFixed(4)),
      why: [
        inTitle ? `عنوان مطابق (${inTitle})` : null,
        overlap ? `محتوى مطابق (${overlap})` : null,
        scopeFactor ? "نفس الهدف" : null,
        r.pinned ? "مثبتة" : null,
        `أهمية ${r.importance}/10`,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);
  if (opts.markUsed !== false) touch(top);
  return top;
}

function touch(rows: MemoryRecord[]): void {
  if (!rows.length) return;
  const at = nowIso();
  for (const r of rows) {
    const live = store.records.find((x) => x.id === r.id);
    if (live) {
      live.hits += 1;
      live.lastUsedAt = at;
    }
  }
  scheduleWrite();
}

export function getMemory(id: string): MemoryRecord | null {
  load();
  return store.records.find((r) => r.id === id) ?? null;
}

export function forget(id: string): boolean {
  load();
  const idx = store.records.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  store.records.splice(idx, 1);
  store.seq += 1;
  scheduleWrite();
  return true;
}

/** Bulk delete by filter — used by the UI ("forget this target", "clear events"). */
export function forgetMany(filter: { kind?: MemoryKind; scope?: string; olderThanDays?: number }): number {
  load();
  const before = store.records.length;
  store.records = store.records.filter((r) => {
    if (r.pinned) return true;
    if (filter.kind && r.kind !== filter.kind) return true;
    if (filter.scope && r.scope !== filter.scope.toLowerCase()) return true;
    if (filter.olderThanDays !== undefined && daysAgo(r.updatedAt) < filter.olderThanDays) return true;
    return false;
  });
  const removed = before - store.records.length;
  if (removed) {
    store.seq += 1;
    scheduleWrite();
  }
  return removed;
}

export function pinMemory(id: string, pinned: boolean): MemoryRecord | null {
  load();
  const rec = store.records.find((r) => r.id === id);
  if (!rec) return null;
  rec.pinned = pinned;
  rec.updatedAt = nowIso();
  store.seq += 1;
  rec.seq = store.seq;
  scheduleWrite();
  return rec;
}

export function updateMemory(id: string, patch: Partial<Pick<MemoryRecord, "title" | "content" | "importance" | "tags" | "scope">>): MemoryRecord | null {
  load();
  const rec = store.records.find((r) => r.id === id);
  if (!rec) return null;
  if (patch.title !== undefined) rec.title = patch.title.slice(0, 200);
  if (patch.content !== undefined) rec.content = patch.content.slice(0, 20_000);
  if (patch.importance !== undefined) rec.importance = Math.min(10, Math.max(1, patch.importance));
  if (patch.tags !== undefined) rec.tags = patch.tags.map((t) => t.toLowerCase());
  if (patch.scope !== undefined) rec.scope = normaliseScope(patch.scope);
  rec.updatedAt = nowIso();
  store.seq += 1;
  rec.seq = store.seq;
  scheduleWrite();
  return rec;
}

export function listMemories(opts: { kind?: MemoryKind; scope?: string; limit?: number; offset?: number; sort?: "recent" | "important" } = {}): {
  total: number;
  items: MemoryRecord[];
} {
  load();
  let rows = store.records.filter((r) => !isExpired(r));
  if (opts.kind) rows = rows.filter((r) => r.kind === opts.kind);
  if (opts.scope) rows = rows.filter((r) => r.scope === opts.scope!.toLowerCase());
  rows = rows.slice().sort((a, b) =>
    opts.sort === "important"
      ? b.importance - a.importance || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 50));
  return { total: rows.length, items: rows.slice(offset, offset + limit) };
}

export function memoryStats(): {
  total: number;
  byKind: Record<MemoryKind, number>;
  scopes: Array<{ scope: string; count: number }>;
  pinned: number;
  file: string;
  bytes: number;
  lastWriteError: string | null;
  oldest: string | null;
  newest: string | null;
} {
  load();
  const byKind = { fact: 0, preference: 0, lesson: 0, event: 0, session: 0 } as Record<MemoryKind, number>;
  const scopeMap = new Map<string, number>();
  for (const r of store.records) {
    byKind[r.kind] += 1;
    scopeMap.set(r.scope, (scopeMap.get(r.scope) ?? 0) + 1);
  }
  let bytes = 0;
  try {
    bytes = fs.statSync(OPTS.file).size;
  } catch {
    bytes = 0;
  }
  const times = store.records.map((r) => Date.parse(r.createdAt)).filter((n) => Number.isFinite(n));
  return {
    total: store.records.length,
    byKind,
    scopes: [...scopeMap.entries()]
      .map(([scope, count]) => ({ scope, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    pinned: store.records.filter((r) => r.pinned).length,
    file: OPTS.file,
    bytes,
    lastWriteError,
    oldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
    newest: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/**
 * The block injected into the system prompt before every single reply.
 * Kept tight (≈1.5k chars) so it never eats the model's context window.
 */
export function memoryContextFor(query: string, scope?: string, limit = 7): string {
  load();
  const hits = recall(query, { scope, limit, markUsed: false });
  const prefs = store.records
    .filter((r) => r.kind === "preference" && !isExpired(r))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 4);
  const lessons = store.records
    .filter((r) => r.kind === "lesson" && !isExpired(r))
    .sort((a, b) => b.importance - a.importance || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3);

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of [...prefs, ...lessons, ...hits]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const tag = r.kind === "preference" ? "تفضيل" : r.kind === "lesson" ? "درس" : r.kind === "fact" ? "حقيقة" : r.kind === "session" ? "جلسة سابقة" : "حدث";
    lines.push(`- (${tag}${r.scope !== "global" ? ` · ${r.scope}` : ""}) ${r.title}: ${r.content.replace(/\s+/g, " ").slice(0, 170)}`);
    if (lines.length >= limit + 4) break;
  }
  if (!lines.length) return "";
  return [
    "# ذاكرتك طويلة الأمد (استخدمها ولا تخترع عكسها)",
    ...lines,
    "لو معلومة هنا تخالف ما يقوله المستخدم الآن، اسأله وأكّد قبل ما تعتمد عليها.",
  ].join("\n");
}

export function exportMemories(): string {
  load();
  flushMemory();
  return JSON.stringify(store, null, 2);
}

export function importMemories(json: string): { imported: number; skipped: number } {
  load();
  const parsed = JSON.parse(json) as MemoryFile | MemoryRecord[];
  const incoming = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(incoming)) throw new Error("صيغة غير صالحة: متوقع مصفوفة ذكريات");
  const existing = new Set(store.records.map((r) => r.id));
  let imported = 0;
  let skipped = 0;
  for (const r of incoming) {
    if (!r?.id || existing.has(r.id) || !r.title) {
      skipped += 1;
      continue;
    }
    store.records.push({ ...r, tags: Array.isArray(r.tags) ? r.tags : [], seq: ++store.seq });
    existing.add(r.id);
    imported += 1;
  }
  scheduleWrite();
  prune();
  return { imported, skipped };
}

/* ── lifecycle hooks ──────────────────────────────────────────────────────── */

/** Startup: eager-load so the first reply already knows everything. */
export function initMemory(): void {
  load();
  prune();
  flushMemory();
}

process.on("exit", flushMemory);
process.on("SIGTERM", () => {
  flushMemory();
  process.exit(0);
});
process.on("SIGINT", () => {
  flushMemory();
  process.exit(0);
});
