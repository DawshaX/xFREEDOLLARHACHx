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
  const { statSync, statfsSync, readFileSync, readdirSync, copyFileSync, mkdirSync, unlinkSync, writeFileSync, existsSync } = await import("node:fs");
  const { get: httpGet } = await import("node:http");
  const MARK = join(HERE, "state", ".nova-restart");
  const ENTRY = join(HERE, "nova-app.mjs");

  const stamp = () => {
    try { return statSync(MARK).mtimeMs; } catch { return 0; }
  };

  let child = null;
  let leaving = false;
  let mark = stamp();

  const launch = () => {
    // Re-read .env first: a key added in the panel takes effect on reload.
    const fresh = loadEnvFile();
    if (fresh) console.log("[supervisor] picked up " + fresh + " new env var(s) from .env");
    child = spawn(process.execPath, [ENTRY], {
      stdio: "inherit",
      env: Object.assign({}, process.env, { NOVA_SUPERVISED: "1" }),
    });
    const started = Date.now();
    child.on("exit", (code, signal) => {
      child = null;
      if (leaving) { process.exit(0); return; }
      const lived = Date.now() - started;
      console.log("[supervisor] app exited (" + (signal || code) + ") after " + Math.round(lived / 1000) + "s — restarting");
      // Crash-loop guard: back off when the app dies instantly.
      setTimeout(launch, lived < 5000 ? 3000 : 300);
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
  const toolchainPass = () => {
    if (process.env.NOVA_TOOLCHAIN_AT_BOOT === "0") return;
    const root = String(process.env.NOVA_STATE_DIR || process.cwd());
    const wantsAuto = process.env.NOVA_TOOLCHAIN_AT_BOOT === "1" || root.indexOf("/home/container") === 0;
    if (!wantsAuto) return; // مكنة تطوير/CI ما تنزّلش 219MB لوحدها
    const script = join(HERE, "scripts", "fetch-toolchain.mjs");
    if (!existsSync(script)) {
      console.log("[supervisor] مفيش scripts/fetch-toolchain.mjs في الحزمة — اتخطّيت");
      return;
    }
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
    console.log("[supervisor] toolchain pass: بنكمّل vendor/bin من مِرر جيت هاب");
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
      let doc = null;
      const i = out.lastIndexOf("{");
      for (let s2 = i; s2 >= 0; s2 -= 1) {
        try { doc = JSON.parse(out.slice(s2, out.lastIndexOf("}") + 1)); break; } catch { /* جرّب أقرب } */ }
      }
      if (doc) console.log("[supervisor] toolchain pass: " + doc.ok + "/" + doc.total + " جاهز في " + doc.into);
      else console.log("[supervisor] toolchain pass: مفيش JSON (exit " + (signal || code) + ") — " + err.slice(0, 160).replace(/\\n/g, " "));
      const w = err.indexOf("::warning::");
      if (w >= 0) console.log("[toolchain] " + err.slice(w + 11, w + 260).split("\\n")[0]);
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
fs.writeFileSync(
  path.join(OUT, "start.sh"),
  `#!/bin/sh
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
exec node boot.mjs
`,
  { mode: 0o755 },
);

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
