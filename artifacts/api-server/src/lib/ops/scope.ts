/**
 * Ops · Scope & Authorization Gate
 * ────────────────────────────────
 * The single place that decides whether an ACTIVE probe against a host is
 * allowed at all. Everything that can touch a third-party system (runner tasks,
 * port scan, fleet exec, fuzzing) must pass `assertAuthorized()` first.
 *
 * Why a code gate instead of a prompt rule: a language model can be steered by
 * the content it reads (a page that says "run this command"), and a program's
 * scope rules are the one thing that must never be negotiable at runtime.
 *
 * Sources of truth (merged, later wins):
 *   1. `state/programs.json`      — the programs you approve, with their scope
 *   2. `/.well-known/security.txt` — fetched once per host and cached, used to
 *                                   suggest a scope when you add a program
 */
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";

export interface ProgramScope {
  /** wildcard host patterns, e.g. "*.example.com" */
  hosts: string[];
  /** literal hosts, e.g. "api.example.com" */
  exact?: string[];
  /** CIDR ranges, e.g. "203.0.113.0/24" */
  cidrs?: string[];
  /** never probed, even if it matches a wildcard above */
  out_of_scope?: string[];
  /** max requests per second to this program (per host buckets) */
  max_rps?: number;
  /** concurrency cap for this program */
  max_concurrency?: number;
  /** true = passive/recon only, no active probing at all */
  passive_only?: boolean;
  /** program policy / safe-harbour URL */
  policy_url?: string;
  notes_ar?: string;
}

export interface Program extends ProgramScope {
  id: string;
  name: string;
  platform?: "hackerone" | "bugcrowd" | "intigriti" | "yeswehack" | "immunefi" | "custom" | string;
  enabled: boolean;
  addedAt: string;
}

export interface ProgramsFile {
  version: number;
  updatedAt?: string;
  programs: Program[];
}

export interface ScopeDecision {
  ok: boolean;
  host: string;
  program?: Program;
  reason: string;
  reasonCode:
    | "allowed"
    | "no_programs"
    | "out_of_scope"
    | "program_disabled"
    | "passive_only"
    | "internal_host"
    | "unresolvable"
    | "no_host";
  limits: { rps: number; concurrency: number; active: boolean };
}

/* ── storage ─────────────────────────────────────────────────────────────── */

function programsFile(): string {
  return (
    process.env.NOVA_PROGRAMS_FILE ||
    path.resolve(process.cwd(), process.env.NOVA_PROGRAMS_REL || "state/programs.json")
  );
}

const EMPTY: ProgramsFile = { version: 1, programs: [] };

export function loadPrograms(): ProgramsFile {
  try {
    const raw = fs.readFileSync(programsFile(), "utf8");
    const parsed = JSON.parse(raw) as ProgramsFile;
    if (!Array.isArray(parsed.programs)) return { ...EMPTY };
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, file);
}

export function savePrograms(file: ProgramsFile): ProgramsFile {
  const next: ProgramsFile = { ...file, version: 1, updatedAt: new Date().toISOString() };
  atomicWrite(programsFile(), JSON.stringify(next, null, 2));
  return next;
}

/** Add or replace a program by id. */
export function upsertProgram(input: Partial<Program> & { id: string; name: string; hosts: string[] }): Program {
  const file = loadPrograms();
  const program: Program = {
    id: input.id.trim().toLowerCase(),
    name: input.name.trim(),
    platform: input.platform ?? "custom",
    enabled: input.enabled !== false,
    addedAt:
      file.programs.find((p) => p.id === input.id)?.addedAt ?? new Date().toISOString(),
    hosts: input.hosts.map((h) => normalizeHost(h)).filter(Boolean),
    exact: (input.exact ?? []).map((h) => normalizeHost(h)).filter(Boolean),
    cidrs: (input.cidrs ?? []).map((c) => c.trim()).filter(Boolean),
    out_of_scope: (input.out_of_scope ?? []).map((h) => normalizeHost(h)).filter(Boolean),
    max_rps: clampNum(input.max_rps, 0.2, 20, 1),
    max_concurrency: clampNum(input.max_concurrency, 1, 8, 2),
    passive_only: Boolean(input.passive_only),
    policy_url: input.policy_url,
    notes_ar: input.notes_ar,
  };
  const programs = file.programs.filter((p) => p.id !== program.id);
  programs.unshift(program);
  savePrograms({ ...file, programs });
  return program;
}

export function removeProgram(id: string): boolean {
  const file = loadPrograms();
  const programs = file.programs.filter((p) => p.id !== id);
  if (programs.length === file.programs.length) return false;
  savePrograms({ ...file, programs });
  return true;
}

/* ── matching ────────────────────────────────────────────────────────────── */

export function normalizeHost(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@\w+\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

/** "*.example.com" matches api.example.com and a.b.example.com, not example.com */
function matchWildcard(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p.includes("*")) return false;
  if (p === "*") return true;
  if (!p.startsWith("*.")) return p.replace(/^\*\./, "") === host;
  const suffix = p.slice(2);
  return host.endsWith(`.${suffix}`) && host !== suffix;
}

function ipToLong(ip: string): number | null {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw ?? 0);
  const a = ipToLong(ip);
  const b = ipToLong(range);
  if (a === null || b === null || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

const INTERNAL_RE =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[0-1])\.|::1|fc00:|fe80:|localhost$|\[::1\]$)/i;

export function isInternalHostOrIp(value: string): boolean {
  if (INTERNAL_RE.test(value)) return true;
  // a public name that resolves to a private address is still internal
  return false;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function hostMatchesProgram(host: string, p: Program): boolean {
  if (p.out_of_scope?.some((pat) => matchWildcard(pat, host) || pat === host)) return false;
  if (p.exact?.includes(host)) return true;
  if (p.hosts.some((pat) => matchWildcard(pat, host) || pat === host)) return true;
  // A literal IP can never match a domain pattern — for those the CIDR list is the
  // scope. Without this, `cidrs` was only ever a *negative* filter and an
  // authorized range would be refused as out-of-scope.
  if (isIpLiteral(host) && p.cidrs?.length) return p.cidrs.some((c) => inCidr(host, c));
  return false;
}

/* ── the gate ────────────────────────────────────────────────────────────── */

let cache: { at: number; stamp: string; file: ProgramsFile } = { at: 0, stamp: "__none__", file: EMPTY };

/**
 * mtime-aware cache: the gate is consulted on every probe, so re-reading a small
 * JSON on each call would be wasteful — but a fixed TTL would also mean a program
 * you just added (or deleted!) silently does not take effect for seconds. Scope
 * changes are exactly the moment where staleness is dangerous, so the file's
 * mtime (nanoseconds, as a string stamp) decides.
 */
function programsFresh(): ProgramsFile {
  const now = Date.now();
  // The stamp is `mtimeNs:size` as a STRING, not a number: nanosecond mtimes are
  // ~1.8e18 and a float64 cannot carry a byte-count delta on top of that, so a
  // numeric sum silently drops the precision — and a program you just added (or
  // revoked) would not take effect. String compare keeps every digit.
  let stamp = "missing";
  try {
    const st = fs.statSync(programsFile(), { bigint: true });
    stamp = `${st.mtimeNs}:${st.size}`;
  } catch {
    try {
      const st = fs.statSync(programsFile());
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      stamp = "missing";
    }
  }
  if (stamp !== cache.stamp || now - cache.at > 5_000) {
    cache = { at: now, stamp, file: loadPrograms() };
  }
  return cache.file;
}

/**
 * Decide whether `target` may be actively probed.
 * `active:false` (passive sources: CT logs, Wayback, DNS, NVD) only needs the
 * host to be public — it never touches the target's services.
 */
export async function assertAuthorized(
  target: unknown,
  opts: { programId?: string; active?: boolean } = {},
): Promise<ScopeDecision> {
  const host = normalizeHost(
    typeof target === "string" && target.startsWith("http") ? target : String(target ?? ""),
  );
  const limits = { rps: 1, concurrency: 2, active: opts.active !== false };
  const deny = (reasonCode: ScopeDecision["reasonCode"], reason: string): ScopeDecision => ({
    ok: false,
    host,
    reason,
    reasonCode,
    limits,
  });

  if (!host) return deny("no_host", "مفيش نطاق في الطلب.");
  if (isInternalHostOrIp(host)) {
    return deny("internal_host", `${host} عنوان/نطاق داخلي — مرفوض دائماً (حماية SSRF).`);
  }

  const file = programsFresh();
  const enabled = file.programs.filter((p) => p.enabled);
  if (enabled.length === 0) {
    return deny(
      "no_programs",
      "مفيش برنامج مصرّح به محفوظ (state/programs.json فاضي). ضيف برنامج من /programs أو POST /api/ops/programs — من غيره أي فحص نشط مرفوض.",
    );
  }

  const candidates = enabled.filter((p) => hostMatchesProgram(host, p));
  const program = opts.programId
    ? candidates.find((p) => p.id === opts.programId) ?? enabled.find((p) => p.id === opts.programId)
    : candidates[0];

  if (!program || !hostMatchesProgram(host, program)) {
    return deny(
      "out_of_scope",
      `${host} مش داخل نطاق أي برنامج مفعّل. البرامج المتاحة: ${enabled
        .map((p) => `${p.id}[${p.hosts.join(",")}]`)
        .join(" · ")}`,
    );
  }
  if (!program.enabled) return deny("program_disabled", `برنامج ${program.name} مقفول.`);
  if (opts.active !== false && program.passive_only) {
    return deny(
      "passive_only",
      `برنامج ${program.name} محدد passive_only — استطلاع ومصادر عامة بس، من غير لمس الخدمة.`,
    );
  }

  // Resolve and re-check: a public name pointing at an internal IP must never be fetched.
  if (!isIpLiteral(host)) {
    const addrs = await dns.resolve4(host).catch(() => [] as string[]);
    if (addrs.length === 0) return deny("unresolvable", `${host} مش بيتحل (DNS فشل) — متقدرش تتأكد من ملكيته.`);
    const bad = addrs.find((ip) => isInternalHostOrIp(ip));
    if (bad) return deny("internal_host", `${host} بيُحل إلى عنوان داخلي (${bad}) — محجوب.`);
    if (program.cidrs?.length && !addrs.some((ip) => program.cidrs!.some((c) => inCidr(ip, c)))) {
      return deny("out_of_scope", `${host} برّه الـCIDR المحدد لـ${program.name}.`);
    }
  }

  return {
    ok: true,
    host,
    program,
    reason: `مصرّح به: ${program.name}${program.platform ? ` (${program.platform})` : ""}`,
    reasonCode: "allowed",
    limits: {
      rps: clampNum(program.max_rps, 0.2, 20, 1),
      concurrency: clampNum(program.max_concurrency, 1, 8, 2),
      active: opts.active !== false,
    },
  };
}

/* ── security.txt (RFC 9116) — used when onboarding a program ────────────── */

export interface SecurityTxt {
  found: boolean;
  url?: string;
  contact: string[];
  acknowledgment?: string[];
  preferredLanguages?: string[];
  expires?: string;
  hiring?: string[];
  raw?: string;
}

export async function fetchSecurityTxt(host: string, timeoutMs = 8_000): Promise<SecurityTxt> {
  const url = `https://${normalizeHost(host)}/.well-known/security.txt`;
  const empty: SecurityTxt = { found: false, contact: [] };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "CyberNova-NOVA/2099 (security self-check)" },
    });
    if (!res.ok) return empty;
    const text = (await res.text()).slice(0, 20_000);
    const line = (key: string) =>
      text
        .split(/\r?\n/)
        .filter((l) => l.toLowerCase().startsWith(`${key.toLowerCase()}:`))
        .map((l) => l.slice(l.indexOf(":") + 1).trim())
        .filter(Boolean);
    return {
      found: true,
      url,
      contact: line("Contact"),
      acknowledgment: line("Acknowledgement"),
      preferredLanguages: line("Preferred-Languages"),
      expires: line("Expires")[0],
      hiring: line("Hiring"),
      raw: text.slice(0, 4_000),
    };
  } catch {
    return empty;
  }
}

/**
 * IPv4/IPv6 literal test. Declared before use because `hostMatchesProgram`
 * depends on it (and the export at the bottom used to be the only copy).
 */
export function isIpLiteral(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return true;
  return value.includes(":");
}

/** Small helper so the router can report net capability truthfully. */
export const net = {
  isLiteral: isIpLiteral,
};
