/**
 * NOVA · عميل طبقة التنفيذ (`/api/ops/*`)
 * ───────────────────────────────────────
 * The engine's write surface is gated: on any public host it demands
 * `x-nova-token` (= `NOVA_EXEC_TOKEN` on the server). Until now nothing in the
 * panel could send it, which meant the Ops engine was usable from `curl` only —
 * a “platform” whose control room is a terminal is not a platform.
 *
 * So the token is kept here: one place, `localStorage`, never in a URL, never
 * logged, and it is **only** attached to same-origin or the configured remote
 * base. A denial from the server is returned as data (`denial`) not swallowed,
 * because the page must be able to show «ليه ماقدرتش» بدل «حصل خطأ».
 */
import { resolveNovaServer } from "./nova-core";
import { getRemoteBase, normalizeBase } from "./remote";

const TOKEN_KEY = "cybernova_ops_token";

export function getOpsToken(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return String(localStorage.getItem(TOKEN_KEY) ?? "");
  } catch {
    return "";
  }
}

export function setOpsToken(value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const v = value.trim();
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the page will just work in same-origin mode */
  }
}

export function hasToken(): boolean {
  return getOpsToken().length > 0;
}

/**
 * The one place every raw `/api/*` call gets its auth header from.
 *
 * The engine gates its powerful surfaces (chat, fleet bus, tool catalogue,
 * device inventory, event bus) on `x-nova-token` whenever `NOVA_EXEC_TOKEN` is
 * set. Before this helper each component invented its own header — some sent
 * the token, most did not — so a correctly connected machine answered reads and
 * refused writes, which reads as "connected but broken". Now there is one
 * source of truth: the token in `localStorage`, attached everywhere.
 */
export function novaAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = getOpsToken();
  if (token) headers["x-nova-token"] = token;
  return headers;
}

/** The token as a query param, for transports that cannot set headers (EventSource). */
export function novaTokenQuery(): string {
  const token = getOpsToken();
  return token ? `?token=${encodeURIComponent(token)}` : "";
}

export interface OpsReply<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T | null;
  /** the engine's own reason when it refused — Arabic, actionable, never invented */
  denial?: string;
  how?: string;
  error?: string;
  /** no engine at all (GitHub Pages mode) */
  offline?: boolean;
  base?: string;
}

/** Where the ops surface lives right now — same-origin `/api`, or the remote base. */
export async function opsBase(): Promise<string | null> {
  const base = await resolveNovaServer().catch(() => null);
  if (base) return base;
  const remote = normalizeBase(getRemoteBase());
  return remote ? `${remote}/api` : null;
}

export async function opsFetch<T = Record<string, unknown>>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
): Promise<OpsReply<T>> {
  const base = await opsBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      data: null,
      offline: true,
      error: "no_execution_plane",
      denial: "مفيش محرك متصل — اللوحة دي على Pages ومافيهاش سيرفر.",
      how: "من «محطة نوفا» اربط رابط السيرفر (Oracle/Waifly/Tailscale)، أو شغّل المحرك محليّاً على 127.0.0.1:8080.",
    };
  }
  const token = getOpsToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-nova-token"] = token;

  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.method === "GET" ? 12_000 : 60_000),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    // An HTML body from an /api path means the SPA fallback answered, i.e. there
    // is no such route on that server. Saying «HTTP 200» here would lie.
    if (!parsed && /<html|<!DOCTYPE/i.test(text)) {
      return {
        ok: false,
        status: res.status,
        data: null,
        base,
        error: "no_such_route",
        denial: "المسار مش موجود على السيرفر ده (الباوندل المنشور أقدم من طبقة ops).",
        how: "اعمل redeploy من الريبو — الـworkflow `standalone-bundle` بينشر الـbundle الجاهز.",
      };
    }
    const denial =
      !res.ok && parsed
        ? String((parsed as { reason?: unknown }).reason ?? (parsed as { error?: unknown }).error ?? `HTTP ${res.status}`)
        : undefined;
    const how = !res.ok && parsed ? String((parsed as { how?: unknown }).how ?? "") || undefined : undefined;
    return {
      ok: res.ok && (parsed ? (parsed as { ok?: boolean }).ok !== false : true),
      status: res.status,
      data: parsed as T | null,
      denial,
      how,
      base,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      base,
      error: (err as Error).message,
      denial: `الوصول للمحرك فشل: ${(err as Error).message}`,
      how: "تأكد إن السيرفر شغال وإن العنوان في «محطة نوفا» صح.",
    };
  }
}

/** The report is markdown text, not JSON — a separate, honest helper. */
export async function opsText(path: string): Promise<{ ok: boolean; text: string; status: number; error?: string }> {
  const base = await opsBase();
  if (!base) return { ok: false, text: "", status: 0, error: "no_execution_plane" };
  const headers: Record<string, string> = {};
  const token = getOpsToken();
  if (token) headers["x-nova-token"] = token;
  try {
    const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    return { ok: res.ok, text: res.ok ? text : `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
  } catch (err) {
    return { ok: false, text: "", status: 0, error: (err as Error).message };
  }
}
