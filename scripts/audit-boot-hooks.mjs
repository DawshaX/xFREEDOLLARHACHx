#!/usr/bin/env node
/**
 * audit-boot-hooks — العضلة اللي اتكتبت وما إتلحمتش بالماكينات
 * ─────────────────────────────────────────────────────────────
 * الحقّ ده حصل مرتين في المستودع وولاّ من غير ما حد ياخد باله:
 *
 * 1) `nova-cron.ts` فيه 6 مهام حقيقية، و`startCronScheduler()` ما اتنادتش في أي
 *    ملف. الصفحة اللي تعرض `runCount` كانت بتعرض صفر حقيقي لشهر كامل.
 * 2) `startWatchers()` اتنادت — بس جوه `if (process.env.DATABASE_URL)`. المكنة
 *    الحيّة (nova.waifly.com) شغالة standalone، فالقياس الحيّ رجّع
 *    `enabled:false · startedAt:null`. الكود شغال، والماكينه اللي بنشر لها
 *    ما بشغّلهوش.
 *
 * القاعدتين:
 *   B1  أي `start*` exported في `src/lib/**` بيتنادى في `index.ts` بس من داخل فرع
 *       الـDB (أو من داخل الـelse بتاعه) = تعليق على وضع واحد، ولازم سبب مكتوب.
 *   B2  أي `start*` exported في `src/lib/**` و`index.ts` ما بيعرفوش خالص = عضلة
 *       ميتة، أو متصدّاة للعميل بس — ولازم تبقى في القايمة بوضوح.
 *
 * القايمة: state/boot-hooks-allowlist.json — كل سطر فيها لازم `why`؛ بوابة بدون
 * ناب = ديكور، وقايمة من غير سبب = سلة.
 *
 *   node scripts/audit-boot-hooks.mjs
 *   node scripts/audit-boot-hooks.mjs --selftest
 *   node scripts/audit-boot-hooks.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "artifacts/api-server/src");
const ENTRY = path.join(SRC, "index.ts");
const ALLOW = path.join(ROOT, "state/boot-hooks-allowlist.json");
const asPosix = (p) => p.split(path.sep).join("/");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "vendor") continue;
    const s = path.join(dir, e.name);
    if (e.isDirectory()) walk(s, out);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(s);
  }
  return out;
}

/** قوس-لماتش: يرجّع [begin,end] محتوى الـblock اللي بعد `cond`، أو null. */
function blockSpan(src, condRe) {
  const m = condRe.exec(src);
  if (!m) return null;
  const open = src.indexOf("{", m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return [open, i];
    }
  }
  return null;
}

function readAllowlist() {
  const empty = { allow: [], note: null };
  if (!fs.existsSync(ALLOW)) return empty;
  try {
    const doc = JSON.parse(fs.readFileSync(ALLOW, "utf8"));
    const list = Array.isArray(doc.allow) ? doc.allow : [];
    for (const it of list) {
      if (!it?.call || !it?.why || String(it.why).trim().length < 8) {
        console.error(`✗ ${asPosix(path.relative(ROOT, ALLOW))}: سطر «${it?.call ?? "?"}» من غير «why» كافي — القايمة مش سلة`);
        process.exit(1);
      }
    }
    return { allow: list, deadOk: Array.isArray(doc.deadOk) ? doc.deadOk : [], note: doc.noteAr ?? null };
  } catch (e) {
    console.error(`✗ ${asPosix(path.relative(ROOT, ALLOW))}: مش JSON صالح — ${e.message}`);
    process.exit(1);
  }
}

function analyze(entrySrc, libHooks, srcRefs = new Map()) {
  const db = blockSpan(entrySrc, /if\s*\(\s*process\.env\.DATABASE_URL\s*\)/);
  const standalone = blockSpan(entrySrc, /\}\s*else\s*\{\s*\n\s*logger\.info\("Running in standalone/);
  const findings = [];
  for (const hook of libHooks) {
    const callRe = new RegExp(`\\b${hook}\\s*\\(`, "g");
    const sites = [];
    for (const m of entrySrc.matchAll(callRe)) sites.push(m.index);
    if (sites.length === 0) {
      // «مفيش في index.ts» لوحدها مش كفاية: في hooks بتتنادى من routes (startJobPump)
      // أو من أداة (startProcess). الميت فعلًا هو اللي مفيش له استدعاء في src كله.
      if ((srcRefs.get(hook) ?? 0) > 0) continue;
      findings.push({ hook, kind: "B2", where: "صفر استدعاء في src كله — حلقة مكتوبة ومهملة" });
      continue;
    }
    const inDb = db ? sites.filter((i) => i > db[0] && i < db[1]).length : 0;
    const inStandalone = standalone ? sites.filter((i) => i > standalone[0] && i < standalone[1]).length : 0;
    // التعليق على فرع واحد من الوضعين = العضلة دي نصف ماكنة بس
    if (db && inDb > 0 && inDb === sites.length - inStandalone) {
      findings.push({ hook, kind: "B1", where: `${asPosix(path.relative(ROOT, ENTRY))}:branch=DATABASE_URL only` });
    }
  }
  return findings;
}

/* ── selftest: ناب البوابة نفسها ───────────────────────────────────────────── */
if (process.argv.includes("--selftest")) {
  const fixtures = [
    {
      name: "hook inside the DB branch only → B1",
      entry: `if (process.env.DATABASE_URL) {\n  try { startVoices(); } catch {}\n} else {\n  logger.info("Running in standalone mode (no DATABASE_URL configured)");\n}`,
      hooks: ["startVoices"],
      refs: { startVoices: 1 },
      expect: ["B1"],
    },
    {
      name: "hook outside the branch → clean",
      entry: `try { startVoices(); } catch {}\nif (process.env.DATABASE_URL) {\n  try { startDbCron(); } catch {}\n} else {\n  logger.info("Running in standalone mode (no DATABASE_URL configured)");\n}`,
      hooks: ["startVoices", "startDbCron"],
      refs: { startVoices: 1, startDbCron: 1 },
      expect: ["B1"], // startDbCron جوه الفرع بس — كمان لازم يترفع
    },
    {
      name: "hook never called → B2",
      entry: `const a = 1;\nif (process.env.DATABASE_URL) {\n  logger.info("db");\n}`,
      hooks: ["startJobs"],
      refs: {},
      expect: ["B2"],
    },
  ];
  let bad = 0;
  for (const f of fixtures) {
    const got = [...new Set(analyze(f.entry, f.hooks, new Map(Object.entries(f.refs ?? {}))).map((x) => x.kind))].sort();
    const ok = JSON.stringify(got) === JSON.stringify([...f.expect].sort());
    console.log(`${ok ? "✓" : "✗"} ${f.name.padEnd(46)} توقّعت [${f.expect}] · لقيت [${got}]`);
    if (!ok) bad++;
  }
  console.log(bad ? `\n✗ selftest: ${bad} حالة فاشلة` : "\n✅ selftest — البوابة بتمسك الفرع الواحد والعضلة الميتة");
  process.exit(bad ? 1 : 0);
}

const entry = fs.readFileSync(ENTRY, "utf8");
const hookNames = new Set();
for (const file of walk(SRC)) {
  const t = fs.readFileSync(file, "utf8");
  for (const m of t.matchAll(/export (?:async )?function (start[A-Z][A-Za-z0-9_]*)/g)) hookNames.add(m[1]);
}
const { allow, deadOk: deadOkList } = readAllowlist();
const allowed = new Map(allow.map((x) => [x.call, x]));
const srcRefs = new Map();
for (const file of walk(SRC)) {
  const t2 = fs.readFileSync(file, "utf8");
  for (const h of hookNames) {
    // نستثني ملف التعريف نفسه (وسطر التصدير) من العد
    const inDef = file.endsWith(`/${h}.ts`) || file.includes(h.replace(/^start/, "").toLowerCase());
    const calls = [...t2.matchAll(new RegExp(`\\b${h}\\s*\\(`, "g"))].length;
    const defs = [...t2.matchAll(new RegExp(`export (?:async )?function ${h}\\b`, "g"))].length;
    const own = file === ENTRY ? 0 : Math.max(0, calls - defs - (inDef ? 0 : 0));
    srcRefs.set(h, (srcRefs.get(h) ?? 0) + own);
  }
}
const deadOk = new Map((deadOkList).map((x) => [x.call, x]));
const findings = analyze(entry, [...hookNames].sort(), srcRefs).filter((f) => !allowed.has(f.hook) && !deadOk.has(f.hook));

const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(JSON.stringify({ hooks: hookNames.size, allowed: allow.length, findings }, null, 2));
} else {
  console.log("audit-boot-hooks — كل `start*` لازم تلحق بالماكينات اللي المفروض تعيش عليها");
  console.log(`· hooks في src/lib: ${hookNames.size} · مستثنى بسبب مكتوب: ${allow.length + deadOkList.length}`);
  for (const f of findings) console.log(`  · ${f.kind}  ${f.hook}  —  ${f.where}`);
  if (findings.length === 0) console.log(`✅ مافيش عضلة موصولة بنص الطريق ولا ميتة (${hookNames.size} hook)`);
  else console.log(`\n✗ ${findings.length} مشكلة إقلاع — الحل: انادي الـhook برّه الفروع، أو ضيفه في ${asPosix(path.relative(ROOT, ALLOW))} بـ why حقيقي.`);
}
process.exit(findings.length ? 1 : 0);
