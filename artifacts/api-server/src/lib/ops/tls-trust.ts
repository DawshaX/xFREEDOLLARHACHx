/**
 * NOVA — «الشهادة مش متحققة» ≠ «مفيش شبكة».
 * ─────────────────────────────────────────────────────────────────────────
 * مؤكَّد بالقياس 2026-11-17 في الساندبوكس: `curl` بيجيب
 * `api.github.com/.../contents/part-57` كامل 94MB بـ200، وفي نفس اللحظة
 * `fetch` في Node بيرمي `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. الفرق مش الشبكة —
 * الفرق إن البيئة بتمرر الترافيك على بروكسي بيعيد التوقيع بشهادة جذر خاصة
 * (`/usr/local/share/ca-certificates/e2b-ca.crt`)، و`curl` بيقراها من حزمة
 * النظام بينما **Node مابيقراهاش** — بيقرا الحزمة المدمجة اللي جواه.
 *
 * النتيجة قبل الإصلاح: كل تنزيل في البرنامج كان بيفشل ويقول «api.github.com
 * ماردّش (rate limit أو مفيش خروج من هنا)» — تشخيص في اتجاه غلط تمامًا،
 * والاتصال شغّال. والأسوأ إن الإصلاح كان موجود في الكود سطر واحد بس: حد
 * يكتب `NODE_EXTRA_CA_CERTS=...` في بيئة السيرفر. حدّ ما يعرف.
 *
 * اللي هنا بيعمل كده لوحده: بيقرا شهادات الجذر اللي النظام بيثق فيها
 * (`/usr/local/share/ca-certificates/` و`/etc/ssl/certs/`)، بيركّب حزمة
 * واحدة، وبيحمّلها في Node **قبل** أي طلب شبكة. مافيش تعديل على النظام
 * ومافيش تعطيل للتحقق (`rejectUnauthorized: false` ممنوع هنا — إحنا بنضيف
 * ثقة النظام، مش بنشيل الثقة).
 *
 * آمن على أي بيئة: لو مفيش شهادة إضافية أو الحزمة زي ما هي، مابيعملش حاجة.
 */
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { config as loadEnv } from "dotenv";

/** المجلدات اللي بيحطها النظام/البروكسي — الترتيب مش مهم، إحنا بنضمّهم. */
const SYSTEM_CA_DIRS = [
  "/usr/local/share/ca-certificates",
  "/etc/ssl/certs",
];

/** حزم النظام الجاهزة (واحدة منهم بتتعارض مع `/etc/ssl/certs` فبنستخدم الملف لو موجود). */
const SYSTEM_BUNDLES = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/cert.pem",
];

const OUT = "/tmp/nova-ca-bundle.pem";

export interface TlsTrustResult {
  /** عدد الشهادات اللي اتضافت فوق حزمة Node */
  added: number;
  /** الحزمة اللي اتبنت — null لو مافيش حاجة تتضاف */
  bundle: string | null;
  /** مصادر الشهادات المقروءة */
  sources: string[];
  /** سبب التخطّي، لو اتخطّى */
  skipped?: string;
}

function readPemBlocks(file: string): string[] {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  } catch {
    return [];
  }
}

/** بصمة الشهادة — للمقارنة والتكرار من غير ما نقارن نصوص كاملة. */
function fingerprint(pem: string): string | null {
  try {
    return new X509Certificate(pem).fingerprint256;
  } catch {
    return null; // ملف مش شهادة (مفتاح، تعليق، تالف) — بيتشال
  }
}

/**
 * يبني حزمة CA بتضم شهادات النظام + شهادات البروكسي، ويخلي Node يستخدمها.
 * لازم تتنادى **قبل** أول `fetch` — عشان كده بتتنادى في أول سطر من index.ts.
 */
export function ensureTlsTrust(opts: { quiet?: boolean } = {}): TlsTrustResult {
  const log = (m: string) => {
    if (!opts.quiet) console.log(`[tls] ${m}`);
  };

  // المستخدم حدّد حزمة بنفسه؟ سيبها — إحنا بنكمّل، مش بننافس.
  const explicit = String(process.env.NODE_EXTRA_CA_CERTS || "").trim();
  if (explicit && fs.existsSync(explicit)) {
    return { added: 0, bundle: explicit, sources: [explicit], skipped: "NODE_EXTRA_CA_CERTS مضبوط بالفعل" };
  }

  const seen = new Set<string>();
  const certs: string[] = [];
  const sources: string[] = [];

  // 1) حزمة النظام أولًا (هي اللي فيها الجذور العامة)
  for (const b of SYSTEM_BUNDLES) {
    if (!fs.existsSync(b)) continue;
    for (const pem of readPemBlocks(b)) {
      const fp = fingerprint(pem);
      if (fp && !seen.has(fp)) {
        seen.add(fp);
        certs.push(pem);
      }
    }
    sources.push(b);
    break; // أول حزمة موجودة تكفي — الباقي نسخ
  }

  // 2) شهادات إضافية: البروكسي/الشركة/الساندبوكس
  let extra = 0;
  for (const dir of SYSTEM_CA_DIRS) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir).filter((f) => /\.(crt|pem|cer)$/i.test(f));
    } catch {
      continue;
    }
    for (const f of entries) {
      const full = path.join(dir, f);
      // `/etc/ssl/certs` فيه روابط رمزية لكل شهادة في الحزمة — تكرار محض.
      // بناخده بس لو الحزمة نفسها مش موجودة (توزيعة غير Debian).
      if (dir === "/etc/ssl/certs" && sources.length > 0) continue;
      for (const pem of readPemBlocks(full)) {
        const fp = fingerprint(pem);
        if (fp && !seen.has(fp)) {
          seen.add(fp);
          certs.push(pem);
          extra += 1;
          if (!sources.includes(full)) sources.push(full);
        }
      }
    }
  }

  if (certs.length === 0) {
    return { added: 0, bundle: null, sources, skipped: "مفيش شهادة إضافية فوق حزمة Node" };
  }

  try {
    const tlsAny = tls as unknown as {
      getCACertificates?: (type?: string) => string[];
      setDefaultCACertificates?: (certs: string[]) => void;
    };
    if (typeof tlsAny.getCACertificates === "function" && typeof tlsAny.setDefaultCACertificates === "function") {
      const base = tlsAny.getCACertificates("default");
      const baseSet = new Set(base);
      const runtimeExtra: string[] = [];
      for (const c of certs) {
        if (!baseSet.has(c)) {
          baseSet.add(c);
          runtimeExtra.push(c);
        }
      }
      if (runtimeExtra.length > 0) {
        tlsAny.setDefaultCACertificates([...base, ...runtimeExtra]);
        extra = Math.max(extra, runtimeExtra.length);
      }
    }
  } catch {
    /* ignore */
  }

  if (extra === 0) {
    return { added: 0, bundle: null, sources, skipped: "مفيش شهادة إضافية فوق حزمة Node" };
  }

  try {
    fs.writeFileSync(OUT, certs.join("\n") + "\n", { mode: 0o644 });
  } catch (e) {
    return { added: 0, bundle: null, sources, skipped: `مش قادر يكتب الحزمة: ${(e as Error).message}` };
  }

  // `NODE_EXTRA_CA_CERTS` بتتقرا مرة واحدة عند أول استخدام لـTLS — بعد أول
  // fetch مابينفعش. عشان كده بنتنادى بدري جدًا في index.ts.
  process.env.NODE_EXTRA_CA_CERTS = OUT;
  log(`${extra} شهادة إضافية اتحمّلت من ${sources.length} مصدر → ${OUT}`);
  return { added: extra, bundle: OUT, sources };
}

/** حالة القراءة بدون تنفيذ — للعرض في /api/ops/version أو التشخيص. */
export function tlsTrustStatus(): { extraCaEnv: string | null; bundleExists: boolean; systemSources: string[] } {
  const env = String(process.env.NODE_EXTRA_CA_CERTS || "").trim() || null;
  return {
    extraCaEnv: env,
    bundleExists: env ? fs.existsSync(env) : false,
    systemSources: [...SYSTEM_BUNDLES, ...SYSTEM_CA_DIRS].filter((p) => fs.existsSync(p)),
  };
}

/* ── التنفيذ عند التحميل ────────────────────────────────────────────────────
 * مش `ensureTlsTrust()` في index.ts: الـimports في ESM بتتنفّذ كلها قبل أي
 * سطر في الملف المستضيف، فأي `fetch` في وقت تحميل موديول تاني كان هيسبق
 * الإصلاح. الحل إن الإصلاح نفسه يبقى side effect على مستوى الموديول،
 * والموديول ده يتستورد **أول** حاجة في index.ts.
 *
 * dotenv هنا لأن `NODE_EXTRA_CA_CERTS` ممكن يكون متحدّد في `.env` — ولو
 * اتحدّد، `ensureTlsTrust` بتحترمه وبتخرج.
 */
export const tlsTrustAtBoot: TlsTrustResult = (() => {
  try {
    loadEnv({ override: false }); // بيحترم اللي متحدّد في البيئة الأصلية
  } catch {
    /* dotenv مش موجود؟ مفيش مشكلة، بنقرا process.env زي ما هو */
  }
  try {
    return ensureTlsTrust();
  } catch (e) {
    // فشل الإصلاح مايوقفش التطبيق — بس يتسجل، عشان يبان في التشخيص.
    console.error(`[tls] تعذّر تجهيز حزمة الشهادات: ${(e as Error).message}`);
    return { added: 0, bundle: null, sources: [], skipped: "استثناء" };
  }
})();
