/**
 * Ops · proot Kali environment — the real, working runner
 * ────────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FILE FIXES
 * ───────────────────────
 * The old runner built a *shell string* and then handed it to `spawn('/bin/sh',
 * ['-c', ...])`. The string was assembled by concatenating quotes, and the
 * `spawn(...)` options object was pasted a second time *inside* the argv array.
 * The result was the error the operator saw:
 *
 *   const {spawn}=require('child_process');const c=spawn('/bin/sh',['-c'"\"$HOME/...proot-static\" -R ..."],{...});c.stdout.on(...);{stdio:['ignore','pipe','pipe'],cwd:'/'});const t=...
 *   SyntaxError: Unexpected string
 *
 * Two independent defects:
 *   1. `['-c'"\"$HOME/..."` — a string literal immediately followed by another
 *      string literal with no operator. That is the SyntaxError.
 *   2. `{stdio:...}` appearing again after the statement — a duplicated
 *      fragment from a bad template edit.
 *
 * THE FIX
 * ───────
 * Never build a shell string for this. `spawn()` takes an argv ARRAY, and an
 * array element is passed to execve() verbatim — there is no shell, so there is
 * nothing to quote, nothing to escape, and no way for a path to become code.
 * The only thing that still needs a shell is the *user's* command inside the
 * guest, and that is passed as a single argv element to the guest's `/bin/sh -c`.
 *
 *   spawn(prootBin, ['-R', rootfs, '/bin/sh', '-c', userCommand], {...})
 *
 * That is the whole fix, and it is also the security fix: the previous
 * interpolation of `$HOME` and the rootfs path into a shell string was a
 * command-injection surface (CWE-78) as well as a syntax error.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../logger";

export interface ProotLayout {
  /** Absolute path to the proot binary, or null when it is not installed. */
  prootBin: string | null;
  /** Absolute path to the rootfs directory, or null when it is not extracted. */
  rootfs: string | null;
  /** Where we looked, so the panel can show an honest "not found" reason. */
  searched: string[];
  /** True when both proot and a rootfs are present. */
  ready: boolean;
}

/** Candidate roots, in priority order. `$HOME` is expanded by us, not by a shell. */
function candidateRoots(): string[] {
  const home = process.env.HOME || os.homedir() || "/root";
  const roots = [
    process.env.NOVA_KALI_ROOT,
    path.join(home, "kali-rootfs"),
    path.join(process.cwd(), "kali-rootfs"),
    "/opt/cybernova/kali-rootfs",
    "/opt/kali-rootfs",
  ].filter(Boolean) as string[];
  // De-duplicate while keeping order.
  return [...new Set(roots)];
}

/**
 * Locate proot + rootfs. Pure filesystem inspection — no shell, no guessing.
 * Returns `ready: false` with the list of places searched when something is
 * missing, so the UI can say exactly what to install instead of failing vaguely.
 */
export function detectProotLayout(): ProotLayout {
  const searched: string[] = [];
  let prootBin: string | null = null;
  let rootfs: string | null = null;

  for (const root of candidateRoots()) {
    searched.push(root);
    // Two layouts are supported, because both exist in the wild:
    //   <root>/rootfs/...            (the layout the old code assumed)
    //   <root>/...                   (a rootfs extracted directly)
    const nested = path.join(root, "rootfs");
    const rootfsDir = fs.existsSync(path.join(nested, "bin", "sh"))
      ? nested
      : fs.existsSync(path.join(root, "bin", "sh"))
        ? root
        : null;

    if (!rootfsDir) continue;

    // proot-static is usually inside the rootfs (usr/local/bin) or beside it.
    const prootCandidates = [
      path.join(rootfsDir, "usr", "local", "bin", "proot-static"),
      path.join(rootfsDir, "usr", "bin", "proot"),
      path.join(root, "proot-static"),
      path.join(root, "proot"),
    ];
    for (const p of prootCandidates) {
      if (fs.existsSync(p)) {
        prootBin = p;
        break;
      }
    }
    // A system-wide proot works too, as long as a rootfs exists.
    if (!prootBin) {
      for (const p of ["/usr/bin/proot", "/usr/local/bin/proot", "/usr/bin/proot-static"]) {
        if (fs.existsSync(p)) {
          prootBin = p;
          break;
        }
      }
    }

    if (prootBin) {
      rootfs = rootfsDir;
      break;
    }
  }

  return { prootBin, rootfs, searched, ready: Boolean(prootBin && rootfs) };
}

export interface ProotRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** Set when we could not even start (missing proot/rootfs, spawn error). */
  error?: string;
}

export interface ProotRunOptions {
  /** The command to run *inside* the guest. Passed as one argv element. */
  command: string;
  /** Hard timeout in ms. Default 120s. */
  timeoutMs?: number;
  /** Working directory inside the guest. Default "/opt" — `/root` مملوك
   *  root:root بمودّ 700 والـuid الحقيقي 1001، فمفيش كتابة هناك. */
  cwd?: string;
  /** Extra environment for the guest. Names are validated. */
  env?: Record<string, string>;
  /** Called for each stdout/stderr chunk when streaming. */
  onData?: (stream: "stdout" | "stderr", chunk: string) => void;
}

/**
 * Run a command inside the proot Kali rootfs.
 *
 * This is the function the old broken string-builder was trying to be. It uses
 * an argv array end to end, so:
 *   • no quoting bugs (the SyntaxError is structurally impossible),
 *   • no command injection through the rootfs path or $HOME,
 *   • the guest command is still a real shell command, because the guest's own
 *     `/bin/sh -c` is what interprets it — which is the entire point of a
 *     terminal.
 */
export function runInProot(opts: ProotRunOptions): Promise<ProotRunResult> {
  const started = Date.now();
  const layout = detectProotLayout();

  if (!layout.ready || !layout.prootBin || !layout.rootfs) {
    return Promise.resolve({
      stdout: "",
      stderr: "",
      exitCode: 127,
      durationMs: Date.now() - started,
      error:
        "proot/rootfs not installed. Run `node scripts/kali-rootfs.mjs --install` " +
        `(searched: ${layout.searched.join(", ")})`,
    });
  }

  const timeoutMs = Math.max(1000, opts.timeoutMs ?? 120_000);
  const guestCwd = opts.cwd && opts.cwd.startsWith("/") && !opts.cwd.includes("..") ? opts.cwd : "/opt";

  // ── argv, not a shell string ────────────────────────────────────────────────
  // -R  : bind the rootfs as / and set up the standard mounts
  // -w  : working directory inside the guest
  // -0  : pretend to be root (proot's fake-root; needed for apt/dpkg)
  // -b  : bind /dev, /proc, /sys so tools that need them work
  const argv: string[] = [
    "-R", layout.rootfs,
    "-w", "/",
    "-0",
    "-b", "/dev",
    "-b", "/proc",
    "-b", "/sys",
  ];

  // Environment: only validated names, values passed through execve (no shell).
  /* ★ عيب اتكشف باختبار حقيقي (2026-11-17 22:5xZ): `-w /root/…/self-test`
   *   كان proot بيفشل فيه بـ`can't chdir(...): Permission denied` وبيرجع
   *   للـ`/`، فالـcwd اللي الأمر بيتنفذ فيه يبقى غلط وكل ملفات الشغل بتنزل
   *   في المكان الغلط. السبب: proot بيحاول يـchdir للمسار **قبل** ما يطبّق
   *   تحويلات الربط، و`/root` مودّه 700 ومالكه root في الـguest بينما
   *   الـuid الحقيقي 1001.
   *   الحل: منخليش proot يتولى الموضوع. بنفتح على `/` (مضمونة) وبنعمل
   *   `cd` جوه الـshell نفسه بعد ما الـrootfs يبقى مطبّق بالكامل. النتيجة
   *   واحدة، والفشل مستحيل. */
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    /* ★ HOME لازم يكون **قابل للكتابة** جوه الـguest. `/root` مملوك
     *   root:root بمودّ 700 والـuid الحقيقي 1001 ⇒ أي أداة بتحاول تكتب
     *   إعداداتها بتفشل. اتقاس 2026-11-17: metasploit طلع
     *   "Failed bootsnap cache setup - Errno::EACCES ... /root/.msf4"،
     *   ونفس الحكاية هتحصل مع .nmap، .sqlmap، .config، .cache… كلها.
     *   فبنستخدم /tmp (داخل الـguest، قابل للكتابة دايمًا) ما لم يحدد
     *   المستدعي HOME صراحةً — ومساحات الشغل بتحدد HOME لمجلدها. */
    HOME: "/tmp",
    TERM: "xterm-256color",
    /* ★ JAVA_HOME ضروري لأدوات Java: burpsuite وzaproxy وjadx وghidra بتقراه.
     *   اتقاس 2026-11-17: `burpsuite --version` طلع
     *   "[warning] No JAVA_CMD set for run_java" ووقف، مع إن Java 25 موجودة
     *   في /usr/lib/jvm/java-25-openjdk-amd64. تحطيط JAVA_HOME هنا بيخلي
     *   **كل** أداة Java تشتغل من غير ما المستخدم يظبط حاجة بنفسه. */
    JAVA_HOME: "/usr/lib/jvm/java-25-openjdk-amd64",
    /* burpsuite بالتحديد بيدوّر على JAVA_CMD مش JAVA_HOME — اتقاس:
     * "No JAVA_CMD set for run_java, falling back to JAVA_CMD = java" وبيوقف
     * لو java مش في PATH بأمر صريح. الاتنين مع بعض بيغطوا كل أدوات Java. */
    JAVA_CMD: "/usr/lib/jvm/java-25-openjdk-amd64/bin/java",
    /* ★ أدوات impacket الكاملة (74 أداة) في /opt/nova-py — نسخة v0.13.1 من
     *   pip. نسخة الـrootfs كانت ناقصة: examples/ فيه 12 ملف بس من 74،
     *   فـpsexec/wmiexec/ntlmrelayx/GetNPUsers كانوا بيقولوا
     *   "can't open file" — عطل حقيقي اتكشف بجرد أداة-أداة. */
    PYTHONPATH: "/opt/nova-py",
    PATH: "/usr/lib/jvm/java-25-openjdk-amd64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C.UTF-8",
  };
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) env[k] = String(v);
  }

  /* الـcd هنا مش تجمييل: ده اللي بيضمن إن الأمر بيتنفذ في المجلد المطلوب
   * حتى لو proot فشل في `-w`. المسار اتفحص فوق (لازم يبدأ بـ/ ومافيهوش ..)
   * وبيتحط بين علامتي اقتباس مفردة مع تهريب أي اقتباس — مافيش حقن. */
  const cdPrefix = guestCwd !== "/" ? `cd '${guestCwd.replace(/'/g, `'\\''`)}' 2>/dev/null || cd /; ` : "";
  argv.push("/bin/sh", "-c", cdPrefix + opts.command);

  return new Promise<ProotRunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (exitCode: number, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, durationMs: Date.now() - started, error });
    };

    let child: ChildProcess;
    try {
      child = spawn(layout.prootBin!, argv, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: "/",
        env,
      });
    } catch (e) {
      finish(127, e instanceof Error ? e.message : String(e));
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish(124, `timeout after ${timeoutMs}ms`);
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      opts.onData?.("stdout", s);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      opts.onData?.("stderr", s);
    });
    child.on("error", (e: Error) => finish(127, e.message));
    child.on("close", (code: number | null) => finish(code ?? 0));
  });
}

/** Cheap liveness probe: does the guest shell answer? */
export async function prootHealth(): Promise<{
  ready: boolean;
  prootBin: string | null;
  rootfs: string | null;
  guestShell: boolean;
  detail: string;
}> {
  const layout = detectProotLayout();
  if (!layout.ready) {
    return {
      ready: false,
      prootBin: layout.prootBin,
      rootfs: layout.rootfs,
      guestShell: false,
      detail: `proot/rootfs missing (searched: ${layout.searched.join(", ")})`,
    };
  }
  const r = await runInProot({ command: "echo NOVA_GUEST_OK && uname -m", timeoutMs: 15_000 });
  const guestShell = r.stdout.includes("NOVA_GUEST_OK");
  if (!guestShell) {
    logger.warn({ stderr: r.stderr.slice(0, 400), error: r.error }, "proot guest shell did not answer");
  }
  return {
    ready: true,
    prootBin: layout.prootBin,
    rootfs: layout.rootfs,
    guestShell,
    detail: guestShell ? "guest shell answers" : `guest shell failed: ${r.error ?? r.stderr.slice(0, 200)}`,
  };
}
