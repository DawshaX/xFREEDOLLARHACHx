#!/usr/bin/env node
/**
 * test-commit-recipe — بوابة على `scripts/nova-commit-tree.mjs --selftest`.
 * ──────────────────────────────────────────────────────────────────────────
 * القايمة دي موجودة لأن مرتين اتلمس شغل على `main` بدفعه اتبنت على أساس قديم، والـCI
 * كان أخضر في الحالتين: البوابات بتقيس الكود، ماحدش كان بيقيس **طريقة الدفع نفسها**.
 * الاختبار بيتنفّذ على مستودع مؤقت (git init في /tmp) فمافيش نت ومافيش تأثير علينا،
 * وبيثبت ثلاث حاجات: التعديل على القرص بيوصل حتى لو الـindex قديم، `state/` بيستبعد،
 * والملف الناقص على القرص بيقول على نفسه **ومابيتمسحش** من main.
 *
 *   node scripts/test-commit-recipe.mjs
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = spawnSync(process.execPath, [path.join(ROOT, "scripts", "nova-commit-tree.mjs"), "--selftest"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 120_000,
});
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
const lines = out.split(/\r?\n/).filter((l) => l.trim());
if (run.status !== 0) {
  console.error("✗ nova-commit-tree selftest فشل:");
  console.error(out.slice(-1500));
  process.exit(1);
}
const pass = lines.filter((l) => l.startsWith("  ✓")).length;
if (pass < 7 || !lines.some((l) => l.includes("selftest"))) {
  console.error(`✗ الاختبار عدّى بس عدد الفحوصات ${pass} (<7) — محدّش عارف اتعمل إيه:`);
  console.error(out.slice(-800));
  process.exit(1);
}
console.log(`✓ test-commit-recipe: ${pass} فحص على طريقة البناء والدفع (مستودع مؤقت، بلا نت)`);
