#!/usr/bin/env node
/*
 * audit-no-invented-intel — مفيش رقم بلا مصدر، ومفيش معرّف ملوش وجود.
 * ─────────────────────────────────────────────────────────────────────
 * الحكاية اللي البوابة دي موجودة عشانها: `IMMUNEFI-2026-001` — «ثغرة حرجة
 * CVSS 10.0 / EPSS 0.99» — كانت مكتوبة حرفيًا في `app.ts` وبتتبعت في البث
 * الحيّ لكل عميل يفتح الصفحة، ومعاها رابط على nvd.nist.gov لمعرّف مش موجود.
 * وفي `HomeDashboard` كانت فيه مصفوفة «9 مصادر متصلة لحظيًا» بزمن استجابة
 * مكتوب في الكود (185ms/210ms…) قبل ما أي قياس يحصل، وعدّادات galaxy
 * ببذرة 12,140 و38,420، ومولّد بيلفّق `CVE-2026-30xx` من رقم عشوائي.
 *
 * دي مش زحقة تنسيق: ثغرة مختلقة بشكل CVE لو اتحوّلت لتقرير = اتهام باطل
 * لمكان مكافآت، وسجل «مقاس» وهو مش مقاس = قرار غلط على أساس رقم وهمي.
 *
 * القواعد:
 *   R1  معرّف على شكل CVE/GHSA/Immunefi مكتوب حرفيًا ومش موجود في المخازن
 *       الحقيقية (`state/advisory-cache.json` + خزنة الاكتشافات + ملفات state
 *       المنشورة). `// allow-invented-id` استثناء صريح بسكربتات الاختبار.
 *   R2  `latencyMs: <رقم>` — زمن استجابة مكتوب مش مقاس.
 *   R3  `status: "online"` في صفحة/كمبوننت — «متصل» بلا قياس (اللي بيقيس
 *       فعلًا في `lib/` مسموح، لأنه بيحطه بعد الطلب).
 *   R4  EPSS/CVSS افتراضي (`epss || 0.9x`, `epssScore: 0.9x`, `cvss: 9.x`) —
 *       درجة خطورة تتخترق لما البيانات تقول «مفيش».
 *   R5  `(total|count|…) || رقم كبير` — رقم احتياطي بيلبس لبوس القياس
 *       (`statsObj?.total || 76680` هو اللي خلّى الصفحة الساكنة تقول 76 ألف).
 *
 *   node scripts/audit-no-invented-intel.mjs            → يفحص المستودع
 *   node scripts/audit-no-invented-intel.mjs --selftest → يثبت إن كل قاعدة نابضة
 *   exit 0 نضيف · 1 فيه اختلاق · 2 مفيش مخزن بيانات يتحقق منه
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["artifacts/kali-panel/src", "artifacts/api-server/src"];
const SKIP = /(node_modules|[/\\]dist[/\\]|\.test\.|[/\\]vendor[/\\])/;
const REAL_STORES = [
  "state/advisory-cache.json",
  "state/vuln-corpus-index.json",
  "state/discovered-vulnerabilities-vault.json",
  "state/cybernova-brain-state.json",
  "state/hunt-latest.json",
  "state/nova-brain-latest.json",
  "artifacts/kali-panel/public/state/discovered-vulnerabilities-vault.json",
  "artifacts/kali-panel/public/state/cybernova-brain-state.json",
];

// «ادّعاء» = السجل بيتنسب لثغرة: حقل id/cveId/cve/latestId/nvdId فيه معرّف.
// نص عادي فيه CVE (مثلاً أمثلة نداء بحث في خانة إدخال) مش ادّعاء، فمش داخل هنا.
const CLAIM_RE =
  /\b(?:id|cveId|cve|latestId|nvdId|cve_id)\s*[:=]\s*["'`](CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|PYSEC-\d{4}-\d+)["'`]/g;
// المساحات دي مش بتاعة حد: أي حاجة بتسمّي نفسها IMMUNEFI-2026-001 أو AI-MUT-…
// بتخترع ثغرة في مكان مكافآت، فممنوعة في أي سياق حتى لو جوه تعليق كود.
const FAKE_NS_RE =
  /["'`](IMMUNEFI-\d{4}-\d+|AI-MUT-\d{4}-\d+|CYBERNOVA-AI-\d{4}-\d+|NOVA-AI-\d{4}-\d+|AI-GALAXY-\d+)["'`]/g;
const RULES = [
  { key: "R2", re: /latencyMs\s*:\s*[1-9]\d*(?!\s*-)/g, why: "زمن استجابة مكتوب في الكود — القياس بييجي من `Date.now() - t0` مش من رقم" },
  // `status: "online" | "offline"` تعريف نوع (union) مش حالة معلنة — المتبوع بـ|
  // بيتخطى. أي `status: "online",` في صفحة/كمبوننت = ادّعاء اتصال من غير قياس.
  { key: "R3", re: /status\s*:\s*["']online["'](?!\s*\|)/g, uiOnly: true, why: "«متصل» بلا قياس — الحالة بتيجي بعد الطلب مش قبله" },
  { key: "R4", re: /(epss|epssScore|epss_score)\s*(\|\||\?)?\|\|\s*0\.9\d+|(epssScore|epss)\s*:\s*0\.9\d+/g, why: "EPSS افتراضي — EPSS قياس خارجي لـCVE منشورة، مفيش «تقريبًا 0.95»" },
  { key: "R4b", re: /\b(cvss|cvssScore)\s*:\s*9\.\d+,?\s*$/gm, uiOnly: true, why: "درجة CVSS مكتوبة في الصفحة — بتيجي من السجل ده أو متعرضش" },
  { key: "R5", re: /\b(total|count|totalCves|criticalCves|highCves|withExploit)\s*\|\|\s*\d{4,}/g, why: "رقم احتياطي بيلبس لبوس قياس (`x?.total || 76680`)" },
];

function listFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.test(full)) listFiles(full, out);
    } else if (/\.tsx?$/.test(e.name) && !SKIP.test(full)) {
      out.push(full);
    }
  }
  return out;
}

const LEDGER = "state/curated-cve-examples.json";

function loadKnownIds() {
  const ids = new Set();
  const read = [];
  for (const rel of REAL_STORES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    read.push(rel);
    const txt = fs.readFileSync(p, "utf8");
    for (const m of txt.matchAll(/CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|PYSEC-\d{4}-\d+/g)) ids.add(m[0]);
    for (const m of txt.matchAll(/"(?:id|cveId|cve)"\s*:\s*"([A-Z0-9-]{6,})"/g)) ids.add(m[1]);
  }
  // السجل الموثّق: كل معرّف بيتكتب حرفيًا في الكود لازم يكون ليه سطر هنا
  // (مصدر + تاريخ + فين مستخدم). من غيره = اختلاق.
  const lp = path.join(ROOT, LEDGER);
  if (fs.existsSync(lp)) {
    read.push(LEDGER);
    try {
      const doc = JSON.parse(fs.readFileSync(lp, "utf8"));
      for (const it of doc.items ?? []) {
        const url = String(it.sourceUrl || "");
        if (!it.id || !/^https:\/\/(nvd\.nist\.gov|github\.com)\//.test(url)) {
          console.error(`✗ ${LEDGER}: سطر «${it.id}» مالوش مصدر مقبول (nvd.nist.gov أو github.com/advisories) — السجل مش سلة`);
          process.exit(1);
        }
        ids.add(it.id);
      }
    } catch (e) {
      console.error(`✗ ${LEDGER}: مش JSON صالح — ${e.message}`);
      process.exit(1);
    }
  }
  return { ids, read, count: read.length };
}

function scan(rel, text, known, storesNote = "state/advisory-cache.json + خزنة الاكتشافات + سجل المعرّفات") {
  const findings = [];
  const isUi = /[/\\](pages|components)[/\\]/.test(rel);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("allow-invented-id") || (lines[i - 1] ?? "").includes("allow-invented-id")) continue;
    const next = lines[i + 1] ?? "";
    for (const m of line.matchAll(FAKE_NS_RE)) {
      findings.push({ line: i + 1, rule: "R1", text: `مساحة أسماء مخترعة «${m[1]}» — مفيش سجل بهذا الاسم، والاستثناء الوحيد هو تعليق allow-invented-id`, snippet: line.trim().slice(0, 140) });
    }
    for (const m of line.matchAll(CLAIM_RE)) {
      if (!known.has(m[1])) {
        findings.push({ line: i + 1, rule: "R1", text: `معرّف «${m[1]}» بيتنسب لثغرة ومش موجود في أي مخزن بيانات (${storesNote})`, snippet: line.trim().slice(0, 140) });
      }
    }
    for (const r of RULES) {
      if (r.uiOnly && !isUi) continue;
      r.re.lastIndex = 0;
      if (r.re.test(line)) {
        // سطر تعليق بس؟ مفيش كود فيه → مش مخالفة
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (r.key === "R4" && /Date\.now\(\)|await |=>/.test(next)) continue;
        findings.push({ line: i + 1, rule: r.key, text: r.why, snippet: line.trim().slice(0, 140) });
      }
    }
  }
  return findings;
}

/* ── selftest: كل قاعدة لازم تنبض على النموذج بتاعها ────────────────────────── */
if (process.argv.includes("--selftest")) {
  const known = new Set(["CVE-2026-61536"]);
  const cases = [
    ["x.ts", 'const e = { id: "IMMUNEFI-2026-001", cvss: 10 };', ["R1"]],
    ["y.ts", 'const e = { id: "CVE-2031-1234", severity: "HIGH" };', ["R1"]],
    ["z.ts", '["CVE-2024-3400", "log4j"].map(', []],
    ["x.ts", 'res.json({ total: statsObj?.total || 76680 });', ["R5"]],
    ["src/pages/HomeDashboard.tsx", '{ id: "nvd", latencyMs: 185, status: "online" }', ["R2", "R3"]],
    ["src/lib/a.ts", "epssScore: c.epss || 0.94,", ["R4"]],
    ["src/pages/A.tsx", "cvssScore: 9.6,", ["R4b"]],
    // وعينة نظيفة لازم تعدّي
    ["src/lib/b.ts", "latencyMs: Date.now() - t0,", []],
    ["src/pages/C.tsx", '{ id: "nvd", latencyMs: 0, status: "unknown" }', []],
    ["src/pages/D.tsx", 'id: "CVE-2026-61536",', []],
    ["src/pages/E.tsx", 'placeholder="CVE-2031-9999 بحث"', []],
  ];
  let bad = 0;
  for (const [file, text, expect] of cases) {
    const got = scan(file, text, known, "fixture").map((f) => f.rule);
    const ok = expect.length === got.length && expect.every((e) => got.includes(e));
    console.log(`${ok ? "✓" : "✗"} ${file.padEnd(34)} توقّعت [${expect}] · لقيت [${[...new Set(got)]}]`);
    if (!ok) bad++;
  }
  console.log(bad ? `\n✗ selftest: ${bad} حالة فاشلة` : "\n✅ selftest — كل قاعدة بتنبض على نموذجها والعينة النضيفة بتعدّي");
  process.exit(bad ? 1 : 0);
}

const { ids: known, read, count } = loadKnownIds();
if (count === 0) {
  console.error("✗ audit-no-invented-intel: مفيش ولا مخزن بيانات حقيقي مقرو — الفحص بلا معنى");
  process.exit(2);
}

const files = [];
for (const d of SCAN_DIRS) listFiles(path.join(ROOT, d), files);
const findings = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  for (const hit of scan(rel, fs.readFileSync(f, "utf8"), known, read.join(" + "))) findings.push({ file: rel, ...hit });
}

if (findings.length) {
  console.error(`✗ audit-no-invented-intel: ${findings.length} اختلاق/رقم بلا مصدر في ${files.length} ملف (المخازن المقبولة: ${count})`);
  for (const h of findings.slice(0, 40)) console.error(`  · ${h.rule}  ${h.file}:${h.line}\n      ${h.text}\n      › ${h.snippet}`);
  if (findings.length > 40) console.error(`  … و${findings.length - 40} تانية`);
  console.error("\n  الإصلاح: اقرأ الرقم من مصدره (corpus/ops/monitor) أو اكتب «غير مقاس». المعرّف المختلق يتشال خالص.");
  process.exit(1);
}
console.log(`✅ audit-no-invented-intel — ${files.length} ملف، صفر معرّف ملفّق وصفر رقم بلا مصدر (${known.size} معرّف حقيقي معروف)`);
