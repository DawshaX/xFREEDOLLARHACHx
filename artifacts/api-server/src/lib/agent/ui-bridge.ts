/**
 * NOVA → اللوحة: قنات الأوامر (UI bridge)
 * ────────────────────────────────────────────────────────────────────────────
 * العلة اللي الملف ده مقفول بيها: `ui_navigate` كان بيرجّع
 * «طلبت من اللوحة تفتح /scanner» و`ok:true` — بينما مفيش **مستمع واحد** للحدث.
 * اللوحة (NovaWorkstation/LiveAgentPanel) ما بتعرفش تاخد `nova:ui`، والأهم إن
 * بثّ WebSocket بيروح لمين شغال لحظة الإرسال وبس: لو مافيش تاب مفتوح الأمر بيموت
 * في الهوا والرد بيقول «اتنفّذ». ده تعريف «كلام وبس».
 *
 * هنا الأمر بيوصل بقناة ليها وجهين:
 *   1) بثّ لحظي على `/api/ws` (اللوحة بتسمع live).
 *   2) طابور صغير بيقراه العميل لما يستلم (`GET /api/nova-core/ui`) — فالأمر
 *      ميتعشمش إن حد يسمع اللحظة دي، و`deliveredAt` بيتسجّل فعلًا لما حد ياخده.
 * كده أي أداة بتقول «فتحت الصفحة» تقدر تثبّت ده بقياس: اتاخدت ولا لأ.
 */

import { broadcastEvent, getHubClientCount } from "../ws-hub";

export type UiCommandKind = "open_url" | "navigate" | "action";

export interface UiCommand {
  id: string;
  kind: UiCommandKind;
  url?: string;
  path?: string;
  action?: string;
  payload?: Record<string, unknown>;
  at: number;
  /** امتى اللوحة سحبته فعلًا (null = لسه ماحدش أخده). */
  deliveredAt: number | null;
}

const CAP = 25;
const QUEUE: UiCommand[] = [];
let seq = 0;

/** مفيش أي مبرر إن الأمر يعيش للأبد؛ الطابور دايرة صغيرة بـ25 أمر. */
function push(cmd: Omit<UiCommand, "id" | "at" | "deliveredAt">): UiCommand {
  const full: UiCommand = { ...cmd, id: `ui-${Date.now().toString(36)}-${seq++}`, at: Date.now(), deliveredAt: null };
  QUEUE.push(full);
  if (QUEUE.length > CAP) QUEUE.splice(0, QUEUE.length - CAP);
  broadcastEvent("nova:ui", { ...full });
  return full;
}

/** الرابط لازم يكون http(s) بس — `javascript:` في رابط بيفتحه المتصفح = تنفيذ كود في صفحة المستخدم. */
export function safeUrl(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let candidate = s;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname || u.hostname.length < 3) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function openUrl(rawUrl: string): { ok: boolean; url: string | null; summary: string; data: unknown } {
  const started = Date.now();
  const raw = String(rawUrl ?? "").trim();
  const url = safeUrl(raw);
  const clients = getHubClientCount();
  if (!raw) {
    return {
      ok: false,
      url: null,
      summary: "قولي «افتح https://example.com» وأنا أفتحه عندك في التاب — من غير رابط مافيش حاجة أفتحها.",
      data: { wsClients: clients, need: "url" },
    };
  }
  if (!url) {
    return {
      ok: false,
      url: null,
      summary: "الرابط مرفوض: المتصفح بيقبل http/https بس (مفيش javascript:/data:) — مافيش حاجة اتفتحت.",
      data: { requested: String(rawUrl ?? "").slice(0, 160), wsClients: clients },
    };
  }
  const cmd = push({ kind: "open_url", url });
  const live = clients > 0;
  return {
    ok: true,
    url,
    summary: live
      ? `بعتت «افتح ${url}» للوحة — ${clients} عميل WebSocket سامع، والأمر في الطابور لحد ما حد يسحبه (${cmd.id}).`
      : `الأمر اتسجّل في الطابور (${cmd.id}) بس مفيش عميل WebSocket سامع دلوقتي — مش هنقول «اتفتح» غير لما اللوحة تسحبه. افتحي اللوحة في تبويب وهيتنفّذ.`,
    data: { url, commandId: cmd.id, wsClients: clients, queuedAt: cmd.at, ms: Date.now() - started },
  };
}

export function navigatePanel(p: string): { ok: boolean; summary: string; data: unknown } {
  const started = Date.now();
  const rel = String(p ?? "").trim();
  if (!rel || !rel.startsWith("/")) {
    return { ok: false, summary: "مسار اللوحة لازم يبدأ بـ/ — مافيش حاجة اتنفّذت", data: { requested: rel.slice(0, 120) } };
  }
  const cmd = push({ kind: "navigate", path: rel });
  const clients = getHubClientCount();
  return {
    ok: true,
    summary: clients
      ? `نقّلت اللوحة على ${rel} (${clients} عميل سامع).`
      : `طلب النقل لـ${rel} مستني اللوحة تسحبه (${cmd.id}) — مفيش عميل متصل دلوقتي.`,
    data: { path: rel, commandId: cmd.id, wsClients: clients, ms: Date.now() - started },
  };
}

export function panelAction(action: string, payload: Record<string, unknown> = {}): { ok: boolean; summary: string; data: unknown } {
  const a = String(action ?? "").trim();
  if (!a) return { ok: false, summary: "اسم الإجراء مطلوب", data: null };
  const cmd = push({ kind: "action", action: a, payload });
  const clients = getHubClientCount();
  return {
    ok: true,
    summary: clients ? `طلبت «${a}» من اللوحة (${clients} عميل سامع).` : `«${a}» مستني اللوحة تسحبه (${cmd.id}) — مفيش عميل WS دلوقتي.`,
    data: { action: a, commandId: cmd.id, wsClients: clients },
  };
}

export interface UiQueueState {
  commands: Array<Pick<UiCommand, "id" | "kind" | "url" | "path" | "action" | "at">>;
  wsClients: number;
  pending: number;
}

/** اللي اللوحة سحبته بيتعلّم ب`deliveredAt` فالطابور ميتكررش. */
export function claimCommands(afterId: string | null, markDelivered: boolean): UiQueueState {
  const idx = afterId ? QUEUE.findIndex((c) => c.id === afterId) : -1;
  const fresh = (idx >= 0 ? QUEUE.slice(idx + 1) : QUEUE).filter((c) => !(c as UiCommand).deliveredAt);
  const at = Date.now();
  const commands = (markDelivered ? fresh : fresh).map((c) => {
    if (markDelivered) c.deliveredAt = at;
    return { id: c.id, kind: c.kind, url: c.url, path: c.path, action: c.action, at: c.at };
  });
  return {
    commands,
    wsClients: getHubClientCount(),
    pending: QUEUE.filter((c) => !c.deliveredAt).length,
  };
}

export function uiQueueStats(): { size: number; delivered: number; wsClients: number } {
  return {
    size: QUEUE.length,
    delivered: QUEUE.filter((c) => c.deliveredAt !== null).length,
    wsClients: getHubClientCount(),
  };
}
