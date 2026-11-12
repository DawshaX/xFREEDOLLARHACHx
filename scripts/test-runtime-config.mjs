#!/usr/bin/env node
/**
 * test-runtime-config — قناة الضبط الدائمة:
 *  · قائمة مقفولة (مفتاح غريب يرفض بسبب عربي)
 *  · التحقق الشكلي يمسك التوكنات المكسورة
 *  · الحالة بترجع boolean بس — القيمة ممنوع تتسرّب في أي رد
 *  · المسح بقيمة فاضية بيشتغل
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "artifacts/api-server/.tmp-cfg.mjs";
process.env.NOVA_MEMORY_FILE = `/tmp/runtime-cfg-test-${process.pid}.json`;
process.env.NOVA_STATE_EDGE = "0";

execFileSync(
  "artifacts/api-server/node_modules/.bin/esbuild",
  ["artifacts/api-server/src/lib/ops/runtime-config.ts", "--bundle", "--platform=node", "--format=esm",
   "--packages=external", "--outfile=" + OUT],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);
const cfg = await import("../" + OUT);
const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push(["✓", name]); } catch (e) { results.push(["✗", `${name}: ${e.message}`]); }
};

await t("مفتاح غريب يرفض بالسبب والمسموح معلن", async () => {
  cfg._resetRuntimeConfigForTests();
  const r = await cfg.setRuntimeConfig("evil.cmd", "rm -rf /");
  assert.equal(r.ok, false);
  assert.match(r.reasonAr, /مش مسموح/);
});

await t("توكن تليجرام سليم يتقبل، المكسور يرفض", async () => {
  cfg._resetRuntimeConfigForTests();
  const good = await cfg.setRuntimeConfig("telegram.botToken", "123456789:AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHII"); // allow-secret-literal — توكن تست ملفوظ مش حقيقي
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(cfg.getRuntimeConfig("telegram.botToken"), "123456789:AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHII"); // allow-secret-literal
  const bad = await cfg.setRuntimeConfig("telegram.botToken", "short");
  assert.equal(bad.ok, false);
  // الرفض مش بيمسح القيمة القديمة
  assert.ok(cfg.getRuntimeConfig("telegram.botToken").length > 10);
});

await t("الحالة boolean صرف — القيمة مش في أي رد", async () => {
  cfg._resetRuntimeConfigForTests();
  await cfg.setRuntimeConfig("shodan.apiKey", "abcdefghijklmnop1234567890");
  const st = cfg.runtimeConfigStatus();
  assert.equal(st["shodan.apiKey"], true);
  const serialized = JSON.stringify(st) + JSON.stringify(cfg.ALLOWED_KEYS);
  assert.ok(!serialized.includes("abcdefghijklmnop"), "القيمة اتسربت في الحالة!");
});

await t("المسح بقيمة فاضية", async () => {
  cfg._resetRuntimeConfigForTests();
  await cfg.setRuntimeConfig("visitorAlerts", "1");
  assert.equal(cfg.getRuntimeConfig("visitorAlerts"), "1");
  await cfg.setRuntimeConfig("visitorAlerts", "");
  assert.equal(cfg.getRuntimeConfig("visitorAlerts"), "");
  assert.equal(cfg.runtimeConfigStatus()["visitorAlerts"], false);
});

await t("إعادة الإقلاع: الـhydrate بيقرا الذاكرة الدائمة", async () => {
  cfg._resetRuntimeConfigForTests();
  await cfg.setRuntimeConfig("telegram.chatId", "424242");
  cfg._resetRuntimeConfigForTests(); // يوهمنا إن العملية اتولدت من جديد
  assert.equal(cfg.getRuntimeConfig("telegram.chatId"), "");
  const h = await cfg.hydrateRuntimeConfig();
  assert.ok(h.hydrated >= 1);
  assert.equal(cfg.getRuntimeConfig("telegram.chatId"), "424242");
});

for (const [s, n] of results) console.log(`${s} ${n}`);
try { rmSync(OUT); } catch { /* ok */ }
const failed = results.filter(([s]) => s === "✗");
console.log(`\ntest-runtime-config: ${results.length - failed.length}/${results.length} ${failed.length ? "✗" : "✓"}`);
process.exit(failed.length ? 1 : 0);
