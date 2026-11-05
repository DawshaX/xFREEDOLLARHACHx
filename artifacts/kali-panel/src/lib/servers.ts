/**
 * The machines NOVA runs on, in the browser — the same list the engine keeps.
 *
 * A NOVA server is just an origin that answers `/api/health`. By 2026-11-05 we
 * had three real ones (a Codespace, a Render web service, a Waifly slot) and no
 * single place that knew all three, so "which URL is the program on today?" was
 * a question the human had to answer from memory.
 *
 * Rules kept here:
 *   • a saved server is not an online server — the status comes from a real probe
 *     (`<base>/api/health`), and a failed probe says why,
 *   • the *active* server stays in `cybernova_remote_base` so the rest of the app
 *     keeps working untouched,
 *   • the list mirrors to the linked engine (`POST /api/fleet/servers/sync`) when
 *     one is reachable, so `/nova-fleet` shows the same machines server-side.
 */
import { getRemoteBase, normalizeBase, probeRemote, setRemoteBase, clearRemoteBase } from "./remote";

const STORAGE_KEY = "cybernova_servers_v1";

export type ServerKind = "codespace" | "render" | "waifly" | "local" | "custom";

export interface KnownServer {
  id: string;
  name: string;
  base: string;
  kind: ServerKind;
  addedAt: number;
  note?: string;
}

export interface ServerStatus {
  id: string;
  state: "up" | "down" | "unknown";
  ms: number | null;
  checkedAt: number | null;
  says: string;
}

/** `host`, `https://host/`, `https://host/api` → `https://host`. */
export function normalizeServerBase(input: string): string {
  return normalizeBase(input);
}

/** `animated-broccoli-gwx6wgpxvx5hv6gj` → its public port-8080 origin. */
export function codespaceBase(name: string): string {
  const clean = String(name ?? "").trim().toLowerCase().replace(/^https?:\/\//, "");
  if (!clean) return "";
  const host = clean.includes("app.github.dev") ? clean : `${clean}-8080.app.github.dev`;
  const noPort = host.replace(/-8080\.app\.github\.dev.*$/, "");
  return normalizeBase(`https://${noPort}-8080.app.github.dev`);
}

export function serverKind(base: string): ServerKind {
  const b = normalizeServerBase(base);
  if (!b) return "custom";
  let host = "";
  try {
    host = new URL(b).host;
  } catch {
    return "custom";
  }
  if (/\.app\.github\.dev$/i.test(host)) return "codespace";
  if (/\.onrender\.com$/i.test(host)) return "render";
  if (/(waifly|nova-hub)/i.test(host)) return "waifly";
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return "local";
  return "custom";
}

export function serverId(base: string): string {
  const b = normalizeServerBase(base);
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) | 0;
  return `srv-${Math.abs(h).toString(36)}`;
}

/**
 * Machines we know exist for this project, seeded once so the page is useful on
 * first open. Only real, already-created hosts belong here — a seeded URL that
 * was never deployed would just be a red dot with a mystery behind it.
 * `animated-broccoli-gwx6wgpxvx5hv6gj` is the live Codespace (2026-11-05).
 */
const SEED: Array<Pick<KnownServer, "name" | "kind" | "note"> & { base: string }> = [
  {
    name: "Codespace الرئيسي",
    base: codespaceBase("animated-broccoli-gwx6wgpxvx5hv6gj"),
    kind: "codespace",
    note: "Ports → 8080 → Public، وبعدها شغّل scripts/nova-codespace.sh",
  },
  {
    // The HTTPS face of the same slot (Waifly Web/WebSocket proxy, auto TLS).
    // Listed first because an https page may only call this one.
    name: "Waifly · HTTPS",
    base: "https://nova.waifly.com",
    kind: "waifly",
    note: "نفس السلوت عبر بروكسي Waifly — العنوان اللي صفحة https تقدر تكلّمه",
  },
  {
    // Server 53a7d0cb · Paris FR01 · 300 MB slot. Waifly prints this address
    // without a scheme; a bare allocation port speaks HTTP and the proxy in
    // front speaks HTTPS, so the probe tries both and reports which answered.
    name: "Waifly · Paris FR01",
    base: "http://node.waifly.com:27316",
    kind: "waifly",
    note: "Start Command: sh nova-24-7/start.sh — والملفات في /home/container",
  },
];

function seed(): KnownServer[] {
  const now = Date.now();
  return SEED.map((s) => ({
    id: serverId(s.base),
    name: s.name,
    base: s.base,
    kind: s.kind,
    addedAt: now,
    note: s.note,
  }));
}

export function listServers(): KnownServer[] {
  if (typeof localStorage === "undefined") return seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // First open: start from the known machines, then let the user edit.
      const initial = seed();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ servers: initial, savedAt: Date.now() }));
      } catch {
        /* private mode */
      }
      return initial;
    }
    const parsed = JSON.parse(raw) as { servers?: KnownServer[] };
    if (!Array.isArray(parsed?.servers)) return [];
    return parsed.servers
      .filter((s) => s && typeof s.base === "string")
      .map((s) => ({ ...s, base: normalizeServerBase(s.base), id: s.id || serverId(s.base) }))
      .filter((s) => Boolean(s.base));
  } catch {
    return [];
  }
}

function persist(servers: KnownServer[]): KnownServer[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ servers, savedAt: Date.now() }));
  } catch {
    /* private mode: the list still works for this page load */
  }
  void mirrorToEngine(servers);
  return servers;
}

export function addServer(input: { name?: string; base: string; kind?: ServerKind; note?: string }): KnownServer[] {
  const base = normalizeServerBase(input.base);
  if (!base) return listServers();
  const current = listServers();
  const existing = current.find((s) => s.base === base);
  const entry: KnownServer = {
    id: existing?.id ?? serverId(base),
    name: (input.name || existing?.name || base.replace(/^https?:\/\//, "")).slice(0, 60),
    base,
    kind: input.kind ?? serverKind(base),
    addedAt: existing?.addedAt ?? Date.now(),
    note: input.note ?? existing?.note,
  };
  return persist([entry, ...current.filter((s) => s.base !== base)]);
}

export function removeServer(id: string): KnownServer[] {
  const next = listServers().filter((s) => s.id !== id);
  if (getRemoteBase() && serverId(getRemoteBase()) === id) clearRemoteBase();
  return persist(next);
}

export function activeServerId(): string | null {
  const base = getRemoteBase();
  return base ? serverId(base) : null;
}

/** Make this machine the one the whole app talks to. */
export function activateServer(server: KnownServer): string {
  return setRemoteBase(server.base);
}

/** Real probe of one machine. A failure is reported as a failure, with its reason. */
/** The registered origin first, then the same host on the other scheme. */
export function schemeCandidates(base: string): string[] {
  const primary = normalizeServerBase(base);
  if (!primary) return [];
  const alternate = primary.startsWith("https://")
    ? `http://${primary.slice("https://".length)}`
    : `https://${primary.slice("http://".length)}`;
  return alternate && alternate !== primary ? [primary, alternate] : [primary];
}

export async function probeKnownServer(server: KnownServer): Promise<ServerStatus> {
  const started = Date.now();
  // Mixed content: a page served over https may not fetch http at all — the
  // browser refuses before a packet leaves. Measured 2026-11-05: this GitHub
  // Pages site (https) could never reach the Waifly slot (http://…:27316), and
  // reporting that as "السيرفر نايم" would be a lie about a server that is up
  // and serving the whole program. Say what actually happened.
  const httpsPage = typeof window !== "undefined" && window.location.protocol === "https:";
  const candidates = schemeCandidates(server.base).filter((o) => !(httpsPage && o.startsWith("http://")));
  if (candidates.length === 0) {
    return {
      id: server.id,
      state: "down",
      ms: 0,
      checkedAt: Date.now(),
      says: `المتصفح بيمنع الاتصال اللي مش مشفّر (الصفحة https والسيرفر ${server.base}). البرنامج شغّال — افتح ${server.base} في تاب لوحده.`,
    };
  }
  // Browser rule worth knowing: a page served over https cannot fetch http at
  // all (mixed content), so on GitHub Pages the https attempt is the only one
  // that can succeed — and it is the second candidate for a Waifly slot.
  let firstFailure: ServerStatus | null = null;
  for (const origin of candidates) {
    const status = await probeOrigin(server, origin, started);
    // A live answer on either scheme settles it; a failed one does not, because
    // the other scheme may be the one the service is actually on.
    if (status.state === "up") {
      return origin === server.base ? status : { ...status, says: `${status.says} · عبر ${origin}` };
    }
    firstFailure ??= status;
  }
  return firstFailure ?? probeOrigin(server, server.base, started);
}

async function probeOrigin(server: KnownServer, origin: string, started: number): Promise<ServerStatus> {
  try {
    const res = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(6000) });
    const ms = Date.now() - started;
    if (!res.ok) {
      return {
        id: server.id,
        state: "down",
        ms,
        checkedAt: Date.now(),
        says:
          res.status === 404
            ? "ردّ 404 — البورت شغّال بس الخدمة مش على /api/health (أو لازم تعمل Public للبورت)"
            : `ردّ HTTP ${res.status}`,
      };
    }
    const body = (await res.json().catch(() => null)) as { status?: string; wsConnected?: boolean; name?: string } | null;
    if (!body || typeof body !== "object") {
      // 200 + HTML is GitHub's "development port" interstitial, not a health
      // answer — the Codespace is reachable only for a signed-in visitor.
      return {
        id: server.id,
        state: "down",
        ms,
        checkedAt: Date.now(),
        says: "ردّ 200 بس مش JSON — صفحة تحذير GitHub (البورت عام للعرض بس مش للبرامج)",
      };
    }
    return {
      id: server.id,
      state: "up",
      ms,
      checkedAt: Date.now(),
      says: `${body.status ?? "ok"}${body.name ? ` · ${body.name}` : ""}${body.wsConnected ? " · ws" : ""} · ${ms}ms`,
    };
  } catch (err) {
    const ms = Date.now() - started;
    const msg = (err as Error).message;
    return {
      id: server.id,
      state: "down",
      ms,
      checkedAt: Date.now(),
      says: /Failed to fetch|NetworkError|AbortError/i.test(msg)
        ? "مفيش اتصال من المتصفح — يا إما السيرفر نايم أو البورت مش Public"
        : msg.slice(0, 90),
    };
  }
}

export async function probeKnownServers(servers = listServers()): Promise<Record<string, ServerStatus>> {
  const out: Record<string, ServerStatus> = {};
  await Promise.all(
    servers.map(async (s) => {
      out[s.id] = await probeKnownServer(s);
    }),
  );
  return out;
}

/**
 * Mirror the list into the linked engine so the server-side fleet shows the same
 * machines. Best effort by design: the browser list is the source of truth for
 * the human, and a failed sync must never block the UI.
 */
export async function mirrorToEngine(servers = listServers()): Promise<boolean> {
  const base = getRemoteBase();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/fleet/servers/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        servers: servers.map(({ name, base: b, kind, note }) => ({ name, base: b, kind, note })),
      }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The full check a server must pass before the panel calls it a NOVA server. */
export async function verifyServer(base: string) {
  return probeRemote(base);
}

export const SERVER_PRESETS: Array<{ kind: ServerKind; label: string; hint: string; placeholder: string }> = [
  {
    kind: "codespace",
    label: "GitHub Codespace",
    hint: "اكتب اسم الكودسبيس بس، والبورت 8080 لازم يكون Public من تبويب Ports",
    placeholder: "animated-broccoli-gwx6wgpxvx5hv6gj",
  },
  {
    kind: "render",
    label: "Render (free web service)",
    hint: "الرابط اللي Render بيديه لك بعد النشر",
    placeholder: "https://cybernova-nova.onrender.com",
  },
  {
    kind: "waifly",
    label: "Waifly (300MB slot)",
    hint: "رابط السيرفر من لوحة Waifly بعد ما تشغّل start.sh",
    placeholder: "https://fr1-xxxx.waifly.net",
  },
  {
    kind: "custom",
    label: "سيرفر تاني (VPS / ngrok)",
    hint: "أي origin بيرد على /api/health",
    placeholder: "https://nova.example.com",
  },
];
