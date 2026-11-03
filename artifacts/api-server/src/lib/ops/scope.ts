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
import { lookupBountyProgram, catalogStatus } from "./bounty-catalog";

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
      "مفيش برنامج مصرّح به محفوظ (state/programs.json فاضي). الحل في أمر واحد: tool «program_discover» أو POST /api/ops/programs/discover {target} — يسجّل النطاق تلقائياً في وضع الاستطلاع، ومن غير تسجيل مفيش فحص نشط.",
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
      `برنامج ${program.name} محدد passive_only — استطلاع ومصادر عامة بس، من غير لمس الخدمة. للتفعيل لازم تأكيد إذن مكتوب: program_discover مع activate = "I have written permission for ${host}".`,
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

/* ── auto-discovery: the non-technical path onto a program ───────────────── */

/**
 * Nobody should have to hand-edit `state/programs.json`. `discoverProgram` turns
 * a bare domain (or a HackerOne/Bugcrowd program URL) into a ready-to-save scope
 * by reading the site's own `security.txt`, and registers it in the *safest* mode
 * first: `passive_only`, i.e. recon from public sources that never touches the
 * target's services. Active scanning stays one deliberate `activate` away,
 * because that is the step where written permission actually matters.
 */
export interface ScopeProposal {
  ok: boolean;
  host: string;
  program: Program | null;
  evidence: {
    security_txt: boolean;
    security_txt_url?: string;
    contacts: string[];
    policy_url?: string;
    platform?: string;
    domains_from_policy?: string[];
    expires?: string;
    /** برنامج bug bounty معلَن بيغطي الهوست ده (من الكتالوج العام) — سياق، مش إذن */
    bounty_program?: {
      handle: string; name: string; platform: string; url: string;
      bounties: boolean; paused?: boolean; safe_harbor?: string | null;
      max_payout_usd?: number | null; response_efficiency?: number | null;
      matched_on: string; matched_kind: string; submission_state?: string | null;
    } | null;
    /** حالة الكتالوج نفسه — عشان «مفيش برنامج» متتسجلّش على إنها نتيجة بحث بينما البيانات مقفولة */
    catalog?: { present: boolean; programs: number; fetchedAt: string | null };
  };
  registered: boolean;
  /** what a human must say/do before active probing is allowed */
  needs_ar: string;
  warnings: string[];
  error?: string;
}

/** Infrastructure names that must never be in scope, even under a wildcard. */
const NEVER_IN_SCOPE = [
  "admin",
  "adm",
  "panel",
  "dashboard",
  "internal",
  "intranet",
  "vpn",
  "ssh",
  "sso",
  "id",
  "auth",
  "ldap",
  "dev",
  "staging",
  "stage",
  "test",
  "qa",
  "debug",
  "metadata",
];

const PLATFORMS: Array<[RegExp, string]> = [
  [/hackerone\.com/i, "hackerone"],
  [/bugcrowd\.com/i, "bugcrowd"],
  [/intigriti\.com/i, "intigriti"],
  [/yeswehack\.com/i, "yeswehack"],
  [/immunefi\.com/i, "immunefi"],
];

function platformOf(url: string): string | undefined {
  for (const [rx, id] of PLATFORMS) if (rx.test(url)) return id;
  return undefined;
}

/** Bare domains mentioned on a policy page — the only way to scope a platform URL. */
function domainsFromPolicy(text: string): string[] {
  const found = new Set<string>();
  const rx = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ai|app|dev|co|me|gg|xyz|cloud|zone|live|shop|bank|finance|gov|edu))\b/gi;
  for (const m of text.matchAll(rx)) {
    const host = String(m[1]).toLowerCase().replace(/\.$/, "");
    if (host.length > 3 && !/\.(png|jpg|gif|svg|css|js|ico|json|html|txt|md|pdf)$/.test(host)) found.add(host);
  }
  return [...found].slice(0, 40);
}

export async function discoverProgram(
  rawTarget: unknown,
  opts: { register?: boolean; activate?: string; name?: string } = {},
): Promise<ScopeProposal> {
  const input = String(rawTarget ?? "").trim();
  const isUrl = /^https?:\/\//i.test(input);
  const host = normalizeHost(isUrl ? input : `https://${input}`);
  const warn: string[] = [];

  const fail = (error: string): ScopeProposal => ({
    ok: false,
    host,
    program: null,
    evidence: { security_txt: false, contacts: [] },
    registered: false,
    needs_ar: "اكتب نطاق الهدف نفسه (مثال: example.com) أو رابط صفحة البرنامج.",
    warnings: warn,
    error,
  });

  if (!host) return fail("no_host");
  if (isInternalHostOrIp(host)) return fail(`عنوان داخلي/محلي (${host}) — مرفوض دائماً.`);

  const txt = await fetchSecurityTxt(host);
  const contacts = txt.contact.slice(0, 6);
  const policyUrl = contacts.find((c) => /^https?:\/\//i.test(c));
  const platform = policyUrl ? platformOf(policyUrl) : undefined;

  // A platform program page: the domains live in the policy text, not in the URL.
  const policyDomains: string[] = [];
  if (isUrl && platform) {
    try {
      const res = await fetch(input, {
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
        headers: { "user-agent": "CyberNova-NOVA/2099 (scope discovery)" },
      });
      if (res.ok) policyDomains.push(...domainsFromPolicy((await res.text()).slice(0, 400_000)));
      else warn.push(`صفحة البرنامج رجّعت HTTP ${res.status} — قدرت بس على security.txt تبع ${host}.`);
    } catch (err) {
      warn.push(`مقدرش أوصل صفحة البرنامج (${(err as Error).message}) — الصق النطاقات يدوياً لو النتييجة ناقصة.`);
    }
  }

  const rootDomain = host.split(".").slice(-2).join(".");
  // الكتالوج العام (ops/bounty/programs-catalog.json) = سياق بس.
  // ولا سطر هنا بيلمس `passive_only`: الإذن لسه جملة المستخدم بالحرف، مش اسم برنامج.
  const bounty = lookupBountyProgram(host) ?? lookupBountyProgram(rootDomain);
  const cat = catalogStatus();
  const bountyEvidence = bounty
    ? {
        handle: bounty.handle,
        name: bounty.name,
        platform: bounty.platform,
        url: bounty.url,
        bounties: bounty.bounties,
        paused: bounty.paused === true,
        safe_harbor: bounty.safe_harbor ?? null,
        max_payout_usd: bounty.max_payout_usd ?? null,
        response_efficiency: bounty.response_efficiency ?? null,
        matched_on: bounty.matched_on,
        matched_kind: bounty.matched_kind,
        submission_state: bounty.submission_state ?? null,
      }
    : null;
  if (bounty) {
    if (!policyUrl) warn.push(`مفيش security.txt على ${host} — السياسة اتجابت من كتالوج البرامج (${bounty.platform}:${bounty.handle}).`);
    if (bounty.matched_kind === "wildcard_apex") warn.push(`المطابقة جت من wildcard على ${bounty.matched_on} — النطاق الأب نفسه غالبًا برّه الـscope، فاتعامل مع ${host} بحرص أكتر لحد ما تقرأ صفحة البرنامج.`);
    if (bounty.paused || (bounty.submission_state && bounty.submission_state !== "open")) warn.push(`حالة الاستقبال على ${bounty.platform}: ${bounty.submission_state || "؟"}${bounty.paused ? " · paused" : ""} — استطلاع ومصادر عامة لحد ما البرنامج يفتح تاني.`);
    if (bounty.paused) warn.push(`«${bounty.name}» مقفول الاستقبال حاليًا على ${bounty.platform} — استطلاع ومصادر عامة لحد ما يفتح تاني.`);
  } else if (cat.present) {
    warn.push(`الكتالوج (${cat.programs} برنامج، آخر تحديث ${cat.fetchedAt ? cat.fetchedAt.slice(0, 10) : "؟"}) مافيهوش نطاق يغطي ${host}: معناه مافيش برنامج معلَن معروف، مش إن البحث فشل.`);
  } else {
    warn.push(`كتالوج البرامج مش متولّد — شغّل node scripts/sync-bounty-programs.mjs عشان السياق ده يبان في الاكتشاف.`);
  }
  const hosts = new Set<string>([host, `*.${host}`]);
  for (const d of policyDomains) {
    if (d === rootDomain || d.endsWith(`.${rootDomain}`)) hosts.add(d);
    else if (d !== host) warn.push(`${d} مذكور في السياسة لكنه خارج نطاقك — اتساب بره النطاق تلقائياً.`);
  }
  const out = new Set<string>();
  for (const prefix of NEVER_IN_SCOPE) out.add(`${prefix}.${host}`);

  const id =
    String(opts.name ?? host)
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-|-$/g, "") || host;

  const wantActivate = String(opts.activate ?? "").trim();
  const consentOk = wantActivate.toLowerCase() === `i have written permission for ${host.toLowerCase()}`;
  if (wantActivate && !consentOk) {
    warn.push(
      `طلب تفعيل الفحص النشط مرفوض: لازم النص بالحرف «I have written permission for ${host}» يتقال بعد تأكيد المستخدم إن عنده إذن مكتوب.`,
    );
  }

  const proposed: Partial<Program> & { id: string; name: string; hosts: string[] } = {
    id,
    name: opts.name || (bounty ? bounty.name : platform ? `${platform}:${host}` : host),
    platform: platform ?? bounty?.platform,
    hosts: [...hosts],
    out_of_scope: [...out],
    max_rps: 1,
    max_concurrency: 2,
    // active probing is only ever on with the verbatim consent sentence
    passive_only: !consentOk,
    policy_url: policyUrl ?? bounty?.url,
    notes_ar: txt.found
      ? `مكتشف أوتوماتيك من security.txt (${txt.url}). الوضع استطلاع بس لحد ما المستخدم يوافق على الفحص النشط.`
      : bounty
        ? `النطاق جوّه برنامج معلَن (${bounty.platform}:${bounty.handle}) — سياسة من الكتالوج، استطلاع بس لحد الإذن المكتوب${bounty.response_efficiency != null ? ` · جودة استجابة ${bounty.response_efficiency}%` : ""}${bounty.max_payout_usd ? ` · حد أقصى ${bounty.max_payout_usd}$` : ""}.`
        : `مكتشف أوتوماتيك للنطاق ${host} بدون security.txt — استطلاع بس.`,
  };

  const registered = opts.register !== false;
  const program = registered ? upsertProgram(proposed) : null;
  if (registered) {
    warn.push(
      consentOk
        ? "سُجّل ومفعّل للفحص النشط بعد تأكيد الإذن."
        : "سُجّل في وضع الاستطلاع فقط — قول «فعّل الفحص النشط» بعد ما تتأكد إن عندك إذن مكتوب.",
    );
  }

  return {
    ok: true,
    host,
    program,
    evidence: {
      security_txt: txt.found,
      security_txt_url: txt.url,
      contacts,
      policy_url: policyUrl ?? bounty?.url,
      platform: platform ?? bounty?.platform,
      domains_from_policy: policyDomains.slice(0, 12),
      expires: txt.expires,
      bounty_program: bountyEvidence,
      catalog: { present: cat.present, programs: cat.programs, fetchedAt: cat.fetchedAt },
    },
    registered,
    needs_ar: txt.found
      ? "لقيانة سياسة إفصاح على النطاق — مفيش مطلوب منك غير «ابدأ» للفحص السلبي."
      : bounty
        ? `مفيش security.txt، لكن النطاق جوّه «${bounty.name}» على ${bounty.platform} (${bounty.url}). الفحص النشط محتاج الإذن المكتوب: «I have written permission for ${host}».`
        : `مفيش security.txt على ${host} ومعروفش في كتالوج البرامج — مافيش برنامج عام واضح. الفحص النشط مرفوض غير بإذن مكتوب.`,
    warnings: warn,
  };
}
