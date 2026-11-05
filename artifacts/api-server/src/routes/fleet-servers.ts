/**
 * `/api/fleet/servers` — the machines NOVA runs on, as a measured list.
 *
 * The mesh (`/api/fleet/mesh`) only knew about machines that had a WebSocket
 * agent attached. Codespaces, Render and Waifly never attach one, so the three
 * hosts that actually run the program were missing from the fleet page. This
 * router registers them by URL and probes each one for real.
 *
 *   GET    /fleet/servers            → list + measured status of each
 *   POST   /fleet/servers  {name, base|url, kind?}       → add / update
 *   POST   /fleet/servers/codespace {name}               → add by Codespace name
 *   POST   /fleet/servers/sync {servers:[…]}             → replace from the browser
 *   DELETE /fleet/servers/:id                            → forget one
 *   GET    /fleet/servers/probe/:id                      → force a fresh probe
 */
import { Router, type Request, type Response } from "express";
import {
  codespaceBase,
  gossipServers,
  loadServers,
  probeAll,
  probeServer,
  removeServer,
  replaceServers,
  saveServers,
  serverKind,
  upsertServer,
  type GossipResult,
  type NovaServer,
} from "../lib/server-registry";
import { corpusStatus } from "../lib/ops/vuln-corpus";

const router = Router();

function describe(servers: NovaServer[]) {
  return {
    ok: true,
    count: servers.length,
    kinds: servers.reduce<Record<string, number>>((acc, s) => {
      acc[s.kind] = (acc[s.kind] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

router.get("/fleet/servers", async (req: Request, res: Response) => {
  let servers = loadServers();

  // Peer exchange: every reachable machine is asked for its list, and machines
  // we have never heard of are added. `?peers=0` is how a peer asks us without
  // starting a round of its own (that would be a fetch loop between machines).
  let peers: GossipResult | null = null;
  if (req.query.peers !== "0") {
    try {
      peers = await gossipServers(servers);
      if (peers.gained > 0) {
        servers = peers.servers;
        saveServers(servers);
      }
    } catch {
      /* a failed round must never hide the list we do have */
    }
  }

  const probes = await probeAll(servers);
  const byId = new Map(probes.map((p) => [p.id, p]));
  const up = probes.filter((p) => p.state === "up").length;
  res.json({
    ...describe(servers),
    up,
    down: servers.length - up,
    servers: servers.map((s) => ({ ...s, probe: byId.get(s.id) ?? null })),
    peers: peers
      ? {
          at: peers.at,
          gained: peers.gained,
          tried: peers.peers.length,
          reached: peers.peers.filter((p) => p.ok).length,
          list: peers.peers,
        }
      : undefined,
    note:
      servers.length === 0
        ? "مفيش سيرفرات مسجّلة — ضيف الـCodespace أو Render أو Waifly من نفس الصفحة، والقياس هنا حقيقي بيتصل بـ/api/health."
        : undefined,
  });
});

/**
 * One honest snapshot of the whole program: the machines it runs on, the agents
 * inside it, the corpus it reads, and the plan it is executing.
 *
 * Why this exists: the same facts were spread over six endpoints and three
 * pages, so "is everything actually connected?" could only be answered by a
 * human opening tabs. Here it is one request, and every field is measured —
 * `says_ar` is the sentence NOVA says about itself from those numbers, not a
 * template that ignores them.
 */
router.get("/fleet/doctor", async (req: Request, res: Response) => {
  try {
    const { runDoctor } = await import("../lib/doctor");
    // The origin is what makes `fix_ar` pasteable: a host-less command is a
    // command nobody runs. Behind a proxy the forwarded host is the real one.
    const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
    const report = await runDoctor({ origin: host ? `${proto}://${host}` : null });
    res.setHeader("Cache-Control", "no-store");
    res.json(report);
  } catch (err) {
    // A doctor that dies silently is worse than no doctor: say it broke, and why.
    res.status(500).json({ ok: false, error: (err as Error).message, ready: false, checks: [] });
  }
});

router.get("/fleet/system", async (_req: Request, res: Response) => {
  const servers = loadServers();
  const probes = await probeAll(servers);
  const up = probes.filter((p) => p.state === "up");
  const corpus = corpusStatus();

  let mesh: ReturnType<typeof import("./fleet-mesh").meshSnapshot> | null = null;
  try {
    const { meshSnapshot } = await import("./fleet-mesh");
    mesh = meshSnapshot();
  } catch {
    /* the mesh is optional here: machines and corpus still answer */
  }

  const brain = await (async () => {
    try {
      const { listConfiguredProviders } = await import("../lib/agent/llm");
      const providers = await listConfiguredProviders();
      return {
        providers: providers.map((p) => p.id),
        count: providers.length,
        note: providers.length
          ? `العقل متصل بـ ${providers.length} مزوّد (${providers.map((p) => p.id).join(" · ")})`
          : "مفيش مزوّد عقل متاح — البرنامج يشتغل بأدواته لكن مفيش مين يفكر",
      };
    } catch (err) {
      return { providers: [] as string[], count: 0, note: `تعذّر قراءة المزوّدين: ${(err as Error).message}` };
    }
  })();

  const machines = servers.map((s) => {
    const probe = probes.find((p) => p.id === s.id) ?? null;
    return {
      name: s.name,
      base: s.base,
      kind: s.kind,
      state: probe?.state ?? "unknown",
      status: probe?.status ?? null,
      ms: probe?.ms ?? null,
      error: probe?.error,
      learnedFrom: s.learnedFrom,
    };
  });

  const answers = [
    `${machines.filter((m) => m.state === "up").length}/${machines.length} ماكينة بترد`,
    corpus.measured ? `كوربوس ${corpus.total.toLocaleString("en-US")} ثغرة` : "الكوربوس مش مقاس",
    brain.count ? `${brain.count} مزوّد عقل` : "مفيش عقل",
    mesh ? `${mesh.stats.online} عقدة شغالة` : "المِش مش متاح",
  ];

  res.json({
    ok: true,
    now: Date.now(),
    identity: { name: "NOVA", version: "2099.1", origin: (process.env.NOVA_PUBLIC_URL || "").trim() || null },
    machines: {
      total: machines.length,
      up: machines.filter((m) => m.state === "up").length,
      down: machines.filter((m) => m.state !== "up").length,
      list: machines,
    },
    corpus: {
      measured: corpus.measured,
      total: corpus.total,
      at: corpus.at,
      ageMin: corpus.ageMin,
      bySeverity: corpus.bySeverity,
      note: corpus.says_ar,
    },
    brain,
    mesh: mesh
      ? { stats: mesh.stats, capacity: mesh.capacity, plan: mesh.plan, nodes: mesh.nodes.length }
      : null,
    says_ar: `أنا نوفا. الحالة المقاسة دلوقتي: ${answers.join(" · ")}.`,
  });
  return;
});

router.post("/fleet/servers", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: string; base?: string; url?: string; host?: string; kind?: string; note?: string };
  const raw = String(body.base ?? body.url ?? body.host ?? "");
  const servers = upsertServer(loadServers(), {
    name: String(body.name ?? ""),
    base: raw,
    kind: (body.kind as NovaServer["kind"]) ?? serverKind(raw),
    note: body.note,
  });
  if (servers.length === loadServers().length && !servers.some((s) => s.base)) {
    return res.status(400).json({ ok: false, error: "رابط غير صالح" });
  }
  saveServers(servers);
  res.json({ ...describe(servers), servers });
  return;
});

router.post("/fleet/servers/codespace", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: string; label?: string };
  const base = codespaceBase(String(body.name ?? ""));
  if (!base) return res.status(400).json({ ok: false, error: "اكتب اسم الـCodespace (زي animated-broccoli-gwx6wgpxvx5hv6gj)" });
  const servers = upsertServer(loadServers(), {
    name: String(body.label ?? body.name ?? "Codespace"),
    base,
    kind: "codespace",
    note: "بورت 8080 لازم يبقى Public من تبويب Ports",
  });
  saveServers(servers);
  res.json({ ...describe(servers), servers });
  return;
});

router.post("/fleet/servers/sync", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { servers?: unknown };
  const servers = replaceServers(body.servers);
  res.json({ ...describe(servers), servers });
  return;
});

router.delete("/fleet/servers/:id", (req: Request, res: Response) => {
  const servers = removeServer(loadServers(), String(req.params.id));
  saveServers(servers);
  res.json({ ...describe(servers), servers });
  return;
});

router.get("/fleet/servers/probe/:id", async (req: Request, res: Response) => {
  const target = loadServers().find((s) => s.id === String(req.params.id));
  if (!target) return res.status(404).json({ ok: false, error: "السيرفر مش مسجّل" });
  const probe = await probeServer(target);
  res.json({ ok: probe.ok, server: target, probe });
  return;
});

export default router;
