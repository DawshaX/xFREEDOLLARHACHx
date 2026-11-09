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

let pem = "";
try { // نقرأ السلسلة مباشرة بـ Node — بلا openssl ولا netcat
  await new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false, servername: host, timeout: 12_000 }, () => {
      try {
        const chain = [];
        let c = sock.getPeerCertificate(true);
        while (c) { if (c.raw) chain.push(Buffer.from(c.raw).toString("base64")); c = c.issuerCertificate; if (c && chain.includes(Buffer.from(c.raw || "").toString("base64"))) break; }
        if (!chain.length) throw new Error("السلسلة فاضية");
        const rootB64 = chain[chain.length - 1];
        pem = `-----BEGIN CERTIFICATE-----\n${rootB64.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
        sock.end(); resolve();
      } catch (e) { sock.end(); reject(e); }
    });
    sock.on("timeout", () => { sock.destroy(); reject(new Error("timeout — المضيف مش واصل")); });
    sock.on("error", reject);
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
