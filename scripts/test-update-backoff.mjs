#!/usr/bin/env node
/**
 * Offline checks for the update back-off — the thing that stops the 5-minute
 * self-update loop when the updater is what's killing the box.
 *
 * Why this exists: on 2026-11-07 between 03:25:40Z and 03:44Z the live slot
 * answered, died, answered and died again. Measured from the box's own log: the
 * same half-run repeated — «→ 151 ملف · 11.8MB» and then nothing, no backup
 * line, no completion, four copies of a 3MB download and ~8GB of /tmp backups,
 * free disk 98,556MB → 90,528MB in 13 minutes, and the panel behind a 502. The
 * update never finished, but nothing recorded a failure — so the loop re-armed
 * itself forever. `backoffReason()` is the breaker; this file pins it.
 *
 *   node scripts/test-update-backoff.mjs
 */
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";

const SRC = join(ROOT, "artifacts/api-server/src/lib/auto-update.ts");
const work = mkdtempSync(join(tmpdir(), "nova-backoff-"));
const state = join(work, "state");
mkdirSync(state, { recursive: true });
const out = join(work, "bundle.mjs");

bundleCli(ROOT, [SRC, "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--outfile=${out}`]);

// stateDir() honours NOVA_STATE_DIR at call time — point it at the sandbox dir.
process.env.NOVA_STATE_DIR = state;
const LEDGER = join(state, "nova-update-ledger.json");
const MARK = join(state, ".nova-update-in-progress");
// Must match ASSET_URL in the module (REPO/TAG defaults, no env override here).
const ASSET = "https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/nova-portable/nova-24-7.zip";

const { backoffReason } = await import(`file://${out}`);
const iso = (secAgo) => new Date(Date.now() - secAgo * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const setLedger = (entry) => writeFileSync(LEDGER, JSON.stringify({ [ASSET]: entry }), "utf8");
const clear = () => {
  rmSync(LEDGER, { force: true });
  rmSync(MARK, { force: true });
};

let pass = 0;
const ok = (name) => {
  pass++;
  console.log(`  ✓ ${name}`);
};

// 1) نظيف تمامًا: مفيش سجل ومفيش علامة → الحلقة تشتغل عادي.
clear();
assert.equal(backoffReason(), null, "empty state must not block an update");
ok("نظيف → مفيش سكّون");

// 2) فشل واحد حديث → جرّب تاني (مش كل تعثّر يوقف التحديث للأبد).
clear();
setLedger({ fails: 1, last: iso(60), reason: "download: HTTP 403" });
assert.equal(backoffReason(), null, "one recent failure must still retry");
ok("فشل واحد → إعادة محاولة");

// 3) فشلين جوه نافذة 6 ساعات → سكّون، والرسالة بتقول إزاي تخرج منه.
clear();
setLedger({ fails: 2, last: iso(600), reason: "backup" });
const held = backoffReason();
assert.ok(held, "two recent failures must park the loop");
assert.match(held, /سكون|متوقفة/);
assert.match(held, /nova-update-ledger\.json/);
ok("فشلين حديثين → سكّون مع مخرج");

// 4) فشلين قدام من أكتر من 6 ساعات → الحلقة ترجع لوحدها من غير تدخل.
clear();
setLedger({ fails: 5, last: iso(7 * 3600), reason: "stale" });
assert.equal(backoffReason(), null, "the back-off must expire on its own");
ok("بعد 6 ساعات → الرجوع تلقائي");

// 5) محاولة ماتت في النص (علامة قديمة) + سجل فيه فشل واحد → ده فشل تاني → سكّون.
clear();
setLedger({ fails: 1, last: iso(120), reason: "killed mid-copy" });
writeFileSync(MARK, JSON.stringify({ url: ASSET, at: iso(900) }), "utf8");
const stale = (Date.now() - 900_000) / 1000;
utimesSync(MARK, stale, stale);
const dead = backoffReason();
assert.ok(dead, "a stale in-progress marker is a crash and must count");
assert.match(dead, /وقفت في النص/);
ok("محاولة اتقطعت في النص → محسوبة فشل");

// 6) علامة طازة (محاولة شغالة دلوقتي) → متقطعهاش.
clear();
setLedger({ fails: 1, last: iso(120) });
writeFileSync(MARK, JSON.stringify({ url: ASSET, at: iso(20) }), "utf8");
assert.equal(backoffReason(), null, "a running attempt must not be interrupted");
ok("محاولة شغالة دلوقتي → مفيش قطع");

// 7) السجل بيتقرا بنفس مفتاح المصدر اللي بيمشي للسكريبت — مفتاح غلط = حارس ميت.
clear();
writeFileSync(LEDGER, JSON.stringify({ "https://example.com/other.zip": { fails: 9, last: iso(60) } }), "utf8");
assert.equal(backoffReason(), null, "a ledger for another source must not park this one");
ok("سجل لمصدر تاني → مفيش تأثير");

console.log(`\n✓ update back-off: ${pass}/7 green`);
