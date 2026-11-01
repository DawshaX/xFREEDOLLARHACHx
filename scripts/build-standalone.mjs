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

// The panel reads the mission log from its own /state/ path, so ship a copy
// inside public/state/ too (the same mirror the Pages deploy uses).
const missionLog = path.join(STATE, "nova-mission-log.json");
if (fs.existsSync(missionLog)) {
  fs.mkdirSync(path.join(OUT, "public", "state"), { recursive: true });
  fs.copyFileSync(missionLog, path.join(OUT, "public", "state", "nova-mission-log.json"));
}

// The agent must travel with the bundle: /api/local-agent/download-nova-agent
// reads it from the process cwd, and without it "connect a computer" answers
// 500 on a packaged install (it only ever worked from the source tree).
const agentSrc = path.join(ROOT, "nova-agent.js");
if (fs.existsSync(agentSrc)) {
  fs.copyFileSync(agentSrc, path.join(OUT, "nova-agent.js"));
}

/* ── 2. boot.mjs — one entry point, two roles ────────────────────────────── */
/**
 * THE point of this file: the same folder is both the hub and a node.
 *
 *   NOVA_ROLE        "hub" | "node"  (default: node when NOVA_SERVER is set)
 *   NOVA_SERVER      hub WebSocket URL, e.g. wss://hub.example.com/api/local-agent/ws
 *   NOVA_AGENT_ID    node name shown in the fleet
 *
 * Panels run `node .` → package.json "main" → this file, so the role is picked
 * from the environment only — no editing, no second zip.
 */
fs.writeFileSync(
  path.join(OUT, "boot.mjs"),
  `#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Panels that let you edit files but not variables: copy node.env.example to
// .env next to this file. Real environment variables always win.
const envFile = join(HERE, ".env");
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, "utf8").split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
  console.log("[nova] loaded " + envFile);
}

// Sensible defaults for any container: reachable from outside, panel served
// from this folder, memory kept next to the code.
process.env.HOST = process.env.HOST || "0.0.0.0";
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.NOVA_STATIC_DIR = process.env.NOVA_STATIC_DIR || join(HERE, "public");
process.env.NOVA_MEMORY_FILE = process.env.NOVA_MEMORY_FILE || join(HERE, "state", "nova-memory.json");

const explicit = String(process.env.NOVA_ROLE || "").trim().toLowerCase();
const role = explicit || (process.env.NOVA_SERVER ? "node" : "hub");

console.log("┌─ NOVA boot ─────────────────────────────────────────────");
console.log("│ role      : " + role + (explicit ? " (NOVA_ROLE)" : " (auto)"));
console.log("│ node      : " + process.version + " · " + process.platform + "/" + process.arch);
if (role === "node" || role === "agent") {
  console.log("│ hub       : " + (process.env.NOVA_SERVER || "(not set — using default)"));
  console.log("│ agent id  : " + (process.env.NOVA_AGENT_ID || "(hostname)"));
  console.log("└─────────────────────────────────────────────────────────");
  // The agent is CommonJS; load it through require so there is no ESM/CJS clash.
  require("./nova-agent.js");
} else {
  console.log("│ port      : " + (process.env.PORT || process.env.SERVER_PORT || "8080"));
  console.log("│ static    : " + process.env.NOVA_STATIC_DIR);
  console.log("└─────────────────────────────────────────────────────────");
  await import("./server.mjs");
}
`,
);

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
exec node boot.mjs
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
      // NOTE: deliberately NOT "type": "module". The entry point is server.mjs
      // (explicit ESM), while nova-agent.js ships alongside it as CommonJS.
      // Declaring the whole folder as ESM made `node nova-agent.js` crash with
      // "require is not defined in ES module scope".
      description: "CyberNova NOVA — portable 24/7 server + fleet node, no dependencies",
      main: "index.js",
      scripts: {
        start: "node index.js",
        hub: "NOVA_ROLE=hub node boot.mjs",
        node: "NOVA_ROLE=node node boot.mjs",
      },
      engines: { node: ">=20" },
    },
    null,
    2,
  ) + "\n",
);

fs.writeFileSync(
  path.join(OUT, "README.txt"),
  `NOVA — النسخة الكاملة المحمولة (هاب + نود في نفس المجلد)
=========================================================

مفيش npm install. مفيش build. Node 20+ بس.

────────────────────────────────────────────────────────────
① تشغيل كـ«هاب» (السيرفر الرئيسي)
────────────────────────────────────────────────────────────
    node .
أو    sh start.sh

- البورت: PORT أو SERVER_PORT (اللي الاستضافة بتحدده)
- الاستماع: 0.0.0.0 — متاح من برّه
- الواجهة: /self-check   ·   الذاكرة: state/nova-memory.json

────────────────────────────────────────────────────────────
①-ب  على بانل Pterodactyl (زي Waifly) — إعدادات الـStartup
────────────────────────────────────────────────────────────
الـegg بيشغّل:  /start.sh → npm install → node <Main file (Node.js)>
فخليك في التبويب Startup → Variables بالشكل ده:

    Runtime                    = node
    Node.js Version            = 22
    Main file (Node.js)        = index.js      ← المهم
    User Uploaded Files        = 1             (تخطّي git clone)
    Additional NPM packages    = (اتركها فاضية)
    Additional Node Arguments  = (اتركها فاضية)

وللنود زوّد المتغيرين دول في نفس الصفحة:

    NOVA_ROLE   = node
    NOVA_SERVER = wss://<عنوان-الهاب>/api/local-agent/ws
    NOVA_AGENT_ID = waifly-2

الـegg بيقبل متغيرات إضافية من نفس الصفحة، ولو مش لاقي مكان تضيفها
اكتبهم في ملف .env (شوف node.env.example) — boot.mjs بيقرأ البيئة فقط.

⚠️ ما تغيّرش الـegg لـ«Web Hosting (PHP)» — PHP مش بيشغّل Node،
   والبرنامج بتاعك JavaScript بالكامل. سيبها NodeJS + Python + FFmpeg.

────────────────────────────────────────────────────────────
② تشغيل كـ«نود» (سيرفر تاني ينضم للأسطول)
────────────────────────────────────────────────────────────
حط المتغيرين دول في إعدادات السيرفر (أو في ملف .env — شوف node.env.example):

    NOVA_ROLE=node
    NOVA_SERVER=wss://<عنوان-الهاب>/api/local-agent/ws
    NOVA_AGENT_ID=waifly-2        # اسم اختياري

وبعدها نفس الأمر:   node .

⚠️ مهم: من داخل شبكة استضافة لنفس الاستضافة، البورت المخصص غالباً مقفول
   (NAT hairpin) → استخدم wss:// على الدومين، مش ws:// على node.host:port

لو مش عارف المشكلة:   node diagnose.mjs
   بيطبّع ٣ نتائج: health / tcp / upgrade + تفسير كل واحد.

────────────────────────────────────────────────────────────
③ HTTPS مجاني بدون حساب (لو الاستضافة مش بتدي شهادة)
────────────────────────────────────────────────────────────
    sh start-tunnel.sh
- بيطبّع https://<random>.trycloudflare.com — خده وحطه في صفحة الأسطول
- ما بيحتاجش تسجيل ولا كارت

────────────────────────────────────────────────────────────
③-ب  زيادة الذكاء: المجلس (أكتر من نموذج)
────────────────────────────────────────────────────────────
حط مفتاح مجاني واحد أو أكتر في البيئة (مفيش كارت فيهم كلهم):

    GROQ_API_KEY=...          console.groq.com        (الأسرع)
    GEMINI_API_KEY=...        aistudio.google.com
    CEREBRAS_API_KEY=...      cloud.cerebras.ai
    OPENROUTER_API_KEY=...    openrouter.ai/keys      (نماذج :free)
    GITHUB_MODELS_TOKEN=...   github.com/settings/tokens

مفتاح واحد  = صوت واحد
مفتاحين    = تصويت + حكم متبادل
تلاتة      = مجلس كامل

وبعدها:
    GET  /api/nova-core/council     مين في المجلس
    POST /api/nova-core/council     اسأل الكل مرة واحدة (أدق)
    POST /api/nova-core/fast        أول رد (أسرع)
    POST /api/nova-core/chat {"council":true}

────────────────────────────────────────────────────────────
④ منافذ إضافية (لو البروكسي بيوجّه لبورت تاني)
────────────────────────────────────────────────────────────
    NOVA_EXTRA_PORTS=3000,8080,80 node .

────────────────────────────────────────────────────────────
⑤ الملفات
────────────────────────────────────────────────────────────
    index.js          الدخول على البانل: حطه في "Main file (Node.js)"
    boot.mjs          الدخول الأصلي (يختار الدور تلقائياً)
    server.mjs        السيرفر كامل في ملف واحد
    nova-agent.js     وكيل النود (بيتنفّذ أوامر الهاب)
    public/           الواجهة جاهزة
    state/            الذاكرة وملفات الحالة
    diagnose.mjs      تشخيص اتصال النود
    node.env.example  نموذج إعدادات النود
    start.sh          تشغيل الهاب
    start-node.sh     تشغيل النود
    start-tunnel.sh   هاب + HTTPS مجاني
`,
);

// index.js — the file Pterodactyl-style eggs run ("Main file (Node.js)").
// Pterodactyl eggs execute \`node <MainFile>\`, they never run \`node .\`, and the
// field only accepts .js/.ts — so the .mjs entry needs a CommonJS door.
// CommonJS can dynamic-import ESM, so this is a three-line shim and there is
// still exactly one place (boot.mjs) that decides what the process becomes.
fs.writeFileSync(
  path.join(OUT, "index.js"),
  `#!/usr/bin/env node
/**
 * NOVA — universal entry point.
 *
 *   node index.js            → picks the role from the environment
 *   NOVA_SERVER=wss://…      → fleet node
 *   (nothing set)            → hub
 *
 * Works on panels that run a fixed start command such as
 *   /start.sh  →  npm install  →  node <Main file (Node.js)>
 * Set "Main file (Node.js)" to:  index.js
 */
console.log("[nova] entry index.js · " + process.version + " · " + process.platform + "/" + process.arch);

import("./boot.mjs").catch((err) => {
  console.error("[nova] boot failed:", err && (err.stack || err.message || err));
  process.exit(1);
});
`,
  { mode: 0o755 },
);

/* ── 2b. node helpers ────────────────────────────────────────────────────── */

// A ready-to-edit env file: panels that support ".env"/environment files can
// drop this in, everyone else sets the same two variables in the UI.
fs.writeFileSync(
  path.join(OUT, "node.env.example"),
  `# ── اجعل هذا المجلد "نود" في الأسطول ──────────────────────────────────────
# انسخ الملف ده لاسم  .env  (أو حط نفس المتغيرين في إعدادات السيرفر)
NOVA_ROLE=node
NOVA_AGENT_ID=waifly-2
# عنوان الهاب (البروكسي بـHTTPS ينفع، والبورت المخصص غالباً ممنوع من داخل نفس الشبكة)
NOVA_SERVER=wss://xdaw.waifly.com/api/local-agent/ws

# اجعل هذا المجلد "هاب" بدل النود: احذف السطور فوق أو خليها
# NOVA_ROLE=hub
`,
);

// One-shot self-test for a node: tells you why it cannot reach the hub.
fs.writeFileSync(
  path.join(OUT, "diagnose.mjs"),
  `#!/usr/bin/env node
/**
 * NOVA — "ليه النود مش بيتصل؟" تشخيص سريع.
 *   node diagnose.mjs                      # يختبر NOVA_SERVER من البيئة
 *   node diagnose.mjs wss://host/api/local-agent/ws
 */
import net from "node:net";
import tls from "node:tls";

const target = process.argv[2] || process.env.NOVA_SERVER || "ws://127.0.0.1:8080/api/local-agent/ws";
const m = /^(wss?):\\/\\/([^/]+)(\\/.*)?$/i.exec(target);
if (!m) {
  console.error("✗ عنوان غير صالح:", target);
  process.exit(2);
}
const [, scheme, hostPort, pathPart = "/api/local-agent/ws"] = m;
const secure = scheme.toLowerCase() === "wss";
const [host, portRaw] = hostPort.split(":");
const port = Number(portRaw || (secure ? 443 : 80));
const httpBase = \`\${secure ? "https" : "http"}://\${hostPort}\`;

console.log("target:", target);
console.log("host  :", host, "port:", port, secure ? "(tls)" : "(plain)");

// 1) HTTP reachability of the same origin
try {
  const r = await fetch(\`\${httpBase}/api/health\`, { signal: AbortSignal.timeout(8000) });
  console.log("① health:", r.status, (await r.text()).slice(0, 80));
} catch (e) {
  console.log("① health: فشل —", e.cause?.code || e.message);
}

// 2) raw TCP reachability
await new Promise((resolve) => {
  const s = net.connect({ host, port });
  s.setTimeout(8000, () => { console.log("② tcp   : timeout"); s.destroy(); resolve(); });
  s.once("connect", () => { console.log("② tcp   : مفتوح ✓"); s.destroy(); resolve(); });
  s.once("error", (e) => { console.log("② tcp   : فشل —", e.code); resolve(); });
});

// 3) the actual WebSocket upgrade, with the real status line
await new Promise((resolve) => {
  const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  const send = () =>
    socket.write(
      \`GET \${pathPart} HTTP/1.1\\r\\nHost: \${hostPort}\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\` +
        "Sec-WebSocket-Key: MTIzNDU2Nzg5MGFiY2RlZg==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n",
    );
  if (secure) socket.once("secureConnect", send); else socket.once("connect", send);
  socket.setTimeout(9000, () => { console.log("③ upgrade: timeout"); socket.destroy(); resolve(); });
  socket.on("data", (d) => {
    console.log("③ upgrade:", d.toString("latin1").split("\\r\\n")[0]);
    socket.destroy();
    resolve();
  });
  socket.on("error", (e) => { console.log("③ upgrade: فشل —", e.code || e.message); resolve(); });
});

console.log("");
console.log("تفسير السطر ③:");
console.log("  101 Switching Protocols → كل حاجة تمام، النود هيتصل");
console.log("  502 / 504              → البروكسي مش واصل للتطبيق (جرّب ربط السب-دومين من جديد)");
console.log("  404                    → المسار غلط (لازم ينتهي بـ /api/local-agent/ws)");
console.log("  400                    → مفتاح الـhandshake غلط (باج في التشخيص نفسه، بلّغ)")
console.log("  ECONNRESET / timeout   → البورت مقفول من الشبكة اللي انت فيها (استخدم wss:// على دومين)");
`,
  { mode: 0o755 },
);

// Startup helper for panels that run a shell command instead of node .
fs.writeFileSync(
  path.join(OUT, "start-node.sh"),
  `#!/bin/sh
# شغّل هذا المجلد كـ"نود" ينضم للأسطول (بدون تعديل أي ملف).
: "\${NOVA_SERVER:?حط عنوان الهاب: NOVA_SERVER=wss://hub.example.com/api/local-agent/ws}"
export NOVA_ROLE=node
export NOVA_AGENT_ID="\${NOVA_AGENT_ID:-$(hostname)}"
exec node boot.mjs
`,
  { mode: 0o755 },
);

/* ── 2c. build stamp ─────────────────────────────────────────────────────── */
/**
 * Why a stamp: after every deploy we could not answer "which build is actually
 * running on that server?" without guessing from behaviour. /api/nova-core/version
 * now reads this file, so the answer is one URL away.
 */
function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return process.env.GITHUB_SHA || "unknown";
  }
}

const fileCount = (() => {
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else n++;
    }
  };
  walk(OUT);
  return n;
})();

fs.writeFileSync(
  path.join(OUT, "build.json"),
  JSON.stringify(
    {
      name: "nova-24-7",
      version: "2099.1",
      commit: gitCommit(),
      builtAt: new Date().toISOString(),
      files: fileCount,
      builtBy: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
    },
    null,
    2,
  ) + "\n",
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
