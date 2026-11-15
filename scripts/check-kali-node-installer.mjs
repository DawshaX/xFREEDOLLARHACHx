// بوابة التوائم: المُثبِّت الكانوني في scripts/kali-node-install.mjs لازم يكون
// حرفيًا مطابق للثابت المدمج في الحزمة (src/lib/ops/kali-node-installer.ts) —
// النسختين اللي مابتطابقوش = العقد هتثبت نسخة مختلفة عن اللي في الريبو.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = readFileSync(join(ROOT, "scripts/kali-node-install.mjs"), "utf8").replace(/\n$/, "");
const ts = readFileSync(join(ROOT, "artifacts/api-server/src/lib/ops/kali-node-installer.ts"), "utf8");
const m = /export const KALI_NODE_INSTALLER = String\.raw`([\s\S]*)`;\n/.exec(ts);
if (!m) {
  console.error("✗ الثابت KALI_NODE_INSTALLER مش موجود في kali-node-installer.ts");
  process.exit(1);
}
const embedded = m[1].replace(/\n$/, "");
if (canonical !== embedded) {
  console.error("✗ التوائم اتفرقوا — scripts/kali-node-install.mjs ≠ الثابت المدمج (حد غير واحد من غير التاني)");
  process.exit(1);
}
for (const danger of ["${"]) {
  if (embedded.includes(danger)) {
    console.error("✗ المُثبِّت فيه تسريب template: " + danger + " — String.raw هيتفسّر غلط في TS");
    process.exit(1);
  }
}
console.log("✓ التوائم متطابقين حرفيًا (" + canonical.length + " chars) — ومافيش تسريب template");
