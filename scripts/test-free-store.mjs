#!/usr/bin/env node
/**
 * test-free-store — يثبت إن مسار «التخزين المجاني» بيرفض قبل ما يقبل.
 * ────────────────────────────────────────────────────────────────────
 * الفكرة اللي بتحمي المكنة: Drive/Dropbox/GitHub ناقلات، والمستودع هو الحكم
 * (`ops/wordlists/free-store.json` فيه sha256 والحجم). فالكود لازم:
 *   1) يقبل ملف يطابق البصمة، ويكتبه في `state/wordlists/` (مش في الكود)،
 *   2) يرفض ملف بصمته مختلفة — حتى لو نزل كامل وسليم،
 *   3) ما يخلّيش مصدر واقع يبان كأنه «مفيش نتائج» — كل محاولة ليها سطر.
 *
 * الاختبار بيتنفّذ على الكود **المبني** (esbuild على `wordlist.ts`) وحيثما HTTP
 * محلي — مافيش نت خارجي، فالبوابة ما تحمرش بسبب CDN.
 *
 *   node scripts/test-free-store.mjs
 */
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleCli } from "./lib/esbuild-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "artifacts", "api-server", "src", "lib", "ops", "wordlist.ts");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nova-free-store-"));
const checks = [];
const check = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === "function") throw new Error("استخدم checkAsync");
    checks.push([name, true, ""]);
  } catch (err) {
    checks.push([name, false, String(err?.message ?? err).split("\n")[0].slice(0, 200)]);
  }
};
const checkAsync = async (name, fn) => {
  try {
    await fn();
    checks.push([name, true, ""]);
  } catch (err) {
    checks.push([name, false, String(err?.message ?? err).split("\n")[0].slice(0, 200)]);
  }
};

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const LIST = Buffer.from("/a\n/b\n/c\n/d\n", "utf8");
const NAME = "test-list.txt";


/* ── 1 · نبني wordlist.ts ونستورده ─────────────────────────────────────────── */
const out = path.join(work, "wordlist.mjs");
bundleCli(ROOT, [SRC, "--format=esm", "--platform=node", `--outfile=${out}`]);
check("الكود اتبنى من المصدر (مفيش نسخة تانية بتتختبر)", () => {
  assert.ok(fs.existsSync(out), "esbuild ما كتبش الحاجة");
  const txt = fs.readFileSync(out, "utf8");
  assert.match(txt, /fetchList/);
});

const wl = await import(pathToFileURL(out).href);

/* ── 2 · سيرفر محلي بي serve ثلاث حالات: مطابق / ملوّث / واقع ──────────────── */
const served = { good: LIST, bad: Buffer.concat([LIST, Buffer.from("/evil\n", "utf8")]) };
let hits = [];
const server = http.createServer((req, res) => {
  const u = String(req.url || "");
  hits.push(u);
  if (u.startsWith("/big/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(Buffer.from(Array.from({ length: 300 }, (_, i) => `/p${i}`).join("\n") + "\n", "utf8"));
  } else if (u.startsWith("/good/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(served.good);
  } else if (u.startsWith("/tampered/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(served.bad);
  } else if (u.startsWith("/404")) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nope");
  } else {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("boom");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

/* ── 3 · manifest وهمي بنفس شكل الحقيقي، والمرآات كلها على السيرفر المحلي ───── */
function writeStore(dir, fileUrl, body = LIST) {
  const store = {
    generatedAt: new Date().toISOString(),
    source: { name: "test/fixture", ref: "main" },
    policy: { rule: "sha256 إلزامي" },
    mirrors: { dropbox: { files: { [NAME]: fileUrl } }, github: { rawTemplate: `${base}/404{file}` } },
    files: { [NAME]: { kind: "paths", lines: body.toString("utf8").split("\n").filter(Boolean).length, bytes: body.length, sha256: sha(body), inBundle: false } },
  };
  fs.mkdirSync(path.join(dir, "ops", "wordlists"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ops", "wordlists", "free-store.json"), JSON.stringify(store));
  return store;
}

await checkAsync("الملف اللي بصمته مطابقة بيقع في state/wordlists/ ومش في الكود", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-fs-good-"));
  writeStore(dir, `${base}/good/${NAME}`);
  const prev = process.env.NOVA_FREE_STORE;
  process.env.NOVA_FREE_STORE = path.join(dir, "ops", "wordlists", "free-store.json");
  try {
    const rec = await wl.fetchList(NAME, { cwd: dir });
    assert.equal(rec.verified, true, `ماتحققش: ${JSON.stringify(rec.attempts)}`);
    assert.equal(rec.bytes, LIST.length);
    assert.equal(rec.lines, 4);
    assert.equal(rec.source, "dropbox");
    assert.equal(fs.readFileSync(rec.path).toString("utf8"), LIST.toString("utf8"));
    assert.ok(rec.path.includes(path.join("state", "wordlists")), `مش في كاش الحالة: ${rec.path}`);
  } finally {
    if (prev === undefined) delete process.env.NOVA_FREE_STORE;
    else process.env.NOVA_FREE_STORE = prev;
  }
});

await checkAsync("الملف الملوّث مبريش فيه: بصمة مختلفة = رفض، ومفيش ملف بيتكتب", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-fs-bad-"));
  writeStore(dir, `${base}/tampered/${NAME}`);
  process.env.NOVA_FREE_STORE = path.join(dir, "ops", "wordlists", "free-store.json");
  const rec = await wl.fetchList(NAME, { cwd: dir });
  assert.equal(rec.verified, false, "قبل ملف ببصمة مختلفة!");
  assert.equal(rec.path, "", "كتب حاجة على القرص رغم الرفض");
  const att = rec.attempts.map((a) => a.outcome).join(" · ");
  assert.match(att, /sha256 مختلف|الحجم .* مش/, att);
  assert.equal(fs.existsSync(path.join(dir, "state", "wordlists", NAME)), false, "الملف الملوّث اتساب على القرص");
});

await checkAsync("مصدر واقع بيتقال عليه واقع، والمرآة التانية لسه بتُجرّب", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-fs-dead-"));
  writeStore(dir, `${base}/dead/${NAME}`); // هيرجّع 500
  process.env.NOVA_FREE_STORE = path.join(dir, "ops", "wordlists", "free-store.json");
  const rec = await wl.fetchList(NAME, { cwd: dir });
  assert.equal(rec.verified, false);
  assert.ok(rec.attempts.length >= 2, `لازم يجرّب المرآة وraw: ${JSON.stringify(rec.attempts)}`);
  assert.match(JSON.stringify(rec.attempts), /HTTP 500/);
  assert.match(JSON.stringify(rec.attempts), /HTTP 404/, "raw ما اتجرّبش");
});

await checkAsync("بلا بصمة في المستودع = مافيش تنزيل أصلًا (وليس صفر نتائج)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-fs-nomanifest-"));
  fs.mkdirSync(path.join(dir, "ops", "wordlists"), { recursive: true });
  process.env.NOVA_FREE_STORE = path.join(dir, "ops", "wordlists", "free-store.json"); // مش موجود
  const rec = await wl.fetchList("ghost.txt", { cwd: dir });
  assert.equal(rec.verified, false);
  assert.match(rec.attempts[0].outcome, /بلا بصمة|مافيش free-store/, JSON.stringify(rec.attempts));
  // ومفيش أي طلب شبكة في المسار ده: البصمة غايبة فالجلب نفسه ما بدأش
  assert.ok(hits.every((h) => !h.includes("ghost")), "بعت طلب لملف بلا بصمة");
});

await checkAsync("سقف الحجم بيوقف الجلب قبل ما ياكل القرص", async () => {
  // سقف fetchList محترم بس مش بينزل تحت 1KB (افتراض واقعي) — فالفكسة أكبر من السقف.
  const capDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-fs-cap-"));
  writeStore(capDir, `${base}/big/${NAME}`, Buffer.from(Array.from({ length: 300 }, (_, i) => `/p${i}`).join("\n") + "\n", "utf8"));
  process.env.NOVA_FREE_STORE = path.join(capDir, "ops", "wordlists", "free-store.json");
  const rec = await wl.fetchList(NAME, { cwd: capDir, maxBytes: 1024 });
  assert.equal(rec.verified, false, "قبل ملف فوق السقف");
  assert.match(JSON.stringify(rec.attempts), /أكبر من السقف/, JSON.stringify(rec.attempts));
});

/* ── 4 · القرايات الحقيقية في المستودع: مش كلام منشئ، محسوبة ───────────────── */
check("كل ملف inBundle في free-store.json موجود ومطابق بالحجم", () => {
  const mf = path.join(ROOT, "ops", "wordlists", "free-store.json");
  const store = JSON.parse(fs.readFileSync(mf, "utf8"));
  const names = Object.keys(store.files);
  assert.ok(names.length >= 4, `لازم 4 قرايات على الأقل، عندنا ${names.length}`);
  for (const n of names) {
    const spec = store.files[n];
    const f = path.join(ROOT, "ops", "wordlists", n);
    if (spec.inBundle) {
      assert.ok(fs.existsSync(f), `${n} معلن في الحزمة ومش موجود`);
      const buf = fs.readFileSync(f);
      assert.equal(buf.length, spec.bytes, `${n} حجمه اتغيّر`);
      assert.equal(sha(buf), spec.sha256, `${n} بصمته اتغيّرت`);
      assert.doesNotMatch(buf.toString("utf8"), /[^\x20-\x7e\n]/, `${n} فيه حرف مش ASCII`);
    } else {
      assert.equal(fs.existsSync(path.join(ROOT, "ops", "wordlists", n)), false, `${n} معلَن remote-only بس هو في الحزمة`);
    }
  }
});

check("الحِجم الصغير لسه موجود: الحزمة ما تتقفلش على القرايات الكبيرة", () => {
  const bundleBytes = ["nova-paths.txt", "paths-medium.txt", "params-burp.txt", "nova-params-xl.txt"].reduce(
    (a, n) => a + fs.statSync(path.join(ROOT, "ops", "wordlists", n)).size,
    0,
  );
  assert.ok(bundleBytes < 900 * 1024, `القرايات الافتراضية ${Math.round(bundleBytes / 1024)}KB — كبير أوي على حزمة بينزّلها updater`);
  const big = fs.statSync(path.join(ROOT, "ops", "wordlists", "nova-paths-xl.txt")).size;
  assert.ok(big > 400 * 1024, `nova-paths-xl=${big} بايت — مش معقولة`);
});

check("الحجم الكبير مستثنى بالقرار وليه مرآتان معلنتان", () => {
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "ops", "wordlists", "free-store.json"), "utf8"));
  const remote = Object.entries(store.files).filter(([, v]) => !v.inBundle);
  assert.equal(remote.length, 1, `لازم ملف remote-only واحد دلوقتي، عندنا ${remote.length}`);
  const srcs = wl.listSources(store, remote[0][0]);
  assert.ok(srcs.length >= 3, `لازم 3 مصادر على الأقل (drive/dropbox/raw)، عندنا ${srcs.length}`);
  assert.ok(srcs.some((x) => x.provider === "drive") && srcs.some((x) => x.provider === "dropbox"), "مفيش تخزين مجاني معلن");
});

server.close();
fs.rmSync(work, { recursive: true, force: true });

let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad === 0 ? 0 : 1);
