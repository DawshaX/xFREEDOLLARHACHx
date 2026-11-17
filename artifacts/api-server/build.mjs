import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);

/* ── ثقة TLS قبل أي موديول بيعمل fetch ─────────────────────────────────────
 *  esbuild بيحط الموديولات بترتيب التبعية، فأي side effect جوه ملف عادي
 *  بيبقى **بعد** الموديولات اللي بتعمل اتصال في وقت التحميل — مقاس 2026-11-17:
 *  الموديول اتحط في سطر 108,722 من 108,800، يعني الإصلاح كان بيشتغل بعد
 *  فوات الأوان. الـbanner هو المكان الوحيد اللي بيتنفّذ قبل كل حاجة في الـESM.
 *
 *  اللي بيعمله: لو البيئة فيها بروكسي بيعيد توقيع TLS بشهادة جذر في
 *  /usr/local/share/ca-certificates، Node بيرمي UNABLE_TO_VERIFY_LEAF_SIGNATURE
 *  بينما curl بيوصل — فيفشل كل تنزيل في البرنامج برسالة مضللة. هنا بنضم
 *  شهادات النظام لحزمة Node ومابنعطّلش التحقق أبدًا. آمن على أي بيئة:
 *  مافيش شهادة إضافية ⇒ مافيش حاجة بتحصل. */
try {
  const __fs = globalThis.require("node:fs");
  const __path = globalThis.require("node:path");
  const __crypto = globalThis.require("node:crypto");
  if (!process.env.NODE_EXTRA_CA_CERTS) {
    const seen = new Set(); const pems = []; const srcs = [];
    for (const b of ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem"]) {
      if (!__fs.existsSync(b)) continue;
      const raw = __fs.readFileSync(b, "utf8");
      for (const m of raw.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/g) || []) {
        try { const fp = new __crypto.X509Certificate(m).fingerprint256; if (!seen.has(fp)) { seen.add(fp); pems.push(m); } } catch {}
      }
      srcs.push(b); break;
    }
    let added = 0;
    for (const d of ["/usr/local/share/ca-certificates"]) {
      let list = [];
      try { list = __fs.readdirSync(d).filter((x) => /[.](crt|pem|cer)$/i.test(x)); } catch { continue; }
      for (const file of list) {
        try {
          const raw = __fs.readFileSync(__path.join(d, file), "utf8");
          for (const m of raw.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/g) || []) {
            try {
              const fp = new __crypto.X509Certificate(m).fingerprint256;
              if (!seen.has(fp)) { seen.add(fp); pems.push(m); added++; srcs.push(__path.join(d, file)); }
            } catch {}
          }
        } catch {}
      }
    }
    /* ⚠ الشرط مش added > 0: مقاس 2026-11-17 — شهادة البروكسي (e2b-ca) موجودة
     * جوه حزمة النظام أصلًا، فعدّاد «الإضافي» طلع صفر والحزمة ما اتكتبتش أبدًا،
     * والـfetch فضل يفشل. القرار الصح: **طول ما في حزمة نظام مقروءة** بنكتبها
     * ونحمّلها — لأن Node مابيقراش حزمة النظام أصلًا، بيقرا اللي جواه. كتابة
     * حزمة مطابقة مش ضارة؛ اللي ضار إن Node يفضل أعمى عن شهادة النظام. */
    /* ★ الإصلاح الحقيقي (مقاس 2026-11-17 16:5xZ): NODE_EXTRA_CA_CERTS بيتقرأ
     * **وقت إقلاع Node** بس — فحتى لو الـbanner كتب الحزمة وحدّد المتغير،
     * fetch اللي بيتبني بعد كده بيفضل أعمى عنها. الحل الجذري المتاح في Node 22:
     * tls.setDefaultCACertificates() بيغيّر حزمة الثقة **وقت التشغيل**،
     * وfetch بيمشي عليه. اتقاس: default 145 → بعد الإضافة 146 → FETCH OK 200.
     * مابنعطّلش التحقق أبدًا — بنضمّ شهادة النظام، مش بنشيل التحقق. */
    try {
      const __tls = globalThis.require("node:tls");
      const __extra = [];
      for (const c of pems) {
        const base = new Set(__tls.getCACertificates("default"));
        if (!base.has(c)) { base.add(c); __extra.push(c); }
      }
      if (__extra.length && typeof __tls.setDefaultCACertificates === "function") {
        const base = __tls.getCACertificates("default");
        __tls.setDefaultCACertificates([...base, ...__extra]);
        console.log("[tls] حزمة الثقة وقت التشغيل: " + base.length + " → " + __tls.getCACertificates("default").length + " شهادة");
      }
    } catch (e) { console.error("[tls] runtime trust: " + (e && e.message ? e.message : e)); }
    if (pems.length > 0) {
      const out = "/tmp/nova-ca-bundle.pem";
      __fs.writeFileSync(out, pems.join(String.fromCharCode(10)) + String.fromCharCode(10), { mode: 0o644 });
      process.env.NODE_EXTRA_CA_CERTS = out;
      console.log("[tls] حزمة الشهادات اتبنت: " + pems.length + " شهادة (" + added + " إضافية فوق حزمة النظام) → " + out);
    }
  }
} catch (e) { console.error("[tls] " + (e && e.message ? e.message : e)); }
    `,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
