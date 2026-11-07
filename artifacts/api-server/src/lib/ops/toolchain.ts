/**
 * toolchain — المحرك يجهّز أيديه بنفسه، أو بيقول ليه ماقدرش.
 * ──────────────────────────────────────────────────────────────────────────
 * مقاس على السلوت الحيّ (nova.waifly.com، 2026-11-05T17:14Z):
 *   `GET /api/ops/version → { toolsPresent: [] }`
 * يعني الطبقة اللي بتبني خططًا وبتكتب تقارير فاضية من الإيدين: مفيش nuclei/httpx/
 * subfinder على الحاوية، ومافيش `apt` ومافيش root أصلاً. الحل موجود في المستودع
 * من دورات سابقة — `scripts/fetch-toolchain.mjs` بينزّل نسخ ProjectDiscovery
 * الثابتة في `vendor/bin` و`findBinary()` بيدوّر هناك — لكنه كان **خطوة بناء**
 * بس: ناسخة الـCI بتعمله، والحاوية اللي بتنزل `nova-24-7.zip` مابتعملوش.
 *
 * الملف ده بيخليه خطوة **تشغيل** كمان:
 *   • `toolchainStatus()`  — القراءة: إيه الموجود، إيه الناقص، المجلد قابل للكتابة؟
 *   • `provisionToolchain()` — بينفّذ نفس السكريبت بـ`spawn(process.execPath, […])`
 *     (بلا shell، زي أصل السكريبت: اسم أداة مابيvalيش سطر أوامر)، وبیسجّل المحاوله.
 *   • `bootToolchainFetch()` — لو `NOVA_TOOLCHAIN_FETCH=1` (أو `auto` والمجلد فاضي)
 *     يحاول مرة واحدة وقت الإقلاع، من غير ما يبلوك حاجة.
 *
 * القواعد اللي ماشية هنا، كلها مقاسة مش معلنة:
 *   1. **مافيش نجاح مفبرك**: لو السكريبت مش موجود في الحزمة، الرد بيقول "مش موجود"
 *      وبيسّمّي الملف اللي لازم يت نسخّه — مافيش `{installed:true}` في الهواء.
 *   2. **الحقيقة من السكريبت نفسه**: مابقراش الـmanifest وأفتّّر أنه نجح؛ الحالة
 *      بتتقاس من `fs.existsSync` + `toolStatus()` بعد التنفيذ، والنتايج بتتخزن.
 *   3. **سقف زمني**: التنزيل+اختبار النسخة لـ7 أدوات بيتعمل في دقائق على خط سريع
 *      وبلا ثانية على خط بطيء، فمافيش محاولة بتمشي من غير `timeoutMs`.
 *   4. **مفيش لمس لشبكة في الاختبارات**: كل دوال القراءة نقية على fs، والتنفيذ
 *      بيتعمله fake في `ops-selftest` (نفس طريقة `withDeadline`).
 */
import fs from "node:fs";
import { isDurableHost } from "../agent/durable-host";
import { wordlistInfo } from "./wordlist";
import path from "node:path";
import { spawn } from "node:child_process";
import { resetBinaryCache, toolStatus } from "./tools";

/** الأدوات اللي السكريبت بيقدر يجيبها — لازم تفضل مطابقة لـ`fetch-toolchain.mjs`. */
export const VENDORABLE = [
  "subfinder",
  "httpx",
  "nuclei",
  "katana",
  "dnsx",
  "naabu",
  "ffuf",
  // Expanded 2026-11-06 — static linux/amd64 releases only (see fetch-toolchain.mjs).
  "amass",
  "gobuster",
  "dalfox",
  "gitleaks",
  "trivy",
] as const;

/**
 * Tools that need a package manager or an interpreter, so they can never be a
 * vendored static binary. Kept next to VENDORABLE so the agent can say *why*
 * instead of reporting a permanent "missing" that looks like a broken install.
 */
export const NOT_VENDORABLE = ["nmap", "sqlmap", "nikto", "semgrep", "whatweb"] as const;

export interface ToolchainStatus {
  /** المجلد اللي بنحط فيه (vendor/bin، أو NOVA_VENDOR_BIN) */
  dir: string;
  exists: boolean;
  /** الملفات الموجودة فعلًا وحجمها — مش قائمة أمنية */
  files: Array<{ name: string; bytes: number }>;
  /** ملفات VENDORABLE موجودة في المجلد بس `findBinary` بيرفضها (مفيش X_OK) */
  unusable: Array<{ name: string; bytes: number }>;
  /**
   * حدود الحاوية المقروءة من cgroup — «استغل الرام والـCPU» لازم يبقى رقم عند
   * الأداة، مش إحساس: منه بنعرف إن التنزيل اللي مات `exitCode:null` بعد 6.4 ثانية
   * كان راح في حد ذاكرة، وإن nuclei ماشي في 256MB ولا لأ.
   */
  resources: { memLimitMB: number | null; memUsedMB: number | null; cpuQuota: number | null; note: string };
  /** قائمة المسارات المدمجة اللي بتشتغل بيها ffuf/gobuster (متقاسة من الملف نفسه). */
  wordlist: { path: string | null; lines: number; bytes: number; source: string };
  present: string[];
  missing: string[];
  writable: boolean;
  /** مسار السكريبت اللي بينفّذ التنزيل، ولو مش في الحزمة يبقى null */
  script: string | null;
  scriptAvailable: boolean;
  /** إيه اللي قالته الأدوات نفسها (findBinary) — المصدر الوحيد ل«موجود» */
  binaries: Array<{ bin: string; present: boolean; where: string | null }>;
  /** الميغابايت الفاضلة على قرص `dir` — null لو ماقدرناش نقيس */
  freeMB: number | null;
  /** الحد اللي بنرفض تحته التنزيل (NOVA_TOOLCHAIN_MIN_FREE_MB) */
  minFreeMB: number;
  /** آخر محاولة provisioning مسجلة على القرص */
  last: ProvisionRecord | null;
}

export interface ProvisionRecord {
  at: string;
  ok: boolean;
  exitCode: number | null;
  ms: number;
  into: string | null;
  installed: number;
  total: number;
  results: Array<{ bin: string; status: string; tag?: string; version?: string; why?: string }>;
  /** `ran` = السكربت اتنفّذ وادّى تقرير؛ `ok` = فيه أداة بقت صالحة للاستخدام. */
  ran?: boolean;
  error?: string;
  reasonAr?: string;
  /** رفض استباقي (قبل أي شبكة) وسببه — «ran» و«ok» الاتنين false ساعتها */
  refused?: "no-space";
  freeMB?: number | null;
}

/**
 * الساحة الفاضلة بالميغابايت على أقرب مسار موجود — بنقيس قبل أي تنزيل.
 * بيترجع env في كل نداء (مش لحظة الاستيراد) عشان المشغّل يقدر يغيّره، وللـselftest.
 */
export function minFreeMB(): number {
  const raw = Number(process.env.NOVA_TOOLCHAIN_MIN_FREE_MB);
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 180;
}

export function freeBytesAt(target: string): number | null {
  let cur = path.resolve(target);
  for (let i = 0; i < 8; i += 1) {
    try {
      if (fs.existsSync(cur)) {
        const st = fs.statfsSync(cur);
        const bytes = Number(st.bsize) * Number(st.bavail);
        return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
      }
    } catch {
      return null;
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

export function freeMBAt(target: string): number | null {
  const b = freeBytesAt(target);
  return b === null ? null : Math.round(b / 1_048_576);
}

export function vendorDir(): string {
  const env = process.env.NOVA_VENDOR_BIN;
  if (env) return path.resolve(env);
  return path.resolve(process.cwd(), "vendor/bin");
}

function recordPath(): string {
  return path.resolve(process.env.NOVA_TOOLCHAIN_RECORD || path.join(process.cwd(), "state", "toolchain-provision.json"));
}

/** السكريبت بيتفسّح من cwd لفوق (نفس أسلوب الكتالوج): شجرة المستودع أو جوه الحزمة. */
export function findVendorerScript(): string | null {
  const wanted = path.join("scripts", "fetch-toolchain.mjs");
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, wanted);
    if (fs.existsSync(candidate)) return candidate;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function readRecord(): ProvisionRecord | null {
  try {
    return JSON.parse(fs.readFileSync(recordPath(), "utf8")) as ProvisionRecord;
  } catch {
    return null;
  }
}

function writeRecord(rec: ProvisionRecord): void {
  const file = recordPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 2), "utf8");
    fs.renameSync(tmp, file); // كتابة ذرية: المحرك مايخلّيش نص سجل
  } catch {
    /* قرص مقفول (PaaS مؤقت) — الحالة لسه بتتقرا من المجلد نفسه */
  }
}

function dirWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.w-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "x");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * السبب البشري لفشل التنزيل — بدون رقم مكتوب: `exitCode: null` كانت بتطرح
 * «خرج بالكود ?» وهي في الحقيقة عملية متقتلة بالسيجنال (متقاس على وايفلّي
 * 2026-11-07T17:17:17Z: ms 6395 · exitCode null · installed 0/12). ولو فيه ملف
 * في vendor/bin من غير صلاحية تنفيذ بنقوله بالاسم، ده تشخيص مش تخمين.
 */
function vendorerReason(x: {
  ok: boolean;
  code: number | null;
  signal: string | null;
  err: string;
  ms: number;
  results: ProvisionRecord["results"];
  unusable: Array<{ name: string; bytes: number }>;
}): string | undefined {
  if (x.ok) return undefined;
  const how = x.signal ? `اتقتل بالسيجنال ${x.signal}` : `خرج بالكود ${x.code ?? "?"}`;
  const tail = x.err ? ` \u00b7 ${x.err.slice(0, 160)}` : "";
  const repair = x.unusable.length
    ? ` \u00b7 كمان فيه ${x.unusable.length} ملف في vendor/bin من غير صلاحية تنفيذ (${x.unusable.map((u) => u.name).join(", ")}) — المحاولة الجاية تصلحه بـchmod`
    : "";
  if (x.code !== 0 || x.signal) {
    return `السكريبت ${how} بعد ${Math.round(x.ms / 1000)} ثانية${tail} \u2014 المحرك هيكمل باللي عندُه.${repair}`;
  }
  return `السكربت مشى بس ولا أداة ماثبتت (${x.results.map((r) => `${r.bin}:${r.status}`).join(", ").slice(0, 220)})`;
}

/** قراءة cgroup v2 ثم v1؛ لو الاتنين مش موجودين بنرجّع null وبنقول السبب. */
function cgroupNum(files: string[], scale = 1): number | null {
  for (const f of files) {
    try {
      const raw = fs.readFileSync(f, "utf8").trim();
      if (!raw || raw === "max") continue;
      const n = Number(raw.split(/\s+/)[0]);
      if (Number.isFinite(n) && n > 0) return Math.round(n / scale);
    } catch {
      /* الملف مش موجود في الـnamespace ده — جرّب اللي بعده */
    }
  }
  return null;
}

function containerResources(): { memLimitMB: number | null; memUsedMB: number | null; cpuQuota: number | null; note: string } {
  const memLimitMB = cgroupNum(["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"], 1048576);
  const memUsedMB = cgroupNum(["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"], 1048576);
  // v2 بيكتب "quota period" في ملف واحد؛ v1 ملفين. `cpuQuota` = عدد الأنوية (مقاس، مش نسبة).
  let cpuQuota: number | null = null;
  try {
    const [quota, period] = fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/);
    if (quota !== "max" && Number(period) > 0) cpuQuota = Math.round((Number(quota) / Number(period)) * 100) / 100;
  } catch {
    const q = cgroupNum(["/sys/fs/cgroup/cpu/cpu.cfs_quota_us"]);
    const p = cgroupNum(["/sys/fs/cgroup/cpu/cpu.cfs_period_us"]);
    if (q && p && q > 0) cpuQuota = Math.round((q / p) * 100) / 100;
  }
  return {
    memLimitMB,
    memUsedMB,
    cpuQuota,
    note: memLimitMB === null ? "مفيش cgroup مقروء — الحدود جوه المُشرف مش جوه الحاوية" : `فاضل ~${Math.max(0, memLimitMB - (memUsedMB ?? 0))}MB من ${memLimitMB}MB`,
  };
}

/** قراءة فقط: مافيش شبكة، مافيش spawn، مافيش كتابة. */
export function toolchainStatus(): ToolchainStatus {
  const dir = vendorDir();
  let files: Array<{ name: string; bytes: number }> = [];
  const unusable: Array<{ name: string; bytes: number }> = [];
  let exists = false;
  try {
    exists = fs.existsSync(dir);
    if (exists) {
      files = fs
        .readdirSync(dir)
        .filter((n) => !n.startsWith("."))
        .map((n) => {
          try {
            const full = path.join(dir, n);
            // نفس شرط اللي بيعدّ الأداة «موجودة» (`findBinary` → X_OK): الملف اللي
            // مفيش فيه صلاحية تنفيذ مش أداة، وهو في نفس الوقت دليل إن التنزيل
            // السابق وقف في نصه — فبيترجّع هنا باسمه وحجمه بدل ما يختفي في «ناقص».
            let exec = true;
            try { fs.accessSync(full, fs.constants.X_OK); } catch { exec = false; }
            const size = fs.statSync(full).size;
            if (!exec && (VENDORABLE as readonly string[]).includes(n)) unusable.push({ name: n, bytes: size });
            return { name: n, bytes: size };
          } catch {
            return { name: n, bytes: 0 };
          }
        });
    }
  } catch {
    files = [];
  }
  const binaries = toolStatus().map((t) => ({ bin: t.bin, present: t.present, where: t.where }));
  const have = new Set(binaries.filter((b) => b.present).map((b) => b.bin));
  return {
    dir,
    exists,
    files,
    unusable,
    present: [...VENDORABLE].filter((b) => have.has(b)),
    missing: [...VENDORABLE].filter((b) => !have.has(b)),
    writable: dirWritable(dir),
    script: findVendorerScript(),
    scriptAvailable: Boolean(findVendorerScript()),
    binaries,
    freeMB: freeMBAt(dir),
    resources: containerResources(),
    wordlist: wordlistInfo(),
    minFreeMB: minFreeMB(),
    last: readRecord(),
  };
}

export interface ProvisionOptions {
  only?: string[];
  timeoutMs?: number;
  /** مسار السكريبت — للتستات؛ الافتراضي هو اللي بيتفسّح من الشجرة */
  script?: string;
  into?: string;
}

/**
 * ينفّذ `fetch-toolchain.mjs` بنفسه، بلا shell، بسقف زمني. بترجّع دايمًا
 * `{ok:true|false}` — مافيش استثناء بيطلع للراوتر، لأن «مافيش أدوات» حالة
 * عادية على استضافة مجانية ولازم تتقال، مش تفجّر الطلب.
 */
export function provisionToolchain(opts: ProvisionOptions = {}): Promise<ProvisionRecord> {
  const t0 = Date.now();
  const into = opts.into ? path.resolve(opts.into) : vendorDir();
  const script = opts.script ?? findVendorerScript();
  const finish = (rec: ProvisionRecord): ProvisionRecord => {
    writeRecord(rec);
    return rec;
  };

  const need = minFreeMB();
  const free = freeMBAt(into);
  if (need > 0 && free !== null && free < need) {
    return Promise.resolve(
      finish({
        at: new Date().toISOString(),
        ok: false,
        exitCode: null,
        ms: 0,
        into,
        installed: 0,
        total: VENDORABLE.length,
        results: [],
        error: "no-space",
        refused: "no-space",
        freeMB: free,
        reasonAr:
          `القرص الفاضل ${free} MB أقل من ${need} MB المطلوبة للتنزيل — مبننزّلش عشان ما نكسرش المكنة.` +
          ` فرّغ مساحة أو ارفع الحد بـNOVA_TOOLCHAIN_MIN_FREE_MB.`,
      }),
    );
  }

  if (!script) {
    return Promise.resolve(
      finish({
        at: new Date().toISOString(),
        ok: false,
        exitCode: null,
        ms: 0,
        into,
        installed: 0,
        total: VENDORABLE.length,
        results: [],
        error: "vendorer-missing",
        reasonAr:
          "سكريبت التنزيل `scripts/fetch-toolchain.mjs` مش جوه الحزمة دي — الحزمة اتبنت قبل ما يتضاف لـbuild-standalone. " +
          "ارفع نسخة جديدة من `nova-24-7.zip`، أو شغّل السكريبت من شجرة المستودع.",
      }),
    );
  }

  const argv = [script, "--into", into, "--json"];
  if (opts.only && opts.only.length) argv.push("--only", opts.only.join(","));
  const timeoutMs = Math.max(30_000, Math.min(Number(opts.timeoutMs) || 540_000, 1_200_000));

  return new Promise((resolve) => {
    // سقف heap للابن = ~60% من حد الحاوية (متقاس: محاولة 17:17:17Z ماتت
    // `exitCode:null · ms 6395` — يعني قتل من الرام مش فشل شبكة). من غير السقف ده
    // V8 بياخد الحد كله والـOOM-killer بيختار الضحية، والرسالة اللي توصلنا «?».
    const res = containerResources();
    const childEnv: Record<string, string | undefined> = { ...process.env };
    if (res.memLimitMB && res.memLimitMB > 0 && res.memLimitMB < 2048 && !process.env.NODE_OPTIONS) {
      // 25% مش 60%: الأب شغال فعلًا بـ~115–167MB RSS على نفس السقف (متقاس من
      // `/api/nova-core/version` 16:01Z و20:32Z)، فالـ60% كانت بتخلي الحساب
      // أبو-160 + أب-150 > 256MB — وده بالظبط القتل اللي شُفناه.
      childEnv.NODE_OPTIONS = `--max-old-space-size=${Math.max(48, Math.min(320, Math.round(res.memLimitMB * 0.25)))}`;
    }
    const child = spawn(process.execPath, argv, { cwd: path.dirname(path.dirname(script)), stdio: ["ignore", "pipe", "pipe"], env: childEnv });
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve(
        finish({
          at: new Date().toISOString(),
          ok: false,
          exitCode: null,
          ms: Date.now() - t0,
          into,
          installed: 0,
          total: VENDORABLE.length,
          results: [],
          error: "provision-timeout",
          reasonAr: `التنزيل ماخلصش في ${Math.round(timeoutMs / 1000)} ثانية — الشبكة بطيئة أو api.github.com ماردّ. المحرك هيكمل استطلاع سلبي من غير أدوات.`,
        }),
      );
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(
        finish({
          at: new Date().toISOString(),
          ok: false,
          exitCode: null,
          ms: Date.now() - t0,
          into,
          installed: 0,
          total: VENDORABLE.length,
          results: [],
          error: "spawn-failed",
          reasonAr: `مافيش قدرة نشغّل السكريبت هنا: ${e.message}`,
        }),
      );
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stNow = toolchainStatus();
      // السكريبت بيطبع JSON واحد في الآخر (و`::warning::` لو فيه فشل جزئي).
      // مابنعدش على شكل الطباعة (مPRETTY أو سطر واحد) — بنلقط آخر كائن JSON
      // متوازن بيرجّع parse ناجح، وده بيشتغل مع أي نسخة من السكربت.
      const parsed = lastJsonObject<{ into?: string; ok?: number; total?: number; results?: ProvisionRecord["results"] }>(out);
      const results = parsed?.results ?? [];
      // `repaired` نجاح مقاس (chmod + اختبار نسخة)، فبيتحسب زي `installed` —
      // ومن غيره الـcache السلبي يفضل says «ناقصة» للأبد.
      const installed = results.filter((r) => r.status === "installed" || r.status === "skipped" || r.status === "repaired").length;
      // من غير كده Cache بتاع findBinary فاضي سلبًا للأبد: الأداة اتنصبت وهي
      // «مش موجودة» في `/api/ops/tools` وفي self-check. التعليق في tools.ts
      // سمّى الحالة دي بالظبط — «a stale negative would keep being reported».
      if (installed > 0) resetBinaryCache();
      // `ok` مش معناها «السكربت مشي» — معناها «فيه أداة صارت في الإيد». الفشل
      // الجزئي بينزل في results والسجل، والراوتر بيرجّع 502 عشان الصفحة ماتبانش
      // خضرا وهي فاضية (نفس المعيار اللي على الردود التانية).
      const ok = code === 0 && Boolean(parsed) && installed > 0;
      resolve(
        finish({
          at: new Date().toISOString(),
          ok,
          exitCode: code,
          ms: Date.now() - t0,
          into: parsed?.into ?? into,
          installed,
          total: parsed?.total ?? VENDORABLE.length,
          results,
          error: ok ? undefined : "vendorer-failed",
          reasonAr: vendorerReason({ ok, code, signal, err, ms: Date.now() - t0, results, unusable: stNow.unusable }),
          ran: code === 0 && Boolean(parsed),
        }),
      );
    });
  });
}

/** آخر كائن JSON متوازن في النص (بيتحمل سطر واحد أو مُنسّق، ومعاه سطور لوج قبله). */
export function lastJsonObject<T>(text: string): T | null {
  let best: T | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inStr: string | null = null;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = c;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          const slice = text.slice(i, j + 1);
          try {
            best = JSON.parse(slice) as T; // آخر واحد بيمرّس هو اللي بناخده
          } catch {
            /* مش JSON — كمّل */
          }
          i = j;
          break;
        }
      }
    }
  }
  return best;
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/* ── نسخة المحرك: single-flight + منطق «خلاص اتعملت» ─────────────────────────
 * الشات على الهَب مفتوح للعامة، فمهماشة كل رسالة «ثبّت nmap» تنزّل 100 MB.
 * القواعد كلها مقاسة على القرص، ومافيش رقم بيتخمن:
 *   • فيه أداة واحدة موجودة → مافيش داعي، بنرجّع الحالة الحالية.
 *   • آخر محاولة فشلت → فترة انتظار (NOVA_TOOLCHAIN_RETRY_MS،الافتراضي 10 دقايق)
 *     بنفس السبب المسجل، بدل إعادة تجربة شبكة ميتة.
 *   • محاولة شغالة دلوقتي → بنستناها (مافيش تنزيلين في نفس الوقت). */
let inflight: Promise<ProvisionRecord> | null = null;

export interface OnceResult {
  record: ProvisionRecord | null;
  status: ToolchainStatus;
  /** null = اتنفذت فعلًا. غير كده دي السبب، ومسجل في status.last. */
  skipped: "already-present" | "cooldown" | "no-space" | null;
}

export async function provisionToolchainOnce(opts: ProvisionOptions = {}): Promise<OnceResult> {
  const st0 = toolchainStatus();
  // «اليدوه موجودة» ما تعفيش من تكملة الناقص: القياس على وايفلّي present:3 /
  // missing:9 + 3 ملفات من غير X_OK، والصف القديم كان بيرجع already-present
  // فأي محاولة من المحرك تضيف أداة كانت تتخطّى في الصمت.
  if (st0.present.length > 0 && st0.missing.length === 0 && st0.unusable.length === 0 && !(opts.only && opts.only.length)) {
    return { record: null, status: st0, skipped: "already-present" };
  }
  const cooldownMs = Math.max(0, Number(process.env.NOVA_TOOLCHAIN_RETRY_MS ?? 600_000));
  if (st0.last && !st0.last.ok && cooldownMs > 0) {
    const age = Date.now() - Date.parse(st0.last.at);
    if (Number.isFinite(age) && age >= 0 && age < cooldownMs) return { record: st0.last, status: st0, skipped: "cooldown" };
  }
  if (inflight) return { record: await inflight, status: toolchainStatus(), skipped: null };
  inflight = provisionToolchain(opts).finally(() => {
    inflight = null;
  });
  const record = await inflight;
  return { record, status: toolchainStatus(), skipped: record.refused ?? null };
}

/**
 * محاولة صامتة وقت الإقلاع: `NOVA_TOOLCHAIN_FETCH=1` دايمًا، و`auto` لمّا يبقى
 * فيه أداة ناقصة (وفوق 1.5GB حر على القرص). على مكنة مُشرَفة `auto` هو الافتراضي. مابتستناش الرد — الحاوية المجانية لازم تخدم
 * حالاً، والقياس بيبان في `/api/ops/tools` أول ما يخلص.
 */
/** `fs.statfsSync` بيرجع bsize/bavail؛ لو الـAPI مش موجود نرجّع null وما نمنعش. */
function freeDiskMB(at: string): number | null {
  try {
    const fst = fs.statfsSync(at || process.cwd());
    return Math.round((fst.bsize * fst.bavail) / 1048576);
  } catch {
    return null;
  }
}

export function bootToolchainFetch(log?: (msg: string) => void): boolean {
  let mode = String(process.env.NOVA_TOOLCHAIN_FETCH || "").trim().toLowerCase();
  // الافتراضي وقت الإقلاع بقى «مفيش تنزيل» — والقيااس اللي خلّاني أرجع الخطوة دي
  // مش حذر نظري: أول مكنة فعّلت `auto` على الحزمة اللي فيها مرآة 219MB دخلت في
  // حلقة إعادة تشغيل من ~20:41Z (كل وجهاء اللوحة رجّعت 502، والـupdater جوه
  // التطبيق فمافيش مخرج ذاتي). في حاوية 256MB RAM، تنزيل+فك 219MB والتطبيق
  // رافع ~160MB RSS مع بعض = المُشرف بيقول «App exited».
  // فالقرار: `auto` يفضل متاح ومقيس، بس بموافقة صريحة — `NOVA_TOOLCHAIN_FETCH=1`
  // (أو =auto)، أو `POST /api/ops/tools/provision`. اللي فاعله ده هو اللي بيقول
  // «الرام عندنا تتحمل»، مش أنا.
  if (!mode && isDurableHost() && process.env.NOVA_TOOLCHAIN_AT_BOOT === "1") mode = "auto";
  if (!mode || mode === "0" || mode === "off" || mode === "false") return false;
  const st = toolchainStatus();
  // `auto` مع الناقص: لو فيه أداة ناقصة ننزّلها، مابنقفش عند أول واحدة موجودة.
  if (mode === "auto" && st.missing.length === 0) return false;
  // حارس القرص: ~100MB تنزيل على حاوية مجانية بتطرح نفسها لما الديسك يخلص
  // (متقاس 2026-11-07: النسخ الاحتياطية أكلت 8GB والمكنة وقعت). تحت 1.5GB حر
  // مابننزّلش، وبنقول السبب بدل الصمت.
  // حارس الرام: التحميل نفسه streaming، بس الأب (التطبيق) والابن (المنزّل)
  // بيتقاسمون سقف cgroup واحد — والقيااس 20:41Z كان كافيًا يوضح إن ده مش تفصيل.
  if (mode === "auto" || mode === "1") {
    const res = containerResources();
    if (res.memLimitMB !== null && res.memUsedMB !== null && res.memLimitMB - res.memUsedMB < 200) {
      log?.(`toolchain: فاضي من الرام ${res.memLimitMB - res.memUsedMB}MB من ${res.memLimitMB}MB — التنزيل التلقائي اتخطّى (NOVA_TOOLCHAIN_FETCH=1 للتجاوز)`);
      return false;
    }
  }
  if (mode === "auto") {
    const freeMB = freeDiskMB(st.dir);
    if (freeMB !== null && freeMB < 1500) {
      log?.(`toolchain: القرص الحر ${freeMB}MB أقل من 1500MB — التنزيل التلقائي اتخطّى (NOVA_TOOLCHAIN_FETCH=1 للتجاوز)`);
      return false;
    }
  }
  if (!st.scriptAvailable) {
    log?.("NOVA_TOOLCHAIN_FETCH مفعّل بس السكريبت مش في الحزمة — تخطّيت");
    return false;
  }
  if (!st.writable) {
    log?.(`NOVA_TOOLCHAIN_FETCH مفعّل بس ${st.dir} مش قابل للكتابة — تخطّيت`);
    return false;
  }
  void provisionToolchain().then((rec) => {
    log?.(rec.ok ? `toolchain: ${rec.installed}/${rec.total} جاهزة في ${rec.into}` : `toolchain: فشل — ${rec.reasonAr || rec.error}`);
  });
  return true;
}
