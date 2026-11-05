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
  /**
   * Which machine this entry was learned from, when it was not typed here.
   * Peers exchange their lists, so the fleet converges on one picture without
   * anyone copying URLs by hand — and every learned entry says where it came
   * from, so the list never pretends to be first-hand knowledge.
   */
  learnedFrom?: string;
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
  /**
   * The origin that actually answered, when it differs from the registered
   * `base` (http vs https). Waifly publishes its address as
   * `node.waifly.com:27316` with no scheme, and a plain allocation port speaks
   * HTTP while the proxy in front of it speaks HTTPS — guessing wrong makes a
   * live server look dead.
   */
  via?: string;
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

/**
 * The machines that exist right now, so the list is never empty on a fresh
 * install. Measured 2026-11-05: the Codespace is public, and the Waifly slot
 * (server 53a7d0cb) answers on its allocation — but a human had to type both
 * URLs into a box before the fleet page could see them. These are seeds, not
 * claims: each one is probed like any other and stays `down` until it answers.
 *
 * Turn them off with NOVA_FLEET_SEED=0 (a test or a fresh deployment that must
 * start empty).
 */
export const SEED_SERVERS: ReadonlyArray<Pick<NovaServer, "name" | "base" | "kind" | "note">> = [
  {
    name: "Codespace الرئيسي",
    base: "https://animated-broccoli-gwx6wgpxvx5hv6gj-8080.app.github.dev",
    kind: "codespace",
    note: "البورت 8080 لازم يكون Public من تبويب Ports جوه الكودسبيس",
  },
  {
    // The HTTPS face of the same slot, via Waifly's Web/WebSocket proxy
    // (auto TLS). This is the one a browser on an https page can actually
    // reach — and the only one GitHub Pages is allowed to call.
    name: "Waifly · HTTPS",
    base: "https://nova.waifly.com",
    kind: "waifly",
    note: "نفس السلوت عبر بروكسي Waifly — ده العنوان اللي صفحة GitHub Pages تقدر تكلّمه",
  },
  {
    name: "Waifly · Paris FR01",
    base: "http://node.waifly.com:27316",
    kind: "waifly",
    note: "سلوت 300 MB دائم · Start Command: sh /home/container/run",
  },
];

/**
 * Bumped whenever SEED_SERVERS gains a machine.
 *
 * A registry that already exists is never re-seeded (that would resurrect hosts
 * the user deleted), but new seeds must reach machines that booted before they
 * existed — measured 2026-11-05: the live Waifly slot kept a two-machine file
 * and never learned about the HTTPS face added later that same hour.
 */
export const SEED_VERSION = 2;

function seedServers(): NovaServer[] {
  const now = Date.now();
  return SEED_SERVERS.map((s) => ({
    id: makeId(normalizeServerBase(s.base)),
    name: s.name,
    base: normalizeServerBase(s.base),
    kind: s.kind,
    addedAt: now,
    note: s.note,
  }));
}

export function loadServers(): NovaServer[] {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as { servers?: NovaServer[]; seedVersion?: number };
    if (!Array.isArray(parsed?.servers)) return [];
    const stored = parsed.servers
      .filter((s) => s && typeof s.base === "string")
      .map((s) => ({ ...s, base: normalizeServerBase(s.base) }))
      .filter((s) => s.base);
    // Add seeds this file has never seen, and only those: a machine the user
    // removed stays removed until the seed list itself changes again.
    if ((parsed.seedVersion ?? 0) < SEED_VERSION) {
      const known = new Set(stored.map((s) => s.base));
      const missing = seedServers().filter((s) => !known.has(s.base));
      const merged = [...stored, ...missing];
      try {
        saveServers(merged);
      } catch {
        /* read-only disk — answer in memory for this process */
      }
      return merged;
    }
    return stored;
  } catch (err) {
    // A file that is not there yet is the first boot: start from the machines we
    // know about. A corrupt file is an accident, and inventing a list on top of
    // it would hide the corruption, so that still means "empty".
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT" && process.env.NOVA_FLEET_SEED !== "0") {
      const seeded = seedServers();
      // Write them down on the first read. Otherwise every call re-creates the
      // seeds with a fresh `addedAt`, and the fleet page would claim every
      // machine was "just added" on every refresh — a small lie, but the kind
      // that makes a measured list look like it is guessing.
      try {
        saveServers(seeded);
      } catch {
        /* read-only disk: the list still answers for this process */
      }
      return seeded;
    }
    return [];
  }
}

export function saveServers(servers: NovaServer[]): boolean {
  try {
    const target = filePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ servers, seedVersion: SEED_VERSION, savedAt: Date.now() }, null, 2));
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

/** `https://h` ↔ `http://h` — the registered base first, the other scheme second. */
export function schemeCandidates(base: string): string[] {
  const primary = normalizeServerBase(base);
  if (!primary) return [];
  const alternate = primary.startsWith("https://")
    ? `http://${primary.slice("https://".length)}`
    : primary.startsWith("http://")
      ? `https://${primary.slice("http://".length)}`
      : "";
  return alternate && alternate !== primary ? [primary, alternate] : [primary];
}

/** One real HTTP call. A timeout is `down`, never `unknown`. */
export async function probeServer(server: NovaServer, opts: ProbeOptions = {}): Promise<ServerProbe> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const now = opts.now ?? Date.now;
  const started = now();

  const candidates = schemeCandidates(server.base);
  let lastErr: unknown = null;
  let firstFailure: ServerProbe | null = null;

  for (const origin of candidates) {
    try {
      const res = await doFetch(`${origin}/api/health`, {
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
      // A 200 that is not JSON is not a health answer. Measured 2026-11-05: an
      // anonymous GET to a *public* Codespace port lands on GitHub's "you are
      // about to access a development port" interstitial — status 200, HTML
      // body. Calling that "up" would put a machine in the fleet that nothing
      // can actually talk to.
      const json = health !== null;
      const result: ServerProbe = {
        id: server.id,
        state: res.ok && json ? "up" : "down",
        ok: res.ok && json,
        status: res.status,
        ms,
        checkedAt: now(),
        health,
        error: res.ok && !json ? "ردّ 200 بس مش JSON — دي صفحة تحذير (الكودسبيس محتاج تسجيل دخول أو البورت مش Public)" : res.ok ? undefined : `HTTP ${res.status}`,
        ...(origin === candidates[0] ? {} : { via: origin }),
      };
      // A live answer on either scheme settles it; a non-2xx does not, because
      // the other scheme may be the one the service is actually on.
      if (result.ok) {
        cache.set(server.id, result);
        return result;
      }
      firstFailure ??= result;
    } catch (err) {
      lastErr = err;
    }
  }

  const result: ServerProbe =
    firstFailure ?? {
      id: server.id,
      state: "down",
      ok: false,
      status: null,
      ms: now() - started,
      checkedAt: now(),
      health: null,
      error: explainProbeError(lastErr),
    };
  cache.set(server.id, result);
  return result;
}

/* ── peer exchange ──────────────────────────────────────────────────────── */

export interface GossipPeer {
  base: string;
  ok: boolean;
  /** entries this peer knew and we did not */
  gained: number;
  ms: number | null;
  error?: string;
}

export interface GossipResult {
  at: number;
  peers: GossipPeer[];
  gained: number;
  servers: NovaServer[];
}

/**
 * Merge a peer's list into ours. Pure on purpose: the merge rule is the part
 * worth testing, and it is the rule that decides whether two machines end up
 * with the same fleet.
 *
 * Rules:
 *   • our entry always wins for a base we already know (our name, our note, our
 *     addedAt) — a peer must never rename a machine here,
 *   • a base we have never seen is added and marked `learnedFrom` the peer,
 *   • nothing is removed, ever: a machine disappearing from a peer's list is the
 *     peer forgetting it, not us.
 */
export function mergePeerServers(
  mine: NovaServer[],
  theirs: unknown,
  peerBase: string,
  now = Date.now(),
): { servers: NovaServer[]; gained: NovaServer[] } {
  const byBase = new Map(mine.map((s) => [normalizeServerBase(s.base), s]));
  const gained: NovaServer[] = [];
  const list = Array.isArray(theirs) ? theirs : [];
  for (const raw of list) {
    const entry = raw as Partial<NovaServer> | null;
    if (!entry || typeof entry.base !== "string") continue;
    const base = normalizeServerBase(entry.base);
    if (!base || byBase.has(base)) continue;
    if (base === normalizeServerBase(peerBase)) continue;
    const known = KINDS.includes(entry.kind as ServerKind) ? (entry.kind as ServerKind) : serverKind(base);
    const added: NovaServer = {
      id: makeId(base),
      name: String(entry.name || base.replace(/^https?:\/\//, "")).slice(0, 60),
      base,
      kind: known,
      addedAt: now,
      note: typeof entry.note === "string" ? entry.note : undefined,
      learnedFrom: normalizeServerBase(peerBase),
    };
    byBase.set(base, added);
    gained.push(added);
  }
  return { servers: [...mine, ...gained], gained };
}

/** How long a gossip round stays fresh; a page refresh must not cost N fetches. */
const GOSSIP_TTL_MS = 60_000;
let lastGossipAt = 0;
let lastGossip: GossipResult | null = null;

/**
 * Ask every *reachable* machine for its list and merge what is new.
 *
 * This is what makes the fleet one fleet: each engine knows a few seeds, and
 * after one round every engine knows the same machines. No credentials, no
 * shared database — it uses the connection the probe already proves exists.
 */
export async function gossipServers(
  list: NovaServer[],
  opts: ProbeOptions & { ttlMs?: number; force?: boolean } = {},
): Promise<GossipResult> {
  const now = opts.now ?? Date.now;
  if (!opts.force && lastGossip && now() - lastGossipAt < (opts.ttlMs ?? GOSSIP_TTL_MS)) {
    return lastGossip;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3500;
  const started = now();
  const probes = await probeAll(list, opts);
  const up = list.filter((s) => probes.find((p) => p.id === s.id && p.ok));

  const peers: GossipPeer[] = [];
  let servers = list;

  for (const peer of up) {
    const origins = schemeCandidates(peer.base);
    let done = false;
    for (const origin of origins) {
      const t0 = now();
      try {
        const res = await doFetch(`${origin}/api/fleet/servers?peers=0`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { servers?: unknown };
        const merged = mergePeerServers(servers, body?.servers, origin, now());
        servers = merged.servers;
        peers.push({ base: origin, ok: true, gained: merged.gained.length, ms: now() - t0 });
        done = true;
        break;
      } catch (err) {
        peers.push({ base: origin, ok: false, gained: 0, ms: null, error: explainProbeError(err) });
      }
    }
    if (!done) continue;
  }

  lastGossipAt = now();
  lastGossip = { at: started, peers, gained: servers.length - list.length, servers };
  return lastGossip;
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
