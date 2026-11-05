#!/usr/bin/env node
/*
 * audit-twins — الملفات المتطابقة بالنسخ بين المحرك واللوحة.
 *
 * المنصة اتبنيت بنائين: `artifacts/api-server` (السيرفر الكامل) و`artifacts/kali-panel`
 * (الواجهة، وبتشغل لوحدها على GitHub Pages من غير أي سيرفر). عشان النسخة الساكنة تفضالها
 * نفس العقد، ثلاثة ملفات متكررين **بايت-بايت** بين البناءين. التكرار ده مقصود، لكنه أخطر
 * من الحذف: أي إصلاح في نسخة واحدة بس = الواجهة المنشورة بتردّ بشكل مختلف عن المحرك، وده
 * بالظبط اللي حصل لشات Multi-AI (2026-11-02): المسار كان موجود في `routes/` ومحذوف من
 * `standalone-api.ts`، فالصفحة العامة رجّعت فقاعة فاضية والقياس على راينر كان أخضر.
 *
 * القواعد:
 *   1) كل ملف في TWINS لازم يفضل متطابق الحرفين — لو اختلفنفشل ونطبع أول سطر فرق.
 *   2) أي ملف بنفس الاسم في الاتنين ومختلف لازم يكون مُصرّح بيه في DRIFT_OK مع سبب.
 *   3) ملف مشترك جديد مش في أيّ القايمتين = فشل، عشان الانحراف ما يحصلش في silence.
 *
 *   node scripts/audit-twins.mjs        exit 0 نظيف · 1 انحراف/توائم مكسورة
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_LIB = path.join(ROOT, "artifacts/api-server/src/lib");
const PANEL_LIB = path.join(ROOT, "artifacts/kali-panel/src/lib");

// متطابق بايت-بايت: أي تعديل لازم يحصل في الاتنين في نفس الـcommit.
const TWINS = ["standalone-api.ts", "cyber-corpus-2099.ts", "live-vuln-ingestor.ts"];

// اختلاف مقصود — نفس الاسم، طبقتان مختلفتان فعلاً.
const DRIFT_OK = {
  "awareness.ts": "السيرفر بيقيس حالتها (probes/كتابة state)، اللوحة بتقرأ الـsnapshot بس — العقد مشترك والمنطق لا",
  "corpus-live.ts": "نفس السطح (snapshot/loadLive/total) على مصدرين: السيرفر بيقرأ ملف الكوربوس المُنزَّل من الديسك، والمتصفح بيجيب نفس الملف بـfetch — الشكل متطابق والتنفيذ لازم يختلف",
};

const rel = (p) => path.relative(ROOT, p);
const walk = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    : [];

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const lines = (p) => fs.readFileSync(p, "utf8").split(/\r?\n/);

const serverFiles = new Set(walk(SERVER_LIB));
const panelFiles = new Set(walk(PANEL_LIB));
const shared = [...serverFiles].filter((f) => panelFiles.has(f)).sort();

const problems = [];
const rows = [];

for (const f of TWINS) {
  const a = path.join(SERVER_LIB, f);
  const b = path.join(PANEL_LIB, f);
  if (!fs.existsSync(a) || !fs.existsSync(b)) {
    problems.push(`التوأم ${f} ناقص (${fs.existsSync(a) ? "اللوحة" : "السيرفر"} ملوش نسخة)`);
    continue;
  }
  if (sha(a) === sha(b)) {
    rows.push({ f, verdict: "identical", size: lines(a).length });
  } else {
    const la = lines(a), lb = lines(b);
    let first = -1;
    for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) { first = i + 1; break; }
    problems.push(
      `التوأم ${f} اتفصل! أول فرق في سطر ${first}\n` +
        `    السيرفر: ${String(la[first - 1] ?? "<الملف أقصر>").trim().slice(0, 90)}\n` +
        `    اللوحة : ${String(lb[first - 1] ?? "<الملف أقصر>").trim().slice(0, 90)}\n` +
        `    مفيش مبرر أسوأ من «نسخت في نسخة»: النسخة الساكنة دي اللي بتورّي المستخدم على اللينك العام.`,
    );
  }
}

for (const f of shared) {
  if (TWINS.includes(f)) continue;
  const identical = sha(path.join(SERVER_LIB, f)) === sha(path.join(PANEL_LIB, f));
  if (identical) {
    problems.push(
      `${f} بقى متطابق بالحرف مع نسخة السيرفر وهو مش في TWINS —امّا تنقله لقايمـة TWINS (لو العقد مشترك فعلاً) ` +
        `وامّا تفصّل كل نسخة لوحدها. التطابق الصامت هو اللي بيخلي الإصلاح ينسي في نصه.`,
    );
  } else if (!DRIFT_OK[f]) {
    problems.push(
      `${f} نفس الاسم في البناءين ومختلف — ومفيش تصريح. لو الاختلاف مقصود ضيفه في DRIFT_OK مع سبب من سطر، ` +
        `ولو لأ فده انحراف تسرّب (نفس شكل عطل Multi-AI).`,
    );
  } else {
    rows.push({ f, verdict: "declared drift", size: lines(path.join(SERVER_LIB, f)).length });
  }
}

for (const r of rows) console.log(`  ✓ ${r.f.padEnd(24)} ${String(r.size).padStart(5)} سطر · ${r.verdict}`);
if (Object.keys(DRIFT_OK).some((f) => !shared.includes(f))) {
  problems.push(`قايمتنا فيها تصريح لملف مش موجود فعلاً في الاتنين: ${Object.keys(DRIFT_OK).filter((f) => !shared.includes(f)).join(", ")}`);
}
if (problems.length) {
  console.error(`\n❌ audit-twins: ${problems.length} مشكلة\n` + problems.map((p) => `· ${p}`).join("\n"));
  process.exit(1);
}
console.log(
  `\n✅ audit-twins — ${TWINS.length} توأم متطابق، ${Object.keys(DRIFT_OK).length} انحراف مصرّح بيه، ` +
    `${shared.length} ملف مشترك مصنّف (${rel(SERVER_LIB)} ↔ ${rel(PANEL_LIB)})`,
);
