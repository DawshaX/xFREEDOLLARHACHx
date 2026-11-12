#!/usr/bin/env node
/**
 * test-fetch-db-ca-handshake — السكربت بيتكلم بروتوكول Postgres الصح:
 * SSLRequest → 'S' → ترقية نفس السوكيت لـTLS. (السلسلة المقاسة القديمة كانت
 * bitls.connect مباشرة — و«wrong version number» على pooler Supabase فضحها.)
 * تست سلبي كمان: سيرفر بيرد 'N' لازم يفشل بصراحة.
 * يولّد شهادة اختبارية بـopenssl لو مش موجودة — محلي بالكامل.
 */
import net from "node:net";
import tls from "node:tls";
import { execFileSync, execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "/tmp/fetch-db-ca-test-key.pem";
const CERT = "/tmp/fetch-db-ca-test-cert.pem";

if (!existsSync(KEY) || !existsSync(CERT)) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", KEY, "-out", CERT,
    "-days", "1", "-nodes", "-subj", "/CN=pg-handler.test"], { stdio: "pipe" });
}
const key = readFileSync(KEY);
const cert = readFileSync(CERT);

/** سيرفر Postgres زائف: يتكلم SSLRequest ثم يرقّي، أو يرفض بـ N. */
function fakePg(mode /* "S" | "N" */) {
  return net.createServer((sock) => {
    sock.once("error", () => {});
    sock.once("data", (d) => {
      try {
        if (d.length === 8 && d.readUInt32BE(4) === 80877103) {
          if (mode === "N") { sock.write("N"); return; }
          sock.write("S");
          const t = new tls.TLSSocket(sock, { isServer: true, key, cert });
          t.on("secure", () => setTimeout(() => t.destroy(), 50));
          t.on("error", () => {});
        } else {
          sock.destroy();
        }
      } catch { sock.destroy(); }
    });
  });
}

function runScript(port, extra = []) {
  return new Promise((res) => {
    execFile("node", ["scripts/fetch-db-ca.mjs", ...extra], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: `postgres://u:p@127.0.0.1:${port}/db` },
    }, (err, stdout, stderr) => res({ code: err ? err.code ?? 1 : 0, stdout, stderr }));
  });
}

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(["✓", name]); }
  catch (e) { results.push(["✗", `${name}: ${e.message}`]); }
}

await t("مصافحة SSLRequest صحيحة → PEM وملف TS مضمّن يتكتبوا", async () => {
  const srv = fakePg("S");
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const pemPath = `/tmp/fetch-db-ca-test-out-${process.pid}.pem`;
  const tsPath = `/tmp/fetch-db-ca-test-out-${process.pid}.ts`;
  const r = await runScript(port, ["--write", pemPath, "--emit-ts", tsPath]);
  srv.close();
  assert.equal(r.code, 0, `exit 0 متوقع — stderr: ${r.stderr}`);
  const pem = readFileSync(pemPath, "utf8");
  assert.match(pem, /-----BEGIN CERTIFICATE-----/);
  const live = readFileSync(CERT, "utf8").trim();
  assert.equal(pem.trim(), live, "الشهادة المقروءة من السلسلة = شهادة السيرفر بالظبط");
  const ts = readFileSync(tsPath, "utf8");
  assert.match(ts, /BUNDLED_DB_CA_PEM = `/);
  assert.match(ts, /BEGIN CERTIFICATE/);
  rmSync(pemPath); rmSync(tsPath);
});

await t("رد 'N' = فشل صريح برسالة عربية واضحة", async () => {
  const srv = fakePg("N");
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const r = await runScript(port);
  srv.close();
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /رفض SSL/);
});

await t("مضيف مش واصل → خطأ timeout/conn مش كسر صامت", async () => {
  const r = await runScript(1); // بورت ميت
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /✗/);
});

for (const [s, n] of results) console.log(`${s} ${n}`);
const failed = results.filter(([s]) => s === "✗");
console.log(`\ntest-fetch-db-ca-handshake: ${results.length - failed.length}/${results.length} ${failed.length ? "✗" : "✓"}`);
process.exit(failed.length ? 1 : 0);
