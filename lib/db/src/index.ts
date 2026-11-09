import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

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

function buildPool(): { cfg: pg.PoolConfig; mode: DbSslMode } {
  const modeEnv = (process.env.NOVA_DB_SSL || "").trim().toLowerCase();
  const url = stripSslParams(RAW_URL);
  const urlWantsSsl =
    /[?&]sslmode=(require|prefer|verify-ca|verify-full)/i.test(RAW_URL) ||
    /supabase\.co|pooler\.supabase\.com/i.test(RAW_URL);

  if (["0", "off", "disable", "disabled"].includes(modeEnv))
    return { cfg: { connectionString: url }, mode: "off" };
  if (!urlWantsSsl) return { cfg: { connectionString: url }, mode: "implicit" };

  if (modeEnv === "strict" || process.env.NOVA_DB_CA || process.env.NODE_EXTRA_CA_CERTS) {
    return {
      cfg: {
        connectionString: url,
        ssl: {
          rejectUnauthorized: true,
          ...(process.env.NOVA_DB_CA ? { ca: process.env.NOVA_DB_CA } : {}),
        },
      },
      mode: "strict",
    };
  }
  return {
    cfg: { connectionString: url, ssl: { rejectUnauthorized: false } },
    mode: "encrypted-unverified",
  };
}

const { cfg, mode } = buildPool();

export const DB_SSL_MODE: DbSslMode = mode;

export const DB_SSL_NOTE_AR =
  mode === "encrypted-unverified"
    ? "قاعدة البيانات: اتصال مشفّر بلا تحقق من سلسلة CA (هوست مجاني) — وفّر NOVA_DB_CA للتحقق الصارم."
    : mode === "strict"
      ? "قاعدة البيانات: اتصال مشفّر بتحقق صارم من السلسلة (CA مثبّت)."
      : mode === "off"
        ? "قاعدة البيانات: SSL مُطفأ يدوياً (NOVA_DB_SSL=off) — تطوير فقط."
        : "قاعدة البيانات: إعداد SSL ضمني من السلسلة.";

export const pool = new Pool({
  ...cfg,
  connectionTimeoutMillis: 1500,
  // الـpooler بيقتل الاتصالات الخاملة → «Connection terminated unexpectedly».
  // keepAlive + idle أقصر من قاتل الـpooler يمنع موت الاستعلامات الساكنة.
  keepAlive: true,
  idleTimeoutMillis: 10_000,
  max: 5,
});

pool.on("error", () => {
  // Prevent unhandled pool error crashes when running in standalone/fallback mode without Postgres
});

export const db = drizzle(pool, { schema });

export * from "./schema";
