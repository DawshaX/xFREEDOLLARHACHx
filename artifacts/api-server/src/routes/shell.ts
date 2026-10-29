import { Router, type IRouter } from "express";
import { db, shellSessionsTable, shellHistoryTable, auditLogTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { spawn } from "node:child_process";

const router: IRouter = Router();

const ALLOWED_BIN = new Set([
  "echo", "ls", "pwd", "whoami", "date", "uname", "id", "hostname",
  "cat", "head", "tail", "wc", "grep", "find", "stat", "file", "tree",
  "curl", "wget", "ping", "host", "dig", "nslookup", "whois",
  "nmap", "nikto", "gobuster", "ffuf", "sqlmap", "wpscan", "subfinder",
  "amass", "httpx", "nuclei", "naabu", "katana", "dnsx", "tlsx",
  "openssl", "sha256sum", "md5sum", "base64", "tr", "awk", "sed", "cut",
  "ps", "df", "du", "free", "uptime", "env", "node", "python3", "git",
  "which", "type",
]);

const FORBIDDEN = [
  /\brm\s+-rf\b/i, /\bmkfs\b/i, /\bdd\s+if=/i, /\b:(){:|:&};:\b/,
  /\b>\s*\/dev\/sd/i, /\bshutdown\b/i, /\breboot\b/i, /\bpasswd\b/i,
  /\bsudo\b/i, /\bsu\s/i, /\bchmod\s+777\s+\/\b/i,
];

function isCommandSafe(cmd: string): { ok: boolean; reason?: string } {
  for (const re of FORBIDDEN) {
    if (re.test(cmd)) return { ok: false, reason: "أمر محظور" };
  }
  const first = cmd.trim().split(/[\s|;&><]+/)[0]?.replace(/^\.\//, "") ?? "";
  if (!first) return { ok: false, reason: "أمر فارغ" };
  if (!ALLOWED_BIN.has(first)) {
    return { ok: false, reason: `الأمر غير مسموح: ${first}. الأوامر المسموحة: ${Array.from(ALLOWED_BIN).slice(0, 12).join(", ")}...` };
  }
  return { ok: true };
}

async function execCommand(command: string, cwd: string, timeoutMs = 15000): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number; truncated: boolean; }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd, env: { ...process.env, PATH: process.env.PATH } });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const cap = 200_000;
    const timer = setTimeout(() => {
      truncated = true;
      try { child.kill("SIGKILL"); } catch { /* */ }
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (stdout.length < cap) stdout += d.toString();
      else truncated = true;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < cap) stderr += d.toString();
      else truncated = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, cap),
        stderr: stderr.slice(0, cap),
        exitCode: code ?? -1,
        durationMs: Date.now() - started,
        truncated,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + "\n" + err.message,
        exitCode: -1,
        durationMs: Date.now() - started,
        truncated,
      });
    });
  });
}

router.post("/shell/exec", async (req, res, next) => {
  try {
    const { command, cwd, sessionId } = req.body as { command: string; cwd?: string; sessionId?: string };
    if (!command) return res.status(400).json({ error: "command required" });

    const safety = isCommandSafe(command);

    let session;
    if (sessionId) {
      const [row] = await db.select().from(shellSessionsTable).where(eq(shellSessionsTable.id, sessionId)).limit(1);
      session = row;
    }
    if (!session) {
      const [row] = await db.insert(shellSessionsTable).values({ cwd: cwd ?? "/tmp" }).returning();
      session = row!;
    }

    if (!safety.ok) {
      const result = {
        sessionId: session.id,
        command,
        stdout: "",
        stderr: safety.reason ?? "غير مسموح",
        exitCode: -1,
        durationMs: 0,
        truncated: false,
      };
      await db.insert(shellHistoryTable).values({
        sessionId: session.id, command, stdout: "", stderr: result.stderr, exitCode: -1, durationMs: 0,
      });
      return res.json(result);
    }

    const out = await execCommand(command, session.cwd, 15000);
    await db.insert(shellHistoryTable).values({
      sessionId: session.id, command, stdout: out.stdout, stderr: out.stderr, exitCode: out.exitCode, durationMs: out.durationMs,
    });
    await db.update(shellSessionsTable)
      .set({ commandCount: sql`${shellSessionsTable.commandCount} + 1` })
      .where(eq(shellSessionsTable.id, session.id));

    await db.insert(auditLogTable).values({
      actor: "user", action: "shell.exec", target: command.slice(0, 80), result: out.exitCode === 0 ? "success" : "failure", detail: out.stderr.slice(0, 200),
    });

    return res.json({
      sessionId: session.id,
      command,
      stdout: out.stdout,
      stderr: out.stderr,
      exitCode: out.exitCode,
      durationMs: out.durationMs,
      truncated: out.truncated,
    });
  } catch (e) {
    return next(e);  }
});

router.get("/shell/sessions", async (_req, res, next) => {
  try {
    const rows = await db.select().from(shellSessionsTable).orderBy(desc(shellSessionsTable.createdAt)).limit(50);
    return res.json(rows.map((s) => ({
      id: s.id,
      cwd: s.cwd,
      createdAt: s.createdAt.toISOString(),
      commandCount: s.commandCount,
    })));
  } catch (e) {
    return next(e);  }
});

export default router;
