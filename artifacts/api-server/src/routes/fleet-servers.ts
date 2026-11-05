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
  loadServers,
  probeAll,
  probeServer,
  removeServer,
  replaceServers,
  saveServers,
  serverKind,
  upsertServer,
  type NovaServer,
} from "../lib/server-registry";

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

router.get("/fleet/servers", async (_req: Request, res: Response) => {
  const servers = loadServers();
  const probes = await probeAll(servers);
  const byId = new Map(probes.map((p) => [p.id, p]));
  const up = probes.filter((p) => p.state === "up").length;
  res.json({
    ...describe(servers),
    up,
    down: servers.length - up,
    servers: servers.map((s) => ({ ...s, probe: byId.get(s.id) ?? null })),
    note:
      servers.length === 0
        ? "مفيش سيرفرات مسجّلة — ضيف الـCodespace أو Render أو Waifly من نفس الصفحة، والقياس هنا حقيقي بيتصل بـ/api/health."
        : undefined,
  });
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
