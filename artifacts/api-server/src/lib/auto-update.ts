/**
 * NOVA self-update (pull model)
 * ─────────────────────────────
 * The server watches its own GitHub release. When a newer build is published
 * (CI only publishes after a green build), it downloads `deploy/live-update.py`
 * from the repository, runs it, and the supervisor in `boot.mjs` reloads the
 * process with the new code.
 *
 * Why pull and not push: nothing on the internet needs to be able to run
 * commands on this box for an update to happen. The server asks, compares,
 * and installs — no credentials, no open exec channel, no panel button.
 *
 * Guarantees
 *   • never downgrades: installs only when the release is strictly newer
 *   • never loops: a failed attempt is recorded and retried in a later tick
 *   • verifiable: every decision lands in state/auto-update.json
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { bootBuild, requestReload, restartHistory, selfRespawn } from "./self-restart";

const REPO = process.env.NOVA_RELEASE_REPO || "DawshaX/xFREEDOLLARHACHx";
const TAG = process.env.NOVA_RELEASE_TAG || "nova-portable";
const SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/main/deploy/live-update.py`;
const ASSET_URL = `https://github.com/${REPO}/releases/download/${TAG}/nova-24-7.zip`;

/** Anything below this many seconds of difference is considered the same build. */
const MIN_DELTA_S = 120;

export interface AutoUpdateState {
  enabled: boolean;
  supervised: boolean;
  intervalMinutes: number;
  currentCommit: string | null;
  currentBuiltAt: string | null;
  latestReleaseAt: string | null;
  lastCheckAt: string | null;
  lastResult: string;
  lastDetail: string;
  updatedAt: string | null;
  attempts: number;
  logFile: string;
  /** The build the *running process* was started from (read once at import). */
  bootCommit: string | null;
  bootBuiltAt: string | null;
  /**
   * True when the files on disk are newer than the process that is running.
   * Measured 2026-11-05 on the live Waifly slot: the updater reported
   * «installed» three times, build.json said 02:12, and the process kept
   * answering with code from before 01:45 — because the supervisor reload
   * never happened. The updater could not see that, so it kept saying it was
   * up to date. It can see it now.
   */
  restartNeeded: boolean;
  /** Last lines of the updater log — the only place a failed reload explains itself. */
  logTail: string[];
  /** What this process tried to do about a reload, and when. */
  restartTrace: { at: string; what: string }[];
}

function stateDir(): string {
  if (process.env.NOVA_STATE_DIR) return process.env.NOVA_STATE_DIR;
  if (process.env.NOVA_MEMORY_FILE) return path.dirname(process.env.NOVA_MEMORY_FILE);
  if (process.env.NOVA_STATIC_DIR) return path.resolve(process.env.NOVA_STATIC_DIR, "..", "state");
  return path.resolve(process.cwd(), "state");
}

const FILE = () => path.join(stateDir(), "auto-update.json");
const LOG = () => path.join(stateDir(), "auto-update.log");

function appDir(): string {
  // The bundle lives next to build.json; the process cwd is normally that dir.
  const candidates = [
    process.cwd(),
    process.env.NOVA_STATIC_DIR ? path.resolve(process.env.NOVA_STATIC_DIR, "..") : "",
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "build.json"))) return dir;
  }
  return process.cwd();
}

/** Local build fingerprint, or null when this copy predates build.json. */
export function localBuild(): { commit?: string; builtAt?: string; files?: number } | null {
  for (const dir of [appDir(), process.cwd(), path.resolve(process.cwd(), "..")]) {
    const f = path.join(dir, "build.json");
    if (!fs.existsSync(f)) continue;
    try {
      return JSON.parse(fs.readFileSync(f, "utf8")) as { commit?: string; builtAt?: string; files?: number };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Last N non-empty lines of the updater log. */
function tailLog(lines = 25): string[] {
  try {
    return fs
      .readFileSync(LOG(), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-lines);
  } catch {
    return [];
  }
}

function readState(): Partial<AutoUpdateState> {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as Partial<AutoUpdateState>;
  } catch {
    return {};
  }
}

function writeState(patch: Partial<AutoUpdateState>): AutoUpdateState {
  const build = localBuild();
  const merged: AutoUpdateState = {
    enabled: enabled(),
    supervised: process.env.NOVA_SUPERVISED === "1",
    intervalMinutes: intervalMinutes(),
    currentCommit: build?.commit ?? null,
    currentBuiltAt: build?.builtAt ?? null,
    latestReleaseAt: null,
    lastCheckAt: null,
    lastResult: "idle",
    lastDetail: "لسه محصلش فحص",
    updatedAt: null,
    attempts: 0,
    logFile: LOG(),
    ...readState(),
    ...patch,
    bootCommit: bootBuild().commit,
    bootBuiltAt: bootBuild().builtAt,
    restartNeeded: false,
    logTail: tailLog(),
    restartTrace: restartHistory(),
  };
  // Fields that must always reflect the running process, not stale disk state.
  merged.currentCommit = build?.commit ?? merged.currentCommit ?? null;
  merged.currentBuiltAt = build?.builtAt ?? merged.currentBuiltAt ?? null;
  merged.enabled = enabled();
  merged.supervised = process.env.NOVA_SUPERVISED === "1";
  merged.intervalMinutes = intervalMinutes();
  const bootNow = bootBuild();
  merged.bootCommit = bootNow.commit;
  merged.bootBuiltAt = bootNow.builtAt;
  merged.restartNeeded = Boolean(bootNow.builtAt && build?.builtAt && bootNow.builtAt !== build.builtAt);
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(merged, null, 2));
  } catch {
    /* a read-only state dir must not break the server */
  }
  return merged;
}

function enabled(): boolean {
  const flag = String(process.env.NOVA_AUTO_UPDATE ?? "").trim();
  if (flag === "0" || flag.toLowerCase() === "false") return false;
  if (flag === "1" || flag.toLowerCase() === "true") return true;
  // Default: on inside the portable bundle (supervised), off in dev.
  return process.env.NOVA_SUPERVISED === "1";
}

function intervalMinutes(): number {
  const n = Number(process.env.NOVA_AUTO_UPDATE_MINUTES || 15);
  return Number.isFinite(n) && n >= 2 ? Math.min(n, 720) : 15;
}

function appendLog(line: string): void {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.appendFileSync(LOG(), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* ignore */
  }
}

/** Ask GitHub for the release timestamp of the published bundle. */
async function latestReleaseAt(): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, {
    headers: { "user-agent": "nova-self-update", accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const body = (await res.json()) as { assets?: { name: string; updated_at: string }[]; published_at?: string };
  const asset = body.assets?.find((a) => a.name === "nova-24-7.zip");
  return asset?.updated_at ?? body.published_at ?? null;
}

let running = false;

/**
 * One check-then-install pass. Safe to call from a timer and from an endpoint.
 */
export async function checkForUpdate(opts: { install?: boolean } = {}): Promise<AutoUpdateState> {
  if (running) return { ...writeState({}), lastResult: "busy", lastDetail: "فحص شغّال بالفعل" };
  running = true;
  try {
    const build = localBuild();
    if (!build?.builtAt) {
      return writeState({
        lastCheckAt: new Date().toISOString(),
        lastResult: "no-build-json",
        lastDetail: "مفيش build.json — النسخة دي أقدم من نظام البصمة، محتاجة تحديث يدوي مرة واحدة",
      });
    }

    let releaseAt: string | null;
    try {
      releaseAt = await latestReleaseAt();
    } catch (err) {
      return writeState({
        lastCheckAt: new Date().toISOString(),
        lastResult: "check-failed",
        lastDetail: `تعذّر قراءة الإصدار: ${(err as Error).message}`,
      });
    }
    if (!releaseAt) {
      return writeState({
        lastCheckAt: new Date().toISOString(),
        lastResult: "no-release",
        lastDetail: "مفيش أصل (asset) منشور في الإصدار",
      });
    }

    const localMs = Date.parse(build.builtAt);
    const remoteMs = Date.parse(releaseAt);
    const deltaS = Math.round((remoteMs - localMs) / 1000);

    if (!(deltaS > MIN_DELTA_S)) {
      // Up to date with the release — but is the *process* up to date with the
      // files? Those are different questions and only one of them was answered.
      const boot = bootBuild().builtAt;
      const disk = build.builtAt;
      if (boot && disk && boot !== disk) {
        return writeState({
          lastCheckAt: new Date().toISOString(),
          latestReleaseAt: releaseAt,
          lastResult: "restart-needed",
          lastDetail: `الملفات على الديسك أحدث من العملية الشغالة (شغّالة من ${boot} والديسك ${disk}) — محتاج Restart من اللوحة`,
        });
      }
      return writeState({
        lastCheckAt: new Date().toISOString(),
        latestReleaseAt: releaseAt,
        lastResult: "up-to-date",
        lastDetail: `مفيش أحدث من اللي شغّال (فرق ${deltaS} ثانية)`,
      });
    }

    if (opts.install === false) {
      return writeState({
        lastCheckAt: new Date().toISOString(),
        latestReleaseAt: releaseAt,
        lastResult: "update-available",
        lastDetail: `فيه نسخة أحدث بفرق ${Math.round(deltaS / 60)} دقيقة`,
      });
    }

    if (!process.env.NOVA_SUPERVISED && String(process.env.NOVA_AUTO_UPDATE) !== "1") {
      return writeState({
        lastCheckAt: new Date().toISOString(),
        latestReleaseAt: releaseAt,
        lastResult: "update-available",
        lastDetail: "فيه أحدث، بس مفيش مُشرف يعيد التشغيل — التشغيل التلقائي متاح في الحزمة فقط",
      });
    }

    appendLog(`new build found: local ${build.builtAt} → release ${releaseAt} (${deltaS}s)`);
    const started = startInstaller(releaseAt);
    return started;
  } finally {
    running = false;
  }
}

/** Download the updater and run it; the supervisor reloads us when it finishes. */
function startInstaller(releaseAt: string): AutoUpdateState {
  const scriptPath = path.join(os.tmpdir(), "nova-self-update.py");
  const base = writeState({
    lastCheckAt: new Date().toISOString(),
    latestReleaseAt: releaseAt,
    lastResult: "installing",
    lastDetail: "بينزّل النسخة الجديدة ويطبّقها — البرنامج هيعيد تشغيل نفسه",
    attempts: (readState().attempts ?? 0) + 1,
  });

  void (async () => {
    try {
      const res = await fetch(SCRIPT_URL, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`script ${res.status}`);
      const body = await res.text();
      if (!body.includes("live update")) throw new Error("unexpected updater content");
      fs.writeFileSync(scriptPath, body);
      appendLog(`updater saved to ${scriptPath}`);

      const child = spawn("python3", [scriptPath, "--dir", appDir(), "--url", ASSET_URL], {
        cwd: appDir(),
        env: { ...process.env, NOVA_PORT: process.env.PORT || process.env.SERVER_PORT || "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (d: Buffer) => appendLog(`out: ${d.toString().trim()}`));
      child.stderr.on("data", (d: Buffer) => appendLog(`err: ${d.toString().trim()}`));
      child.on("exit", (code) => {
        appendLog(`updater exited ${code}`);
        if (code !== 0) {
          writeState({
            lastResult: "failed",
            lastDetail: `فشل التطبيق (كود ${code}) — شوف auto-update.log`,
          });
          return;
        }
        // The updater may have asked for a reload over HTTP using a guessed
        // port (PORT_CANDIDATES in deploy/live-update.py was a stale 27214),
        // and it exits 0 even when that request never arrived. So do not trust
        // it: write the marker from the process that knows its own state dir,
        // then check in a few seconds whether we are still alive. If we are,
        // the reload did NOT happen — say so instead of «اتطبّقت».
        writeState({
          lastResult: "installed",
          lastDetail: "اتطبّقت النسخة الجديدة — طلبنا إعادة التشغيل، بنتأكد إنها حصلت",
          updatedAt: new Date().toISOString(),
        });
        appendLog("files installed — writing the reload marker from the app itself");
        requestReload({
          verifyMs: 9000,
          then: () => {
            const canRespawn = !process.env.NOVA_SUPERVISED;
            writeState({
              lastResult: "restart-needed",
              lastDetail: canRespawn
                ? "الملفات الجديدة جاهزة بس العملية القديمة لسه شغّالة — بندي إعادة تشغيل ذاتية للنسخة اللي من غير مُشرف"
                : "الملفات الجديدة جاهزة بس المُشرف معملش reload — البرنامج محتاج Restart من اللوحة (أو POST /api/nova-core/restart?force=1)",
            });
            if (canRespawn) selfRespawn();
          },
        });
      });
      child.on("error", (err) => {
        appendLog(`updater spawn failed: ${err.message}`);
        writeState({ lastResult: "failed", lastDetail: `مقدرتش أشغّل python3: ${err.message}` });
      });
    } catch (err) {
      appendLog(`install failed: ${(err as Error).message}`);
      writeState({ lastResult: "failed", lastDetail: `فشل التنزيل: ${(err as Error).message}` });
    }
  })();

  return base;
}

let timer: NodeJS.Timeout | null = null;

/** Start the background watcher (no-op when disabled). */
export function startAutoUpdate(): void {
  const state = writeState({});
  if (!state.enabled) {
    appendLog("auto-update disabled (NOVA_AUTO_UPDATE=0)");
    return;
  }
  if (timer) return;
  const every = intervalMinutes() * 60_000;
  const tick = () => {
    void checkForUpdate().catch((err) => appendLog(`check crashed: ${(err as Error).message}`));
  };
  // First check a minute after boot, so a restart does not immediately re-check
  // the same release while the panel is still warming up.
  setTimeout(tick, 60_000);
  timer = setInterval(tick, every);
  timer.unref?.();
  appendLog(`auto-update armed: every ${intervalMinutes()} min`);
}

export function autoUpdateStatus(): AutoUpdateState {
  const stored = readState();
  const build = localBuild();
  return {
    enabled: enabled(),
    supervised: process.env.NOVA_SUPERVISED === "1",
    intervalMinutes: intervalMinutes(),
    currentCommit: build?.commit ?? null,
    currentBuiltAt: build?.builtAt ?? null,
    latestReleaseAt: stored.latestReleaseAt ?? null,
    lastCheckAt: stored.lastCheckAt ?? null,
    lastResult: stored.lastResult ?? "idle",
    lastDetail: stored.lastDetail ?? "—",
    updatedAt: stored.updatedAt ?? null,
    attempts: stored.attempts ?? 0,
    logFile: LOG(),
    bootCommit: bootBuild().commit,
    bootBuiltAt: bootBuild().builtAt,
    restartNeeded: Boolean(bootBuild().builtAt && build?.builtAt && bootBuild().builtAt !== build.builtAt),
    logTail: tailLog(),
    restartTrace: restartHistory(),
  };
}
