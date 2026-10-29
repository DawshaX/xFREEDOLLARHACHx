import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, nodes, nodeCommands } from "@workspace/db";
import { runShell } from "../lib/processes";
import net from "node:net";

const router: IRouter = Router();

interface NodeBody {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: "password" | "key";
  credential?: string;
  tags?: string;
  isActive?: boolean;
}

function tcpPing(host: string, port: number, timeoutMs = 4000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean, err?: string) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve({ ok, latencyMs: Date.now() - start, ...(err ? { error: err } : {}) });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false, "timeout"));
    sock.once("error", (e) => finish(false, e.message));
    try {
      sock.connect(port, host);
    } catch (e) {
      finish(false, e instanceof Error ? e.message : "connect failed");
    }
  });
}

router.get("/nodes", async (_req, res) => {
  const rows = await db.select().from(nodes).orderBy(desc(nodes.updatedAt));
  res.json(
    rows.map((n) => ({
      id: n.id,
      name: n.name,
      host: n.host,
      port: n.port,
      username: n.username,
      authType: n.authType,
      status: n.status,
      lastPingedAt: n.lastPingedAt,
      osInfo: n.osInfo,
      tags: n.tags,
      isActive: n.isActive,
      hasCredential: Boolean(n.credential && n.credential.length > 0),
    })),
  );
});

router.post("/nodes", async (req, res) => {
  const body = req.body as NodeBody;
  if (!body.name || !body.host) {
    res.status(400).json({ error: "name and host are required" });
    return;
  }
  const [row] = await db
    .insert(nodes)
    .values({
      name: body.name,
      host: body.host,
      port: body.port ?? 22,
      username: body.username ?? "root",
      authType: body.authType ?? "password",
      credential: body.credential ?? "",
      tags: body.tags ?? "",
      isActive: body.isActive ?? true,
    })
    .returning();
  res.status(201).json(row);
});

router.put("/nodes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as NodeBody;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "host", "port", "username", "authType", "tags", "isActive"] as const) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  // Only overwrite credential if a new non-empty value is provided
  if (typeof body.credential === "string" && body.credential.length > 0) {
    update["credential"] = body.credential;
  }
  const [row] = await db.update(nodes).set(update).where(eq(nodes.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/nodes/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(nodes).where(eq(nodes.id, id));
  res.status(204).end();
});

router.post("/nodes/:id/ping", async (req, res) => {
  const id = Number(req.params.id);
  const [n] = await db.select().from(nodes).where(eq(nodes.id, id));
  if (!n) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const ping = await tcpPing(n.host, n.port);
  await db
    .update(nodes)
    .set({
      status: ping.ok ? "online" : "offline",
      lastPingedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, id));
  res.json({
    nodeId: id,
    host: n.host,
    port: n.port,
    online: ping.ok,
    latencyMs: ping.latencyMs,
    ...(ping.error ? { error: ping.error } : {}),
  });
});

// Bulk ping all active nodes (for the panel auto-poll)
router.post("/nodes/ping-all", async (_req, res) => {
  const rows = await db.select().from(nodes).where(eq(nodes.isActive, true));
  const results = await Promise.all(
    rows.map(async (n) => {
      const p = await tcpPing(n.host, n.port);
      await db
        .update(nodes)
        .set({
          status: p.ok ? "online" : "offline",
          lastPingedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(nodes.id, n.id));
      return {
        nodeId: n.id,
        host: n.host,
        online: p.ok,
        latencyMs: p.latencyMs,
        ...(p.error ? { error: p.error } : {}),
      };
    }),
  );
  res.json({ results });
});

router.post("/nodes/:id/exec", async (req, res) => {
  const id = Number(req.params.id);
  const command = String(req.body?.command || "").trim();
  const triggeredBy = String(req.body?.triggeredBy || "user");
  if (!command) {
    res.status(400).json({ error: "command required" });
    return;
  }
  const [n] = await db.select().from(nodes).where(eq(nodes.id, id));
  if (!n) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [cmdRow] = await db
    .insert(nodeCommands)
    .values({ nodeId: id, command, triggeredBy, status: "running" })
    .returning();

  const sshCmd =
    n.authType === "key"
      ? `ssh -i ${JSON.stringify(n.credential || "~/.ssh/id_rsa")} -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${n.port} ${n.username}@${n.host} ${JSON.stringify(command)}`
      : `sshpass -p ${JSON.stringify(n.credential)} ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${n.port} ${n.username}@${n.host} ${JSON.stringify(command)}`;

  const result = await runShell(sshCmd, { timeoutMs: 90_000 });

  await db
    .update(nodeCommands)
    .set({
      stdout: result.output.slice(0, 60_000),
      exitCode: result.exitCode,
      status: result.timedOut ? "timeout" : result.exitCode === 0 ? "completed" : "failed",
      completedAt: new Date(),
    })
    .where(eq(nodeCommands.id, cmdRow.id));

  res.json({
    commandId: cmdRow.id,
    nodeId: id,
    host: n.host,
    command,
    output: result.output.slice(0, 12_000),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  });
});

router.get("/nodes/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select()
    .from(nodeCommands)
    .where(eq(nodeCommands.nodeId, id))
    .orderBy(desc(nodeCommands.startedAt))
    .limit(50);
  res.json(rows);
});

export default router;
