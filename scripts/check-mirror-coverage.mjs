// check-mirror-coverage.mjs — مين وعد بإيه، ومين فعلاً موجود
// -------------------------------------------------------------
// الدرس اللي علمهولنا شغل النهارده: الريان كان أخضر والمرآة فيها 12 أداة
// والمكنة بتوعد بـ16. «12/12» في نص الريان معناه إن الحارس كان بيقارن
// الأداة بنفسها (TOOLS.length) — مش بالوعد اللي في التطبيق (VENDORABLE).
// يعني الرقم كان متسق جوه المصدر الواحد وكذاب عبر المصدرين. السكربت ده
// بيقرا التلات مصادر ويوقف أي انحراف بينهم:
//
//   1) artifacts/api-server/src/lib/ops/toolchain.ts → VENDORABLE (وعد المكنة)
//   2) scripts/fetch-toolchain.mjs                  → TOOLS      (ليستا للباني)
//   3) out/mirror/nova-toolchain.json               → tools[]    (اللي اتحزن فعلًا)
//
// قاعدة 1: كل أداة في الوعد لازم تكون في الليستا للباني (وإلا المكنة هتفضل
//          تستنى حاجة مش هتتبنى أبدًا).
// قاعدة 2: لو المانيفست موجود، كل أداة في الوعد لازم تكون جوه المانيفست
//          و`total` ما يقلش عن عدد الوعد (وإلا المرآة منشورة ناقصة والريان أخضر).
// قاعدة 3: المانيفست ما ينفعش يكون فاضي/بلا أدوات.
//
// الاستخدام:
//   node scripts/check-mirror-coverage.mjs                 ← offline (قاعدة 1 بس)
//   node scripts/check-mirror-coverage.mjs --manifest P    ← + قاعدة 2 و3
//   node scripts/check-mirror-coverage.mjs --json
//   node scripts/check-mirror-coverage.mjs --selftest      ← اختبار بالـfixtures
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CAT = "artifacts/api-server/src/lib/ops/toolchain.ts";
const BUILDER = "scripts/fetch-toolchain.mjs";

/** يقطع كتلة `[ ... ]` من سطر الإعلان لحد سطر `]` مقفل (مسموح `.filter(...)` بعده). */
function blockOf(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return null;
  const end = src.indexOf("\n]", start);
  if (end < 0) return null;
  return src.slice(start, end);
}

/**
 * أسماء الأدوات جوّه كتلة: بيدعم الشكلين اللي عندنا فعلاً —
 * `{ bin: "x", ... }` في `fetch-toolchain.mjs` و`"x"` الخام في كتالوج المكنة.
 * سطور التعليقات بتتخطى، ولو مفيش `bin:` بنقرأ الأقواس المنفردة.
 */
export function namesFrom(src, decl) {
  const b = blockOf(src, decl);
  if (b === null) return null;
  const out = [];
  for (const line of b.split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    const m = /\bbin:\s*"([^"]+)"/.exec(line) || /^"?([a-z][a-z0-9._-]*)"?,?$/.exec(t);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function check({ repo = REPO, manifestPath = null } = {}) {
  const errors = [];
  const catSrc = readFileSync(join(repo, CAT), "utf8");
  const buildSrc = readFileSync(join(repo, BUILDER), "utf8");
  const promised = namesFrom(catSrc, "export const VENDORABLE = [");
  const buildable = namesFrom(buildSrc, "const TOOLS = [");
  if (!promised?.length) errors.push(`مفيش VENDORABLE مقروء في ${CAT}`);
  if (!buildable?.length) errors.push(`مفيش TOOLS مقروءة في ${BUILDER}`);

  const missingInBuilder = (promised || []).filter((b) => !(buildable || []).includes(b));
  if (missingInBuilder.length)
    errors.push(`المكنة بتوعد بـ${promised.length} أداة، والليستا للباني فيها ${buildable.length} — الناقص من الباني: ${missingInBuilder.join(", ")}`);

  let manifest = null;
  if (manifestPath) {
    if (!existsSync(manifestPath)) errors.push(`المانيفست مش موجود: ${manifestPath}`);
    else {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (e) {
        errors.push(`المانيفست مش JSON: ${e.message}`);
      }
    }
  }
  if (manifest) {
    const have = (manifest.tools || []).map((t) => t?.name).filter(Boolean);
    if (!have.length) errors.push("المانيفست اتبنى من غير أي أداة — أحسن حاجة نلغي النشر.");
    const missing = (promised || []).filter((b) => !have.includes(b));
    if (missing.length)
      errors.push(`المرآة منشورة ناقصة: فيها ${have.length} من ${promised.length} — الناقص: ${missing.join(", ")}`);
    if (typeof manifest.total === "number" && promised?.length && manifest.total < promised.length)
      errors.push(`total=${manifest.total} أقل من الوعد ${promised.length} — حارس الريان بيقارن الرقم بنفسه.`);
  }
  return {
    ok: errors.length === 0,
    errors,
    promised: promised || [],
    buildable: buildable || [],
    packed: manifest ? (manifest.tools || []).map((t) => t?.name).filter(Boolean) : null,
  };
}

/* ---------------------------------- selftest --------------------------------- */
if (process.argv.includes("--selftest")) {
  const dir = mkdtempSync(join(tmpdir(), "mirrorcov-"));
  const repo = join(dir, "repo");
  const mk = (p, s) => {
    const full = join(repo, p);
    mkdirSync(full.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(full, s);
  };
  // نفس شكل الملفين الحقيقيين: كتالوج المكنة سطور خام، والليستا للباني كائنات + .filter
  const app = (bins) =>
    `// تعليق: مش أداة\nexport const VENDORABLE = [\n${bins.map((b) => `  "${b}",`).join("\n")}\n];\n`;
  const builder = (bins) =>
    `const TOOLS = [\n${bins.map((b) => `  { bin: "${b}", repo: "x/y", match: /z$/i },`).join("\n")}\n].filter(() => true);\n`;
  let pass = 0, fail = 0;
  const t = (name, fn) => {
    try { fn(); console.log(`✓ ${name}`); pass++; }
    catch (e) { console.log(`✗ ${name}: ${e.message}`); fail++; }
  };
  const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

  t("القارئ بيستخرج الأسماء وبيتجاهل التعليقات", () => {
    mk("artifacts/api-server/src/lib/ops/toolchain.ts", app(["a", "b"]));
    mk("scripts/fetch-toolchain.mjs", builder(["a", "b", "c"]));
    eq(namesFrom(readFileSync(join(repo, "artifacts/api-server/src/lib/ops/toolchain.ts"), "utf8"), "export const VENDORABLE = ["), ["a", "b"], "وعد");
    if (namesFrom(readFileSync(join(repo, BUILDER), "utf8"), "const TOOLS = [") === null) throw new Error("قارئ الكتالوج الحقيقي فشل");
    eq(namesFrom(readFileSync(join(repo, "scripts/fetch-toolchain.mjs"), "utf8"), "const TOOLS = ["), ["a", "b", "c"], "باني");
  });
  t("متساويين → تمام", () => {
    const r = check({ repo });
    if (!r.ok) throw new Error(r.errors.join(" | "));
  });
  t("الوعد أكبر من الباني → رُفض بالاسم", () => {
    mk("artifacts/api-server/src/lib/ops/toolchain.ts", app(["a", "b", "d"]));
    const r = check({ repo });
    if (r.ok || !r.errors[0].includes("d")) throw new Error("مفيش رسالة عن الأداة الناقصة");
  });
  t("الباني فيه زيادة عن الوعد → مقبول (الزيادة مش عيب)", () => {
    mk("artifacts/api-server/src/lib/ops/toolchain.ts", app(["a", "b"]));
    const r = check({ repo });
    if (!r.ok) throw new Error(r.errors.join(" | "));
  });
  t("مانيفست ناقصة أداة موعودة → رُفضت بالاسم", () => {
    mk("artifacts/api-server/src/lib/ops/toolchain.ts", app(["a", "b", "d"]));
    mk("scripts/fetch-toolchain.mjs", builder(["a", "b", "d"]));
    const mf = join(dir, "m.json");
    writeFileSync(mf, JSON.stringify({ total: 3, tools: [{ name: "a" }, { name: "b" }, { name: "d" }] }));
    if (!check({ repo, manifestPath: mf }).ok) throw new Error("المانيفست الكاملة اترفضت!");
    writeFileSync(mf, JSON.stringify({ total: 2, tools: [{ name: "a" }, { name: "b" }] }));
    const r = check({ repo, manifestPath: mf });
    if (r.ok || !r.errors.some((x) => x.includes("الناقص: d"))) throw new Error("الناقص عدّى");
    if (!r.errors.some((x) => x.includes("total=2"))) throw new Error("مفيش رسالة على total");
  });
  t("حالة النهارده: الريان أخضر بـ12 والمرآة بتوعد بـ16 → لازم تُرفض", () => {
    mk("artifacts/api-server/src/lib/ops/toolchain.ts", app(["a", "b", "d", "e"]));
    mk("scripts/fetch-toolchain.mjs", builder(["a", "b"]));
    const mf = join(dir, "m2.json");
    writeFileSync(mf, JSON.stringify({ total: 2, tools: [{ name: "a" }, { name: "b" }] }));
    const r = check({ repo, manifestPath: mf });
    if (r.ok || !r.errors.some((x) => x.includes("منشورة ناقصة"))) throw new Error("حارسنا الجديد هيخلي نفس الغلط يعدّي");
  });
  t("مانيفست فاضية → رُفضت", () => {
    const mf = join(dir, "m3.json");
    writeFileSync(mf, JSON.stringify({ total: 0, tools: [] }));
    const r = check({ repo, manifestPath: mf });
    if (r.ok || !r.errors.some((x) => x.includes("من غير أي أداة"))) throw new Error("فاضية عدّت");
  });
  console.log(`\n${pass}/${pass + fail} · تغطية المرآة`);
  process.exit(fail ? 1 : 0);
}

/* ------------------------------------ CLI ------------------------------------ */
const argVal = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const JSONOUT = process.argv.includes("--json");
const r = check({ manifestPath: argVal("--manifest") });
if (JSONOUT) console.log(JSON.stringify(r, null, 2));
else if (r.ok) {
  console.log(
    `✓ تغطية المرآة: وعد ${r.promised.length} · باني ${r.buildable.length}` +
      (r.packed ? ` · منشور ${r.packed.length}` : " · (من غير مانيفست — فحص المصادر بس)")
  );
} else for (const e of r.errors) console.log(process.env.GITHUB_ACTIONS ? `::error::${e}` : `✗ ${e}`);
process.exit(r.ok ? 0 : 1);
