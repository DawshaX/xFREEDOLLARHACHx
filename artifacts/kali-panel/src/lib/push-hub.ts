/**
 * Push hub — panel (browser) side of the shared notification surface.
 * ─────────────────────────────────────────────────────────────────────────
 * TEST8 «كل زرار له رد فعل حقيقي». نفس سطح السيرفر (list/create/markRead)
 * لكن التخزين هنا localStorage والبث window event — في الوضع الساكن (Pages)
 * الإشعار بيتخزن وبيوصل لمركز الإشعارات فورًا برضه، بلا سيرفر.
 * السطح مشترك والتنفيذ بيئي — نفس قاعدة corpus-live (انحراف مُصرّح).
 */
export interface PushNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const KEY = "cybernova_notifs_v1";

function loadAll(): PushNotification[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PushNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(all: PushNotification[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
  } catch {
    /* التخزين ممتلئ — الـUI بيفضل شغال */
  }
}

function broadcast(n: PushNotification): void {
  try {
    window.dispatchEvent(new CustomEvent("nova:push", { detail: n }));
  } catch {
    /* بيئة اختبار بلا window */
  }
}

export function addPushClient(_res: unknown): void {
  /* السيرفر بس — في المتصفح مافيش SSE clients */
}

export function listPushNotifications(): PushNotification[] {
  return loadAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createPushNotification(input: { kind?: string; title: string; body?: string }): PushNotification {
  const n: PushNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: ["info", "success", "error", "warning"].includes(String(input.kind)) ? String(input.kind) : "info",
    title: String(input.title).slice(0, 140),
    body: String(input.body ?? "").slice(0, 600),
    read: false,
    createdAt: new Date().toISOString(),
  };
  const all = loadAll();
  all.unshift(n);
  persist(all);
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
