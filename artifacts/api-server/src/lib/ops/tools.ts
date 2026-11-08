/**
 * Ops · Task kinds + tool adapters
 * ───────────────────────────────
 * Two families, one contract: every kind returns findings that carry real
 * evidence (raw bytes + SHA-256), never a narrative.
 *
 *  • builtin kinds  — implemented in-process (DNS/TLS/HTTP/crt.sh/NVD). Always
 *                     available on any host, no binaries needed, passive-friendly.
 *  • tool kinds     — real security tools (nuclei, httpx, subfinder, katana,
 *                     nmap, ffuf) executed with argv only. NO shell, so a
 *                     crafted target string can never become a command.
 *
 * Execution plane choice (in this order):
 *   1. a connected fleet node that has the binary (via local-agent exec)
 *   2. the platform host itself, when NOVA_ALLOW_NODE_TOOLS != "0"
 *   3. an honest "tool missing" error with the install command from /installer
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { paramsList, resolveList, wordlistPath } from "./wordlist";
import {
  scanDns,
  scanHeaders,
  scanPorts,
  scanSsl,
  scanSubdomains,  SUB_WORDLIST_SIZE,
  nvdSearch,
} from "../security-tools";
import { fetchSecurityTxt, type Program } from "./scope";
import { HOSTS, freeHostSummary, type FreeHost } from "./free-hosts";
import { execOnLocalAgent } from "../../routes/local-agent";
import { sessionArgs, sessionHeaders, redactSecrets, hasSession } from "./session";
import { libraryStatus, lookupProduct } from "./advisory-library";
import { corpusStatus, queryCorpus } from "./vuln-corpus";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface Evidence {
  /** relative path inside the job dir, e.g. runs/<job>/evidence/headers.json */
  file?: string;
  sha256?: string;
  bytes?: number;
  /** the literal request/command that produced it — reproducible by hand */
  probe: string;
  status?: number;
  at: string;
}

export interface Finding {
  id: string;
  kind: string;
  title: string;
  titleAr: string;
  severity: Severity;
  confidence: number;
  target: string;
  cwe?: string;
  cvssGuess?: number;
  evidence: Evidence[];
  reproduce: string;
  remediationAr?: string;
  /** set by the verify gate — a finding is not reportable until proven */
  verified: boolean;
  verification?: { at: string; method: string; detail: string };
  extra?: Record<string, unknown>;
}

export interface RunCtx {
  host: string;
  scheme: "http" | "https";
  program: Program;
  jobDir: string;
  rps: number;
  agentId?: string;
  allowNodeTools: boolean;
  timeoutMs: number;
  log: (line: string) => void;
}

export interface KindResult {
  ok: boolean;
  summary: string;
  findings: Finding[];
  data?: Record<string, unknown>;
  error?: string;
}

export interface KindDef {
  id: string;
  titleAr: string;
  /** requires touching the target's services (as opposed to public sources) */
  active: boolean;
  /**
   * Hard ceiling for this kind's own process, independent of the job's. Without it one tool that
   * waits on a stalled socket ate the entire job window (`tools.httpx: exit=-1 · 180019ms`, run
   * 41460859502) and starved every later task in the same job.
   */
  budgetMs?: number;
  binary?: string;
  args?: (ctx: RunCtx, params: Record<string, unknown>) => string[];
  /** the human-readable command string used for fleet exec + reproduce lines */
  command?: (ctx: RunCtx, params: Record<string, unknown>) => string;
  run?: (ctx: RunCtx, params: Record<string, unknown>) => Promise<KindResult>;
  parse?: (stdout: string, ctx: RunCtx) => { findings: Finding[]; data?: Record<string, unknown> };
  installHint?: string;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const SEVERITY_ORDER: Severity[] = ["info", "low", "medium", "high", "critical"];
export function maxSeverity(list: Finding[]): Severity {
  return list.reduce<Severity>((acc, f) => (SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(acc) ? f.severity : acc), "info");
}

function fid(kind: string, target: string, detail: string): string {
  return crypto.createHash("sha256").update(`${kind}|${target}|${detail}`).digest("hex").slice(0, 16);
}

function baseUrl(ctx: RunCtx): string {
  return `${ctx.scheme}://${ctx.host}`;
}

/** Write evidence to the job dir and return its hash — this is what makes a finding provable. */
export function writeEvidence(
  ctx: RunCtx,
  kind: string,
  probe: string,
  content: string | Buffer,
  status?: number,
): Evidence {
  const dir = path.join(ctx.jobDir, "evidence");
  // A session cookie in an evidence file is a leaked credential: it would be
  // committed, hashed, shipped in a report and pasted into a bug-bounty form.
  // Every byte that becomes evidence passes this gate first, and the hash below is
  // the hash of the redacted artifact — i.e. of what is really on disk, so the
  // "reproduce this" claim still checks out.
  const sess = ctx.program?.session;
  const raw = typeof content === "string" ? content : content.toString("utf8");
  const buf = Buffer.from(hasSession(sess) ? redactSecrets(raw, sess) : raw, "utf8");
  probe = hasSession(sess) ? redactSecrets(probe, sess) : probe;
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const name = `${kind}-${sha.slice(0, 12)}.txt`;
  let file: string | undefined;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    const abs = path.join(dir, name);
    // Relative is nicer to read in a report, but only while it stays inside the
    // working directory. Free hosts often point NOVA_JOBS_REL at /tmp, and a
    // `../../../../../tmp/...` path is unresolvable from the panel — so keep the
    // honest absolute path whenever the relative one escapes.
    const rel = path.relative(path.resolve(process.cwd()), abs);
    file = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : abs;
  } catch (err) {
    ctx.log(`evidence write failed: ${(err as Error).message}`);
  }
  return { file, sha256: sha, bytes: buf.length, probe, status, at: new Date().toISOString() };
}

function mkFinding(ctx: RunCtx, partial: Omit<Finding, "id" | "verified" | "evidence" | "target"> & { evidence?: Evidence[]; target?: string }): Finding {
  const evidence = partial.evidence ?? [];
  return {
    id: fid(partial.kind, partial.target ?? ctx.host, partial.title),
    verified: false,
    target: partial.target ?? ctx.host,
    evidence,
    ...partial,
  } as Finding;
}

/** argv-only execution on the platform host. No shell ⇒ no injection surface. */
function runArgv(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string; killed: boolean }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    let killed = false;
    try {
      // stdio[0] = "ignore" is not cosmetic. Tools that accept targets from BOTH a flag and stdin
      // (httpx, naabu, katana…) open their stdin as a pipe and sit there waiting for EOF when we
      // hand them `-u` — which is exactly how `tools.httpx` burned 45 s and then 180 s and printed
      // nothing (measured: runs 41460859502 / 41465521238). Give them EOF by giving them nothing.
      child = spawn(bin, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ code: 127, stdout: "", stderr: (err as Error).message, killed: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    const killer = setTimeout(() => {
      killed = true; // OUR ceiling, not the tool's fault — say so instead of reporting a crash
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, opts.timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < 4_000_000) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < 400_000) stderr += d.toString("utf8");
    });
    child.on("error", (e: Error) => {
      clearTimeout(killer);
      resolve({ code: 127, stdout, stderr: e.message, killed: false });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code: code ?? -1, stdout, stderr, killed });
    });
  });
}

/** POSIX-ish single quoting: enough to make a hostile host string inert. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const pathCache = new Map<string, string | null>();

/**
 * Free hosts (Waifly/Render/GH-Actions images) rarely put `~/.local/bin` or
 * `~/go/bin` on PATH for a non-login shell, which made freshly installed tools
 * invisible to the engine. Search them explicitly instead of pretending the
 * binary is missing.
 */
function searchDirs(): string[] {
  const home = process.env.HOME || os.homedir();
  // `vendor/bin` is where the build step drops static binaries (see
  // scripts/fetch-toolchain.mjs). It exists because a free Render/PaaS box has no
  // SSH and no apt: without this, the engine would honestly report "no nmap" while
  // a nuclei binary sat unused in the deploy directory.
  //
  // NOVA_VENDOR_BIN overrides that location — and it must REPLACE the cwd
  // fallback, not merely be prepended to it. Measured 2026-11-06: the toolchain
  // gate points NOVA_VENDOR_BIN at an empty temp dir to prove `present` is read
  // off the disk, but the cwd fallback still found the real vendor/bin, so the
  // gate saw 4 tools where it had planted 0 and failed on CI. An override that
  // does not override is not an override.
  const vendored = process.env.NOVA_VENDOR_BIN
    ? [path.resolve(process.env.NOVA_VENDOR_BIN)]
    : [path.resolve(process.cwd(), "vendor/bin")];
  if (process.env.NOVA_TOOL_DIR) vendored.unshift(...process.env.NOVA_TOOL_DIR.split(path.delimiter).filter(Boolean));
  const extra = [...vendored, `${home}/.local/bin`, `${home}/go/bin`, "/usr/local/bin", "/usr/bin"];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return [...dirs, ...extra.filter((d) => !dirs.includes(d))];
}

/** Called after an install so a just-created binary is seen in the same process. */
export function clearBinaryCache(): void {
  pathCache.clear();
}

export function findBinary(bin: string): string | null {
  // The cache key includes the search dirs, not just the binary name.
  //
  // Measured 2026-11-06: the toolchain gate points NOVA_VENDOR_BIN at an empty
  // temp dir to prove `present` is read off the disk. It planted nothing, yet
  // `present` came back as subfinder,httpx,nuclei,katana — because an earlier
  // call in the same process had cached those hits under the bare name `bin`,
  // and a cache that ignores WHERE it looked answers a question nobody asked.
  // Keying on the dirs makes a changed search path a cache miss, which is the
  // only correct behaviour for a filesystem probe.
  const dirs = searchDirs();
  const key = `${bin}\u0000${dirs.join("\u0000")}`;
  if (pathCache.has(key)) return pathCache.get(key) ?? null;
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD").split(";") : [""];
  let hit: string | null = null;
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        hit = full;
        break;
      } catch {
        /* keep looking */
      }
    }
    if (hit) break;
  }
  pathCache.set(key, hit);
  return hit;
}

/**
 * Forget resolved paths. A toolchain install (or a test that plants a binary) changes what the
 * search dirs contain, and a stale negative would keep being reported as "tool missing" forever.
 */
export function resetBinaryCache(bin?: string): void {
  if (bin) pathCache.delete(bin);
  else pathCache.clear();
}

export function toolStatus(): Array<{ bin: string; present: boolean; where: string | null; install: string }> {
  return Object.values(KINDS)
    .filter((k) => k.binary)
    .map((k) => ({
      bin: k.binary!,
      present: Boolean(findBinary(k.binary!)),
      where: findBinary(k.binary!),
      install: k.installHint ?? `GET /api/installer/tools · POST /api/installer/tools/${k.binary}/install`,
    }));
}

/* ── the catalogue ────────────────────────────────────────────────────────── */

/* ── نوكلي: البروفيل محسوب على إحصاء حقيقي، مش على تخمين ─────────────────────
 * الأرقام دي مقاسة على `nuclei-templates/main` (13,858 ملف YAML اتنزّل وفُحص النهارده):
 *   http = 11,785 · high|critical = 4,416 · فيهم 500 بيستنيوا ردّ interactsh (OAST)
 *   `-severity medium,high,critical` = 7,885 قالب ≈ 7,885 طلب → عند `-rl 1` = 2 ساعة و11 دقيقة.
 * يعني ميزانية الـ540s ما كانتش «قصيرة»: القايمة العريضة أكبر بـ8 أضعاف من أي ميزانية معقولة.
 * `first-pass` = high|critical ∩ (exposure|misconfig|takeover|default-login) ∩ http ∩ ¬OAST
 *   = 1,034 قالب (نفس الإحصاء) ≈ 258s عند rl=4 — وده اللي بيخلص جوّه الميزانية.
 * `full` = السلوك العريض القديم، لمَن رفع `max_rps` صراحة على نود يقدر على كده.
 * `NOVA_NUCLEI_PROFILE=full` أو `params.profile` بيبدّلوا؛ الافتراضي دايمًا أول تمريرة بتكتمل.
 */
export const NUCLEI_PROFILES = {
  "first-pass": { severities: ["high", "critical"], tags: ["exposure", "misconfig", "takeover", "default-login"], oob: false, templates: 1034 },
  full: { severities: ["medium", "high", "critical"], tags: [] as string[], oob: true, templates: 7885 },
} as const;
type NucleiProfile = keyof typeof NUCLEI_PROFILES;
function nucleiProfileOf(p: Record<string, unknown>): NucleiProfile {
  const v = String(p["profile"] ?? process.env.NOVA_NUCLEI_PROFILE ?? "first-pass").trim().toLowerCase();
  return v === "full" || v === "all" ? "full" : "first-pass";
}
/** المصدر الوحيد للـargv وللسطر المطبوع — عشان التقرير ما يكذبش على نفسه تاني. */
function nucleiArgv(ctx: RunCtx, p: Record<string, unknown>): string[] {
  const prof = NUCLEI_PROFILES[nucleiProfileOf(p)];
  const sev = ((p["severities"] as string[]) ?? prof.severities).filter(Boolean).join(",");
  return [
    "-u", `${baseUrl(ctx)}/`,
    // `-jsonl` — لنوكلي مافيش `-json`: كان بيخرج 2 بسطر usage، والقاعدة القديمة («طبّع = نجح»)
    // كانت بتسجّله مهمة مكتملة (مقاس: run 41460859502 بعد ما الـexit code بقى هو الحكم).
    "-jsonl", "-silent", "-no-color",
    "-rl", String(Math.max(1, Math.round(ctx.rps))),
    "-c", String(Math.max(1, ctx.program.max_concurrency ?? 2)),
    "-severity", sev,
    "-type", "http",
    ...(prof.tags.length ? ["-tags", prof.tags.join(",")] : []),
    // `-no-interactsh` (موجود في المصدر: `ni`) بيستبعد قوالب OAST — اللي بتفضّل مستنية
    // callback ماحدش بيبعتّه على نود بلا egress، وبتاكل الميزانية وهي مستنية.
    ...(prof.oob ? [] : ["-no-interactsh"]),
    "-timeout", "6", "-retries", "1",
    // The session, when the program has one: this is the difference between
    // "the login page lacks CSP" and "template X fires on /api/v2/… as user A".
    ...sessionArgs(ctx.program?.session),
    "-stats",
  ];
}
/** الشرح اللي بيتحط في رسالة الفشل: مش «0 نتيجة» وبس، بل الحساب اللي وداها هناك. */
export function nucleiEtaNote(p: Record<string, unknown>, rps: number): string {
  const e = nucleiEtaMs(p, rps);
  return `profile=${e.profile} · ~${e.templates} قالب (إحصاء 2026-11-03) · ~${Math.round(e.etaMs / 1000)}s عند rl=${e.rps} — الميزانية 540s`;
}

/** كم هياخد الوقت ده نظريًا: قالب = طلب واحد على الأقل، والسقف rl. */
function nucleiEtaMs(p: Record<string, unknown>, rps: number): { templates: number; etaMs: number; rps: number; profile: NucleiProfile } {
  const profile = nucleiProfileOf(p);
  const r = Math.max(0.2, rps || 1);
  return { profile, templates: NUCLEI_PROFILES[profile].templates, rps: Math.round(r), etaMs: Math.ceil(NUCLEI_PROFILES[profile].templates / r) * 1000 };
}

/**
 * سؤال crt.sh عن أسماء الشهادات الصادرة للنطاق. بياتراجع هنا بدل ما يكون في
 * `security-tools.ts` عشان الفشل لازم يوصل للمكان اللي بيحكي عنه في الـsummary —
 * «صفر اسم» و«سجل الشهادات ماردّش» حاجتين مختلفتين خالص.
 */
async function ctLogNames(host: string): Promise<{ names: string[]; error: string | null }> {
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(host)}&output=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json", "user-agent": "NOVA-recon/1.0" } });
    if (!res.ok) return { names: [], error: `HTTP ${res.status}` };
    const doc = (await res.json()) as Array<{ name_value?: string }>;
    const set = new Set<string>();
    for (const row of Array.isArray(doc) ? doc : []) {
      for (const line of String(row?.name_value ?? "").split(/\r?\n/)) {
        const n = line.trim().toLowerCase().replace(/^\*\.?/, "");
        if (n) set.add(n);
      }
    }
    return { names: [...set].sort(), error: null };
  } catch (e) {
    return { names: [], error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

/** قفل الاعتماديات بتاعنا — نفس الملف اللي البوابات بتمشي عليه (مابيخترعش مسار). */
function lockfilePath(): string {
  for (const base of [process.cwd(), path.resolve(process.cwd(), ".."), path.resolve(process.cwd(), "../..")]) {
    const p = path.join(base, "pnpm-lock.yaml");
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* جرّب اللي بعده */
    }
  }
  // مالقيناشش قفل = رجّع فاضي؛ المستدعي بيقرر يعمل scan -r ولا يفوت بهدوء.
  return "";
}

export const KINDS: Record<string, KindDef> = {
  /* ── builtin · passive or single-request, work anywhere ───────────────── */
  "recon.dns": {
    id: "recon.dns",
    titleAr: "سجلات DNS (A/AAAA/MX/TXT/NS/DMARC)",
    active: false,
    run: async (ctx) => {
      const data = await scanDns(ctx.host);
      const ev = writeEvidence(ctx, "recon.dns", `dig +short ${ctx.host} *`, JSON.stringify(data, null, 2));
      const findings: Finding[] = [];
      const txt = ([] as string[]).concat((data["TXT"] as string[]) ?? []);
      if (!txt.some((t) => /v=spf1/i.test(t))) {
        findings.push(
          mkFinding(ctx, {
            kind: "recon.dns",
            title: "Missing SPF record",
            titleAr: "مفيش سجل SPF — نطاق مفتوح لانتحال الهوية",
            severity: "low",
            confidence: 0.75,
            cwe: "CWE-290",
            reproduce: `dig TXT ${ctx.host}`,
            remediationAr: "أضف `v=spf1 -all` لو النطاق مايبعتش بريد، أو حدّد الموردين.",
            evidence: [ev],
          }),
        );
      }
      if (!txt.some((t) => /dmarc/i.test(String(t)))) {
        // DMARC lives on _dmarc.<host>; scanDns only returns the apex TXT, so this is a hint, not a verdict.
        findings.push(
          mkFinding(ctx, {
            kind: "recon.dns",
            title: "DMARC unverified",
            titleAr: "لازم تتأكد من DMARC على _dmarc." + ctx.host,
            severity: "info",
            confidence: 0.4,
            reproduce: `dig TXT _dmarc.${ctx.host}`,
            evidence: [ev],
          }),
        );
      }
      return {
        ok: true,
        summary: `DNS: ${(((data["A"] as string[]) ?? []).length || 0)} سجل A · ${txt.length} TXT`,
        findings,
        data,
      };
    },
  },

  "recon.tls": {
    id: "recon.tls",
    titleAr: "تدقيق شهادة TLS والانتهاء",
    active: true,
    run: async (ctx) => {
      const data = await scanSsl(ctx.host, ctx.scheme === "https" ? 443 : 80);
      if (data["error"]) {
        return {
          ok: false,
          summary: ` handshake لـ${ctx.host} فشل (${String(data["error"]).slice(0, 90)}) — مفيش استنتاج عن الشهادة`,
          findings: [],
          error: "tls-unreachable",
          data: { host: ctx.host, error: data["error"] },
        };
      }
      const ev = writeEvidence(ctx, "recon.tls", `openssl s_client -connect ${ctx.host}:443 -servername ${ctx.host}`, JSON.stringify(data, null, 2));
      const findings: Finding[] = [];
      const validTo = String(data["validTo"] ?? data["valid_to"] ?? "");
      const days = validTo ? Math.floor((new Date(validTo).getTime() - Date.now()) / 86_400_000) : NaN;
      if (Number.isFinite(days) && days < 0) {
        findings.push(
          mkFinding(ctx, {
            kind: "recon.tls",
            title: "Expired TLS certificate",
            titleAr: "شهادة TLS منتهية من " + Math.abs(days) + " يوم",
            severity: "high",
            confidence: 0.95,
            cvssGuess: 7.4,
            reproduce: `openssl s_client -connect ${ctx.host}:443`,
            remediationAr: "تجديد/أتمتة التجديد (ACME) + مراقبة انتهاء الصلاحية.",
            evidence: [ev],
          }),
        );
      } else if (Number.isFinite(days) && days < 14) {
        findings.push(
          mkFinding(ctx, {
            kind: "recon.tls",
            title: "TLS certificate expiring soon",
            titleAr: "الشهادة تنتهي خلال " + days + " يوم",
            severity: "medium",
            confidence: 0.9,
            reproduce: `openssl s_client -connect ${ctx.host}:443`,
            evidence: [ev],
          }),
        );
      }
      return { ok: true, summary: `TLS: ${String(data["protocol"] ?? "?")} · متبقّي ${Number.isFinite(days) ? days : "?"} يوم`, findings, data };
    },
  },

  "recon.headers": {
    id: "recon.headers",
    titleAr: "ترويسات الأمان + كشف التقنيات",
    active: true,
    run: async (ctx) => {
      const data = await scanHeaders(ctx.host, ctx.scheme === "https", sessionHeaders(ctx.program?.session));
      // A probe that never reached the origin tells us NOTHING about its headers.
      // Reporting "missing HSTS" from a blocked/errored request is a false positive
      // with a confidence score — exactly what this platform exists to prevent.
      if (data["error"] || data["status"] === undefined) {
        return {
          ok: false,
          summary: `الطلب لـ${ctx.host} موصّلش (${String(data["error"] ?? "no response")}) — النتيجة «مجهولة» مش «ناقصة»`,
          findings: [],
          error: "probe-unreachable",
          data: { host: ctx.host, error: data["error"] ?? "no response" },
        };
      }
      const headers = (data["headers"] ?? data) as Record<string, string>;
      const ev = writeEvidence(ctx, "recon.headers", `curl -sSI ${baseUrl(ctx)}`, JSON.stringify(data, null, 2), Number(data["status"] ?? 0));
      const get = (k: string) => String(headers[k.toLowerCase()] ?? headers[k] ?? "");
      const findings: Finding[] = [];
      const reportedMissing = new Set((data["missing"] as string[]) ?? []);
      const missing: Array<[string, string, Severity, string, string]> = [
        ["strict-transport-security", "HSTS مفقود", "medium", "CWE-319", "add `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`"],
        ["content-security-policy", "CSP مفقود", "medium", "CWE-1021", "start with `Content-Security-Policy: default-src 'self'` and tighten"],
        ["x-frame-options", "X-Frame-Options مفقود (Clickjacking)", "low", "CWE-1021", "`frame-ancestors 'none'` في CSP أو `X-Frame-Options: DENY`"],
        ["x-content-type-options", "X-Content-Type-Options مفقود", "low", "CWE-16", "`nosniff`"],
        ["referrer-policy", "Referrer-Policy مفقود", "low", "CWE-200", "`strict-origin-when-cross-origin`"],
      ];
      for (const [key, titleAr, sev, cwe, fix] of missing) {
        if (!get(key) && (reportedMissing.size === 0 || reportedMissing.has(key))) {
          findings.push(
            mkFinding(ctx, {
              kind: "recon.headers",
              title: `Missing security header: ${key}`,
              titleAr,
              severity: sev,
              confidence: 0.8,
              cwe,
              reproduce: `curl -sSI ${baseUrl(ctx)} | grep -i ${key}`,
              remediationAr: fix,
              evidence: [ev],
            }),
          );
        }
      }
      const server = get("server");
      const ver = server.match(/\/(\d+\.\d+[.\d]*)/);
      if (ver) {
        findings.push(
          mkFinding(ctx, {
            kind: "recon.headers",
            title: "Verbose Server banner discloses version",
            titleAr: `ترويسة Server بتكشف الإصدار: ${server}`,
            severity: "low",
            confidence: 0.7,
            cwe: "CWE-200",
            reproduce: `curl -sSI ${baseUrl(ctx)} | grep -i '^server:'`,
            remediationAr: "أخفِ الإصدار (`server_tokens off;`) وابحث عن CVEs الخاصة به.",
            extra: { server },
            evidence: [ev],
          }),
        );
      }
      const cors = get("access-control-allow-origin");
      if (cors === "*" && /true/i.test(String(data["credentials"] ?? ""))) {
        findings.push(
          mkFinding(ctx, {
            kind: "recon.headers",
            title: "CORS wildcard with credentials",
            titleAr: "CORS: Origin=* مع Credentials — قراءة بيانات الجلسات",
            severity: "high",
            confidence: 0.85,
            cvssGuess: 8.1,
            cwe: "CWE-942",
            reproduce: `curl -sSI -H 'Origin: https://attacker.example' ${baseUrl(ctx)}`,
            remediationAr: "قائمة بيضاء صريحة للمنشأ، وممنوع `*` مع credentials.",
            evidence: [ev],
          }),
        );
      }
      return {
        ok: true,
        summary: `HTTP ${String(data["status"] ?? "?")} · ترويسات أمان ${String(data["score"] ?? `${(data["present"] as string[] | undefined)?.length ?? 0}/6`)} · ${findings.length} ملاحظة`,
        findings,
        data,
      };
    },
  },

  "recon.ports": {
    id: "recon.ports",
    titleAr: "فحص منافذ TCP محدود (غير تدميري)",
    active: true,
    run: async (ctx, params) => {
      const requested = Array.isArray(params["ports"]) ? (params["ports"] as unknown[]).map(Number) : null;
      const ports = (requested?.length ? requested : [80, 443, 22, 21, 25, 53, 3306, 5432, 6379, 8080, 8443, 9200])
        .filter((p) => Number.isFinite(p) && p > 0 && p < 65_536)
        .slice(0, 40);
      const results = await scanPorts(ctx.host, ports, Math.max(1, Math.min(10, ctx.program.max_concurrency ?? 2)));
      const open = results.filter((r) => r.open);
      const ev = writeEvidence(ctx, "recon.ports", `tcp-connect ${ctx.host} [${ports.join(",")}]`, JSON.stringify(results, null, 2));
      const risky: Finding[] = [];
      for (const p of open) {
        if ([21, 23, 25, 135, 139, 445, 1433, 3306, 3389, 5432, 5900, 6379, 9200, 11211, 27017].includes(p.port)) {
          risky.push(
            mkFinding(ctx, {
              kind: "recon.ports",
              title: `Sensitive service exposed: ${p.port}/tcp`,
              titleAr: `منفذ خدمة حساسة مفتوح على الإنترنت: ${p.port}`,
              severity: p.port === 6379 || p.port === 9200 || p.port === 11211 ? "critical" : "high",
              confidence: 0.9,
              cvssGuess: 9.1,
              cwe: "CWE-284",
              reproduce: `nc -vz ${ctx.host} ${p.port}`,
              remediationAr: "vpn/zero-trust أو IP allowlist + مصادقة إلزامية + إغلاق العام.",
              evidence: [ev],
            }),
          );
        }
      }
      return {
        ok: true,
        summary: `${open.length} منفذ مفتوح من ${ports.length}${risky.length ? ` · ${risky.length} حسّاس` : ""}`,
        findings: risky,
        data: { open, scanned: ports.length },
      };
    },
  },

  "recon.certspotter": {
    id: "recon.certspotter",
    titleAr: "نطاقات فرعية: سجل شهادات crt.sh + تجربة أسماء على DNS (سلبي)",
    active: false,
    run: async (ctx) => {
      // الاسم كان بيقول «سجل الشهادات» وهو ما بيسألش سجل الشهادات خالص — كان
      // بيعمل تجربة 34 اسم على DNS وبس. بقى الاتنين: سؤال crt.sh الحقيقي،
      // وتجربة الأسماء، وكل مصدر بيقول هو جه من فين ولو فشل بيقول فشل.
      const ct = await ctLogNames(ctx.host);
      const rows = await scanSubdomains(ctx.host);
      const ev = writeEvidence(
        ctx,
        "recon.certspotter",
        `crt.sh?q=%.${ctx.host} + dns-brute(${SUB_WORDLIST_SIZE})`,
        JSON.stringify({ source: ct.error ? `failed: ${ct.error}` : "crt.sh", ct: ct.names, dns: rows }, null, 2),
      );
      const apex = ctx.host;
      const findings: Finding[] = [];
      const seen = new Set(rows.map((r) => r.subdomain));
      const ghost = ct.names.filter((n) => !seen.has(n.toLowerCase()) && /(^|\.)(dev|staging|test|uat|internal|admin)[-.]|[-.](dev|staging|test|internal)\./i.test(n));
      const dangling = rows.filter((r) => /(^|\.)((dev|staging|test|uat|internal|admin)-|-(dev|staging|test|internal)\.)/i.test(r.subdomain) && r.ips.length === 0);
      for (const d of dangling.slice(0, 5)) {
        findings.push(
          mkFinding(ctx, {
            kind: "recon.certspotter",
            title: "Non-resolving environment subdomain",
            titleAr: `نطاق بيئي بلا IPs: ${d.subdomain} — مرشّح takeover`,
            severity: "medium",
            confidence: 0.5,
            cwe: "CWE-284",
            target: d.subdomain,
            reproduce: `dig +short ${d.subdomain} && dig +short CNAME ${d.subdomain}`,
            remediationAr: "احذف الـCNAME اليتيم أو اربطه بمورد حي؛ افحص بصمات can-i-take-over-xyz.",
            evidence: [ev],
          }),
        );
      }
      return {
        ok: true,
        summary:
          `${ct.names.length} اسم من crt.sh · ${rows.length} نطاق من تجربة ${SUB_WORDLIST_SIZE} اسم على DNS` +
          (ct.error ? ` — crt.sh ماردّش (${ct.error}) فاللي فوق من DNS بس` : "") +
          ` · ${findings.length} مرشّح`,
        findings,
        data: {
          count: rows.length + ct.names.length,
          fromCt: ct.names.length,
          fromDns: rows.length,
          ctError: ct.error ?? null,
          tried: SUB_WORDLIST_SIZE,
          ghostFromCt: ghost.length,
          apex,
          subdomains: rows.map((r) => r.subdomain),
          ctNames: ct.names.slice(0, 80),
        },
      };
    },
  },

  /* ── self-hosting intel · passive · zero binaries ─────────────────────────
     The brain's own body: which free host it lives on, measured from wherever
     it runs. Kept as a task kind so a plan can say "put the core on a VPS" and
     the answer is evidence, not an opinion. */
  "infra.freehosts": {
    id: "infra.freehosts",
    titleAr: "اختيار مضيف مجاني للتشغيل الدائم (كتالوج مقاس)",
    active: false,
    run: async (ctx, params) => {
      const sum = await freeHostSummary();
      const wanted = typeof params?.host === "string" ? params.host : sum.bestHubId;
      const chosen: FreeHost | null = HOSTS.find((h) => h.id === wanted) ?? null;
      const ev = writeEvidence(
        ctx,
        "infra.freehosts",
        "GET /api/fleet/catalogue?probe=1",
        JSON.stringify({ counts: sum, chosen }, null, 2),
      );
      const findings: Finding[] = [];
      if (sum.probed > 0 && sum.reachable === 0) {
        findings.push(mkFinding(ctx, {
          kind: "infra.freehosts",
          title: "No host reachable from this network",
          titleAr: `صفر من ${sum.probed} موقع بيردّ من هنا — مفيش قياس صالح`,
          severity: "info",
          confidence: 0.9,
          reproduce: 'curl -s "$NOVA_BASE/api/fleet/catalogue?probe=1" | head -c 400',
          remediationAr: "الرقم ده معناه إن الشبكة اللي شغال عليها NOVA بتبلع الخروج (أو إن المواقع فعلاً ماقفة). شغّل نفس القياس من الـhub أو من GitHub Actions (workflow free-host-survey) قبل ما تبني قرار عليه.",
          evidence: [ev],
        }));
      }
      if (chosen?.scanPolicy === "forbidden") {
        findings.push(mkFinding(ctx, {
          kind: "infra.freehosts",
          title: "Best hub host forbids active scanning",
          titleAr: `«${chosen.name}» بيمنع المسح/الهجوم في شروطه — الأذرع النشطة لازم على نود تاني`,
          severity: "medium",
          confidence: 0.85,
          reproduce: "cat docs/FREE-HOSTS-2026.md",
          remediationAr: "خلي الاستطلاع السلبي (DNS/TLS/crt.sh/HTTP headers) على المضيف اللي بيمنع، واطلع nmap/nuclei/ffuf على نود فيه root (freevps.edu.pl) بعد إذن صريح من صاحب البرنامج.",
          evidence: [ev],
        }));
      }
      const stale = HOSTS.filter((h) => !h.status2026).map((h) => h.id);
      if (stale.length) {
        findings.push(mkFinding(ctx, {
          kind: "infra.freehosts",
          title: "Catalogue entries without a dated 2026 read",
          titleAr: `${stale.length} مضيف من غير قراءة موثّقة بتاريخ 2026`,
          severity: "low",
          confidence: 0.8,
          reproduce: "node -e 'import(0)' # راجع artifacts/api-server/src/lib/ops/free-hosts.ts",
          remediationAr: `افتح صفحة المورد واكتب حقيقته في status2026 مع التاريخ: ${stale.join(", ")}. لحد ما ده يحصل الرقم يعتبر ادعاء.`,
          evidence: [ev],
        }));
      }
      return {
        ok: true,
        summary: `${sum.total} مضيف · ${sum.usableNoCard} بلا بطاقة · ${sum.permanent} دائم · ${sum.reachable}/${sum.probed} بيردّ من هنا · الأحسن: ${sum.bestHubAr}`,
        findings,
        data: { counts: sum, chosenId: chosen?.id ?? null, chosenSteps: chosen?.steps ?? [] },
      };
    },
  },

  "recon.securitytxt": {
    id: "recon.securitytxt",
    titleAr: "سياسة الإفصاح (security.txt / RFC 9116)",
    active: true,
    run: async (ctx) => {
      const st = await fetchSecurityTxt(ctx.host);
      const ev = writeEvidence(ctx, "recon.securitytxt", `GET ${baseUrl(ctx)}/.well-known/security.txt`, st.raw ?? "not-found");
      if (!st.found) {
        return {
          ok: true,
          summary: "مفيش security.txt — اقرأ policy البرنامج قبل أي طلب",
          findings: [
            mkFinding(ctx, {
              kind: "recon.securitytxt",
              title: "No security.txt",
              titleAr: "لا يوجد /.well-known/security.txt — لا توجد سياسة إفصاح منشورة",
              severity: "info",
              confidence: 0.9,
              reproduce: `curl -si ${baseUrl(ctx)}/.well-known/security.txt`,
              remediationAr: "أضف الملف (Contact + Acknowledgement + Preferred-Languages + Expires).",
              evidence: [ev],
            }),
          ],
          data: { found: false },
        };
      }
      return { ok: true, summary: `security.txt موجود · ${st.contact.length} قناة اتصال`, findings: [], data: { ...st, raw: undefined } };
    },
  },

  "recon.jspaths": {
    id: "recon.jspaths",
    titleAr: "استخراج مسارات API من حزم JS",
    active: true,
    run: async (ctx) => {
      const sess = sessionHeaders(ctx.program?.session);
      const res = await fetch(baseUrl(ctx), { redirect: "follow", headers: sess, signal: AbortSignal.timeout(ctx.timeoutMs) });
      const html = await res.text();
      const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 12);
      const urls = srcs.map((s) => new URL(s, baseUrl(ctx)).toString());
      const paths = new Set<string>();
      const mapFiles: string[] = [];
      for (const u of urls) {
        try {
          const js = await (await fetch(u, { headers: sess, signal: AbortSignal.timeout(ctx.timeoutMs) })).text();
          for (const m of js.matchAll(/["'`](\/(?:api|v\d|graphql|internal|admin|rest|private)\/[A-Za-z0-9_\-./{}:]{3,90})["'`]/g)) paths.add(m[1]);
          for (const m of js.matchAll(/["'']([^"'`]+\.js\.map)["'']/g)) mapFiles.push(m[1]);
          writeEvidence(ctx, `recon.jspaths.${path.basename(u).slice(0, 40)}`, `GET ${u}`, js);
        } catch (err) {
          ctx.log(`js fetch failed ${u}: ${(err as Error).message}`);
        }
      }
      const findings: Finding[] = [];
      if (mapFiles.length) {
        findings.push(
          mkFinding(ctx, {
            kind: "recon.jspaths",
            title: "Source maps reachable",
            titleAr: "ملفات .js.map متاحة — مصدر الكود قابل لإعادة البناء",
            severity: "medium",
            confidence: 0.6,
            cwe: "CWE-540",
            reproduce: `curl -sI ${urls[0] ?? baseUrl(ctx)}`,
            remediationAr: "لا تنشر الـsource maps للبيئات العامة، أو احمها خلف تصريح.",
            evidence: [writeEvidence(ctx, "recon.jspaths.maps", "scan of <script src>", JSON.stringify({ mapFiles }, null, 2))],
          }),
        );
      }
      return {
        ok: true,
        summary: `${srcs.length} حزمة JS · ${paths.size} مسار API مخفي`,
        findings,
        data: { scripts: srcs, paths: [...paths].slice(0, 200), mapFiles },
      };
    },
  },

  "intel.cvebytech": {
    id: "intel.cvebytech",
    titleAr: "CVEs للتقنية المكتشفة (NVD)",
    active: false,
    run: async (ctx) => {
      const headers = await scanHeaders(ctx.host, ctx.scheme === "https");
      const server = String((headers as Record<string, unknown>)["server"] ?? (headers as Record<string, Record<string, string>>)["headers"]?.["server"] ?? "");
      const product = server.replace(/\/.*/, "").trim() || "nginx";
      const nvd = (await nvdSearch({ keyword: product, limit: 10 })) as Record<string, unknown>;
      const ev = writeEvidence(ctx, "intel.cvebytech", `NVD keyword=${product}`, JSON.stringify(nvd, null, 2));
      const vulns = (nvd["vulnerabilities"] as unknown[]) ?? [];
      return {
        ok: true,
        summary: `NVD عن «${product}»: ${vulns.length} نتيجة`,
        findings: [],
        data: { product, total: nvd["totalResults"], sample: vulns.slice(0, 10) },
      };
    },
  },

  /* ── real advisory corpus · passive · zero binaries ──────────────────────
     The library used to be four hardcoded integers over a 22-row array. This kind
     is what "build on top of the library" actually means: a detected technology
     (or a CVE you already have) is joined against advisories that were really
     fetched from the GitHub Advisory Database, with the timestamp attached. */
  "intel.advisories": {
    id: "intel.advisories",
    titleAr: "مكتبة الإشعارات الحقيقية (GitHub Advisory DB) للتقنية المكتشفة",
    active: false,
    budgetMs: 30_000,
    run: async (ctx, params) => {
      const st = libraryStatus();
      if (!st.measured) {
        return {
          ok: false,
          summary: st.says_ar,
          findings: [],
          error: "library-empty",
          data: { hint: "POST /api/ops/advisories/sync", status: st },
        };
      }
      const cve = typeof params?.["cve"] === "string" ? String(params["cve"]) : "";
      const given = typeof params?.["product"] === "string" ? String(params["product"]).trim() : "";
      // Only probe when we were not told what to look up — a lookup of a known
      // product must not generate traffic to the target.
      const headers = cve || given ? null : await scanHeaders(ctx.host, ctx.scheme === "https", sessionHeaders(ctx.program?.session));
      const banner = String((headers?.["headers"] as Record<string, string> | undefined)?.["server"] ?? "");
      const product = given || banner.replace(/\/.*/, "").trim();
      if (!product && !cve) {
        return { ok: false, summary: "مفيش تقنية مكتشفة ولا CVE محدد — مش هخمّن", findings: [], error: "no-subject" };
      }
      const rows = cve ? [] : lookupProduct(product, 20);
      const ev = writeEvidence(
        ctx,
        "intel.advisories",
        `GET api.github.com/advisories (cache ${st.at}) · match=${product || cve}`,
        JSON.stringify({ product, cve, libraryAt: st.at, libraryTotal: st.total, rows }, null, 2),
      );
      const findings: Finding[] = rows
        .filter((r) => (r.cvss ?? 0) >= 7 || r.severity === "critical" || r.severity === "high")
        .slice(0, 10)
        .map((r) =>
          mkFinding(ctx, {
            kind: "intel.advisories",
            title: `${r.id}${r.cve ? ` (${r.cve})` : ""}: ${r.summary}`,
            titleAr: `إشعار حقيقي على «${product}»: ${r.summary}`.slice(0, 300),
            severity: r.severity === "unknown" ? "medium" : r.severity,
            // An advisory that *mentions* a product is not proof the target runs it:
            // the version must be confirmed before this can be reported.
            confidence: 0.45,
            cwe: r.cwes[0],
            cvssGuess: r.cvss,
            target: ctx.host,
            reproduce: `curl -s https://api.github.com/advisories/${r.id}`,
            remediationAr: "اتأكد من الإصدار الفعلي على الهدف قبل التقرير؛ لو مطابق، ارفع الإصدار للمُصلَح.",
            evidence: [ev],
            extra: { ghsa: r.id, cve: r.cve, packages: r.packages, libraryAt: st.at },
          }),
        );
      return {
        ok: true,
        summary: `مكتبة ${st.total} إشعار (${(st.at ?? "").slice(0, 16).replace("T", " ")}) · «${product || cve}» → ${rows.length} مطابقة · ${findings.length} خطيرة`,
        findings,
        data: { product, libraryTotal: st.total, libraryAt: st.at ?? "never", matches: rows.length, rows: rows.slice(0, 20) },
      };
    },
  },

  /* ── the CVE corpus · passive · zero binaries ────────────────────────────
     Different question from `intel.advisories`: not "what advisories mention this
     word" but "which CVEs does NVD attach to this product's CPE, how many of them
     are exploited in the wild (KEV), and what is their EPSS probability". */
  "intel.corpus": {
    id: "intel.corpus",
    titleAr: "كوربوس الثغرات الحقيقي (NVD + KEV + EPSS) للمنتج المكتشف",
    active: false,
    budgetMs: 60_000,
    run: async (ctx, params) => {
      const st = corpusStatus();
      if (!st.measured) {
        return {
          ok: false,
          summary: st.says_ar,
          findings: [],
          error: "corpus-empty",
          data: { hint: "node scripts/ingest-vuln-corpus.mjs --incremental", status: st },
        };
      }
      const given = typeof params?.["product"] === "string" ? String(params["product"]).trim() : "";
      const cve = typeof params?.["cve"] === "string" ? String(params["cve"]).trim() : "";
      let product = given;
      if (!product && !cve) {
        const h = await scanHeaders(ctx.host, ctx.scheme === "https", sessionHeaders(ctx.program?.session));
        const banner = String((h?.["headers"] as Record<string, string> | undefined)?.["server"] ?? "");
        product = banner.replace(/\/.*/, "").trim();
      }
      if (!product && !cve) {
        return { ok: false, summary: "مش عارف المنتج — ومش هخمّن", findings: [], error: "no-subject" };
      }
      const minCvss = params?.["minCvss"] === undefined ? 7 : Number(params["minCvss"]);
      const q = await queryCorpus({ product: product || undefined, cve: cve || undefined, minCvss, kevOnly: false, limit: 30 });
      const ev = writeEvidence(
        ctx,
        "intel.corpus",
        `corpus query product=${product || "-"} cve=${cve || "-"} minCvss=${minCvss} (corpus ${st.total} @ ${st.at})`,
        JSON.stringify({ product, cve, minCvss, scanned: q.scanned, rows: q.rows }, null, 2),
      );
      const findings: Finding[] = q.rows.slice(0, 10).map((r) =>
        mkFinding(ctx, {
          kind: "intel.corpus",
          title: `${r.id}${r.cvss ? ` (CVSS ${r.cvss})` : ""}: ${r.desc.slice(0, 140)}`,
          titleAr: `${r.id}${r.kev ? " · مستغلة فعلياً (KEV)" : ""}${r.epss ? ` · EPSS ${(r.epss * 100).toFixed(1)}%` : ""} — ${r.desc.slice(0, 120)}`,
          severity: r.sev === "unknown" || r.sev === "none" ? "medium" : r.sev,
          // KEV changes the calculus: exploited in the wild is worth reporting even
          // before we prove the version. A CPE match alone is still only a lead.
          confidence: r.kev ? 0.6 : 0.45,
          cwe: r.cwe[0],
          cvssGuess: r.cvss,
          target: ctx.host,
          reproduce: `curl -s "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${r.id}"`,
          remediationAr: "اتأكد من إصدار المنتج على الهدف؛ لو داخل النطاق المتأثر، ارفع الإصدار للمُصلَح.",
          evidence: [ev],
          extra: { cve: r.id, cvss: r.cvss, kev: r.kev ?? false, epss: r.epss, cpe: r.cpe.slice(0, 3), corpusAt: st.at },
        }),
      );
      return {
        ok: true,
        summary: `كوربوس ${st.total} CVE (KEV ${st.kev}) · «${product || cve}» → ${q.rows.length} مطابقة (CVSS≥${minCvss}) · اتصفح ${q.scanned} صف`,
        findings,
        data: { product, cve, matches: q.rows.length, scanned: q.scanned, corpusAt: st.at, rows: q.rows.slice(0, 15) },
      };
    },
  },

  /* ── real tools (argv) ─────────────────────────────────────────────────── */
  "tools.nuclei": {
    id: "tools.nuclei",
    titleAr: "ProjectDiscovery Nuclei (قوالب إعدادات/تعرّض)",
    active: true,
    binary: "nuclei",
    // الميزانية دي محسوبة، مش متخيَّرة: إحصاء حقيقي على nuclei-templates/main (2026-11-03) قال
    // إن `-severity medium,high,critical` = 7,885 قالب ≈ 7,885 طلب، وعند `-rl 1` (سقف scanme
    // الافتراضي) ده ساعتين و11 دقيقة — فـ260s و540s الاتنين كانو قطع في النص، مش فشل أدوات.
    // الحل مش ساعة أكبر: `first-pass` ≈ 1,034 قالب ≈ 258s عند rl=4، و540s سيّبت هامش 2x.
    // ولو سطر «اتقطع» رجع، الرسالة نفسها بقت تقول profile · عدد القوالب · rl · الـETA.
    budgetMs: 540_000,
    installHint: "sh -c \"$(curl -sL https://raw.githubusercontent.com/projectdiscovery/nuclei/main/install.sh)\"",
    args: (ctx, p) => nucleiArgv(ctx, p),
    // السطر اللي بيشفّه الإنسان = الـargv اللي اتنفّذت، من نفس الدالة. قبل كده كان السطر
    // بيعرض 3 سيّبات والشغل بيطلع بأربع — وده كذب في التقرير (اتصلّح في #99 وبقى محروس).
    command: (ctx, p) => {
      const line = `nuclei ${nucleiArgv(ctx, p).map((a) => (/^[A-Za-z0-9_./:,-]+$/.test(a) ? a : shQuote(a))).join(" ")}`;
      // The printed command is copied into reports — it must never carry the cookie.
      return redactSecrets(line, ctx.program?.session);
    },
    parse: (stdout, ctx) => {
      const findings: Finding[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim().startsWith("{")) continue;
        let j: Record<string, unknown>;
        try {
          j = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const info = (j["info"] ?? {}) as Record<string, unknown>;
        const matched = (j["matched-at"] ?? j["host"] ?? ctx.host) as string;
        const sev = String(info["severity"] ?? "info").toLowerCase() as Severity;
        const name = String(info["name"] ?? "nuclei match");
        findings.push(
          mkFinding(ctx, {
            kind: "tools.nuclei",
            title: name,
            titleAr: `Nuclei: ${name} @ ${matched}`,
            severity: (["info", "low", "medium", "high", "critical"].includes(sev) ? sev : "info") as Severity,
            confidence: 0.7,
            cwe: Array.isArray(info["classification"]) ? String((info["classification"] as string[])[0]) : (info["classification"] as Record<string, unknown> | undefined)?.["cve-id"] ? String((info["classification"] as Record<string, unknown>)["cve-id"]) : undefined,
            target: matched,
            cvssGuess: Number(info["severity"] === "critical" ? 9.1 : info["severity"] === "high" ? 7.5 : info["severity"] === "medium" ? 5.3 : 3.1),
            reproduce: `nuclei -u ${shQuote(matched)} -id ${shQuote(String(j["template-id"] ?? ""))}`,
            remediationAr: String(info["remediation"] ?? "راجع مرجع القالب ثم أعد إنتاج النتيجة يدوياً."),
            evidence: [writeEvidence(ctx, "tools.nuclei", `nuclei -jsonl (template ${String(j["template-id"] ?? "?")})`, line)],
            extra: { templateId: j["template-id"], matcher: j["matcher-name"], tags: info["tags"] },
          }),
        );
      }
      return { findings, data: { matches: findings.length } };
    },
  },

  "tools.httpx": {
    id: "tools.httpx",
    titleAr: "httpx (كشف وجهات HTTP حية)",
    active: true,
    binary: "httpx",
    installHint: "go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest",
    // -retries bounds the stall that ate 180 s once (run 41452838992). `-connect-timeout` was
    // tried and REMOVED: httpx has no such flag, and its "flag provided but not defined" message
    // (48B, seen in run 41459589703) was being accepted as a successful task because the tool
    // printed *something* — which is exactly why the exit code is now authoritative below.
    budgetMs: 45_000,
    args: (ctx) => ["-u", `${baseUrl(ctx)}/`, "-json", "-silent", "-follow-redirects", "-status-code", "-title", "-tech-detect", "-timeout", "8", "-retries", "1", ...sessionArgs(ctx.program?.session)],
    command: (ctx) => `${redactSecrets(`httpx -u ${shQuote(`${baseUrl(ctx)}/`)} -json -silent -status-code -title -tech-detect`, ctx.program?.session)}${hasSession(ctx.program?.session) ? " -H «session»" : ""}`,
    parse: (stdout, ctx) => {
      const rows: Record<string, unknown>[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim().startsWith("{")) continue;
        try {
          rows.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* skip */
        }
      }
      writeEvidence(ctx, "tools.httpx", `httpx -u ${baseUrl(ctx)}`, stdout);
      return { findings: [], data: { probed: rows.length, rows: rows.slice(0, 50) } };
    },
  },

  "tools.subfinder": {
    id: "tools.subfinder",
    titleAr: "subfinder (تعداد من مصادر عامة)",
    active: false,
    binary: "subfinder",
    installHint: "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest",
    budgetMs: 90_000,
    args: (ctx) => ["-d", ctx.host, "-json", "-silent", "-timeout", "10"],
    command: (ctx) => `subfinder -d ${shQuote(ctx.host)} -json -silent`,
    parse: (stdout, ctx) => {
      const subs = new Set<string>();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/"host"\s*:\s*"([^"]+)"/);
        if (m) subs.add(m[1]);
        else if (/^[a-z0-9.*-]+$/.test(line.trim())) subs.add(line.trim());
      }
      writeEvidence(ctx, "tools.subfinder", `subfinder -d ${ctx.host}`, stdout);
      return { findings: [], data: { subdomains: [...subs].slice(0, 500), count: subs.size } };
    },
  },

  "tools.katana": {
    id: "tools.katana",
    titleAr: "katana (زحف endpoints آمن)",
    active: true,
    binary: "katana",
    installHint: "go install -v github.com/projectdiscovery/katana/cmd/katana@latest",
    budgetMs: 110_000, // katana: a bounded crawl, not an open-ended one
    args: (ctx) => ["-u", `${baseUrl(ctx)}/`, "-jsonl", "-silent", "-depth", "2", "-concurrency", "4", "-rate-limit", String(Math.max(1, Math.round(ctx.rps))), "-timeout", "8", "-crawl-duration", "60s", ...sessionArgs(ctx.program?.session)],
    command: (ctx) => `${redactSecrets(`katana -u ${shQuote(`${baseUrl(ctx)}/`)} -jsonl -silent -depth 2 -rate-limit ${Math.max(1, Math.round(ctx.rps))}`, ctx.program?.session)}${hasSession(ctx.program?.session) ? " -H «session»" : ""}`,
    parse: (stdout, ctx) => {
      const urls = new Set<string>();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/"url"\s*:\s*"([^"]+)"/);
        if (m) urls.add(m[1]);
      }
      writeEvidence(ctx, "tools.katana", `katana -u ${baseUrl(ctx)}`, stdout);
      const interesting = [...urls].filter((u) => /(admin|internal|debug|actuator|\.env|config|backup|swagger|graphql)/i.test(u));
      const findings = interesting.slice(0, 10).map((u) =>
        mkFinding(ctx, {
          kind: "tools.katana",
          title: "Interesting endpoint discovered",
          titleAr: `مسار حسّاس مكشوف: ${u}`,
          severity: /\.env|backup|config/i.test(u) ? "high" : "medium",
          confidence: 0.6,
          cwe: "CWE-538",
          target: u,
          reproduce: `curl -si ${shQuote(u)}`,
          remediationAr: "احذف المسار من النشر أو ضعه خلف تصريح؛ لا تعتمد على إخفاء العنوان.",
          evidence: [writeEvidence(ctx, "tools.katana.hit", `crawl ${u}`, u)],
        }),
      );
      return { findings, data: { discovered: urls.size, urls: [...urls].slice(0, 300) } };
    },
  },

  "tools.nmap": {
    id: "tools.nmap",
    titleAr: "nmap (كشف خدمات مقيّد بمصرّح به)",
    active: true,
    binary: "nmap",
    installHint: "apt-get install -y nmap",
    args: (ctx) => ["-Pn", "-sV", "--open", "-p", "80,443,22,21,25,3306,5432,6379,8080", "-oX", "-", "--host-timeout", "120s", ctx.host].filter(Boolean) as string[],
    command: (ctx) => `nmap -Pn -sV --open -p 80,443,22,21,25,3306,5432,6379,8080 ${shQuote(ctx.host)}`,
    parse: (stdout, ctx) => {
      writeEvidence(ctx, "tools.nmap", `nmap ${ctx.host}`, stdout);
      const ports = [...stdout.matchAll(/<port protocol="(\w+)".*?portid="(\d+)"[\s\S]*?state state="open"/g)];
      const services = [...stdout.matchAll(/<service name="([^"]+)" product="([^"]*)" version="([^"]*)"/g)];
      const data = {
        open: ports.map((p) => ({ proto: p[1], port: Number(p[2]) })),
        services: services.map((s) => ({ name: s[1], product: s[2], version: s[3] })),
      };
      return { findings: [], data };
    },
  },

  /* ── أدوات المِرر الثابتة (2026-11-07) ───────────────────────────────────────
   * دي بتيجي من `scripts/fetch-toolchain.mjs` (نسخ ثابتة بلا root) وبتتنزّل من
   * مرآتنا على جيت هاب (`nova-toolchain`) لأن `api.github.com` محجوب من الحاوية
   * (متقاس: `GET /api/ops/tools → last` يوم 17:32:23Z). مافيهاش رقم مكتوب:
   * الأداة بتتنفّذ فعلاً، والدليل بيتكتب بـ`writeEvidence`، ولو الأداة رجّعت
   * «flag provided but not defined» ده بيبان في stderr المسجّل مش يختفي.
   */

  "tools.amass": {
    id: "tools.amass",
    titleAr: "amass (تعداد أسماء فرعية من مصادر عامة)",
    active: false, // passive: بيقرأ مصادر عامة، ما بيلمس الهدفش
    binary: "amass",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only amass",
    budgetMs: 150_000,
    args: (ctx) => ["enum", "-passive", "-d", ctx.host, "-silent", "-timeout", "120"],
    command: (ctx) => `amass enum -passive -d ${shQuote(ctx.host)} -silent`,
    parse: (stdout, ctx) => {
      const subs = new Set<string>();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/\b([a-z0-9][a-z0-9._-]*\.[a-z]{2,})\b/i);
        if (m && m[1].toLowerCase().endsWith(`.${ctx.host.toLowerCase()}`)) subs.add(m[1].toLowerCase());
      }
      writeEvidence(ctx, "tools.amass", `amass enum -passive -d ${ctx.host}`, stdout);
      return { findings: [], data: { subdomains: [...subs].slice(0, 500), count: subs.size } };
    },
  },

  "tools.naabu": {
    id: "tools.naabu",
    titleAr: "naabu (كشف بورتات مفتوحة — على مصرّح به بس)",
    active: true, // بيلمس الهدف: الحارس `assertAuthorized(..., {active:true})` في runner.ts
    binary: "naabu",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only naabu",
    budgetMs: 90_000,
    args: (ctx) => ["-host", ctx.host, "-top-ports", "100", "-json", "-silent", "-rate", "100", "-timeout", "3"],
    command: (ctx) => `naabu -host ${shQuote(ctx.host)} -top-ports 100 -json -silent -rate 100`,
    parse: (stdout, ctx) => {
      const open: Array<{ port: number; transport: string }> = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const j = JSON.parse(line) as { port?: number; transport?: string };
          if (typeof j.port === "number") open.push({ port: j.port, transport: j.transport ?? "tcp" });
        } catch { /* سطر وسطي من الأداة — نتجاهله ونكمل */ }
      }
      writeEvidence(ctx, "tools.naabu", `naabu -host ${ctx.host}`, stdout);
      const findings = open.slice(0, 12).map((o) =>
        mkFinding(ctx, {
          kind: "tools.naabu",
          title: `Open port ${o.port}/${o.transport}`,
          titleAr: `بورت مفتوح: ${o.port}/${o.transport}`,
          severity: o.port === 6379 || o.port === 3306 || o.port === 5432 || o.port === 27017 ? "high" : "info",
          confidence: 0.9,
          cwe: "CWE-200",
          target: `${ctx.host}:${o.port}`,
          reproduce: `nc -vz ${shQuote(ctx.host)} ${o.port}`,
          remediationAr: "اقفل البورت على حدود الشبكة أو حطّه خلف VPN؛ مافيش معنى إن داتابيز تسمع على العنوان العام.",
          evidence: [writeEvidence(ctx, "tools.naabu.hit", `port ${o.port}`, String(o.port))],
        }),
      );
      return { findings, data: { openPorts: open.map((o) => o.port), count: open.length } };
    },
  },

  "tools.ffuf": {
    id: "tools.ffuf",
    titleAr: "ffuf (بحث مسارات بالقائمة المدمجة)",
    active: true,
    binary: "ffuf",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only ffuf",
    budgetMs: 120_000,
    args: (ctx) => {
      const wl = wordlistPath();
      return ["-u", `${baseUrl(ctx)}/FUZZ`, "-w", wl || "/dev/null", "-t", "20", "-mc", "200,204,301,302,401,403,429", "-s", "-timeout", "10"];
    },
    command: (ctx) => `ffuf -u ${shQuote(`${baseUrl(ctx)}/FUZZ`)} -w ${shQuote(wordlistPath() || "— مفيش wordlist")} -t 20 -mc 200,301,302,401,403 -s`,
    parse: (stdout, ctx) => {
      const hits = [...stdout.matchAll(/^\/?(\S+)\s+\[Status: (\d+), Size: (\d+)/gm)].map((m) => ({ path: `/${m[1]}`, status: Number(m[2]), size: Number(m[3]) }));
      writeEvidence(ctx, "tools.ffuf", `ffuf ${baseUrl(ctx)}/FUZZ`, stdout);
      const findings = hits.slice(0, 10).map((h) =>
        mkFinding(ctx, {
          kind: "tools.ffuf",
          title: `Discovered path ${h.path}`,
          titleAr: `مسار مكشوف: ${h.path}`,
          severity: /\.(env|git|sql|bak)|admin|actuator|config|backup/i.test(h.path) ? "medium" : "info",
          confidence: 0.55,
          cwe: "CWE-538",
          target: `${baseUrl(ctx)}${h.path}`,
          reproduce: `curl -si ${shQuote(`${baseUrl(ctx)}${h.path}`)}`,
          remediationAr: "المسارات الإدارية ما تتكشفش بالعشوائية: حطّها خلف تصريح وسجّل الدخول الفاشل.",
          evidence: [writeEvidence(ctx, "tools.ffuf.hit", h.path, `status=${h.status} size=${h.size}`)],
        }),
      );
      return { findings, data: { paths: hits.length, sample: hits.slice(0, 60), wordlist: wordlistPath() || null } };
    },
  },

  "tools.gobuster": {
    id: "tools.gobuster",
    titleAr: "gobuster (تأكيد مسارات — أداة تانية، نفس الهدف)",
    active: true,
    binary: "gobuster",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only gobuster",
    budgetMs: 110_000,
    args: (ctx) => ["dir", "-u", `${baseUrl(ctx)}/`, "-w", wordlistPath() || "/dev/null", "-q", "-t", "10", "--timeout", "10s", "-k"],
    command: (ctx) => `gobuster dir -u ${shQuote(`${baseUrl(ctx)}/`)} -w ${shQuote(wordlistPath() || "— مفيش wordlist")} -q -t 10`,
    parse: (stdout, ctx) => {
      const hits = [...stdout.matchAll(/^\/(\S+)\s+\(Status:\s*(\d+)/gm)].map((m) => ({ path: `/${m[1]}`, status: Number(m[2]) }));
      writeEvidence(ctx, "tools.gobuster", `gobuster dir ${baseUrl(ctx)}`, stdout);
      return { findings: [], data: { paths: hits.length, sample: hits.slice(0, 60), wordlist: wordlistPath() || null } };
    },
  },

  "tools.dalfox": {
    id: "tools.dalfox",
    titleAr: "dalfox (فحص XSS على مصرّح به)",
    active: true,
    binary: "dalfox",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only dalfox",
    budgetMs: 120_000,
    args: (ctx) => ["url", `${baseUrl(ctx)}/`, "--only-poc=s", "--quiet", "--no-color"],
    command: (ctx) => `dalfox url ${shQuote(`${baseUrl(ctx)}/`)} --only-poc=s --quiet`,
    parse: (stdout, ctx) => {
      writeEvidence(ctx, "tools.dalfox", `dalfox url ${baseUrl(ctx)}`, stdout);
      const poc = [...stdout.matchAll(/\[POC]\s*(\S+)/g)].map((m) => m[1]);
      const findings = poc.slice(0, 8).map((u) =>
        mkFinding(ctx, {
          kind: "tools.dalfox",
          title: "Reflected XSS confirmed by payload",
          titleAr: "XSA منعكس مؤكَّد ببيلود نُفّذ",
          severity: "high",
          confidence: 0.6,
          cwe: "CWE-79",
          target: u.slice(0, 300),
          reproduce: `dalfox url ${shQuote(u)}`,
          remediationAr: "اِهروب السياق (HTML/attribute/JS) حسب موضع الإدخال، ومحتوى صارم للـCSP على الصفحة دي.",
          evidence: [writeEvidence(ctx, "tools.dalfox.hit", u, stdout.slice(0, 4000))],
        }),
      );
      return { findings, data: { poc: poc.length } };
    },
  },

  "tools.gitleaks": {
    id: "tools.gitleaks",
    titleAr: "gitleaks (تدقيق المستودع بتاعنا: مفاتيح اتسرّبت)",
    active: false, // على الشجرة المحلية، مش على هدف خارجي
    binary: "gitleaks",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only gitleaks",
    budgetMs: 180_000,
    args: () => ["detect", "--no-git", "--source", process.cwd(), "-f", "json", "--exit-code", "0", "--redact"],
    command: () => `gitleaks detect --no-git --source ${shQuote(process.cwd())} -f json --exit-code 0 --redact`,
    parse: (stdout, ctx) => {
      writeEvidence(ctx, "tools.gitleaks", `gitleaks detect ${process.cwd()}`, stdout);
      let rows: Array<{ RuleID?: string; File?: string; Line?: number; Match?: string }> = [];
      try {
        const parsed = JSON.parse(stdout.slice(stdout.indexOf("["), stdout.lastIndexOf("]") + 1));
        if (Array.isArray(parsed)) rows = parsed as typeof rows;
      } catch {
        /* مفيش نتائج = مفيش JSON — مش خطأ نعلنه كصفر */
      }
      const findings = rows.slice(0, 12).map((r) =>
        mkFinding(ctx, {
          kind: "tools.gitleaks",
          title: `Leaked secret in our own tree: ${r.RuleID ?? "rule?"}`,
          titleAr: `سر مسرّب في المستودع بتاعنا: ${r.RuleID ?? "قاعدة مجهولة"}`,
          severity: "critical",
          confidence: 0.8,
          cwe: "CWE-798",
          target: `${String(r.File ?? "?")}:${String(r.Line ?? "?")}`,
          reproduce: `gitleaks detect --no-git --source . -f json`,
          remediationAr: "ادوّر المفتاح (rotation) وامسحه من التاريخ، وسيلّه في CI — القالب اللي بيقبض على أي pattern بيموت بعد أول يوم، فالبصمة بتاعتنا مقصودة.",
          evidence: [writeEvidence(ctx, "tools.gitleaks.hit", String(r.File ?? "?"), String(r.Match ?? "redacted").slice(0, 200))],
        }),
      );
      return { findings, data: { leaks: rows.length, scanned: process.cwd(), redacted: true } };
    },
  },

  /* ── إضافات 2026-11-07: أدوات جاية من المِرر، بنفس قواعد الإذن ─────────────
   * تلاتة منها بتشتغل علي الشجرة بتاعتنا (osv/trufflehog) — يعني الفحص مابيرجعش
   * «صفر» لأن النت مقفول، وواحدة بتكلّم شهادات TLS، وواحدة بتعدّي بارامترات من
   * قائمة SecLists مدمجة. الأعلام هنا من وثايق كل أداة؛ ولو واحدة منهم غلط،
   * الأداة بترجع exit != 0 وstderr بيتسجّل في الدليل — مافيش «نجح» من غير قياس.
   */

  "tools.tlsx": {
    id: "tools.tlsx",
    titleAr: "tlsx (شهادات TLS: انتهاء، توقيع ذاتي، سلاسل ناقصة)",
    active: true, // بيفتح يد على بورت 443 بتاع الهدف
    binary: "tlsx",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only tlsx",
    budgetMs: 60_000,
    args: (ctx) => ["-host", ctx.host, "-port", "443", "-json", "-silent"],
    command: (ctx) => `tlsx -host ${shQuote(ctx.host)} -port 443 -json -silent`,
    parse: (stdout, ctx) => {
      writeEvidence(ctx, "tools.tlsx", `tlsx ${ctx.host}`, stdout);
      const rows: Record<string, unknown>[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim().startsWith("{")) continue;
        try {
          rows.push(JSON.parse(line) as Record<string, unknown>);
        } catch { /* سطر وسطي */ }
      }
      const findings: Finding[] = [];
      for (const r of rows.slice(0, 8)) {
        const expired = r.expired === true || r.Expired === true;
        const selfSigned = String(r.cert_chain ?? "").length === 0 || r.self_signed === true;
        if (!expired && !selfSigned) continue;
        findings.push(
          mkFinding(ctx, {
            kind: "tools.tlsx",
            title: expired ? "TLS certificate is expired" : "TLS certificate has an incomplete chain",
            titleAr: expired ? "شهادة TLS منتهية الصلاحية" : "سلسلة الشهادة ناقصة/توقيع ذاتي",
            severity: expired ? "high" : "medium",
            confidence: 0.9,
            cwe: "CWE-295",
            target: `${ctx.host}:443`,
            reproduce: `echo | openssl s_client -connect ${shQuote(`${ctx.host}:443`)} -servername ${shQuote(ctx.host)} 2>/dev/null | openssl x509 -noout -dates -issuer`,
            remediationAr: "جدّد الشهادة واثبت السلسلة الكاملة (intermediate)؛ المتصفح بيحذّر ومش بيغلطش لمصلحتك.",
            evidence: [writeEvidence(ctx, "tools.tlsx.hit", `${ctx.host}:443`, JSON.stringify(r).slice(0, 2000))],
          }),
        );
      }
      return { findings, data: { certs: rows.length } };
    },
  },

  "tools.uncover": {
    id: "tools.uncover",
    titleAr: "uncover (أصول مكشوفة للنطاق على محركات بحث عامة)",
    active: false, // بيبحث في مصادر عامة عن النطاق، ما بيلمسش الهدف
    binary: "uncover",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only uncover",
    budgetMs: 75_000,
    args: (ctx) => ["-q", `domain:${ctx.host}`, "-silent", "-json"],
    command: (ctx) => `uncover -q ${shQuote(`domain:${ctx.host}`)} -silent -json`,
    parse: (stdout, ctx) => {
      writeEvidence(ctx, "tools.uncover", `uncover domain:${ctx.host}`, stdout);
      const hits: Array<{ ip: string; port: string; proto: string; src: string }> = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const j = JSON.parse(line) as Record<string, unknown>;
          hits.push({
            ip: String(j.ip ?? j.URL ?? "?"),
            port: String(j.port ?? ""),
            proto: String(j.proto ?? j.protocol ?? ""),
            src: String(j.source ?? ""),
          });
        } catch { /* سطر وسطي */ }
      }
      const risky = hits.filter((h) => /^(22|23|3389|5900|6379|9200|27017|554|8545)$/.test(h.port));
      const findings = risky.slice(0, 8).map((h) =>
        mkFinding(ctx, {
          kind: "tools.uncover",
          title: `Exposed service in public indexes: ${h.ip}:${h.port}`,
          titleAr: `خدمة مكشوفة مسجّلة في محركات بحث عامة: ${h.ip}:${h.port}`,
          severity: "high",
          confidence: 0.7,
          cwe: "CWE-200",
          target: `${h.ip}:${h.port}`,
          reproduce: `uncover -q ${shQuote(`domain:${ctx.host}`)} -silent -json | grep ${shQuote(String(h.port))}`,
          remediationAr: "المؤشر العام معناه إن المنفذ كان مفتوح للعالم: اقفلُه أو طلعه خلف VPN، واطلب مسح من المحركات.",
          evidence: [writeEvidence(ctx, "tools.uncover.hit", `${h.ip}:${h.port}`, JSON.stringify(h))],
        }),
      );
      return { findings, data: { results: hits.length, risky: risky.length, sample: hits.slice(0, 40) } };
    },
  },

  "tools.osv": {
    id: "tools.osv",
    titleAr: "osv-scanner (ثغرات قفلنا نفسه — من غير قاعدة بيانات ولا نت)",
    active: false, // محلي 100%
    binary: "osv-scanner",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only osv-scanner",
    budgetMs: 180_000,
    args: () => {
      // الصيغة الموثّقة في v2 (`docs/usage.md`): `scan -L <قفل> --format json`، أو
      // `scan -r <مجلد>` لو مالقيناوش (حزمة standalone). `--no-resolve` عشان
      // ميعملش شبكة لنبني شجرة — على البوكس اللي النت فيه محدود ده فرق جوهري.
      const lock = lockfilePath();
      if (lock) return ["scan", "-L", lock, "--format", "json", "--no-resolve"];
      // البوكس ماإلوش قفل في الجذر (huly: ROOT=artifacts/api-server) — نلقّيه في
      // الشجرة ونمسك أول قفل npm/pnpm، ولو مافيشش نعمل scan -r على الجذر نفسه.
      for (const base of [path.resolve(process.cwd(), ".."), path.resolve(process.cwd(), "../..")]) {
        for (const name of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
          const p = path.join(base, name);
          try {
            if (fs.statSync(p).isFile()) return ["scan", "-L", p, "--format", "json", "--no-resolve"];
          } catch {
            /* كمّل */
          }
        }
      }
      return ["scan", "-r", ".", "--format", "json", "--no-resolve"];
    },
    command: () => `osv-scanner scan ${lockfilePath() ? `-L ${path.basename(lockfilePath())}` : "-r ."} --format json`,
    parse: (stdout, ctx) => {
      writeEvidence(ctx, "tools.osv", `osv-scanner ${path.basename(lockfilePath() || ".")}`, stdout);
      const vulns: Array<{ id?: string; package?: { name?: string; version?: string }; aliases?: string[]; severity?: string }> = [];
      try {
        const doc = JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)) as { results?: Array<{ packages?: Array<{ packagePath?: unknown; vulnerabilities?: typeof vulns }> }> };
        for (const r of doc?.results ?? []) for (const pkg of r?.packages ?? []) vulns.push(...(pkg?.vulnerabilities ?? []));
      } catch {
        /* مفيش JSON = الأداة ما خلّصتش؛ stderr بيتسجّل فوق في الدليل */
      }
      const findings = vulns.slice(0, 15).map((v) =>
        mkFinding(ctx, {
          kind: "tools.osv",
          title: `${v.package?.name ?? "?"}@${v.package?.version ?? "?"} — ${v.id ?? "?"}`,
          titleAr: `اعتمادية فيها ثغرة معروفة: ${v.package?.name ?? "?"}@${v.package?.version ?? "?"} (${v.id ?? "?"})`,
          severity: "high",
          confidence: 0.9,
          cwe: "CWE-1104",
          target: String(v.package?.name ?? "dependency"),
          reproduce: "osv-scanner scan -L pnpm-lock.yaml --format json",
          remediationAr: "ارفع النسخة في pnpm-lock واعمل commit للقفل، وسيب البوابة تقيسه.",
          evidence: [writeEvidence(ctx, "tools.osv.hit", String(v.package?.name ?? "?"), JSON.stringify(v).slice(0, 1500))],
        }),
      );
      return { findings, data: { vulns: vulns.length, source: path.basename(lockfilePath() || "scan -r .") } };
    },
  },

  "tools.trufflehog": {
    id: "tools.trufflehog",
    titleAr: "trufflehog (مفاتيح حقيقية في شجرتنا — المتحقق منها بس)",
    active: false,
    binary: "trufflehog",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only trufflehog",
    budgetMs: 240_000,
    // `--results=verified` بدل `--only-verified` اللي اتغير اسمها في v3،
    // و`--no-update-check` يمنع الأداة تلمّ نفسها من النت وقت التشغيل.
    args: () => ["filesystem", process.cwd(), "--json", "--results=verified", "--no-update-check"],
    command: () => `trufflehog filesystem ${shQuote(process.cwd())} --json --results=verified`,
    parse: (stdout, ctx) => {
      writeEvidence(ctx, "tools.trufflehog", `trufflehog filesystem ${process.cwd()}`, stdout);
      const rows: Array<Record<string, unknown>> = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim().startsWith("{")) continue;
        try {
          rows.push(JSON.parse(line) as Record<string, unknown>);
        } catch { /* سطر وسطي */ }
      }
      const findings = rows.slice(0, 10).map((r) => {
        const det = (r.detector_name as string) || (r.DecoderName as string) || "secret";
        const loc = (r.SourceMetadata as { Source?: { Raw?: string } })?.Source?.Raw || String(r.location ?? "?");
        return mkFinding(ctx, {
          kind: "tools.trufflehog",
          title: `Verified ${det} credential in our own tree`,
          titleAr: `مفتاح ${det} متحقق منه في شجرتنا`,
          severity: "critical",
          confidence: 0.95,
          cwe: "CWE-798",
          target: loc.slice(0, 200),
          reproduce: `trufflehog filesystem . --json --results=verified`,
          remediationAr: "ادوّر المفتاح حالا وامسحه من التاريخ (git filter-repo) وسيلّه في CI.",
          evidence: [writeEvidence(ctx, "tools.trufflehog.hit", loc, JSON.stringify(r).slice(0, 2000))],
        });
      });
      return { findings, data: { verifiedLeaks: rows.length } };
    },
  },

  "tools.parammine": {
    id: "tools.parammine",
    titleAr: "صيد بارامترات (ffuf + قائمة burp المدمجة)",
    active: true,
    binary: "ffuf",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only ffuf",
    budgetMs: 120_000,
    args: (ctx) => ["-u", `${baseUrl(ctx)}/?FUZZ=1`, "-w", paramsList() || "/dev/null", "-t", "20", "-mc", "200,204,301,302,400,401,403,429", "-s", "-timeout", "8"],
    command: (ctx) => `ffuf -u ${shQuote(`${baseUrl(ctx)}/?FUZZ=1`)} -w ${shQuote(paramsList() || "— مفيش قائمة بارامترات")} -t 20 -mc 200,400,401,403 -s`,
    parse: (stdout, ctx) => {
      const names = [...stdout.matchAll(/^\/(\S+?)\s+\[Status: (\d+)/gm)].map((m) => ({ name: m[1], status: Number(m[2]) }));
      writeEvidence(ctx, "tools.parammine", `ffuf ?FUZZ ${baseUrl(ctx)}`, stdout);
      return {
        findings: [],
        data: { params: names.length, sample: names.slice(0, 80), list: paramsList() || null },
      };
    },
  },

  "tools.trivy": {
    id: "tools.trivy",
    titleAr: "trivy (ثغرات الحزم في شجرتنا + أسرار)",
    active: false,
    binary: "trivy",
    installHint: "GET /api/ops/tools · node scripts/fetch-toolchain.mjs --only trivy",
    budgetMs: 240_000,
    args: () => ["fs", "--scanners", "vuln,secret", "--severity", "CRITICAL,HIGH", "--format", "json", "--quiet", "--exit-code", "0", process.cwd()],
    command: () => `trivy fs --scanners vuln,secret --severity CRITICAL,HIGH --format json .`,
    parse: (stdout, ctx) => {
      writeEvidence(ctx, "tools.trivy", `trivy fs ${process.cwd()}`, stdout);
      let vulns: Array<{ VulnerabilityID?: string; PkgName?: string; InstalledVersion?: string; FixedVersion?: string; Severity?: string }> = [];
      try {
        const doc = JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)) as { Results?: Array<{ Vulnerabilities?: typeof vulns }> };
        for (const r of doc?.Results ?? []) vulns.push(...(r?.Vulnerabilities ?? []));
      } catch {
        /* مفيش مخرجات JSON = الأداة ما خلّصتش، وده بيتسجّل في stderr */
      }
      const findings = vulns.slice(0, 15).map((v) =>
        mkFinding(ctx, {
          kind: "tools.trivy",
          title: `${v.PkgName ?? "?"}@${v.InstalledVersion ?? "?"} — ${v.VulnerabilityID ?? "?"}`,
          titleAr: `حزمة فيها ثغرة: ${v.PkgName ?? "?"}@${v.InstalledVersion ?? "?"} (${v.VulnerabilityID ?? "?"})`,
          severity: v.Severity === "CRITICAL" ? "critical" : "high",
          confidence: 0.85,
          cwe: "CWE-1104",
          target: String(v.PkgName ?? "dependency"),
          reproduce: `trivy fs --scanners vuln --severity CRITICAL,HIGH .`,
          remediationAr: v.FixedVersion ? `ارفع النسخة لـ${v.FixedVersion} في pnpm-lock وسجّل القفل.` : "مافيش نسخة مُصلَحة بعد: شيل الاعتمادية أو قيّدها.",
          evidence: [writeEvidence(ctx, "tools.trivy.hit", String(v.PkgName ?? "?"), JSON.stringify(v).slice(0, 1500))],
        }),
      );
      return { findings, data: { vulns: vulns.length, packages: new Set(vulns.map((v) => v.PkgName)).size } };
    },
  },
};

export const KIND_LIST = Object.values(KINDS).map((k) => ({
  id: k.id,
  titleAr: k.titleAr,
  active: k.active,
  binary: k.binary ?? null,
  present: k.binary ? Boolean(findBinary(k.binary)) : true,
}));

/* ── dispatcher ──────────────────────────────────────────────────────────── */

/**
 * الساعة بتاعة الـkind: `budgetMs` بترفع وبتوطّي، مقصوصة 15s…10m. مطلوعة هنا لأن
 * السقف الخارجي (الـdeadline اللي حوالين `runKind` في runner.ts) لازم يلزم **نفس**
 * الرقم — سقف بيوطّي عن `budgetMs` بيقطع الـscan في النص، ومقاس بالظبط:
 * CI 2026-11-03T21:41Z رجع `task-timeout:tools.nuclei:180000ms` بينما nuclei ليه 540s.
 * القاعدة: «The KIND owns its clock» — واللي بيراقب الساعة مايعتديش عليها.
 */
export function kindDeadlineMs(kindId: string, ctxTimeoutMs: number): number {
  const kind = KINDS[kindId];
  return Math.max(15_000, Math.min(kind?.budgetMs ?? ctxTimeoutMs, 600_000));
}

export async function runKind(kindId: string, params: Record<string, unknown>, ctx: RunCtx): Promise<KindResult> {
  const kind = KINDS[kindId];
  if (!kind) return { ok: false, summary: `نوع مهمة غير معروف: ${kindId}`, findings: [], error: "unknown-kind" };

  if (kind.run) {
    try {
      return await kind.run(ctx, params);
    } catch (err) {
      return { ok: false, summary: `فشل ${kindId}: ${(err as Error).message}`, findings: [], error: (err as Error).message };
    }
  }

  /* real tool path */
  const bin = kind.binary!;
  const argv = kind.args ? kind.args(ctx, params) : [];
  const display = kind.command ? kind.command(ctx, params) : `${bin} ${argv.join(" ")}`;
  const started = Date.now();

  // THE FINDING AND THE SPAWN MUST AGREE. findBinary() also looks in vendor/bin (a free PaaS
  // has no apt), but a bare `spawn("nuclei")` is resolved by PATH — so the plan could promise a
  // tool the exec then killed with 127 (measured: Actions run 41451529132, `tools.*: tool-missing`
  // for binaries /ops/kinds had just reported present). Spawn the resolved path, and put its
  // directory first on the child's PATH so tools that shell out to siblings still work.
  const abs = findBinary(bin) ?? bin;
  const runLocal = async (): Promise<KindResult> => {
    const res = await runArgv(abs, argv, {
      cwd: ctx.jobDir,
      // The KIND owns its clock. A job's per-task default (180 s) is right for a header probe and
      // wrong for a full nuclei run, so `budgetMs` can raise as well as lower — clamped to 15 s…10 m
      // so a typo can neither make a task untouchable nor starve the job behind it.
      timeoutMs: kindDeadlineMs(kind.id, ctx.timeoutMs),
      env: {
        ...process.env,
        TERM: "dumb",
        ...(abs !== bin ? { PATH: `${path.dirname(abs)}${path.delimiter}${process.env.PATH || ""}` } : {}),
      },
    });
    if (res.code === 127) {
      return {
        ok: false,
        summary: `الأداة «${bin}» مش منصّبة على النود. أمر التثبيت: ${kind.installHint ?? "راجع /api/installer/tools"}`,
        findings: [],
        error: "tool-missing",
        data: { install: kind.installHint, exit: res.code },
      };
    }
    const parsed = kind.parse ? kind.parse(res.stdout, ctx) : { findings: [] };
    // The exit code is authoritative. "Printed bytes" used to be enough, so a usage error from a
    // wrong flag became a green task with zero findings — a scan that reports nothing and looks
    // fine is the worst failure mode a security tool can have.
    const tail = (line: string) => line.split("\n").map((x) => x.trim()).filter(Boolean).slice(-1)[0] ?? "";
    if (res.killed) {
      return {
        ok: false,
        summary:
          `${bin} اتقطع بعد ${Date.now() - started}ms (ميزانية النوع) · ${parsed.findings.length} نتيجة لحد هنا — «اتقطع» مش «مافيش»` +
          (kindId === "tools.nuclei"
            ? ` · ${nucleiEtaNote(params, ctx.rps)}`
            : ""),
        findings: parsed.findings,
        error: "tool-timeout",
        data: { exit: res.code, budgetMs: kindDeadlineMs(kind.id, ctx.timeoutMs), partial: parsed.data ?? {} },
      };
    }
    if (res.code !== 0) {
      return {
        ok: false,
        summary: `${bin} فشل (exit=${res.code}) · ${tail(res.stderr || res.stdout) || "مفيش رسالة من الأداتة"} · ${Date.now() - started}ms`,
        findings: parsed.findings,
        error: "tool-failed",
        data: { exit: res.code, stderr: res.stderr.slice(0, 2_000), command: display },
      };
    }
    return {
      ok: true,
      summary: `${bin} exit=0 · ${res.stdout.length} بايت · ${Date.now() - started}ms`,
      findings: parsed.findings,
      data: { ...(parsed.data ?? {}), exit: res.code, stderr: res.stderr.slice(0, 2_000) },
    };
  };

  const runOnAgent = async (agentId: string): Promise<KindResult> => {
    const out = await execOnLocalAgent(display, agentId, Math.min(ctx.timeoutMs, 300_000));
    if (!out) {
      return { ok: false, summary: `الجهاز ${agentId} ماردّش على ${bin}`, findings: [], error: "agent-unreachable" };
    }
    const parsed = kind.parse ? kind.parse(out.stdout, ctx) : { findings: [] };
    writeEvidence(ctx, `${kindId}.${agentId}`, display, out.stdout, out.exitCode);
    return {
      ok: out.exitCode === 0 || out.stdout.length > 0,
      summary: `[${agentId}] ${bin} exit=${out.exitCode} · ${out.durationMs}ms · ${parsed.findings.length} نتيجة`,
      findings: parsed.findings,
      data: { ...(parsed.data ?? {}), exit: out.exitCode, stderr: (out.stderr || "").slice(0, 2_000) },
    };
  };

  if (ctx.agentId) {
    try {
      return await runOnAgent(ctx.agentId);
    } catch (err) {
      ctx.log(`fleet exec failed (${(err as Error).message}) — falling back to node`);
    }
  }
  if (!ctx.allowNodeTools) {
    return {
      ok: false,
      summary: `مفيش نود متاح للتشغيل — شغّل جهاز بالوكيل أو ارفع NOVA_ALLOW_NODE_TOOLS=1 على سيرفرك`,
      findings: [],
      error: "no-exec-plane",
      data: { command: display },
    };
  }
  if (!findBinary(bin)) {
    return {
      ok: false,
      summary: `الأداة «${bin}» مش على النود ولا على نود متصل. ثبّتها: ${kind.installHint ?? "/api/installer/tools"}`,
      findings: [],
      error: "tool-missing",
      data: { command: display },
    };
  }
  return await runLocal();
}
