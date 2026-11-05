#!/usr/bin/env node
/**
 * audit-route-integrity — الطبقات موصولة فعلاً، مش بتبدو موصولة.
 * ──────────────────────────────────────────────────────────────────────────
 * أربع حاجات اتقاسوا على.realbugs في هذا المستودع، وكل واحد هنا عشان يتكرر:
 *
 * 1) **رمز بيتنادى من غير ما يتستورد** — PR #210 نادت `runAgent(...)` جوه
 *    `live-agent.ts` من غير import: TS2304 في الـcatch، وفي التشغيل
 *    `ReferenceError` جوه الـcatch → الفقاعة كانت بترجع لنص جاهز («الشات عبيط»).
 *    الراتشيه عدّت الرقم (98 مقابل 96) بسببها، فالرقم وحده مش كفاية: اللازم
 *    الكلمة تبقى مربوطة بالمصدر اللي بيصدّرها.
 * 2) **يد بتلمّ المكنة من غير بوابة** — `POST /installer/tools/:id/install` كان
 *    `spawn("/bin/sh", ["-c", installCommand])` بتاع سطر من الداتابيز، ومفتوح
 *    للعامة. ونفس الشكل في `/nova/scheduler/run` و`/nova/workspace/{exec,write}`.
 *    أي handler بيعدّل القرص/يشغّل عملية لازم يكون فيه قرار إذن في نصه.
 * 3) **حزمة فاضية من بياناتها** — `hunt/candidates` كانت بتقول `present:false`
 *    على nova.waifly.com لأن `ops/` اتنسي من `build-standalone.mjs`: الكود نازل
 *    واللي بيقراه مش نازل. فكل مسار بيانات بيتقرا من `src/**` لازم الي باندر
 *    يعدياته (بالاسم أو بالمجلد اللي جواه).
 * 4) **توأم بيّفبرك نجاح** — الباندل الثابت كان بيردّ على تثبيت الأدوات
 *    `installed:true, version:"2026.1-kali"`. في طبقة مافيهاش تنفيذ، النجاح
 *    ادعاء، فممنوع.
 *
 * `--selftest` بيحقن كل واحدة من الانهيارات الأربعة في شجرة مؤقتة وبيتأكد
 * إن الجيت بيشوفها: جيت مابيحمرش على حاجة محقونة مش جيت.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ── shared helpers ───────────────────────────────────────────────────────── */

function listTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * يشيل الكومنتات والنصوص النصية مع الحفاظ على عدد السطور، عشان اسم
 * جوه سطر «// runAgent(…)» مايبقاش مخالفة، والسطر المعروض يضلّ صحيح.
 */
function stripNoise(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && src.slice(i, i + 2) !== "*/") {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        if (src[i] === "\n") out += "\n";
        i++;
      }
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/* ── 1) spine symbols ─────────────────────────────────────────────────────── */

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "typeof", "function", "constructor", "super", "await", "new", "delete", "void", "in", "of", "do", "else", "throw", "yield", "import", "export"]);

function collectExports(files, root) {
  const map = new Map(); // name -> [relfile]
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const rel = relative(root, f);
    for (const m of src.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (!map.has(m[1])) map.set(m[1], []);
      map.get(m[1]).push(rel);
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
          if (!map.has(name)) map.set(name, []);
          map.get(name).push(rel);
        }
      }
    }
  }
  return map;
}

function importedNames(src) {
  const set = new Set();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name) set.add(name);
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|\bfrom\b)/g)) set.add(m[1]);
  for (const m of src.matchAll(/import\s*\*\s*as\s*([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  // الاستيراد الديناميكي بيوفّر الرموز كده: `import("./x").then(({ a, b }) => …)`
  // و`const { a } = await import("./x")`. من غيرهم الفاحص بيغلط على novaRagV2.ts
  // (اتلمس فعلاً: getOllamaBaseUrl جوه destructuring — مافيش خطأ هناك).
  for (const m of src.matchAll(/import\([^)]*\)\s*(?:\.|,)\s*[\s\S]{0,40}?\(\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/[:=]/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) set.add(name);
    }
  }
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?import\s*\(/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/[:=]/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) set.add(name);
    }
  }
  return set;
}

function localDecls(src) {
  const set = new Set();
  for (const m of src.matchAll(/(?:^|\s)(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  for (const m of src.matchAll(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) set.add(m[1]);
  for (const m of src.matchAll(/(?:^|\s)(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/[:=]/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) set.add(name);
    }
  }
  for (const m of src.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  return set;
}

function auditSpineSymbols(root) {
  const v = [];
  const apiSrc = join(root, "artifacts/api-server/src");
  const spine = collectExports(listTs(join(apiSrc, "lib")), root);
  // الطبقتين مع بعض: الغلطة دي حصلت في route (#210) وممكن تحصل في lib زيها —
  // والـcall اللي جوه catch بيبلع الـReferenceError الاتنين.
  const scanned = [...listTs(join(apiSrc, "routes")), ...listTs(join(apiSrc, "lib"))];
  for (const f of scanned) {
    const raw = readFileSync(f, "utf8");
    const code = stripNoise(raw);
    const have = new Set([...importedNames(raw), ...localDecls(raw)]);
    const rel = relative(root, f);
    for (const m of code.matchAll(/(^|[^.\w$:])\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (!name || KEYWORDS.has(name) || have.has(name)) continue;
      const where = spine.get(name);
      if (!where) continue;
      v.push({
        check: "spine-symbol",
        file: rel,
        line: lineOf(raw, m.index + m[0].indexOf(name)),
        msg: `«${name}(» بيتنادى من ${rel} ومنستوردة — وهي متصدّرة في ${where.slice(0, 2).join(" · ")}. لو الـcall جوه catch هترجع ReferenceError والرسالة بتتبلّع.`,
      });
      have.add(name); // مخالفة واحدة لكل اسم في الملف، مش سطر بسطر
    }
  }
  return v;
}

/* ── 2) host-touching handlers must carry an authz decision ───────────────── */

// «اللي بيلمّ المكنة» مش دايمًا اسمه spawn: `/kali-command/server/exec` بياخد
// `exec` مستورد باسم `execCmd`، و`/agent/exec` بينفّذ على جهاز المستخدم
// بـ`execStreamOnLocalAgent`. فالقائمة دي اسماء helpers بتاع البيت + أي استدعاء
// لـ`exec*`/`spawn*`/`fork` عاري + كتابة على القرص.
const HOST_TOUCH = /(?:^|[^.\w$])(?:spawn|spawnSync|execSync|execFileSync|execFile|exec)\w*\s*\(|\b(?:fs\.)?(?:writeFileSync|appendFileSync|rmSync|unlinkSync)\s*\(|(?:execOnLocalAgent|execStreamOnLocalAgent|runCommand|runOnServer)\s*\(|import\(\s*["']child_process["']\s*\)/;
const AUTHZ = /requireOps|checkGate|opsAllowed|assertAuthorized|assertPublicHost|tokenOk|isAuthorized|requireToken|authorizedFor|assertOps|unauthorized|status\(\s*40[13]/;

function auditHostGates(root) {
  const v = [];
  for (const f of listTs(join(root, "artifacts/api-server/src/routes"))) {
    const raw = readFileSync(f, "utf8");
    if (!HOST_TOUCH.test(stripNoise(raw))) continue;
    const rel = relative(root, f);
    // حارس اختياري على مستوى الملف: `router.use(...)` اللي بياخد قرار إذن
    // جوه الـ900 حرف اللي بعده. بنشوفه قبل الهاندور بس — نفس اللي في
    // /installer و/live-agent.
    const guardAt = raw.search(/router\.use\s*\([\s\S]{0,900}?(requireOps|checkGate|tokenOk|opsAllowed|assertAuthorized)/);
    for (const m of raw.matchAll(/router\.(post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      const start = m.index;
      const end = matchingBrace(raw, raw.indexOf("{", start));
      if (end < 0) continue;
      const body = stripNoise(raw.slice(start, end + 1));
      if (!HOST_TOUCH.test(body)) continue;
      if (AUTHZ.test(body) || (guardAt >= 0 && guardAt < start)) continue;
      v.push({
        check: "host-touch-ungated",
        file: rel,
        line: lineOf(raw, start),
        msg: `${m[1].toUpperCase()} ${m[2]} بيلمس المكنة (${HOST_TOUCH.exec(body)[0].trim().slice(0, 24)}) ومن غير أي قرار إذن في الـhandler — حطّه ورا requireOps("<scope>") زي "/installer" و"/api/local-agent".`,
      });
    }
  }
  return v;
}

function matchingBrace(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ── 3) no hollow bundles ─────────────────────────────────────────────────── */

const RUNTIME_DATA = /["'`]((?:ops|corpus|kali)\/[A-Za-z0-9_./-]*\.(?:json|ya?ml|yml|csv|txt))["'`]/g;

function auditHollowShip(root) {
  const v = [];
  const bundlerPath = join(root, "scripts", "build-standalone.mjs");
  if (!existsSync(bundlerPath)) {
    return [{ check: "hollow-ship", file: "scripts/build-standalone.mjs", line: 0, msg: "الباندر مش موجود — مافيش ضمان إن الحزمة فيها أي حاجة" }];
  }
  const bundler = readFileSync(bundlerPath, "utf8");
  const wanted = new Map(); // relpath -> {file,line}
  for (const f of listTs(join(root, "artifacts/api-server/src"))) {
    const raw = readFileSync(f, "utf8");
    for (const m of raw.matchAll(RUNTIME_DATA)) {
      const rel = m[1];
      if (!wanted.has(rel)) wanted.set(rel, { file: relative(root, f), line: lineOf(raw, m.index) });
    }
  }
  for (const [rel, at] of wanted) {
    const base = rel.split("/").pop();
    const top = rel.split("/")[0];
    const covered = bundler.includes(base) || new RegExp(`["'\`]${top}["'\`]`).test(bundler) || bundler.includes(`"${rel}"`);
    if (!covered) {
      v.push({
        check: "hollow-ship",
        file: at.file,
        line: at.line,
        msg: `المحرك بيقرأ «${rel}» وقت التشغيل، بس scripts/build-standalone.mjs مابينسخوش — على الحزمة المنشورة الميزة هتردّ «مش موجودة» حتى لو الكود نازل (اللي حصل لـops/bounty/programs-catalog.json).`,
      });
    }
  }
  return v;
}

/* ── 4) twins must not fabricate success ─────────────────────────────────── */

// مافيش في الباندل الثابت لا process ولا شبكة ولا قرص سيرفر، فأي تأكيد إن
// حاجة اتنفّذت أو اتقاست = اختلاق بيقرأه المستخدم نتيجة. القواعد دي اتكتبّت من
// المواضع الخمسة اللي اتلقّت فعلًا (install/nmap report/webfetch 200/system run
// stdout/node exec «completed») — والقرب من `stdout:` محسوب لأن ده شكل الرد.
const FABRICATED = [
  { re: /installed:\s*true/, why: "تأكيد تثبيت على مكنة مابتنزّلش حاجة" },
  { re: /version:\s*"2026\.1-kali"/, why: "إصدار مختلق لأداة متفحصهاش" },
  { re: /output:\s*"\[\+\]/, why: "مُخرجات `[+]` مزيفة" },
  { re: /Nmap scan report for/, why: "تقرير nmap لهدف مافيش فحص اتعمل له" },
  { re: /Verified HTTP 200/, why: "تأكيد جلب صفحة من غير ما الشبكة تتلمس" },
];
const NEAR = [{ re: /ok:\s*true/, tail: /\bstdout:/, within: 260, why: "`ok:true` ومعاها `stdout` — تأكيد تنفيذ" }];

function auditTwinHonesty(root) {
  const v = [];
  const twins = ["artifacts/api-server/src/lib/standalone-api.ts", "artifacts/kali-panel/src/lib/standalone-api.ts"];
  for (const rel of twins) {
    const f = join(root, rel);
    if (!existsSync(f)) continue;
    const raw = readFileSync(f, "utf8");
    const code = stripNoise(raw);
    const hits = [];
    for (const { re, why } of FABRICATED) {
      const m = code.match(re); // الكومنت مابيتحسبش: الشرح بيحكّي عن الفبركة، مش بيفبرك
      if (m) hits.push({ m, why });
    }
    for (const rule of NEAR) {
      for (const mm of code.matchAll(new RegExp(rule.re.source, "g"))) {
        const win = code.slice(mm.index, mm.index + rule.within);
        const t = win.match(rule.tail);
        if (!t) continue;
        hits.push({ m: { 0: mm[0], index: mm.index }, why: `${rule.why} في الرد الثابت` });
        break;
      }
    }
    for (const { m, why } of hits) {
      {
      v.push({
        check: "twin-fabrication",
        file: rel,
        line: lineOf(raw, m.index),
        msg: `الباندل الثابت مالوش تنفيذ: «${String(m[0]).slice(0, 34)}» — ${why}. ` +
          `الرد لازم يبقى {ok:false, error:"no_execution_plane", reasonAr, howAr} — المستخدم بيقرأ الفقاعة وبيصدّقها.`,
      });
    }
    }
  }
  return v;
}

/* ── run ──────────────────────────────────────────────────────────────────── */

export function auditAll(root) {
  return [...auditSpineSymbols(root), ...auditHostGates(root), ...auditHollowShip(root), ...auditTwinHonesty(root)];
}

function selftest() {
  const work = mkdtempSync(join(tmpdir(), "nova-integrity-"));
  const w = (rel, text) => {
    const p = join(work, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, "utf8");
    return p;
  };
  try {
    w("artifacts/api-server/src/lib/thing.ts", "export function runSpine(a: unknown) { return a; }\n");
    w(
      "artifacts/api-server/src/routes/bad.ts",
      'import { Router } from "express";\nconst router = Router();\nrouter.post("/bad", (req, res) => res.json(runSpine(req.body)));\nexport default router;\n',
    );
    const s = auditSpineSymbols(work);
    assert.equal(s.length, 1, `spine: expected 1 violation, got ${s.length}`);
    assert.match(s[0].msg, /runSpine/);

    w(
      "artifacts/api-server/src/routes/spawn-bad.ts",
      'import { Router } from "express";\nimport { spawn } from "child_process";\nconst router = Router();\nrouter.post("/run-it", (req: any, res: any) => {\n  spawn("/bin/sh", ["-c", req.body.command]);\n  res.json({ ok: true });\n});\nexport default router;\n',
    );
    const h = auditHostGates(work);
    assert.ok(h.some((x) => x.file.endsWith("spawn-bad.ts")), "host gate: injected spawn wasn't caught");

    w("artifacts/api-server/src/routes/reader.ts", 'import fs from "node:fs";\nconst x = () => fs.readFileSync("ops/bounty/secret-catalog.json", "utf8");\nexport default x;\n');
    w("scripts/build-standalone.mjs", 'fs.copyFileSync("public/index.html", "out/index.html");\n');
    const sh = auditHollowShip(work);
    assert.ok(sh.some((x) => x.msg.includes("ops/bounty/secret-catalog.json")), "hollow-ship: injected runtime data wasn't caught");
    w("scripts/build-standalone.mjs", 'for (const rel of ["ops"]) copyDir(rel);\nfs.copyFileSync("public/index.html", "out/index.html");\n');
    assert.equal(auditHollowShip(work).length, 0, "hollow-ship: directory-level copy should cover its files");

    w("artifacts/api-server/src/lib/standalone-api.ts", 'export const r = { ok: true, installed: true, version: "2026.1-kali" };\n');
    w("artifacts/kali-panel/src/lib/standalone-api.ts", 'export const r = { ok: true, installed: true };\n');
    const t = auditTwinHonesty(work);
    assert.equal(new Set(t.map((x) => x.file)).size, 2, `twin honesty: both twins must be flagged, got ${t.length} hit(s)`);
    assert.ok(t.every((x) => x.check === "twin-fabrication"));
    // ضرس جديد: ok:true + stdout في نفس الرد (مش غير `installed:true`)
    w("artifacts/api-server/src/lib/standalone-api.ts", 'export const r = { ok: true, command: cmd, stdout: `kali@box$ ${cmd}`, exitCode: 0 };\n');
    w("artifacts/kali-panel/src/lib/standalone-api.ts", 'export const r = { ok: true };\n');
    const t2 = auditTwinHonesty(work);
    assert.ok(t2.some((x) => x.msg.includes("تأكيد تنفيذ")), "قاعدة ok:true+stdout ماتبينتشي");

    // والإنصاف: الملف السليم لازم يعدي
    w("artifacts/api-server/src/routes/bad.ts", 'import { Router } from "express";\nimport { runSpine } from "../lib/thing";\nconst router = Router();\nrouter.post("/bad", (req, res) => res.json(runSpine(req.body)));\nexport default router;\n');
    assert.equal(auditSpineSymbols(work).length, 0, "spine: an imported symbol must not be flagged");
    console.log("✓ selftest — الحقن الأربعة كلها اتشافت، والملف السليم عدّى");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const onlySelftest = process.argv.includes("--selftest");
if (onlySelftest) {
  selftest();
  process.exit(0);
}

const violations = auditAll(ROOT);
const byCheck = new Map();
for (const x of violations) byCheck.set(x.check, (byCheck.get(x.check) || 0) + 1);
for (const [check, n] of byCheck) console.log(`· ${check.padEnd(22)} ${n}`);
if (!violations.length) {
  console.log("✅ audit-route-integrity — الرمز مستورد، اليد متبوّبة، الحزمة فيها بياناتها، والتوأم بيفبركش");
  process.exit(0);
}
console.log(`\n✗ ${violations.length} مخالفة سلامة طبقات:`);
for (const x of violations.slice(0, 40)) console.log(`  ${x.file}:${x.line}  [${x.check}] ${x.msg}`);
if (violations.length > 40) console.log(`  … و${violations.length - 40} تانية`);
process.exit(1);
