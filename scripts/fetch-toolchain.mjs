#!/usr/bin/env node
/**
 * NOVA toolchain vendorer — bring the real tools to hosts that have no root.
 * ──────────────────────────────────────────────────────────────────────────
 * Render's free plan (and every other 512 MB PaaS) has no SSH, no `apt`, no
 * persistent disk. That is not a reason to run without real tools: ProjectDiscovery
 * ships fully static single-binary releases, and a build step can download them
 * into the app directory — the binary then lives as long as the deploy does, and a
 * redeploy simply re-fetches it. This script is that step.
 *
 *   node scripts/fetch-toolchain.mjs [--into vendor/bin] [--only nuclei,httpx]
 *                                    [--force] [--check] [--json] [--dry]
 *
 * Rules, because this runs in CI unreviewed:
 *   • No shell. Every child process is spawn(file, [argv]) — a repo name can never
 *     become a command line.
 *   • No trust: a download is smoke-tested (`-version`) before it counts, and the
 *     exact release tag is remembered so the next build does nothing.
 *   • Never fail the build: a network hiccup here must not stop a deploy. Failures
 *     are reported in the summary and as a ::warning:: annotation.
 *
 * الملف ده بيتم نسخّه جوه الحزمة المحمولة (`build-standalone.mjs`) — فأي تعديل
 * فيه لازم يفعّي بناء حزمة جديد، وده بقى مكتوب في `on.push.paths` بتاع
 * standalone-bundle.yml. قبل الإصلاح ده (2026-11-07) التعديل هنا كان بيرفع
 * المستودع بس، والمكنة تفضل بشكر سكربت قديم — القياس: 12/12 أداة «ناقصين» بعد
 * ما الإصلاح اتعمل. `test-toolchain-mirror.mjs` بيشغّل الملف ده offline عشان
 * السطوح اللي ما بتتحطش في مسار CI ما ترجعش تتكسر بالسكرت.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import zlib from "node:zlib";
import { Readable } from "node:stream";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);

const INTO = path.resolve(arg("into", "vendor/bin"));
const ONLY = arg("only", "").split(",").map((s) => s.trim()).filter(Boolean);
const FORCE = has("force");
const CHECK = has("check");
const JSONOUT = has("json");
const DRY = has("dry");

/** How to fetch each tool. `match` selects the release asset; `ver` is the version flag. */
const TOOLS = [
  { bin: "subfinder", repo: "projectdiscovery/subfinder", match: /linux[_-]amd64\.zip$/i, asset: "zip", ver: ["-version"] },
  { bin: "httpx", repo: "projectdiscovery/httpx", match: /linux_amd64\.zip$/i, asset: "zip", ver: ["-version"] },
  { bin: "nuclei", repo: "projectdiscovery/nuclei", match: /linux_amd64\.zip$/i, asset: "zip", ver: ["-version"] },
  { bin: "katana", repo: "projectdiscovery/katana", match: /linux_amd64\.zip$/i, asset: "zip", ver: ["-version"] },
  { bin: "dnsx", repo: "projectdiscovery/dnsx", match: /linux_amd64\.zip$/i, asset: "zip", ver: ["-version"] },
  { bin: "naabu", repo: "projectdiscovery/naabu", match: /linux_amd64\.zip$/i, asset: "zip", ver: ["-version"] },
  { bin: "ffuf", repo: "ffuf/ffuf", match: /linux[_-](amd64|x86_64)\.tar\.gz$/i, asset: "targz", ver: ["-V"] }, // amd64 naming, not x86_64 — the old regex matched nothing (measured: Actions run 41451529132)

  // ── Expanded set (2026-11-06) ────────────────────────────────────────────────
  // The user asked for the full Kali toolbox. Only tools that ship a *static
  // linux/amd64 binary* belong here: this script runs on hosts with no root, no
  // apt and no persistent disk, so anything needing a package manager or an
  // interpreter (nmap, sqlmap, nikto, semgrep) is NOT vendorable — those live in
  // Dockerfile.kali instead. Adding them here would produce a permanent
  // "failed" row that looks like a bug rather than a boundary.
  // Asset names below are the REAL ones measured from each repo's latest release
  // (2026-11-06) — not guesses. amass ships .tar.gz not .zip; dalfox uses
  // `linux-x86_64` not `linux_amd64`; WhatWeb publishes no release assets at all
  // (it is a Ruby script), so it is declared NOT_VENDORABLE instead.
  { bin: "amass", repo: "owasp-amass/amass", match: /amass_linux_amd64\.tar\.gz$/i, asset: "targz", ver: ["-version"] },
  { bin: "gobuster", repo: "OJ/gobuster", match: /Linux_x86_64\.tar\.gz$/i, asset: "targz", ver: ["version"] },
  { bin: "dalfox", repo: "hahwul/dalfox", match: /linux-x86_64\.tar\.gz$/i, asset: "targz", ver: ["version"] },
  { bin: "gitleaks", repo: "gitleaks/gitleaks", match: /linux_x64\.tar\.gz$/i, asset: "targz", ver: ["version"] },
  { bin: "trivy", repo: "aquasecurity/trivy", match: /Linux-64bit\.tar\.gz$/i, asset: "targz", ver: ["--version"] },
].filter((t) => !ONLY.length || ONLY.includes(t.bin));

/**
 * Tools the user asked for that CANNOT be vendored as a static binary.
 * Declared here so the boundary is explicit and testable instead of being
 * rediscovered as a "failure" every run. `why` is what the agent tells the user.
 */
export const NOT_VENDORABLE = [
  { bin: "nmap", why: "محتاج apt/root — بيتثبت في Dockerfile.kali أو على عقدة Linux كاملة" },
  { bin: "sqlmap", why: "سكربت Python — محتاج مفسّر بايثون، بيتشغّل من Dockerfile.kali" },
  { bin: "nikto", why: "سكربت Perl — محتاج مفسّر بيرل، بيتشغّل من Dockerfile.kali" },
  { bin: "semgrep", why: "محتاج Python + قواعد — بيتشغّل من Dockerfile.kali" },
  { bin: "whatweb", why: "سكربت Ruby ومفيش له release assets — بيتشغّل من Dockerfile.kali" },
];

/**
 * المرآة: إصدار عندنا على جيت هاب (`nova-toolchain`) فيه الأداوات الثابتة + manifest
 * بأختام SHA-256. ليه وهو فيه أصلًا؟ القياس على السلوت الحيّ (2026-11-07T17:32:23Z):
 * `node scripts/fetch-toolchain.mjs` جرى لآخره (exitCode 0 · 3.3 ثانية) وكل أداة
 * طلعت `failed · api.github.com ماردّش` — الحاوية بتوصلها تنزيلات `github.com/.../releases/download`
 * (متقاس: الحزمة 3.0MB نزلت في 0.7 ثانية) بس الـ**API** محجوب/محدود من هناك.
 * فبدل ما نطلب من المكنة تحل اسم آخر إصدار، CI (شغّال على رانر شبكة مفتوحة) بيحلّه
 * وبيحزّنه، والمكنة بتسحب أرشيف واحد وتتحقق من الختم. مافيش سر في العنوان: الأصل عام.
 * `NOVA_TOOLCHAIN_MIRROR` بياخد الأولوية، و`--no-mirror` بيرجع للمسار القديم.
 */
const CI_ENV = ["GITHUB_ACTIONS", "CI"].some((k) => /^(1|true)$/i.test(String(process.env[k] ?? "")));
const MIRROR_BASE = String(
  arg("mirror", process.env.NOVA_TOOLCHAIN_MIRROR
    ?? (process.env.NOVA_SUPERVISED === "1" && !CI_ENV
      ? "https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/nova-toolchain"
      : "")),
).replace(/\/+$/, "");
const MIRROR = has("no-mirror") ? "" : MIRROR_BASE;
/** سقف الأرشيف: الحزمة كلها ~200-400MB؛ فوق ده بنقول فشل صريح بدل ما ننفخ القرص. */
const MIRROR_MAX_BYTES = Math.round(Number(process.env.NOVA_TOOLCHAIN_MIRROR_MAX_MB || 900) * 1048576);

const MANIFEST = path.join(INTO, ".vendored.json");

const log = (...a) => { if (!JSONOUT) console.log("[toolchain]", ...a); };
// `::warning::` علي stderr: مع `--json` أي سطر علي stdout بيكسر JSON.parse
// اللي عند CI (قِيت في أول تشغيل 2026-11-07)، والاتنين بيتقروا كأنوتيشن في Actions.
const warn = (m) => console.error(`::warning::${m}`);

function run(file, args, { cwd, timeout = 20_000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const t = setTimeout(() => { p.kill("SIGKILL"); resolve({ code: -1, out, err: err + "\n::timeout" }); }, timeout);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -2, out: "", err: String(e.message || e) }); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, out, err }); });
  });
}

async function gh(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: { "user-agent": "nova-toolchain", accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(25_000),
  }).catch((e) => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

/**
 * تنزيل مكتوب على القرص على طول (Readable→WriteStream). المسار القديم كان
 * `res.arrayBuffer()` بيحمل الملف كامل في الرام: على حاوية 256MB متقاسة
 * (`/api/nova-core/version → rssMb 159`) ده هو اللي خلّى محاولة 17:17:17Z تموت
 * بـ`exitCode: null · ms 6395` بعد أول ملف كبير — مش خطأ شبكة، قتل من الرام.
 */
function downloadStream(url, to, { timeoutMs = 240_000, maxBytes = 0 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => { try { ac.abort(); } catch { /* already */ } finish({ ok: false, why: `انتهت المهلة (${Math.round(timeoutMs / 1000)}s)` }); }, timeoutMs);
    const ac = new AbortController();
    fetch(url, { redirect: "follow", signal: ac.signal })
      .then((res) => {
        if (!res.ok || !res.body) { clearTimeout(timer); return finish({ ok: false, why: `HTTP ${res.status ?? "?"}` }); }
        const declared = Number(res.headers.get("content-length") || 0);
        if (maxBytes && declared && declared > maxBytes) { clearTimeout(timer); return finish({ ok: false, why: `المعلن ${declared} بايت أكبر من السقف` }); }
        const out = fs.createWriteStream(to);
        let bytes = 0;
        let sha = null;
        try { sha = crypto.createHash("sha256"); } catch { sha = null; }
        const src = Readable.fromWeb(res.body);
        src.on("data", (c) => {
          bytes += c.length;
          if (sha) sha.update(c);
          if (maxBytes && bytes > maxBytes) { src.destroy(new Error("over-cap")); }
        });
        src.on("error", (e) => { try { out.destroy(); } catch { /* already */ } clearTimeout(timer); finish({ ok: false, why: e.message }); });
        out.on("error", (e) => { clearTimeout(timer); finish({ ok: false, why: e.message }); });
        out.on("close", () => { clearTimeout(timer); finish({ ok: bytes > 1024, bytes, sha256: sha ? sha.digest("hex") : null, why: bytes > 1024 ? null : "الملف أصغر من 1KB" }); });
        src.pipe(out);
      })
      .catch((e) => { clearTimeout(timer); finish({ ok: false, why: String(e?.message || e) }); });
  });
}

/** التنزيل العادي بقى علي نفس مسار البث — القياس: `exitCode:null · ms 6395` على حاوية 256MB. */
async function download(url, to) {
  const got = await downloadStream(url, to, { timeoutMs: 180_000, maxBytes: 400 * 1048576 });
  return got.ok;
}

/** Find the executable inside an extracted tree (archives nest it in a folder). */
function findIn(dir, name) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      if (e.name === name) return full;
    }
  }
  return null;
}

/**
 * Minimal ZIP reader (central directory, stored + deflate) — no `unzip`, no python.
 * Render's free-tier builder is not guaranteed to have either, and a toolchain that
 * depends on a system binary being installed is a toolchain that silently is not there.
 */
function unzipHere(archive, dest) {
  const buf = fs.readFileSync(archive);
  // End of Central Directory: signature 0x06054b50, searched from the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return false;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  fs.mkdirSync(dest, { recursive: true });
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) return false;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/")) continue;
    const base = path.resolve(dest, name);
    if (!base.startsWith(dest + path.sep)) continue; // zip-slip guard
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data;
    try {
      data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
    } catch { data = null; }
    if (data == null) continue; // encrypted/unsupported entry: skip, don't die
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(base, data);
    fs.chmodSync(base, 0o755);
  }
  return true;
}

async function extract(archive, dest, kind) {
  fs.mkdirSync(dest, { recursive: true });
  if (kind === "zip") {
    if (unzipHere(archive, dest)) return true;
    const r = await run("unzip", ["-o", "-q", archive, "-d", dest], { timeout: 90_000 });
    if (r.code === 0) return true;
    const p = await run("python3", ["-m", "zipfile", "-e", archive, dest], { timeout: 90_000 });
    return p.code === 0;
  }
  const r = await run("tar", ["xzf", archive, "-C", dest], { timeout: 90_000 });
  return r.code === 0;
}

function readManifest() { try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return {}; } }
function writeManifest(m) { try { fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n"); } catch { /* read-only fs is fine */ } }

/** فهرس المرآة بيُنزّل مرة واحدة لكل تشغيل (أرشيف واحد لـ12 أداة). */
let mirrorIndex = null;
async function loadMirror() {
  if (mirrorIndex) return mirrorIndex;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-mirror-"));
  const man = path.join(tmp, "nova-toolchain.json");
  const got = await downloadStream(`${MIRROR}/nova-toolchain.json`, man, { timeoutMs: 30_000, maxBytes: 4 * 1048576 });
  if (!got.ok) { fs.rmSync(tmp, { recursive: true, force: true }); mirrorIndex = { error: got.why }; return mirrorIndex; }
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(man, "utf8")); } catch (e) { doc = null; }
  if (!doc || !Array.isArray(doc.tools) || !doc.archive) {
    fs.rmSync(tmp, { recursive: true, force: true });
    mirrorIndex = { error: "المانيفست مش مقروء" };
    return mirrorIndex;
  }
  const arc = path.join(tmp, doc.archive);
  log(`↓ مرآة: ${doc.archive} (${(Number(doc.archiveBytes || 0) / 1e6).toFixed(0)} MB) — ${doc.builtAt || "نسخة بلا تاريخ"}`);
  const dl = await downloadStream(`${MIRROR}/${doc.archive}`, arc, { timeoutMs: 600_000, maxBytes: MIRROR_MAX_BYTES });
  if (!dl.ok) { fs.rmSync(tmp, { recursive: true, force: true }); mirrorIndex = { error: `تنزيل الأرشيف: ${dl.why}` }; return mirrorIndex; }
  // الختم قبل الفك: أرشيف من إصدار قديم أو ملف مقطوع لازم يرفض، مش يتفك على عميان.
  if (doc.archiveSha256 && dl.sha256 && dl.sha256 !== doc.archiveSha256) {
    fs.rmSync(tmp, { recursive: true, force: true });
    mirrorIndex = { error: `ختم الأرشيف مش مطابق (${dl.sha256.slice(0, 12)}… ≠ ${doc.archiveSha256.slice(0, 12)}…)` };
    return mirrorIndex;
  }
  mirrorIndex = { doc, arc, tmp, byBin: new Map(doc.tools.map((t) => [t.bin, t])) };
  return mirrorIndex;
}

/**
 * فك عضو واحد من الأرشيف بأمر `tar` نفسه اللي بيستخدمه مسار الـtargz فوق —
 * القياس إن `tar` موجود على الحاوية (الأدوات اللي في vendor/bin اتفكت بيه أصلًا).
 */
async function extractFromMirror(idx, bin, dest) {
  const r = await run("tar", ["xzf", idx.arc, "-C", idx.tmp, `--wildcards`, `--no-same-owner`, `bin/${bin}`], { timeout: 120_000 });
  if (r.code !== 0) return { ok: false, why: `tar طلع ${r.code}: ${String(r.err || r.out).slice(0, 120)}` };
  const found = path.join(idx.tmp, "bin", bin);
  if (!fs.existsSync(found)) return { ok: false, why: "العضو مش في الأرشيف" };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(found, dest);
  fs.chmodSync(dest, 0o755);
  try { fs.rmSync(found, { force: true }); } catch { /* cleanup only */ }
  return { ok: true };
}

async function fetchOne(tool, manifest) {
  const latest = await gh(`/repos/${tool.repo}/releases/latest`);
  const tag = latest?.tag_name || null;
  const dest = path.join(INTO, tool.bin);
  // الملف موجود بس مش executable — حالة متقاسة على وايفلّي 2026-11-07: amass (52MB)
  // وdalfox (7.3MB) وnaabu (33MB) كانوا في `vendor/bin` بحجمهم الكامل والمحرك عدّهم
  // «ناقصين» لأن `findBinary` بيشترط X_OK. الإصلاح أرخص من تنزيل 90MB: chmod ثم
  // اختبار نسخة حقيقي — والنجاح يتقاس من الأدوات نفسها، ومافيش ادعاء: لو بعد
  // chmod الأداة ما طلعتش نسخها، بنرجّع الملف لحالته ونقول فشل.
  if (!FORCE && fs.existsSync(dest)) {
    let execOk = true;
    try { fs.accessSync(dest, fs.constants.X_OK); } catch { execOk = false; }
    if (!execOk) {
      try { fs.chmodSync(dest, 0o755); } catch { /* fs مقفول للكتابة */ }
      const fix = await run(dest, tool.ver, { timeout: 15_000 });
      const fixLine = String(fix.out || fix.err).split("\n").map((x) => x.trim()).filter(Boolean)[0] || "";
      if (fix.code === 0 && fixLine) {
        return { bin: tool.bin, status: "repaired", tag: manifest[tool.bin]?.tag ?? tag, why: `chmod أصلح الصلاحية · ${fixLine.slice(0, 60)}` };
      }
      try { fs.chmodSync(dest, 0o644); } catch { /* leave it */ }
      return { bin: tool.bin, status: "failed", tag, why: "الملف موجود بس حتى بعد chmod ما طلعش نسخة — نص منزيل أو architecture مش مطابقة" };
    }
  }
  if (!FORCE && fs.existsSync(dest) && manifest[tool.bin]?.tag === tag && tag) {
    return { bin: tool.bin, status: "skipped", tag, why: "موجود من قبل بنفس الإصدار" };
  }
  if (!latest) {
    // المكنة ما بتشوفش api.github.com (متقاس 17:32:23Z) — ده مش فشل تنزيل، ده
    // محلول عندنا: الأرشيف المرآتي. بنحاوله قبل ما نعلن الفشل.
    const fromMirror = await tryMirror(tool, manifest);
    if (fromMirror) return fromMirror;
    return { bin: tool.bin, status: "failed", why: "api.github.com ماردّش (rate limit أو مفيش خروج من هنا)" };
  }
  const asset = (latest.assets || []).find((a) => tool.match.test(a.name));
  if (!asset) return { bin: tool.bin, status: "failed", tag, why: `مفيش asset بيطابق linux/amd64 من بين ${(latest.assets || []).length} ملف` };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-tool-"));
  const archive = path.join(tmp, path.basename(asset.name));
  log(`↓ ${tool.bin} ${tag || ""} (${(asset.size / 1e6).toFixed(1)} MB)`);
  if (DRY) return { bin: tool.bin, status: "dry", tag, url: asset.browser_download_url };
  if (!(await download(asset.browser_download_url, archive))) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { bin: tool.bin, status: "failed", tag, why: "التنزيل فشل من " + new URL(asset.browser_download_url).host };
  }
  const exDir = path.join(tmp, "x");
  if (!(await extract(archive, exDir, tool.asset))) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { bin: tool.bin, status: "failed", tag, why: "فك الضغط فشل (unzip/python3/tar مش موجودة؟)" };
  }
  const found = findIn(exDir, tool.bin);
  if (!found) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { bin: tool.bin, status: "failed", tag, why: "الملف التنفيذي مش جوه الأرشيف" };
  }
  fs.mkdirSync(INTO, { recursive: true });
  fs.copyFileSync(found, dest);
  fs.chmodSync(dest, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });

  const smoke = await run(dest, tool.ver, { timeout: 15_000 });
  const line = String(smoke.out || smoke.err).split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  if (smoke.code !== 0 || !line) {
    fs.rmSync(dest, { force: true });
    return { bin: tool.bin, status: "failed", tag, why: `اختبار النسخة مامرّش (exit ${smoke.code}) — غالباً architecture مش مطابق` };
  }
  manifest[tool.bin] = { tag, at: new Date().toISOString(), version: line.slice(0, 120), path: dest };
  log(`✓ ${tool.bin} → ${line.slice(0, 90)}`);
  return { bin: tool.bin, status: "installed", tag, version: line.slice(0, 120) };
}

/** نسخة الأداة من مرآتنا — بتتحقق من الختم وبتعمل اختبار نسخة زي المسار الأصلي. */
async function tryMirror(tool, manifest) {
  if (!MIRROR) return null;
  const idx = await loadMirror();
  if (!idx || !idx.byBin) return { bin: tool.bin, status: "failed", why: `المرآة ما وصلتش: ${idx?.error || "سبب مجهول"}` };
  const entry = idx.byBin.get(tool.bin);
  if (!entry) return null; // مش في مرآتنا —سيبه لمسار المنبع
  const dest = path.join(INTO, tool.bin);
  const ex = await extractFromMirror(idx, tool.bin, dest);
  if (!ex.ok) return { bin: tool.bin, status: "failed", tag: entry.tag, why: ex.why };
  if (entry.sha256) {
    let got = null;
    try {
      got = await new Promise((resolve) => {
        const h = crypto.createHash("sha256");
        const rs = fs.createReadStream(dest);
        rs.on("data", (c) => h.update(c));
        rs.on("end", () => resolve(h.digest("hex")));
        rs.on("error", () => resolve(null));
      });
    } catch { got = null; }
    if (got && got !== entry.sha256) {
      fs.rmSync(dest, { force: true });
      return { bin: tool.bin, status: "failed", tag: entry.tag, why: "ملف الأداة مش مطابق لختم المرآة" };
    }
  }
  const smoke = await run(dest, tool.ver, { timeout: 15_000 });
  const line = String(smoke.out || smoke.err).split("\n").map((x) => x.trim()).filter(Boolean)[0] || "";
  if (smoke.code !== 0 || !line) {
    fs.rmSync(dest, { force: true });
    return { bin: tool.bin, status: "failed", tag: entry.tag, why: `اختبار النسخة مامرّش بعد التنزيل من المرآة (exit ${smoke.code})` };
  }
  manifest[tool.bin] = { tag: entry.tag ?? null, at: new Date().toISOString(), version: line.slice(0, 120), path: dest, source: "mirror" };
  log(`✓ ${tool.bin} → ${line.slice(0, 90)} (مرآة)`);
  return { bin: tool.bin, status: "installed", tag: entry.tag ?? null, version: line.slice(0, 120), source: "mirror" };
}

async function main() {
  fs.mkdirSync(INTO, { recursive: true });
  const manifest = readManifest();
  if (CHECK) {
    const rows = TOOLS.map((t) => ({ bin: t.bin, present: fs.existsSync(path.join(INTO, t.bin)), tag: manifest[t.bin]?.tag ?? null }));
    if (JSONOUT) console.log(JSON.stringify({ into: INTO, rows }, null, 2));
    else rows.forEach((r) => log(`${r.present ? "✓" : "✗"} ${r.bin}${r.tag ? ` · ${r.tag}` : ""}`));
    return;
  }
  const results = [];
  for (const t of TOOLS) {
    try { results.push(await fetchOne(t, manifest)); }
    catch (e) { results.push({ bin: t.bin, status: "failed", why: String(e?.message || e) }); }
    writeManifest(manifest); // keep progress durable: a slow tool must not lose the fast ones
  }
  const ok = results.filter((r) => r.status === "installed" || r.status === "skipped");
  const bad = results.filter((r) => r.status === "failed");
  log(`جاهز: ${ok.length}/${TOOLS.length} في ${INTO}`);
  if (bad.length) warn(`${bad.length} أداة ما نزلتش: ${bad.map((b) => `${b.bin} (${b.why})`).join(" · ").slice(0, 300)}`);
  if (JSONOUT) console.log(JSON.stringify({ into: INTO, ok: ok.length, total: TOOLS.length, results }, null, 2));
  else for (const r of results) log(`  ${r.status === "failed" ? "✗" : r.status === "installed" ? "✓" : "·"} ${r.bin}${r.why ? ` — ${r.why}` : ""}`);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file && results.length) {
    fs.appendFileSync(file, [
      "### 🧰 الأدوات اللي نزلت في الحزمة",
      "",
      "| الأداة | الحالة | الإصدار |",
      "|---|---|---|",
      ...results.map((r) => `| \`${r.bin}\` | ${r.status} | ${r.tag || r.why || "—"} |`),
      "",
      `_المسار: \`${INTO}\` — المحرك بيلاقيه عن طريق \`searchDirs()\` / \`NOVA_TOOL_DIR\`._`,
    ].join("\n") + "\n");
  }
}

main().then(() => process.exit(0)).catch((e) => {
  // A deploy must not die because a CDN had a bad minute — but it must say so.
  console.error(`::warning::toolchain vendorer crashed: ${String(e?.message || e)} — المحرك هيشغل الاستطلاع السلبي بس`);
  process.exit(0);
});
