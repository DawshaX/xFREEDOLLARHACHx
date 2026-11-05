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

import { servedByEngine } from "./env";

const STORAGE_KEY = "cybernova_remote_base";

/**
 * The machines this program actually runs on, in the order worth trying.
 *
 * The static build (GitHub Pages) has no backend of its own, so without this
 * list the app can only be useful after a human pastes a URL and a token —
 * which is exactly the "باك إند سليم في كل مكان" the user asked to stop
 * needing. Each entry is a real origin that answers `/api/health`; discovery
 * never trusts the list, it fetches the health endpoint before linking.
 *
 * `https://nova.waifly.com` is the Waifly slot behind their Web/WebSocket
 * HTTPS proxy (auto TLS). That is the one a https page can actually reach —
 * a browser refuses http from https before a packet leaves.
 */
export const KNOWN_SERVERS: ReadonlyArray<{ label: string; base: string }> = [
  { label: "Waifly · Paris (HTTPS proxy)", base: "https://nova.waifly.com" },
  { label: "Waifly · Paris (raw port)", base: "http://node.waifly.com:27316" },
  { label: "Codespace", base: "https://animated-broccoli-gwx6wgpxvx5hv6gj-8080.app.github.dev" },
];

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

/**
 * True when there is a NOVA server behind this page — either one the user
 * linked, or the one that is serving the page right now.
 */
export function isRemoteConfigured(): boolean {
  return Boolean(memoryBase || getRemoteBase() || servedByEngine());
}

/** The origin actually in use: the linked one, else this page's own origin. */
export function effectiveBase(): string {
  const linked = memoryBase || getRemoteBase();
  if (linked) return linked;
  if (servedByEngine() && typeof location !== "undefined") return location.origin;
  return "";
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

/**
 * Link this page to a real engine, automatically.
 *
 * Runs on a static host (GitHub Pages) when nothing is linked yet. It walks
 * `KNOWN_SERVERS`, but a candidate only wins if `/api/health` answers with JSON
 * that says the engine is alive — the same rule the fleet card uses. Nothing is
 * assumed because it is in the list.
 *
 * The choice is cached for a day so opening the site does not re-probe on every
 * navigation, and a failed discovery is cached for ten minutes so a dead host
 * does not slow every page load.
 */
const AUTOLINK_KEY = "cybernova_autolink_v1";
const AUTOLINK_OK_MS = 24 * 60 * 60 * 1000;
const AUTOLINK_FAIL_MS = 10 * 60 * 1000;

interface AutoLinkCache {
  base: string;
  at: number;
  ok: boolean;
}

function readAutoLink(): AutoLinkCache | null {
  try {
    const raw = localStorage.getItem(AUTOLINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AutoLinkCache;
    if (!parsed?.at || typeof parsed.base !== "string") return null;
    const ttl = parsed.ok ? AUTOLINK_OK_MS : AUTOLINK_FAIL_MS;
    return Date.now() - parsed.at < ttl ? parsed : null;
  } catch {
    return null;
  }
}

function writeAutoLink(entry: AutoLinkCache): void {
  try {
    localStorage.setItem(AUTOLINK_KEY, JSON.stringify(entry));
  } catch {
    /* private mode */
  }
}

/** Candidates usable from this page (an https page may not fetch http). */
export function reachableCandidates(): Array<{ label: string; base: string }> {
  const httpsPage = typeof location !== "undefined" && location.protocol === "https:";
  return KNOWN_SERVERS.filter((c) => !(httpsPage && c.base.startsWith("http://")));
}

async function healthAnswers(base: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { status?: string; ok?: boolean } | null;
    // A 200 that is not JSON is GitHub's Codespace interstitial or a proxy
    // error page, not an engine — see the same rule in the fleet card.
    return Boolean(body && (body.status === "ok" || body.ok === true));
  } catch {
    return false;
  }
}

let autoLinkPromise: Promise<string> | null = null;

/**
 * Find and link a live engine. Returns the base it linked, or "" if none of the
 * candidates answered. Safe to call from anywhere; concurrent calls share one
 * attempt.
 */
export function autoLinkServer(): Promise<string> {
  if (autoLinkPromise) return autoLinkPromise;
  autoLinkPromise = (async () => {
    if (typeof window === "undefined") return "";
    if (memoryBase || getRemoteBase()) return memoryBase || getRemoteBase();

    const cached = readAutoLink();
    if (cached?.ok && cached.base) {
      setRemoteBase(cached.base);
      return cached.base;
    }

    for (const candidate of reachableCandidates()) {
      if (await healthAnswers(candidate.base)) {
        setRemoteBase(candidate.base);
        writeAutoLink({ base: candidate.base, at: Date.now(), ok: true });
        try {
          window.dispatchEvent(new CustomEvent("nova:autolink", { detail: { base: candidate.base } }));
        } catch {
          /* no CustomEvent (tests) */
        }
        return candidate.base;
      }
    }

    writeAutoLink({ base: "", at: Date.now(), ok: false });
    return "";
  })().finally(() => {
    autoLinkPromise = null;
  });
  return autoLinkPromise;
}

/** Forget the cached auto-link and try again (used by the «جرّب تاني» button). */
export function resetAutoLink(): void {
  try {
    localStorage.removeItem(AUTOLINK_KEY);
  } catch {
    /* ignore */
  }
}
