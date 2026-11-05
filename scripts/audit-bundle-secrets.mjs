#!/usr/bin/env node
/*
 * audit-bundle-secrets — ماحدش بيبص جوه الـartifact، وده بالظبط اللي خلّى `.env` يتسرب.
 *
 * الحزم العامة (`nova-24-7.zip` في Releases) هي السطح الوحيد اللي بيتنشر للعالم كله. مرة واحدة
 * ملف `.env` جوه ملف `api-server-windows-*.zip` نشر `NOVA_EXEC_TOKEN` حقيقي — مافيش حاجة في
 * السطور اتغيرت، ومافيش بوابة فشلته، والاتفاق كان إن «الملفات المتتبعة نضيفة» (وكانت فعلاً:
 * `git ls-files` فيها `.env.nova.example` بس). النضافة في المستودع ما بتعنيش نضافة في الحزمة.
 *
 * الفحصين اللي هنا بيغطّوا الطريقتين الحقيقيتين للتسريب:
 *   1) أي ملف env (غير `.env.*example`) جوه شجرة الحزمة → فشل.
 *   2) سرّ مكتوب حرفيًا في ملف منشور (`NOVA_EXEC_TOKEN: "..."`) → فشل. قراءة المتغيرات من
 *      environment زي `process.env.NOVA_EXEC_TOKEN` مش بتتحسب سر.
 *
 *   node scripts/audit-bundle-secrets.mjs [path/to/bundle]
 *   exit 0 نضيفة · 1 فيه حاجة ما ينفعش تنزل · 2 المجلد مش موجود
 */
import fs from "node:fs";
import path from "node:path";

const TARGET = path.resolve(process.argv[2] ?? "dist-standalone/nova-24-7");
const EXAMPLE = /^\.env\.[A-Za-z0-9_.-]*example$/; // `.env.nova.example` كمان — النقطة كانت بتفلت من الفئة
const TEXT_EXT = new Set([".mjs", ".js", ".cjs", ".json", ".sh", ".txt", ".yaml", ".yml", ".env"]);
/* بلا كذب على النفس: القالب اللي في واجهة الاختبار (`Bearer test_account_owner_token`) مش سر،
 * والقاعدة اللي بتقبض على كل حاجة بتموت بعد أول يوم ويبقى أخضر/أحمر مش مقصود. السر الحقيقي
 * هو اللي شكله عشوائي طويل وكلام معناه مش فيه. */
const TG_BOT = /["'][0-9]{8,12}:AA[A-Za-z0-9_-]{28,}["']/;
const HEX_TOKEN = /\b(?:token|apiKey|api_key|secret)\s*[:=]\s*["'][0-9a-f]{32,64}["']/i;
const PLACEHOLDER = /(test|example|placeholder|sample|dummy|changeme|your[_-]|xxx|redacted|<|\$\{|process\.env)/i;
const SECRET_PATTERNS = [
  [/NOVA_EXEC_TOKEN\s*[:=]\s*["'][A-Za-z0-9_.-]{8,}["']/, "NOVA_EXEC_TOKEN مدموج في بايت منشور"],
  // دول بالظبط اللي عاشوا سنين في `LiveAgentPanel.tsx` و`nova-cron.ts` ونزلوا
  // في الحزمة العامة وعلى GitHub Pages — توكن بوت تليجرام ومفتاح بوابة.
  [TG_BOT, "توكن بوت تليجرام مكتوب حرفيًا (لازم environment/localStorage بس)"],
  [HEX_TOKEN, "مفتاح hex طويل مكتوب حرفيًا في كود منشور"],
  [/["']key["']\s*:\s*["']gsk_[A-Za-z0-9]{16,}["']/, "مفتاح Groq (gsk_…) مكتوب حرفيًا"],
  [/["']key["']\s*:\s*["']sk-[A-Za-z0-9-]{16,}["']/, "مفتاح OpenAI-compat (sk-…) مكتوب حرفيًا"],
  [/Bearer\s+[A-Za-z0-9_.-]{24,}/, "Bearer token مكتوب حرفيًا في الحزمة"],
];

if (!fs.existsSync(TARGET) || !fs.statSync(TARGET).isDirectory()) {
  console.error(`✗ audit-bundle-secrets: المسار مش موجود: ${path.relative(process.cwd(), TARGET)}`);
  process.exit(2);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(full);
    else files.push(full);
  }
})(TARGET);

const envLeaks = files.filter((f) => /^\.env/.test(path.basename(f)) && !EXAMPLE.test(path.basename(f)));
const baked = [];
for (const f of files) {
  if (!TEXT_EXT.has(path.extname(f)) && !EXAMPLE.test(path.basename(f))) continue;
  let size = 0;
  try {
    size = fs.statSync(f).size;
  } catch {
    continue;
  }
  if (size > 14 * 1024 * 1024) continue; // مش هنفك chunk مضغوط بحثًا عن سر
  const txt = fs.readFileSync(f, "utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    // نلمس كل match: ملف فيه كذا مثال وقالب واحد حقيقي لازم يقبض على الحقيقي.
    const globalRe = re.global ? re : new RegExp(re.source, re.flags + "g");
    for (const m of txt.matchAll(globalRe)) {
      const value = m[0];
      if (PLACEHOLDER.test(value)) continue;
      if (value.replace(/[^A-Za-z0-9]/g, "").length < 24) continue;
      baked.push(`${path.relative(TARGET, f)} — ${label} (${value.replace(/\s+/g, " ").slice(0, 34)}…)`);
      break;
    }
  }
}

if (envLeaks.length || baked.length) {
  console.error(`\n❌ audit-bundle-secrets — الحزمة دي ما تنزلش Release:`);
  for (const f of envLeaks) console.error(`  · ملف env: ${path.relative(TARGET, f)}`);
  for (const hit of baked) console.error(`  · ${hit}`);
  console.error(`\n  الملفات المتتبعة نضيفة ≠ الحزمة نضيفة. اللي اتلفّ جوه الـzip اتنشر للعالم.`);
  process.exit(1);
}
console.log(`✅ audit-bundle-secrets — ${files.length} ملف في ${path.relative(process.cwd(), TARGET)}: مافيش ملف env، مافيش سر مدمج`);
