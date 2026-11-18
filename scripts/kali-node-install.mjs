#!/usr/bin/env node
/*
 * nova-kali-node-install — التثبيت الذاتي لكالي على عقدة الأسطول.
 *
 * الهَب بيبعت الملف ده لعقدة متصلة (GitHub runner أو أي لينكس في الأسطول) وينفذه
 * بأمر واحد — وكل أوامر الهَب للعقدة بتبدأ بـnode عشان تعدي من allowlist العقدة
 * (node وgrep مسموحين في fleet-nodes.yml). القواعد المعلنة:
 *  - المخزن سحابي دايمًا: الأجزاء من فرع kali-rootfs على GitHub (raw أولًا — عقد
 *    الأكتمنتس نضيفة؛ fallback api.github.com بـGITHUB_TOKEN من بيئة العقدة نفسها —
 *    مافيش سر بيتنقل من الهَب للعقدة أبدًا).
 *  - SHA256 لكل جزء قبل ما يدخل tar، وtar بيتغذى streaming — الذروة على الدسك =
 *    الاستخراج + جزء واحد (~90MB).
 *  - marker: موجودة وpackages>=400 → exit 0 فورًا (idempotent).
 *  - lock: تشغيلين متوازيين ممنوعين (exit 7).
 *  - فشل مساحة → exit 3 · tar فشل → تنظيف جزئي وخروج صادق · نقل فشل → exit 6.
 *  - مافيش أي حاجة بتتكتب على الهَب — ده شغل العقدة لوحدها.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawn } from "node:child_process";

const REPO = process.env.NOVA_KALI_REPO_SLUG || "DawshaX/xFREEDOLLARHACHx";
const RB = process.env.NOVA_KALI_BRANCH || "kali-rootfs";
const SB = process.env.NOVA_KALI_STATIC_BRANCH || "kali-static";
const ROOTFS = process.argv[2] || path.join(os.homedir(), "kali-rootfs", "rootfs");
const BASE = path.dirname(ROOTFS);
const MARKER = path.join(BASE, ".kali-node-installed");
const LOCK = path.join(BASE, ".kali-node-lock");
const T0 = Date.now();
const SOFT_DEADLINE = Number(process.env.NOVA_KALI_SOFT_DEADLINE_MS || 30 * 60 * 1000); // TEST67 — 30د افتراضي (المخزن 8.5GB والمنافسة بتخلي ال9د مش كفاية)

/** خروج مُتسلسل: بيرمي عشان finally يشال اللوك قبل ما العملية تقفل — مافيش لوك يتيم أبدًا. */
class KaliExit extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

function log(m) {
  console.log("[kali-node " + Math.round((Date.now() - T0) / 1000) + "s] " + m);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBuf(ref, p) {
  try {
    const r = await fetch("https://raw.githubusercontent.com/" + REPO + "/" + ref + "/" + p, { signal: AbortSignal.timeout(180000) });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    log("raw " + p + " HTTP " + r.status + " — جرب api");
  } catch (e) {
    log("raw " + p + ": " + String(e.message).slice(0, 60) + " — جرب api");
  }
  const headers = { "Accept": "application/vnd.github.raw", "User-Agent": "nova-kali-node" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
  const r2 = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + p + "?ref=" + ref, { headers: headers, signal: AbortSignal.timeout(180000) });
  if (!r2.ok) throw new Error("api HTTP " + r2.status);
  return Buffer.from(await r2.arrayBuffer());
}

function packagesCount(rootfs) {
  try {
    return fs.readFileSync(path.join(rootfs, "var/lib/dpkg/status"), "utf8").split("\n").filter((l) => l.startsWith("Package:")).length;
  } catch {
    return 0;
  }
}

async function install() {
  let freeGB = null;
  try {
    const st = fs.statfsSync(BASE);
    freeGB = Math.round((st.bsize * st.bavail) / 2 ** 30);
  } catch {}
  log("المساحة الفاضية: " + (freeGB === null ? "مش معروفة" : freeGB + "GB") + " · dest " + ROOTFS);
  if (freeGB !== null && freeGB < 16) {
    log("الرفض الصادق: " + freeGB + "GB مش هتحمل التبيئة (~16GB)");
    throw new KaliExit(3, "exit 3");
  }

  let shas = null;
  for (let a = 1; a <= 3; a++) {
    try {
      shas = (await fetchBuf(RB, "SHA256SUMS")).toString();
      break;
    } catch (e) {
      log("SHA256SUMS محاولة " + a + " فشلت: " + String(e.message).slice(0, 80));
      await sleep(3000);
    }
  }
  if (!shas) {
    log("النقل مش مستقر — exit 6");
    throw new KaliExit(6, "exit 6");
  }
  const rows = {};
  for (const m of shas.matchAll(/([0-9a-f]{64})\s+(part-\d+)\s*/g)) rows[m[2]] = m[1];
  const parts = Object.keys(rows).sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
  if (!parts.length) {
    log("مافيش أجزاء في SHA256SUMS — exit 6");
    throw new KaliExit(6, "exit 6");
  }
  log("الأجزاء: " + parts.length);

  fs.rmSync(ROOTFS, { recursive: true, force: true });
  fs.mkdirSync(ROOTFS, { recursive: true });
  const tar = spawn("tar", ["-xzf", "-", "-C", ROOTFS]);
  let tarErr = "";
  tar.stderr.on("data", (d) => {
    tarErr += d.toString();
  });
  const tarExit = new Promise((res) => tar.on("close", (c) => res(c)));
  const feed = (buf) => new Promise((res, rej) => tar.stdin.write(buf, (e) => (e ? rej(e) : res())));
  let done = 0;
  for (const p of parts) {
    if (Date.now() - T0 > SOFT_DEADLINE) {
      log("الوقت خلص وسط التشغيل عند " + done + "/" + parts.length + " — خروج صادق (جرّب kali_run تاني وهتبدأ من جديد بالقياس)");
      tar.kill("SIGKILL");
      throw new KaliExit(6, "exit 6");
    }
    let buf = null;
    let lastErr = "";
    for (let a = 0; a < 2 && !buf; a++) {
      try {
        buf = await fetchBuf(RB, p);
      } catch (e) {
        lastErr = e.message;
        await sleep(2000);
      }
    }
    if (!buf) {
      log(p + " فشل بعد المحاولات: " + lastErr.slice(0, 80));
      tar.kill("SIGKILL");
      throw new KaliExit(6, "exit 6");
    }
    const actual = crypto.createHash("sha256").update(buf).digest("hex");
    if (actual !== rows[p]) {
      log(p + " الهاش مش مطابق — exit 6");
      tar.kill("SIGKILL");
      throw new KaliExit(6, "exit 6");
    }
    await feed(buf);
    done++;
    if (done % 8 === 0 || done === parts.length) log(done + "/" + parts.length + " أجزاء ✓");
  }
  tar.stdin.end();
  const code = await tarExit;
  if (code !== 0) {
    log("tar خرج بكود " + code + " " + tarErr.slice(0, 120) + " — تنظيف جزئي");
    try {
      fs.rmSync(ROOTFS, { recursive: true, force: true });
    } catch {}
    throw new KaliExit(1, "exit 1");
  }
  log("الاستخراج خلص — الهيكل: " + fs.readdirSync(ROOTFS).sort().join(" "));

  // TEST53 — فكس الجذر (مقاس 2026-11-17): جيت مايخزنش المجلدات الفاضية فالجست
  // بيولّد من غيرها — apt/dpkg بيحتاجوها كلها وبيفشلوا واحد-واحد
  // («E: Directory '/var/log/apt/' missing» · «archives/partial is missing» ·
  // «dpkg returned an error code (2)»). القائمة دي مقاسة من rootfs الفرع نفسه:
  for (const d of [
    "var/log/apt",
    "var/lib/dpkg/updates",
    "var/lib/dpkg/triggers/File",
    "var/lib/dpkg/triggers/Unincorporated",
    "var/lib/dpkg/alternatives",
    "var/cache/apt/archives/partial",
    "var/lib/apt/lists/partial",
    "var/lib/ucf/cache",
    "run/lock",
    "tmp",
    "var/tmp",
    "var/lib/sudo",
    "var/spool/mail",
  ]) {
    try { fs.mkdirSync(path.join(ROOTFS, ...d.split("/")), { recursive: true }); } catch { /* موجود أصلًا */ }
  }
  log("مجلدات الجست الحرجة (13) اتأكدت — apt/dpkg شغالين من أول مرة");

  let proot = null;
  for (let a = 1; a <= 3; a++) {
    try {
      proot = await fetchBuf(SB, "proot-static");
      break;
    } catch (e) {
      await sleep(2000);
    }
  }
  if (!proot) {
    log("proot-static فشل — exit 6");
    throw new KaliExit(6, "exit 6");
  }
  const binDir = path.join(ROOTFS, "usr", "local", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, "proot-static");
  fs.writeFileSync(binPath, proot);
  fs.chmodSync(binPath, 0o755);
  const works = await new Promise((res) => {
    const c = spawn(binPath, ["--version"], { timeout: 15000 });
    c.on("error", () => res(false));
    c.on("close", (x) => res(x === 0));
  });
  if (!works) {
    log("proot-static مش شغّال — exit 4");
    throw new KaliExit(4, "exit 4");
  }

  // TEST30 — إصلاح مقاس (2026-11-15): OpenJDK 25 (بورب) كان بيفشل بـlibjli.so —
  // سلسلة الـCA للـloader مش بتحمل lib/jli. الحل: ld.so.conf.d + ldconfig جوه proot
  // — بعد كده: burpsuite --version وjava -version بيردوا bare (مقاس: 2026.10.1-54773).
  try {
    const jvm = path.join(ROOTFS, "usr", "lib", "jvm");
    const j25 = fs.readdirSync(jvm).find((d) => /^java-1\.\d+\.0-openjdk/.test(d) && fs.existsSync(path.join(jvm, d, "bin", "java")));
    if (j25) {
      const jRel = "/usr/lib/jvm/" + j25;
      fs.writeFileSync(path.join(ROOTFS, "etc", "ld.so.conf.d", "zz-nova-java-jli.conf"), jRel + "/lib/jli\n" + jRel + "/lib\n");
      const jc = spawn(binPath, ["-0", "-r", ROOTFS, "/usr/sbin/ldconfig"], { timeout: 60000 });
      await new Promise((res) => jc.on("close", res).on("error", res));
      log("Java " + j25 + " + libjli اتظبطوا — burpsuite بيرد bare");
    }
  } catch (e) {
    log("ملاحظة: تظبيط Java اتخطى (" + (e && e.message ? e.message : e) + ") — burpsuite محتاج JAVA_CMD يدوي");
  }

  const pk = packagesCount(ROOTFS);
  if (pk < 400) {
    log("التحقق النهائي فشل: " + pk + " حزمة — exit 5");
    throw new KaliExit(5, "exit 5");
  }
  fs.writeFileSync(MARKER, "packages=" + pk + " at=" + new Date().toISOString() + "\n");
  log("تم في " + Math.round((Date.now() - T0) / 60000) + " دقيقة — " + pk + " حزمة ✓");
}

async function main() {
  const pk0 = packagesCount(ROOTFS);
  if (pk0 >= 400 && fs.existsSync(path.join(ROOTFS, "usr/local/bin/proot-static")) && fs.existsSync(MARKER)) {
    log("جاهزة أصلًا (" + pk0 + " حزمة) — exit 0 فورًا");
    return;
  }
  fs.mkdirSync(BASE, { recursive: true });
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < 30 * 60 * 1000) {
      log("في تشغيل شغال دلوقتي (lock عمره " + Math.round((Date.now() - st.mtimeMs) / 60000) + " دقيقة) — exit 7");
      process.exit(7);
    }
  } catch {}
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    return await install();
  } catch (e) {
    if (e instanceof KaliExit) {
      log("خروج " + e.code + ": " + e.message);
      process.exitCode = e.code;
      return;
    }
    throw e;
  } finally {
    try {
      fs.unlinkSync(LOCK);
    } catch {}
  }
}

main().catch((e) => {
  log("فشل: " + String((e && e.message) || e).slice(0, 150));
  try {
    fs.rmSync(ROOTFS, { recursive: true, force: true });
  } catch {}
  process.exitCode = 1;
});
