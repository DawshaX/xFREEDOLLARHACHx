/**
 * Telegram hub · مركز إشعارات تليجرام — كل الأحداث المهمة توصل لصاحبها فورًا
 * ─────────────────────────────────────────────────────────────────────────────
 * القواعد:
 *   • التوكن والشات من env (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`) — مش بيتطبعوا
 *     ولا بيتحطوا في رد، ولا بيتكتبوا في أي ملف متتبَّع.
 *   • لو الشات مش معروف: السيرفر بيسأل getUpdates كل 20ث (حتى 30 دقيقة) — يكفي
 *     إن المالك يبعت /start للبوت من حسابه، والـchat_id بيتقفل في الذاكرة الدائمة
 *     (memory-store → Supabase Edge) فبيتحمّل إعادة التشغيل، وبيتبعت إشعار تأكيد.
 *   • مفيش إشعار يقدر يكسر السيرفر: كل send معزول try/catch + timeout، والفشل
 *     بيتسجل بس. ثروتلنج per-topic عشان عاصفة أخطاء ما تفضلش تزعق.
 *   • للاختبار: NOVA_TELEGRAM_API_BASE يبدّل قاعدة الـAPI (افتراضي https://api.telegram.org).
 */
import { logger } from "../logger";
import { getRuntimeConfig } from "./runtime-config";

const API_BASE = (process.env.NOVA_TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
const DEFAULT_MIN_INTERVAL_MS = 60_000;
const GLOBAL_SPACING_MS = 2_500;

let cachedChatId: string | null = null;
let lastTgError: { at: string; status: number | null; desc: string; method: string } | null = null;
let botSelfId: string | null = null; // رقم البوت نفسه — أي chat_id بيساويه = إعداد غلط مثبت
export function lastTelegramError() { return lastTgError; }
let chatPollerStarted = false;
const lastSentByTopic = new Map<string, number>();
let lastGlobalSend = 0;

export function telegramToken(): string {
  // env (الأصل) ← runtime-config (المقفول في الذاكرة الدائمة من POST /ops/config)
  return (process.env.TELEGRAM_BOT_TOKEN || "").trim() || getRuntimeConfig("telegram.botToken");
}

export function telegramConfigured(): boolean {
  return Boolean(telegramToken());
}

/** تهريب أي محتوى غير موثوق قبل ما يدخل رسالة (الـIP والـUA من ناس مش احنا). */
export function esc(v: unknown, max = 200): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>&]/g, "#")
    .slice(0, max);
}

let botSelfUsername: string | null = null;

function chatIdLooksValid(id: string): boolean {
  // تليجرام بيقبل numeric (-?digits) أو «@username» — الاتنين صالحان لـsendMessage.
  const numeric = /^-?\d+$/.test(id);
  const handle = /^@[A-Za-z0-9_]{4,31}$/.test(id);
  if (!numeric && !handle) return false;
  // القياس المقاس على العقدة (2026-11-09T23:39Z): .env كان فيه chat_id = رقم البوت نفسه
  // ⇒ تليجرام بيردّ 403 «can't send messages to the bot». نفس الغلط لو حطيت
  // يوزر البوت @xDawFREE_BOT بدل يوزرك — الرفض هنا يرجّعك للتعلّم الحقيقي.
  if (botSelfId && id === botSelfId) return false;
  if (handle && botSelfUsername && id.toLowerCase() === "@" + botSelfUsername.toLowerCase()) return false;
  return true;
}

export function getChatId(): string {
  if (cachedChatId) return cachedChatId;
  const fromEnv = (process.env.TELEGRAM_CHAT_ID || "").trim() || getRuntimeConfig("telegram.chatId");
  if (fromEnv && chatIdLooksValid(fromEnv)) { cachedChatId = fromEnv; return fromEnv; }
  if (fromEnv && botSelfId && fromEnv === botSelfId) {
    logger.warn({ wrong: "self-id" }, "telegram: chat_id مساوٍ لرقم البوت — متجاهَل حتى يتعلّم الشات الحقيقي");
  }
  return "";
}

/** زرع/استرجاع chat_id عبر الذاكرة الدائمة — معزول عشان ميقدرش يكسر الإقلاع. */
async function loadPersistedChatId(): Promise<string> {
  try {
    const { recall } = await import("../agent/memory-store");
    const hits = recall("telegram.chatId", { scope: "ops", limit: 1 });
    const id = String(hits[0]?.content ?? "").trim();
    if (chatIdLooksValid(id)) { cachedChatId = id; return id; }
  } catch { /* الذاكرة رفاهية مش شرط إقلاع */ }
  return "";
}

async function persistChatId(id: string): Promise<void> {
  try {
    const { remember } = await import("../agent/memory-store");
    remember({
      kind: "fact", scope: "ops", title: "telegram.chatId", content: id,
      tags: ["telegram", "ops"], pinned: true, importance: 5, ttlDays: 3650,
    });
  } catch { /* محلي بس لو المراية واقعة — المرة الجاية getUpdates هيلقطه تاني */ }
}

async function tgApi(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const token = telegramToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) {
      // تليجرام بيرجّع وصفًا صريحًا («bot was blocked by the user») — بنسجّله
      // مش نكتفي بالرقم.
      const body = await res.text().catch(() => "");
      let desc = "";
      try { desc = String((JSON.parse(body) as { description?: string }).description || "").slice(0, 180); } catch { desc = body.slice(0, 180); }
      lastTgError = { at: new Date().toISOString(), status: res.status, desc, method };
      logger.warn({ status: res.status, method, desc }, "telegram api non-200 — الوصف الحقيقي محفوظ");
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    logger.warn({ err: String(e), method }, "telegram api unreachable");
    return null;
  }
}

/**
 * الإرسال الوحيد المسموح — الكل بيعدّي من هنا:
 * topic = مفتاح الثروتلنج («visit:1.2.3.4» بتمنع ميت رسالة لنفس الزائر).
 * يرجع true/false عشان الاختبارات تقيس — المستدعي مالوش دعوة بالنتيجة.
 */
export async function notifyTelegram(
  topic: string,
  text: string,
  opts: { minIntervalMs?: number; bypassThrottle?: boolean } = {},
): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const chatId = getChatId() || await loadPersistedChatId();
  if (!chatId) { void ensureChatId(); return false; }

  const now = Date.now();
  if (!opts.bypassThrottle) {
    const last = lastSentByTopic.get(topic) ?? 0;
    if (now - last < (opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS)) return false;
    if (now - lastGlobalSend < GLOBAL_SPACING_MS) return false;
  }
  lastSentByTopic.set(topic, now);
  lastGlobalSend = now;
  if (lastSentByTopic.size > 5000) {
    // تسريب بسيط: امسح الأقدم ربع
    const entries = [...lastSentByTopic.entries()].sort((a, b) => a[1] - b[1]);
    for (const [k] of entries.slice(0, 1250)) lastSentByTopic.delete(k);
  }

  const out = await tgApi("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 3900),
    disable_web_page_preview: true,
    disable_notification: opts.bypassThrottle === true && text.startsWith("🔕"),
  });
  return Boolean(out && (out as { ok?: boolean }).ok);
}

/**
 * لو مفيش chat_id لا في env ولا الذاكرة: استطلع getUpdates في الخلفية.
 * المالك يبعت «/start» للبوت من أي محادثة → بنقفل الـid ونبعت تأكيد.
 */
export function ensureChatId(opts: { maxRounds?: number; everyMs?: number } = {}): void {
  // هوية البوت قبل قرار «في chat_id ولا لأ»: نرفض self-id (اللوج الحي أثبت
  // إن .env كان فيه رقم البوت نفسه) وبعدها الـpoller يبدأ بيقين مش سباق.
  void tgApi("getMe", {}).then((me) => {
    const r = me?.result as { id?: number; username?: string } | undefined;
    if (r?.id != null) botSelfId = String(r.id);
    if (r?.username) botSelfUsername = String(r.username);
    startIfNeeded(opts);
  }).catch(() => { startIfNeeded(opts); });
}

function startIfNeeded(opts: { maxRounds?: number; everyMs?: number } = {}): void {
  if (chatPollerStarted || getChatId()) return;
  chatPollerStarted = true;
  const everyMs = opts.everyMs ?? 20_000;
  const maxRounds = opts.maxRounds ?? 90; // 30 دقيقة افتراضي
  let round = 0;
  const timer = setInterval(async () => {
    round += 1;
    if (getChatId() || round > maxRounds) { clearInterval(timer); return; }
    if (await loadPersistedChatId()) { clearInterval(timer); return; }
    const out = await tgApi("getUpdates", { offset: -1, limit: 1, timeout: 0 });
    const result = (out as { result?: Array<{ message?: { chat?: { id?: number } } }> } | null)?.result;
    const id = result?.[0]?.message?.chat?.id;
    if (typeof id === "number") {
      clearInterval(timer);
      cachedChatId = String(id);
      await persistChatId(cachedChatId);
      logger.info({ chatId: cachedChatId }, "telegram chat_id learned from /start");
      await notifyTelegram("boot:paired", "✅ NOVA اتربط بتليجرام — الإشعارات هتوصل هنا من دلوقتي.", { bypassThrottle: true });
    }
  }, everyMs);
  timer.unref?.();
}

export async function notifyBoot(version: string): Promise<void> {
  ensureChatId();
  await notifyTelegram("sys:boot",
    `🟢 NOVA اشتغل\nالإصدار: ${esc(version, 60)}\nالوقت: ${new Date().toISOString()}`,
    { bypassThrottle: true, minIntervalMs: 5 * 60_000 });
}

/** للاختبارات: صفري الحالة بين حالات الاختبار. */
/**
 * تلخيص صيد CVE للتليجرام — مش بيبعت للصفرات (مش هنفسح الشات بمعدد).
 * ثروتلو per-topic: رسالة واحدة كل 10 دقايق مهما اترجرر الصيد.
 */
export async function notifyCveHunt(sum: Record<string, unknown>): Promise<void> {
  if (getRuntimeConfig("telegram.alert.cve") === "0") return;
  const total = Number(sum.totalNew ?? sum.added ?? 0);
  if (!Number.isFinite(total) || total <= 0) return;
  const parts = ([
    ["NVD", "nvdNew"], ["GitHub Security", "ghNew"], ["CISA-KEV", "cisaNew"],
    ["Exploit-DB", "edbNew"], ["PacketStorm", "pssNew"], ["VulDB", "vuldbNew"], ["circl.lu", "circlNew"],
  ] as [string, string][])
    .map(([label, key]) => { const n = Number(sum[key] ?? 0); return n > 0 ? `${label} +${n}` : null; })
    .filter(Boolean).join(" · ");
  await notifyTelegram(
    "cve.hunt",
    `🎯 <b>صيد ثغرات جديد</b> — +${total} سجل${parts ? `\n${parts}` : ""}\n⏱ ${new Date().toISOString()}`,
    { minIntervalMs: 10 * 60_000 },
  );
}

/**
 * telegramStatus — فحص حقيقي مضروب على API (getMe + getUpdates):
 * tokenSet/tokenFrom · bot.username · chatIdKnown · pendingUpdates · آخر خطأ بالوصف
 * الحقيقي («bot was blocked» مش رقم 403 صامت). لو الاتصال فشل بيقول unreachable.
 */
export async function telegramStatus(): Promise<Record<string, unknown>> {
  const token = telegramToken();
  const chatId = getChatId();
  if (!token) {
    return {
      tokenSet: false,
      noteAr: "مفيش botToken لا في env ولا في الضبط الدائم — الحل في «القنوات»/الإعدادات",
      lastError: lastTgError,
    };
  }
  const me = await tgApi("getMe", {});
  let updatesN: number | null = null;
  let sampledFrom = "";
  try {
    const upd = await tgApi("getUpdates", { limit: 5, timeout: 0 });
    if (Array.isArray(upd?.result)) {
      updatesN = (upd.result as unknown[]).length;
      for (const u of upd.result as Array<{ message?: { chat?: { id?: number } } }>) {
        const id = u?.message?.chat?.id;
        if (id != null) sampledFrom = String(id);
      }
    }
  } catch { updatesN = null; }
  return {
    tokenSet: true,
    tokenFrom: (process.env.TELEGRAM_BOT_TOKEN ? "env" : "runtime-config"),
    bot: me && (me.result as Record<string, unknown> | undefined)
      ? { ok: true, username: (me.result as Record<string, unknown>).username ?? null, id: (me.result as Record<string, unknown>).id ?? null }
      : { ok: false, noteAr: "getMe فشل — التوكن مش صحيح أو api.telegram.org مقطوع" },
    chatIdKnown: Boolean(chatId),
    chatIdFrom: chatId ? (process.env.TELEGRAM_CHAT_ID ? "env" : "learned-or-memory") : null,
    pendingUpdates: updatesN,
    sampledChatFromUpdates: sampledFrom || null,
    lastError: lastTgError,
    adviceAr: lastTgError?.desc?.includes("can't send messages to the bot")
      ? `chat_id متحطوط = رقم البوت نفسه (غلط). خدّم: امسح TELEGRAM_CHAT_ID من .env أو حطّه رقم شاتك الحقيقي${sampledFrom ? ` — المقياس من التحديثات المعلقة دلوقتي: ${sampledFrom}` : ""}، وRestart. البوت نفسه سليم.`
      : lastTgError?.status === 403
        ? "403 من تليجرام: راجع Chat — لو «bot was blocked» تحتاج /start بعد فك الحظر، ولو «chat not found» الـchat_id قديم باطل. /start للبوت يعلّم العقدة جديدها."
        : chatId ? "القناة جاهزة للعمل" : "ابعت /start للبوت من تليجرامك عشان العقدة تتعلم chat_id",
  };
}

export function _resetTelegramForTests(): void {
  cachedChatId = null;
  chatPollerStarted = false;
  botSelfId = null;
  botSelfUsername = null;
  lastTgError = null;
  lastSentByTopic.clear();
  lastGlobalSend = 0;
}
