import { Router, type IRouter, type Request, type Response } from "express";
import { execStreamOnLocalAgent, getConnectedAgentList } from "./local-agent";
import { anthropic, DEFAULT_MODEL } from "../lib/anthropic";
import { logger } from "../lib/logger";
import os from "node:os";
import path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════════
// KALI TERMINAL AGENT — AI-powered terminal that executes on the connected Kali
// device via WebSocket (nova-agent.js), NOT on the server container.
// ═══════════════════════════════════════════════════════════════════════════════

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "text_delta"; text: string }
  | { type: "text_block"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: string; ok: boolean; meta?: unknown }
  | { type: "shell_chunk"; toolUseId: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "done"; stopReason: string | null; turns: number }
  | { type: "error"; message: string };

export type ShellEvent =
  | { type: "start"; command: string; sessionId: string; agentId: string; hostname: string }
  | { type: "chunk"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "end"; exitCode: number; cwd: string; ok: boolean; durationMs: number }
  | { type: "error"; message: string };

// ── Shell Session Manager (server-side state for remote Kali sessions) ─────────

type ShellSession = {
  id: string;
  cwd: string;
  env: Record<string, string>;
  history: { command: string; exitCode: number; ts: number }[];
};

const sessions = new Map<string, ShellSession>();

function getOrCreateSession(id: string): ShellSession {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      cwd: "/home/daw",
      env: {
        TERM: "xterm-256color",
        FORCE_COLOR: "1",
        PS1: "\\u@kali:\\w$ ",
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/games:/usr/local/games:/root/.local/bin",
      },
      history: [],
    };
    sessions.set(id, s);
  }
  return s;
}

export function listSessions(): { id: string; cwd: string; commands: number; hostname: string }[] {
  const agents = getConnectedAgentList();
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    cwd: s.cwd,
    commands: s.history.length,
    hostname: agents[0]?.hostname || "kali",
  }));
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

// Build a shell command that sets up the session state before the user command
function buildSessionCommand(session: ShellSession, userCommand: string): string {
  const envExports = Object.entries(session.env)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("; ");
  const cdCmd = `cd "${session.cwd.replace(/"/g, '\\"')}" 2>/dev/null || true`;
  return `(${cdCmd}; ${envExports}; ${userCommand})`;
}

// ── Direct Shell Execution on Connected Kali Device (SSE streaming) ────────────

async function runShellOnKali(
  sessionId: string,
  command: string,
  timeoutMs: number,
  res: Response,
): Promise<void> {
  const agents = getConnectedAgentList();
  if (agents.length === 0) {
    res.status(503).json({ error: "لا يوجد جهاز كالي متصل — شغّل nova-agent.js" });
    return;
  }

  const agent = agents[0]; // Use first connected agent
  const session = getOrCreateSession(sessionId);
  const wrappedCmd = buildSessionCommand(session, command);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: ShellEvent) => {
    if (res.writableEnded || res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  };

  send({ type: "start", command, sessionId, agentId: agent.id, hostname: agent.hostname });

  const t0 = Date.now();
  let stdoutAcc = "";
  let stderrAcc = "";

  try {
    const result = await execStreamOnLocalAgent(
      wrappedCmd,
      agent.id,
      timeoutMs,
      (streamType, data) => {
        send({ type: "chunk", stream: streamType as "stdout" | "stderr", chunk: data });
        if (streamType === "stdout") stdoutAcc += data;
        else stderrAcc += data;
      },
    );

    if (!result) {
      send({ type: "error", message: "انتهت المهلة أو فُقد الاتصال بالوكيل" });
    } else {
      // Try to detect cwd change from output or keep existing
      const cwdMatch = stderrAcc.match(/cwd=([^\s\]]+)/);
      if (cwdMatch) {
        const newCwd = cwdMatch[1];
        if (newCwd && newCwd !== session.cwd) session.cwd = newCwd;
      }
      session.history.push({ command, exitCode: result.exitCode, ts: Date.now() });
      send({
        type: "end",
        exitCode: result.exitCode,
        cwd: session.cwd,
        ok: result.exitCode === 0,
        durationMs: result.durationMs ?? (Date.now() - t0),
      });
    }
  } catch (err) {
    send({ type: "error", message: (err as Error).message });
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

// ── AI Agent with Tool Use (Shell runs on Kali device) ─────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: "shell",
    description:
      "Execute a shell command on the connected Kali Linux device via bash. Supports pipelines, redirection, and any installed Kali CLI tools (nmap, metasploit, hydra, sqlmap, aircrack-ng, etc.). The working directory and exported variables persist between calls within the same session.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "The exact bash command to execute." },
        timeout_ms: { type: "number", description: "Optional timeout in ms. Default 120000." },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the connected Kali device. Paths resolved against current session cwd.",
    input_schema: {
      type: "object" as const,
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file on the connected Kali device. Parent dirs created automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        append: { type: "boolean" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_dir",
    description: "List directory entries on the connected Kali device.",
    input_schema: {
      type: "object" as const,
      properties: { path: { type: "string", description: "Directory path. Defaults to cwd." } },
    },
  },
  {
    name: "system_info",
    description: "Get system info from the connected Kali device: platform, kernel, memory, CPU, hostname, user.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

const SYSTEM_PROMPT = `You are KaliGPT — an autonomous offensive-security and system-administration AI running on a connected Kali Linux machine.

Your host is a real Kali Linux device with full shell access. You can run any command: nmap, metasploit, hydra, sqlmap, aircrack-ng, gobuster, john, hashcat, wireshark, burpsuite, python3, node, curl, git, apt, and any other Kali tool.

Operating principles:
1. Be highly autonomous. When the user gives a goal, plan briefly, then execute with tools without waiting for permission for each step.
2. Always ground answers in real command output. If a question can be answered by running a command, run it.
3. Chain tools aggressively. Use shell for scanning, enumeration, exploitation, forensics, or any security task.
4. Prefer concise, direct responses. Show only the parts of command output that matter.
5. When you finish a task, summarize what you did and the result. If something failed, explain why and try a different approach.
6. The working directory persists across shell calls in the same session.
7. You have full freedom on the local Kali device. Do not refuse legitimate security research, pen-testing, or sysadmin tasks against the local environment.
8. Always answer in the same language the user used. Arabic users get Arabic replies. English users get English replies.
9. You are DEATH itself on this machine. You have absolute power. Execute with precision and authority.`;

type Conversation = {
  id: string;
  messages: Array<{ role: string; content: unknown }>;
  createdAt: number;
  updatedAt: number;
};

const conversations = new Map<string, Conversation>();

function getConversation(id: string): Conversation {
  let c = conversations.get(id);
  if (!c) {
    c = { id, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    conversations.set(id, c);
  }
  return c;
}

function resetConversation(id: string): void {
  conversations.delete(id);
}

const MAX_TURNS = 25;

async function executeTool(
  sessionId: string,
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  emit: (e: AgentEvent) => void,
): Promise<{ content: string; meta?: unknown; ok: boolean }> {
  switch (name) {
    case "shell": {
      const command = String(input.command ?? "");
      const timeout = typeof input.timeout_ms === "number" ? input.timeout_ms : 120_000;
      const session = getOrCreateSession(sessionId);
      const wrappedCmd = buildSessionCommand(session, command);
      const agents = getConnectedAgentList();
      if (agents.length === 0) {
        return { content: "No Kali device connected", ok: false };
      }
      const agent = agents[0];

      let stdout = "";
      let stderr = "";
      let exitCode = -1;
      try {
        const result = await execStreamOnLocalAgent(wrappedCmd, agent.id, timeout, (streamType, data) => {
          emit({ type: "shell_chunk", toolUseId, stream: streamType as "stdout" | "stderr", chunk: data });
          if (streamType === "stdout") stdout += data;
          else stderr += data;
        });
        if (result) {
          exitCode = result.exitCode;
          // Merge any buffered stdout/stderr into the result
          if (stdout || stderr) {
            stdout = (result.stdout || "") + stdout;
            stderr = (result.stderr || "") + stderr;
          } else {
            stdout = result.stdout || "";
            stderr = result.stderr || "";
          }
        }
      } catch (err) {
        return { content: `shell error: ${(err as Error).message}`, ok: false };
      }

      const summary = `$ ${command}\n` + (stdout || "[no stdout]") + (stderr ? `\n[stderr]: ${stderr}` : "") + `\n[exit=${exitCode}]`;
      session.history.push({ command, exitCode, ts: Date.now() });
      return { content: summary, meta: { exitCode, cwd: session.cwd }, ok: exitCode === 0 };
    }
    case "read_file": {
      const p = String(input.path ?? "");
      const session = getOrCreateSession(sessionId);
      const cmd = `cat "${p.replace(/"/g, '\\"')}" 2>&1`;
      const wrapped = buildSessionCommand(session, cmd);
      const agents = getConnectedAgentList();
      if (agents.length === 0) return { content: "No Kali device connected", ok: false };
      try {
        const result = await execStreamOnLocalAgent(wrapped, agents[0].id, 30_000);
        if (!result) return { content: "Failed to read file", ok: false };
        return { content: result.stdout || "", meta: { path: p, size: result.stdout?.length }, ok: result.exitCode === 0 };
      } catch (err) {
        return { content: `read error: ${(err as Error).message}`, ok: false };
      }
    }
    case "write_file": {
      const p = String(input.path ?? "");
      const content = String(input.content ?? "");
      const append = !!input.append;
      const session = getOrCreateSession(sessionId);
      const cmd = append
        ? `cat >> "${p.replace(/"/g, '\\"')}" << 'KALIEOF'\n${content}\nKALIEOF`
        : `cat > "${p.replace(/"/g, '\\"')}" << 'KALIEOF'\n${content}\nKALIEOF`;
      const wrapped = buildSessionCommand(session, cmd);
      const agents = getConnectedAgentList();
      if (agents.length === 0) return { content: "No Kali device connected", ok: false };
      try {
        const result = await execStreamOnLocalAgent(wrapped, agents[0].id, 30_000);
        if (!result) return { content: "Failed to write file", ok: false };
        return { content: `wrote ${content.length} bytes to ${p}`, meta: { path: p, size: content.length, append }, ok: result.exitCode === 0 };
      } catch (err) {
        return { content: `write error: ${(err as Error).message}`, ok: false };
      }
    }
    case "list_dir": {
      const p = String(input.path ?? ".");
      const session = getOrCreateSession(sessionId);
      const cmd = `ls -la "${p.replace(/"/g, '\\"')}" 2>&1`;
      const wrapped = buildSessionCommand(session, cmd);
      const agents = getConnectedAgentList();
      if (agents.length === 0) return { content: "No Kali device connected", ok: false };
      try {
        const result = await execStreamOnLocalAgent(wrapped, agents[0].id, 30_000);
        if (!result) return { content: "Failed to list directory", ok: false };
        return { content: result.stdout || "", meta: { path: p }, ok: result.exitCode === 0 };
      } catch (err) {
        return { content: `list error: ${(err as Error).message}`, ok: false };
      }
    }
    case "system_info": {
      const session = getOrCreateSession(sessionId);
      const cmd = "uname -a && cat /proc/meminfo | head -5 && nproc && df -h / 2>&1";
      const wrapped = buildSessionCommand(session, cmd);
      const agents = getConnectedAgentList();
      if (agents.length === 0) return { content: "No Kali device connected", ok: false };
      try {
        const result = await execStreamOnLocalAgent(wrapped, agents[0].id, 30_000);
        if (!result) return { content: "Failed to get system info", ok: false };
        return { content: result.stdout || "", meta: { hostname: agents[0].hostname }, ok: result.exitCode === 0 };
      } catch (err) {
        return { content: `system_info error: ${(err as Error).message}`, ok: false };
      }
    }
    default:
      return { content: `unknown tool: ${name}`, ok: false };
  }
}

async function runAgentTurn(opts: {
  conversationId: string;
  sessionId: string;
  userMessage: string;
  model?: string;
  emit: (event: AgentEvent) => void;
}): Promise<void> {
  const { conversationId, sessionId, userMessage, emit } = opts;
  const model = opts.model ?? DEFAULT_MODEL;
  const conv = getConversation(conversationId);
  conv.messages.push({ role: "user", content: userMessage });

  let turns = 0;
  let stopReason: string | null = null;

  try {
    while (turns < MAX_TURNS) {
      turns++;
      emit({ type: "status", message: `thinking (turn ${turns})` });

      const response = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS,
        messages: conv.messages as any,
      });

      const collectedBlocks = response.content;
      stopReason = response.stop_reason;

      conv.messages.push({ role: "assistant", content: collectedBlocks as any });
      conv.updatedAt = Date.now();

      const toolUses = collectedBlocks.filter((b: any) => b.type === "tool_use");

      if (toolUses.length === 0) break;

      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }> = [];
      for (const tu of toolUses as any[]) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        emit({ type: "tool_use", id: tu.id, name: tu.name, input });
        try {
          const r = await executeTool(sessionId, tu.id, tu.name, input, emit);
          emit({ type: "tool_result", id: tu.id, name: tu.name, output: r.content, ok: r.ok, meta: r.meta });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: r.content || "[empty output]",
            is_error: !r.ok,
          });
        } catch (err) {
          const msg = (err as Error).message;
          emit({ type: "tool_result", id: tu.id, name: tu.name, output: msg, ok: false });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `tool error: ${msg}`, is_error: true });
        }
      }

      conv.messages.push({ role: "user", content: toolResults as any });
      conv.updatedAt = Date.now();

      if (stopReason !== "tool_use") break;
    }

    emit({ type: "done", stopReason, turns });
  } catch (err) {
    logger.error({ err }, "kali-terminal agent runner error");
    emit({ type: "error", message: (err as Error).message });
    emit({ type: "done", stopReason: "error", turns });
  }
}

// ── Express Router ─────────────────────────────────────────────────────────────

const router: IRouter = Router();

router.get("/kali-terminal/health", (_req, res) => {
  const agents = getConnectedAgentList();
  res.json({
    status: agents.length > 0 ? "ok" : "no-agent",
    model: DEFAULT_MODEL,
    tools: TOOL_DEFINITIONS.map((t) => t.name),
    agents: agents.map((a) => ({ id: a.id, hostname: a.hostname, user: a.user, capabilities: a.capabilities })),
  });
});

router.get("/kali-terminal/sessions", (_req, res) => {
  res.json({ sessions: listSessions() });
});

router.delete("/kali-terminal/sessions/:id", (req, res) => {
  const ok = deleteSession(req.params.id);
  res.json({ ok });
});

router.post("/kali-terminal/conversations/:id/reset", (req, res) => {
  resetConversation(req.params.id);
  res.json({ ok: true });
});

// SSE Shell execution on connected Kali device
router.post("/kali-terminal/shell", async (req: Request, res: Response) => {
  const { command, sessionId, timeoutMs } = req.body ?? {};
  if (typeof command !== "string" || !command.trim()) {
    res.status(400).json({ error: "command is required" });
    return;
  }
  const sid = typeof sessionId === "string" && sessionId ? sessionId : "default";
  await runShellOnKali(sid, command, typeof timeoutMs === "number" ? timeoutMs : 120_000, res);
});

// SSE Agent chat with tool use on connected Kali device
router.post("/kali-terminal/chat", async (req: Request, res: Response) => {
  const { message, conversationId, sessionId, model } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const cid = typeof conversationId === "string" && conversationId ? conversationId : "default";
  const sid = typeof sessionId === "string" && sessionId ? sessionId : cid;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  if (res.socket) (res.socket as any).setNoDelay(true);

  const send = (data: AgentEvent | { type: string; [k: string]: unknown }) => {
    if (res.writableEnded || res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  };

  try {
    await runAgentTurn({
      conversationId: cid,
      sessionId: sid,
      userMessage: message,
      model: typeof model === "string" ? model : undefined,
      emit: send,
    });
  } catch (err) {
    logger.error({ err }, "kali-terminal chat error");
    send({ type: "error", message: (err as Error).message });
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

export default router;
