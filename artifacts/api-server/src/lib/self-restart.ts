/**
 * Self-restart — the loop that makes «حدّث نفسك» actually finish.
 * ─────────────────────────────────────────────────────────────
 * Measured 2026-11-05 on the live Waifly slot, and it is the reason four
 * releases in a row looked «shipped» while the site still served old code:
 *
 *   pid 28, startedAt 01:26:03 · build.json on disk 02:34:39 · updater said
 *   «installed» at 02:41 · seven minutes later the process was still pid 28.
 *
 * The restart depended on a *separate* Python updater guessing the HTTP port
 * and calling `/api/nova-core/restart` (`PORT_CANDIDATES = (27214,)` — a port
 * that no host has used for weeks). When the guess missed, the updater still
 * exited 0, and the app still wrote «اتطبّقت النسخة الجديدة — المُشرف بيعيد
 * التشغيل». Nothing restarted, and nothing could tell.
 *
 * Three fixes live here:
 *
 *   1. **The app writes the marker itself.** It already knows its state dir, so
 *      no HTTP, no port guess, no Python. If the installer succeeded, the
 *      reload request is written by the process that knows the path is right.
 *   2. **The boot build is captured once** (`bootBuild()`), so «which code is
 *      actually running?» is answerable from inside the process — the disk
 *      fingerprint alone can never answer it.
 *   3. **A supervisor-less bundle can still reload**, but only when asked
 *      (`?force=1`): it spawns a replacement after this one lets go of the
 *      port, so the free-host case is not stuck on a panel button.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export interface BuildFingerprint {
  commit: string | null;
  builtAt: string | null;
  dir: string | null;
}

/** Where the bundle lives: the dir that holds build.json. */
export function appDir(): string {
  const candidates = [
    process.cwd(),
    process.env.NOVA_STATIC_DIR ? path.resolve(process.env.NOVA_STATIC_DIR, "..") : "",
    path.resolve(process.cwd(), ".."),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "build.json"))) return dir;
  }
  return process.cwd();
}

/** Read build.json from the bundle dir (fresh read — describes the DISK). */
export function diskBuild(): BuildFingerprint {
  for (const dir of [appDir(), process.cwd(), ...(process.env.NOVA_STATIC_DIR ? [path.resolve(process.env.NOVA_STATIC_DIR, "..")] : [])]) {
    const f = path.join(dir, "build.json");
    if (!fs.existsSync(f)) continue;
    try {
      const b = JSON.parse(fs.readFileSync(f, "utf8")) as { commit?: string; builtAt?: string };
      return { commit: b.commit ?? null, builtAt: b.builtAt ?? null, dir };
    } catch {
      /* a broken build.json must not crash a status endpoint */
    }
  }
  return { commit: null, builtAt: null, dir: null };
}

/**
 * The build this process booted from — captured at import, never re-read.
 * This is the only honest answer to «is the running code the shipped code?».
 */
const BOOT: BuildFingerprint = diskBuild();

export function bootBuild(): BuildFingerprint {
  return { ...BOOT };
}

/** Disk vs running process. `stale` is the condition that used to be invisible. */
export function buildDrift(): { boot: BuildFingerprint; disk: BuildFingerprint; stale: boolean; startedAt: string } {
  const disk = diskBuild();
  return {
    boot: { ...BOOT },
    disk,
    stale: Boolean(BOOT.builtAt && disk.builtAt && BOOT.builtAt !== disk.builtAt),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  };
}

/* ── the reload marker ─────────────────────────────────────────────────────── */

function stateDir(): string {
  if (process.env.NOVA_STATE_DIR) return process.env.NOVA_STATE_DIR;
  if (process.env.NOVA_MEMORY_FILE) return path.dirname(process.env.NOVA_MEMORY_FILE);
  if (process.env.NOVA_STATIC_DIR) return path.resolve(process.env.NOVA_STATIC_DIR, "..", "state");
  return path.resolve(appDir(), "state");
}

/** Same candidates `boot.mjs` watches (`HERE/state/.nova-restart`). */
export function restartMarkerPaths(): string[] {
  const out: string[] = [path.join(stateDir(), ".nova-restart")];
  if (process.env.NOVA_STATIC_DIR) out.push(path.resolve(process.env.NOVA_STATIC_DIR, "..", "state", ".nova-restart"));
  out.push(path.resolve(process.cwd(), "state", ".nova-restart"));
  // The bundle dir is where `boot.mjs` computes HERE from, so it is the one
  // that matters when cwd is the parent (measured: cwd=/home/container with the
  // bundle extracted at the top level).
  out.push(path.join(appDir(), "state", ".nova-restart"));
  return [...new Set(out.map((p) => path.resolve(p)))];
}

let markerSeq = 0;

export function writeRestartMarker(): string[] {
  const written: string[] = [];
  // The sequence number matters: two writes inside the same millisecond would
  // produce an identical file, and `boot.mjs` compares mtime — an unchanged
  // byte count with an unchanged mtime is a reload that never happens.
  markerSeq += 1;
  const stamp = `${new Date().toISOString()} pid=${process.pid} seq=${markerSeq} ms=${Date.now()}\n`;
  for (const p of restartMarkerPaths()) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, stamp);
      written.push(p);
    } catch {
      /* the next candidate may still be writable */
    }
  }
  if (written.length) log(`restart marker written: ${written.join(", ")}`);
  return written;
}

/* ── what happened, in words, for the status endpoints ─────────────────────── */

const HISTORY: { at: string; what: string }[] = [];

export function log(what: string): void {
  HISTORY.push({ at: new Date().toISOString(), what });
  if (HISTORY.length > 40) HISTORY.splice(0, HISTORY.length - 40);
}

export function restartHistory(): { at: string; what: string }[] {
  return HISTORY.slice();
}

/* ── request a reload, and check whether it actually happened ─────────────── */

const supervised = (): boolean => process.env.NOVA_SUPERVISED === "1";

/**
 * Ask for a reload and verify it took effect.
 *
 * `verifyMs` later we are still running — that means nobody acted on the
 * marker, so the caller gets `reloaded: false` and can say so instead of
 * claiming success. (A successful reload never runs the callback: this process
 * is gone by then.)
 */
export function requestReload(opts: { verifyMs?: number; then?: (info: { reloaded: boolean; marker: string[] }) => void } = {}): string[] {
  const marker = writeRestartMarker();
  const verifyMs = opts.verifyMs ?? 8000;
  if (opts.then) {
    const t = setTimeout(() => {
      log(`still alive ${verifyMs}ms after the marker — no supervisor acted on it`);
      opts.then?.({ reloaded: false, marker });
    }, verifyMs);
    // Never keep the process alive just to report a failed reload.
    (t as unknown as { unref?: () => void }).unref?.();
  }
  return marker;
}

/* ── the supervisor-less case ─────────────────────────────────────────────── */

const respawnCount = (): number => Number(process.env.NOVA_RESPAWN_COUNT || 0);

/** The script this process was started from (`nova-app.mjs`). */
function entryPath(): string | null {
  if (process.env.NOVA_ENTRY) return process.env.NOVA_ENTRY;
  const bundled = path.join(appDir(), "nova-app.mjs");
  if (fs.existsSync(bundled)) return bundled;
  const argv1 = process.argv[1];
  if (argv1 && fs.existsSync(argv1)) return path.resolve(argv1);
  return null;
}

export function canSelfRespawn(): { ok: boolean; reason: string; entry: string | null } {
  const entry = entryPath();
  if (!entry) return { ok: false, reason: "مش لاقي الملف اللي بيتشغّل منه البرنامج (nova-app.mjs)", entry: null };
  if (respawnCount() >= 3) return { ok: false, reason: "جرّبنا نعيد التشغيل 3 مرات — هنسيبها للمُشرف أو اللوحة", entry };
  // A process that just started should not immediately replace itself: that is
  // how a reload loop is born, and a loop on a 300 MB slot is a dead slot.
  if (process.uptime() < 20) return { ok: false, reason: `العملية دي عمرها ${Math.round(process.uptime())} ثانية — استنى شوية`, entry };
  return { ok: true, reason: "جاهز", entry };
}

/**
 * Replace this process with a fresh one.
 *
 * Order matters: the child waits 3 s before binding, this process exits first,
 * so the port is free when the new one arrives. Only used when there is no
 * supervisor to do it — under `boot.mjs` the marker is enough and a second
 * process would fight for the port.
 */
export function selfRespawn(): { ok: boolean; reason: string; entry?: string | null } {
  const check = canSelfRespawn();
  if (!check.ok) {
    log(`self-respawn refused: ${check.reason}`);
    return { ok: false, reason: check.reason };
  }
  const entry = check.entry as string;
  const count = respawnCount() + 1;
  try {
    const child = spawn("/bin/sh", ["-c", `sleep 3; exec "${process.execPath}" "${entry}"`], {
      cwd: appDir(),
      detached: true,
      stdio: "ignore",
      env: { ...process.env, NOVA_RESPAWN_COUNT: String(count), NOVA_RESPAWNED_AT: new Date().toISOString() },
    });
    child.unref();
    log(`self-respawn #${count} spawned for ${entry} — exiting this process`);
    setTimeout(() => process.exit(0), 600);
    return { ok: true, reason: `إعادة تشغيل ذاتية #${count}`, entry };
  } catch (err) {
    log(`self-respawn failed: ${(err as Error).message}`);
    return { ok: false, reason: `فشل التشغيل: ${(err as Error).message}`, entry };
  }
}

export function supervisedNow(): boolean {
  return supervised();
}
