/**
 * tool-ondemand — الأدوات بتيجي عند الطلب، والكاش بيتدوّر مش بيتقلّم.
 * ────────────────────────────────────────────────────────────────────────────
 * المشكلة اللي حلّها الملف ده (مقاسة على مكنة وايفي 2026-11-08): كوتا القرص
 * 1.5GB والـ16 أداة ~700MB بعد فك الضغط. حارس «المساحة الفاضلة» (statfs) بيقيس
 * قرص المضيف (99GB) فمش شايف الكوتا أصلًا — يعني أي سقف مبني عليه وهمي. والحل
 * القديم «قلّل الليستا» كان بيحجّم البرنامج، والبرنامج ملوش تحجيم.
 *
 * النموذج الجديد: أداة مش موجودة على الديسك ≠ أداة مش موجودة في البرنامج.
 * أول ما مسار تنفيذ يحتاج أداة غايبة، بنجيبها هي بس (--only) من مرآة الريليز،
 * وقبل التنزيل بنوسّع مكانها بنضّف الأقدم استخدامًا (LRU) لحد سقف الكاش. لو
 * التنزيل ولاّع ENOSPC (اللوحة بتقفل الكتابة عند الكوتا) بنفضّي أكتر ونجرب
 * تاني — كوتا حاضرة من غير ما statfs يشوفها.
 *
 * القفلات:
 *   NOVA_TOOLCHAIN_ONDEMAND=0     يلغي الجلب عند الطلب (يرجع لـ«tool-missing»)
 *   NOVA_VENDOR_CACHE_MB=512      سقف كاش الأدوات بالميغا؛ 0 = مفيش إخلاء
 *   NOVA_ONDEMAND_FETCH_TIMEOUT_MS=180000   مهلة تنزيل الأداة الواحدة
 *   NOVA_FETCH_TOOLCHAIN_SCRIPT   تجاوز مسار السكربت (هوك الاختبارات)
 *
 * مفيش spawnSync هنا: تنزيل الأداة دقايق، ولو قفلنا الـevent loop اللوحة
 * هتشوف السيرفر ميت وتعمله restart. وedelete لملف شغّال آمن على لينكس —
 * العملية الجارية بتكمّل على الـinode، واللي بعدها بيلاقي نسخة جديدة.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { findBinary, clearBinaryCache } from "./tools";
import { findVendorerScript, VENDORABLE } from "./toolchain";

const execFileP = promisify(execFile);
const VENDORABLE_SET = new Set<string>(VENDORABLE as readonly string[]);

/** تنزيل واحد بس للأداة الواحدة مهما اتطلبت بالتوازي — نفس الـpromise. */
const inflight = new Map<string, Promise<string | null>>();

function ondemandEnabled(): boolean {
  return String(process.env.NOVA_TOOLCHAIN_ONDEMAND ?? "1").trim() !== "0";
}

/** سقف الكاش بالبايت. الكسر مسموح (الاختبارات بتحط قيم صغيرة). 0 = بلا إخلاء. */
export function vendorCacheCeilingBytes(): number {
  const mb = Number.parseFloat(String(process.env.NOVA_VENDOR_CACHE_MB ?? "512"));
  if (!Number.isFinite(mb) || mb <= 0) return 0;
  return Math.round(mb * 1048576);
}

/** مجلدات الـvendor بنفس أولوية findBinary: NOVA_TOOL_DIR أولًا وبعدها الرئيسي. */
function vendorDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.NOVA_TOOL_DIR) dirs.push(...process.env.NOVA_TOOL_DIR.split(path.delimiter).filter(Boolean));
  dirs.push(process.env.NOVA_VENDOR_BIN ? path.resolve(process.env.NOVA_VENDOR_BIN) : path.resolve(process.cwd(), "vendor/bin"));
  return dirs.map((d) => path.resolve(d)).filter((d, i, a) => a.indexOf(d) === i);
}

function primaryVendorDir(): string {
  return vendorDirs()[0];
}

function dirBytes(dir: string): number {
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      try { n += fs.statSync(path.join(dir, f)).size; } catch { /* ملف طار وإحنا بنعد */ }
    }
  } catch { /* المجلد مش موجود أصلًا */ }
  return n;
}

function totalVendorBytes(): number {
  return vendorDirs().reduce((s, d) => s + dirBytes(d), 0);
}

interface CacheEntry { bin: string; file: string; bytes: number; usedAt: number }

/** ملفات الأدوات القابلة للإخلاء: اسمها من ليستا VENDORABLE بس — المانيفست وأي حاجة تانية مش متقاسة. */
function cacheEntries(exceptBin: string): CacheEntry[] {
  const out: CacheEntry[] = [];
  for (const dir of vendorDirs()) {
    for (const bin of VENDORABLE_SET) {
      if (bin === exceptBin) continue;
      const file = path.join(dir, bin);
      try {
        const st = fs.statSync(file);
        if (!st.isFile()) continue;
        // atime بتتحرك مع كل spawn — دي «آخر استخدام فعلي»، وmtime احتياطي لما
        // المضيف مانتب noatime.
        out.push({ bin, file, bytes: st.size, usedAt: Math.max(st.atimeMs, st.mtimeMs) });
      } catch { /* مش هنا */ }
    }
  }
  return out.sort((a, b) => a.usedAt - b.usedAt);
}

/**
 * إخلاء LRU لحد ما الكاش ينزل تحت السقف (أو لحد ميفضلش غير الأداة المعفاة).
 * بيرجع عدد الملفات اللي اتمسحت. السقف 0 = مفيش إخلاء خالص.
 */
export function evictVendorCache(exceptBin = ""): number {
  const ceiling = vendorCacheCeilingBytes();
  if (ceiling <= 0) return 0;
  let removed = 0;
  let total = totalVendorBytes();
  if (total <= ceiling) return 0;
  for (const e of cacheEntries(exceptBin)) {
    if (total <= ceiling) break;
    try {
      fs.rmSync(e.file, { force: true });
      total -= e.bytes;
      removed += 1;
    } catch { /* مقروء-بس؟ نعدّيه ونكمّل */ }
  }
  if (removed > 0) clearBinaryCache(); // الكاش الموجب كان بيشاور على ملفات اتمسحت
  return removed;
}

function fetchScriptPath(): string | null {
  const override = String(process.env.NOVA_FETCH_TOOLCHAIN_SCRIPT ?? "").trim();
  if (override) return path.resolve(override);
  return findVendorerScript();
}

async function fetchOne(bin: string): Promise<string | null> {
  const script = fetchScriptPath();
  if (!script) return null;
  const into = primaryVendorDir();
  try { fs.mkdirSync(into, { recursive: true }); } catch { /* لو مش قادر ننشئ، التنزيل هو اللي هيقول */ }
  evictVendorCache(bin); // وسّع قبل ما تنزّل — التوسعة بعد امتلاء القرص متأخر جدًا
  const timeoutMs = Math.max(15_000, Number(process.env.NOVA_ONDEMAND_FETCH_TIMEOUT_MS) || 180_000);
  const run = () => execFileP(process.execPath, [script, "--into", into, "--only", bin], { timeout: timeoutMs });
  try {
    await run();
  } catch (first: unknown) {
    const msg = String((first as { stderr?: string; message?: string })?.stderr || (first as Error)?.message || first);
    if (!/ENOSPC|no space left/i.test(msg)) return null;
    // الكوتا قفلت في نص التنزيل: فضّي لأقصى درجة (السقف بيتخطّى مؤقتًا) وجرب آخر مرة.
    for (const e of cacheEntries(bin)) { try { fs.rmSync(e.file, { force: true }); } catch { /* كمل */ } }
    clearBinaryCache();
    try { await run(); } catch { return null; }
  }
  clearBinaryCache();
  return findBinary(bin);
}

/**
 * «الأداة دي موجودة فين؟» — موجودة → المسار؛ غايبة → نجيبها من المرآة أول مرة
 * ونرجّع مسارها؛ تعذّرت → null والطالب يقول الحقيقة («tool-missing») زي قبل.
 * مابترميش أبدًا، ومابتنزّلش حاجة مش من ليستا الأدوات القابلة للبيع (VENDORABLE).
 */
export function ensureToolBinary(bin: string): Promise<string | null> {
  const now = findBinary(bin);
  if (now) return Promise.resolve(now);
  if (!ondemandEnabled()) return Promise.resolve(null);
  if (!VENDORABLE_SET.has(bin)) return Promise.resolve(null);
  const pending = inflight.get(bin);
  if (pending) return pending;
  const p = fetchOne(bin).finally(() => inflight.delete(bin));
  inflight.set(bin, p);
  return p;
}

/** صورة صغيرة للتشخيص: حجم الكاش والسقف وهل الجلب عند الطلب شغال. */
export function ondemandStatus(): Record<string, unknown> {
  return {
    enabled: ondemandEnabled(),
    cacheCeilingMB: Math.round(vendorCacheCeilingBytes() / 1048576),
    cacheMB: Math.round(totalVendorBytes() / 1048576),
    dirs: vendorDirs(),
    script: fetchScriptPath(),
  };
}
