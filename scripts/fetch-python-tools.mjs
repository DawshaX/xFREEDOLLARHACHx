#!/usr/bin/env node
/**
 * Python Tool Provider — التنزيل الحقيقي لأدوات بايثون الأمنية
 * ────────────────────────────────────────────────────────────────────────────────
 * المشكلة اللي الملف ده بيحلها
 * ─────────────────────────────
 * `NOT_VENDORABLE` في toolchain.ts كان بيقول «sqlmap مش هينفع يتنزّل» — وده
 * كان **صح جزئيًا**: `sqlmap` و`nikto` و`semgrep` و`whatweb` و`nmap` أسماء
 * حزم نظام (apt) أو سكربتات مش منشورة كـrelease. لكن اللي اتقيس 2026-11-17:
 *
 *   • release-assets.githubusercontent.com محجوب في البيئة دي (ECONNRESET)
 *     → يعني 18 أصل في nova-toolchain مش قابلين للتنزيل من هنا أبدًا.
 *   • pypi.org + files.pythonhosted.org + registry.npmjs.org **شغالين 200**.
 *
 * يعني الطريق اللي شغال فعلًا لأدوات كتير هو **pip**، مش GitHub. والملف ده
 * بينفّذه: بيبني venv، وينزّل فيه الأدوات الأمنية اللي ليها حزمة PyPI،
 * وبيتحقق من كل واحدة **بتشغيلها** مش بس بوجودها.
 *
 * قواعد ثابتة (ورثها من باقي البرنامج)
 * ─────────────────────────────────
 * 1. **مافيش نجاح مفبرك**: الأداة بتتحسب «موجودة» بس لو `--version`/`-h`
 *    رجّع كود 0 أو نص مفيد. غيابها بيقول «فشل» مع السبب الحقيقي.
 * 2. **كل ادعاء مقاس**: الـmanifest بيخرج من `pip list` + تشغيل فعلي.
 * 3. **بلا كسر للي موجود**: لو الـvenv موجود بيتكمّل عليه، مش بيتمسح.
 *
 * الاستخدام:
 *   node scripts/fetch-python-tools.mjs                 # الافتراضي: الأساسي
 *   node scripts/fetch-python-tools.mjs --all           # كل اللي في الكتالوج
 *   node scripts/fetch-python-tools.mjs --only certipy,impacket
 *   node scripts/fetch-python-tools.mjs --json
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const VENV = process.env.NOVA_PY_VENV || path.join(REPO, "vendor", "pyenv");
const MANIFEST = path.join(REPO, "vendor", "python-tools.json");

/**
 * الكتالوج — كل دخول له: الحزمة على PyPI، الأمر اللي بيتحقق منه، ووسم.
 * الأسماء المنشورة على PyPI مش دايمًا نفس اسم الأمر، وده اللي كان بيخلّي
 * الناس تفتكر إنها «مش موجودة».
 */
const CATALOG = {
  // — استغلال شبكات ويندوز/AD (نسف حقيقي: psexec/secretsdump/wmiexec) —
  impacket: { verify: ["secretsdump.py", "-h"], tag: "windows-ad", what: "Impacket — secretsdump/psexec/wmiexec/smbclient" },
  "certipy-ad": { bin: "certipy", verify: ["certipy", "-h"], tag: "windows-ad", what: "Certipy — ESC1..ESC8 على AD CS" },
  /* ★ الاسم على PyPI هو bloodhound-ce (متحقق 200 على /pypi/bloodhound-ce/json)،
   *   مش bloodhound-ce-python (404). الفرق ده كان بيخلي أداة شغالة تتحسب فشل. */
  "bloodhound-ce": { bin: "bloodhound-ce-python", verify: ["bloodhound-ce-python", "-h"], tag: "windows-ad", what: "BloodHound CE ingestor" },
  "ldapdomaindump": { bin: "ldapdomaindump", verify: ["ldapdomaindump", "-h"], tag: "windows-ad", what: "تفريغ LDAP للدومين" },
  // — فحص ويب واستغلال —
  sqlmap: { bin: "sqlmap", verify: ["sqlmap", "--version"], tag: "web-exploit", what: "SQL injection معروف ومتبع" },
  "dirsearch": { bin: "dirsearch", verify: ["dirsearch", "--version"], tag: "web-recon", what: "تعداد مسارات ويب" },
  "wafw00f": { bin: "wafw00f", verify: ["wafw00f", "--version"], tag: "web-recon", what: "كشف WAF" },
  // — اعتراض وتلاعب في الشبكة —
  mitmproxy: { bin: "mitmproxy", verify: ["mitmproxy", "--version"], tag: "network", what: "mitmproxy — اعتراض HTTP/S" },
  scapy: { tag: "network", what: "Scapy — بناء وتعديل الحزم" },
  "python-nmap": { tag: "network", what: "nmap من بايثون" },
  shodan: { bin: "shodan", verify: ["shodan", "--version"], tag: "recon", what: "Shodan CLI" },
  // — ثنائيات/هندسة عكسية —
  pwntools: { bin: "pwn", verify: ["pwn", "--help"], tag: "binary-exploit", what: "pwntools — استغلال ثنائيات" },
  ROPgadget: { bin: "ROPgadget", verify: ["ROPgadget", "--version"], tag: "binary-exploit", what: "بناء ROP chains" },
  ropper: { bin: "ropper", verify: ["ropper", "--version"], tag: "binary-exploit", what: "بحث gadgets" },
  capstone: { tag: "binary-exploit", what: "Capstone disassembler" },
  "keystone-engine": { tag: "binary-exploit", what: "Keystone assembler" },
  "frida-tools": { bin: "frida", verify: ["frida", "--version"], tag: "mobile", what: "Frida — hooking للتطبيقات" },
  "androguard": { tag: "mobile", what: "تحليل APK" },
  // — تحليل جنائي —
  volatility3: { bin: "vol", verify: ["vol", "--help"], tag: "forensics", what: "Volatility 3 — ذاكرة" },
  "oletools": { bin: "olevba", verify: ["olevba", "-h"], tag: "forensics", what: "تحليل مستندات Office الخبيثة" },
  "pefile": { tag: "forensics", what: "تحليل PE" },
  "yara-python": { tag: "forensics", what: "YARA من بايثون" },
  // — كلمات مرور —
  "johnnydep": { tag: "meta", what: "meta" },
  hashid: { bin: "hashid", verify: ["hashid", "--help"], tag: "passwords", what: "تعرّف نوع الهاش" },
  "pypykatz": { bin: "pypykatz", verify: ["pypykatz", "-h"], tag: "passwords", what: "Mimikatz ببايثون (LSASS dumps)" },
  // — مساعدة عامة —
  requests: { tag: "core", what: "requests" },
  "beautifulsoup4": { tag: "core", what: "HTML parsing" },
  "pycryptodome": { tag: "core", what: "تشفير" },
  "dnspython": { tag: "core", what: "DNS" },
};

/** الافتراضي: أهم 12 أداة اللي بتغطي AD/web/network/forensics بلا حزم ضخمة. */
const DEFAULT_SET = [
  "impacket", "certipy-ad", "sqlmap", "dirsearch", "wafw00f", "mitmproxy",
  "pwntools", "ROPgadget", "frida-tools", "volatility3", "pypykatz", "hashid",
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeoutMs ?? 900_000,
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1", ...(opts.env ?? {}) },
    });
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => { out += d.toString(); });
    c.stderr.on("data", (d) => { err += d.toString(); });
    c.on("error", (e) => resolve({ code: -1, out, err: String(e.message) }));
    c.on("close", (code) => resolve({ code, out, err }));
  });
}

function pyBin() {
  for (const c of [path.join(VENV, "bin", "python"), path.join(VENV, "Scripts", "python.exe")]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function pipBin() {
  for (const c of [path.join(VENV, "bin", "pip"), path.join(VENV, "Scripts", "pip.exe")]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** يبني الـvenv لو مش موجود — ويقول بصراحة لو فشل. */
async function ensureVenv(log) {
  if (pyBin()) {
    log(`venv موجود: ${VENV}`);
    return { ok: true };
  }
  fs.mkdirSync(path.dirname(VENV), { recursive: true });
  log(`بيبني venv → ${VENV}`);
  const r = await run("python3", ["-m", "venv", VENV], { timeoutMs: 180_000 });
  if (r.code !== 0) {
    return { ok: false, why: `python3 -m venv فشل (${r.code}): ${(r.err || r.out).slice(0, 300)}` };
  }
  // pip في venv حديث بيبقى قديم — نحدّثه مرة واحدة
  const p = pipBin();
  if (p) await run(p, ["install", "-q", "--upgrade", "pip", "setuptools", "wheel"], { timeoutMs: 300_000 });
  log("venv اتجهّز ✓");
  return { ok: true };
}

/** الاسم الحقيقي للحزمة في الكتالوج — بعض المفاتيح مكتوبة بالشكل الصح أصلًا. */
function pkgOf(key) {
  return key;
}

/** يتحقق إن الأداة شغالة فعلًا — برجوع كود 0 أو نص مفيد. */
async function verifyOne(key, entry) {
  const bin = entry.bin;
  if (!bin || !entry.verify) return { what: entry.what, present: true, version: "(library)", verified: false, note: "مكتبة — مافيش أمر للتحقق" };
  const binPath = path.join(VENV, "bin", bin);
  if (!fs.existsSync(binPath)) {
    // ممكن الحزمة متسطّبة بس الأمر مش في bin (زي vol.py في النسخ القديمة)
    return { what: entry.what, present: false, version: null, verified: false, note: `الأمر ${bin} مش موجود بعد التنزيل` };
  }
  const [, ...rest] = entry.verify;
  /* ★ الغلطة اللي كانت بتودّي 3 أدوات شغالة لخانة «فشل»: كنا بنبني مسار
   *   الأمر من `verify[0]` بدل `bin`. sqlmap عنده bin="sqlmap" وverify[0]
   *   ="sqlmap" فبيتفقوا، لكن ده مش مضمون لأي أداة (مثال: حزمة `volatility3`
   *   أمرها `vol`). المصدر الصحيح هو bin. اتقاس 2026-11-17: sqlmap
   *   --version → كود 0 ونص "1.10.11#pip" وكان بيتحسب فشل. */
  const r = await run(path.join(VENV, "bin", bin), rest, { timeoutMs: 60_000 });
  const text = `${r.out}${r.err}`;
  /* أوامر كتير بترجّع كود غير صفري مع -h (argparse بيطلع 0 للنص العادي،
   * وبعض الأدوات بتطلع 1). المعيار الحقيقي: **طبع نص مفيد**. كمان بنشيل
   * أكواد ANSI قبل القياس عشان ما نعدّهاش «نص» وهي escape codes. */
  const clean = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim();
  /* ★ المعيار اتظبط بعد قياس حقيقي: كان length > 20، وsqlmap بيطبع
   *   "1.10.11#pip" = 12 حرف بالظبط، فكان بيتحسب فشل وهو شغال تمام.
   *   نفس الحكاية: frida "17.26.4" (7 حروف) وdirsearch "dirsearch v0.5.0".
   *   المعيار الصح: الأمر اشتغل **وطبع حاجة ذات معنى** —
   *     • كود 0 ونص موجود ⇒ شغالة
   *     • كود غير صفري بس فيه رقم نسخة/usage ⇒ شغالة (طبيعي لأوامر -h)
   *     • traceback ناقص مكتبة ⇒ فشل بصراحة (مافيش نسخة ولا usage) */
  const hasVersion = /\d+\.\d+/.test(clean) || /version|usage|framework/i.test(clean);
  const looksBroken = /ModuleNotFoundError|ImportError|No module named|command not found/i.test(clean) && !hasVersion;
  const useful = clean.length > 3 && !looksBroken && (r.code === 0 || hasVersion);
  const firstLine = text.split("\n").find((l) => l.trim().length > 3)?.trim().slice(0, 90) ?? "";
  return { what: entry.what, present: useful, version: firstLine || null, verified: useful, note: r.code === 0 ? "" : `كود ${r.code} مع نص مفيد` };
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const all = argv.includes("--all");
  const onlyArg = argv.find((a) => a.startsWith("--only="))?.slice(7) ?? null;
  const logLines = [];
  const log = (s) => {
    logLines.push(`${new Date().toISOString()} ${s}`);
    if (!asJson) process.stderr.write(`${s}\n`);
  };

  let keys;
  if (onlyArg) keys = onlyArg.split(",").map((s) => s.trim()).filter(Boolean);
  else if (all) keys = Object.keys(CATALOG);
  else keys = DEFAULT_SET;

  const unknown = keys.filter((k) => !CATALOG[k]);
  if (unknown.length) {
    const msg = `أدوات مش في الكتالوج: ${unknown.join(", ")} — المتاح: ${Object.keys(CATALOG).join(", ")}`;
    if (asJson) process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2));
    else process.stderr.write(msg + "\n");
    process.exit(2);
  }

  const v = await ensureVenv(log);
  if (!v.ok) {
    const res = { ok: false, error: v.why, venv: VENV, installed: 0, total: keys.length, results: [] };
    if (asJson) process.stdout.write(JSON.stringify(res, null, 2));
    else process.stderr.write(`فشل: ${v.why}\n`);
    process.exit(1);
  }

  const p = pipBin();
  const results = [];
  for (const key of keys) {
    const entry = CATALOG[key];
    const started = Date.now();
    log(`بينزّل ${key}…`);
    const r = await run(p, ["install", "-q", "--disable-pip-version-check", pkgOf(key)], { timeoutMs: 600_000 });
    const ms = Date.now() - started;
    if (r.code !== 0) {
      const why = (r.err || r.out).split("\n").filter((l) => /ERROR|error:/.test(l)).slice(0, 2).join(" · ") || `pip خرج بـ${r.code}`;
      log(`  ✗ ${key}: ${why.slice(0, 140)}`);
      results.push({ pkg: key, tag: entry.tag, status: "failed", why: why.slice(0, 300), ms });
      continue;
    }
    const ver = await verifyOne(key, entry);
    log(`  ${ver.present ? "✓" : "✗"} ${key} ${ver.version ? "· " + ver.version.slice(0, 60) : ""}`);
    results.push({ pkg: key, tag: entry.tag, status: ver.present ? "installed" : "failed", ...ver, ms });
  }

  const installed = results.filter((x) => x.status === "installed").length;
  // إجمالي الحزم الحقيقية من pip — ده اللي بيبني عليه الواجهة
  let totalPkgs = null;
  try {
    const py = pyBin();
    const lr = await run(py, ["-m", "pip", "list", "--format=json"], { timeoutMs: 120_000 });
    totalPkgs = JSON.parse(lr.out || "[]").length;
  } catch { /* */ }
  const manifest = {
    ok: installed > 0,
    venv: VENV,
    generatedAt: new Date().toISOString(),
    installed,
    total: keys.length,
    pythonPackages: totalPkgs,
    results,
    log: logLines,
  };
  try {
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  } catch (e) {
    log(`مش قادر أكتب المانيفست: ${(e).message}`);
  }
  if (asJson) process.stdout.write(JSON.stringify(manifest, null, 2));
  else log(`خلص: ${installed}/${keys.length} أداة · ${totalPkgs ?? "?"} حزمة بايثون في الـvenv`);
  process.exit(installed > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
