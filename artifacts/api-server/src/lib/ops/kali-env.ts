/**
 * TEST11 — كالي الحقيقية المدمجة داخل البرنامج نفسه («احنا معانا كل شيئ»).
 *
 * rootfs كالي كاملة (أدوات + GUI + proot) بتبنيها CI على فرع kali-rootfs،
 * والfetch script بيستخرجها محليًا. دي الطبقة اللي بتشغّلها:
 *  - runKali(cmd): تنفيذ حقيقي داخل البيئة بproot (self-hosting، بلا root).
 *  - kaliStatus(): قياس حقيقي — os-release، عدد الباكدجات من dpkg نفسها،
 *    بروب تنفيذ nmap، وحالة الديسكتوب من البورتات الفعلية.
 *  - startDesktop/stopDesktop: ديسكتوب Xvfb+fluxbox+x11vnc+noVNC حقيقي.
 * كل رقم بيرجع من الملفات والعمليات — مفيش ادعاء بيئة وهمية.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createPushNotification } from "../push-hub";

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
  desktop?: { running: boolean; vncPort: boolean; novncPort: boolean };
}

const TCP_CHECK_TIMEOUT = 1200;

function repoRoots(): string[] {
  const cwd = process.cwd();
  const up2 = path.resolve(cwd, "../..");
  return [
    process.env.NOVA_KALI_ROOT ?? "",
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

/** حالة مقاسة بالكامل — من الملفات والبورتات والبروب الفعلي. */
export async function kaliStatus(withProbe = true): Promise<KaliStatus> {
  const root = kaliRoot();
  if (!root) return { present: false, root: null };
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
    desktop: { running: vnc && novnc, vncPort: vnc, novncPort: novnc },
  };
  if (withProbe) {
    const probe = await runKali("nmap --version | head -1", 20_000);
    st.probe = probe.ok
      ? { ok: true, version: probe.stdout.trim() || "nmap" }
      : { ok: false, detail: probe.stderr.slice(0, 200) || `exit=${probe.exitCode}` };
  }
  return st;
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

/** تشغيل الديسكتوب الحقيقي (سكربت detached) + انتظار noVNC فعلي. */
export async function startDesktop(): Promise<{ ok: boolean; detail: string }> {
  const candidates = [
    path.resolve(process.cwd(), "scripts/kali-desktop.sh"),
    path.resolve(process.cwd(), "../../scripts/kali-desktop.sh"),
  ];
  let s: string | null = null;
  for (const c of candidates) if (fs.existsSync(c)) { s = c; break; }
  if (!s || !kaliRoot()) return { ok: false, detail: "السكربت أو الrootfs مش موجودين" };
  const log = "/tmp/kali-desktop-hub.log";
  fs.openSync(log, "a");
  const child = spawn("bash", [s], { detached: true, stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")] });
  child.unref();
  const up = await waitPort(6080, 45_000);
  if (up) {
    createPushNotification({
      kind: "ops",
      title: "🖥️ ديسكتوب كالي شغّال",
      body: "Xvfb + fluxbox + noVNC على 6080 — افتحه من مركز كالي",
      link: "/kali-command",
    });
  }
  return { ok: up, detail: up ? "noVNC فتح فعليًا على 6080 (مقاس بالاتصال)" : "الموقت خلص والبورت مقفول — اللوج في /tmp/kali-desktop-hub.log" };
}

/** إطفاء الديسكتوب — pkill على العمليات الحقيقية. */
export function stopDesktop(): { ok: boolean; detail: string } {
  try {
    execSync('pkill -f "Xvfb :99"; pkill -f x11vnc; pkill -f "websockify.*6080"', { timeout: 5_000 });
    createPushNotification({ kind: "ops", title: "🖥️ ديسكتوب كالي اتفصّل", body: "كل العمليات اتقفلت", link: "/kali-command" });
    return { ok: true, detail: "اتقفلت (pkill مقاس)" };
  } catch (e) {
    return { ok: false, detail: `pkill خرج بكود ${(e as { status?: number }).status ?? "?"} — يمكن مافيش عمليات شغّالة أصلًا` };
  }
}

/** رابط noVNC المشتق من Host بتاع الطلب (نمط المعاينة: {port}-{sandbox}.e2b.app). */
export function desktopUrlFromHost(host: string | undefined): string | null {
  if (!host) return null;
  const m = /^(\d+)-([a-z0-9.-]+)$/i.exec(host);
  if (!m) return null;
  return `https://6080-${m[2]}/vnc.html?autoconnect=1`;
}
