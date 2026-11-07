#!/usr/bin/env node
/**
 * حلقة إعادة التشغيل اللي في `start.sh` — بتشتغل، مش مكتوبة بس.
 *
 * ليه البوابة دي موجودة: على بيضة Pterodactyl أي حاجة بتخلص في `start.sh` هي
 * العملية الرئيسية للحاوية، فاللوحة بتعلّم السلوت offline ومافيش حاجة بترجّعه.
 * قِيس 2026-11-07: الهب وقع من 20:41Z وفضل واقع أكتر من تلات ساعات — الإصلاحات
 * كانت موجودة على جيت هوب ومافيش باب يوصّلها. الحلقة دي هي الباب.
 *
 * البوابة بتعمل حاجتين:
 *   1) نص `start.sh` نفسه: فيه trap؟ فيه while؟ فيه احترام لـ state/NOVA_HALT؟
 *      ولا رجّعناش بالظبط لـ `exec node boot.mjs` (وهي المشكلة الأصلية).
 *   2) بتنّفذ `--selftest-respawn` في البنّاء: boot.mjs وهمي بيموت على طول،
 *      ولازم يقوم تلات مرات لوحده من غير ما حد يلمسه.
 *
 *   node scripts/test-respawn-loop.mjs
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILDER = join(ROOT, "scripts/build-standalone.mjs");

const src = readFileSync(BUILDER, "utf8");
const start = src.indexOf("const START_SH = `");
assert.ok(start > 0, "البنّا مابقاش بيعرّف START_SH — الحلقة اتشالت ولا اتكتت في نص تاني؟");
const end = src.indexOf("`;", start);
assert.ok(end > start, "قالب start.sh مقفولش — أي حد كسر الـbacktick");
const SH = src.slice(start, end);

const want = [
  ["trap", "الإغلاق النظيف من اللوحة (SIGTERM) لازم يوقف، مابيدورشش على طول"],
  ["while : ; do", "الحلقة نفسها"],
  ["state/NOVA_HALT", "لو التطبيق كتب علامة التوقّف الحلقة بتسلّم"],
  ["NOVA_RESPAWN_MIN", "التست بيبطّل الـbackoff بمتغيّر بيئة، فمفروض هو متعرّف"],
];
for (const [needle, why] of want) {
  assert.ok(SH.includes(needle), `start.sh فقد «${needle}» — ${why}`);
}
assert.ok(!/mkdir -p "\$HERE\/state\/jobs"\nexec node boot\.mjs/.test(SH), "رجعنا لـ exec node boot.mjs وحده = موت بلا قيام");

const run = spawnSync(process.execPath, [BUILDER, "--selftest-respawn"], { cwd: ROOT, encoding: "utf8", timeout: 90_000 });
const log = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
assert.equal(run.status, 0, `selftest-respawn فشل: ${log.split(/\r?\n/).slice(-3).join(" · ")}`);
assert.match(log, /قام \d+ مرات/, `مافيش رقم محاولات في المخرج: ${log.slice(0, 200)}`);
console.log(`✓ حلقة إعادة التشغيل: ${log.split("\n").pop().trim()}`);
