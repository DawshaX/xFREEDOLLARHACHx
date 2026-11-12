#!/usr/bin/env node
/**
 * check-free-store — يتأكد إن المرآات المجانية بتدي **نفس الباييت** اللي المستودع قالها.
 * ───────────────────────────────────────────────────────────────────────────────────
 * ليه ده مش رفاهية: إحنا بنقول للمكنة تجيب قايمة 1.9MB من Drive/Dropbox. أي حد يقدر
 * يكتب في دولاراتي الأونلاين (أو يغيّر ملف ونسى) — فالحارس مش «الملف نزل»، الحارس
 * «البصمة طابعت». الشغل ده لازم يتقاس من شبكة ليها نت كامل، ده شغال في CI:
 *
 *   node scripts/check-free-store.mjs --live        (من سيرفرActions/مكنة فيها نت)
 *   node scripts/check-free-store.mjs               (بدون نت: يتأكد من القايمة بس)
 *
 * كل مصدر بيدّى سطر: ✓ مطابق · ✗ بصمة مختلفة · ✗ HTTP nnn · ✗ ماردّش. ومفيش
 * «صفر» هنا: لو مصدر ماردّش بقوله كده، لأن «مفيش نتائج» و«السورس واقع» حاجتين
 * مختلفتين تمامًا في الصيد.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");
const TIMEOUT = Math.min(120_000, Math.max(5_000, Number(process.env.NOVA_FREE_STORE_TIMEOUT) || 60_000));
const WORD_DIR = path.join(REPO, "ops", "wordlists");
const MANIFEST = path.join(WORD_DIR, "free-store.json");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (!fs.existsSync(MANIFEST)) die(`مافيش ${path.relative(REPO, MANIFEST)}`);
const store = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const names = Object.keys(store.files || {});
if (!names.length) die("free-store.json بلا ملفات");

let bad = 0;
let checked = 0;

// 1) الملفات اللي في الحزمة: البصمة تتحسب من القرص، مش من كلام المنشئ.
for (const name of names) {
  const spec = store.files[name];
  const file = path.join(WORD_DIR, name);
  if (!spec.inBundle) {
    console.log(`· ${name} — مش في الحزمة بالقرار (${(spec.bytes / 1048576).toFixed(2)}MB) · ${spec.lines.toLocaleString("en-US")} سطر`);
    continue;
  }
  if (!fs.existsSync(file)) {
    console.error(`✗ ${name} — معلن inBundle:true بس مش موجود في ops/wordlists/`);
    bad += 1;
    continue;
  }
  const buf = fs.readFileSync(file);
  const sha = sha256(buf);
  const lines = buf.toString("utf8").split("\n").filter((x) => x.trim()).length;
  const okSha = sha === spec.sha256;
  const okBytes = buf.length === spec.bytes;
  const okLines = lines === spec.lines;
  checked += 1;
  if (okSha && okBytes && okLines) console.log(`✓ ${name} · ${lines.toLocaleString("en-US")} سطر · ${buf.length} بايت · بصمة مطابقة`);
  else {
    bad += 1;
    console.error(`✗ ${name} — بصمة/حجم/سطر مش مطابقين: sha ${okSha ? "✓" : `✗ ${sha.slice(0, 12)}`} · bytes ${okBytes ? "✓" : `✗ ${buf.length}≠${spec.bytes}`} · lines ${okLines ? "✓" : `✗ ${lines}≠${spec.lines}`}`);
  }
  // الفحص ده رخيص وأساسي: قايمة فيها أسطر فاضية أو حروف مش ASCII = أداة بتغلط.
  if (/[^\x20-\x7e\n]/.test(buf.toString("utf8"))) {
    bad += 1;
    console.error(`✗ ${name} — فيه حرف مش ASCII؛ الأدوات بتكسر معاه (الفلتر بتاع build-freelists لازم يشتغل)`);
  }
}

// 2) المرآات المعلنة: لو عندنا نت، نجيب ونقارن البصمة.
const mirrors = store.mirrors || {};
const driveFiles = mirrors?.drive?.files || {};
const dropFiles = mirrors?.dropbox?.files || {};
const urls = [];
for (const name of names) {
  const id = driveFiles[name];
  if (id && mirrors?.drive?.urlTemplate) urls.push({ name, provider: "drive", url: mirrors.drive.urlTemplate.replace("{id}", id) });
  const d = dropFiles[name];
  if (d && !String(d).startsWith("__")) urls.push({ name, provider: "dropbox", url: d });
  const raw = mirrors?.github?.rawTemplate;
  if (raw && store.files[name].inBundle) urls.push({ name, provider: "github-raw", url: raw.replace("{file}", name) });
}

if (!LIVE) {
  console.log(`\n✓ offline: ${checked} ملف متحقق منهم · ${urls.length} رابط مرآة معلن (--live يقيسهم من شبكة ليها نت)`);
  process.exit(bad === 0 ? 0 : 1);
}

for (const u of urls) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    const res = await fetch(u.url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "nova-free-store-check/1" } });
    clearTimeout(timer);
    if (!res.ok) {
      bad += 1;
      console.error(`✗ ${u.provider} · ${u.name} — HTTP ${res.status} (${Date.now() - t0}ms)`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = sha256(buf);
    const spec = store.files[u.name];
    if (sha !== spec.sha256 || buf.length !== spec.bytes) {
      bad += 1;
      console.error(`✗ ${u.provider} · ${u.name} — المرآة مش نسخة المستودع: ${buf.length} بايت و${sha.slice(0, 12)}… ≠ ${spec.bytes} و${spec.sha256.slice(0, 12)}…`);
      continue;
    }
    console.log(`✓ ${u.provider} · ${u.name} — ${buf.length.toLocaleString("en-US")} بايت · بصمة مطابقة · ${Date.now() - t0}ms`);
  } catch (err) {
    bad += 1;
    console.error(`✗ ${u.provider} · ${u.name} — ماردّش: ${String(err?.message || err).slice(0, 120)}`);
  }
}

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  fs.appendFileSync(
    summary,
    [
      "### 🪨 التخزين المجاني (wordlists/mirrors)",
      "",
      `· ملفات معلنة: **${names.length}** · متحقق منهم من القرص: **${checked}**`,
      `· روابط مرآة اتقاست: **${urls.length}** · فاشل: **${bad}**`,
      `· المصدر: \`${store.source?.name ?? "؟"}\`${store.source?.tarballSha256 ? ` · تاربول \`sha256 ${String(store.source.tarballSha256).slice(0, 16)}…\`` : ""}`,
      "",
      bad === 0 ? "**كل مرآة معلنة = نفس بايتات المستودع.**" : "**فيه مرآة مكسورة أو متغيّرة — المكنة هترفضها (sha256)، بس لازم تتصلّح.**",
    ].join("\n") + "\n",
  );
}
console.log(bad === 0 ? `\n✓ free-store: ${urls.length} رابط · الكل مطابق` : `\n✗ free-store: ${bad} مشكلة`);
process.exit(bad === 0 ? 0 : 1);
