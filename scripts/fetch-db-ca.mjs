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
console.log("# طبّع والصق السطرين دول في env بتاع السيرفر بالظبط:");
console.log(`NOVA_DB_SSL=strict`);
console.log(`NOVA_DB_CA=${Buffer.from(pem, "utf8").toString("base64")}`);
