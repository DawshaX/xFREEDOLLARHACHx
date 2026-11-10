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
import { readdirSync, statSync, unlinkSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
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
  /** نسخ الرول-باك (كل تحديث ذاتي + إنقاذ المُشرف بتسيّب نسخة كاملة) */
  backups: { dirs: number; bytes: number };
  /** بقايا الإنقاذ في /tmp (الأرشيف المفكوك قبل الاستبدال) */
  tmpNova: { dirs: number; bytes: number };
  /** لوجات الحالة + auto-update.log */
  logs: { files: number; bytes: number };
  /** كاش trivy (~/.cache/trivy) — قاعدته بتتحدّث دوريًا وبتتضخ */
  trivyCache: { bytes: number };
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

function backupDirs(): Array<{ path: string }> {
  const found: Array<{ path: string }> = [];
  for (const root of [join(stateRoot(), "backups"), "/tmp"]) {
    try {
      for (const name of readdirSync(root, { withFileTypes: true })) {
        if (name.isDirectory() && name.name.startsWith("nova-backup-")) found.push({ path: join(root, name.name) });
      }
    } catch { /* الجذر مش موجود */ }
  }
  return found;
}

function tmpResidue(): Array<{ path: string }> {
  const found: Array<{ path: string }> = [];
  try {
    for (const name of readdirSync("/tmp", { withFileTypes: true })) {
      if (name.name.startsWith("nova-rescue-") || name.name.startsWith("nova-backup-")) {
        found.push({ path: join("/tmp", name.name) });
      }
    }
  } catch { /* /tmp مش مقروء */ }
  return found;
}

export function measureStateFootprint(): Footprint {
  const jobs = dirBytes(jobsDir());
  const vendor = dirBytes(join(stateRoot(), "vendor", "bin"));
  const stateJson = dirBytes(join(stateRoot(), "state"));
  // القياس الكامل لأماكن الامتلاء المعروفة: النسخ، بقايا /tmp، اللوجات، كاش trivy.
  const backups = { dirs: 0, bytes: 0 };
  for (const b of backupDirs()) { backups.dirs += 1; backups.bytes += dirBytes(b.path).bytes; }
  const tmpNova = { dirs: 0, bytes: 0 };
  for (const t of tmpResidue()) { tmpNova.dirs += 1; tmpNova.bytes += t.path.endsWith(".zip") ? (() => { try { return statSync(t.path).size; } catch { return 0; } })() : dirBytes(t.path).bytes; }
  const logs = { files: 0, bytes: 0 };
  for (const d of [join(stateRoot(), "logs"), join(stateRoot(), "state")]) {
    try {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isFile() && (f.name.endsWith(".log"))) {
          const lv = dirBytes(join(d, f.name));
          logs.files += lv.files; logs.bytes += lv.bytes;
        }
      }
    } catch { /* مفيش لوجات */ }
  }
  const home = process.env.HOME || "/home/container";
  const trivyCache = { bytes: dirBytes(join(home, ".cache", "trivy")).bytes };
  return {
    root: stateRoot(),
    jobs,
    vendorBinMB: Math.round(vendor.bytes / 1048576),
    stateJsonBytes: stateJson.bytes,
    backups, tmpNova, logs, trivyCache,
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

  // ── طبقة 2: النسخ الاحتياطية — الـwatchdog محتاج آخر واحدة بس عشان يرجّع.
  const bks = backupDirs().sort((a, b) => a.path.localeCompare(b.path));
  for (const old of bks.slice(0, -1)) {
    const sz = dirBytes(old.path).bytes;
    try { rmSync(old.path, { recursive: true, force: true }); removed += 1; freedBytes += sz; } catch { /* متحرك */ }
  }
  // ── طبقة 3: بقايا الإنقاذ في /tmp — بعد الاستبدال + الخروج مابلهمش لازمة أبدًا.
  for (const t of tmpResidue()) {
    try {
      const st = statSync(t.path);
      // أقدم من يوم بس — كوشن أمان لو إنقاذ شغال في نفس اللحظة
      if (now - st.mtimeMs < 86400_000) continue;
      const sz = st.isDirectory() ? dirBytes(t.path).bytes : st.size;
      rmSync(t.path, { recursive: true, force: true });
      removed += 1; freedBytes += sz;
    } catch { /* اتشال */ }
  }
  // ── طبقة 4: اللوج فوق 5MB يتقصّ لآخر 1MB — مابيتراكمش للأبد.
  for (const d of [join(stateRoot(), "logs"), join(stateRoot(), "state")]) {
    try {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (!f.isFile() || !f.name.endsWith(".log")) continue;
        const lp = join(d, f.name);
        const st = statSync(lp);
        if (st.size > 5 * 1024 * 1024) {
          const fd = readFileSync(lp);
          writeFileSync(lp, fd.subarray(Math.max(0, fd.length - 1024 * 1024)));
          removed += 1; freedBytes += st.size - Math.min(st.size, 1024 * 1024);
        }
      }
    } catch { /* مفيش */ }
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
