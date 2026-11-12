#!/usr/bin/env node
/**
 * test-tool-ondemand — يثبت «البرنامج كامل على كوتا صغيرة» من غير شبكة:
 *   1) أداة مش من ليستا VENDORABLE مرفوضة (ممنوع نرفع أي binary الدنيا فيه).
 *   2) أداة غايبة بتتجاب من المرآة أول ما تتطلب — عبر السكربت (هنا: ستاب).
 *   3) NOVA_TOOLCHAIN_ONDEMAND=0 يرجّع السلوك الصريح القديم (null).
 *   4) كاش LRU: فوق السقف → الأقدم استخدامًا يتمسح، والمطلوبة حاليًا والمانيفست
 *      والمانيفست يفضلوا عايشين، والكاش ينزل تحت السقف.
 *   5) طلبان متوازيان لنفس الأداة = تنزيل واحد بس (inflight memoization).
 *
 * بيستورد مصادر TS الحقيقية (نفس أسلوب ops-selftest: registerHooks + strip-types)
 * عشان الاختبار يقيس السلوك اللي شغّال فعلًا، مش نسخة معاد كتابتها.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let registerHooks = null;
try {
  ({ registerHooks } = await import("node:module"));
} catch { registerHooks = null; }

try {
  if (typeof registerHooks !== "function") throw new Error("registerHooks unavailable");
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
          for (const ext of [".ts", ".js", "/index.ts", "/index.js"]) {
            try { return next(specifier + ext, context); } catch { /* جرّب اللي بعده */ }
          }
        }
        throw err;
      }
    },
  });
} catch { /* لو مش متاح: الاستيراد هيفشل والاختبار يقولها بصراحة */ }

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const stripTypesSupported = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 6);
if (!stripTypesSupported) {
  console.log(`· test-tool-ondemand SKIPPED — needs Node >= 22.6 (running ${process.versions.node}); CI pins 22.`);
  process.exit(0);
}
if (!process.execArgv.some((a) => a.includes("experimental-strip-types")) && process.env.ONDEMAND_TEST_CHILD !== "1") {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", process.argv[1]],
    { stdio: "inherit", env: { ...process.env, ONDEMAND_TEST_CHILD: "1" } },
  );
  process.exit(r.status ?? 1);
}

// ── بيئة معزولة بالكامل قبل استيراد الوحدات ──────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-ondemand-"));
const vendor = path.join(tmp, "vendor");
fs.mkdirSync(vendor, { recursive: true });

const stub = path.join(tmp, "fetch-stub.mjs");
const counter = path.join(tmp, "count.txt");
fs.writeFileSync(stub, `import fs from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
const into = path.resolve(argv[argv.indexOf("--into") + 1]);
const only = argv[argv.indexOf("--only") + 1];
fs.mkdirSync(into, { recursive: true });
try { fs.writeFileSync(process.env.STUB_COUNTER, String(Number(fs.readFileSync(process.env.STUB_COUNTER, "utf8")) + 1)); }
catch { fs.writeFileSync(process.env.STUB_COUNTER, "1"); }
const size = Number(process.env.STUB_BYTES || 0);
const f = path.join(into, only);
fs.writeFileSync(f, Buffer.alloc(size, 1));
fs.chmodSync(f, 0o755);
console.log("stub installed", only);
`);

process.env.NOVA_VENDOR_BIN = vendor;
delete process.env.NOVA_TOOL_DIR;
process.env.NOVA_FETCH_TOOLCHAIN_SCRIPT = stub;
process.env.STUB_COUNTER = counter;
process.env.STUB_BYTES = "0";
// منع تسريب أي PATH حقيقي فيه أداة فعلية: الاختبار يدور على أسماء من ليستتنا
// بس، ولو المضيف عنده نسخة فـfindBinary هيقراها من PATH وفيه assert بيقيس ده.

const LIB = path.resolve(import.meta.dirname, "../artifacts/api-server/src/lib/ops");
const tools = await import(path.join(LIB, "tools.ts"));
const od = await import(path.join(LIB, "tool-ondemand.ts"));
const { VENDORABLE } = await import(path.join(LIB, "toolchain.ts"));

let passed = 0;
const t = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log("✓", name);
  } catch (err) {
    console.error("✗", name, "\n  ", err?.message || err);
    process.exitCode = 1;
  }
};
const count = () => { try { return Number(fs.readFileSync(counter, "utf8") || "0"); } catch { return 0; } };

// اختيار أبطال الاختبار: أداة vendorable مش موجودة على PATH بتاع المضيف.
const victim = VENDORABLE.find((b) => !tools.findBinary(b));
assert.ok(victim, "كل الأدوات موجودة على المضيف؟! الاختبار محتاج أداة غايبة");

await t("أداة مش في VENDORABLE مرفوضة من غير أي شبكة", async () => {
  const r = await od.ensureToolBinary("not-a-real-tool-xyz");
  assert.equal(r, null);
  assert.equal(count(), 0, "الستاب اتنفذ رغم إن الاسم مش في الليستا");
});

await t("NOVA_TOOLCHAIN_ONDEMAND=0 يرجّع null حالًا (سلوك صريح قديم)", async () => {
  process.env.NOVA_TOOLCHAIN_ONDEMAND = "0";
  const r = await od.ensureToolBinary(victim);
  assert.equal(r, null);
  assert.equal(count(), 0);
  delete process.env.NOVA_TOOLCHAIN_ONDEMAND;
});

await t("الأداة الغايبة بتتجاب عند الطلب وبترجع مسار قابل للتنفيذ", async () => {
  const before = count();
  const r = await od.ensureToolBinary(victim);
  assert.ok(r && r.includes(victim) && path.isAbsolute(r), "مسار رجع باسم الأداة");
  assert.equal(fs.existsSync(r), true);
  assert.equal(count(), before + 1, "تنزيل واحد بالظبط");
});

await t("تانية مرة: الكاش الموجب يجاوب من غير تنزيل", async () => {
  const before = count();
  const r = await od.ensureToolBinary(victim);
  assert.ok(r);
  assert.equal(count(), before, "مفيش تنزيل زيادة لأداة موجودة");
});

await t("طلبان متوازيان على أداة تانية = promise واحد وتنزيل واحد", async () => {
  const other = VENDORABLE.find((b) => b !== victim && !tools.findBinary(b));
  assert.ok(other, "محتاجين أداة تانية غايبة");
  const before = count();
  const [a, b] = await Promise.all([od.ensureToolBinary(other), od.ensureToolBinary(other)]);
  assert.ok(a && a === b);
  assert.equal(count(), before + 1, "inflight دمج الطلبين في تنزيل واحد");
});

await t("كاش LRU: الإخلاء ينزّل تحت السقف، يحافظ على المعفاة والمانيفست", async () => {
  // سقف ضئيل وتلات أدوات وزنها متدرّب — الأقدم atime هي اللي تطير الأول.
  process.env.NOVA_VENDOR_CACHE_MB = "0.6"; // ~629KB
  const names = VENDORABLE.filter((b) => ![victim].includes(b)).slice(0, 10);
  const filler = [];
  for (const [i, name] of names.entries()) {
    if (filler.length >= 3) break;
    if (name === victim) continue;
    const f = path.join(vendor, name);
    if (fs.existsSync(f)) continue;
    fs.writeFileSync(f, Buffer.alloc(300 * 1024, 7));
    fs.chmodSync(f, 0o755);
    const past = Date.now() - (10_000 - i * 1000); // أقدم → أول المسح
    fs.utimesSync(f, past / 1000, past / 1000);
    filler.push(name);
  }
  assert.ok(filler.length >= 3, "محتاجين 3 أدوات حشو للاختبار");
  fs.writeFileSync(path.join(vendor, ".vendored.json"), "{}");
  const removed = od.evictVendorCache(victim);
  assert.ok(removed >= 1, "اتمسح ولو أداة واحدة");
  const bytesNow = fs.readdirSync(vendor).reduce((sum, f) => { try { return sum + fs.statSync(path.join(vendor, f)).size; } catch { return sum; } }, 0);
  assert.ok(bytesNow <= 0.6 * 1048576 * 1.05, `الكاش نزل تحت السقف (فضل ${Math.round(bytesNow / 1024)}KB)`);
  assert.equal(fs.existsSync(path.join(vendor, victim)), true, "الأداة المعفاة عايشة");
  assert.equal(fs.existsSync(path.join(vendor, ".vendored.json")), true, "المانيفست مش ملف قابل للإخلاء");
  delete process.env.NOVA_VENDOR_CACHE_MB;
});

await t("سقف 0 = مفيش إخلاء خالص", async () => {
  process.env.NOVA_VENDOR_CACHE_MB = "0";
  const removed = od.evictVendorCache(victim);
  assert.equal(removed, 0);
  delete process.env.NOVA_VENDOR_CACHE_MB;
});

console.log(passed === 7 ? `✓ test-tool-ondemand: ${passed}/7` : `test-tool-ondemand: ${passed}/7 (فيه فشل فوق)`);
// الاستيراد بيشغّل تيمرات من الرسم البعيد (routes/local-agent) — نخرج صراحة.
process.exit(process.exitCode ?? 0);
