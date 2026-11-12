/**
 * state-backup — «مافيش حاجة بتتخزن على السيرفر» بقى جملة مقاسة مش وعد.
 *
 * الواقع المقاس (waifly, 2026-11-11): القرص حصة 1.5GiB، امتلأ 1.61 والديمون
 * رفض التشغيل. وبعد التنضيف بقى على القرص 3 أنواع بس:
 *   1. vendor/bin (81MB) — كاش أدوات، مصدره شبكة الإصدارات، بيتعاد تنزيله.
 *   2. state/vuln-corpus (34MB مضغوط) — كاش، مصدره release `vuln-corpus` على
 *      GitHub أصلًا، والعقدة بتنزّله لو مش موجود.
 *   3. state/ الباقي (~7MB): ذاكرة، برامج، سجلات، إعدادات — **دي اللي بتتفقد**
 *      لو الكونتينر اتمسح، ودي اللي الملف ده بيظلها على GitHub كل ربع ساعة.
 *
 * الذاكرة والإعدادات الحرجة عندها Supabase Edge أصلًا (القناة الأساسية) —
 * النسخة دي حزام ثاني شامل للذاكرة + البرامج + الجوبز + السجلات، من غير ما
 * نحوّل السيرفر لقاعدة بيانات: GitHub Releases بتستضيف ملف zip واحد بنتجدد.
 *
 * القرار مبني على قياس مش تخمين: التوكن موجود بس لو NOVA/البيئة جابت
 * GITHUB_TOKEN (نفس اللي الريبو بيستخدمه للبحث) — من غيره بنقول «مفعّل لأ»
 * بصراحة مش بنمثّل نجاح.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger";

const REPO = process.env.NOVA_RELEASE_REPO || "DawshaX/xFREEDOLLARHACHx";
const TAG = process.env.NOVA_STATE_BACKUP_TAG || "nova-state";
const ASSET = "state.zip";
const stateRoot = () => process.env.NOVA_STATE_ROOT || "/home/container";
const stateDir = () => join(stateRoot(), "state");
/** كاشات مش بنضمّها للنسخة: مصدرها GitHub/الشبكة أصلًا وبترجع لوحدها. */
const SKIP_IN_ZIP = new Set(["vuln-corpus", "vuln-corpus-index.json", ".nova-restart", ".update-pending", ".update-failed"]);

const token = (): string => (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
const backupEnabled = (): boolean => token().length > 0;

interface BackupState {
  enabled: boolean;
  lastBackupAt: string | null;
  lastBackupBytes: number | null;
  lastBackupFiles: number | null;
  lastRestoreAt: string | null;
  lastRestoreFiles: number | null;
  lastResult: "ok" | "failed" | "never" | null;
  lastError: string | null;
}
const recordPath = () => join(stateDir(), "state-github-backup.json");
export function stateBackupInfo(): BackupState {
  try {
    const doc = JSON.parse(readFileSync(recordPath(), "utf8")) as BackupState;
    return { ...doc, enabled: backupEnabled() };
  } catch {
    return { enabled: backupEnabled(), lastBackupAt: null, lastBackupBytes: null, lastBackupFiles: null, lastRestoreAt: null, lastRestoreFiles: null, lastResult: null, lastError: null };
  }
}
function writeRecord(patch: Partial<BackupState>): void {
  try {
    const cur = stateBackupInfo();
    const next = { ...cur, ...patch, enabled: backupEnabled() };
    mkdirSync(stateDir(), { recursive: true });
    const tmp = recordPath() + "." + process.pid + ".tmp";
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, recordPath());
  } catch { /* السجل مش شرط حياة */ }
}

/** api.github.com call مع التوكن لو موجود. */
async function gh(pathname: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "nova-state-backup",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  return fetch(`https://api.github.com${pathname}`, { ...init, headers });
}

/** zip/unzip عبر python3 — الموجود فعلاً على المكنة (live-update بيشتغل بيه). */
function py(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const cp = spawn("python3", args, { stdio: "ignore" });
    cp.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("python3 exit " + c))));
    cp.on("error", reject);
  });
}

/** كل ملفات state/ المستحقة (من غير الكاشات) — فرعي ومتكرر. */
function collectFiles(dir: string, base: string, out: Array<{ rel: string; path: string }>): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (base === "" && SKIP_IN_ZIP.has(e.name)) continue;
    const rel = base ? base + "/" + e.name : e.name;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (rel !== "jobs" || true) collectFiles(p, rel, out); }
    else if (e.isFile() && !e.name.endsWith(".tmp")) out.push({ rel, path: p });
  }
}

/** تنزيل أحدث asset مباشرة (بلا API) — اللينك مستقر زي ما auto-update علّمنا. */
async function downloadAsset(): Promise<Buffer | null> {
  const url = process.env.NOVA_STATE_BACKUP_URL || `https://github.com/${REPO}/releases/download/${TAG}/${ASSET}`;
  const headers: Record<string, string> = { "User-Agent": "nova-state-backup" };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(url, { redirect: "follow", headers, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

let running = false;

/** نسخة واحدة من «رفّع state/ النظيفة على GitHub». آمنة تتنده من تايمر ومن endpoint. */
export async function backupStateToGithub(): Promise<{ ok: boolean; bytes: number; files: number; detail: string }> {
  if (!backupEnabled()) return { ok: false, bytes: 0, files: 0, detail: "GITHUB_TOKEN مش موجود — النسخ لسه مش مفعّل (الذاكرة نفسها على Supabase شغالة)" };
  if (running) return { ok: true, bytes: 0, files: 0, detail: "في نسخة شغالة دلوقتي — متكررش" };
  running = true;
  const t0 = Date.now();
  const tmpZip = `/tmp/nova-state-${process.pid}-${Date.now()}.zip`;
  try {
    const files: Array<{ rel: string; path: string }> = [];
    try { collectFiles(stateDir(), "", files); } catch { /* state لسه مفيش */ }
    if (files.length === 0) return { ok: false, bytes: 0, files: 0, detail: "state/ فاضية — مفيش حاجة تتنسخ" };
    // zip حقيقي (deflate) — قائمة الملفات من stdin عشان المسارات العربية/المسافات
    const list = files.map((f) => f.rel).join("\n");
    await new Promise<void>((resolve, reject) => {
      const cp = spawn(
        "python3",
        ["-c",
          "import sys,zipfile,os\nbase=sys.argv[1]; out=sys.argv[2]\nwith zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n  for rel in sys.stdin.read().splitlines():\n    if rel: z.write(os.path.join(base,rel),rel)\n",
          stateDir(), tmpZip],
        { stdio: ["pipe", "ignore", "ignore"] },
      );
      cp.stdin.on("error", () => { /* EPIPE لو بايثون خرج بدري */ });
      cp.stdin.end(list);
      cp.on("exit", (c: number | null) => (c === 0 ? resolve() : reject(new Error("zip exit " + c))));
      cp.on("error", reject);
    });
    const bytes = statSync(tmpZip).size;
    // الريليز نفسه: موجود؟ اعمله. (أول مرة بس)
    const rel = await gh(`/repos/${REPO}/releases/tags/${TAG}`);
    let release: { id: number; upload_url: string } | null = null;
    if (rel.ok) release = (await rel.json()) as { id: number; upload_url: string };
    else {
      const mk = await gh(`/repos/${REPO}/releases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_name: TAG, name: "NOVA state backup (auto)", body: "نسخة حالة حيّة بتتجدد كل 15 دقيقة من العقدة — محتويات state/ النظيفة.", draft: false, prerelease: true }),
      });
      if (!mk.ok) throw new Error("create release " + mk.status + ": " + (await mk.text()).slice(0, 160));
      release = (await mk.json()) as { id: number; upload_url: string };
    }
    // امسح الأصل القديم (نفس الاسم) عشان الرفع الجديد ينزل مكانه
    const assets = await gh(`/repos/${REPO}/releases/${release.id}/assets?per_page=100`);
    if (assets.ok) {
      const list = (await assets.json()) as Array<{ id: number; name: string }>;
      for (const a of list) if (a.name === ASSET) await gh(`/repos/${REPO}/releases/assets/${a.id}`, { method: "DELETE" });
    }
    const up = await fetch((release.upload_url || "").replace("{?name,label}", "") + `?name=${ASSET}`, {
      method: "POST",
      headers: { "Content-Type": "application/zip", "User-Agent": "nova-state-backup", Authorization: `Bearer ${token()}` },
      body: readFileSync(tmpZip),
    });
    if (!up.ok && up.status !== 201) throw new Error("upload " + up.status + ": " + (await up.text()).slice(0, 160));
    writeRecord({ lastBackupAt: new Date().toISOString(), lastBackupBytes: bytes, lastBackupFiles: files.length, lastResult: "ok", lastError: null });
    logger.info({ files: files.length, bytes, ms: Date.now() - t0 }, "state-backup: state/ اترفعت على GitHub (release " + TAG + ")");
    return { ok: true, bytes, files: files.length, detail: `${files.length} ملف (${Math.round(bytes / 1024)}KB) على GitHub` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeRecord({ lastResult: "failed", lastError: msg, lastBackupAt: new Date().toISOString() });
    logger.warn({ err: msg }, "state-backup فشل");
    return { ok: false, bytes: 0, files: 0, detail: "فشل: " + msg };
  } finally {
    running = false;
    try { (await import("node:fs")).unlinkSync(tmpZip); } catch { /* خلاص */ }
  }
}

/**
 * استرجاع عند الإقلاع: لو state/ فاضية (كونتينر جديد/ريإينستال) نجيب آخر نسخة
 * من GitHub ونفكها — ولو الملفات موجودة محليًا بنسيب الطازة تكسب (GitHub أقدم).
 */
export async function restoreStateFromGithubIfNeeded(): Promise<{ restored: boolean; files: number; detail: string }> {
  if (!backupEnabled()) return { restored: false, files: 0, detail: "مفيش توكن — الاسترجاع متعطّل بصراحة" };
  const localHasState = (() => { try { return readdirSync(stateDir()).length > 3; } catch { return false; } })();
  if (localHasState) return { restored: false, files: 0, detail: "الحالة المحلية سليمة — الطازة بتكسب (استرجاع مش محتاج)" };
  try {
    const buf = await downloadAsset();
    if (!buf || buf.length < 100) return { restored: false, files: 0, detail: "مفيش نسخة على GitHub لسه (أول تشغيل؟)" };
    const tmpZip = `/tmp/nova-state-restore-${process.pid}-${Date.now()}.zip`;
    writeFileSync(tmpZip, buf);
    mkdirSync(stateDir(), { recursive: true });
    await py(["-c", "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", tmpZip, stateDir()]);
    let files = 0;
    try { files = readdirSync(stateDir()).length; } catch { files = 0; }
    try { (await import("node:fs")).unlinkSync(tmpZip); } catch { /* */ }
    writeRecord({ lastRestoreAt: new Date().toISOString(), lastRestoreFiles: files });
    logger.info({ files, bytes: buf.length }, "state-backup: الحالة اترجّعت من GitHub بعد كونتينر فاضي");
    return { restored: true, files, detail: `اترجّع ${files} عنصر من GitHub` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, "state-restore فشل — نكمل بحالة فاضية زي أول يوم");
    return { restored: false, files: 0, detail: "فشل الاسترجاع: " + msg };
  }
}

/** الجدولة: كل NOVA_STATE_BACKUP_MINUTES (افتراضي 15). 0 = تعطيل صريح. */
export function scheduleStateBackup(): void {
  const everyMin = Number(process.env.NOVA_STATE_BACKUP_MINUTES ?? 15);
  if (everyMin <= 0) return;
  if (!backupEnabled()) { logger.info("state-backup: GITHUB_TOKEN مش في البيئة — النسخة الدورية متعطّلة (الذاكرة/الإعدادات على Supabase شغالة)"); return; }
  const tick = () => { void backupStateToGithub().catch(() => {}); };
  setTimeout(tick, 120_000).unref?.(); // أول نسخة بعد دقيقتين من الإقلاع
  setInterval(tick, everyMin * 60_000).unref?.();
  logger.info({ everyMin }, "state-backup: GitHub نسخة حيّة — أول مرة بعد دقيقتين ثم كل " + everyMin + " دقيقة");
}
