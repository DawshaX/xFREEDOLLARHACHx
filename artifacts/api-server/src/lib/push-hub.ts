/**
 * Push hub — TEST8 «كل زرار له رد فعل حقيقي».
 * ─────────────────────────────────────────────────────────────────────────
 * قِيس 2026-11-14: /api/push/stream كان SSE ميت (بينبّه بس وما بيبعتش أي
 * حدث) ومافيش POST ينشئ إشعار — مركز الإشعارات كان شكل من غير وظيفة:
 * الفشل ما كانش بيوصله والنجاح برضه. المركز ده هو القناة الرسمية الوحيدة
 * (غير متطفلة) لرد فعل البرنامج على كل فعل — النجاح والفشل بيوصله حيًا.
 *
 * المخزن دائم على state/cybernova_notifs_v1 (نفس مفتاح standalone-api) —
 * الليستة بتتقري من هنا مباشرة عشان مفيش تكرار مخزن وطبقتين للصدق.
 */
import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";

export interface PushNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** TEST9: مسار اللوحة اللي الضغط على الإشعار يودّي له (deep link). */
  link?: string;
  read: boolean;
  createdAt: string;
}

function stateFile(): string {
  return path.resolve(process.cwd(), "state", "cybernova_notifs_v1.json");
}

function loadAll(): PushNotification[] {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as PushNotification[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persist(all: PushNotification[]): void {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(all, null, 2));
  } catch {
    /* القرص ضدنا — البث اللحظي بيفضل شغال */
  }
}

const clients = new Set<Response>();

/** SSE عميل جديد على /api/push/stream. */
export function addPushClient(res: Response): void {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

function broadcast(n: PushNotification): void {
  const frame = `event: push\ndata: ${JSON.stringify(n)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

/** كل الإشعارات (الأحدث الأول) — نفس شكل /api/push/notifications القديم. */
export function listPushNotifications(): PushNotification[] {
  return loadAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** إنشاء إشعار حقيقي: بيتخزن دائمًا + بيتبث لحظيًا لكل مراكز الإشعارات المفتوحة. */
export function createPushNotification(input: { kind?: string; title: string; body?: string; link?: string }): PushNotification {
  const n: PushNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: ["info", "success", "error", "warning"].includes(String(input.kind)) ? String(input.kind) : "info",
    title: String(input.title).slice(0, 140),
    body: String(input.body ?? "").slice(0, 600),
    // TEST9 «الإشعار يودّيني للمكان»: الروابط دي اللي بتحوّل الإشعار من كلام
    // لتنقّل حقيقي — NotificationCenter بيقرأها ويمشي بها.
    ...(input.link ? { link: String(input.link).slice(0, 120) } : {}),
    read: false,
    createdAt: new Date().toISOString(),
  };
  const all = loadAll();
  all.unshift(n);
  persist(all.slice(0, 200));
  broadcast(n);
  return n;
}

export function markAllPushRead(): void {
  persist(loadAll().map((n) => ({ ...n, read: true })));
}

export function markPushRead(id: string): boolean {
  let hit = false;
  const out = loadAll().map((n) => {
    if (n.id === id) {
      hit = true;
      return { ...n, read: true };
    }
    return n;
  });
  if (hit) persist(out);
  return hit;
}
