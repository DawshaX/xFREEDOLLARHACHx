#!/usr/bin/env node
/**
 * CyberNova — مين بيقول إن مصدره جاب حاجة؟
 * ────────────────────────────────────────────────────────────────────────────
 * القاعدة بسطر: لو الـkind بيحكي للمدير إن نتيجة جت من مصدر بره (crt.sh، NVD،
 * Exploit-DB، Hackbot…)، لازم الكود بتاع الـkind ده يسأل المصدر ده فعلاً — fetch
 * أو دالة محلولة بتوصل لـfetch فيه. «صفر نتيجة» و«المصدر ماردّش» حاجتين مختلفتين
 * خالص، والفرق مابانشش في اللوحة، فبنقيسه من الشجرة.
 *
 * ليه الملف ده موجود (متقاس 2026-11-08): `recon.certspotter` كان عنوانه
 * «تعداد نطاقات فرعية من سجلات الشهادات (سلبي)” وبيسمّي الدليل بتاعه
 * `crt.sh?q=%.host` — وهو أصلًا مابيسألش crt.sh؛ كان بيعمل تجربة 34 اسم على DNS
 * من `security-tools.ts:scanSubdomains`. المخرج كان «0 نطاق فرعي من CT logs» مع
 * `ok:true`: الاختفاء اتقدّم كدليل على إن مافيش حاجة.
 *
 * ملاحظة على التسمية: تسمية ملف الدليل مش إثبات — وده بالظبط اللي اتعمل قبل كده.
 * عشان كده بنصدّق سطر فيه fetch/URL أو دالة محلول اسمها لـfetch فيه. للاسم
 * المحلول بره الملفات المتتبَّعة: حط سطر `// audit-source-claims: ok <source>`
 * جوّه البلوك، والبوابة بتسجّلك الاستثناء في المخرج مش بتبلعه.
 *
 * الاستخدام:
 *   node scripts/audit-source-claims.mjs [--json] [--selftest]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB = path.join(ROOT, "artifacts/api-server/src/lib");
const TOOLS = path.join(LIB, "ops/tools.ts");

// كلمات معناها «جبت دي من بره». claim = اللي بيتقال للمدير (بين عربي وإنجليزي —
// النسخة القديمة من certspotter كانت بتقول «سجلات الشهادات» من غير أي ذكر حرفي
//   لـcrt.sh، والاكتفاء بالاسم الإنجليزي كان بيفوّت الكدبة)، وproof = اللي لازم
// يبان في سطر fetch أو في الدالة المحلولة.
const SOURCES = [
  { name: "crt.sh", claim: ["crt.sh", "ct logs", "ct log", "سجل شهادات", "سجلات الشهادات", "سجل الشهادات"] },
  { name: "exploit-db", claim: ["exploit-db", "exploitdb", "poc منشور"] },
  { name: "cveby", claim: ["cveby"] },
  { name: "virustotal", claim: ["virustotal", "virus total"] },
  { name: "hackbot", claim: ["hackbot"] },
  { name: "shodan", claim: ["shodan"] },
  { name: "censys", claim: ["censys"] },
  { name: "urlhaus", claim: ["urlhaus"] },
  { name: "otx.alienvault", claim: ["otx", "alienvault"] },
  { name: "nvd", claim: ["nvd", "الأمن القومي"] },
  { name: "kev", claim: ["kev", "cisa", "الاستغلال النشط"] },
];
// الملفات اللي بنحلّ منها أسماء الدوال المستوردة (خطوة واحدة كفاية هنا).
const RESOLVE_FILES = ["security-tools.ts", "ops/scope.ts", "ops/free-hosts.ts", "ops/advisory-library.ts", "ops/vuln-corpus.ts"];

const URLISH = /(fetch\s*\(|https?:\/\/|axios\.|got\(|undici)/;

function readSrc(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** بلوكات KINDS: من `  "kind.id": {` لحد `  },` — نفس المسافة حرفيًا. */
export function kindBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^ {2}"([a-z0-9._-]+)": \{/i);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && lines[end] !== "  },") end += 1;
    out.push({ id: m[1], line: i + 1, body: lines.slice(i, end + 1).join("\n") });
    i = end;
  }
  return out;
}

/** الكلام اللي بيسمعه المدير: العنوان والـsummary — من غير التعليقات. */
function claimText(body) {
  return body
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter((l) => /titleAr|title:|summary|msg:/.test(l))
    .join("\n")
    .toLowerCase();
}

/** الأسطر اللي بتثبت إن في سؤال فعلي للمصدر. */
function proofLines(body) {
  return body
    .split("\n")
    .filter((l) => URLISH.test(l) && !/writeEvidence|evidence:|filename|\.gz/.test(l))
    .join("\n")
    .toLowerCase();
}

/** اسماء الدوال اللي البلوك بيناديها — بنلفّها على تعريفاتها في ملفات Lib. */
function calledNames(body) {
  const out = new Set();
  for (const m of body.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)) out.add(m[1]);
  return [...out];
}

function helperProof(srcOfTools) {
  const files = [TOOLS, ...RESOLVE_FILES.map((f) => path.join(LIB, f))];
  const defs = new Map();
  for (const f of files) {
    const src = readSrc(f);
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/);
      if (!m) continue;
      const chunk = lines.slice(i, Math.min(lines.length, i + 40)).join("\n");
      defs.set(m[1], (defs.get(m[1]) ?? "") + "\n" + chunk);
    }
  }
  // الدوال اللي بتتنادى من tools.js: بنرجّع النص بتاعها للـproof search.
  void srcOfTools;
  return defs;
}

export function violationsFor(src, defs = new Map()) {
  const out = [];
  for (const k of kindBlocks(src)) {
    const claim = claimText(k.body);
    const proof = proofLines(k.body);
    const helper = calledNames(k.body)
      .map((n) => defs.get(n) ?? "")
      .join("\n")
      .toLowerCase();
    for (const s of SOURCES) {
      const said = s.claim.map((c) => c.toLowerCase()).find((c) => claim.includes(c));
      if (!said) continue;
      if (proof.includes(s.name.toLowerCase()) || helper.includes(s.name.toLowerCase())) continue;
      // استثناء مكتوب صراحة — بنسجّله في المخرج عشان مابقاش إخفاء.
      const ex = new RegExp(`audit-source-claims: ok ${s.name}`, "i");
      const waived = ex.test(k.body);
      out.push({ id: k.id, line: k.line, source: s.name, said, waived, why: `بيقول «${said}” ومافيش طلب لـ${s.name} جوّه ولا في الدوال اللي بيناديها` });
    }
  }
  return out;
}

function selftest() {
  const good = `  "recon.x": {\n    id: "recon.x",\n    titleAr: "من crt.sh",\n    run: async () => fetch("https://crt.sh/?q=x"),\n  },`;
  const cheat = `  "recon.y": {\n    id: "recon.y",\n    titleAr: "نطاقات من crt.sh",\n    run: async () => {\n      writeEvidence(ctx, "k", "crt.sh?q=%", "{}");\n      return { ok: true, summary: "0 من crt.sh" };\n    },\n  },`;
  const helper = `  "recon.z": {\n    id: "recon.z",\n    titleAr: "أسماء من crt.sh",\n    run: async () => ctLogNames("a"),\n  },`;
  const defs = new Map([["ctLogNames", 'function ctLogNames(){ return fetch("https://crt.sh/?q=x"); }']]);
  const a = violationsFor(good, defs);
  const b = violationsFor(cheat, defs);
  const c = violationsFor(helper, defs);
  const ok = a.length === 0 && b.length === 1 && c.length === 0;
  console.log(ok ? "✓ selftest: المصدر المطالب عدّى، تسمية الدليل اترفضت، والدالة المحلولة عدّت" : `✗ selftest فشل: good=${a.length} cheat=${b.length} helper=${c.length}`);
  process.exit(ok ? 0 : 1);
}

function run() {
  const src = readSrc(TOOLS);
  if (!src) {
    console.log("✗ audit-source-claims: ملقيتش ops/tools.ts");
    process.exit(1);
  }
  const v = violationsFor(src, helperProof(src));
  const n = kindBlocks(src).length;
  const hard = v.filter((x) => !x.waived);
  const waived = v.filter((x) => x.waived);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ok: hard.length === 0, kinds: n, violations: v }, null, 2));
  } else if (hard.length) {
    for (const x of hard) console.log(`  · ${x.id}:${x.line} — ${x.why}`);
    console.log(`✗ audit-source-claims: ${hard.length} kind بيحكوا عن مصدر ومابيعملوش (${n} kind متفحّص)`);
  } else {
    console.log(`✓ audit-source-claims: ${n} kind — ولا مصدر اتقال عليه وماتبسألهوش${waived.length ? ` (${waived.length} استثناء مكتوب)`.replace("(", " (") : ""}`);
  }
  process.exit(hard.length ? 1 : 0);
}

// بيشتغل لما يتنادي من الـCLI بس — عشان التستات والـnode -e يقدروا يستوردوا
// violationsFor من غير ما الشغل يتنفّذ ويعمل exit قبل الرد.
const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (main) {
  if (process.argv.includes("--selftest")) selftest();
  else run();
}
