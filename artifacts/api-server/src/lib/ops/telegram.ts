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

export function getChatId(): string {
  if (cachedChatId) return cachedChatId;
  const fromEnv = (process.env.TELEGRAM_CHAT_ID || "").trim() || getRuntimeConfig("telegram.chatId");
  if (fromEnv) { cachedChatId = fromEnv; return fromEnv; }
  return "";
}

/** زرع/استرجاع chat_id عبر الذاكرة الدائمة — معزول عشان ميقدرش يكسر الإقلاع. */
async function loadPersistedChatId(): Promise<string> {
  try {
    const { recall } = await import("../agent/memory-store");
    const hits = recall("telegram.chatId", { scope: "ops", limit: 1 });
    const id = String(hits[0]?.content ?? "").trim();
    if (/^-?\d+$/.test(id)) { cachedChatId = id; return id; }
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
      logger.warn({ status: res.status, method }, "telegram api non-200");
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

export function _resetTelegramForTests(): void {
  cachedChatId = null;
  chatPollerStarted = false;
  lastSentByTopic.clear();
  lastGlobalSend = 0;
}
