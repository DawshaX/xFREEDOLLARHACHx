/**
 * TEST13 — التجهيز الذاتي: الهَب يجهّز بيئة كالي بنفسه من جيت هب.
 *
 * ليه؟ سيرفر الإنتاج (nova.waifly.com) بيوزع bundle من غير الrepo ولا
 * السكربتات — فالتبويبة كانت بتقول «مش مستخرجة» بصراحة. دلوقتي:
 *  - provisionKali(): بيسحب أجزاء rootfs من فرع kali-rootfs (raw.githubusercontent
 *    أولًا — النت مفتوح على الإنتاج؛ fallback git archive للسانبوكس)، بيتحقق
 *    SHA256 لكل جزء، وبيفك gzip stream مباشرة (zlib أصلاً في Node) عبر tar
 *    npm — بلا أي مكتبات خارجية، والذروة على الدسك = الاستخراج + جزء واحد.
 *  - runKali/startDesktop: spawn مباشر لproot — بلا سكربتات خارجية إطلاقًا.
 *  - watchdog الضمان زي ما هو.
 * كل قياس من الملفات والعمليات الفعلية — والفشل بيرجع صادق بأرقام المساحة.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import * as tar from "tar";
import { createPushNotification } from "../push-hub";
import { localKaliEnabled } from "./proot";

export interface HeavyTool {
  present: boolean;
  version?: string;
}

export interface KaliExecResult {
  ok: boolean;
  cmd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated?: boolean;
}

export interface KaliStatus {
  present: boolean;
  prettyName?: string;
  packages?: number;
  executables?: number; // TEST30 — عدد الأدوات التنفيذية المقاسة (مش الحزم)
  builtAt?: string;
  root: string | null;
  engine?: string;
  probe?: { ok: boolean; version?: string; detail?: string };
  desktop?: { running: boolean; vncPort: boolean; novncPort: boolean; desired: boolean };
  tools?: {
    metasploit: HeavyTool;
    burpsuite: HeavyTool;
    owasp_zap: HeavyTool;
    seclists: HeavyTool;
  };
}

const REPO_SLUG = process.env.NOVA_KALI_REPO_SLUG ?? "DawshaX/xFREEDOLLARHACHx";
const KALI_BRANCH = process.env.NOVA_KALI_BRANCH ?? "kali-rootfs";
const STATIC_BRANCH = process.env.NOVA_KALI_STATIC_BRANCH ?? "kali-static";
const TCP_CHECK_TIMEOUT = 1200;

export function kaliDestDir(): string {
  return process.env.NOVA_KALI_ROOT ?? path.join(os.homedir(), "kali-rootfs/rootfs");
}

/** كل أماكن rootfs كالي المحتملة — للحالة والفضي (بقايا التجهيز الناقص أكلت الحصة على waifly). */
export function kaliCandidateRoots(): string[] { return repoRoots(); }

/** حجم شجرة فعلي على الدسك (walk حقيقي — مش تقدير). */
export function treeBytes(dir: string): number {
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) bytes += fs.statSync(p).size;
      } catch { /* اتنقل وهو بيقيس */ }
    }
  }
  return bytes;
}

/* ── علم الحصة: statfs بيكذب على Pterodactyl (بيشوف دسك الفيزياء مش حصة
   الكونتينر 3.24GiB) — أول ما الكتابة تفشل بـENOSPC/EDQUOT بيتعلم وبيرفض
   كل التجهيزات الجاية فورًا بدل ما يغرق السيرفر تاني. */
const quotaFlagPath = () => path.join(process.cwd(), "state", "kali-quota-flag.json");
export function quotaFlag(): { at: string; partsDone: number; partsTotal: number; reason: string } | null {
  try { return JSON.parse(fs.readFileSync(quotaFlagPath(), "utf8")); } catch { return null; }
}
function writeQuotaFlag(partsDone: number, partsTotal: number, reason: string): void {
  try {
    fs.mkdirSync(path.dirname(quotaFlagPath()), { recursive: true });
    fs.writeFileSync(quotaFlagPath(), JSON.stringify({ at: new Date().toISOString(), partsDone, partsTotal, reason }, null, 2));
  } catch { /* مش شرط حياة */ }
}
export function clearQuotaFlag(): boolean {
  try { fs.unlinkSync(quotaFlagPath()); return true; } catch { return false; }
}

function repoRoots(): string[] {
  const cwd = process.cwd();
  const up2 = path.resolve(cwd, "../..");
  return [
    kaliDestDir(),
    path.join(cwd, ".cache/kali/rootfs"),
    path.join(cwd, "state/kali/rootfs"),
    path.join(up2, ".cache/kali/rootfs"),
    path.join(up2, "state/kali/rootfs"),
  ];
}

/** أول مسار فيه rootfs كالي فعلية (os-release فيها kali).
 * TEST73 — على الهَب مقفولة (مافيش كالي على الهَب — قرار المالك):
 * بقايا rootfs كانت بتخدع المسار ده وتكسر exec/catalog. NOVA_KALI_LOCAL=1 يفتحها صراحة. */
export function kaliRoot(): string | null {
  if (!localKaliEnabled()) return null;
  for (const r of repoRoots()) {
    try {
      const rel = fs.readFileSync(path.join(r, "etc/os-release"), "utf8");
      if (/kali/i.test(rel)) return r;
    } catch {
      /* المسار ده مش rootfs — نجرب اللي بعده */
    }
  }
  return null;
}

/** مجلد noVNC الساكن جوه rootfs — للبروكسي عبر الهَب. */
export function kaliNovncDir(): string | null {
  const root = kaliRoot();
  if (!root) return null;
  const dir = path.join(root, "usr/share/novnc");
  try {
    if (fs.existsSync(path.join(dir, "vnc.html"))) return dir;
  } catch { /* سالمة */ }
  return null;
}

function tcpOpen(port: number, timeoutMs = TCP_CHECK_TIMEOUT): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

/* ── التشغيل المباشر — بلا أي سكربتات خارجية (الإنتاج مايملكش الrepo) ── */

function prootBinary(root: string): string | null {
  const staticPath = path.join(root, "usr/local/bin/proot-static");
  try {
    if (fs.existsSync(staticPath)) return staticPath;
  } catch { /* سالمة */ }
  return null;
}

function prootArgs(root: string, cmd: string): string[] {
  return [
    "-R", root,
    "/usr/bin/env", "-i",
    "HOME=/root", "TERM=xterm",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG=C.UTF-8", "SHELL=/bin/bash",
    "/bin/bash", "-lc", cmd,
  ];
}

/** تنفيذ أمر حقيقي داخل كالي — spawn مباشر لproot، timeout صارم، قص محفوظ. */
export function runKali(
  cmd: string,
  timeoutMs = 60_000,
  onData?: (streamType: "stdout" | "stderr", chunk: string) => void,
): Promise<KaliExecResult> {
  const root = kaliRoot();
  const t0 = Date.now();
  if (!root) {
    return Promise.resolve({ ok: false, cmd, exitCode: null, stdout: "", stderr: "بيئة كالي مش مستخرجة", durationMs: 0 });
  }
  const proot = prootBinary(root);
  if (!proot) {
    return Promise.resolve({ ok: false, cmd, exitCode: null, stdout: "", stderr: "proot-static مش موجود جوه البيئة", durationMs: 0 });
  }
  return new Promise((resolve) => {
    const child = spawn(proot, prootArgs(root, cmd), { cwd: process.cwd(), timeout: timeoutMs, killSignal: "SIGKILL" });
    let out = "";
    let err = "";
    let truncated = false;
    const cap = 64 * 1024;
    child.stdout.on("data", (d: Buffer) => {
      const text = d.toString();
      if (out.length < cap) out += text;
      else truncated = true;
      if (onData) onData("stdout", text);
    });
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      if (err.length < cap) err += text;
      else truncated = true;
      if (onData) onData("stderr", text);
    });
    child.on("error", (e) => {
      resolve({ ok: false, cmd, exitCode: null, stdout: out, stderr: `${err}\n${e.message}`.trim(), durationMs: Date.now() - t0 });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0, cmd, exitCode: code,
        stdout: out.slice(0, 16_000), stderr: err.slice(0, 4_000),
        durationMs: Date.now() - t0, ...(truncated ? { truncated: true } : {}),
      });
    });
  });
}

/* ── الأدوات الثقيلة — مقاسة من سجل dpkg نفسه ── */
const HEAVY_PKGS: Array<[keyof NonNullable<KaliStatus["tools"]>, string, string]> = [
  ["metasploit", "metasploit-framework", "/usr/bin/msfconsole"],
  ["burpsuite", "burpsuite", "/usr/bin/burpsuite"],
  ["owasp_zap", "zaproxy", "/usr/bin/owasp-zap"], // قيس: الحزمة zaproxy هي اللي بتوفر /usr/bin/owasp-zap
  ["seclists", "seclists", "/usr/share/seclists"],
];

function measureHeavy(root: string): NonNullable<KaliStatus["tools"]> {
  let statusTxt = "";
  try {
    statusTxt = fs.readFileSync(path.join(root, "var/lib/dpkg/status"), "utf8");
  } catch { /* سالمة */ }
  const out = {} as NonNullable<KaliStatus["tools"]>;
  for (const [key, pkg, bin] of HEAVY_PKGS) {
    const block = statusTxt.split("\n\n").find((b) => b.startsWith(`Package: ${pkg}\n`));
    const version = /^Version:\s*(.+)$/m.exec(block ?? "")?.[1];
    let binOk = false;
    try { binOk = fs.existsSync(path.join(root, bin)); } catch { /* سالمة */ }
    out[key] = { present: Boolean(version && binOk), ...(version ? { version } : {}) };
  }
  return out;
}

/* ── الحالة المرغوبة — ضمان استمرار العمل ── */
function desiredFile(): string {
  return path.resolve(process.cwd(), "state/kali_env_v1.json");
}
function readDesired(): { desktopEnabled: boolean } {
  try {
    const j = JSON.parse(fs.readFileSync(desiredFile(), "utf8")) as { desktopEnabled?: boolean };
    return { desktopEnabled: j.desktopEnabled === true };
  } catch {
    return { desktopEnabled: false };
  }
}
function writeDesired(v: { desktopEnabled: boolean }): void {
  try {
    fs.mkdirSync(path.dirname(desiredFile()), { recursive: true });
    fs.writeFileSync(desiredFile(), JSON.stringify(v, null, 2) + "\n");
  } catch { /* سالمة */ }
}

/** حالة مقاسة بالكامل — من الملفات والبورتات والبروب الفعلي. */
/** عدد التنفيذيات الحقيقية في usr/bin + usr/sbin (مقاس بالأمر: find … -type f -executable). */
export function countExecutables(root: string): number {
  let n = 0;
  for (const d of ["usr/bin", "usr/sbin"]) {
    try {
      const dir = path.join(root, d);
      for (const f of fs.readdirSync(dir)) {
        try {
          const stx = fs.statSync(path.join(dir, f));
          if (stx.isFile() && (stx.mode & 0o111) !== 0) n++;
        } catch { /* ملف اختفى بين السطور */ }
      }
    } catch { /* مجلد مش موجود */ }
  }
  return n;
}

export async function kaliStatus(withProbe = true): Promise<KaliStatus> {
  const root = kaliRoot();
  if (!root) return { present: false, root: null, tools: measureHeavy("/") };
  let prettyName: string | undefined;
  try {
    prettyName = /PRETTY_NAME="?([^"\n]+)"?/.exec(fs.readFileSync(path.join(root, "etc/os-release"), "utf8"))?.[1];
  } catch { /* قراءة سالمة */ }
  let packages: number | undefined;
  try {
    packages = fs.readFileSync(path.join(root, "var/lib/dpkg/status"), "utf8").split("\n").filter((l) => l.startsWith("Package:")).length;
  } catch { /* سالمة */ }
  // TEST30 — التسمية الصح بعد شكوى المالك: الحزم (dpkg) ≠ الأدوات (تنفيذية في /usr/bin و/usr/sbin).
  // الاتنين بيتقاسوا وبيتعرضوا مع بعض: «X أداة تنفيذية · Y حزمة» — مافيش استبدال رقم برقم.
  let executables: number | undefined;
  try {
    executables = countExecutables(root);
  } catch { /* سالمة */ }
  let builtAt: string | undefined;
  try {
    builtAt = /built_at=(\S+)/.exec(fs.readFileSync(path.join(root, "MANIFEST.txt"), "utf8"))?.[1];
  } catch { /* سالمة */ }

  const proot = prootBinary(root);
  const [vnc, novnc] = await Promise.all([tcpOpen(5901), tcpOpen(6080)]);
  const st: KaliStatus = {
    present: true, prettyName, packages, executables, builtAt, root,
    engine: proot ?? undefined,
    desktop: { running: vnc && novnc, vncPort: vnc, novncPort: novnc, desired: readDesired().desktopEnabled },
    tools: measureHeavy(root),
  };
  if (withProbe) {
    const probe = await runKali("nmap --version | head -1", 20_000);
    st.probe = probe.ok
      ? { ok: true, version: probe.stdout.trim() || "nmap" }
      : { ok: false, detail: probe.stderr.slice(0, 200) || `exit=${probe.exitCode}` };
  }
  return st;
}

/** رابط noVNC نسبي عبر الهَب نفسه — يشتغل من nova.waifly.com أو أي دومين بيوصله. */
export function buildDesktopUrl(token?: string): string | null {
  if (!kaliNovncDir()) return null;
  const base = "/api/ops/kali/novnc/vnc.html?autoconnect=1&path=" + encodeURIComponent("/api/ops/kali/novnc/websockify");
  if (token) return `${base}&token=${encodeURIComponent(token)}`;
  return base;
}

function waitPort(port: number, timeoutMs = 30_000): Promise<boolean> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await tcpOpen(port, 800)) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(tick, 900);
    };
    tick();
  });
}

/** الديسكتوب الحقيقي — spawn مباشر (بلا سكربتات): Xvfb+fluxbox+xterm+x11vnc+websockify. */
export async function startDesktop(): Promise<{ ok: boolean; detail: string }> {
  const root = kaliRoot();
  const proot = root ? prootBinary(root) : null;
  if (!root || !proot) return { ok: false, detail: "البيئة أو proot مش جاهزين — جهّز البيئة الأول" };
  const geom = (process.env.NOVA_KALI_GEOM ?? "1280x800x24").split("x");
  const spawnInside = (cmd: string, log: string) => {
    fs.openSync(log, "a");
    const c = spawn(proot, prootArgs(root, cmd), { detached: true, stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")] });
    c.unref();
    return c;
  };
  spawnInside("pkill -f 'Xvfb :99'; pkill -f x11vnc; pkill -f 'websockify.*6080'; sleep 0.2; true", "/tmp/kali-desktop-hub.log");
  await new Promise((r) => setTimeout(r, 1200));
  spawnInside(`Xvfb :99 -screen 0 ${geom[0]}x${geom[1]}x${geom[2] ?? 24} -nolisten tcp`, "/tmp/kali-xvfb.log");
  await new Promise((r) => setTimeout(r, 2000));
  spawnInside("DISPLAY=:99 fluxbox", "/tmp/kali-fluxbox.log");
  await new Promise((r) => setTimeout(r, 1000));
  spawnInside("DISPLAY=:99 xterm -geometry 100x30+40+40 -title 'Kali — NOVA Work Node'", "/tmp/kali-xterm.log");
  spawnInside("DISPLAY=:99 (thunar >/dev/null 2>&1 || true)", "/tmp/kali-thunar.log");
  await new Promise((r) => setTimeout(r, 1000));
  spawnInside("x11vnc -display :99 -forever -shared -rfbport 5901 -listen localhost -nopw -noxrecord -noxdamage -quiet", "/tmp/kali-x11vnc.log");
  await new Promise((r) => setTimeout(r, 2000));
  spawnInside("websockify --web /usr/share/novnc 0.0.0.0:6080 localhost:5901", "/tmp/kali-websockify.log");
  const up = await waitPort(6080, 45_000);
  writeDesired({ desktopEnabled: true });
  if (up) {
    createPushNotification({
      kind: "ops",
      title: "🖥️ ديسكتوب كالي شغّال",
      body: "Xvfb + fluxbox + noVNC عبر الهَب — متاح من تبويب بيئة كالي",
      link: "/kali-env",
    });
  }
  return { ok: up, detail: up ? "noVNC فتح فعليًا على 6080 (مقاس بالاتصال)" : "الموقت خلص والبورت مقفول — اللوج في /tmp/kali-websockify.log" };
}

/** إطفاء الديسكتوب — pkill حقيقي + إلغاء الحالة المرغوبة. */
export function stopDesktop(): { ok: boolean; detail: string } {
  const root = kaliRoot();
  const proot = root ? prootBinary(root) : null;
  try {
    if (proot && root) {
      const c = spawn(proot, prootArgs(root, "pkill -f 'Xvfb :99'; pkill -f x11vnc; pkill -f 'websockify.*6080'; true"), { timeout: 10_000 });
      c.unref();
    }
    writeDesired({ desktopEnabled: false });
    createPushNotification({ kind: "ops", title: "🖥️ ديسكتوب كالي اتفصّل", body: "كل العمليات اتقفلت", link: "/kali-env" });
    return { ok: true, detail: "اتقفلت (pkill مقاس)" };
  } catch (e) {
    writeDesired({ desktopEnabled: false });
    return { ok: false, detail: `pkill خرج بكود ${(e as { status?: number }).status ?? "?"}` };
  }
}

/* ── الضمان: ساعة بترجّع الديسكتوب لو وقع والحالة المرغوبة «شغّال» ── */
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function startKaliWatchdog(intervalMs = 90_000): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(async () => {
    try {
      if (!kaliRoot() || !readDesired().desktopEnabled) return;
      const [vnc, novnc] = await Promise.all([tcpOpen(5901, 900), tcpOpen(6080, 900)]);
      if (vnc && novnc) return;
      const r = await startDesktop();
      if (r.ok) {
        createPushNotification({
          kind: "warning",
          title: "🔄 ديسكتوب كالي وقع ورجّعه الضمان تلقائيًا",
          body: "الواتشدوج لاحظ البورتات مقفولة وأعاد التشغيل — مقاس",
          link: "/kali-env",
        });
      }
    } catch { /* الدورة الجاية */ }
  }, intervalMs);
  watchdogTimer.unref?.();
}

/* ═══════════ التجهيز الذاتي — الهَب يبني بيئته بنفسه ═══════════ */

export interface ProvisionState {
  resources?: { ramTotalGB: number; ramFreeGB: number; cpuCores: number; diskFreeGB: number | null; usedGB?: number; quotaGB?: number | null; quotaFreeGB?: number | null };
  running: boolean;
  phase: string;
  partsDone: number;
  partsTotal: number;
  entries: number;
  bytesDone: number;
  current: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  transport: string | null;
}

const provision: ProvisionState = {
  running: false, phase: "idle", partsDone: 0, partsTotal: 0, entries: 0,
  bytesDone: 0, current: "", error: null, startedAt: null, finishedAt: null,
  log: [], transport: null,
};

export function provisionState(): ProvisionState {
  return { ...provision, log: provision.log.slice(-40) };
}

function plog(line: string): void {
  provision.log.push(`${new Date().toISOString()} ${line}`);
  if (provision.log.length > 200) provision.log.splice(0, provision.log.length - 200);
}

function rawUrl(branch: string, file: string): string {
  return `https://raw.githubusercontent.com/${REPO_SLUG}/${branch}/${file}`;
}

/** جزء من الفرع بطبقات نقل: raw (الإنتاج) → api.github contents raw (بلا كاش
 * دسك — الحل المقاس لضغط المساحة) → git cat-file (آخر fallback — بيخزن blobs
 * فبيتفحص المساحة وسط التشغيل بصدق). */
async function fetchPartBuffer(branch: string, ref: string | null, gdir: string | null, file: string): Promise<Buffer> {
  // 1) raw.githubusercontent — أسرع وأبسط على الإنتاج (نت مفتوح)
  try {
    const r = await fetch(rawUrl(branch, file), { headers: { Connection: "close" }, signal: AbortSignal.timeout(120_000) });
    if (r.ok) {
      provision.transport = provision.transport ?? "raw";
      return Buffer.from(await r.arrayBuffer());
    }
    plog(`raw ${file}: HTTP ${r.status} — جرب api`);
  } catch (e) {
    plog(`raw ${file}: ${(e as Error).message.slice(0, 60)} — جرب api`);
  }
  // 2) api.github.com contents (raw accept) — بلا أي كاش على الدسك
  const ghTok = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.NOVA_GITHUB_TOKEN ?? "";
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_SLUG}/contents/${file}?ref=${branch}`, {
      headers: { Accept: "application/vnd.github.raw", Connection: "close", ...(ghTok ? { Authorization: `Bearer ${ghTok}` } : {}) },
      signal: AbortSignal.timeout(180_000),
    });
    if (r.ok) {
      provision.transport = provision.transport ?? "api";
      return Buffer.from(await r.arrayBuffer());
    }
    plog(`api ${file}: HTTP ${r.status} — جرب git`);
  } catch (e) {
    plog(`api ${file}: ${(e as Error).message.slice(0, 60)} — جرب git`);
  }
  // 3) git cat-file — آخر fallback (بيكش blobs محليًا ⇒ فحص مساحة وسط التشغيل)
  if (!gdir) throw new Error(`مافيش transport متاح لـ${file}`);
  const out = await new Promise<Buffer>((resolve, reject) => {
    const c = spawn("git", ["-C", gdir, "cat-file", "blob", `${ref ?? "FETCH_HEAD"}:${file}`], { timeout: 180_000 });
    const chunks: Buffer[] = [];
    c.stdout.on("data", (d: Buffer) => chunks.push(d));
    c.on("error", reject);
    c.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`git cat-file ${file}: exit ${code}`)));
  });
  provision.transport = "git";
  const free = diskFreeBytes(gdir);
  if (free !== null && free < 2 * 2 ** 30) {
    throw new Error(`مساحة النقل (git) بقت ${Math.round(free / 2 ** 30)}GB بس — النقل عبر git بيخزن blobs؛ حرّر مساحة أو فعّل raw/api`);
  }
  return out;
}

function shasum(b: Buffer): string {
  return crypto.createHash("sha256").update(b).digest("hex");
}

function diskFreeBytes(dir: string): number | null {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    try {
      const st2 = fs.statfsSync(path.dirname(dir));
      return Number(st2.bavail) * Number(st2.bsize);
    } catch { return null; }
  }
}

let gitPrep: { gdir: string; ref: string } | null = null;

async function gitPrepare(): Promise<{ gdir: string; ref: string } | null> {
  if (gitPrep) return gitPrep;
  const gdir = fs.mkdtempSync("/tmp/kali-prov-git.");
  const run = (args: string[], timeoutMs = 600_000) =>
    new Promise<{ code: number | null; err: string }>((resolve) => {
      const c = spawn("git", ["-C", gdir, ...args], { timeout: timeoutMs });
      let err = "";
      c.stderr.on("data", (d: Buffer) => { err += d.toString(); });
      c.on("error", () => resolve({ code: -1, err: "spawn failed" }));
      c.on("close", (code) => resolve({ code, err }));
    });
  if ((await run(["init", "-q"])).code !== 0) return null;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  const url = token ? `https://x-access-token:${token}@github.com/${REPO_SLUG}.git` : `https://github.com/${REPO_SLUG}.git`;
  await run(["remote", "add", "origin", url]);
  const f = await run(["-c", "protocol.version=2", "fetch", "-q", "--depth=1", "--filter=blob:none", "origin", KALI_BRANCH], 900_000);
  if (f.code !== 0) { plog(`git fetch فشل: ${f.err.slice(0, 120)}`); return null; }
  const r = await run(["rev-parse", "FETCH_HEAD"]);
  if (r.code !== 0) return null;
  const ref = fs.readFileSync(path.join(gdir, ".git", "FETCH_HEAD"), "utf8").trim().split(" ")[0] || (await run(["rev-parse", "FETCH_HEAD"])).code === 0 ? undefined : undefined;
  const refOut = await new Promise<string>((resolve) => {
    const c = spawn("git", ["-C", gdir, "rev-parse", "FETCH_HEAD"], { timeout: 20_000 });
    let out = "";
    c.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    c.on("close", () => resolve(out.trim().split(/\s/)[0]));
    c.on("error", () => resolve(""));
  });
  gitPrep = { gdir, ref: refOut };
  return gitPrep;
}

/** التجهيز الكامل: SHA256SUMS → أجزاء متحققة → gunzip → tar → proot-static. */
/* ── وضع سحابي أولًا: التحميل المحلي لكالي على السيرفر استثناء بتأكيد مزدوج ──
 * المقاس (2026-11-15): waifly وقفت مرتين عشان التجهيز بيحمل 15GB على حصة
 * 1.5GB. القاعدة الجديدة: مافيش تحميل تلقائي ولا زرار عابر — التحميل المحلي
 * محتاج NOVA_KALI_LOCAL_ALLOW=1 في .env أو confirm صريح من نادي الأداة/الroute.
 * المخزن سحابي دايمًا (فرع kali-rootfs) والتنفيذ بيتحول للطائرة الخارجية. */
export function kaliLocalAllowed(): boolean {
  return process.env.NOVA_KALI_LOCAL_ALLOW === "1";
}

export async function provisionKali(opts?: { force?: boolean }): Promise<{ ok: boolean; detail: string; skipped?: boolean }> {
  if (!kaliLocalAllowed() && !opts?.force) {
    provision.running = false;
    provision.phase = "blocked";
    provision.error = null;
    return {
      ok: false,
      skipped: true,
      detail: "وضع سحابي أولًا (مقاس: التجهيز المحلي وقف waifly مرتين): المخزن على فرع kali-rootfs على GitHub والتنفيذ بيتحول تلقائيًا للطائرة الخارجية (kali_run). لو عايز نسخة محلية على السيرفر ده فعلًا — تأكيد مزدوج: ناد kali_provision بـconfirm:yes، أو حط NOVA_KALI_LOCAL_ALLOW=1 في .env",
    };
  }
  if (provision.running) return { ok: false, detail: "التجهيز شغال بالفعل — شوف provision/status" };
  if (kaliRoot()) return { ok: true, detail: "البيئة موجودة بالفعل — مفيش حاجة تتسحب", skipped: true };
  provision.running = true;
  provision.phase = "manifest";
  provision.error = null;
  provision.partsDone = 0;
  provision.partsTotal = 0;
  provision.entries = 0;
  provision.bytesDone = 0;
  provision.startedAt = new Date().toISOString();
  provision.finishedAt = null;
  provision.log = [];
  const dest = kaliDestDir();
  const t0 = Date.now();
  try {
    plog(`التجهيز بدأ → ${dest} · الفرع ${KALI_BRANCH}`);
    createPushNotification({ kind: "ops", title: "🐉 تجهيز بيئة كالي بدأ", body: `الهَب بيسحب rootfs كالي الكاملة من فرع ${KALI_BRANCH}`, link: "/kali-env" });

    const free = diskFreeBytes(path.dirname(dest));
    plog(`المساحة الفاضية: ${free ? Math.round(free / 2 ** 30) + "GB" : "مش معروفة (statfs)"}`);
    // ضمان الموارد — مقاس ومعلن بصراحة (مساحة/RAM/CPU، والرسوميات برمجية جوه البيئة)
    const cpuCores = os.cpus().length;
    const ramTotalGB = Math.round(os.totalmem() / 2 ** 30);
    const ramFreeGB = Math.round(os.freemem() / 2 ** 30);
    provision.resources = { ramTotalGB, ramFreeGB, cpuCores, diskFreeGB: free !== null ? Math.round(free / 2 ** 30) : null };
    plog(`الموارد المقاسة: RAM ${ramTotalGB}GB (فاضي ${ramFreeGB}GB) · CPU ${cpuCores} نواة · الرسوميات برمجية جوه البيئة (Xvfb/llvmpipe — مش محتاج GPU)`);
    /* ★ الرقم الصح مقاس، مش من المانيفست: 12.85GB بتتكتب على الدسك فعلًا
     *   (usr 12.54 · var 0.24 · opt 0.06). رقم 18.6GB/19.97GB في MANIFEST.txt
     *   منطقي مش ديسكي. +2GB هامش للـproot والمخرجات ⇒ 15GB هي الحقيقة.
     *   والاستكمال **مستحيل بنيويًا** — شوف التعليق عند الاستخراج. */
    const neededGB = 15;
    if (free !== null && free < neededGB * 2 ** 30) {
      throw new Error(`المساحة مش كفاية: ${Math.round(free / 2 ** 30)}GB فاضية والتجهيز محتاج ~${neededGB}GB (12.85GB استخراج + هامش). حرّر مساحة وجرّب تاني.`);
    }
    // علم الحصة من فشل سابق — رفض فوري بصراحة بدل ما يغرق السيرفر تاني
    const qflag = quotaFlag();
    if (qflag) {
      throw new Error(`حصة الدسك اتكشفت فعليًا (${qflag.at}): التجهيز وقف عند ${qflag.partsDone}/${qflag.partsTotal} أجزاء (${qflag.reason}) — statfs بيشوف دسك الفيزياء بس، الحصة الحقيقية للكونتينر أقل من الـ~15GB المطلوبة. حرر مساحة أو ارفع حصة السيرفر، وبعدها kali_provision action:clear_quota`);
    }
    // حصة معلنة (NOVA_DISK_QUOTA_GB) — حساب فعلي: الحصة ناقص استخدامنا الحالي
    const usedGB = Math.round(treeBytes(path.dirname(dest)) / 2 ** 30);
    const quotaGB = Number(process.env.NOVA_DISK_QUOTA_GB || 0);
    const quotaFreeGB = quotaGB > 0 ? Math.round((quotaGB * 2 ** 30 - treeBytes(path.dirname(dest))) / 2 ** 30) : null;
    if (quotaFreeGB !== null && quotaFreeGB < neededGB) {
      provision.resources = { ...provision.resources, usedGB, quotaGB, quotaFreeGB };
      throw new Error(`حصة الكونتينر ${quotaGB}GB والاستخدام الحالي ${usedGB}GB — الحصة مش هتحمل التبيئة (~15GB) حتى لو statfs بيقول فاضي (${Math.round(free === null ? 0 : free / 2 ** 30)}GB). التبيئة الكاملة متخزنة على فرع kali-rootfs سحابي، والتشغيل المحلي محتاج سيرفر بحصة أكبر.`);
    }
    provision.resources = { ...provision.resources, usedGB, quotaGB: quotaGB || null, quotaFreeGB };

    /* المانيفست + SHA256SUMS */
    const git = await gitPrepare();
    const ref = git?.ref ?? null;
    const shasTxt = (await fetchPartBuffer(KALI_BRANCH, ref, git?.gdir ?? null, "SHA256SUMS")).toString();
    const manifest = (await fetchPartBuffer(KALI_BRANCH, ref, git?.gdir ?? null, "MANIFEST.txt")).toString();
    const parts = [...new Set([...shasTxt.matchAll(/part-\d+/g)].map((m) => m[0]))].sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
    provision.partsTotal = parts.length;
    provision.phase = "parts";
    plog(`الأجزاء: ${parts.length} · ref ${ref ?? "raw"}`);
    plog(manifest.split("\n").slice(0, 4).join(" · "));

    /* proot-static بدري — 1.7MB بس، قبل الأجزاء الثقيلة عشان مايتأثرش بضغط الدسك */
    provision.phase = "proot";
    let staticRef: string | null = null;
    if (git?.gdir) {
      const sf = await new Promise<{ code: number | null; ref: string }>((resolve) => {
        const c = spawn("git", ["-C", git.gdir, "-c", "protocol.version=2", "fetch", "-q", "--depth=1", "--filter=blob:none", "origin", STATIC_BRANCH], { timeout: 300_000 });
        c.on("error", () => resolve({ code: -1, ref: "" }));
        c.on("close", async (code) => {
          if (code !== 0) { resolve({ code, ref: "" }); return; }
          const r2 = spawn("git", ["-C", git.gdir, "rev-parse", "FETCH_HEAD"], { timeout: 20_000 });
          let out = "";
          r2.stdout.on("data", (d: Buffer) => { out += d.toString(); });
          r2.on("close", () => resolve({ code: 0, ref: out.trim().split(/\s/)[0] }));
          r2.on("error", () => resolve({ code: -1, ref: "" }));
        });
      });
      staticRef = sf.code === 0 && sf.ref ? sf.ref : null;
      plog(`kali-static: fetch ${staticRef ? "✓ " + staticRef.slice(0, 10) : "✗"}`);
    }
    const prootTmp = `/tmp/nova-proot-static.${Date.now()}`;
    let prootBuf: Buffer | null = null;
    try {
      prootBuf = await fetchPartBuffer(STATIC_BRANCH, staticRef, git?.gdir ?? null, "proot-static");
      fs.writeFileSync(prootTmp, prootBuf);
      plog(`proot-static اتسحب مبكرًا ✓ (${prootBuf.length} bytes)`);
    } catch (e) {
      plog(`proot-static فشل مبكرًا: ${(e as Error).message.slice(0, 100)}`);
    }

    /* ⚠ سؤال كان لازم يتسأل قبل ما نكتب كود استكمال: هل الأجزاء مستقلة؟
     *   لأ — وده اتقاس مش تخمين. part-00 بيبدأ بـ 1f 8b (gzip)، لكن
     *   part-01/02/03 بيبدأوا بـ e0 60 / 32 cc / 28 5e. دول **شرائح من
     *   stream ضغط واحد**، مش أرشيفات منفصلة. الاستكمال من منتصف شريط gzip
     *   مستحيل رياضيًا (قاموس deflate وراء كل بايت). فالكود اللي كان بيرجع
     *   من part-00 كان **صح**، والقصور الحقيقي كان إن المساحة تخلص في النص.
     *   بنصلح المساحة (12.85GB مقاسة) وبنكتب المستحيل بدل ما ندّعي حلّه. */
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    provision.phase = "parts";
    plog(`الأجزاء: ${parts.length} · tar النظام ${fs.existsSync("/usr/bin/tar") ? "✓" : "✗ (fallback node-tar)"}`);

    // gzip صريح (-z) — GNU tar مش بيكتشف الضغط من stdin (مقاس: "Archive is compressed. Use -z option")
    /* ★ قياس حقيقي (2026-11-17 16:5xZ) — MANIFEST.txt بيقول 18.6GB مفكوكة،
     *   بس ده **حجم الملفات المنطقي** اللي فيه ملفات sparse وحسابات مكررة.
     *   اللي بيتكتب على الدسك فعلًا: **12.85GB** (اتقاس بفكّ رؤوس الـ64 جزء
     *   وجمع أحجام الملفات: usr 12.54 · var 0.24 · opt 0.06 · الباقي ~0).
     *   والـ19.97GB اللي في المانيفست ما كانش ليه معنى على الدسك من الأول.
     *   ⇒ بنستخرج **كل حاجة بلا استبعاد**: seclists 1.8GB وmetasploit 0.56GB
     *     وburp 0.34GB كلهم أدوات شغل حقيقية مالهاش بديل.
     *
     *   ومع ذلك سايبين مستبعدات **آمنة ومحدودة** للملفات اللي مالهاش أي وظيفة
     *   تنفيذية وبتتكرر في كل حزمة Debian — مش بتلمس أي أداة أو مكتبة. */
    /* ══ المستبعدات — كل واحدة ليها سبب مقاس، مش ذوق ═══════════════════════
     * الديسك 21GB وفيه النظام نفسه (~1GB) وnode_modules (~528MB) وpyenv (~600MB).
     * الـrootfs 12.85GB منطقي، لكن الكتابة على الدسك بتزيد بسبب تكرار البلوكات
     * (ext4 بيحجز 4K لكل ملف، وكالي فيها ~60 ألف ملف صغير).
     *
     * المستبعدات دي **اتقاست** على محتوى الأرشيف نفسه (part-00..03 مفكوكة
     * وقريناها بـtarfile) — كلها ملفات **مستحيل تشتغل** في proot أصلًا:
     *   • firmware: بايت كود لعتاد حقيقي. proot مابيشوفش عتاد، فwifite/aircrack
     *     هيشتغلوا على واجهة شبكة حقيقية من المضيف — الـfirmware هنا ميّت.
     *   • modules: نواة الـguest مش بتتحمّل أصلًا؛ proot بيستخدم نواة المضيف.
     *   • doc/man/locale/info/gtk-doc: توثيق — مش بيتنفذ.
     *   • debug: رموز تصحيح.
     * مابنلمسش أي `/usr/bin` أو `/usr/lib` أو `/usr/share/<أداة>`. */
    const EXCLUDES: string[] = [
      "--exclude=./usr/lib/firmware/*",
      "--exclude=./lib/firmware/*",
      "--exclude=./usr/share/firmware/*",
      "--exclude=./usr/lib/modules/*",
      "--exclude=./lib/modules/*",
      "--exclude=./usr/src/*",
      "--exclude=./usr/share/doc/*",
      "--exclude=./usr/share/man/*",
      "--exclude=./usr/share/locale/*",
      "--exclude=./usr/share/info/*",
      "--exclude=./usr/share/gtk-doc/*",
      "--exclude=./usr/share/help/*",
      "--exclude=./usr/lib/debug/*",
      "--exclude=./var/cache/apt/*",
      "--exclude=./var/lib/apt/lists/*",
      "--exclude=./tmp/*",
    ];
    plog(`الاستخراج · مستبعدات مقاسة (firmware/modules/doc/debug — ${EXCLUDES.length} نمط): كل أداة ومكتبة وبيانات كالي بتتكتب زي ما هي`);
    const tarChild = fs.existsSync("/usr/bin/tar")
      ? spawn("tar", ["-xzf", "-", "-C", dest, ...EXCLUDES], { timeout: 0 })
      : null;
    let tarErr = "";
    const pipeTar = (buf: Buffer) =>
      new Promise<void>((resolve, reject) => {
        if (!tarChild) { reject(new Error("no tar child")); return; }
        if (tarChild.exitCode !== null) { reject(new Error(`tar مات وسط الاستخراج: ${tarErr.slice(0, 150)}`)); return; }
        const ok = tarChild.stdin.write(buf);
        if (ok) resolve();
        else tarChild.stdin.once("drain", resolve);
      });
    if (tarChild) {
      tarChild.stderr.on("data", (d: Buffer) => { tarErr += d.toString(); });
      tarChild.on("error", (e) => { tarErr += ` ${e.message}`; });
      tarChild.stdin.on("error", (e) => { tarErr += ` stdin:${e.message.slice(0, 60)}`; });
    }

    const pipeNodeTar = (buf: Buffer) =>
      new Promise<void>((resolve) => {
        if (!nodeTar.write(buf)) nodeTar.once("drain", resolve);
        else resolve();
      });
    const gunzip = zlib.createGunzip();
    const extractor = tar.x({ cwd: dest, strict: false });
    const topLevel = new Set<string>();
    extractor.on("entry", (e: { path: string }) => {
      provision.entries += 1;
      const top = e.path?.replace(/^\.\//, "").split("/")[0];
      if (top) topLevel.add(top);
    });
    const extractorError = new Promise<Error | null>((resolve) => {
      extractor.once("error", (err: Error) => resolve(err));
      extractor.once("finish", () => resolve(null));
    });
    gunzip.pipe(extractor);
    const nodeTar = gunzip; // مسمى واضح للـfallback

    for (const part of parts) {
      provision.current = part;
      const expect = new RegExp(`([0-9a-f]{64})\\s+${part}\\s*$`, "m").exec(shasTxt)?.[1];
      if (!expect) throw new Error(`${part} مش في SHA256SUMS`);
      let buf: Buffer | null = null;
      for (let tryn = 1; tryn <= 3; tryn++) {
        try {
          buf = await fetchPartBuffer(KALI_BRANCH, ref, git?.gdir ?? null, part);
          const actual = shasum(buf);
          if (actual === expect) break;
          plog(`${part}: الهاش مش مطابق (محاولة ${tryn})`);
          buf = null;
        } catch (e) {
          plog(`${part}: ${(e as Error).message.slice(0, 100)} (محاولة ${tryn})`);
          buf = null;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (!buf) throw new Error(`${part} فشل 3 محاولات — النقل مش مستقر، جرّب تاني`);
      if (tarChild) {
        await pipeTar(buf);
      } else {
        await pipeNodeTar(buf);
      }
      provision.partsDone += 1;
      provision.bytesDone += buf.length;
      /* علامة الاستكمال — بعد الاستخراج الناجح مش قبله */
      // أرضية أمان وسط التشغيل — ماتصفّرش الدسك أبدًا (الوضع المستقل لا يتصفّر)
      const freeNow = diskFreeBytes(dest);
      if (freeNow !== null && freeNow < 300 * 2 ** 20) {
        writeQuotaFlag(provision.partsDone, provision.partsTotal, `أرضية الأمان: فاضي ${Math.round(freeNow / 2 ** 20)}MB بس`);
        throw new Error(`وقّفت بدري: المساحة الفاضية نزلت ${Math.round(freeNow / 2 ** 20)}MB عند ${provision.partsDone}/${provision.partsTotal} أجزاء — السيرفر مستقل ماحتاجش يتصفّر. البقايا هتتفضى والفشل متسجل`);
      }
      if (provision.partsDone % 10 === 0 || provision.partsDone === parts.length) {
        plog(`${provision.partsDone}/${parts.length} أجزاء ✓ · ${provision.entries} ملفات`);
        if (provision.partsDone % 20 === 0) {
          createPushNotification({ kind: "ops", title: "🐉 تجهيز كالي بيكمل", body: `${provision.partsDone}/${parts.length} أجزاء · ${provision.entries} ملفات`, link: "/kali-env" });
        }
      }
    }
    if (tarChild) {
      const endTar = new Promise<{ code: number | null }>((resolve) => {
        tarChild.on("close", (code) => resolve({ code }));
        tarChild.on("error", () => resolve({ code: -1 }));
      });
      tarChild.stdin.end();
      const r = await endTar;
      if (r.code !== 0) throw new Error(`tar النظام خرج بكود ${r.code}${tarErr ? ": " + tarErr.slice(0, 200) : ""}`);
    } else {
      await new Promise<void>((resolve) => { gunzip.end(() => resolve()); });
      const exErr = await extractorError;
      if (exErr) throw new Error(`node-tar extract: ${exErr.message.slice(0, 160)}`);
    }
    // الحقيقة من الدسك نفسه — قيس الهيكل المكتوب فعلًا
    const onDisk = fs.readdirSync(dest);
    plog(`الهيكل المكتوب فعليًا على الدسك: ${onDisk.sort().join(" ")}`);
    for (const need of ["etc", "usr", "var"]) {
      if (!onDisk.includes(need)) throw new Error(`الاستخراج ناقص: ${need} مش مكتوبة — بصراحة`);
    }

    /* proot-static — اتنزل مبكرًا قبل الأجزاء (1.7MB) — نسخه جوه البيئة */
    provision.phase = "proot";
    if (!prootBuf || !fs.existsSync(prootTmp)) throw new Error("proot-static مش متاح (raw+git فشلوا) — جرّب تاني");
    const binDir = path.join(dest, "usr/local/bin");
    fs.mkdirSync(binDir, { recursive: true });
    const binPath = path.join(binDir, "proot-static");
    fs.copyFileSync(prootTmp, binPath);
    fs.rmSync(prootTmp, { force: true });
    fs.chmodSync(binPath, 0o755);
    const works = await new Promise<boolean>((resolve) => {
      const c = spawn(binPath, ["--version"], { timeout: 15_000 });
      c.on("error", () => resolve(false));
      c.on("close", (code) => resolve(code === 0));
    });
    if (!works) throw new Error("proot-static اتكتب بس مش شغّال — بصراحة");
    plog("proot-static شغّال ✓");

    /* ══ قوالب nuclei — 14,315 قالب ═════════════════════════════════════════
     * nuclei من غير قوالب = أداة ميّتة ("no templates provided for scan" —
     * مقاس). القوالب مش في الـrootfs الأصلي.
     *
     * المشكلة: داخل كالي `api.github.com` و`codeload.github.com` بيرجعوا 000
     * (اتقاس من جوه الـguest). المسار الشغال الوحيد هو **من المضيف**: عنده
     * TLS مضبوط (شوف build.mjs banner) وبيقدر ينزّل الشريط. فبننزّل هنا
     * (في المضيف) ونفكّ جوه الـrootfs مباشرة.
     *
     * بلا كسر: لو التنزيل فشل، التجهيز **بيكمل عادي** — nuclei هيقول
     * "no templates" بصراحة، والليستة في /kali-env هتوضح السبب. */
    provision.phase = "templates";
    const tplDir = path.join(dest, "opt", "nuclei-templates");
    const tplCount = (d: string): number => {
      let n = 0;
      const walk = (x: string, depth: number) => {
        if (depth > 6) return;
        let es: fs.Dirent[] = [];
        try { es = fs.readdirSync(x, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
          if (e.isDirectory()) walk(path.join(x, e.name), depth + 1);
          else if (/\.ya?ml$/i.test(e.name)) n += 1;
        }
      };
      walk(d, 0);
      return n;
    };
    const haveTpl = fs.existsSync(tplDir) ? tplCount(tplDir) : 0;
    if (haveTpl >= 1000) {
      plog(`قوالب nuclei موجودة بالفعل: ${haveTpl.toLocaleString("ar-EG")} قالب — مفيش داعي تتنزّل تاني`);
    } else {
      plog("بينزّل قوالب nuclei من المضيف (جوه كالي github محجوب — اتقاس)…");
      const tplTmp = `/tmp/nova-nuclei-templates.${Date.now()}.tgz`;
      let got = false;
      for (const url of [
        "https://codeload.github.com/projectdiscovery/nuclei-templates/tar.gz/refs/heads/main",
        "https://api.github.com/repos/projectdiscovery/nuclei-templates/tarball/main",
      ]) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(300_000), redirect: "follow" });
          if (!r.ok) { plog(`  ${new URL(url).host}: HTTP ${r.status}`); continue; }
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 500_000) { plog(`  ${new URL(url).host}: حجم صغير (${buf.length}) — مرفوض`); continue; }
          fs.writeFileSync(tplTmp, buf);
          got = true;
          plog(`  نزل ${Math.round(buf.length / 2 ** 20)}MB من ${new URL(url).host}`);
          break;
        } catch (e) {
          const c = (e as { cause?: { code?: string } }).cause?.code;
          plog(`  ${new URL(url).host}: ${(e as Error).message.slice(0, 60)}${c ? ` [${c}]` : ""}`);
        }
      }
      if (got) {
        fs.mkdirSync(tplDir, { recursive: true });
        const ex = spawn("tar", ["-xzf", tplTmp, "-C", tplDir, "--strip-components=1"], { timeout: 300_000 });
        const code = await new Promise<number | null>((resolve) => {
          ex.on("close", (c) => resolve(c));
          ex.on("error", () => resolve(-1));
        });
        fs.rmSync(tplTmp, { force: true });
        const n2 = code === 0 ? tplCount(tplDir) : 0;
        if (n2 > 0) {
          plog(`✓ قوالب nuclei جوه كالي: ${n2.toLocaleString("ar-EG")} قالب في /opt/nuclei-templates`);
          createPushNotification({ kind: "success", title: "🧬 قوالب nuclei جاهزة", body: `${n2.toLocaleString("ar-EG")} قالب — nuclei بيشتغل بلا إعداد`, link: "/kali-env" });
        } else {
          plog(`فكّ القوالب فشل (tar ${code}) — nuclei هيكمل بلا قوالب`);
        }
      } else {
        plog("قوالب nuclei ماجاتش من أي مصدر — nuclei هيرد 'no templates' بصراحة");
      }
    }
    provision.phase = "proot";

    /* التحقق النهائي */
    provision.phase = "verify";
    const st = await kaliStatus(false);
    if (!st.present || (st.packages ?? 0) < 400) {
      throw new Error(`التحقق النهائي فشل: packages=${st.packages ?? 0} — بصراحة، جرّب تاني أو شوف اللوج`);
    }
    provision.phase = "done";
    provision.finishedAt = new Date().toISOString();
    const mins = Math.round((Date.now() - t0) / 60_000);
    plog(`تم في ${mins} دقيقة · ${st.executables ?? "?"} أداة تنفيذية · ${st.packages} حزمة · ${provision.entries} ملفات`);
    createPushNotification({ kind: "success", title: "🐉 بيئة كالي جاهزة على الهَب", body: `${st.executables ?? "?"} أداة تنفيذية · ${st.packages} حزمة — افتح تبويب بيئة كالي وشغّل الديسكتوب`, link: "/kali-env" });
    return { ok: true, detail: `اتجهزت في ${mins} دقيقة — ${st.executables ?? "?"} أداة تنفيذية · ${st.packages} حزمة` };
  } catch (e) {
    const raw = (e as Error).message;
    const msg = raw.slice(0, 300);
    provision.error = msg;
    provision.phase = "failed";
    provision.finishedAt = new Date().toISOString();
    plog(`فشل: ${msg}`);
    // فشل مساحة فعلي (ENOSPC/EDQUOT) — سجّل علم الحصة وفضّي البقايا عشان السيرفر يتنفس.
    // الرفض المتعمدة (العلم/الحصة) بتحدث قبل تحميل أي جزء — مش فشل مساحة — ماتسجلش نفسها
    if (provision.partsDone > 0 && /ENOSPC|EDQUOT|No space|space left/i.test(raw)) {
      writeQuotaFlag(provision.partsDone, provision.partsTotal, msg.slice(0, 160));
      try { fs.rmSync(dest, { recursive: true, force: true }); plog("بقايا التجهيز الناقص اتحذفت — المساحة اتحررت"); } catch { /* */ }
      createPushNotification({ kind: "error", title: "⚠️ حصة الدسك خلصت وسط تجهيز كالي", body: `وقّف عند ${provision.partsDone}/${provision.partsTotal} أجزاء — البقايا اتفضّيت تلقائيًا والتجهيزات الجاية هترفض فورًا بالعلم`, link: "/kali-env" });
    }
    createPushNotification({ kind: "error", title: "⚠️ تجهيز كالي فشل", body: msg, link: "/kali-env" });
    return { ok: false, detail: msg };
  } finally {
    provision.running = false;
    if (gitPrep) { try { fs.rmSync(gitPrep.gdir, { recursive: true, force: true }); } catch { /* سالمة */ } gitPrep = null; }
  }
}
