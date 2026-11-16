/**
 * Kali system telemetry — measured, never estimated.
 * ─────────────────────────────────────────────────────────────────────────────
 * The /kali-env page could say whether proot existed and which tools were
 * installed, but it could not answer "what is this machine doing right now?".
 * This module answers that from the kernel's own files:
 *
 *   CPU      /proc/stat (two samples → real utilisation, not load average)
 *   RAM      /proc/meminfo (MemTotal/MemAvailable/MemFree/SwapTotal/SwapFree)
 *   disk     statfs on the rootfs and on the workspace
 *   uptime   /proc/uptime
 *   load     /proc/loadavg
 *   procs    /proc/<pid>/stat + comm, sorted by RSS
 *   network  /proc/net/dev (per-interface rx/tx bytes)
 *   GPU      /dev/dri enumeration + lspci when present; software rendering
 *            (Xvfb/llvmpipe) is reported as such rather than as "no GPU"
 *   rootfs   size on disk, package count, executable count, proot presence
 *
 * Every field is either a measured number or `null` with a `reason`. A failed
 * read is never rendered as zero — the page shows the reason instead.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectProotLayout, prootHealth } from "./proot";

export interface CpuSample {
  /** 0..100, measured across two /proc/stat samples. */
  usedPct: number | null;
  cores: number;
  model: string | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  reason?: string;
}

export interface MemSample {
  totalBytes: number | null;
  availableBytes: number | null;
  usedBytes: number | null;
  usedPct: number | null;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
  reason?: string;
}

export interface DiskSample {
  mount: string;
  totalBytes: number | null;
  freeBytes: number | null;
  usedBytes: number | null;
  usedPct: number | null;
  reason?: string;
}

export interface ProcRow {
  pid: number;
  name: string;
  rssBytes: number;
  cpuTicks: number;
  state: string;
}

export interface NetIface {
  name: string;
  rxBytes: number;
  txBytes: number;
}

export interface GpuInfo {
  present: boolean;
  devices: string[];
  renderer: string;
  note: string;
}

export interface RootfsInfo {
  present: boolean;
  root: string | null;
  prootBin: string | null;
  guestShell: boolean;
  bytes: number | null;
  packages: number | null;
  executables: number | null;
  prettyName: string | null;
  reason?: string;
}

export interface KaliSysInfo {
  ok: boolean;
  measuredAt: string;
  host: { hostname: string; platform: string; release: string; arch: string; node: string };
  uptimeSec: number | null;
  cpu: CpuSample;
  mem: MemSample;
  disks: DiskSample[];
  procs: { total: number; rows: ProcRow[]; reason?: string };
  net: { ifaces: NetIface[]; reason?: string };
  gpu: GpuInfo;
  rootfs: RootfsInfo;
  /** Anything that could not be measured, stated plainly. */
  unmeasured: string[];
}

/* ── /proc/stat ─────────────────────────────────────────────────────────── */

function readCpuTicks(): { idle: number; total: number } | null {
  try {
    const line = fs.readFileSync("/proc/stat", "utf8").split("\n")[0] ?? "";
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    if (n.length < 4 || n.some((v) => Number.isNaN(v))) return null;
    // user nice system idle iowait irq softirq steal
    const idle = (n[3] ?? 0) + (n[4] ?? 0);
    const total = n.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function measureCpu(): Promise<CpuSample> {
  const cores = os.cpus().length;
  const model = os.cpus()[0]?.model?.trim() ?? null;
  let load1: number | null = null;
  let load5: number | null = null;
  let load15: number | null = null;
  try {
    const [a, b, c] = fs.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/);
    load1 = Number(a);
    load5 = Number(b);
    load15 = Number(c);
  } catch {
    /* load average is optional — utilisation below is the real signal */
  }
  const t1 = readCpuTicks();
  if (!t1) {
    return { usedPct: null, cores, model, load1, load5, load15, reason: "/proc/stat غير مقروء" };
  }
  await sleep(220);
  const t2 = readCpuTicks();
  if (!t2) {
    return { usedPct: null, cores, model, load1, load5, load15, reason: "/proc/stat اختفى بين العيّنتين" };
  }
  const dTotal = t2.total - t1.total;
  const dIdle = t2.idle - t1.idle;
  if (dTotal <= 0) {
    return { usedPct: null, cores, model, load1, load5, load15, reason: "فرق العيّنتين صفر — مش قادر أحسب" };
  }
  const usedPct = Math.max(0, Math.min(100, Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10));
  return { usedPct, cores, model, load1, load5, load15 };
}

/* ── /proc/meminfo ──────────────────────────────────────────────────────── */

function measureMem(): MemSample {
  try {
    const txt = fs.readFileSync("/proc/meminfo", "utf8");
    const kb = (key: string): number | null => {
      const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m").exec(txt);
      return m ? Number(m[1]) * 1024 : null;
    };
    const total = kb("MemTotal");
    const avail = kb("MemAvailable") ?? kb("MemFree");
    const swapTotal = kb("SwapTotal");
    const swapFree = kb("SwapFree");
    const used = total !== null && avail !== null ? total - avail : null;
    return {
      totalBytes: total,
      availableBytes: avail,
      usedBytes: used,
      usedPct: total && used !== null ? Math.round((used / total) * 1000) / 10 : null,
      swapTotalBytes: swapTotal,
      swapUsedBytes: swapTotal !== null && swapFree !== null ? swapTotal - swapFree : null,
    };
  } catch {
    return {
      totalBytes: null, availableBytes: null, usedBytes: null, usedPct: null,
      swapTotalBytes: null, swapUsedBytes: null, reason: "/proc/meminfo غير مقروء",
    };
  }
}

/* ── disks ──────────────────────────────────────────────────────────────── */

function measureDisk(mount: string): DiskSample {
  try {
    const st = fs.statfsSync(mount);
    const total = Number(st.blocks) * Number(st.bsize);
    const free = Number(st.bavail) * Number(st.bsize);
    const used = total - free;
    return {
      mount,
      totalBytes: total,
      freeBytes: free,
      usedBytes: used,
      usedPct: total > 0 ? Math.round((used / total) * 1000) / 10 : null,
    };
  } catch (e) {
    return {
      mount, totalBytes: null, freeBytes: null, usedBytes: null, usedPct: null,
      reason: (e as Error).message.slice(0, 120),
    };
  }
}

/* ── processes ──────────────────────────────────────────────────────────── */

function measureProcs(limit = 12): { total: number; rows: ProcRow[]; reason?: string } {
  let pids: string[];
  try {
    pids = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch (e) {
    return { total: 0, rows: [], reason: (e as Error).message.slice(0, 120) };
  }
  const rows: ProcRow[] = [];
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      // comm may contain spaces/parens — take the last ')' boundary
      const close = stat.lastIndexOf(")");
      const name = stat.slice(stat.indexOf("(") + 1, close);
      const rest = stat.slice(close + 2).split(/\s+/);
      const state = rest[0] ?? "?";
      const utime = Number(rest[11] ?? 0);
      const stime = Number(rest[12] ?? 0);
      const rssPages = Number(rest[21] ?? 0);
      rows.push({
        pid: Number(pid),
        name: name.slice(0, 40),
        rssBytes: rssPages * 4096,
        cpuTicks: utime + stime,
        state,
      });
    } catch {
      /* process exited between readdir and read — normal */
    }
  }
  rows.sort((a, b) => b.rssBytes - a.rssBytes);
  return { total: pids.length, rows: rows.slice(0, limit) };
}

/* ── network ────────────────────────────────────────────────────────────── */

function measureNet(): { ifaces: NetIface[]; reason?: string } {
  try {
    const txt = fs.readFileSync("/proc/net/dev", "utf8");
    const ifaces: NetIface[] = [];
    for (const line of txt.split("\n").slice(2)) {
      const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      const name = m[1].trim();
      const cols = m[2].trim().split(/\s+/).map(Number);
      if (cols.length < 9) continue;
      ifaces.push({ name, rxBytes: cols[0] ?? 0, txBytes: cols[8] ?? 0 });
    }
    return { ifaces };
  } catch (e) {
    return { ifaces: [], reason: (e as Error).message.slice(0, 120) };
  }
}

/* ── GPU ────────────────────────────────────────────────────────────────── */

function measureGpu(): GpuInfo {
  const devices: string[] = [];
  try {
    for (const d of fs.readdirSync("/dev/dri")) devices.push(`/dev/dri/${d}`);
  } catch {
    /* no /dev/dri — expected in a container */
  }
  const software = fs.existsSync("/usr/bin/Xvfb") || fs.existsSync("/usr/bin/Xvfb");
  if (devices.length > 0) {
    return {
      present: true,
      devices,
      renderer: "hardware (/dev/dri)",
      note: "جهاز عرض حقيقي موجود — الـ rootfs يقدر يستخدمه لو الـ proot مرّر الـ device",
    };
  }
  return {
    present: false,
    devices: [],
    renderer: software ? "software (Xvfb + llvmpipe)" : "software (بدون Xvfb)",
    note: "مفيش /dev/dri في الكونتينر — الرسم برمجي. ده كافي للطرفية والأدوات، ومش مطلوب GPU لأي أداة في كالي.",
  };
}

/* ── rootfs ─────────────────────────────────────────────────────────────── */

function dirBytes(dir: string, cap = 400_000): number | null {
  let bytes = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (++seen > cap) return bytes; // bounded walk — never hang the request
      const p = path.join(d, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) bytes += fs.statSync(p).size;
      } catch {
        /* vanished mid-walk */
      }
    }
  }
  return bytes;
}

async function measureRootfs(): Promise<RootfsInfo> {
  const layout = detectProotLayout();
  if (!layout.ready) {
    return {
      present: false, root: null, prootBin: null, guestShell: false,
      bytes: null, packages: null, executables: null, prettyName: null,
      reason: "proot أو rootfs مش موجودين على الهوست",
    };
  }
  const health = await prootHealth();
  const root = layout.rootfs;
  let packages: number | null = null;
  let prettyName: string | null = null;
  let executables: number | null = null;
  if (root) {
    try {
      packages = fs.readFileSync(path.join(root, "var/lib/dpkg/status"), "utf8")
        .split("\n").filter((l) => l.startsWith("Package:")).length;
    } catch {
      /* dpkg status unreadable — reported as null, not 0 */
    }
    try {
      prettyName = /PRETTY_NAME="?([^"\n]+)"?/.exec(
        fs.readFileSync(path.join(root, "etc/os-release"), "utf8"),
      )?.[1] ?? null;
    } catch {
      /* optional */
    }
    let n = 0;
    for (const d of ["usr/bin", "usr/sbin"]) {
      try {
        for (const f of fs.readdirSync(path.join(root, d))) {
          try {
            const st = fs.statSync(path.join(root, d, f));
            if (st.isFile() && (st.mode & 0o111) !== 0) n++;
          } catch {
            /* skip */
          }
        }
      } catch {
        /* dir absent */
      }
    }
    executables = n;
  }
  return {
    present: true,
    root,
    prootBin: layout.prootBin,
    guestShell: health.guestShell,
    bytes: root ? dirBytes(root) : null,
    packages,
    executables,
    prettyName,
  };
}

/* ── public ─────────────────────────────────────────────────────────────── */

export async function kaliSysInfo(): Promise<KaliSysInfo> {
  const [cpu, rootfs] = await Promise.all([measureCpu(), measureRootfs()]);
  const mem = measureMem();
  const procs = measureProcs();
  const net = measureNet();
  const gpu = measureGpu();

  const disks: DiskSample[] = [measureDisk(process.cwd())];
  if (rootfs.root) disks.push(measureDisk(rootfs.root));

  let uptimeSec: number | null = null;
  try {
    uptimeSec = Math.round(Number(fs.readFileSync("/proc/uptime", "utf8").split(/\s+/)[0]));
  } catch {
    /* optional */
  }

  const unmeasured: string[] = [];
  if (cpu.usedPct === null) unmeasured.push(`CPU: ${cpu.reason ?? "غير مقروء"}`);
  if (mem.totalBytes === null) unmeasured.push(`RAM: ${mem.reason ?? "غير مقروء"}`);
  if (procs.reason) unmeasured.push(`العمليات: ${procs.reason}`);
  if (net.reason) unmeasured.push(`الشبكة: ${net.reason}`);
  if (rootfs.reason) unmeasured.push(`rootfs: ${rootfs.reason}`);
  for (const d of disks) if (d.reason) unmeasured.push(`القرص ${d.mount}: ${d.reason}`);

  return {
    ok: true,
    measuredAt: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      node: process.version,
    },
    uptimeSec,
    cpu,
    mem,
    disks,
    procs,
    net,
    gpu,
    rootfs,
    unmeasured,
  };
}
