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
import {
  scanDns,
  scanHeaders,
  scanPorts,
  scanSsl,
  scanSubdomains,
  nvdSearch,
} from "../security-tools";
import { fetchSecurityTxt, type Program } from "./scope";
import { HOSTS, freeHostSummary, type FreeHost } from "./free-hosts";
import { execOnLocalAgent } from "../../routes/local-agent";

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
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
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
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, env: opts.env ?? process.env, shell: false });
    } catch (err) {
      resolve({ code: 127, stdout: "", stderr: (err as Error).message });
      return;
    }
    let stdout = "";
    let stderr = "";
    const killer = setTimeout(() => {
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
      resolve({ code: 127, stdout, stderr: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code: code ?? -1, stdout, stderr });
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
  const vendored = [path.resolve(process.cwd(), "vendor/bin")];
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
  if (pathCache.has(bin)) return pathCache.get(bin) ?? null;
  const dirs = searchDirs();
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
  pathCache.set(bin, hit);
  return hit;
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
      const data = await scanHeaders(ctx.host, ctx.scheme === "https");
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
    titleAr: "تعداد نطاقات فرعية من سجلات الشهادات (سلبي)",
    active: false,
    run: async (ctx) => {
      const rows = await scanSubdomains(ctx.host);
      const ev = writeEvidence(ctx, "recon.certspotter", `crt.sh?q=%.${ctx.host}`, JSON.stringify(rows, null, 2));
      const apex = ctx.host;
      const findings: Finding[] = [];
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
      return { ok: true, summary: `${rows.length} نطاق فرعي من CT logs (سلبي) · ${findings.length} مرشّح`, findings, data: { count: rows.length, apex, subdomains: rows.map((r) => r.subdomain) }, };
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
      const res = await fetch(baseUrl(ctx), { redirect: "follow", signal: AbortSignal.timeout(ctx.timeoutMs) });
      const html = await res.text();
      const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 12);
      const urls = srcs.map((s) => new URL(s, baseUrl(ctx)).toString());
      const paths = new Set<string>();
      const mapFiles: string[] = [];
      for (const u of urls) {
        try {
          const js = await (await fetch(u, { signal: AbortSignal.timeout(ctx.timeoutMs) })).text();
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

  /* ── real tools (argv) ─────────────────────────────────────────────────── */
  "tools.nuclei": {
    id: "tools.nuclei",
    titleAr: "ProjectDiscovery Nuclei (قوالب إعدادات/تعرّض)",
    active: true,
    binary: "nuclei",
    installHint: "sh -c \"$(curl -sL https://raw.githubusercontent.com/projectdiscovery/nuclei/main/install.sh)\"",
    args: (ctx, p) => {
      const sev = (p["severities"] as string[]) ?? ["low", "medium", "high", "critical"];
      return [
        "-u", `${baseUrl(ctx)}/`,
        "-json", "-silent", "-no-color",
        "-rl", String(Math.max(1, Math.round(ctx.rps))),
        "-c", String(Math.max(1, ctx.program.max_concurrency ?? 2)),
        "-severity", sev.join(","),
        "-timeout", "6", "-retries", "1",
        "-stats",
      ];
    },
    command: (ctx, p) => `nuclei -u ${shQuote(`${baseUrl(ctx)}/`)} -json -silent -rl ${Math.max(1, Math.round(ctx.rps))} -severity ${shQuote(((p["severities"] as string[]) ?? ["medium", "high", "critical"]).join(","))}`,
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
            evidence: [writeEvidence(ctx, "tools.nuclei", `nuclei -json (template ${String(j["template-id"] ?? "?")})`, line)],
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
    args: (ctx) => ["-u", `${baseUrl(ctx)}/`, "-json", "-silent", "-follow-redirects", "-status-code", "-title", "-tech-detect", "-timeout", "8"],
    command: (ctx) => `httpx -u ${shQuote(`${baseUrl(ctx)}/`)} -json -silent -status-code -title -tech-detect`,
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
    args: (ctx) => ["-u", `${baseUrl(ctx)}/`, "-jsonl", "-silent", "-depth", "2", "-concurrency", "4", "-rate-limit", String(Math.max(1, Math.round(ctx.rps))), "-timeout", "8"],
    command: (ctx) => `katana -u ${shQuote(`${baseUrl(ctx)}/`)} -jsonl -silent -depth 2 -rate-limit ${Math.max(1, Math.round(ctx.rps))}`,
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
};

export const KIND_LIST = Object.values(KINDS).map((k) => ({
  id: k.id,
  titleAr: k.titleAr,
  active: k.active,
  binary: k.binary ?? null,
  present: k.binary ? Boolean(findBinary(k.binary)) : true,
}));

/* ── dispatcher ──────────────────────────────────────────────────────────── */

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

  const runLocal = async (): Promise<KindResult> => {
    const res = await runArgv(bin, argv, { cwd: ctx.jobDir, timeoutMs: ctx.timeoutMs, env: { ...process.env, TERM: "dumb" } });
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
    return {
      ok: res.code === 0 || res.stdout.length > 0,
      summary: `${bin} exit=${res.code} · ${res.stdout.length} بايت · ${Date.now() - started}ms`,
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
