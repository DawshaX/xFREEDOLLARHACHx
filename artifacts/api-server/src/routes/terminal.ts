import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { requireOps } from "../lib/ops/gate";
import { z } from "zod";


const execAsync = promisify(exec);
const router = Router();

// zod schema for POST /terminal/exec (was referenced but never defined)
const ExecCommandBody = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
});
// `POST /terminal/exec` بينفّذ `command` من الـbody على المكنة (zod بشكل الأمر بس). إدارة الجلسات لسه مفتوحة — اللي اتبوّب هو التنفيذ.
router.use((req, res, next) => {
  const p = req.path;
  if (req.method === "GET" || !(p === "/terminal/exec")) return next();
  return requireOps("terminal-exec")(req as never, res as never, next);
});

interface Session {
  id: string;
  name: string;
  cwd: string;
  createdAt: string;
}

const sessions = new Map<string, Session>();

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

router.post("/terminal/exec", async (req, res) => {
  const parsed = ExecCommandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { command, cwd } = parsed.data;
  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd ?? process.env.HOME ?? "/",
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10,
    });
    res.json({ stdout, stderr, exitCode: 0, duration: (Date.now() - start) / 1000 });
  } catch (err: any) {
    res.json({
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "Command failed",
      exitCode: err.code ?? 1,
      duration: (Date.now() - start) / 1000,
    });
  }
});

router.get("/terminal/sessions", (_req, res) => {
  res.json(Array.from(sessions.values()));
});

router.post("/terminal/sessions", (_req, res) => {
  const id = generateId();
  const session: Session = {
    id,
    name: `Shell ${sessions.size + 1}`,
    cwd: process.env.HOME ?? "/",
    createdAt: new Date().toISOString(),
  };
  sessions.set(id, session);
  res.status(201).json(session);
});

router.delete("/terminal/sessions/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const deleted = sessions.delete(sessionId);
  res.json({ success: deleted, message: deleted ? "Session deleted" : "Session not found" });
});

export default router;
