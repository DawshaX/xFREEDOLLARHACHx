#!/usr/bin/env node
/*
 * audit-no-cjk-in-text — النص العربي اللي بيطّلع للنموذج أو للمشغّل يفضل عربي.
 * ─────────────────────────────────────────────────────────────────────────
 * اللي حصل فعلًا (قِيس 2026-11-06): حروف صينية/يابانية دخلت جوه نص عربي في
 * `agent/tools.ts` (وصف أداة `bounty_run`: «على目标 مصرّح به») وفي `self-model.ts`
 * وفي `docs/` و`deploy/` ورسائل فشل في `scripts/ops-selftest.mjs`. ده مش تجميل:
 * وصف الأداة بيّتاكل في الـprompt، فالنموذج بيلفظه وبيردّ بكلام مكسر — وده حرفيًا
 * واحد من مصادر «الشات عبيط». وفي `.mjs` كان فيه «حل» أحط: `.replace("读","قرا")`
 * وقت الطباعة — يعني السورس لسه مكسور والبوابة خضرا.
 *
 * القاعدة: أي ملف متتبَّع نصّي مفيش فيه حروف شرق-آسيوية، إلاقاموس لغات صريح
 * (المسمّى في EXEMPT تحت، بسبب مكتوب). ملفات البيانات اللي بنكتبها إحنا — زي
 * `state/curated-cve-examples.json` — مش مستثناة، بتتمسح زي الكود.
 *
 *   node scripts/audit-no-cjk-in-text.mjs            → يفحص المستودع
 *   node scripts/audit-no-cjk-in-text.mjs --selftest → يثبت إن الفاشل بينمسك
 *   exit 0 نضيف · 1 فيه مواضع · 2 مفيش git
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs", ".json", ".jsonl",
  ".yml", ".yaml", ".sh", ".md", ".py", ".html", ".css", ".env",
]);

/** النطاقات: هيرانا+كاتاكانا، امتداد كانا، هانزا، كانا نصفيّة، هانغل. */
export const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d\uac00-\ud7af]/;

/**
 * استثناء واحد لكل ملف: قاموس لغات البانل. أي استثناء تاني لازم ييجي معه سبب،
 * والسبب مكتوب هنا — مش في ملف JSON ناسيه حد.
 */
export const EXEMPT = new Map([
  ["artifacts/kali-panel/src/lib/i18n.ts", "قواميس zh/ja/ko للواجهة دي هي المقصود"],
  ["src/lib/i18n.ts", "نفس القواميس في شجرة البانل التانية"],
]);

/** بياخد نص و بيرجّع [{line, chars, excerpt}] — لوحدها عشان الـselftest. */
export function scanText(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(new RegExp(CJK.source, "g"));
    if (!m) continue;
    out.push({
      line: i + 1,
      chars: [...new Set(m)].slice(0, 8).join(""),
      excerpt: lines[i].trim().slice(0, 80),
    });
  }
  return out;
}

export function isExempt(rel) {
  return EXEMPT.has(rel.split(path.sep).join("/"));
}

function runSelftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cjk-gate-"));
  let passed = 0;
  let failed = 0;
  const ok = (name, cond) => {
    if (cond) {
      passed += 1;
      console.log(`  ok   ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${name}`);
    }
  };
  try {
    fs.writeFileSync(path.join(dir, "clean.ts"), 'const a = "الثغرة مقاسة من القرص — nuclei";\n');
    fs.writeFileSync(path.join(dir, "broken.ts"), 'const b = "يبني job حقيقي على目标 مصرّح به";\n');
    fs.writeFileSync(path.join(dir, "mismatch.mjs"), 'console.log("同步 تاني ضاعف السجل");\n');
    const files = ["clean.ts", "broken.ts", "mismatch.mjs"];
    const findings = files
      .map((f) => ({ f, hits: scanText(fs.readFileSync(path.join(dir, f), "utf8")) }))
      .filter((x) => x.hits.length > 0);
    ok("النضيف بيعدي", !findings.some((x) => x.f === "clean.ts"));
    ok("الحرف الصيني في نص عربي بينمسك", findings.some((x) => x.f === "broken.ts" && x.hits[0].line === 1));
    ok("رسائل الفشل في السكربتات كمان بتنبط", findings.some((x) => x.f === "mismatch.mjs"));
    ok("الاستثناء مقصور على القواميس", isExempt("artifacts/kali-panel/src/lib/i18n.ts") && !isExempt("agent/tools.ts"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`audit-no-cjk-in-text selftest: ${passed} passed · ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("✅ النص الشرقي بيمسك قبل ما يوصل للـprompt");
}

if (process.argv.includes("--selftest")) runSelftest();
else {
  let listed;
  try {
    listed = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    console.error("✗ audit-no-cjk-in-text: `git ls-files` فشل — مش في مستودع؟");
    process.exit(2);
  }
  const bad = [];
  let scanned = 0;
  for (const rel of listed.split("\n").filter(Boolean)) {
    if (!TEXT_EXT.has(path.extname(rel))) continue;
    if (isExempt(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    for (const h of scanText(text)) bad.push({ rel, ...h });
  }
  if (bad.length === 0) {
    console.log(`✓ audit-no-cjk-in-text: ${scanned} ملف نصّي — ولا حرف شرق-آسيوي واحد`);
    process.exit(0);
  }
  console.log(`✗ audit-no-cjk-in-text: ${bad.length} سطر فيه حروف شرق-آسيوية جوه نص عربي/إنجليزي (${scanned} ملف متفحّص)`);
  for (const b of bad.slice(0, 25)) console.log(`  ${b.rel}:${b.line} [${b.chars}] ${b.excerpt}`);
  if (bad.length > 25) console.log(`  … و${bad.length - 25} تانيين`);
  console.log("  الوصف في الـprompt أو ردّ المستخدم مش مكان الحروف دي — صلّح النص نفسه، ومتحطش .replace() عند الطباعة.");
  process.exit(1);
}
