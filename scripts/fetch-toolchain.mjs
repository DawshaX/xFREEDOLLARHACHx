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
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import zlib from "node:zlib";

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
].filter((t) => !ONLY.length || ONLY.includes(t.bin));

const MANIFEST = path.join(INTO, ".vendored.json");

const log = (...a) => { if (!JSONOUT) console.log("[toolchain]", ...a); };
const warn = (m) => console.log(`::warning::${m}`);

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

async function download(url, to) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) }).catch((e) => null);
  if (!res || !res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) return false;
  fs.writeFileSync(to, buf);
  return true;
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

async function fetchOne(tool, manifest) {
  const latest = await gh(`/repos/${tool.repo}/releases/latest`);
  const tag = latest?.tag_name || null;
  const dest = path.join(INTO, tool.bin);
  if (!FORCE && fs.existsSync(dest) && manifest[tool.bin]?.tag === tag && tag) {
    return { bin: tool.bin, status: "skipped", tag, why: "موجود من قبل بنفس الإصدار" };
  }
  if (!latest) return { bin: tool.bin, status: "failed", why: "api.github.com ماردّش (rate limit أو مفيش خروج من هنا)" };
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
  console.log(`::warning::toolchain vendorer crashed: ${String(e?.message || e)} — المحرك هيشغل الاستطلاع السلبي بس`);
  process.exit(0);
});
