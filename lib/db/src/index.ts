import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { BUNDLED_DB_CA_PEM } from "./db-bundled-ca";

function decodeDbCa(v: string): string {
  if (/BEGIN CERTIFICATE/.test(v)) return v;
  try {
    const dec = Buffer.from(v.trim(), "base64").toString("utf8");
    return /BEGIN CERTIFICATE/.test(dec) ? dec : v;
  } catch { return v; }
}

export type DbCaSource = "env" | "bundled-pinned" | "system-roots";

/**
 * سلّم الـCA لوضع strict — بلا تنزيل صامت أبدًا (rejectUnauthorized بيفضل true):
 *   1) NOVA_DB_CA من البيئة لو اتفكّ لشهادة سليمة.
 *   2) CA المثبّت جوه الحزمة (db-ca-sync بيقراه من سلسلة المضيف الحي) — ده اللي
 *      بيلمّ حالة «env اتسحق في واجهة اللوحة» بدل ما الـbrainstore يقع كله
 *      بـSELF_SIGNED_CERT_IN_CHAIN (الكسر المقاس 2026-11-09).
 *   3) ولا واحد فيهم → جذور نظام التشغيل (زي أي عميل TLS عادي — وهتفشل بصراحة
 *      لو المضيف بيقدّم سلسلة self-signed، مش بصمت).
 */
export function resolveStrictCa(
  opts: { envCa?: string; bundled?: string } = {},
): { ca?: string; source: DbCaSource } {
  const envCa = String(opts.envCa ?? process.env.NOVA_DB_CA ?? "").trim();
  if (envCa) {
    const dec = decodeDbCa(envCa);
    if (/BEGIN CERTIFICATE/.test(dec)) return { ca: dec, source: "env" };
    // env مش فاضي بس مش شهادة — متستخدموش ولا تعتبره نجاح.
  }
  const bundled = String(opts.bundled ?? BUNDLED_DB_CA_PEM ?? "").trim();
  if (/BEGIN CERTIFICATE/.test(bundled)) return { ca: bundled, source: "bundled-pinned" };
  return { source: "system-roots" };
}

const { Pool } = pg;

const RAW_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/cybernova";

/**
 * N1 — إصلاح سقوط قاعدة البيانات على العقدة الحية (2026-11-09، لوج Pterodactyl).
 *
 * pg الحديث بيعامل sslmode=require/prefer/verify-ca كأنهم verify-full (تحذيره الرسمي
 * ظهر في إقلاع العقدة نفسه)، فسلاسل Supabase/pooler — اللي فيها CA خاص أو شهادة
 * self-signed جوّاها — كانت بتكسر كل اتصال بـ SELF_SIGNED_CERT_IN_CHAIN:
 * المايجريشنز، bot_cron_jobs، جلسات الوكيل، المتعلّم، المصنّف — كلها سقطت بصمت.
 *
 * القاعدة هنا (صادقة ومعلنة):
 *  - مشفّر دايماً لما الـURL يطلب SSL.
 *  - تحقق صارم من السلسلة لما المشغّل يوفّر CA (NOVA_DB_CA أو NODE_EXTRA_CA_CERTS)
 *    أو يطلبه صراحة بـ NOVA_DB_SSL=strict.
 *  - غير كده: تشفير بلا تحقق-وسيط (rejectUnauthorized:false) وDB_SSL_NOTE_AR
 *    بيتحرك للسطح (self-check/healthz) — توثيق مش إخفاء.
 *  - NOVA_DB_SSL=0/off يطفي SSL كلياً (تطوير محلي فقط).
 */
export type DbSslMode = "off" | "encrypted-unverified" | "strict" | "implicit";

function stripSslParams(url: string): string {
  // القرار بيتاخد هنا بس — مش هننسيب pg-connection-string يفسّر sslmode لوحده تاني.
  return url
    .replace(/([?&])sslmode=[^&]*&?/gi, "$1")
    .replace(/([?&])uselibpqcompat=[^&]*&?/gi, "$1")
    .replace(/[?&]$/, "")
    .replace(/\?$/, "");
}

function buildPool(): { cfg: pg.PoolConfig; mode: DbSslMode; caSource?: DbCaSource } {
  const modeEnv = (process.env.NOVA_DB_SSL || "").trim().toLowerCase();

const url = stripSslParams(RAW_URL);
  const urlWantsSsl =
    /[?&]sslmode=(require|prefer|verify-ca|verify-full)/i.test(RAW_URL) ||
    /supabase\.co|pooler\.supabase\.com/i.test(RAW_URL);

  if (["0", "off", "disable", "disabled"].includes(modeEnv))
    return { cfg: { connectionString: url }, mode: "off" };
  if (!urlWantsSsl) return { cfg: { connectionString: url }, mode: "implicit" };

  if (modeEnv === "strict" || process.env.NOVA_DB_CA || process.env.NODE_EXTRA_CA_CERTS) {
    const pick = resolveStrictCa();
    return {
      cfg: {
        connectionString: url,
        ssl: {
          rejectUnauthorized: true,
          ...(pick.ca ? { ca: pick.ca } : {}),
        },
      },
      mode: "strict",
      caSource: pick.source,
    };
  }
  return {
    cfg: { connectionString: url, ssl: { rejectUnauthorized: false } },
    mode: "encrypted-unverified",
  };
}

const { cfg, mode, caSource } = buildPool();

export const DB_SSL_MODE: DbSslMode = mode;

/** مصدر شهادة الـCA في وضع strict — بيتقاس وقت البناء وبيتعرض في /api/healthz. */
export const DB_SSL_CA_SOURCE: DbCaSource | null = mode === "strict" ? (caSource ?? "system-roots") : null;

export const DB_SSL_NOTE_AR =
  mode === "encrypted-unverified"
    ? "قاعدة البيانات: اتصال مشفّر بلا تحقق من سلسلة CA (هوست مجاني) — وفّر NOVA_DB_CA للتحقق الصارم."
    : mode === "strict"
      ? DB_SSL_CA_SOURCE === "bundled-pinned"
        ? "قاعدة البيانات: اتصال مشفّر بتحقق صارم (CA مثبّت داخل الحزمة من سلسلة المضيف الحي — db-ca-sync)."
        : DB_SSL_CA_SOURCE === "system-roots"
          ? "قاعدة البيانات: strict من غير CA صريح — بيتحقق من جذور النظام، وهيفشل بصراحة لو السلسلة self-signed."
          : "قاعدة البيانات: اتصال مشفّر بتحقق صارم من السلسلة (CA مثبّت من البيئة)."
      : mode === "off"
        ? "قاعدة البيانات: SSL مُطفأ يدوياً (NOVA_DB_SSL=off) — تطوير فقط."
        : "قاعدة البيانات: إعداد SSL ضمني من السلسلة.";

const DB_POOL_MAX = Math.max(1, Number(process.env.NOVA_DB_POOL_MAX || 2));
export const pool = new Pool({
  ...cfg,
  // Supabase pooler على الحاوية المجانية أحيانًا بياخد >1.5s بارد ⇒ هجراتها
  // كانت بتقع «connection timeout» في اللوج الحي (2026-11-09 23:17Z). 8s معقول.
  connectionTimeoutMillis: Number(process.env.NOVA_DB_CONNECT_TIMEOUT_MS || 8000),
  // الـpooler بيقتل الاتصالات الخاملة → «Connection terminated unexpectedly».
  // keepAlive + idle أقصر من قاتل الـpooler يمنع موت الاستعلامات الساكنة.
  keepAlive: true,
  idleTimeoutMillis: 10_000,
  // حمية RAM حاوية 460MB: 5 اتصالات × buffers بحجم pg = جزء كبير من الضغط المقاس.
  max: DB_POOL_MAX,
});

/** اتصال بإعادة محاولة — للخطوات الحرجة وقت الإقلاع (هجرات) بس، بلا تعقيد الرَّد العادي. */
export async function pgConnectWithRetry(tries = 3, delayMs = 4000) {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try { return await pool.connect(); }
    catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

pool.on("error", () => {
  // Prevent unhandled pool error crashes when running in standalone/fallback mode without Postgres
});

export const db = drizzle(pool, { schema });

export * from "./schema";
