/**
 * state-prune — تخزين المكنة مش وعاء بلا قاعة.
 *
 * الواقع المقاس (waifly free): قرص 1024MB، والـstate بيجمع أدلة jobs وملفات،
 * و«بقت مساحة» = مشكلة إنتاج مش والله. القاعدة الثابتة: كل مقياس هنا إما فعلي
 * (قُرأ من القرص) أو مُعلَن «ماقسنا». مفيش ملف بيتمسح من غير سياسة معلنة:
 *  · jobs/ الأدلة: بتحتفظ بآخر KEEP_JOBS مهام أو الجديد خلال KEEP_DAYS يوم (أيهما أكبر).
 *  · أي ملف غير معروف = ماتمسّوش. بس اللي تحت jobs/ القديم هو اللي بيتمشى.
 *  · التقارير للسطح: bytes وعدّادات و«آخر تنظيف» — مش «مسحنا» كلامًا.
 */
import { readdirSync, statSync, unlinkSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const stateRoot = () => process.env.NOVA_STATE_ROOT || "/home/container";
const jobsDir = () => join(stateRoot(), "state", "jobs");
const recordPath = () => join(stateRoot(), "state", "state-prune.json");
const keepJobs = () => Number(process.env.NOVA_STATE_KEEP_JOBS || 400);
const keepDays = () => Number(process.env.NOVA_STATE_KEEP_DAYS || 14);

export interface Footprint {
  root: string;
  jobs: { files: number; bytes: number; oldestMs: number | null };
  vendorBinMB: number;
  stateJsonBytes: number;
  measuredAt: string;
}

function dirBytes(dir: string): { files: number; bytes: number; oldestMs: number | null } {
  let files = 0, bytes = 0, oldestMs: number | null = null;
  try {
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop()!;
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, f.name);
        try {
          if (f.isDirectory()) stack.push(p);
          else if (f.isFile()) {
            const st = statSync(p);
            files += 1; bytes += st.size;
            if (oldestMs === null || st.mtimeMs < oldestMs) oldestMs = st.mtimeMs;
          }
        } catch { /* اتنقل وهو بيقرا */ }
      }
    }
  } catch { /* غير موجود = فاضي مش غلط */ }
  return { files, bytes, oldestMs };
}

export function measureStateFootprint(): Footprint {
  const jobs = dirBytes(jobsDir());
  const vendor = dirBytes(join(stateRoot(), "vendor", "bin"));
  const stateJson = dirBytes(join(stateRoot(), "state"));
  return {
    root: stateRoot(),
    jobs,
    vendorBinMB: Math.round(vendor.bytes / 1048576),
    stateJsonBytes: stateJson.bytes,
    measuredAt: new Date().toISOString(),
  };
}

export interface PruneReport {
  ok: boolean;
  removed: number;
  freedBytes: number;
  kept: number;
  policy: { keepJobs: number; keepDays: number };
  at: string;
  measured: Footprint;
}

export function pruneState(now = Date.now()): PruneReport {
  const KEEP_JOBS = keepJobs(), KEEP_DAYS = keepDays();
  const cutoff = now - KEEP_DAYS * 86400_000;
  let removed = 0, freedBytes = 0;
  let entries: Array<{ path: string; mtime: number; size: number }> = [];
  try {
    entries = readdirSync(jobsDir(), { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => { const st = statSync(join(jobsDir(), d.name)); return { path: join(jobsDir(), d.name), mtime: st.mtimeMs, size: st.size }; })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { /* المجلد لسه مش موجود */ }

  const survivors = entries.slice(0, KEEP_JOBS);
  const protectedSet = new Set(survivors.map((e) => e.path));
  for (const e of entries) {
    if (protectedSet.has(e.path)) continue;
    if (e.mtime >= cutoff) continue; // حديث أو في آخر KEEP_JOBS = باقي
    try { unlinkSync(e.path); removed += 1; freedBytes += e.size; } catch { /* اتقفل */ }
  }

  const kept = entries.length - removed;
  const report: PruneReport = {
    ok: true, removed, freedBytes, kept,
    policy: { keepJobs: KEEP_JOBS, keepDays: KEEP_DAYS },
    at: new Date().toISOString(),
    measured: measureStateFootprint(),
  };
  try {
    mkdirSync(join(stateRoot(), "state"), { recursive: true });
    const tmp = recordPath() + "." + process.pid + ".tmp";
    writeFileSync(tmp, JSON.stringify(report, null, 2));
    renameSync(tmp, recordPath());
  } catch { /* إبلاغ سجل مش شرط حياة */ }
  return report;
}

/** آخر تنظيف مسجل — لو مفيش قلنا لم يتم قط بصراحة */
export function lastPrune(): PruneReport | null {
  try { return JSON.parse(readFileSync(recordPath(), "utf8")) as PruneReport; } catch { return null; }
}
