import { Router, type IRouter } from "express";
import fs from "node:fs";
import {
  clearProcess,
  getEmitter,
  getProcess,
  killProcess,
  listProcesses,
  startProcess,
} from "../lib/processes";
// 2026-11-15: this router spawns `bash -lc <anything>` on the platform host and
// had NO gate — POST /api/processes was an unauthenticated RCE. It now goes
// through the same ops gate as /api/exec and /api/local-agent.
import { requireOps } from "../lib/ops/gate";

const router: IRouter = Router();

router.use(requireOps("processes"));

router.get("/processes", (_req, res) => {
  res.json(listProcesses().map((p) => ({ ...p, output: p.output.slice(-4000) })));
});

router.post("/processes", (req, res) => {
  const command = String(req.body?.command || "").trim();
  if (!command) {
    res.status(400).json({ error: "command required" });
    return;
  }
  // A caller-supplied cwd was passed straight to spawn(). A relative or
  // non-existent path made the child fail with a confusing ENOENT, and an
  // absolute path let a caller run commands in any directory on the host.
  // It is now required to be an existing absolute directory.
  const rawCwd = req.body?.cwd ? String(req.body.cwd) : undefined;
  let cwd: string | undefined;
  if (rawCwd) {
    if (!rawCwd.startsWith("/")) {
      res.status(400).json({ error: "cwd must be an absolute path" });
      return;
    }
    try {
      if (!fs.statSync(rawCwd).isDirectory()) {
        res.status(400).json({ error: "cwd is not a directory" });
        return;
      }
    } catch {
      res.status(400).json({ error: "cwd does not exist" });
      return;
    }
    cwd = rawCwd;
  }
  try {
    const rec = startProcess({ command, cwd });
    res.status(201).json(rec);
  } catch (e) {
    res.status(429).json({ error: e instanceof Error ? e.message : "start failed" });
  }
});

router.get("/processes/:id", (req, res) => {
  const rec = getProcess(req.params.id);
  if (!rec) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(rec);
});

router.delete("/processes/:id", (req, res) => {
  const id = req.params.id;
  killProcess(id);
  clearProcess(id);
  res.status(204).end();
});

router.post("/processes/:id/kill", (req, res) => {
  const ok = killProcess(req.params.id);
  res.json({ ok });
});

router.get("/processes/:id/stream", (req, res) => {
  const id = req.params.id;
  const rec = getProcess(id);
  if (!rec) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("snapshot", { output: rec.output, status: rec.status });

  if (rec.status !== "running") {
    send("end", { exitCode: rec.exitCode, status: rec.status });
    res.end();
    return;
  }

  const emitter = getEmitter(id);
  if (!emitter) {
    res.end();
    return;
  }

  const onData = (chunk: string) => send("data", { chunk });
  const onEnd = () => {
    const fresh = getProcess(id);
    send("end", {
      exitCode: fresh?.exitCode ?? null,
      status: fresh?.status ?? "exited",
    });
    cleanup();
    res.end();
  };
  const cleanup = () => {
    emitter.off("data", onData);
    emitter.off("end", onEnd);
  };
  emitter.on("data", onData);
  emitter.on("end", onEnd);
  req.on("close", cleanup);
});

export default router;
