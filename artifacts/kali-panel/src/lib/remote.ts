/**
 * Remote server connector.
 *
 * The GitHub Pages build has no backend, so it falls back to the built-in
 * engine. That is fine for browsing, but a chat needs a brain and a fleet needs
 * a server. This module lets the *browser* point the whole app at any NOVA
 * server the user runs (Oracle Always Free, Fly.io, a VPS, an ngrok tunnel…)
 * without rebuilding anything:
 *
 *   • the base URL lives in localStorage,
 *   • every `/api/*` call is rewritten to it (see `setup.ts`),
 *   • WebSockets open `wss://` against it (see `useWebSocket` / `NovaFleetLive`),
 *   • `/api/nova-core/status` tells us whether its brain is really alive.
 *
 * No secrets are stored here — only a URL.
 */

const STORAGE_KEY = "cybernova_remote_base";

export interface RemoteConfig {
  base: string;
  savedAt: number;
}

/** Normalise user input: accept `host`, `https://host`, trailing slashes, `/api`. */
export function normalizeBase(input: string): string {
  let raw = input.trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    let pathname = url.pathname.replace(/\/+$/, "");
    // People paste `https://host/api` — strip it, we add paths ourselves.
    pathname = pathname.replace(/\/api$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return "";
  }
}

export function getRemoteBase(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as RemoteConfig;
    return parsed?.base ? normalizeBase(parsed.base) : "";
  } catch {
    return "";
  }
}

export function setRemoteBase(input: string): string {
  const base = normalizeBase(input);
  if (typeof localStorage === "undefined") return base;
  try {
    if (!base) {
      localStorage.removeItem(STORAGE_KEY);
      return "";
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ base, savedAt: Date.now() }));
  } catch {
    /* private mode: connection still works for this page load via memory */
  }
  memoryBase = base;
  return base;
}

export function clearRemoteBase(): void {
  memoryBase = "";
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Fallback so a blocked localStorage does not silently break the connector. */
let memoryBase = "";

/** Same-origin absolute URL for an API path, honouring the remote base. */
export function remoteUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  const base = memoryBase || getRemoteBase();
  if (!base) return path;
  return `${base}${path}`;
}

/** `https://h` → `wss://h`, `http://h` → `ws://h`, with the same host/port. */
export function remoteWsUrl(path: string): string {
  const target = remoteUrl(path);
  if (!/^https?:\/\//i.test(target)) {
    // Same-origin: derive the scheme from the page.
    const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss:" : "ws:";
    const host = typeof location !== "undefined" ? location.host : "";
    return `${proto}//${host}${target}`;
  }
  try {
    const url = new URL(target);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return target;
  }
}

/** True when the app is pointed at an external NOVA server. */
export function isRemoteConfigured(): boolean {
  return Boolean(memoryBase || getRemoteBase());
}

export interface ProbeResult {
  ok: boolean;
  base: string;
  checkedAt: number;
  latencyMs: number;
  server?: {
    name?: string;
    version?: string;
    brainMode?: string;
    ollamaOnline?: boolean;
    tools?: number;
  };
  agents?: number;
  error?: string;
}

/**
 * Ask a server whether it is really a NOVA server and what it can do.
 * One round-trip trio: status → tools → fleet.
 */
export async function probeRemote(input?: string): Promise<ProbeResult> {
  const base = normalizeBase(input ?? (memoryBase || getRemoteBase()));
  const started = Date.now();
  const result: ProbeResult = { ok: false, base, checkedAt: started, latencyMs: 0 };
  if (!base) {
    result.error = "مفيش رابط سيرفر";
    return result;
  }
  try {
    const statusRes = await fetch(`${base}/api/nova-core/status`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
    if (!statusRes.ok) throw new Error(`status ${statusRes.status}`);
    const status = (await statusRes.json()) as {
      ok?: boolean;
      identity?: { name?: string; version?: string };
      brain?: { mode?: string; ollamaOnline?: boolean };
    };
    result.server = {
      name: status.identity?.name ?? "NOVA",
      version: status.identity?.version,
      brainMode: status.brain?.mode,
      ollamaOnline: status.brain?.ollamaOnline,
    };
    result.ok = status.ok !== false;
  } catch (err) {
    result.error = `تعذر الوصول للسيرفر: ${(err as Error).message}`;
    result.latencyMs = Date.now() - started;
    return result;
  }

  // These are best-effort: a server that answers status but not these still works.
  try {
    const [toolsRes, fleetRes] = await Promise.all([
      fetch(`${base}/api/nova-core/tools`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) }),
      fetch(`${base}/api/local-agent/agents`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) }),
    ]);
    if (toolsRes.ok) {
      const tools = (await toolsRes.json()) as { tools?: unknown[] } | unknown[];
      const count = Array.isArray(tools) ? tools.length : (tools.tools?.length ?? 0);
      if (result.server) result.server.tools = count;
    }
    if (fleetRes.ok) {
      const fleet = (await fleetRes.json()) as { agents?: unknown[]; count?: number };
      result.agents = fleet.count ?? fleet.agents?.length ?? 0;
    }
  } catch {
    /* keep the successful status result */
  }

  result.latencyMs = Date.now() - started;
  return result;
}
