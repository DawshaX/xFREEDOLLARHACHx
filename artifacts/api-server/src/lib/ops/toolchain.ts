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
import path from "node:path";
import { spawn } from "node:child_process";
import { resetBinaryCache, toolStatus } from "./tools";

/** الأدوات اللي السكريبت بيقدر يجيبها — لازم تفضل مطابقة لـ`fetch-toolchain.mjs`. */
export const VENDORABLE = ["subfinder", "httpx", "nuclei", "katana", "dnsx", "naabu", "ffuf"] as const;

export interface ToolchainStatus {
  /** المجلد اللي بنحط فيه (vendor/bin، أو NOVA_VENDOR_BIN) */
  dir: string;
  exists: boolean;
  /** الملفات الموجودة فعلًا وحجمها — مش قائمة أمنية */
  files: Array<{ name: string; bytes: number }>;
  present: string[];
  missing: string[];
  writable: boolean;
  /** مسار السكريبت اللي بينفّذ التنزيل، ولو مش في الحزمة يبقى null */
  script: string | null;
  scriptAvailable: boolean;
  /** إيه اللي قالته الأدوات نفسها (findBinary) — المصدر الوحيد ل«موجود» */
  binaries: Array<{ bin: string; present: boolean; where: string | null }>;
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

/** قراءة فقط: مافيش شبكة، مافيش spawn، مافيش كتابة. */
export function toolchainStatus(): ToolchainStatus {
  const dir = vendorDir();
  let files: Array<{ name: string; bytes: number }> = [];
  let exists = false;
  try {
    exists = fs.existsSync(dir);
    if (exists) {
      files = fs
        .readdirSync(dir)
        .filter((n) => !n.startsWith("."))
        .map((n) => {
          try {
            return { name: n, bytes: fs.statSync(path.join(dir, n)).size };
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
    present: [...VENDORABLE].filter((b) => have.has(b)),
    missing: [...VENDORABLE].filter((b) => !have.has(b)),
    writable: dirWritable(dir),
    script: findVendorerScript(),
    scriptAvailable: Boolean(findVendorerScript()),
    binaries,
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
    const child = spawn(process.execPath, argv, { cwd: path.dirname(path.dirname(script)), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
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
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // السكريبت بيطبع JSON واحد في الآخر (و`::warning::` لو فيه فشل جزئي).
      // مابنعدش على شكل الطباعة (مPRETTY أو سطر واحد) — بنلقط آخر كائن JSON
      // متوازن بيرجّع parse ناجح، وده بيشتغل مع أي نسخة من السكربت.
      const parsed = lastJsonObject<{ into?: string; ok?: number; total?: number; results?: ProvisionRecord["results"] }>(out);
      const results = parsed?.results ?? [];
      const installed = results.filter((r) => r.status === "installed" || r.status === "skipped").length;
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
          reasonAr: ok
            ? undefined
            : code !== 0
              ? `السكريبت خرج بالكود ${code ?? "?"}${err ? ` · ${err.slice(0, 160)}` : ""} — المحرك هيكمل باللي عندُه.`
              : `السكربت مشى بس ولا أداة ماثبتت (${results.map((r) => `${r.bin}:${r.status}`).join(", ").slice(0, 220)})`,
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
  skipped: "already-present" | "cooldown" | null;
}

export async function provisionToolchainOnce(opts: ProvisionOptions = {}): Promise<OnceResult> {
  const st0 = toolchainStatus();
  if (st0.present.length > 0 && !(opts.only && opts.only.length)) {
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
  return { record, status: toolchainStatus(), skipped: null };
}

/**
 * محاولة صامتة وقت الإقلاع: `NOVA_TOOLCHAIN_FETCH=1` دايمًا، و`auto` بس لو
 * مافيش حاجة في `vendor/bin`. مابتستناش الرد — الحاوية المجانية لازم تخدم
 * حالاً، والقياس بيبان في `/api/ops/tools` أول ما يخلص.
 */
export function bootToolchainFetch(log?: (msg: string) => void): boolean {
  const mode = String(process.env.NOVA_TOOLCHAIN_FETCH || "").trim().toLowerCase();
  if (!mode || mode === "0" || mode === "off" || mode === "false") return false;
  const st = toolchainStatus();
  if (mode === "auto" && st.present.length > 0) return false;
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
