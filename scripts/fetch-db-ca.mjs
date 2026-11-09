#!/usr/bin/env node
/**
 * fetch-db-ca — يطلّع شهادة الجذر من سلسلة TLS بتاعة DATABASE_URL
 * جاهزة للصق سطر واحد في NOVA_DB_CA (base64).
 *
 * ليه هنا؟ سلسلة شهادات Neon بتتقرأ من المضيف نفسه (openssl s_client على
 * وصلت 5432) — مش من صفحة ويب. شغّله من أي مكان عنده net:: هتحتاج الـ
 * DATABASE_URL في البيئة (متجيليش أنا — بيقراها من process.env هنا).
 *   node scripts/fetch-db-ca.mjs
 */
import { execFileSync } from "node:child_process";
import tls from "node:tls";

const raw = process.env.DATABASE_URL || "";
if (!raw) { console.error("اعمل export DATABASE_URL الأول"); process.exit(2); }
const u = new URL(raw);
const host = u.hostname, port = Number(u.port || 5432);

/**
 * Postgres مش بيتكلم TLS على طول: العميل بيفتح TCP عادي وبيبعت رسالة SSLRequest
 * (8 بايت، الكود 80877103) — السيرفر يرد 'S' (نبدأ التشفير) أو 'N' (نص صافي).
 * الخطأ «wrong version number» (مقاس 2026-11-09 على pooler Supabase) هو بالظبط
 * ما يحصل لو عملت tls.connect مباشرة: رد بروتوكول Postgres النصي بيتقري كأنه
 * سجل TLS. فبنعمل الرقصة الصح هنا — زي libpq بالظبط.
 */
import net from "node:net";

const SSL_REQUEST_CODE = 80877103;

function openPgTls({ host, port, timeoutMs = 12_000 }) {
  return new Promise((resolve, reject) => {
    const tcp = net.connect({ host, port });
    const kill = (e) => { try { tcp.destroy(); } catch { /* ok */ } reject(e); };
    const timeout = setTimeout(() => kill(new Error("timeout — المضيف مش واصل")), timeoutMs);
    tcp.once("error", kill);
    tcp.once("connect", () => {
      const req = Buffer.alloc(8);
      req.writeUInt32BE(8, 0);
      req.writeUInt32BE(SSL_REQUEST_CODE, 4);
      tcp.write(req);
    });
    tcp.once("data", (d) => {
      if (d[0] === 0x4e /* 'N' */) { clearTimeout(timeout); return kill(new Error("السيرفر رفض SSL (رد بـ N)")); }
      if (d[0] !== 0x53 /* 'S' */) { clearTimeout(timeout); return kill(new Error(`رد SSLRequest مش مفهوم: 0x${d[0]?.toString(16)}`)); }
      // 'S' → نرقّي نفس السوكيت لـ TLS
      const t = tls.connect({ socket: tcp, servername: host, rejectUnauthorized: false }, () => {
        clearTimeout(timeout);
        resolve(t);
      });
      t.once("error", kill);
    });
  });
}

let pem = "";
try {
  const sock = await openPgTls({ host, port });
  await new Promise((resolve, reject) => {
    try {
      const chain = [];
      let c = sock.getPeerCertificate(true);
      while (c) {
        if (c.raw) chain.push(Buffer.from(c.raw).toString("base64"));
        c = c.issuerCertificate;
        if (c && chain.includes(Buffer.from(c.raw || "").toString("base64"))) break;
      }
      if (!chain.length) throw new Error("السلسلة فاضية");
      const rootB64 = chain[chain.length - 1];
      pem = `-----BEGIN CERTIFICATE-----\n${rootB64.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
      sock.end(); resolve();
    } catch (e) { sock.end(); reject(e); }
  });
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
// ── أوضاع الإخراج ──────────────────────────────────────────────────────────
// (بدون أعلام)         يطبع سطور env الجاهزة للّصق اليدوي (السلوك الأصلي).
// --write <pem-path>   يكتب الـPEM في ملف (workflow db-ca-sync بيستخدمه).
// --emit-ts <ts-path>  يعيد توليد lib/db/src/db-bundled-ca.ts بالشهادة مضمّنة —
//                      الحزمة بتحملها بعد كده، فـ strict يشتغل بلا أي env على
//                      الإطلاق (الشهادة بيانات عامة، مش سر).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const writeTo = flagValue("--write");
if (writeTo) {
  mkdirSync(dirname(writeTo), { recursive: true });
  writeFileSync(writeTo, pem);
  console.log(`✔ اتكتب ${writeTo} (${pem.length} بايت)`);
}

const emitTs = flagValue("--emit-ts");
if (emitTs) {
  // الـPEM ملوش علاقة بالباك-تيك — concatenation أأمن من template جوه template.
  const ts = "/**\n"
    + " * db-bundled-ca · شهادة الجذر المثبّتة داخل الحزمة (Pinned CA)\n"
    + " * ⚠️ متولّد آليًا بواسطة db-ca-sync (fetch-db-ca.mjs --emit-ts) — متعدّلوش بإيدك.\n"
    + " * البيانات عامة: نفس الشهادة اللي بيتسلمها أي عميل TLS من السيرفر عند الوصل.\n"
    + " */\n"
    + "export const BUNDLED_DB_CA_PEM = `\n" + pem + "`;\n";
  mkdirSync(dirname(emitTs), { recursive: true });
  writeFileSync(emitTs, ts);
  console.log(`✔ اتولّد ${emitTs} (${ts.length} بايت)`);
}

if (!writeTo && !emitTs) {
  console.log("# طبّع والصق السطرين دول في env بتاع السيرفر بالظبط:");
  console.log(`NOVA_DB_SSL=strict`);
  console.log(`NOVA_DB_CA=${Buffer.from(pem, "utf8").toString("base64")}`);
}
