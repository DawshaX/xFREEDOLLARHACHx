#!/usr/bin/env node
/**
 * CyberNova — portable 24/7 bundle builder
 * ───────────────────────────────────────
 * Produces `dist-standalone/nova-24-7/` (+ a .zip) that runs with **zero
 * install step**: no pnpm, no node_modules, no build on the host.
 *
 *   node scripts/build-standalone.mjs
 *
 * Layout
 *   server.mjs      the whole API server, bundled by esbuild (one file)
 *   public/         the built panel (HTML/JS/CSS)
 *   state/          long-term memory + brain state (real files, portable)
 *   start.sh        `node server.mjs` with sane defaults
 *   start-tunnel.sh start + a free Cloudflare HTTPS tunnel (no account)
 *   package.json    so Panels that require one are happy
 *   README.txt      Arabic instructions for the host
 *
 * Why this exists: free 24/7 hosts (Silly Development, Pterodactyl panels)
 * give 256 MB RAM and 512 MB disk. A pnpm install would not fit — 9–10 MB of
 * pre-built files do, and the process idles around 110 MB RSS.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist-standalone", "nova-24-7");
const SERVER = path.join(ROOT, "artifacts/api-server/dist/index.mjs");
const PANEL = path.join(ROOT, "artifacts/kali-panel/dist/public");
const STATE = path.join(ROOT, "state");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SERVER)) {
  fail("no server bundle. Run: pnpm --filter @workspace/api-server run build");
}
if (!fs.existsSync(path.join(PANEL, "index.html"))) {
  fail("no panel build. Run: BASE_PATH=/ pnpm --filter @workspace/kali-panel run build");
}

fs.rmSync(path.join(ROOT, "dist-standalone"), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* ── 1. copy the pieces ──────────────────────────────────────────────────── */
fs.copyFileSync(SERVER, path.join(OUT, "server.mjs"));
copyDir(PANEL, path.join(OUT, "public"), { maxBytes: 25 * 1024 * 1024 });

// Memory files worth carrying over (nothing else from state/ is needed).
fs.mkdirSync(path.join(OUT, "state"), { recursive: true });
for (const name of ["nova-memory.json", "cybernova-brain-state.json", "discovered-vulnerabilities-vault.json"]) {
  const src = path.join(STATE, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, "state", name));
}

/* ── 2. launch scripts ───────────────────────────────────────────────────── */
fs.writeFileSync(
  path.join(OUT, "start.sh"),
  `#!/bin/sh
# NOVA — start (no install needed)
# PORT is taken from PORT or SERVER_PORT; the panel is served from ./public.
export NODE_ENV=production
export HOST=0.0.0.0
export NOVA_STATIC_DIR="$(cd "$(dirname "$0")" && pwd)/public"
export NOVA_MEMORY_FILE="$(cd "$(dirname "$0")" && pwd)/state/nova-memory.json"
exec node server.mjs
`,
  { mode: 0o755 },
);

fs.writeFileSync(
  path.join(OUT, "start-tunnel.sh"),
  `#!/bin/sh
# NOVA + a free public HTTPS URL (Cloudflare quick tunnel — no account, no card).
# The app itself listens on $PORT/SERVER_PORT; the tunnel prints an
# https://<random>.trycloudflare.com address. The address changes only when
# this process restarts.
cd "$(dirname "$0")" || exit 1
PORT="\${SERVER_PORT:-8080}"
export PORT
sh ./start.sh &
APP=$!
CT="$(dirname "$0")/cloudflared"
if [ ! -x "$CT" ]; then
  URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  [ "$(uname -m)" = "aarch64" ] && URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
  echo "downloading cloudflared…"
  curl -fsSL "$URL" -o "$CT" && chmod +x "$CT" || echo "cloudflared download failed — app still runs locally on port $PORT"
fi
[ -x "$CT" ] && "$CT" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" &
wait $APP
`,
  { mode: 0o755 },
);

fs.writeFileSync(
  path.join(OUT, "package.json"),
  JSON.stringify(
    {
      name: "nova-24-7",
      version: "1.0.0",
      private: true,
      type: "module",
      description: "CyberNova NOVA — portable single-file server, no dependencies",
      main: "server.mjs",
      scripts: { start: "node server.mjs" },
      engines: { node: ">=20" },
    },
    null,
    2,
  ) + "\n",
);

fs.writeFileSync(
  path.join(OUT, "README.txt"),
  `NOVA — النسخة المحمولة (24/7 من غير تثبيت)
==========================================

التشغيل:
    node server.mjs
أو:
    sh start.sh

البورت: من متغيّر PORT أو SERVER_PORT (لوحات الاستضافة المجانية بتستخدم التاني).
الاستماع: 0.0.0.0 — يعني متاح من برّه.

الذاكرة طويلة الأمد في: state/nova-memory.json
نسخة احتياطية: GET /api/nova-core/memory/export

HTTPS من غير حساب ولا كارت:
    sh start-tunnel.sh
هيطبع https://<random>.trycloudflare.com — ده الرابط اللي تحطه في الصفحة
(«نوفا · الأسطول الموحّد» → «وسّع القدرات»).

فحص الحالة:
    افتح /self-check  أو  /api/nova-core/self-check

المتطلبات: Node 20+ فقط. مفيش npm install، مفيش build.
الحجم ~10MB · الذاكرة ~110MB RSS · بيدخل في 256MB.
`,
);

/* ── 3. zip it ───────────────────────────────────────────────────────────── */
const zipPath = path.join(ROOT, "dist-standalone", "nova-24-7.zip");
let zipped = false;
try {
  execFileSync("zip", ["-qr", zipPath, "nova-24-7"], { cwd: path.join(ROOT, "dist-standalone") });
  zipped = true;
} catch {
  // zip is not installed everywhere; the folder itself is still the deliverable.
}

/* ── 4. report ───────────────────────────────────────────────────────────── */
const size = dirSize(OUT);
const files = countFiles(OUT);
console.log(`✓ ${path.relative(ROOT, OUT)} — ${files} files · ${(size / 1024 / 1024).toFixed(1)} MB`);
if (zipped) {
  console.log(`✓ ${path.relative(ROOT, zipPath)} — ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);
}
console.log("  run:  cd dist-standalone/nova-24-7 && node server.mjs");
if (size > 60 * 1024 * 1024) console.warn("⚠ bundle is large — free hosts usually cap disk at 512 MB");

/* ── helpers ─────────────────────────────────────────────────────────────── */
function copyDir(src, dest, opts = {}) {
  const { maxBytes = Infinity } = opts;
  let copied = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += copyDir(s, d, opts);
      continue;
    }
    const st = fs.statSync(s);
    if (copied + st.size > maxBytes) continue; // keep the bundle small on purpose
    fs.copyFileSync(s, d);
    copied += st.size;
  }
  return copied;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return n;
}
