#!/usr/bin/env node
/*
 * audit-src-secrets — الأسرار ما تعيشش في ملف متتبَّع.
 * ─────────────────────────────────────────────────────────────────────────
 * التسريب اللي حصل فعلاً: توكن بوت تليجرام + chat ID + مفتاح بوابة OpenClaw
 * كانوا مكتوبين حرفيًا في `LiveAgentPanel.tsx` و`nova-cron.ts`. دي ملفات بتدخل
 * في بايت المتصفح وفي الحزمة العامة، فاللي «مكتوب في الكود» منشور للعالم مهما
 * كان مكتوب في تعليق. الحارس ده بيغطي اللي `audit-bundle-secrets` ما بيشوفوش:
 * ده بيفحص **المستودع نفسه**، وذاك بيفحص **الحزمة المبنية**.
 *
 *   node scripts/audit-src-secrets.mjs
 *   exit 0 نضيف · 1 فيه سر · 2 مفيش git
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEXT_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".cjs", ".json", ".yml", ".yaml", ".sh", ".md", ".env"]);
const PLACEHOLDER =
  /(test|example|placeholder|sample|dummy|changeme|your[_-]|xxx|redacted|REDACTED|<|\$\{|process\.env|readSecret)/;
const PATTERNS = [
  [/["'][0-9]{8,12}:AA[A-Za-z0-9_-]{28,}["']/, "توكن بوت تليجرام"],
  [/\b(?:token|apiKey|api_key|secret|botToken)\s*[:=]\s*["'][0-9a-zA-Z_-]{32,70}["']/, "مفتاح/توكن مكتوب حرفيًا"],
  [/(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/, "توكن GitHub"],
  [/\bsk-[A-Za-z0-9_-]{20,}/, "مفتاح OpenAI-compat"],
  [/\bgsk_[A-Za-z0-9]{20,}/, "مفتاح Groq"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "توكن Slack"],
  [/\bAKIA[0-9A-Z]{16}\b/, "مفتاح AWS"],
];

let listed;
try {
  listed = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch {
  console.error("✗ audit-src-secrets: `git ls-files` فشل — مش في مستودع؟");
  process.exit(2);
}

const hits = [];
const trackedEnv = [];
let scanned = 0;
for (const rel of listed.split("\n").filter(Boolean)) {
  const base = path.basename(rel);
  if (/^\.env/.test(base) && !/^\.env\.[A-Za-z0-9_.-]*example$/.test(base)) {
    trackedEnv.push(rel);
    continue;
  }
  if (!TEXT_EXT.has(path.extname(base))) continue;
  const full = path.join(ROOT, rel);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    continue;
  }
  if (stat.size > 3 * 1024 * 1024 || stat.size === 0) continue;
  scanned++;
  const txt = fs.readFileSync(full, "utf8");
  const lines = txt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("allow-secret-literal")) continue;
    for (const [re, label] of PATTERNS) {
      if (re.test(line)) {
        const value = line.match(re)?.[0] ?? "";
        if (PLACEHOLDER.test(value) || PLACEHOLDER.test(line)) continue;
        hits.push(`${label}  ·  ${rel}:${i + 1}\n      › ${line.trim().slice(0, 120)}`);
        break;
      }
    }
  }
}

if (trackedEnv.length || hits.length) {
  if (trackedEnv.length) {
    console.error(`✗ audit-src-secrets: ملفات env متتبَّعة (${trackedEnv.length}):`);
    for (const f of trackedEnv) console.error(`  · ${f}`);
  }
  if (hits.length) {
    console.error(`✗ audit-src-secrets: ${hits.length} سر مكتوب حرفيًا في السورس (فحصنا ${scanned} ملف):`);
    for (const h of hits.slice(0, 20)) console.error(`  · ${h}`);
    if (hits.length > 20) console.error(`  … و${hits.length - 20} تانية`);
  }
  console.error("\n  الإصلاح: `process.env.X` للسيرفر، وlocalStorage للمتصفح. السطر اللي مقصوده");
  console.error("  مثال/اختبار يحط `// allow-secret-literal` جنبه.");
  process.exit(1);
}
console.log(`✅ audit-src-secrets — ${scanned} ملف متتبَّع، صفر سر حرفي، صفر ملف env`);
