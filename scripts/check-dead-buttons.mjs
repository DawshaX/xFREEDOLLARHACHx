#!/usr/bin/env node
/**
 * check-dead-buttons — مفيش زرار وهمي: أي <button> في الواجهة لازم
 * onClick / type=submit / disabled / asChild / ref= — لو فقد الكل ⇒ فشل.
 * سجل مابليسفيش مستثنى: مكتبات shadcn تحت components/ui (أزرار بتتوسّع جوه).
 * الأزرار اللي اتصلّحت (reverse-evolution/custom-build/dark-ml/poc/sentinel/live-agent)
 * نقصد تراجعها بأي كوميت = الحارس ده يصرخ فورًا.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "artifacts/kali-panel/src");

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "ui" && p.endsWith("components/ui")) continue; // mكتبات
      yield* walk(p);
    } else if (/\.tsx$/.test(f)) yield p;
  }
}

let bad = 0, looked = 0;
for (const file of walk(SRC)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/<(?:B|b)utton\b([^>]*)>/g)) {
    const attrs = m[1];
    looked++;
    if (attrs.includes("onClick") || attrs.includes('type="submit"') || attrs.includes("type='submit'")
        || attrs.includes("disabled") || attrs.includes("asChild") || attrs.includes("ref=")) continue;
    // زرار جوا <XTrigger asChild> الكليك بيورث للتريجر (Dialog/Popover…) = فعلي مش ميت
    if (/asChild[^>]*>\s*$/.test(src.slice(Math.max(0, m.index - 400), m.index))) continue;
    const line = src.slice(0, m.index).split("\n").length;
    console.error(`✗ زرار ميت: ${relative(ROOT, file)}:${line}`);
    bad++;
  }
}
if (bad) {
  console.error(`check-dead-buttons: ${bad}/${looked} زرار بلا فعل حقيقي — كل زرار على الشاشة لازم يعمل حاجة ✗`);
  process.exit(1);
}
console.log(`check-dead-buttons: ${looked} زرار كله بفعل حقيقي (onClick/submit/ref) ✓`);
