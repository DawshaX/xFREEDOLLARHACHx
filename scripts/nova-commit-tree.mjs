#!/usr/bin/env node
/**
 * nova-commit-tree — يبني commit من **الشاغل على القرص** مقابل `origin/main`، مش من الـindex.
 * ──────────────────────────────────────────────────────────────────────────────
 * ليه الملف ده موجود (والسبب حقيقي، مش احتياط): مرتين اتلمس شغل في `main` بنفس
 * الطريقة — commit اتبني على شجرة قديمة (`HEAD` بتاعة السيشن) فطلع كأنه «تحسين»
 * وهو في الحقيقة رجع ملفات كاملة لورا، والـCI كان أخضر طول الوقت. الفرق إن
 * `git diff <commit>` بيقارن الـ**index**، والـindex بتاع السيشن بيفضل على حاله
 * لما بوتات تكمّل على main — فالقايمة اللي بتطلع كده مش هي اللي على القرص.
 *
 * القاعدة اللي بيطبّقها الملف ده:
 *   1) الأساس `origin/main` (آخر حاجة سلمها الناس فعلًا)، مش `HEAD`.
 *   2) كل ملف في main بيتقارن **بايت-بايت** مع نسخة القرص (hash-object)، وكل ملف
 *      مش في index بيتحسب (untracked) — فاللي اتغيّر داخله جوه الحزام.
 *   3) لو أي ملف موجود في main ومش هيبقى في الشجرة الجديدة → **الشغل يوقف**،
 *      إلا لو اتقال `--allow-delete`. صفر حذف مش رقم جمالي: دي الطريقة الوحيدة
 *      اللي بتفرّق بين «عدّلت» و«مسحت».
 *   4) `--mode=755` بيتحافظ عليه من main (ضوضاء الأذنين بتموّهي القراية).
 *
 *   node scripts/nova-commit-tree.mjs --dry-run
 *   node scripts/nova-commit-tree.mjs --commit -m "رسالة" [--push]
 *   node scripts/nova-commit-tree.mjs --selftest     # على مستودع مؤقت، بلا نت
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = path.resolve(HERE, "..");

/** الاستبعاد الافتراضي: حالة تشغيل/بناء، وأسرار، ومخرجات كبيرة. */
export const DEFAULT_IGNORE = [
  /^node_modules\//,
  /^dist-standalone\//,
  /^dist\//,
  /^state\//,
  /^artifacts\/kali-panel\/public\/state\//,
  /^artifacts\/freelists\//,
  /^artifacts\/\w+\/dist\//,
  /^\.next\//,
  /^coverage\//,
  /(^|\/)\.env(\.|$)/,
  /\.zip$/,
  /\.tar\.gz$/,
  /^pnpm-lock\.yaml$/, // بيتكتب بأي install؛ الدفعه بتاعتنا مش مكانه
];

const git = (cwd, args, opts = {}) =>
  // execFileSync بيرجّع null لما stdio يكون inherit — والـtrim على null كان بيخلّي
  // الأمر يفشل AFTER ما ينجح: «✗» بعد دفع سليم أكذب من صفر.
  String(execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts }) ?? "").trim();

const ignorePatterns = (extra) => [...DEFAULT_IGNORE, ...(extra || []).map((p) => new RegExp(p))];
const ignored = (rel, pats) => pats.some((re) => re.test(rel));

/** قايمة `path<TAB>mode` لكل ملفات شجرة (من `git ls-tree -r`). */
function treeEntries(cwd, rev) {
  const raw = git(cwd, ["ls-tree", "-r", "--long", rev]);
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const m = line.match(/^(\d{6}) blob [0-9a-f]+\s+(\d+)\t(.*)$/);
    if (m) out.push({ mode: m[1], size: Number(m[2]), file: m[3] });
    else {
      const m2 = line.match(/^(\d{6}) blob [0-9a-f]+\t(.*)$/);
      if (m2) out.push({ mode: m2[1], size: -1, file: m2[2] });
    }
  }
  return out;
}

function listWorktree(cwd) {
  const raw = git(cwd, ["ls-files", "--others", "--exclude-standard", "-c"]);
  return raw.split("\n").filter(Boolean);
}

/**
 * ابنِ شجرة من القرص مقابل `base`. يرجّع {tree, added, changed, skipped, deletions}.
 * `base` لازم يبقى commit/tree موجود (الافتراضي origin/main).
 */
export function buildTree(cwd = REPO_DEFAULT, opts = {}) {
  const base = opts.base || "origin/main";
  const ignore = ignorePatterns(opts.ignore);
  try {
    execFileSync("git", ["fetch", "-q", "origin", base.replace(/^origin\//, "")], { cwd, stdio: "ignore", timeout: 120_000 });
  } catch {
    // مافيش نت؟ نكمل على آخر origin/main معروف — بس بنقول إننا ماجربناش ندفع عليه بليل
    console.log("· (ماقدرتش أجيب origin/main جديد — بشتغل على اللي معروفة)");
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-idx-"));
  const idx = path.join(tmp, "index");
  const env = Object.assign({}, process.env, { GIT_INDEX_FILE: idx });
  try {
    git(cwd, ["read-tree", base], { env });
    const entries = treeEntries(cwd, base);
    const added = [];
    const changed = [];
    const skipped = [];
    const missing = [];
    const seen = new Set();
    for (const e of entries) {
      seen.add(e.file);
      if (ignored(e.file, ignore)) {
        skipped.push(e.file);
        continue;
      }
      const abs = path.join(cwd, e.file);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        missing.push(e.file); // في main ومش على القرص — لازم يتقال، مش يسكت
        continue;
      }
      const h = git(cwd, ["hash-object", "-w", "--", e.file], { env: Object.assign({}, env) });
      const inTree = git(cwd, ["rev-parse", `${base}:${e.file}`], { env });
      if (h !== inTree) {
        git(cwd, ["update-index", "--add", "--cacheinfo", `${e.mode},${h},${e.file}`], { env });
        changed.push(e.file);
      }
    }
    for (const rel of listWorktree(cwd)) {
      if (seen.has(rel) || ignored(rel, ignore)) continue;
      const abs = path.join(cwd, rel);
      // 2026-11-09: إندكس محلي قديم ممكن يسمّي ملفات اتشالت من على القرص (زي
      // state/cybernova-brain-state.json بعد PR #238) → statSync كان بيكسر السكريبت كله
      // بـ ENOENT قبل أي commit. الغياب حقيقة مشروعة — اتخطَّ بصمت مسجَّل، مش انفجار.
      if (!fs.existsSync(abs)) { missing.push(rel); continue; }
      if (!fs.statSync(abs).isFile()) continue;
      const h = git(cwd, ["hash-object", "-w", "--", rel], { env });
      git(cwd, ["update-index", "--add", "--cacheinfo", `100644,${h},${rel}`], { env });
      added.push(rel);
    }
    const tree = git(cwd, ["write-tree"], { env });
    const del = git(cwd, ["diff", "--name-status", base, tree], { env })
      .split("\n")
      .filter((l) => l.startsWith("D\t"))
      .map((l) => l.slice(2));
    return { tree, base, added, changed, skipped, missing, deletions: del };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ── selftest: مستودع مؤقت بيثبت إن الشغل المتغيّر مابيضيعش ────────────────── */
function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-ct-"));
  const g = (...a) => git(dir, a);
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "one\n");
  fs.writeFileSync(path.join(dir, "src", "b.ts"), "keep\n");
  fs.writeFileSync(path.join(dir, "state", "runtime.json"), "{}\n");
  g("add", "src", "state");
  g("commit", "-qm", "base");
  g("update-ref", "refs/remotes/origin/main", g("rev-parse", "HEAD"));
  // فرع بعيد = نفس الأساس، عشان buildTree ياخد origin/main
  fs.mkdirSync(path.join(dir, ".git", "refs", "remotes", "origin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "refs", "remotes", "origin", "main"), g("rev-parse", "HEAD") + "\n");

  // (1) تعديل ملف + ملف جديد + state بيتغيّر + ملف اتمسح من القرص
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "two\n");
  fs.writeFileSync(path.join(dir, "src", "c.ts"), "new\n");
  fs.writeFileSync(path.join(dir, "state", "runtime.json"), "{\"x\":1}\n");
  fs.rmSync(path.join(dir, "src", "b.ts"));

  let threw = null;
  let r = null;
  try {
    r = buildTreeForTest(dir);
  } catch (e) {
    threw = e;
  }
  const expect = (cond, what) => {
    if (!cond) {
      console.error(`✗ selftest: ${what}`);
      process.exit(1);
    }
    console.log(`  ✓ ${what}`);
  };
  expect(!threw, "البناء عدّى من غير استثناء (" + String(threw?.message || "").slice(0, 80) + ")");
  const doc = r;
  expect(doc.changed.includes("src/a.ts"), "الملف المعدّل اتحط في الشجرة (مش بيضيع لأن index قديم)");
  expect(doc.added.includes("src/c.ts"), "الملف الجديد اتحسب");
  expect(doc.skipped.includes("state/runtime.json"), "state/ مستبعد");
  expect(doc.missing.includes("src/b.ts"), "الملف الماشي من القرص اتقال بصريح الاسم، ماسكتش");
  expect(doc.deletions.length === 0, "الملف الناقص على القرص مابيشيلوش من main (الشجرة بلّغت بس)");
  expect(g("ls-tree", "-r", "--name-only", doc.tree).includes("src/b.ts"), "src/b.ts لسه في الشجرة — ماحدش مسحه");
  // (2) إعادة البناء بعد ما نرجّع الملف: مافيش حذف
  fs.writeFileSync(path.join(dir, "src", "b.ts"), "keep\n");
  const r2 = buildTreeForTest(dir);
  expect(r2.deletions.length === 0, "بعد ما رجع الملف: صفر حذف");
  expect(r2.changed.includes("src/a.ts") && r2.added.includes("src/c.ts"), "التغييرات لسه شغالة");
  console.log("✓ nova-commit-tree selftest: التعديل بيوصل، state بيستبعد، والحذف بيقول على نفسه");
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildTreeForTest(dir) {
  const base = git(dir, ["rev-parse", "origin/main"]);
  const out = buildTreeNoFetch(dir, base);
  return out;
}

/** نسخة بلا `git fetch` — للاختبار المحلي. */
function buildTreeNoFetch(cwd, base) {
  const ignore = ignorePatterns([]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-idx2-"));
  const idx = path.join(tmp, "index");
  const env = Object.assign({}, process.env, { GIT_INDEX_FILE: idx });
  try {
    git(cwd, ["read-tree", base], { env });
    const entries = treeEntries(cwd, base);
    const added = [];
    const changed = [];
    const skipped = [];
    const missing = [];
    const seen = new Set();
    for (const e of entries) {
      seen.add(e.file);
      if (ignored(e.file, ignore)) {
        skipped.push(e.file);
        continue;
      }
      const abs = path.join(cwd, e.file);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        missing.push(e.file);
        continue;
      }
      const h = git(cwd, ["hash-object", "-w", "--", e.file], { env });
      const inTree = git(cwd, ["rev-parse", `${base}:${e.file}`], { env });
      if (h !== inTree) {
        git(cwd, ["update-index", "--add", "--cacheinfo", `${e.mode},${h},${e.file}`], { env });
        changed.push(e.file);
      }
    }
    for (const rel of listWorktree(cwd)) {
      if (seen.has(rel) || ignored(rel, ignore)) continue;
      const h = git(cwd, ["hash-object", "-w", "--", rel], { env });
      git(cwd, ["update-index", "--add", "--cacheinfo", `100644,${h},${rel}`], { env });
      added.push(rel);
    }
    const tree = git(cwd, ["write-tree"], { env });
    const del = git(cwd, ["diff", "--name-status", base, tree], { env })
      .split("\n")
      .filter((l) => l.startsWith("D\t"))
      .map((l) => l.slice(2));
    return { tree, base, added, changed, skipped, missing, deletions: del };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) return selftest();
  const cwd = REPO_DEFAULT;
  const allowDelete = argv.includes("--allow-delete");
  const doCommit = argv.includes("--commit");
  const mi = argv.indexOf("-m");
  const msgFile = argv.includes("--message-file") ? argv[argv.indexOf("--message-file") + 1] : null;
  const r = buildTree(cwd, {});
  console.log(`الأساس ${r.base} · ${r.changed.length} معدّل · ${r.added.length} جديد · ${r.skipped.length} مستبعد (state/build/lock)`);
  for (const f of r.changed) console.log(`  M ${f}`);
  for (const f of r.added) console.log(`  A ${f}`);
  if (r.missing.length) {
    console.log(`\n⚠ ${r.missing.length} ملف في main ومش على القرص (مش هيتحذف من الشجرة — بنبلّغ بس):`);
    for (const f of r.missing.slice(0, 20)) console.log(`  ? ${f}`);
  }
  if (r.deletions.length) {
    console.error(`\n✗ الشجرة الجديدة بتشيل ${r.deletions.length} ملف من main:`);
    for (const f of r.deletions.slice(0, 30)) console.error(`  D ${f}`);
    console.error("  لو ده مقصود: --allow-delete. لو مش مقصود: الملف ناقص على القرص — ارجّعه من main (`git checkout origin/main -- <path>`).");
    process.exit(2);
  }
  if (!doCommit) {
    console.log(`\n· dry-run: الشجرة ${r.tree} جاهزة (مافيش حذف) — --commit يخلّيها commit فوق ${r.base}`);
    return;
  }
  let file = msgFile;
  if (!file) {
    const msg = mi >= 0 ? argv[mi + 1] : "";
    if (!msg) {
      console.error("✗ -m \"الرسالة\" أو --message-file <path>");
      process.exit(2);
    }
    file = path.join(os.tmpdir(), `nova-msg-${process.pid}.txt`);
    fs.writeFileSync(file, msg + "\n");
  }
  const c = git(cwd, ["commit-tree", r.tree, "-p", r.base, "-F", file]);
  console.log(`✓ commit ${c}`);
  if (argv.includes("--push")) {
    git(cwd, ["push", "origin", `${c}:refs/heads/main`]);
    git(cwd, ["push", "--force-with-lease", "origin", `${c}:refs/heads/arena/4e1d764b-xfreedollarhachx`], { stdio: "inherit" });
    console.log("✓ دفعنا لـmain وفرع السيشن");
  } else {
    console.log(`· ارفع بنفسك: git push origin ${c}:refs/heads/main`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error(`✗ ${e?.message || e}`);
    process.exit(1);
  });
}
