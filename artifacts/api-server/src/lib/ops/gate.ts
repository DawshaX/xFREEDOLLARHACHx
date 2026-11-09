/**
 * Ops · The single authorization gate for anything that can touch the platform host
 * ──────────────────────────────────────────────────────────────────────────────
 * Before this file, the gate lived inside `routes/exec.ts` and every other
 * powerful surface (`/api/local-agent/*`, `/api/kill-switch`, `/api/nova-core/auto-update`,
 * `/api/nova-core/restart`, `/api/local-agent/ws`) simply did not have it — which is
 * how a "defensive platform" ends up as an unauthenticated RCE + source disclosure.
 *
 * Policy:
 *   • NOVA_EXEC_TOKEN set   → the token (header `x-nova-token` or `?token=`) is required, everywhere.
 *   • NOVA_EXEC_TOKEN unset → same-origin browser calls only (a speed bump, NOT auth),
 *                             and read-only endpoints stay open.
 *   • NOVA_OPEN_OPS=1       → explicit, loud opt-in to the old open behaviour (local labs).
 *
 * Every decision is logged so the panel can show WHY something was refused.
 */
import { logger } from "../logger";

export interface GateRequest {
  method?: string;
  headers?: Record<string, unknown> | ((name: string) => string | undefined);
  query?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}

const READONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function header(req: GateRequest, name: string): string {
  const h = req.headers;
  if (!h) return "";
  const direct = (h as Record<string, unknown>)[name];
  if (direct !== undefined) return String(direct);
  const lower = (h as Record<string, unknown>)[name.toLowerCase()];
  return lower === undefined ? "" : String(lower);
}

function queryValue(req: GateRequest, name: string): string {
  return String(req.query?.[name] ?? "");
}

export function tokenConfigured(): boolean {
  return Boolean((process.env.NOVA_EXEC_TOKEN || "").trim());
}

export function openOpsAllowed(): boolean {
  return process.env.NOVA_OPEN_OPS === "1";
}

function tokenOk(req: GateRequest): boolean {
  const expected = (process.env.NOVA_EXEC_TOKEN || "").trim();
  if (!expected) return false;
  return queryValue(req, "token") === expected || header(req, "x-nova-token") === expected;
}

/**
 * Same-origin check for browsers. Browsers set `Sec-Fetch-Site` themselves and page
 * scripts cannot forge it, so it is the strongest header-only signal available.
 * A determined attacker with a raw socket can still forge Origin/Referer — that is
 * why writes require a token whenever one is configured, and why the panel is told
 * out-loud when it is running in this weaker mode.
 */
export function sameOriginOk(req: GateRequest): boolean {
  const host = header(req, "host");
  if (!host) return false;
  if (header(req, "sec-fetch-site") === "same-origin") return true;
  const origins = [header(req, "origin"), header(req, "referer")].filter(Boolean);
  if (origins.length === 0) return false;
  return origins.some((o) => {
    try {
      return new URL(o).host === host;
    } catch {
      return false;
    }
  });
}

export interface GateVerdict {
  ok: boolean;
  code: "allowed" | "token_required" | "same_origin_required" | "open_mode";
  reason: string;
  how: string;
}

/** Decide a single request. `scope` is only used for the log line. */
export function checkGate(req: GateRequest, scope: string): GateVerdict {
  if (openOpsAllowed()) {
    return { ok: true, code: "open_mode", reason: "NOVA_OPEN_OPS=1", how: "" };
  }
  const readOnly = !req.method || READONLY_METHODS.has(req.method.toUpperCase());
  if (tokenConfigured()) {
    if (tokenOk(req)) return { ok: true, code: "allowed", reason: "token ok", how: "" };
    // reads of status pages never break; anything that acts requires the token.
    // A sensitive read is also satisfied by same-origin — the same signal the write
    // path trusts, since a foreign page cannot forge `Origin`/`Sec-Fetch-Site`.
    if (readOnly && (!scopeRequiresTokenForRead(scope) || sameOriginOk(req))) {
      return { ok: true, code: "allowed", reason: "read-only", how: "" };
    }
    const reason = `مطلوب توكن (${scope})`;
    logger.warn({ scope, method: req.method }, "ops gate blocked: token required");
    return {
      ok: false,
      code: "token_required",
      reason,
      how: "أرسل هيدر `x-nova-token` (أو ?token=) بقيمة NOVA_EXEC_TOKEN، أو اكتبه في حقل التوكن بغرفة العمليات («المخ · المدير»).",
    };
  }
  // No token configured: writes only from the panel itself.
  if (!readOnly) {
    if (sameOriginOk(req)) {
      return { ok: true, code: "allowed", reason: "same-origin", how: "" };
    }
    logger.warn({ scope, method: req.method }, "ops gate blocked: no token, not same-origin");
    return {
      ok: false,
      code: "same_origin_required",
      reason: "مفيش توكن محدد — الكتابة مقفولة على زوار من خارج اللوحة",
      how: "على أي استضافة عامة سيّر NOVA_EXEC_TOKEN وإلا كل مسارات التنفيذ هترجع 403.",
    };
  }
  // A sensitive read is not a public read. Even with no token configured, the
  // device inventory / tool catalogue / event bus stay behind the same-origin
  // wall, so a stranger's curl gets 403 instead of the fleet's internals.
  if (scopeRequiresTokenForRead(scope) && !sameOriginOk(req)) {
    logger.warn({ scope }, "ops gate blocked: sensitive read, no token, not same-origin");
    return {
      ok: false,
      code: "same_origin_required",
      reason: "قراءة حساسة مقفولة على زوار من خارج اللوحة",
      how: "افتح الصفحة من نفس أصل السيرفر، أو سيّر NOVA_EXEC_TOKEN وأرسله في هيدر `x-nova-token` (أو ?token=).",
    };
  }
  return { ok: true, code: "allowed", reason: "read-only", how: "" };
}

/**
 * A few reads are themselves sensitive (they return device inventories, source
 * archives or agent bootstrap scripts) — those keep needing a token/same-origin.
 */
const SENSITIVE_READS: RegExp[] = [
  /download-project-zip$/,
  /\/api\/local-agent\/(sysinfo|screenshot|processes|fs)\b/,
  /\/api\/ops\/programs$/,
  // The job files are the findings themselves — which hosts are being worked and
  // what was proven. Same-origin (the panel) may read them; a stranger may not.
  /\/api\/ops\/jobs\b/,
  /\/api\/ops\/stats$/,
  /\/api\/keys\b/,
  /\/api\/settings\b/,
  // The brain's own catalogue and identity: the full tool schema (an attacker's
  // map of exactly what can be run), the persona card, and the build/version
  // banner. These were readable by anyone who could reach the host.
  /\/api\/nova-core\/(tools|persona|version)\b/,
  // The device inventory: hostname, platform, arch, RAM and user of every
  // connected box. A stranger must not be able to enumerate the fleet.
  /\/api\/local-agent\/agents\b/,
  // The platform event bus: a live firehose of what the engine is doing right
  // now (tool runs, targets, results).
  /\/api\/(live-events|agent\/events)\b/,
];

// NOTE: `/local-agent/download-nova-agent` and `/download-agent` are deliberately
// NOT in the list — the agent bootstrap has to be curl-able from a headless box,
// and the script itself is already public in the repo. Source archives are a
// different matter: see NOVA_ALLOW_SOURCE_DOWNLOAD in routes/local-agent.ts.

function scopeRequiresTokenForRead(scope: string): boolean {
  return SENSITIVE_READS.some((rx) => rx.test(scope));
}

/** Express middleware factory — mounts on a whole router namespace. */
export function requireOps(scopeLabel: string) {
  return (req: GateRequest & { path?: string; url?: string }, res: unknown, next: () => void): void => {
    const path = String(req.path ?? req.url ?? "");
    const verdict = checkGate(req, `${scopeLabel} ${path}`);
    if (!verdict.ok) {
      const response = res as { status: (n: number) => { json: (b: unknown) => unknown } };
      response.status(403).json({
        ok: false,
        error: verdict.code,
        reason: verdict.reason,
        how: verdict.how,
        endpoint: path,
      });
      return;
    }
    next();
  };
}

/** The WS handshake gate: same rules, but the answer is a socket-level 401. */
export function wsUpgradeAllowed(url: string, req: GateRequest): { ok: boolean; reason: string } {
  if (openOpsAllowed()) return { ok: true, reason: "open_mode" };
  const query: Record<string, unknown> = {};
  try {
    for (const [k, v] of new URL(url, "http://x").searchParams) query[k] = v;
  } catch {
    /* ignore */
  }
  const probe = { method: "POST", headers: req.headers, query, socket: req.socket };
  if (tokenConfigured()) {
    return tokenOk(probe) ? { ok: true, reason: "token ok" } : { ok: false, reason: "token required for agent registration" };
  }
  // Without a token, a registration is refused outright: unlike an HTTP write, a
  // WebSocket has no same-origin signal a server can trust after the handshake.
  return {
    ok: false,
    reason: "agent registration needs NOVA_EXEC_TOKEN (or NOVA_OPEN_OPS=1 on a lab machine)",
  };
}

/** Human summary for /self-check and the panel banners. */
export function opsExposure(): { guarded: boolean; open: boolean; detail: string } {
  const guarded = tokenConfigured();
  const open = openOpsAllowed();
  return {
    guarded,
    open,
    detail: open
      ? "NOVA_OPEN_OPS=1 — الوضع المفتوح (معامل اختبار محلي فقط)"
      : guarded
        ? "كل مسارات التنفيذ/الكتابة خلف NOVA_EXEC_TOKEN"
        : "مقيدة بطلبات اللوحة (same-origin) — أي curl من برّه بياخد 403؛ سيّر NOVA_EXEC_TOKEN للنشر العام",
  };
}
