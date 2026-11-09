#!/usr/bin/env node
/**
 * test-state-prune — القرص مش وعاء بلا قاعة: السياسة معلنة ومقاسة.
 * بيجهز ديرة jobs وهمية at /tmp، يشغّل prune، ويتحقق:
 *  · الحديثة والفائضون تحت KEEP → باقيين
 *  · القديم فوق KEEP → اتمسح فعلًا
 *  · footprint أرقام مش اختراع
 *  · lastPrune بيسترجع السجل
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "artifacts/api-server/.tmp-prune.mjs";
const dir = mkdtempSync(join(tmpdir(), "nova-prune-"));
process.env.NOVA_STATE_ROOT = dir;
process.env.NOVA_STATE_KEEP_JOBS = "10";
process.env.NOVA_STATE_KEEP_DAYS = "7";
mkdirSync(join(dir, "state", "jobs"), { recursive: true });

const now = Date.now();
// ٣٠ ملف: ١٢ قديمة (>7d) + ١٨ جديدة
for (let i = 0; i < 30; i++) {
  const p = join(dir, "state", "jobs", `job-${String(i).padStart(2, "0")}.json`);
  writeFileSync(p, JSON.stringify({ i }));
  const ageMs = i < 12 ? now - 30 * 86400_000 : now - i * 60_000;
  utimesSync(p, ageMs / 1000, ageMs / 1000);
}

execFileSync("artifacts/api-server/node_modules/.bin/esbuild",
  ["artifacts/api-server/src/lib/ops/state-prune.ts", "--bundle", "--platform=node", "--format=esm",
   "--packages=external", "--outfile=" + OUT],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
const mod = await import("../" + OUT);
const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push(["✓", name]); } catch (e) { results.push(["✗", `${name}: ${e.message}`]); }
};

await t("prune: القديم اتمسح فعلًا والحديث باق", async () => {
  const r = mod.pruneState();
  // السياسة: نحتفظ بأحدث ١٠ + أي حديث (<7d). الـ12 القديمة كلها خارج KEEP ⇒ تتشال.
  assert.equal(r.removed, 12);
  assert.ok(r.freedBytes > 0);
  assert.equal(r.kept, 18);
});
await t("footprint: أرقام مضروبة من القرص مش ثابتة", async () => {
  const f = mod.measureStateFootprint();
  assert.equal(f.jobs.files, 18);
  assert.ok(f.jobs.bytes > 0);
  assert.equal(typeof f.vendorBinMB, "number");
});
await t("lastPrune: السجل بيفتكر", async () => {
  const l = mod.lastPrune();
  assert.ok(l && l.policy.keepJobs === 10 && l.policy.keepDays === 7);
});
await t("مجلد مش موجود = فاضي مش كسر", async () => {
  process.env.NOVA_STATE_ROOT = join(dir, "nonexistent-path");
  const f = mod.measureStateFootprint();
  assert.equal(f.jobs.files, 0);
});

for (const [s, n] of results) console.log(`${s} ${n}`);
try { rmSync(OUT); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
const failed = results.filter(([s]) => s === "✗");
console.log(`\ntest-state-prune: ${results.length - failed.length}/${results.length} ${failed.length ? "✗" : "✓"}`);
process.exit(failed.length ? 1 : 0);
