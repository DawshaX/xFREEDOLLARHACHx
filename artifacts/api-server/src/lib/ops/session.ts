/**
 * Ops · Per-program authenticated scanning
 * ────────────────────────────────────────
 * Every scanner on earth can see the login page. The bugs that pay — IDOR,
 * broken access control, tenant leakage — live *behind* a session, so a scanner
 * without credentials is a scanner that reports missing headers forever.
 *
 * This file is the one place that turns a program's stored session into
 * something a tool can use, and the one place that makes sure those credentials
 * never leave the box:
 *
 *   • `sessionArgs()`   → `-H 'Cookie: …'` argv for nuclei/httpx/katana
 *   • `sessionHeaders()`→ a plain header map for in-process fetches
 *   • `redactSecrets()` → every byte we store as evidence passes through this
 *
 * Storage trade-off, said out loud: the cookie sits in `state/programs.json`
 * (mode 0600, same box, same trust boundary as `NOVA_EXEC_TOKEN`). The API never
 * returns it back — `maskSession()` replaces every value with a fingerprint, so a
 * stranger reading `/api/ops/programs` learns *that* a session exists, not what
 * it is.
 */
import crypto from "node:crypto";

export interface ProgramSession {
  /** extra request headers, e.g. { "Authorization": "Bearer …" } */
  headers?: Record<string, string>;
  /** raw Cookie header value, e.g. "session=abc; csrf=def" */
  cookie?: string;
  /** who this session belongs to — only for your own accounts */
  label?: string;
  addedAt?: string;
  note_ar?: string;
}

const REDACTED = "«redacted»";

/** Header names whose values are always sensitive, whatever they're called. */
const SECRET_HEADER =
  /^(cookie|authorization|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token|set-cookie)$/i;

export function hasSession(s: ProgramSession | undefined | null): boolean {
  if (!s) return false;
  return Boolean(s.cookie?.trim()) || Object.keys(s.headers ?? {}).length > 0;
}

/** Trim/validate an incoming session object. Undefined means "no session". */
export function normalizeSession(raw: unknown): ProgramSession | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const headers: Record<string, string> = {};
  if (r.headers && typeof r.headers === "object") {
    for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
      const name = String(k).trim();
      const value = String(v ?? "").trim();
      // A newline in a header value is header injection — refuse, don't sanitize.
      if (!name || /[\r\n]/.test(name) || /[\r\n]/.test(value)) continue;
      if (!/^[A-Za-z0-9-]+$/.test(name) || !value) continue;
      headers[name] = value;
    }
  }
  const cookie = String(r.cookie ?? "").trim();
  if (/[\r\n]/.test(cookie)) return undefined;
  const s: ProgramSession = {
    headers: Object.keys(headers).length ? headers : undefined,
    cookie: cookie || undefined,
    label: r.label ? String(r.label).slice(0, 80) : undefined,
    addedAt: r.addedAt ? String(r.addedAt) : new Date().toISOString(),
    note_ar: r.note_ar ? String(r.note_ar).slice(0, 300) : undefined,
  };
  return hasSession(s) ? s : undefined;
}

/** All pairs to send, cookie folded into a real `Cookie` header. */
export function sessionHeaderPairs(
  s: ProgramSession | undefined | null,
): Array<[string, string]> {
  if (!s) return [];
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(s.headers ?? {})) pairs.push([k, v]);
  if (s.cookie?.trim()) pairs.push(["Cookie", s.cookie.trim()]);
  return pairs;
}

/** Header map for `fetch` / node:http. */
export function sessionHeaders(
  s: ProgramSession | undefined | null,
): Record<string, string> {
  return Object.fromEntries(sessionHeaderPairs(s));
}

/**
 * argv for ProjectDiscovery tools. Both nuclei and httpx take `-H 'Name: value'`
 * as one argv element, so a value with spaces or quotes stays one argument —
 * no shell is involved anywhere (`spawn(..., { shell: false })`).
 */
export function sessionArgs(s: ProgramSession | undefined | null): string[] {
  const out: string[] = [];
  for (const [k, v] of sessionHeaderPairs(s)) out.push("-H", `${k}: ${v}`);
  return out;
}

/** True when this argv carries credentials, so the printed command must be masked. */
export function commandNeedsMask(
  s: ProgramSession | undefined | null,
): boolean {
  return hasSession(s);
}

/** Replace every secret value (and the raw cookie) with a marker. */
export function redactSecrets(
  text: string,
  s: ProgramSession | undefined | null,
): string {
  if (!text || !s) return text;
  let out = text;
  const values = sessionHeaderPairs(s)
    .map(([, v]) => v)
    .concat(
      (s.cookie ?? "")
        .split(";")
        .map((c) => c.trim().slice(c.indexOf("=") + 1))
        .filter(Boolean),
    )
    .filter((v) => v.length >= 4)
    // longest first: a short value nested inside a longer one must not half-redact it
    .sort((a, b) => b.length - a.length);
  for (const v of values) {
    out = out.split(v).join(REDACTED);
    const jsonEscaped = JSON.stringify(v).slice(1, -1);
    if (jsonEscaped !== v) out = out.split(jsonEscaped).join(REDACTED);
  }
  // belt and braces: `Authorization: Bearer …` / `Cookie: …` lines with anything left
  out = out.replace(
    /(authorization\s*[:=]\s*)(?!«redacted»)[^\s"',;]+(\s+[^\s"',;]+)?/gi,
    `$1${REDACTED}`,
  );
  out = out.replace(
    /(cookie\s*[:=]\s*)(?!«redacted»)[^\r\n"}]+/gi,
    `$1${REDACTED}`,
  );
  return out;
}

/** Short stable fingerprint of the credential set — lets the panel say "same session as before". */
export function sessionFingerprint(
  s: ProgramSession | undefined | null,
): string | null {
  if (!hasSession(s)) return null;
  const material = sessionHeaderPairs(s)
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
    .sort()
    .join("\n");
  return crypto
    .createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, 12);
}

/** What the API is allowed to return: presence + names + fingerprint, never values. */
export function maskSession(s: ProgramSession | undefined | null): {
  present: boolean;
  names: string[];
  label?: string;
  fingerprint?: string;
  addedAt?: string;
  note_ar?: string;
} {
  const pairs = sessionHeaderPairs(s);
  return {
    present: pairs.length > 0,
    names: pairs.map(([k]) => k),
    label: s?.label,
    fingerprint: sessionFingerprint(s) ?? undefined,
    addedAt: s?.addedAt,
    note_ar: s?.note_ar,
  };
}

/** Mask a program object before it leaves the process. */
export function maskProgram<T extends { session?: ProgramSession }>(
  p: T,
): Omit<T, "session"> & { session: ReturnType<typeof maskSession> } {
  const { session, ...rest } = p;
  return { ...rest, session: maskSession(session) };
}

export function isSecretHeader(name: string): boolean {
  return SECRET_HEADER.test(name);
}
