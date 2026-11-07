#!/usr/bin/env node
/**
 * Pack `vendor/bin` into a single mirror asset + a signed-by-hash manifest.
 * ──────────────────────────────────────────────────────────────────────────
 * Runs in CI only (`.github/workflows/toolchain-vendor.yml`). The runner is the
 * one place with a real network: it can ask api.github.com for each project's
 * latest release, and `scripts/fetch-toolchain.mjs` does the actual fetching.
 * What this script adds is the *shape the box can consume*: one tar.gz and one
 * JSON, so a container that cannot reach the API at all (measured on
 * nova.waifly.com, 2026-11-07T17:32:23Z: every tool row was
 * «api.github.com ماردّش» while `github.com/.../releases/download` worked fine)
 * still gets the whole toolbox from a single verified download.
 *
 *   node scripts/build-toolchain-mirror.mjs --from out/vendor/bin --out dist
 *
 * The manifest is deliberately boring: `tools[]` with {bin,bytes,sha256,tag,
 * version} plus the archive hash. No signature scheme, no freshness claim — the
 * consumer re-hashes every file it extracts and smoke-tests it with the tool's
 * own `-version`, so a stale or truncated asset fails loudly instead of
 * installing a half-binary.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const FROM = path.resolve(arg("from", "out/vendor/bin"));
const OUT = path.resolve(arg("out", "dist"));
const NAME = arg("name", "nova-toolchain");
const REPO = arg("repo", process.env.GITHUB_REPOSITORY || "DawshaX/xFREEDOLLARHACHx");

function sha256(file) {
  const buf = fs.readFileSync(file);
  return { hash: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

function main() {
  if (!fs.existsSync(FROM)) {
    console.log(`::error::مجلد الأدوات مش موجود: ${FROM} — شغّل fetch-toolchain.mjs الأول`);
    process.exit(1);
  }
  const vendored = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(FROM, ".vendored.json"), "utf8"));
    } catch {
      return {};
    }
  })();

  const names = fs
    .readdirSync(FROM)
    .filter((n) => !n.startsWith(".") && fs.statSync(path.join(FROM, n)).isFile())
    .sort();
  if (!names.length) {
    console.log(`::error::${FROM} فاضي — مافيش أداة اتنزلت، والمرآة الفاضية أخطر من مفيش مرآة`);
    process.exit(1);
  }

  // ترتيب العضويات `bin/<name>` — نفس اللي `fetch-toolchain.mjs` بيفكه بالـwildcards.
  const stage = fs.mkdtempSync(path.join(path.dirname(OUT) || "/tmp", "nova-stage-"));
  const binDir = path.join(stage, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const tools = [];
  for (const n of names) {
    const src = path.join(FROM, n);
    const { hash, bytes } = sha256(src);
    fs.copyFileSync(src, path.join(binDir, n));
    tools.push({
      bin: n,
      bytes,
      sha256: hash,
      tag: vendored[n]?.tag ?? null,
      version: vendored[n]?.version ?? null,
      fetchedAt: vendored[n]?.at ?? null,
    });
  }

  fs.mkdirSync(OUT, { recursive: true });
  const archive = path.join(OUT, `${NAME}.tar.gz`);
  const tar = spawnSync("tar", ["czf", archive, "-C", stage, "bin"], { encoding: "utf8" });
  if (tar.status !== 0) {
    console.log(`::error::tar فشل (${tar.status}): ${String(tar.stderr || "").slice(0, 200)}`);
    process.exit(1);
  }
  const arc = sha256(archive);
  const doc = {
    name: NAME,
    repo: REPO,
    builtAt: new Date().toISOString(),
    builtBy: process.env.GITHUB_ACTOR || "local",
    runUrl: process.env.GITHUB_SERVER_URL
      ? `${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    archive: path.basename(archive),
    archiveBytes: arc.bytes,
    archiveSha256: arc.hash,
    tools,
  };
  fs.writeFileSync(path.join(OUT, `${NAME}.json`), JSON.stringify(doc, null, 2) + "\n");

  // NOTES.md بيكتب نفسه جوه الـrelease، فأي حد يفتح Releases يشوف الإصدارات
  // والأحجام مقروءة من المانيفست — مش من نص مكتوب بالإيد.
  const lines = [
    `مبنيّة ${doc.builtAt} · ${tools.length} أداة · أرشيف ${(arc.bytes / 1e6).toFixed(1)} MB`,
    "",
    "| الأداة | الإصدار | الحجم | SHA-256 |",
    "|---|---|---|---|",
    ...tools.map((t) => `| \`${t.bin}\` | ${t.tag || "—"} | ${(t.bytes / 1e6).toFixed(1)} MB | \`${t.sha256.slice(0, 12)}…\` |`),
    "",
    `بتتستهلك من \`${path.basename(archive)}\` عن طريق \`scripts/fetch-toolchain.mjs\` (المِرر بيتحقق من الختم وبيعمل \`-version\` لكل ملف).`,
    doc.runUrl ? `البناء: ${doc.runUrl}` : "",
  ].filter(Boolean);
  fs.writeFileSync(path.join(OUT, "NOTES.md"), lines.join("\n") + "\n");

  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`[mirror] ${tools.length} أداة · ${(arc.bytes / 1e6).toFixed(1)} MB → ${archive}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["### 🧰 مرآة الأدوات", "", ...lines, ""].join("\n"));
  }
}

main();
