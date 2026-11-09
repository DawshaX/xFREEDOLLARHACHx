/**
 * runtime-config · قناة ضبط دائمة من غير ما الإعدادات تعيش في env بس
 * ─────────────────────────────────────────────────────────────────────────────
 * المشكلة اللي حلّتها: مضيفين زي Pterodactyl المجانية مابيدخلوش env جديدة إلا
 * بإيد بشرى، فالتوكنات (تليجرام، شودان…) كانت «موجودة في الدنيا بس العقدة
 * مش شايفاها». دلوقتي أي عملية موثّقة (CI بالتوكن التنفيذي) تقدر تدفّع إعدادًا
 * من POST /api/ops/config، والسيرفر:
 *   1) يحطه في الكاش المحلي فورًا،
 *   2) يقفله في الذاكرة الدائمة (memory-store → Supabase Edge) — يبقى باقي
 *      حتى بعد إعادة التشغيل وبعد موت الحاوية بالكامل.
 *
 * القواعد الأمنية (غير قابلة للتفاوض):
 *   • listة مقفولة: بس المفاتيح اللي في ALLOWED_KEYS. أي مفتاح غريب يرفض.
 *   • القيم **عمرها ما تترجع** في أي API — اللي بيتعرض boolean «موجود/فاضي».
 *   • القيم مابتتكتبش في اللوجات نهائي.
 *   • env بتاع النظام ليه أولوية (هو الأصل)، والـruntime-config مكمّل مش بديل.
 */
import { logger } from "../logger";

export interface ConfigSpec {
  /** عنوان عربي للواجهة */
  labelAr: string;
  /** تحقق شكلي قبل الحفظ — السبب بيرجع كنص لو رفض */
  validate?: (v: string) => string | null;
  /** حساس ⇒ يتخزن pinned والقيمة محجوبة عن أي رد */
  sensitive?: boolean;
}

export const ALLOWED_KEYS: Record<string, ConfigSpec> = {
  "telegram.botToken": {
    labelAr: "توكن بوت تليجرام",
    sensitive: true,
    validate: (v) => (/^\d{6,}:[\w-]{30,}$/.test(v.trim()) ? null : "شكل توكن تليجرام غلط (المفروض رقم:خلطة طويلة)"),
  },
  "telegram.chatId": {
    labelAr: "معرّف شات تليجرام",
    sensitive: true,
    validate: (v) => (/^-?\d{5,}$/.test(v.trim()) ? null : "chat_id لازم رقم (خليها فاضية والسيرفر هيتعلّمها من /start)"),
  },
  "shodan.apiKey": {
    labelAr: "مفتاح Shodan (إثراء الزوار سلبيًا)",
    sensitive: true,
    validate: (v) => (/^[\w-]{16,64}$/.test(v.trim()) ? null : "شكل مفتاح غير متوقع"),
  },
  /** «0» يسكّت إشعارات صيد الثغرات على التليجرام (افتراضيًا شغالة) */
  "telegram.alert.cve": {
    sensitive: false,
    validate: (v) => (v === "" || v === "0" || v === "1" ? null : "القيمة لازم «0» أو «1»"),
  },
  "visitorAlerts": {
    labelAr: "تنبيهات الزيارات على/قف",
    validate: (v) => (["0", "1"].includes(v.trim()) ? null : "القيمة 1 أو 0 بس"),
  },
};

const cache = new Map<string, string>();
let hydrated = false;

/** قراءة إعداد: runtime config → الكاش → null. env الأسبق دايمًا وده مسؤولية المستدعي. */
export function getRuntimeConfig(key: string): string {
  return cache.get(key) ?? "";
}

export function runtimeConfigStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(ALLOWED_KEYS)) out[k] = Boolean(cache.get(k));
  return out;
}

/** تحميل القيم المحفوظة مرة في الإقلاع (آمن: فشل الذاكرة = كاش فاضي). */
export async function hydrateRuntimeConfig(): Promise<{ hydrated: number }> {
  if (hydrated) return { hydrated: 0 };
  hydrated = true;
  let n = 0;
  try {
    const { recall } = await import("../agent/memory-store");
    for (const key of Object.keys(ALLOWED_KEYS)) {
      const hits = recall(`config:${key}`, { scope: "ops", limit: 1 });
      const v = String(hits[0]?.content ?? "").trim();
      if (v) { cache.set(key, v); n += 1; }
    }
    if (n) logger.info({ keys: Object.keys(ALLOWED_KEYS).filter((k) => cache.get(k)) }, "runtime-config hydrated from durable memory");
  } catch (e) {
    logger.warn({ err: String(e) }, "runtime-config hydrate skipped (memory offline)");
  }
  return { hydrated: n };
}

/** كتابة إعداد — بترفض بالسبب لو المفتاح/القيمة مش قانونية. */
export async function setRuntimeConfig(key: string, value: string): Promise<{ ok: true } | { ok: false; reasonAr: string }> {
  const spec = ALLOWED_KEYS[key];
  if (!spec) return { ok: false, reasonAr: `مفتاح مش مسموح: "${key}". المسموح: ${Object.keys(ALLOWED_KEYS).join(", ")}` };
  const v = String(value ?? "").trim();
  if (!v) { cache.delete(key); return { ok: true }; } // مسح إعداد = قيمة فاضية
  const bad = spec.validate?.(v);
  if (bad) return { ok: false, reasonAr: bad };
  cache.set(key, v);
  try {
    const { remember } = await import("../agent/memory-store");
    remember({
      kind: "fact", scope: "ops", title: `config:${key}`, content: v,
      tags: ["runtime-config"], pinned: true, importance: 5, ttlDays: 3650,
    });
  } catch (e) {
    logger.warn({ err: String(e), key }, "runtime-config persist failed (memory offline) — الكاش المحلي فاضل شغال");
  }
  return { ok: true };
}

/** للاختبارات */
export function _resetRuntimeConfigForTests(): void { cache.clear(); hydrated = false; }
