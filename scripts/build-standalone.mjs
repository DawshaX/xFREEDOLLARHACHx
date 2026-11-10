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
 *   state/          memory + brain state + measured data (hunt-latest, advisory-cache, …)
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

const START_SH = `#!/bin/sh
# NOVA — start (no install needed)
# PORT is taken from PORT or SERVER_PORT; the panel is served from ./public.
#
# The cd is load-bearing. A panel egg runs its startup command from /home/container
# (or whatever its workdir is), not from inside the bundle, so "sh app/start.sh"
# used to die with "Cannot find module '/home/container/boot.mjs'" while the files
# sat right there. Measured 2026-11-05 from /tmp before this line existed.
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE" || exit 1
export NODE_ENV=production
export HOST=0.0.0.0
export NOVA_STATIC_DIR="$HERE/public"
[ -z "$NOVA_TOOLCHAIN_FETCH" ] && export NOVA_TOOLCHAIN_FETCH=1
[ -z "$NOVA_PROVISION_TOOLS" ] && export NOVA_PROVISION_TOOLS=1
[ -z "$NOVA_AUTO_UPDATE_MINUTES" ] && export NOVA_AUTO_UPDATE_MINUTES=5
export NOVA_MEMORY_FILE="$HERE/state/nova-memory.json"
export NOVA_JOBS_REL="$HERE/state/jobs"
export NOVA_PROGRAMS_FILE="$HERE/state/programs.json"
mkdir -p "$HERE/state/jobs"
# ── الحلقة دي هي موضوع الملف ده كله ──────────────────────────────────────────
# boot.mjs بيراقب التطبيق، بس مافيش حاجة بتراقب boot.mjs نفسه. على بيضة
# Pterodactyl (Waifly) العملية اللي بتخلص هنا هي العملية الرئيسية للحاوية كلها،
# فموتها معناه السلوت بيتعلّم «offline» ومافيش حاجة بترجّعه: قِيس 2026-11-07 —
# 502 من 20:41Z لأكتر من تلات ساعات، وكل الإصلاحات اللي في العالم ما كانتش
# هتوصل غير بزرّار من صاحب الحساب. الحلقة دي بتحوّل «موت مؤقت» لقيام تلقائي.
#
# الزرّار الحقيقي بيفضل شغال: SIGTERM/INT من اللوحة بيتحوّل لـ stop نظيف بلا
# respawn، ولو التطبيق نفسه عايز ينام (state/NOVA_HALT) الحلقة بتسلم وتخرج.
NOVA_PID=""
NOVA_STOP=0
NOVA_TRIES=0
NOVA_CODE=0
trap 'NOVA_STOP=1; if [ -n "$NOVA_PID" ]; then kill -TERM "$NOVA_PID" 2>/dev/null; fi' TERM INT

# NOVA_RESPAWN_MIN/HEALTHY للتستات والاضطرار؛ الافتراضي محسوب على مكنة 300MB.
# (بنكتب $VAR بلا أقواس: أي dollar-brace جوه template literal بتاع JS بتتفسّر interp.)
NOVA_MIN_SLEEP="$NOVA_RESPAWN_MIN"
[ -z "$NOVA_MIN_SLEEP" ] && NOVA_MIN_SLEEP=2
NOVA_HEALTHY="$NOVA_RESPAWN_HEALTHY"
[ -z "$NOVA_HEALTHY" ] && NOVA_HEALTHY=300
NOVA_FAST="$NOVA_RESPAWN_FASTCRASH"
[ -z "$NOVA_FAST" ] && NOVA_FAST=60

while : ; do
  if [ -f "$HERE/state/NOVA_HALT" ]; then
    echo "[start] state/NOVA_HALT موجود — بنسلّم ومافيش إعادة تشغيل"
    exit 0
  fi
  NOVA_T0=$(date +%s)
  node boot.mjs &
  NOVA_PID=$!
  wait "$NOVA_PID"
  NOVA_CODE=$?
  NOVA_PID=""
  if [ "$NOVA_STOP" = 1 ]; then
    echo "[start] اتقفلت بأمر من اللوحة (SIGTERM) — مافيش إعادة تشغيل"
    exit 0
  fi
  NOVA_UP=$(( $(date +%s) - NOVA_T0 ))
  if [ "$NOVA_UP" -ge "$NOVA_HEALTHY" ]; then NOVA_TRIES=0; fi
  NOVA_TRIES=$((NOVA_TRIES + 1))
  NOVA_SLEEP=$NOVA_MIN_SLEEP
  if [ "$NOVA_TRIES" -ge 2 ]; then NOVA_SLEEP=4; fi
  if [ "$NOVA_TRIES" -ge 3 ]; then NOVA_SLEEP=8; fi
  if [ "$NOVA_TRIES" -ge 4 ]; then NOVA_SLEEP=16; fi
  if [ "$NOVA_TRIES" -ge 5 ]; then NOVA_SLEEP=30; fi
  if [ "$NOVA_TRIES" -ge 7 ]; then NOVA_SLEEP=60; fi
  if [ "$NOVA_UP" -lt 10 ] && [ "$NOVA_SLEEP" -lt "$NOVA_FAST" ]; then
    # أقل من 10 ثانية = الملفات نفسها مكسورة؛ الدوّر على طول بيحرق القرص والنت.
    NOVA_SLEEP="$NOVA_FAST"
  fi
  echo "[start] boot.mjs خرج بكود $NOVA_CODE بعد $NOVA_UP ثانية — إعادة تشغيل في $NOVA_SLEEP ثانية (محاولة $NOVA_TRIES)"
  sleep "$NOVA_SLEEP"
done

exit $NOVA_CODE
`;


/**
 * `node scripts/build-standalone.mjs --selftest-respawn`
 *
 * الحلقة اللي فوق مش تعليق — بننفّذها فعلاً على boot.mjs وهمي بيموت على طول،
 * وبنقيس إن قام تاني. من غير القطعة دي أي حد يقدر يكسر الـwhile loop بسطر واحد
 * والحزمة تمشي لل الإنتاج وهي بتقول «شغّال مرة واحدة وبس».
 */
if (process.argv.includes("--selftest-respawn")) {
  const os = await import("node:os");
  const cp = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-respawn-"));
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  fs.writeFileSync(path.join(dir, "start.sh"), START_SH, { mode: 0o755 });
  fs.writeFileSync(
    path.join(dir, "boot.mjs"),
    'import { appendFileSync, readFileSync, existsSync } from "node:fs";\n' +
      'const f = process.cwd() + "/state/kicks";\n' +
      'appendFileSync(f, "kick\\n");\n' +
      "console.log(\"[stub] alive \" + (existsSync(f) ? readFileSync(f, \"utf8\").trim().split(\"\\n\").length : 0));\n" +
      "process.exit(1);\n",
  );
  const p = cp.spawnSync("sh", ["start.sh"], {
    cwd: dir,
    encoding: "utf8",
    // بنوقف الحلقة بعد 6 ثواني — الكفاية إننا شفنا ثلاث قامات؛ من غير كده الحلقة
    // بتلف مئات المرات والـselftest بيستنى الـtimeout كله.
    timeout: 6_000,
    env: { ...process.env, NOVA_RESPAWN_MIN: "0", NOVA_RESPAWN_FASTCRASH: "0", NOVA_RESPAWN_HEALTHY: "300", PORT: "0" },
  });
  const log = (p.stdout || "") + (p.stderr || "");
  let kicks = 0;
  try {
    kicks = fs.readFileSync(path.join(dir, "state/kicks"), "utf8").trim().split("\n").length;
  } catch {
    /* مافيش ولا محاولة */
  }
    const respawned = log.includes("boot.mjs خرج بكود 1");
  if (kicks < 3 || !respawned) {
    console.error("\u2717 selftest-respawn: tries=" + kicks + " respawn-line=" + respawned + "\n" + log.slice(0, 400));
    process.exit(1);
  }
  console.log("\u2713 selftest-respawn: boot.mjs الميت قام " + kicks + " مرات لوحده والـlog بيقول السبب");
  process.exit(0);
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
fs.copyFileSync(SERVER, path.join(OUT, "nova-app.mjs"));
copyDir(PANEL, path.join(OUT, "public"), { maxBytes: 25 * 1024 * 1024 });

// البراهين اللي الخزنة الدائمة بتشير ليها (`evidencePath: audit/...`) — من غيرها
// المكنة الحيّة بتقرا «11 ثغرة» بس ما تلقاش ملف proofs: القياس على
// nova.waifly.com رجّع «2 سجل برهانه مسجّل ومش موجود على القرص» والحقيقة إن الحزمة
// ما كانتش بتشمل audit/ خالص (204 كيلوبايت، 21 ملف). بوابة الأسرار بتفحص المجلد
// ده زي أي ملف تاني، فمفيش حاجة حرفية هتعدي.
const AUDIT = path.join(ROOT, "audit");
if (fs.existsSync(AUDIT)) copyDir(AUDIT, path.join(OUT, "audit"), { maxBytes: 8 * 1024 * 1024 });

// الحالة + البيانات المقاسة اللي السورس والباندل بيقراوها وقت التشغيل.
// التعليق القديم كان بيقول «nothing else from state/ is needed» — وده كان غلط
// مقاس: على nova.waifly.com ملاحظة `hunt` ما بتظهرش خالص في /api/nova-core/watch/probe
// و`advisories` بتردّ measured:false، رغم إن المستودع فيه state/hunt-latest.json
// (19 موضع قراءة في السورس) وstate/advisory-cache.json (12 موضع). يعني الميزة كانت
// «مش موجودة» على الحزمة المنشورة والكود نازل. القاعدة من دلوقتي: أي ملف state/
// متتبَّع وعليه قارئ وقت التشغيل لازم يكون في القائمة دي، و
// scripts/audit-route-integrity.mjs (hollow-state) بيمنع أي استثناء ساكت.
const STATE_DATA = [
  // حالة المحرك نفسها — تتكتب على المكنة، وبننقلها لو موجودة عشان الذاكرة تفضل
  "nova-memory.json",
  "cybernova-brain-state.json",
  "discovered-vulnerabilities-vault.json",
  // بيانات مقاسة بتجي من CI ومن فحوص حيّة — محركات البحث والملاحظات بيقروها
  "hunt-latest.json",
  "advisory-cache.json",
  "verified-live.json",
  "vuln-corpus-index.json",
  "corpus-last-failure.json",
  "nova-brain-latest.json",
  "nova-mission-log.json",
  "free-hosts.json",
  "cryptocom-hackerone-scope.json",
];
/** أكبر ملف يُنقل تلقائيًا — اللي فوق ده قرار صريح، مش سرقة مساحة على حاوية 512 MB. */
const STATE_DATA_MAX_KB = 512;
fs.mkdirSync(path.join(OUT, "state"), { recursive: true });
let stateCopied = 0;
let stateKb = 0;
for (const name of STATE_DATA) {
  const src = path.join(STATE, name);
  if (!fs.existsSync(src)) continue;
  const kb = Math.round(fs.statSync(src).size / 1024);
  if (kb > STATE_DATA_MAX_KB) {
    console.log(`· state/${name}: ${kb}K أكبر من حد ${STATE_DATA_MAX_KB}K — اتساب بره الحزمة بقرار`);
    continue;
  }
  fs.copyFileSync(src, path.join(OUT, "state", name));
  stateCopied += 1;
  stateKb += kb;
}
// updater بيحمي `state/` عشان ذاكرة المكنة وملفاتها اللي بتتكتب حيًا — وده غلط
// مع البيانات اللي CI بينشرها (صيد، استشارات، فحوص حيّة): المكنة مابتكتبهاش،
// فلو ما سافرتش مع كل تحديث هتفضل «مش موجودة» للأبد. القائمة دي بتتولّد من
// STATE_DATA نفسه (مش قائمة تانية تتنسى)، و`deploy/live-update.py` بيقراها من
// update-manifest.json وبيقاعدة «الأحدث يكسب».
const STATE_MACHINE_OWNED = new Set([
  "nova-memory.json", // ذاكرة المكنة نفسها
  "cybernova-brain-state.json", // «وقفنا فين» — scripts/autonomous-brain-pulse.mjs بيحدّثه على المكنة
  "discovered-vulnerabilities-vault.json", // الخزنة: agent بيعدّلها على الحيّة
  "nova-mission-log.json", // اللوج بيتكتب على المكنة (وفي public/state للنسخة العامة)
  "corpus-last-failure.json", // سجل فشل الكوربوس المحلي
]);
const REFRESH_STATE = STATE_DATA.filter((name) => !STATE_MACHINE_OWNED.has(name));
fs.writeFileSync(
  path.join(OUT, "update-manifest.json"),
  `${JSON.stringify(
    {
      about: "ملفات state اللي CI بينشرها وبتتنقل فوق مكنة شغّالة. بتتولّد من STATE_DATA في scripts/build-standalone.mjs — مش قائمة تانية.",
      refreshState: REFRESH_STATE,
      neverOverwrite: [...STATE_MACHINE_OWNED],
    },
    null,
    2,
  )}\n`,
);
console.log(`· state/: ${stateCopied} ملف (${stateKb}K) جوّه الحزمة · ${REFRESH_STATE.length} منها بيتحدّث على المكنة الشغّالة`);

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

// نفس الداء، مريضين تانيين: كتالوج برامج المكافآت وسكريبت تنزيل الأدوات
// بيتقروا/يتنفذوا من cwd وقت **التشغيل**، مش وقت البناء. مقاس على السلوت الحيّ
// (nova.waifly.com، 2026-11-05T17:20Z): `GET /api/ops/hunt/candidates` ردّت
// `{"present":false,"path":"ops/bounty/programs-catalog.json","scanned":0}` —
// الكود نازل من غير بياناته، فالميزة ظهرت «مش موجودة» عند المستخدم. ومجلد
// `ops/` كله 804 KB (الكتالوج 780 KB + أهداف التحقق 3.8 KB): رخيص مقابل 300 MB.
// `scripts/fetch-toolchain.mjs` بقى داخل الحزمة عشان المحرك يقدر يجهّز إيده
// بنفسه على الحاوية (`POST /api/ops/tools/provision`) من غير root ومن غير git.
for (const rel of ["ops", path.join("scripts", "fetch-toolchain.mjs")]) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.error(`✗ الحزمة محتاجة ${rel} وقت التشغيل وهو مش في الشجرة — الباندر ما بيكملش.`);
    process.exit(1);
  }
  const dest = path.join(OUT, rel);
  if (fs.statSync(src).isDirectory()) copyDir(src, dest);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
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

/**
 * Read .env into an object. Called again for every child launch, so editing
 * .env from the panel file manager and asking for a restart is enough — the
 * container itself never has to be restarted. (Real environment variables set
 * by the host still win; this only fills the gaps.)
 */
const readEnvFile = () => {
  const out = {};
  try {
    for (const raw of readFileSync(envFile, "utf8").split(/\\r?\\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env — nothing to merge */
  }
  return out;
};

/**
 * Keys that came from .env (as opposed to the host's own environment).
 * On reload those are refreshed: editing an existing key in .env must take
 * effect, otherwise "paste a new API key and restart" would silently keep the
 * old value. Host-provided variables (PORT, SERVER_PORT, …) are never
 * overridden.
 */
const ENV_FROM_FILE = new Set();

const loadEnvFile = () => {
  const parsed = readEnvFile();
  let n = 0;
  for (const [k, v] of Object.entries(parsed)) {
    const owned = ENV_FROM_FILE.has(k);
    if (!owned && k in process.env) continue; // the host wins for its own vars
    if (process.env[k] === v) continue;
    process.env[k] = v;
    ENV_FROM_FILE.add(k);
    n += 1;
  }
  return n;
};

{
  const n = loadEnvFile();
  if (existsSync(envFile)) console.log("[nova] loaded " + envFile + (n ? " (" + n + " vars)" : ""));
}

// Sensible defaults for any container: reachable from outside, panel served
// from this folder, memory kept next to the code.
process.env.HOST = process.env.HOST || "0.0.0.0";
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.NOVA_STATIC_DIR = process.env.NOVA_STATIC_DIR || join(HERE, "public");
process.env.NOVA_MEMORY_FILE = process.env.NOVA_MEMORY_FILE || join(HERE, "state", "nova-memory.json");
// الحزمة المحمولة = مكنة واحدة، بلا مدير، والمستخدم قال «يعرف يحمّل أدوات وكل حاجة».
// قبل كده كان لازم أحد يكتب NOVA_TOOLCHAIN_FETCH=1 بنفسه، فالمكنة الحيّة فضلت
// vendor/bin فيها فاضي رغم إن القرص قابل للكتابة (اتقاس). الافتراضي بقى: التنزيل
// مسموح، وNOVA_TOOLCHAIN_FETCH=0 يرجّع القفل.
process.env.NOVA_TOOLCHAIN_FETCH = process.env.NOVA_TOOLCHAIN_FETCH || "1";
process.env.NOVA_PROVISION_TOOLS = process.env.NOVA_PROVISION_TOOLS || "1";

// الفحص كل 15 دقيقة خلّى المكنة تردّ ببناء قِدْم بدقايق بعد الدمج (مقاس: PR #216
// اتدمج 00:12:49Z وسؤال المستخدم 00:14:17Z لسه طالع من البناء اللي قبله). 5 دقايق
// = 12 فحص/ساعة لـ api.github.com — جوه سقف الـ60/ساعة غير المصادق، ومعاه fallback
// الـHEAD على الأصل لو الـAPI رفض. NOVA_AUTO_UPDATE_MINUTES=15 يرجّع القديم.
// (ملاحظة للبنّاء: السطر ده جوه template literal — مفيش backticks هنا عمدًا.)
process.env.NOVA_AUTO_UPDATE_MINUTES = process.env.NOVA_AUTO_UPDATE_MINUTES || "5";

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

  // ── supervisor ──────────────────────────────────────────────────────────
  // The real server (nova-app.mjs) runs as a CHILD of this process. Two wins:
  //   1. a deploy can replace nova-app.mjs and ask for a restart by touching
  //      state/.nova-restart — no panel button, no manual step;
  //   2. if the app ever crashes the container stay up and the app comes back.
  const { spawn } = await import("node:child_process");
  const { statSync, statfsSync, readFileSync, readdirSync, copyFileSync, mkdirSync, unlinkSync, writeFileSync, renameSync, existsSync } = await import("node:fs");
  const { get: httpGet } = await import("node:http");
  const MARK = join(HERE, "state", ".nova-restart");
  const ENTRY = join(HERE, "nova-app.mjs");

  const stamp = () => {
    try { return statSync(MARK).mtimeMs; } catch { return 0; }
  };

  let child = null;
  let leaving = false;
  let mark = stamp();
  let vendorRunning = false;   // تنزيل الأدوات شغال؟ (ممنوع يتداخل مع إقلاع التطبيق)
  let fastDeaths = 0;          // موتات متتالية < 10s → crash-loop مثبت
  let bootDelays = 0;          // تأجيلات RAM متتالية — بعد 5 بنقلع على أي حال

  const cgroupMb = () => {
    // قياس حقيقي للحاوية (v2 ثم v1) — و«الحقيقي» معناه: نستبعد page cache.
    // القياس اللي علّمنا ده (2026-11-10): memory.current كان 420/460MB والإقلاع اتأجل
    // للأبد — بس الرقم ده بيعدّي inactive_file (كاش ملفات الأدوات 628MB اللي النظام
    // بيرميه فورًا تحت أي ضغط حقيقي). الضغط الصادق = anon memory مش المجموع الخام.
    // التفصيلة: v2 في memory.stat حقل «inactive_file»؛ v1 في memory.stat حقل
    // «total_inactive_file». لو مقدرناش نستبعده بنرجع للمجموع (أحسن من العمى).
    try {
      for (const [cur, max, stat, field] of [
        ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.stat", "inactive_file"],
        ["/sys/fs/cgroup/memory/memory.usage_in_bytes", "/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.stat", "total_inactive_file"],
      ]) {
        if (existsSync(cur) && existsSync(max)) {
          const c = Number(readFileSync(cur, "utf8")), m = Number(readFileSync(max, "utf8"));
          if (!(isFinite(c) && isFinite(m) && m > 0 && m < 9007199254740991)) continue;
          let cache = 0;
          try {
            const st = readFileSync(stat, "utf8");
            const hit = st.match(new RegExp("^" + field + " (\\d+)$", "m"));
            if (hit) cache = Number(hit[1]);
          } catch { /* stat مش مقروء — نكمل بالمجموع */ }
          const anon = Math.max(0, c - cache);
          return { usedMb: Math.round(anon / 1048576), rawMb: Math.round(c / 1048576), cacheMb: Math.round(cache / 1048576), maxMb: Math.round(m / 1048576) };
        }
      }
    } catch { /* بلا cgroup ظاهر — بنقول ماقسنا */ }
    return null;
  };

  const launch = () => {
    if (vendorRunning) { setTimeout(launch, 5000); return; } // التنزيل أولاً: مش هنضرب نفسنا
    // Re-read .env first: a key added in the panel takes effect on reload.
    const fresh = loadEnvFile();
    if (fresh) console.log("[supervisor] picked up " + fresh + " new env var(s) from .env");
    const mem = cgroupMb();
    if (mem && mem.usedMb > mem.maxMb * 0.88) {
      bootDelays += 1;
      // fail-open: القياس الكذاب (page cache محسوس كضغط) علّمنا إن التأجيل الأبدي
      // أسوأ من OOM محتمل — 502 دائمة أقسى على صاحب المنصة من إعادة تحت ضغط.
      // بعد 5 × 20s = 100s من «فوق 88%» بنقلع على أي حال: الـheap سقفه 200MB
      // والـOOM-killer لو تدخل هيبقى على قرار صادق مش على كاش.
      if (bootDelays >= 5) {
        console.log("[supervisor] RAM عالية بثبات (" + mem.usedMb + "/" + mem.maxMb + "MB anon · كاش " + mem.cacheMb + "MB خام " + mem.rawMb + "MB) — تأجل 100s. بنقلع على أي حال: 502 الأبدية أسوأ من ضغط مؤقت.");
        bootDelays = 0;
      } else {
        console.log("[supervisor] RAM " + mem.usedMb + "/" + mem.maxMb + "MB anon فوق 88% (خام " + mem.rawMb + " · كاش " + mem.cacheMb + "MB) — إقلاع مأجل 20s (" + bootDelays + "/5 قبل الإقلاع القسري)");
        setTimeout(launch, 20_000);
        return;
      }
    }
    const heap = process.env.NOVA_APP_HEAP_MB || "200"; // سقف V8 < سقف الـcgroup فالـGC يسبق الـSIGKILL
    const inherited = process.env.NODE_OPTIONS || "";
    const appNodeOptions = /max-old-space-size/.test(inherited) ? inherited : (inherited + " --max-old-space-size=" + heap).trim();
    bootDelays = 0;
    child = spawn(process.execPath, [ENTRY], {
      stdio: "inherit",
      env: Object.assign({}, process.env, { NOVA_SUPERVISED: "1", NODE_OPTIONS: appNodeOptions }),
    });
    const started = Date.now();
    child.on("exit", (code, signal) => {
      child = null;
      if (leaving) { process.exit(0); return; }
      const lived = Date.now() - started;
      if (lived < 10_000) {
        fastDeaths += 1;
        // backoff متصاعد: 3s → 6 → 12 → … → سقف 120s — الدوّار يهدى بدل ما يفرم الموارد
        const wait = Math.min(120_000, 3000 * Math.pow(2, Math.min(fastDeaths - 1, 5)));
        const m = cgroupMb();
        console.log("[supervisor] app exited (" + (signal || code) + ") after " + Math.round(lived / 1000) + "s — موت سريع رقم " + fastDeaths
          + (m ? " ، RAM الآن " + m.usedMb + "/" + m.maxMb + "MB" : "") + " — إعادة بعد " + Math.round(wait / 1000) + "s");
        if (fastDeaths === 8) {
          console.log("[supervisor] ⚠ crash-loop مثبت (8 موتات متتالية سريعة). الكود بيحني الضغط، بس لو وصلت هنا: امسح state/ أو سجّل تذكرة للمضيف — المُشرف هيكمّل بمحاولات متباعدة.");
        }
        setTimeout(launch, wait);
      } else {
        if (fastDeaths > 0) fastDeaths = 0;
        console.log("[supervisor] app exited (" + (signal || code) + ") after " + Math.round(lived / 1000) + "s — restarting");
        setTimeout(launch, 300);
      }
    });
    child.on("error", (err) => {
      console.log("[supervisor] could not start the app: " + err.message);
      setTimeout(launch, 5000);
    });
  };

  launch();

  /* ── الأيادي: المُشرف هو اللي بينزّل الأدوات، مش التطبيق ────────────────────
   * القياس اللي علّمنا ده مرتين في نفس الساعة (2026-11-07): التنزيل متحطّ في هوك
   * إقلاع التطبيق → الحاوية دخلت حلقة موت (nginx بيردّ 502 على كل حاجة، و
   * المُحدِّث جوه التطبيق فمافيش مخرج ذاتي)، لأن التطبيق رافع ~115–167MB RSS
   * والمرآة 219MB في حاوية سقفها 256MB. في المُشرف الابن بياخد 64MB والثانية
   * التانية التطبيق بيخدم — والأداة اللي محتاجها المحرك تبقى موجودة قبل الإقلاع
   * الجاي. مفيش تعطيل لأول طلب، ومفيش إعادة تشغيل.
   */
  // المحاولة الأولى بتحصل قبل ما أرشيف المرآة يخلص نشر أحيانًا (قِيس على
  // المكنة الحيّة 2026-11-08 01:01:54Z: «المرآة ما وصلتش: HTTP 404» — والثانية
  // 01:01:53Z كانت النشر نفسه). فالمكان ده بيعيد الناقص 3 مرات ب_backoff، وده
  // بيخلّي «5 أدوات من 16» حالة مؤقتة مش قدر.
  let toolchainTries = 0;
  const toolchainPass = () => {
    if (process.env.NOVA_TOOLCHAIN_AT_BOOT === "0") return;
    // التنزيل وقت الإقلاع بقى بموافقة صريحة (NOVA_TOOLCHAIN_AT_BOOT=1) — مابقناش
    // نعتمد على «المسار startsWith /home/container». والسبب مقيس على المكنة نفسها:
    // 01:01:54Z (404 لكل الـ16) و01:52:20Z — بعدها المكنة وقعت تاني و/api/health
    // رجّع 502 من 02:0xZ. الأب (التطبيق، 213MB وقت الإقلاع) والابن (المنزّل + tar
    // على أرشيف 296MB) في نفس سقف الـcgroup (460MB)، والقرص سلوت 1024MB مايلحقش
    // 296MB أرشيف + ~500MB أدوات. فالتنزيل يبقى بطلب POST /api/ops/tools/provision
    // والمكان فاضي (RSS وقت الهدوء متقاس: 92MB).
    if (process.env.NOVA_TOOLCHAIN_AT_BOOT !== "1") {
      console.log("[supervisor] التنزيل وقت الإقلاع متقفل افتراضيًا — NOVA_TOOLCHAIN_AT_BOOT=1 يفتحه، أو POST /api/ops/tools/provision");
      return;
    }
    const script = join(HERE, "scripts", "fetch-toolchain.mjs");
    if (!existsSync(script)) {
      console.log("[supervisor] مفيش scripts/fetch-toolchain.mjs في الحزمة — اتخطّيت");
      return;
    }
    const recordFile = join(HERE, "state", "toolchain-provision.json");
    const writeRecord = (rec) => {
      // نفس شكل ProvisionRecord في lib/ops/toolchain.ts — فاللوحة تقرّى محاولة
      // المُشرف زي ما تقرّى محاولة التطبيق بالظبط (مافيش "آخر محاولة" قديمة تخدع).
      try {
        mkdirSync(join(HERE, "state"), { recursive: true });
        const tmp = recordFile + "." + process.pid + ".tmp";
        writeFileSync(tmp, JSON.stringify(rec, null, 2));
        renameSync(tmp, recordFile);
      } catch { /* قرص مقفول — المحرّج لسه بيقرا المجلد نفسه */ }
    };
    const t0 = Date.now();
    let free = null;
    try {
      const fst = statfsSync(join(HERE, "state"));
      free = Math.round((fst.bsize * fst.bavail) / 1048576);
    } catch {
      free = null; // ماقدرناش نقيس — مانمنعش الحاجة، بس بنقول إننا ما قسناش
    }
    if (free !== null && free < 1500) {
      console.log("[supervisor] القرص الفاضي " + free + "MB تحت 1500MB — التنزيل اتخطّى");
      return;
    }
    const mem2 = cgroupMb();
    if (mem2 && mem2.usedMb > mem2.maxMb * 0.85) {
      console.log("[supervisor] RAM " + mem2.usedMb + "/" + mem2.maxMb + "MB فوق 85% — التنزيل اتأجل للدورة الجاية بدل ما يضرب الأب");
      return;
    }
    console.log("[supervisor] toolchain pass: بنكمّل vendor/bin من مِرر جيت هاب");
    vendorRunning = true;
    const cp = spawn(process.execPath, [script, "--into", join(HERE, "vendor", "bin"), "--json"], {
      cwd: HERE,
      stdio: ["ignore", "pipe", "pipe"],
      env: Object.assign({}, process.env, { NODE_OPTIONS: "--max-old-space-size=64" }),
    });
    let out = "";
    let err = "";
    cp.stdout.on("data", (d) => { out += d.toString(); });
    cp.stderr.on("data", (d) => { err += d.toString(); });
    const killer = setTimeout(() => { try { cp.kill("SIGKILL"); } catch { /* already gone */ } }, 900_000);
    cp.on("exit", (code, signal) => {
      clearTimeout(killer);
      vendorRunning = false;
      let doc = null;
      const i = out.lastIndexOf("{");
      for (let s2 = i; s2 >= 0; s2 -= 1) {
        try { doc = JSON.parse(out.slice(s2, out.lastIndexOf("}") + 1)); break; } catch { /* جرّب أقرب } */ }
      }
      if (doc) console.log("[supervisor] toolchain pass: " + doc.ok + "/" + doc.total + " جاهز في " + doc.into);
      else console.log("[supervisor] toolchain pass: مفيش JSON (exit " + (signal || code) + ") — " + err.slice(0, 160).replace(/\\n/g, " "));
      writeRecord({
        at: new Date().toISOString(),
        ok: doc ? Number(doc.ok) > 0 : false,
        exitCode: typeof code === "number" ? code : null,
        ms: Date.now() - t0,
        into: join(HERE, "vendor", "bin"),
        installed: doc ? Number(doc.ok) || 0 : 0,
        total: doc ? Number(doc.total) || 16 : 16,
        results: doc && Array.isArray(doc.results) ? doc.results : [],
        ran: true,
        by: "supervisor",
        error: doc ? null : "no-json",
        reasonAr: doc ? null : "المُشرف شغّل المنزّل بس ماطلعش JSON (exit " + (signal || code) + ")",
      });
      const w = err.indexOf("::warning::");
      if (w >= 0) console.log("[toolchain] " + err.slice(w + 11, w + 260).split("\\n")[0]);
      const total = doc ? Number(doc.total) : -1;
      const okN = doc ? Number(doc.ok) : -1;
      const missing = total > 0 ? total - okN : 1;
      if (missing > 0 && toolchainTries < 3) {
        const waitMin = [10, 30, 60][toolchainTries];
        toolchainTries += 1;
        console.log("[supervisor] فاضل " + missing + " أداة — هاعيد المحاولة بعد " + waitMin + " دقيقة (" + toolchainTries + "/3)");
        const t2 = setTimeout(toolchainPass, waitMin * 60000);
        if (t2.unref) t2.unref();
      }
    });
  };
  // 25 ثانية: أول طلب والـhealth يخلّصوا الأول، وبعدين الشبكة.
  const toolchainTimer = setTimeout(toolchainPass, 25000);
  toolchainTimer.unref?.();

  setInterval(() => {
    const now = stamp();
    if (now && now !== mark) {
      mark = now;
      console.log("[supervisor] restart requested — reloading the app");
      if (child) child.kill("SIGTERM");
    }
  }, 1000);

  // ── update watchdog ───────────────────────────────────────────────────────
  // After a self-update the new code must prove it can serve HTTP. If it does
  // not within 2 minutes, the previous bundle is restored from the backup the
  // updater recorded in state/.update-pending — a bad release can never leave
  // the server dead with nobody to fix it.
  const PENDING = join(HERE, "state", ".update-pending");
  const FAILED = join(HERE, "state", ".update-failed");

  const readPending = () => {
    try { return JSON.parse(readFileSync(PENDING, "utf8")); } catch { return null; }
  };

  const copyBack = (from) => {
    const skip = new Set([".env", ".env.txt", ".npm", "logs", "state", "node_modules"]);
    let n = 0;
    const walk = (src, dst) => {
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        if (dst === HERE && skip.has(entry.name)) continue;
        const s = join(src, entry.name);
        const d = join(dst, entry.name);
        if (entry.isDirectory()) { mkdirSync(d, { recursive: true }); walk(s, d); }
        else { copyFileSync(s, d); n += 1; }
      }
    };
    walk(from, HERE);
    return n;
  };

  const healthy = (port) =>
    new Promise((resolve) => {
      const req = httpGet({ host: "127.0.0.1", port, path: "/api/health", timeout: 4000 }, (r) => {
        r.resume();
        resolve(r.statusCode >= 200 && r.statusCode < 500);
      });
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.on("error", () => resolve(false));
    });

  // لو مسار النسخة اللي في العلامة اتمسح (كونتير اتعاد قبل ما المُشرف يلحق)،
  // بنلقط أي نسخة موجودة: أجدد واحدة في <install>/backups وبعدين /tmp.
  // والمهم: لو مفيش نسخة خالص — نكمّل بالشغل اللي على الديسك ومانيقتلش
  // الطفل كل دقيقتين للأبد (اللي خلّى وايفي 502 من 04:13Z لـ04:25Z).
  const latestBackup = () => {
    for (const root of [join(HERE, "backups"), "/tmp"]) {
      let names = [];
      try {
        names = readdirSync(root).filter((n) => n.startsWith("nova-backup-")).sort();
      } catch {
        continue;
      }
      const dir = join(root, names[names.length - 1]);
      if (names.length > 0) {
        try {
          if (readdirSync(dir).length > 0) return dir;
        } catch {
          /* جرب الجذر اللي بعده */
        }
      }
    }
    return null;
  };

  let watchToken = 0;
  let rolledBackFor = "";
  const watch = (pending) => {
    const myToken = ++watchToken;
    const port = Number(process.env.PORT || process.env.SERVER_PORT || 8080);
    const verifyMs = Number(process.env.NOVA_UPDATE_VERIFY_SECONDS || 120) * 1000;
    const deadline = Date.now() + verifyMs;
    const tick = async () => {
      if (myToken !== watchToken) return;
      if (await healthy(port)) {
        console.log("[supervisor] update verified — new build is serving");
        try { unlinkSync(PENDING); } catch {}
        return;
      }
      if (Date.now() > deadline) {
        const token = String(pending.backup || "") + "|" + String(pending.to || "");
        if (rolledBackFor === token) return; // محاولة رجوع واحدة لكل تحديث
        const from = existsSync(pending.backup) ? pending.backup : latestBackup();
        if (!from) {
          rolledBackFor = token;
          console.log("[supervisor] no backup on disk (new path and /tmp both empty) — keeping the installed files and clearing the pending marker instead of killing the app in a loop");
          try {
            unlinkSync(PENDING);
            writeFileSync(FAILED, JSON.stringify({
              at: new Date().toISOString(),
              from: pending.from,
              to: pending.to,
              restored: 0,
              reason: "backup_missing",
            }, null, 2));
          } catch {}
          return;
        }
        rolledBackFor = token;
        console.log("[supervisor] new build never became healthy — rolling back from " + from);
        try {
          const files = copyBack(from);
          unlinkSync(PENDING);
          writeFileSync(FAILED, JSON.stringify({
            at: new Date().toISOString(),
            from: pending.from,
            to: pending.to,
            restored: files,
          }, null, 2));
          console.log("[supervisor] restored " + files + " files from " + from);
        } catch (e) {
          console.log("[supervisor] rollback FAILED: " + (e && e.message));
        }
        if (child) child.kill("SIGTERM"); else launch();
        return;
      }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 4000);
  };

  // ── الإنقاذ الذاتي للمُشرف ─────────────────────────────────────────────
  // الفخ اللي علّمنا ده جاي (2026-11-10): بوابة الرام أجّلت الإقلاع للأبد ⇒
  // 502 متواصلة، والمُحدِّث جوه التطبيق — والتطبيق مش شغال ⇒ مافيش إصلاح بيوصل.
  // الحلقة دي بتقفل الفخ: لو /api/health فضل ميّت 4+ دقائق ومفيش طفل شغال،
  // المُشرف نفسه بينزّل أحدث nova-24-7.zip من GitHub Releases، بياخد نسخة أمان،
  // بيستبدل الملفات (متخطّيًا state/ و .env)، بيسجّل .update-pending (عشان الـ
  // watchdog فوق يرجّع لو الجديد ما صحّش)، وبيخرج بكود 42 ⇒ حلقة start.sh تعيد
  // تشغيل boot.mjs بالنسخة الجديدة. التعطيل: NOVA_RESCUE_OFF=1.
  let downSince = 0;
  let rescuing = false;
  let lastRescueTry = 0;
  const rescuePort = Number(process.env.PORT || process.env.SERVER_PORT || 8080);
  const rescueUrl = process.env.NOVA_UPDATE_ASSET_URL
    || "https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/nova-portable/nova-24-7.zip";

  const rescueSwap = async () => {
    console.log("[supervisor] التطبيق ميّت 4+ دقائق ومفيش طفل — إنقاذ ذاتي: بنزّل أحدث حزمة وبستبدل نفسي");
    const res = await fetch(rescueUrl, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error("asset " + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000) throw new Error("asset صغير أوي (" + buf.length + "B) — مش هنستبدل بحاجة مشكوك فيها");
    const stamp2 = Date.now();
    const zipPath = "/tmp/nova-rescue-" + stamp2 + ".zip";
    const outDir = "/tmp/nova-rescue-" + stamp2;
    writeFileSync(zipPath, buf);
    await new Promise((resolve, reject) => {
      // python3 موجود فعلًا على المكنة (live-update.py بيشتغل عليه)
      const py = spawn("python3", ["-c", "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zipPath, outDir], { stdio: "inherit" });
      py.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("unzip code " + c))));
      py.on("error", reject);
    });
    try { unlinkSync(zipPath); } catch {}
    // الأرشيف أحيانًا بيبقى جواه فولدر رئيسي — بنلاقي اللي فيه nova-app.mjs
    let root = outDir;
    if (!existsSync(join(root, "nova-app.mjs"))) {
      for (const s of readdirSync(root, { withFileTypes: true })) {
        const cand = join(root, s.name);
        if (s.isDirectory() && existsSync(join(cand, "nova-app.mjs"))) { root = cand; break; }
      }
    }
    if (!existsSync(join(root, "nova-app.mjs"))) throw new Error("الأرشيف مفيهوش nova-app.mjs — أبطل الإنقاذ");
    // نسخة أمان من الحالة الحالية قبل الاستبدال (نفس قواعد تخطّي الرول-باك + backups)
    const bk = join(HERE, "backups", "nova-backup-" + new Date().toISOString().replace(/[:.]/g, "-"));
    mkdirSync(bk, { recursive: true });
    const skipBk = new Set([".env", ".env.txt", ".npm", "logs", "state", "node_modules", "backups"]);
    const toBackup = (sd, dd) => {
      for (const entry of readdirSync(sd, { withFileTypes: true })) {
        if (sd === HERE && skipBk.has(entry.name)) continue;
        const s2 = join(sd, entry.name), d2 = join(dd, entry.name);
        if (entry.isDirectory()) { mkdirSync(d2, { recursive: true }); toBackup(s2, d2); }
        else copyFileSync(s2, d2);
      }
    };
    toBackup(HERE, bk);
    writeFileSync(PENDING, JSON.stringify({ at: new Date().toISOString(), from: "rescue", to: rescueUrl, backup: bk }, null, 2));
    const files = copyBack(root);
    console.log("[supervisor] rescue بدّل " + files + " ملف من آخر إصدار — خروج بكود 42 عشان حلقة start.sh ترجّع النسخة الجديدة");
    process.exit(42);
  };

  const rescueTick = async () => {
    if (process.env.NOVA_RESCUE_OFF === "1" || rescuing || vendorRunning || child) { downSince = 0; return; }
    if (await healthy(rescuePort)) { downSince = 0; return; }
    if (!downSince) { downSince = Date.now(); return; }
    if (Date.now() - downSince < 240_000) return;   // 4 دقائق موت متواصل قبل التدخل
    if (Date.now() - lastRescueTry < 900_000) return; // محاولة كل ربع ساعة سقف — مش فرم
    rescuing = true; lastRescueTry = Date.now();
    try { await rescueSwap(); }
    catch (e) { console.log("[supervisor] rescue فشل: " + (e && e.message)); }
    rescuing = false;
  };
  setInterval(() => { void rescueTick(); }, 30_000).unref?.();

    const pendingAtBoot = readPending();
  if (pendingAtBoot && pendingAtBoot.backup) {
    console.log("[supervisor] an update is pending verification (from " + pendingAtBoot.from + ")");
    watch(pendingAtBoot);
  }

  // A later update (started by the app itself) is picked up on the next reload.
  let mark2 = 0;
  setInterval(() => {
    const p = readPending();
    if (p && p.backup) {
      try {
        const m = statSync(PENDING).mtimeMs;
        if (m !== mark2) { mark2 = m; watch(p); }
      } catch {}
    }
  }, 5000);

  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      leaving = true;
      if (child) child.kill(sig);
      else process.exit(0);
    });
  }
}
`,
);

// server.mjs — the file hosts are told to run (`node server.mjs`).
// It is a two-line door into boot.mjs so there is exactly one entry point.
fs.writeFileSync(
  path.join(OUT, "server.mjs"),
  `#!/usr/bin/env node
/**
 * NOVA entry point (hosts run: node server.mjs).
 *
 * boot.mjs decides the role: fleet agent, or supervisor that keeps
 * nova-app.mjs alive and reloads it after an update.
 */
import "./boot.mjs";
`,
);

/* ── 2. launch scripts ───────────────────────────────────────────────────── */
fs.writeFileSync(path.join(OUT, "start.sh"), START_SH, { mode: 0o755 });


/**
 * `run` — the launcher with no dot in its name.
 *
 * Measured 2026-11-05: pasting "sh /home/container/nova-24-7/start.sh" into a
 * chat or a phone first turns it into a markdown link — `start.sh` looks like a
 * hostname because `.sh` is a real TLD (Saint Helena). The panel then receives
 * the literal text `[start.sh](http://start.sh)` and dies with
 * "sh: 0: cannot open .../nova-24-7/[start.sh](http://start.sh): No such file"
 * while the files sit right there. A name with no extension cannot be
 * mangled, so panels get told:  sh /home/container/nova-24-7/run
 */
fs.writeFileSync(
  path.join(OUT, "run"),
  `#!/bin/sh
# NOVA launcher — same thing as start.sh, with a name nothing linkifies.
# Usage (Pterodactyl / Waifly Startup Command):
#   sh /home/container/nova-24-7/run
HERE="$(cd "$(dirname "$0")" && pwd)"
exec sh "$HERE/start.sh" "$@"
`,
  { mode: 0o755 },
);

// `sh -n` على الملفين المنبثقين: الحلقة لو اتكتبت غلط الحزمة بتترموَّج عادي
// (مافيش JS بينده على shell)، والموت بيبان على المكنة بس — يعني بعد ما توصل.
// الفحص ده بيخليها تفشل هنا بدل هناك. وبعد `run` تحديدًا: أول مرة حطيته بعد
// `start.sh` طلع «cannot open run» لأن الملف ده بيتكتب تحت.
for (const sh of ["start.sh", "run"]) {
  execFileSync("sh", ["-n", path.join(OUT, sh)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

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
①-ب  على بانل Pterodactyl (زي Waifly) — الطريقة اللي بتشتغل
────────────────────────────────────────────────────────────
الـegg بيشغّل اللي تكتبه في Startup Command من مجلد /home/container
(مش من جوه مجلد الباندل). الأمر الصح:

    sh /home/container/nova-24-7/run

ليه «run» مش «start.sh»؟ لأن start.sh لما بتلصقها في شات أو على الموبايل
بتتحول للينك ماركداون (‎.sh اسم دولة حقيقي — سانت هيلينا)، فاللوحة بتستلم
حرفيًا [start.sh](http://start.sh) وترفض:

    sh: 0: cannot open /home/container/nova-24-7/[start.sh](...): No such file

«run» مفيهوش نقطة، فمستحيل يتلخبط. لو اللصق اتظبط عندك: start.sh زيها زي run.

Startup Command 2: سيبها فاضية.
Docker Image  : Node.js 22   (22 هي اللي اتقاس عليها؛ 24+ ممكن تشتغل، غير مختبرة)
Main file     : لو اللوحة سألت — server.mjs (أو boot.mjs، الاتنين شغالين)

ممنوع npm install أو node . — مفيش أي تثبيت ولا بناء.
البناء محتاج ~1.5 GB والسلوت 300 MB.

اختيار الـegg: NodeJS لوحده. مش NodeJS + Python ومش + FFmpeg —
بايثون وFFmpeg بياخدوا من نفس الـ RAM ومش مستخدمين خالص.

⚠️ ما تغيّرش الـegg لـ«Web Hosting (PHP)» — PHP مش بيشغّل Node.

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
    server.mjs        الدخول (باشراف ذاتي) — بيشغّل nova-app.mjs
    nova-app.mjs      السيرفر كامل في ملف واحد
    nova-agent.js     وكيل النود (بيتنفّذ أوامر الهاب)
    public/           الواجهة جاهزة
    state/            الذاكرة + بيانات مقاسة (11 ملف: صيد، استشارات، corpus، خزنة)
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

# تخفيف الحمل على مضيف ضعيف (الـCI بيبني الكوربوس كل 30 دقيقة والمكنة تستهلكه):
# NOVA_CVE_SOURCE=ci
# وقفل مهمة كرون بالاسم من غير تعديل كود:
# NOVA_CRON_OFF=nova_learn

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

/* ── 2d. refuse to ship a secret ─────────────────────────────────────────── */
/* الحزمة دي بتنزل كـasset في Release عام — ومرة `.env` ركب مع `api-server-windows-*.zip` وسرّب
 * NOVA_EXEC_TOKEN ومافيش بوابة قبضته لأن ماحدش بيبص جوه الـartifact. الفحص بقى سكربت مستقل
 * (`scripts/audit-bundle-secrets.mjs`) يتشغّل هنا على المجلد، وعلى أي حزمة منزّلة من Release. */
try {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "audit-bundle-secrets.mjs"), OUT], { stdio: "inherit" });
} catch {
  console.error("✗ الحزمة اترفضت — الباندر ما بيكملش بعد تسريب محتمل.");
  process.exit(1);
}

/* ── 2e. the launchers a panel needs must actually be in the bundle ──────── */
/* Measured 2026-11-05: the zip shipped without a launcher that survives a paste,
 * and a Pterodactyl panel received `[start.sh](http://start.sh)` and died with
 * "No such file" while every file was present. Shipping is not the same as
 * working, so the two entry points are checked here instead of trusted. */
for (const name of [
  "run",
  "start.sh",
  "boot.mjs",
  "server.mjs",
  "public/index.html",
  // البيانات والأدوات اللي بتقرا من القرص بعد الإقلاع — لو مش هنا، الميزة مش منشورة.
  path.join("ops", "bounty", "programs-catalog.json"),
  path.join("scripts", "fetch-toolchain.mjs"),
]) {
  if (!fs.existsSync(path.join(OUT, name))) {
    console.error(`✗ الحزمة ناقصة ${name} — الباندر ما بيكملش.`);
    process.exit(1);
  }
}

/* ── 3. zip it ───────────────────────────────────────────────────────────── */
const zipPath = path.join(ROOT, "dist-standalone", "nova-24-7.zip");
let zipped = false;
try {
  execFileSync("zip", ["-qr", zipPath, "nova-24-7"], { cwd: path.join(ROOT, "dist-standalone") });
  zipped = true;
} catch {
  // zip is not installed everywhere; the folder itself is still the deliverable.
}

/* ── 3c. syntax gate ─────────────────────────────────────────────────────────
 * كل ملف بيتولّد جوه الحزمة لازم يتعمله parse. السبب مقاس: في التعديل ده نفسه
 * سطر اتكتب بعلامة نوع TypeScript (`let names: string[]`) جوّه نص boot.mjs —
 * وهيمشّي حزمة محمّلة على المكنة ما بتقلاعش خالص. الحارس بيحوّل الغلطة دي لفشل
 * بناء بدل ما تخنق وايفى.
 */
const syntaxChecked = [];
const syntaxFailed = [];
const SYNTAX_SKIP = new Set(["node_modules", "public", "vendor", "audit"]);
const walkJs = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SYNTAX_SKIP.has(entry.name)) walkJs(path.join(dir, entry.name));
    } else if (/\.(mjs|cjs|js)$/.test(entry.name)) {
      syntaxChecked.push(path.join(dir, entry.name));
    }
  }
};
walkJs(OUT);
for (const file of syntaxChecked) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe", timeout: 20000 });
  } catch (err) {
    syntaxFailed.push({
      file: path.relative(OUT, file),
      message: String((err && err.stderr) || err.message).split("\n").slice(0, 3).join(" ").slice(0, 160),
    });
  }
}
if (syntaxFailed.length > 0) {
  console.error(`✗ ${syntaxFailed.length}/${syntaxChecked.length} ملف في الحزمة مابيترجمش (node --check):`);
  for (const f of syntaxFailed.slice(0, 8)) console.error(`  · ${f.file} :: ${f.message}`);
  process.exit(1);
}
console.log(`· syntax gate: ${syntaxChecked.length} ملف اتعمله parse ✓`);

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
