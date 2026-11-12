#!/usr/bin/env node
/**
 * test-fetch-auth-patch — شبكة أمان الواجهة: أي fetch خام لـ/api نفس الأصل
 * يركّب x-nova-token تلقائيًا؛ العابر للأصل لا يُلمس؛ الهيدر الموجود يفضل الغلبان.
 * بيئة متصفح زائفة (localStorage/location) فوق Node — مافيش jsdom.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "artifacts/kali-panel/.tmp-ops-client.mjs";
execFileSync(
  "artifacts/api-server/node_modules/.bin/esbuild",
  ["artifacts/kali-panel/src/lib/ops-client.ts", "--bundle", "--platform=browser", "--format=esm", "--outfile=" + OUT],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);

// ── بيئة متصفح زائفة ──
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { origin: "https://nova.waifly.com" };

// fetch بيسجل بدل ما يبعت فعلًا
const calls = [];
globalThis.fetch = (url, init) => {
  const h = new Headers(init?.headers);
  calls.push({ url: String(url), token: h.get("x-nova-token") });
  return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
};

const mod = await import("../" + OUT);
const results = [];
const t = (name, fn) => {
  try { fn(); results.push(["✓", name]); } catch (e) { results.push(["✗", `${name}: ${e.message}`]); }
};

t("الرقعة اتنصّبت من الاستيراد (no manual call)", () => {
  assert.notEqual(globalThis.fetch.name, "fetch", "fetch اتلفّ");
});

t("توكن محفوظ + /api نفس الأصل → الهيدر بيتركّب", async () => {
  mod.setOpsToken("tok-abc");
  calls.length = 0;
  await fetch("/api/cve/hunt/trigger", { method: "POST" });
  assert.equal(calls[0].token, "tok-abc");
});

t("هيدر موجود من المتعامل يفضل هو الغلبان", async () => {
  calls.length = 0;
  await fetch("/api/x", { method: "POST", headers: { "x-nova-token": "mine" } });
  assert.equal(calls[0].token, "mine");
});

t("نطاق تاني: التوكن عمره ما يتسرّب", async () => {
  calls.length = 0;
  await fetch("https://evil.example.com/api/steal", { method: "POST" });
  assert.equal(calls[0].token, null);
});

t("من غير توكن محفوظ: مافيش هيدر (مسارات القراءة مفتوحة أصلًا)", async () => {
  mod.setOpsToken("");
  calls.length = 0;
  await fetch("/api/health");
  assert.equal(calls[0].token, null);
});

t("Headers object من المتعامل بيتحترم", async () => {
  mod.setOpsToken("tok-xyz");
  calls.length = 0;
  await fetch("/api/y", { method: "POST", headers: new Headers({ "Content-Type": "application/json" }) });
  assert.equal(calls[0].token, "tok-xyz");
});

t("مسار مش /api مش بيتلمس", async () => {
  calls.length = 0;
  await fetch("/assets/index.js");
  assert.equal(calls[0].token, null);
});

for (const [s, n] of results) console.log(`${s} ${n}`);
try { rmSync(OUT); rmSync("artifacts/kali-panel/.tmp-ops-client.mjs"); } catch { /* ok */ }
const failed = results.filter(([s]) => s === "✗");
console.log(`\ntest-fetch-auth-patch: ${results.length - failed.length}/${results.length} ${failed.length ? "✗" : "✓"}`);
process.exit(failed.length ? 1 : 0);
