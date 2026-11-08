#!/usr/bin/env node
/**
 * Toolchain mirror test — proves the box can get its tools without api.github.com.
 * ────────────────────────────────────────────────────────────────────────────
 * The measured failure (2026-11-07, `GET /api/ops/tools → last` at 17:32:23Z):
 * the vendorer ran to completion on the container (exitCode 0) and every single
 * tool came back `failed · api.github.com ماردّش`. A second attempt at 17:17:17Z
 * died with `exitCode: null · ms 6395` — killed, not refused: the old download
 * buffered whole 60 MB binaries in a 256 MB container.
 *
 * The fix has two halves and both are checkable offline, which is the whole
 * point of this file (a gate that needs the network is a gate that goes red for
 * the wrong reason):
 *   1. the packer writes `bin/<tool>` members + a SHA-256 manifest, and
 *      `tar --wildcards 'bin/<tool>'` — exactly what `extractFromMirror` runs —
 *      finds them. Wrong layout = silent zero installs on the box.
 *   2. the registry: every new kind must point at a real vendorable binary,
 *      carry an Arabic name and its own budget, and the ones that touch a
 *      target must be `active: true` (that flag is what `assertAuthorized`
 *      gates on in runner.ts — a wrong value there is a safety hole, not cosmetics).
 *
 * Run: node scripts/test-toolchain-mirror.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { bundleCli, esbuildApi, esbuildCli } from "./lib/esbuild-runner.mjs";

process.env.NODE_ENV = "production"; // اللوجر بيطلب pino-pretty في وضع التطوير، والحزمة هنا مش فيها هو
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nova-mirror-test-"));
const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push([name, true, ""]);
  } catch (err) {
    checks.push([name, false, String(err?.message ?? err).split("\n")[0].slice(0, 160)]);

  }
};

/* ── 1 · pack a fake vendor dir the way CI would ────────────────────────── */
const src = path.join(work, "vendor", "bin");
fs.mkdirSync(src, { recursive: true });
// أكواد ELF مش لازم تكون سليمة — الباكِر ما يفكّش الملفات، بيقرأ حجمها وختمها وبس.
for (const [bin, body] of [["amass", "AMASS-BINARY\n"], ["naabu", "NAABU-BINARY\n"]]) {
  fs.writeFileSync(path.join(src, bin), body, { mode: 0o755 });
  fs.chmodSync(path.join(src, bin), 0o755);
}
fs.writeFileSync(
  path.join(src, ".vendored.json"),
  JSON.stringify({ amass: { tag: "v4.2.0", version: "amass version 4.2.0", at: "2026-11-07T00:00:00.000Z" } }, null, 2),
);

const dist = path.join(work, "dist");
const pack = spawnSync(process.execPath, [path.join(ROOT, "scripts/build-toolchain-mirror.mjs"), "--from", src, "--out", dist], {
  cwd: ROOT,
  encoding: "utf8",
});
check("the packer exits 0 on a real vendor dir", () => {
  assert.equal(pack.status, 0, (pack.stderr || pack.stdout || "").slice(0, 200));
});

const manPath = path.join(dist, "nova-toolchain.json");
const arcPath = path.join(dist, "nova-toolchain.tar.gz");
let man = null;
check("manifest + archive exist", () => {
  man = JSON.parse(fs.readFileSync(manPath, "utf8"));
  assert.ok(fs.statSync(arcPath).size > 100, "the archive is empty");
});
check("every member is hashed and the archive itself is hashed", () => {
  const byBin = new Map(man.tools.map((t) => [t.bin, t]));
  for (const bin of ["amass", "naabu"]) {
    const t = byBin.get(bin);
    assert.ok(t, `${bin} missing from the manifest`);
    const real = crypto.createHash("sha256").update(fs.readFileSync(path.join(src, bin))).digest("hex");
    assert.equal(t.sha256, real, `${bin}: manifest hash does not match the file`);
    assert.ok(t.bytes > 0);
  }
  const arcReal = crypto.createHash("sha256").update(fs.readFileSync(arcPath)).digest("hex");
  assert.equal(man.archiveSha256, arcReal, "archive hash mismatch — the box would refuse it, and so does this gate");
  assert.equal(man.archive, "nova-toolchain.tar.gz");
});
check("the tags come from the vendorer manifest, not from a typed list", () => {
  const amass = man.tools.find((t) => t.bin === "amass");
  assert.equal(amass.tag, "v4.2.0");
  assert.equal(amass.version, "amass version 4.2.0");
});

check("every tool also ships as its own asset, so the box stops dragging 296MB", () => {
  for (const bin of ["amass", "naabu"]) {
    const x = man.tools.find((y) => y.bin === bin);
    assert.equal(x.asset, `bin-${bin}`, `${bin}: مفيش أصل مفرد في المانيفست`);
    const p = path.join(dist, `bin-${bin}`);
    assert.equal(fs.statSync(p).size, x.bytes, `${bin}: الأصل المفرد مش بنفس الحجم`);
    const real = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    assert.equal(real, x.sha256, `${bin}: الأصل المفرد مش نفس بايتات الأرشيف`);
    assert.ok(typeof x.assetUrl === "string" && x.assetUrl.endsWith(`bin-${bin}`), `${bin}: مفيش رابط جاهز`);
  }
});

check("the vendorer tries the per-tool asset before the full archive", () => {
  const vend = fs.readFileSync(path.join(ROOT, "scripts/fetch-toolchain.mjs"), "utf8");
  const load = vend.slice(vend.indexOf("async function loadMirror"), vend.indexOf("async function ensureArchive"));
  assert.ok(load.length > 40 && !/downloadStream\(`\$\{MIRROR\}\/\$\{doc\.archive\}`/.test(load),
    "فهرس المرآة لسه بينزّل الأرشيف بالكامل قبل ما يعرف إيه الناقص");
  // `fetchOne` متعرّف قبل `tryMirror` في الملف — فقصّ «لحد fetchOne» كان يطلع فاضي
  // والبوابة تفشل على نفسها مش على الكود. القصّة الصح: للدالة اللي بعد tryMirror.
  const tIdx = vend.indexOf("async function tryMirror");
  const nxt = vend.indexOf("\nasync function ", tIdx + 10);
  const tryM = vend.slice(tIdx, nxt > 0 ? nxt : undefined);
  assert.ok(tryM.length > 200, "قصّة tryMirror فاضية — البوابة بتقيس نفسها");
  assert.match(tryM, /await assetFromMirror\(idx, tool\.bin, entry, dest\)/);
  assert.ok(tryM.indexOf("assetFromMirror") < tryM.indexOf("ensureArchive"), "الأصل المفرد لازم يتجرّب الأول");
  assert.match(tryM, /status: "failed"[^\n]*الأرشيف كمان/, "لو الاتنين فشلوا لازم السببين يظهروا");
});

/* ── 2 · the extraction command the box runs must find the members ──────── */
const out = path.join(work, "extract");
fs.mkdirSync(out, { recursive: true });
const untar = spawnSync("tar", ["xzf", arcPath, "-C", out, "--wildcards", "--no-same-owner", "bin/amass"], { encoding: "utf8" });
check("tar --wildcards 'bin/amass' extracts it (extractFromMirror's exact argv)", () => {
  assert.equal(untar.status, 0, String(untar.stderr || untar.stdout).slice(0, 200));
  assert.equal(fs.readFileSync(path.join(out, "bin", "amass"), "utf8"), "AMASS-BINARY\n");
});

/* ── 3 · the wordlist ships and is what ffuf/gobuster will be handed ────── */
check("the embedded wordlist exists with real content", () => {
  const wl = path.join(ROOT, "ops/wordlists/nova-paths.txt");
  const txt = fs.readFileSync(wl, "utf8");
  const lines = txt.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.length >= 120, `only ${lines.length} entries`);
  for (const must of [".env", ".git/config", "actuator/env", "wp-login.php", "swagger-ui.html"]) {
    assert.ok(lines.includes(must), `${must} should be in a path list that claims to hunt config leaks`);
  }
  assert.equal(new Set(lines).size, lines.length, "duplicate entries in the wordlist");
});

/* ── 4 · the registry: new kinds are wired like the old ones ────────────── */
const bundle = path.join(work, "ops-tools.mjs");
if (!esbuildApi(ROOT) && !esbuildCli(ROOT)) {
  checks.push(["esbuild available", false, "run pnpm install"]);
} else {
  // pino بيطلب `require("node:os")` من جوّه الـESM — نفس الـbanner اللي في
  // `test-tool-labels.mjs`، من غيره الاستيراد بيرمي Dynamic require not supported.
  const shim = 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);';
  bundleCli(ROOT, [
    path.join(ROOT, "artifacts/api-server/src/lib/ops/tools.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--log-level=error",
    `--banner:js=${shim}`,
    `--outfile=${bundle}`,
  ]);
  const mod = await import(bundle);
  const KINDS = mod.KINDS ?? {};
  const WANT = [
    "tools.amass", "tools.naabu", "tools.ffuf", "tools.gobuster", "tools.dalfox", "tools.gitleaks", "tools.trivy",
    "tools.tlsx", "tools.uncover", "tools.osv", "tools.trufflehog", "tools.parammine",
  ];
  const VENDORABLE = [
    "subfinder", "httpx", "nuclei", "katana", "dnsx", "naabu", "ffuf", "amass", "gobuster", "dalfox", "gitleaks", "trivy",
    "tlsx", "uncover", "trufflehog", "osv-scanner",
  ];

  check("every new kind is registered", () => {
    for (const id of WANT) assert.ok(KINDS[id], `${id} not in KINDS`);
  });
  check("each new kind names a binary the vendorer can actually fetch", () => {
    for (const id of WANT) {
      const bin = KINDS[id].binary;
      assert.ok(bin, `${id} has no binary`);
      assert.ok(VENDORABLE.includes(bin), `${id} points at "${bin}" which scripts/fetch-toolchain.mjs cannot vendor`);
    }
  });
  check("each new kind has an Arabic title and its own budget", () => {
    for (const id of WANT) {
      const k = KINDS[id];
      assert.ok(typeof k.titleAr === "string" && k.titleAr.length > 6, `${id} has no readable Arabic name`);
      assert.ok(Number.isFinite(k.budgetMs) && k.budgetMs > 0 && k.budgetMs <= 300_000, `${id} has no bounded budgetMs`);
      assert.ok(typeof k.command === "function", `${id} has no reproduce command`);
    }
  });
  check("anything that touches the target is flagged active (that flag is the authorization gate)", () => {
    const TOUCHING = ["tools.naabu", "tools.ffuf", "tools.gobuster", "tools.dalfox", "tools.tlsx", "tools.parammine"];
    for (const id of TOUCHING) assert.equal(KINDS[id].active, true, `${id} hits the target but is not active`);
    const PASSIVE = ["tools.amass", "tools.gitleaks", "tools.trivy", "tools.uncover", "tools.osv", "tools.trufflehog"];
    for (const id of PASSIVE) assert.equal(KINDS[id].active, false, `${id} is passive but marked active`);
  });
  check("the brute-force kinds fall back loudly, never silently, with no wordlist", () => {
    // args() must not throw when the list is missing — a throw inside the runner
    // would look like a tool crash; the tool must run and say why it found nothing.
    const fakeCtx = { host: "example.com", scheme: "https", rps: 2, jobDir: work, program: {}, log: () => {} };
    for (const id of ["tools.ffuf", "tools.gobuster"]) {
      const args = KINDS[id].args(fakeCtx);
      assert.ok(Array.isArray(args) && args.length > 4, `${id} produced no args`);
      assert.ok(args.includes("-w") || args.includes("dir"), `${id} lost its wordlist flag`);
    }
  });
}

/* ── 5 · the vendorer refuses to trust an unverified mirror, by construction ─ */
check("القايمة اللي بنسمّيها مدمجة بتفضل موجودة وبالحجم المتقاس", () => {
  const med = fs.readFileSync(path.join(ROOT, "ops/wordlists/paths-medium.txt"), "utf8");
  const par = fs.readFileSync(path.join(ROOT, "ops/wordlists/params-burp.txt"), "utf8");
  assert.ok(med.split("\n").filter((l) => l.trim()).length >= 5000, "paths-medium عدد");
  assert.ok(par.split("\n").filter((l) => l.trim()).length >= 5000, "params-burp عدد");
  // ffuf بياخد السطر حرفيًا: مافيش سطر تعليق ولا سطر فاضي في النص
  for (const [nm, txt] of [["paths-medium", med], ["params-burp", par]]) {
    for (const l of txt.split("\n")) {
      if (!l.trim()) continue;
      assert.ok(!l.startsWith("#"), `${nm}: سطر تعليق هيتجرّب كابحّث حرفي — امسحه`);
    }
  }
});

check("the mirror download is streamed to disk, not buffered in RAM", () => {
  const srcTxt = fs.readFileSync(path.join(ROOT, "scripts/fetch-toolchain.mjs"), "utf8");
  assert.match(srcTxt, /function downloadStream/, "the streaming downloader disappeared");
  assert.match(srcTxt, /createWriteStream/, "the mirror path must write to a file");
  assert.match(srcTxt, /createHash\("sha256"\)/, "every streamed byte must be hashed before it is trusted");
  // القياس القديم كان `res.arrayBuffer()` — لازم يفضل ممنوع في مسار الأرشيف
  const mirrorBlock = srcTxt.slice(srcTxt.indexOf("async function loadMirror"), srcTxt.indexOf("async function fetchOne"));
  assert.doesNotMatch(mirrorBlock, /arrayBuffer/, "the archive path must never buffer the whole file");
});

/* ── 6 · الـhead بتاع fetchOne بيتنفّذ فعلًا، والرسالة سبب مش ReferenceError ── */
{
  // الغلطة اللي البوابة دي موجودة عشانها: سطر `const latest = await gh(...)` اتشال
  // من أول `fetchOne` وهي بتلمع المرآة، فـ`tag` بقت بتقرأ متغيّر مش موجود.
  // `node --check` ما بيقولش حاجة (الاسم حرّ، والصياغة صح)، والبوابات التانية
  // ما بتلمس الملفش، والنتيجة كانت CI كله أحمر: `12/12 failed · "latest is not
  // defined"` (annotation في run 42410882574). الفحص ده بيستورد السكربت بـfetch
  // مكسور — فبيعدّي على نفس السطر، ولا شبكة ولا 30MB في الاختبار.
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `globalThis.fetch = async () => { throw new Error("offline-for-test"); };
       process.argv = [process.argv[0], ${JSON.stringify(path.join(ROOT, "scripts/fetch-toolchain.mjs"))}, "--only", "trivy,gitleaks", "--into", ${JSON.stringify(path.join(work, "offline-vendor"))}, "--json", "--no-mirror"];
       await import(${JSON.stringify("file://" + path.join(ROOT, "scripts/fetch-toolchain.mjs"))});`,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
  );
  let doc = null;
  const txt = String(probe.stdout || "");
  for (let i = txt.indexOf("{"); i >= 0; i = txt.indexOf("{", i + 1)) {
    try {
      doc = JSON.parse(txt.slice(i, txt.lastIndexOf("}") + 1));
      break;
    } catch {
      /* جرّب أقرب { */
    }
  }
  check("the vendorer runs offline and answers JSON (not a crash)", () => {
    assert.equal(probe.status, 0, String(probe.stderr || "").slice(0, 200));
    assert.ok(doc && Array.isArray(doc.results), `no JSON on stdout: ${txt.slice(0, 160)}`);
    assert.equal(doc.results.length, 2, `expected 2 rows, got ${doc.results.length}`);
  });
  check("each row names a real reason — no ReferenceError leaking as a failure", () => {
    for (const r of doc.results) {
      const why = String(r.why || "");
      assert.doesNotMatch(why, /is not defined|is not a function|Cannot read propert/, `${r.bin}: "${why}"`);
      assert.match(why, /offline-for-test|ماردّش|المرآة/, `${r.bin} صمتت: "${why}"`);
    }
  });
}


/* ── 5 · the two follow-ups this file exists to keep honest ───────────────── */
// قِيس على المكنة الحيّة 2026-11-08T01:01:54Z: محاولة الأدوات جت قبل نشر أرشيف
// المرآة بثانية واحدة، والـ404 خلّى المكنة «5 أدوات من 16» لحد ما حد يضغط رستارت.
check("the supervisor retries the missing tools instead of waiting for a restart", () => {
  const boot = fs.readFileSync(path.join(ROOT, "scripts", "build-standalone.mjs"), "utf8");
  assert.match(boot, /toolchainTries\s*<\s*3/);
  assert.ok(boot.includes("setTimeout(toolchainPass"), "مفيش جدول إعادة للمحاولة");
  assert.ok(boot.includes("toolchain-provision.json"), "محاولة المُشرف ما كتبتش السجل اللي اللوحة بتقراه");
  // والقيااس 01:52:06Z: التطبيق نادى المنزّل في نفس لحظة الإقلاع ومضى 8.8 ثانية
  // واتقتل — فالمسار ده لازم يسلم للمُشرف، الاتنين على سقف RAM واحد مايلحقوش.
  // والملكية دي لازم تبقى بموافقة، مش بتوقيع المسار: المكنة وقعت مرتين بعد تنزيل
  // الإقلاع (01:01Z و01:52Z → 502 من 02:0xZ) وسقفها 460MB/1024MB.
  assert.ok(!/root\.indexOf\("\/home\/container"\) === 0/.test(boot), "المُشرف لسه بينزّل تلقائيًا على أي /home/container");
  assert.match(boot, /process\.env\.NOVA_TOOLCHAIN_AT_BOOT !== "1"/);
  const tc = fs.readFileSync(path.join(ROOT, "artifacts/api-server/src/lib/ops/toolchain.ts"), "utf8");
  assert.ok(tc.includes("supervisorOwnsIt"), "التطبيق لسه بينزّل وقت الإقلاع لوحده");
  assert.match(tc, /bootRoot\.startsWith\("\/home\/container"\)/);
});

// كوتا السّلوت 1024MB، لكن statfs بيقيس قرص المضيف (قِيس: 99798MB «فاضي») — فحارس
// «الفاضل» لوحده بيضحك؛ لازم سقف حجم صريح على مجلد الأدوات نفسه.
check("the vendorer caps the vendor dir size so it cannot eat the slot quota", () => {
  const vend = fs.readFileSync(path.join(ROOT, "scripts", "fetch-toolchain.mjs"), "utf8");
  assert.ok(vend.includes("NOVA_VENDOR_MAX_MB"), "مفيش متغير سقف");
  assert.match(vend, /dirMB\(INTO\)\s*>=\s*CAP_MB/);
});

let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(bad === 0 ? 0 : 1);
