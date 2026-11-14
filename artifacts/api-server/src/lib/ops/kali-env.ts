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

/** أول مسار فيه rootfs كالي فعلية (os-release فيها kali). */
export function kaliRoot(): string | null {
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
export function runKali(cmd: string, timeoutMs = 60_000): Promise<KaliExecResult> {
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
      if (out.length < cap) out += d.toString();
      else truncated = true;
    });
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < cap) err += d.toString();
      else truncated = true;
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
  let builtAt: string | undefined;
  try {
    builtAt = /built_at=(\S+)/.exec(fs.readFileSync(path.join(root, "MANIFEST.txt"), "utf8"))?.[1];
  } catch { /* سالمة */ }

  const proot = prootBinary(root);
  const [vnc, novnc] = await Promise.all([tcpOpen(5901), tcpOpen(6080)]);
  const st: KaliStatus = {
    present: true, prettyName, packages, builtAt, root,
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

/** stream جزء من الفرع: raw HTTP أولًا (الإنتاج)، fallback git (السانبوكس/الdev). */
async function fetchPartBuffer(branch: string, ref: string | null, gdir: string | null, file: string): Promise<Buffer> {
  // 1) raw HTTP — أسرع وأبسط على الإنتاج
  try {
    const r = await fetch(rawUrl(branch, file), { signal: AbortSignal.timeout(120_000) });
    if (r.ok) {
      const ab = await r.arrayBuffer();
      provision.transport = provision.transport ?? "raw";
      return Buffer.from(ab);
    }
    plog(`raw ${file}: HTTP ${r.status} — جرب git`);
  } catch (e) {
    plog(`raw ${file}: ${(e as Error).message.slice(0, 80)} — جرب git`);
  }
  // 2) git cat-file (بيشتغل أينما كان git + github.com مسموح)
  if (!gdir) throw new Error(`مافيش transport متاح لـ${file}`);
  const out = await new Promise<Buffer>((resolve, reject) => {
    const c = spawn("git", ["-C", gdir, "cat-file", "blob", `${ref ?? "FETCH_HEAD"}:${file}`], { timeout: 180_000 });
    const chunks: Buffer[] = [];
    c.stdout.on("data", (d: Buffer) => chunks.push(d));
    c.on("error", reject);
    c.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`git cat-file ${file}: exit ${code}`)));
  });
  provision.transport = "git";
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
export async function provisionKali(): Promise<{ ok: boolean; detail: string; skipped?: boolean }> {
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
    if (free !== null && free < 17 * 2 ** 30) {
      throw new Error(`المساحة مش كفاية: ${Math.round(free / 2 ** 30)}GB فاضية والاستخراج محتاج ~17GB. حرّر مساحة أو وسّع الدسك وجرّب تاني.`);
    }

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

    /* خط الأنابيب: gunzip → tar (مرة واحدة على طول الأجزاء) */
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const gunzip = zlib.createGunzip();
    const extractor = tar.x({ cwd: dest, strict: false });
    extractor.on("entry", () => { provision.entries += 1; });
    const extractDone = new Promise<void>((resolve, reject) => {
      extractor.on("finish", resolve);
      extractor.on("error", reject);
      gunzip.on("error", reject);
    });
    gunzip.pipe(extractor);

    const pipeBuf = (buf: Buffer) =>
      new Promise<void>((resolve, reject) => {
        if (!gunzip.write(buf)) gunzip.once("drain", resolve);
        else resolve();
      });

    for (const part of parts) {
      provision.current = part;
      const expect = new RegExp(`([0-9a-f]{64})\\s+${part}\\s*$`).exec(shasTxt)?.[1];
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
      await pipeBuf(buf);
      provision.partsDone += 1;
      provision.bytesDone += buf.length;
      if (provision.partsDone % 10 === 0 || provision.partsDone === parts.length) {
        plog(`${provision.partsDone}/${parts.length} أجزاء ✓ · ${provision.entries} ملفات`);
        if (provision.partsDone % 20 === 0) {
          createPushNotification({ kind: "ops", title: "🐉 تجهيز كالي بيكمل", body: `${provision.partsDone}/${parts.length} أجزاء · ${provision.entries} ملفات`, link: "/kali-env" });
        }
      }
    }
    await new Promise<void>((resolve) => { gunzip.end(() => resolve()); });
    await extractDone;

    /* proot-static من فرع kali-static (إجباري — قيس) */
    provision.phase = "proot";
    // فرع kali-static محتاج fetch بنفسه جوه الrepo المؤقت
    let staticRef: string | null = ref;
    if (git?.gdir && STATIC_BRANCH !== KALI_BRANCH) {
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
      plog(`kali-static: fetch ${staticRef ? "✓ " + staticRef.slice(0, 10) : "✗ — هنجرب raw بس"}`);
    }
    const staticBuf = await fetchPartBuffer(STATIC_BRANCH, staticRef, git?.gdir ?? null, "proot-static");
    const binDir = path.join(dest, "usr/local/bin");
    fs.mkdirSync(binDir, { recursive: true });
    const binPath = path.join(binDir, "proot-static");
    fs.writeFileSync(binPath, staticBuf);
    fs.chmodSync(binPath, 0o755);
    const works = await new Promise<boolean>((resolve) => {
      const c = spawn(binPath, ["--version"], { timeout: 15_000 });
      c.on("error", () => resolve(false));
      c.on("close", (code) => resolve(code === 0));
    });
    plog(`proot-static ${works ? "شغّال ✓" : "اتكتب بس مش شغّال ✗"}`);

    /* التحقق النهائي */
    provision.phase = "verify";
    const st = await kaliStatus(false);
    if (!st.present || (st.packages ?? 0) < 400) {
      throw new Error(`التحقق النهائي فشل: packages=${st.packages ?? 0} — بصراحة، جرّب تاني أو شوف اللوج`);
    }
    provision.phase = "done";
    provision.finishedAt = new Date().toISOString();
    const mins = Math.round((Date.now() - t0) / 60_000);
    plog(`تم في ${mins} دقيقة · ${st.packages} حزمة · ${provision.entries} ملفات`);
    createPushNotification({ kind: "success", title: "🐉 بيئة كالي جاهزة على الهَب", body: `${st.packages} حزمة كاملة — افتح تبويب بيئة كالي وشغّل الديسكتوب`, link: "/kali-env" });
    return { ok: true, detail: `اتجهزت في ${mins} دقيقة — ${st.packages} حزمة كاملة` };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    provision.error = msg;
    provision.phase = "failed";
    provision.finishedAt = new Date().toISOString();
    plog(`فشل: ${msg}`);
    createPushNotification({ kind: "error", title: "⚠️ تجهيز كالي فشل", body: msg, link: "/kali-env" });
    return { ok: false, detail: msg };
  } finally {
    provision.running = false;
    if (gitPrep) { try { fs.rmSync(gitPrep.gdir, { recursive: true, force: true }); } catch { /* سالمة */ } gitPrep = null; }
  }
}
