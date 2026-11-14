/**
 * TEST11/TEST12 — كالي الحقيقية المدمجة داخل البرنامج نفسه («احنا معانا كل شيئ»).
 *
 * rootfs كالي كاملة 100% (كل مجموعات الأدوات + HEAVY: metasploit/burpsuite/
 * owasp-zap/seclists كاملة + GUI + proot) بتبنيها CI على فرع kali-rootfs
 * (الجيت هب = التخزين السحابي الدائم)، وscripts/kali-rootfs-fetch.sh بيسحبها
 * ببث streaming جزء-بجزء (الذروة على الدسك = الاستخراج + 90MB بس).
 * دي الطبقة اللي بتشغّلها:
 *  - runKali(cmd): تنفيذ حقيقي داخل البيئة بproot (self-hosting، بلا root).
 *  - kaliStatus(): قياس حقيقي — os-release، عدد الباكدجات من dpkg نفسها،
 *    الأدوات الثقيلة من dpkg والbinaries، بروب تنفيذ nmap، حالة الديسكتوب.
 *  - startDesktop/stopDesktop + watchdog: ديسكتوب Xvfb+fluxbox+x11vnc+noVNC
 *    مع «ضمان استمرار العمل» — الحالة المرغوبة محفوظة، والساعة بترجّعه لو وقع.
 *  - buildDesktopUrl: رابط نسبي عبر الهَب نفسه (/api/ops/kali/novnc/…) —
 *    يشتغل من أي دومين بيوصل للهَب (nova.waifly.com/agent-pro أو معاينة).
 * كل رقم بيرجع من الملفات والعمليات — مفيش ادعاء بيئة وهمية.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
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

const TCP_CHECK_TIMEOUT = 1200;

function repoRoots(): string[] {
  const cwd = process.cwd();
  const up2 = path.resolve(cwd, "../..");
  return [
    process.env.NOVA_KALI_ROOT ?? "",
    `${process.env.HOME ?? "/home/user"}/kali-rootfs/rootfs`,
    path.join(cwd, ".cache/kali/rootfs"),
    path.join(cwd, "state/kali/rootfs"),
    path.join(up2, ".cache/kali/rootfs"),
    path.join(up2, "state/kali/rootfs"),
  ].filter(Boolean);
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

function kaliExecScript(): string | null {
  const candidates = [
    process.env.NOVA_KALI_EXEC ?? "",
    path.resolve(process.cwd(), "scripts/kali-exec.sh"),
    path.resolve(process.cwd(), "../../scripts/kali-exec.sh"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      /* مش موجود */
    }
  }
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

/** تنفيذ أمر حقيقي داخل كالي — spawn للسكربت، timeout صارم، قص مخرجات محفوظ. */
export function runKali(cmd: string, timeoutMs = 60_000): Promise<KaliExecResult> {
  const script = kaliExecScript();
  const t0 = Date.now();
  if (!script) {
    return Promise.resolve({
      ok: false, cmd, exitCode: null, stdout: "", stderr: "سكربت kali-exec.sh مش موجود", durationMs: 0,
    });
  }
  return new Promise((resolve) => {
    const child = spawn("bash", [script, cmd], { cwd: process.cwd(), timeout: timeoutMs, killSignal: "SIGKILL" });
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

/* ── الأدوات الثقيلة — مقاسة من سجل dpkg نفسه (الحقيقة، مش الادعاء) ── */
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

/* ── الحالة المرغوبة — «ضمان استمرار العمل»: لو وقعت بترجع لوحدها ── */
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
  } catch { /* سالمة — الواتشدوج بيشتغل بالحالة العابرة */ }
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

  const engine = kaliExecScript() ?? undefined;
  const [vnc, novnc] = await Promise.all([tcpOpen(5901), tcpOpen(6080)]);
  const st: KaliStatus = {
    present: true, prettyName, packages, builtAt, root, engine,
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

/** رابط noVNC نسبي عبر الهَب نفسه — يشتغل من nova.waifly.com أو أي دومين بيوصله.
 * التوكن بيتحط في الquery بس لو الطلب نفسه اتوثّق بيه. */
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

function desktopScriptPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "scripts/kali-desktop.sh"),
    path.resolve(process.cwd(), "../../scripts/kali-desktop.sh"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/** تشغيل الديسكتوب الحقيقي (سكربت detached) + انتظار noVNC فعلي. */
export async function startDesktop(): Promise<{ ok: boolean; detail: string }> {
  const s = desktopScriptPath();
  if (!s || !kaliRoot()) return { ok: false, detail: "السكربت أو الrootfs مش موجودين — scripts/kali-rootfs-fetch.sh بيجيبهم" };
  const log = "/tmp/kali-desktop-hub.log";
  fs.openSync(log, "a");
  const child = spawn("bash", [s], { detached: true, stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")] });
  child.unref();
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
  return { ok: up, detail: up ? "noVNC فتح فعليًا على 6080 (مقاس بالاتصال)" : "الموقت خلص والبورت مقفول — اللوج في /tmp/kali-desktop-hub.log" };
}

/** إطفاء الديسكتوب — pkill على العمليات الحقيقية + إلغاء الحالة المرغوبة. */
export function stopDesktop(): { ok: boolean; detail: string } {
  try {
    execSync('pkill -f "Xvfb :99"; pkill -f x11vnc; pkill -f "websockify.*6080"', { timeout: 5_000 });
    writeDesired({ desktopEnabled: false });
    createPushNotification({ kind: "ops", title: "🖥️ ديسكتوب كالي اتفصّل", body: "كل العمليات اتقفلت", link: "/kali-env" });
    return { ok: true, detail: "اتقفلت (pkill مقاس)" };
  } catch (e) {
    writeDesired({ desktopEnabled: false });
    return { ok: false, detail: `pkill خرج بكود ${(e as { status?: number }).status ?? "?"} — يمكن مافيش عمليات شغّالة أصلًا` };
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
