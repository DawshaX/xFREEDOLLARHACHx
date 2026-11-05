/**
 * Server registry — every machine that runs NOVA, kept in one list.
 *
 * Why this exists: by 2026-11-05 we had three real places to run the program
 * (a GitHub Codespace, a Render free web service, a Waifly 300 MB slot) and each
 * one lived as a URL the human had to remember. "الأسطول" showed only machines
 * that had a WebSocket agent attached, so the three hosts were invisible on the
 * page that is supposed to be the fleet.
 *
 * This module is the honest middle: a persisted list of NOVA servers with a
 * *measured* status for each one. Nothing here is a guess —
 *
 *   • `probe()` really fetches `<base>/api/health` and records status + latency,
 *   • a server that answers is `up`, one that fails is `down` and says why,
 *   • a server that was never probed is `unknown`, not `up`.
 *
 * The registry lives in a JSON file so it survives restarts, and every read
 * tolerates a missing or corrupt file (a broken registry must never stop the
 * engine from booting).
 */
import fs from "node:fs";
import path from "node:path";

export type ServerKind = "codespace" | "render" | "waifly" | "local" | "custom";

export interface NovaServer {
  id: string;
  name: string;
  /** origin only, no trailing slash, no `/api` */
  base: string;
  kind: ServerKind;
  addedAt: number;
  note?: string;
}

export interface ServerProbe {
  id: string;
  state: "up" | "down" | "unknown";
  ok: boolean;
  status: number | null;
  ms: number | null;
  checkedAt: number | null;
  /** what `/api/health` actually said, trimmed */
  health?: Record<string, unknown> | null;
  error?: string;
}

const KINDS: ServerKind[] = ["codespace", "render", "waifly", "local", "custom"];
const PROBE_TTL_MS = 20_000;

/** `host`, `https://host/x/`, `https://host/api` → `https://host` (or with path). */
export function normalizeServerBase(input: string): string {
  let raw = String(input ?? "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
    if (!/^https?:$/.test(url.protocol)) return "";
    return `${url.origin}${pathname}`;
  } catch {
    return "";
  }
}

/**
 * A Codespace forwards port 8080 at a predictable host:
 *   https://<codespace-name>-8080.app.github.dev
 * Getting this wrong is the difference between "the engine is down" and "the
 * engine is up but nobody told the panel where". Measured 2026-11-05 on
 * `animated-broccoli-gwx6wgpxvx5hv6gj`.
 */
export function codespaceBase(name: string): string {
  const clean = String(name ?? "").trim().toLowerCase().replace(/^https?:\/\//, "");
  if (!clean) return "";
  // Accept the full domain too, so pasting `x-8080.app.github.dev` works.
  const host = clean.includes("app.github.dev") ? clean : `${clean}-8080.app.github.dev`;
  const noPort = host.replace(/-8080\.app\.github\.dev.*$/, "");
  return normalizeServerBase(`https://${noPort}-8080.app.github.dev`);
}

/** A Render web service URL is already the origin; keep the path if any. */
export function renderBase(input: string): string {
  return normalizeServerBase(input);
}

export function serverKind(input: string): ServerKind {
  const base = normalizeServerBase(input);
  if (!base) return "custom";
  if (/\.app\.github\.dev$/i.test(new URL(base).host)) return "codespace";
  if (/\.onrender\.com$/i.test(new URL(base).host)) return "render";
  if (/(waifly|nova-hub)/i.test(new URL(base).host)) return "waifly";
  if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(base)) return "local";
  return "custom";
}

function makeId(base: string): string {
  // Stable per base: adding the same machine twice must not create a twin.
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) | 0;
  return `srv-${Math.abs(h).toString(36)}`;
}

export function upsertServer(list: NovaServer[], entry: Omit<NovaServer, "id" | "addedAt"> & { addedAt?: number }): NovaServer[] {
  const base = normalizeServerBase(entry.base);
  if (!base) return list;
  const kind = KINDS.includes(entry.kind) ? entry.kind : serverKind(base);
  const existing = list.find((s) => s.base === base);
  const next: NovaServer = {
    id: existing?.id ?? makeId(base),
    name: (entry.name || existing?.name || base.replace(/^https?:\/\//, "")).slice(0, 60),
    base,
    kind,
    addedAt: existing?.addedAt ?? entry.addedAt ?? Date.now(),
    note: entry.note ?? existing?.note,
  };
  return [next, ...list.filter((s) => s.base !== base)];
}

export function removeServer(list: NovaServer[], id: string): NovaServer[] {
  return list.filter((s) => s.id !== id);
}

/* ── persistence ────────────────────────────────────────────────────────── */

function filePath(): string {
  return process.env.NOVA_SERVERS_FILE || path.join(process.cwd(), "state", "fleet-servers.json");
}

export function loadServers(): NovaServer[] {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as { servers?: NovaServer[] };
    if (!Array.isArray(parsed?.servers)) return [];
    return parsed.servers
      .filter((s) => s && typeof s.base === "string")
      .map((s) => ({ ...s, base: normalizeServerBase(s.base) }))
      .filter((s) => s.base);
  } catch {
    // Missing on first boot, corrupt after a bad write — both mean "empty".
    return [];
  }
}

export function saveServers(servers: NovaServer[]): boolean {
  try {
    const target = filePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ servers, savedAt: Date.now() }, null, 2));
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

export function replaceServers(incoming: unknown): NovaServer[] {
  let list: NovaServer[] = [];
  if (Array.isArray(incoming)) {
    for (const item of incoming) {
      if (!item || typeof item !== "object") continue;
      const it = item as Partial<NovaServer>;
      list = upsertServer(list, {
        name: String(it.name ?? ""),
        base: String(it.base ?? ""),
        kind: (it.kind as ServerKind) ?? "custom",
        note: it.note,
      });
    }
  }
  saveServers(list);
  return list;
}

/* ── probing ────────────────────────────────────────────────────────────── */

const cache = new Map<string, ServerProbe>();

/**
 * "fetch failed" tells the human nothing. Each of these five cases has a
 * different fix, so the reason is translated rather than passed along raw —
 * still the real cause, just named.
 */
export function explainProbeError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err ?? "");
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return "النطاق مش موجود — السيرفر متمسح أو الرابط غلط";
  if (/ECONNREFUSED/i.test(msg)) return "البورت مقفول — الخدمة مش شغّالة على البورت ده";
  if (/ETIMEDOUT|timeout|aborted|AbortError/i.test(msg)) return "مردّش في الوقت — يا نايم يا معلّق";
  if (/certificate|SSL|TLS/i.test(msg)) return "مشكلة شهادة TLS";
  if (/fetch failed/i.test(msg)) return "مفيش وصول للشبكة من هنا (السيرفر نايم أو الرابط غلط)";
  return msg.slice(0, 120) || "فشل غير معروف";
}

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

/** One real HTTP call. A timeout is `down`, never `unknown`. */
export async function probeServer(server: NovaServer, opts: ProbeOptions = {}): Promise<ServerProbe> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const now = opts.now ?? Date.now;
  const started = now();
  try {
    const res = await doFetch(`${server.base}/api/health`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = now() - started;
    let health: Record<string, unknown> | null = null;
    try {
      health = (await res.json()) as Record<string, unknown>;
    } catch {
      health = null;
    }
    const result: ServerProbe = {
      id: server.id,
      state: res.ok ? "up" : "down",
      ok: res.ok,
      status: res.status,
      ms,
      checkedAt: now(),
      health,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
    cache.set(server.id, result);
    return result;
  } catch (err) {
    const result: ServerProbe = {
      id: server.id,
      state: "down",
      ok: false,
      status: null,
      ms: now() - started,
      checkedAt: now(),
      health: null,
      error: explainProbeError(err),
    };
    cache.set(server.id, result);
    return result;
  }
}

/** Cached view: probes at most once per 20 s per server. */
export async function probeAll(servers: NovaServer[], opts: ProbeOptions & { ttlMs?: number } = {}): Promise<ServerProbe[]> {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? PROBE_TTL_MS;
  return Promise.all(
    servers.map((s) => {
      const hit = cache.get(s.id);
      if (hit && hit.checkedAt && now() - hit.checkedAt < ttl) return hit;
      return probeServer(s, opts);
    }),
  );
}

export function cachedProbes(): ServerProbe[] {
  return [...cache.values()];
}

export function forgetProbe(id: string): void {
  cache.delete(id);
}
