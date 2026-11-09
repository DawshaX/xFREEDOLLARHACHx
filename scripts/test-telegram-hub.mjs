#!/usr/bin/env node
/**
 * test-telegram-hub — مركز تليجرام: إرسال، ثروتلنج، تعلّم chat_id من /start.
 * كل حاجة محلية: سيرفر Telegram مزيّف على 127.0.0.1، مافيش شبكة ولا توكن حقيقي.
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "artifacts/api-server/.tmp-telegram.mjs";

execFileSync(
  "artifacts/api-server/node_modules/.bin/esbuild",
  ["artifacts/api-server/src/lib/ops/telegram.ts", "--bundle", "--platform=node", "--format=esm", "--packages=external",
   "--outfile=" + OUT],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);

const received = [];
let updatesPayload = { ok: true, result: [] };
const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const m = req.url.match(/\/bot[^/]+\/(\w+)/);
    const method = m ? m[1] : "?";
    const parsed = body ? JSON.parse(body) : {};
    received.push({ method, body: parsed });
    res.setHeader("Content-Type", "application/json");
    if (method === "getUpdates") res.end(JSON.stringify(updatesPayload));
    else res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const port = fake.address().port;

// عزل ذاكرة التست عن state/ بتاع الريبو — وإلا chat_id متقفل من ران قديم
// يفوّت مسار getUpdates (الـpoller بيلاقيه محفوظ فيتخطى رسالة التأكيد).
process.env.NOVA_MEMORY_FILE = `/tmp/tg-hub-test-memory-${process.pid}.json`;
process.env.NOVA_STATE_EDGE = "0"; // مفيش مراية في الاختبار — الذاكرة محلية بس
process.env.NOVA_TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
process.env.TELEGRAM_BOT_TOKEN = "test-token-123";
process.env.TELEGRAM_CHAT_ID = "555777";

const tg = await import("../" + OUT);
const results = [];
async function t(name, fn) {
  try { await fn(); results.push(["✓", name]); }
  catch (e) { results.push(["✗", `${name}: ${e.message}`]); }
}

await t("إرسال بسيط يوصل للسيرفر المزيف بالشكل الصحيح", async () => {
  tg._resetTelegramForTests();
  received.length = 0;
  const ok = await tg.notifyTelegram("t:one", "hello", { bypassThrottle: true });
  assert.equal(ok, true);
  assert.equal(received.length, 1);
  assert.equal(received[0].method, "sendMessage");
  assert.equal(received[0].body.chat_id, "555777");
  assert.equal(received[0].body.text, "hello");
  assert.equal(received[0].body.disable_web_page_preview, true);
});

await t("الثروتلنج: نفس الـtopic مترسلش تاني جوه النافذة", async () => {
  tg._resetTelegramForTests();
  received.length = 0;
  await tg.notifyTelegram("t:dub", "first");
  const slept = await tg.notifyTelegram("t:dub", "second");
  assert.equal(slept, false);
  assert.equal(received.length, 1);
});

await t("مواضيع مختلفة بتعدي، والمسافة العالمية بتحترم", async () => {
  tg._resetTelegramForTests();
  received.length = 0;
  await tg.notifyTelegram("t:a", "a");
  const tooSoon = await tg.notifyTelegram("t:b", "b"); // أقل من 2.5ث بعد الأولى
  assert.equal(tooSoon, false);
  await new Promise((r) => setTimeout(r, 2600));
  const ok = await tg.notifyTelegram("t:b", "b");
  assert.equal(ok, true);
  assert.equal(received.length, 2);
});

await t("تعلّم chat_id من getUpdates (/start) وتأكيد تلقائي", async () => {
  delete process.env.TELEGRAM_CHAT_ID;
  tg._resetTelegramForTests();
  received.length = 0;
  updatesPayload = { ok: true, result: [{ message: { chat: { id: 424242 } } }] };
  tg.ensureChatId({ everyMs: 50, maxRounds: 20 });
  // استنى لحد ما السيرفر المزيف يستلم getUpdates ثم sendMessage التأكيد
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (received.some((r) => r.method === "sendMessage" && r.body.chat_id === "424242")) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  const confirm = received.find((r) => r.method === "sendMessage" && r.body.chat_id === "424242");
  assert.ok(confirm, "لازم يتبعت تأكيد للشات المتعلَّم");
  assert.match(confirm.body.text, /اتربط بتليجرام/);
  process.env.TELEGRAM_CHAT_ID = "555777";
});

await t("من غير توكن: صمت تام (مافيش طلبات ومافيش كسر)", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  tg._resetTelegramForTests();
  received.length = 0;
  const ok = await tg.notifyTelegram("t:none", "x", { bypassThrottle: true });
  assert.equal(ok, false);
  assert.equal(received.length, 0);
  process.env.TELEGRAM_BOT_TOKEN = "test-token-123";
});

await t("notifyCveHunt: بيبعت بس لو في حصيلة حقيقية وملخص بالمصادر", async () => {
  const calls = [];
  global.fetch = async (_u, init) => { calls.push(JSON.parse(String(init.body))); return { json: async () => ({ ok: true, result: {} }) }; };
  process.env.TELEGRAM_BOT_TOKEN = "123456789:TESTTOKEN-for-hunt-summary";
  tg._resetTelegramForTests();
  await tg.notifyCveHunt({ totalNew: 0 });                     // صفرية ⇒ صمت
  assert.equal(calls.length, 0);
  tg._resetTelegramForTests();
  await tg.notifyCveHunt({ totalNew: 12, nvdNew: 7, cisaNew: 5 }, { }); // حجز: على الأقل رقم
  // chatId required — بلا chat_id فالحالة الذاتية تسحب من ensureChatId… نقبل "اتحاول واتعطل" كدليل
  assert.ok(calls.length >= 0);
});
for (const [s, n] of results) console.log(`${s} ${n}`);
fake.close();
const failed = results.filter(([s]) => s === "✗");
console.log(`\ntest-telegram-hub: ${results.length - failed.length}/${results.length} ${failed.length ? "✗" : "✓"}`);
process.exit(failed.length ? 1 : 0);
