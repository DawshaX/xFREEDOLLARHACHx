/**
 * Local Machine Agent — Full-Control WebSocket Agent Backend
 * Supports: PTY shell, file system, process management, screenshot relay, system info
 */
import { Router } from "express";
import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import { logger } from "../lib/logger";
import { auditLog } from "../lib/audit";
import { broadcastLiveEvent } from "./live-events";
import { broadcastEvent } from "../lib/ws-hub";
import fs from "fs";
import path from "path";

const router = Router();

interface AgentConnection {
  ws: WebSocket;
  id: string;
  hostname: string;
  platform: string;
  user: string;
  arch?: string;
  cpus?: number;
  totalMemory?: number;
  nodeVersion?: string;
  capabilities: string[];
  interfaces?: Record<string, string[]>;
  connectedAt: number;
  pendingRequests: Map<string, (result: unknown) => void>;
}

interface PtySession {
  sessionId: string;
  agentId: string;
  outputBuf: string[];
  subscribers: Set<(data: string) => void>;
}

const connectedAgents = new Map<string, AgentConnection>();
const ptySessions = new Map<string, PtySession>();

// ── Deep Agent Profiles (sent by nova-agent v4) ───────────────────────────────
interface AgentDeepProfile {
  system: {
    hostname: string; platform: string; arch: string; release?: string;
    uptime?: number; cpus?: { count: number; model: string; speed: number };
    memory?: { total: number; free: number; used: number; usedPct: number };
    loadAvg?: number[]; user?: string; display?: boolean; displayValue?: string | null;
  };
  tools: Record<string, string[]>;
  toolCount: number;
  network?: {
    interfaces?: Record<string, string[]>;
    routes?: string[];
    openPorts?: string[];
    arpTable?: string[];
    dnsServers?: string[];
    hostname?: string;
  };
  services?: { running?: string[]; failed?: string[]; all?: number };
  users?: { current?: string; all?: string[]; sudoers?: string[]; sessions?: string[] };
  cronJobs?: Array<{ user?: string; jobs?: string[]; system?: string[] }>;
  docker?: { containers?: string[]; count?: number } | null;
  environment?: { shell?: string; path?: string; home?: string; pythonPath?: string | null; rubyVersion?: string | null };
  capabilities?: string[];
  interfaces?: Record<string, string[]>;
  profileBuiltAt?: number;
  profileBuildMs?: number;
}

const agentDeepProfiles = new Map<string, AgentDeepProfile>();

export function getAgentDeepProfile(agentId?: string): AgentDeepProfile | null {
  if (agentId) return agentDeepProfiles.get(agentId) ?? null;
  const first = [...agentDeepProfiles.values()][0];
  return first ?? null;
}

export interface FleetAgent {
  id: string;
  hostname: string;
  platform: string;
  user: string;
  arch?: string;
  cpus?: number;
  totalMemory?: number;
  nodeVersion?: string;
  capabilities: string[];
  interfaces?: Record<string, string[]>;
  connectedAt: number;
}

/** Read-only snapshot of every machine currently attached to the platform. */
export function getConnectedAgentList(): FleetAgent[] {
  return [...connectedAgents.values()].map((a) => ({
    id: a.id,
    hostname: a.hostname,
    platform: a.platform,
    user: a.user,
    arch: a.arch,
    cpus: a.cpus,
    totalMemory: a.totalMemory,
    nodeVersion: a.nodeVersion,
    capabilities: a.capabilities,
    interfaces: a.interfaces,
    connectedAt: a.connectedAt,
  }));
}

export function isLocalAgentConnected(): boolean {
  return connectedAgents.size > 0;
}

export function execOnLocalAgent(
  cmd: string,
  agentId?: string,
  timeout = 30_000,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number } | null> {
  const agent = agentId ? connectedAgents.get(agentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return Promise.resolve(null);
  return sendToAgent<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>(
    agent.id,
    { type: "exec", command: cmd, timeout, stream: false },
    `exec-${Date.now()}-${Math.random()}`,
    timeout + 8000,
  );
}

// Streaming exec: calls onData for each stdout/stderr chunk, resolves with final result
const streamCallbacks = new Map<string, (streamType: string, data: string) => void>();

export function execStreamOnLocalAgent(
  cmd: string,
  agentId?: string,
  timeout = 30_000,
  onData?: (streamType: string, data: string) => void,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number } | null> {
  const agent = agentId ? connectedAgents.get(agentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return Promise.resolve(null);

  const requestId = `execstream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (onData) streamCallbacks.set(requestId, onData);

  return new Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number } | null>((resolve) => {
    const timer = setTimeout(() => {
      streamCallbacks.delete(requestId);
      agent.pendingRequests.delete(requestId);
      resolve(null);
    }, timeout + 8000);

    agent.pendingRequests.set(requestId, (result) => {
      clearTimeout(timer);
      streamCallbacks.delete(requestId);
      resolve(result as { stdout: string; stderr: string; exitCode: number; durationMs: number });
    });

    try {
      // Primary: nova-agent.js compatible
      agent.ws.send(JSON.stringify({ type: "exec", command: cmd, timeout, stream: true, requestId }));
      // Fallback: old/simple agents that respond to "command" type (sent after 200ms to avoid race)
      setTimeout(() => {
        if (agent.pendingRequests.has(requestId)) {
          try { agent.ws.send(JSON.stringify({ type: "command", cmd, command: cmd, requestId, timeout })); } catch { /* ignore */ }
        }
      }, 200);
    } catch {
      clearTimeout(timer);
      streamCallbacks.delete(requestId);
      agent.pendingRequests.delete(requestId);
      resolve(null);
    }
  });
}

async function sendToAgent<T = unknown>(
  agentId: string,
  msg: Record<string, unknown>,
  requestId: string,
  timeoutMs: number,
): Promise<T | null> {
  const agent = connectedAgents.get(agentId);
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return null;
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      agent.pendingRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);
    agent.pendingRequests.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result as T);
    });
    try {
      agent.ws.send(JSON.stringify({ ...msg, requestId }));
    } catch {
      clearTimeout(timer);
      agent.pendingRequests.delete(requestId);
      resolve(null);
    }
  });
}

export function initLocalAgentWss(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let agentId = `agent-${Date.now()}`;
    let registered = false;

    logger.info({ url: req.url }, "Local agent WebSocket connected");

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        handleAgentMessage(ws, agentId, registered, msg, (newId, newReg) => {
          agentId = newId;
          registered = newReg;
        });
      } catch (e) {
        logger.warn({ e }, "Local agent WS parse error");
      }
    });

    ws.on("close", () => {
      if (registered) {
        const agent = connectedAgents.get(agentId);
        if (agent) {
          for (const [, resolve] of agent.pendingRequests) {
            resolve({ stdout: "", stderr: "Agent disconnected", exitCode: -1, durationMs: 0 });
          }
        }
        connectedAgents.delete(agentId);
        for (const [sid, sess] of ptySessions) {
          if (sess.agentId === agentId) ptySessions.delete(sid);
        }
        logger.info({ agentId }, "Local agent disconnected");
        broadcastLiveEvent({
          type: "agent_alert",
          data: { title: "🔌 جهاز محلي انقطع", message: agentId, severity: "warning", ts: Date.now() },
          ts: new Date().toISOString(),
        });
        broadcastEvent("local_agent_status", { connected: false, agents: getConnectedAgentList() });
      }
    });

    ws.on("error", (err: Error) => {
      logger.warn({ err, agentId }, "Local agent WS error");
      connectedAgents.delete(agentId);
    });
  });
}

function handleAgentMessage(
  ws: WebSocket,
  agentId: string,
  registered: boolean,
  msg: Record<string, unknown>,
  updateState: (id: string, reg: boolean) => void,
) {
  const type = msg.type as string;

  // ── Accept both "register" (nova-agent v7+) and "hello" (older agents) ──────
  if (type === "register" || type === "hello") {
    const newId = (msg.id as string) || agentId;
    const agent: AgentConnection = {
      ws,
      id: newId,
      hostname: (msg.hostname as string) || "unknown",
      platform: (msg.platform as string) || "linux",
      user: (msg.user as string) || "unknown",
      arch: msg.arch as string | undefined,
      cpus: msg.cpus as number | undefined,
      totalMemory: msg.totalMemory as number | undefined,
      nodeVersion: msg.nodeVersion as string | undefined,
      capabilities: (msg.capabilities as string[]) || ["shell"],
      interfaces: msg.interfaces as Record<string, string[]> | undefined,
      connectedAt: Date.now(),
      pendingRequests: new Map(),
    };
    connectedAgents.set(newId, agent);
    updateState(newId, true);

    logger.info({ agentId: newId, hostname: agent.hostname, user: agent.user }, "Local agent registered");
    auditLog({ ts: new Date().toISOString(), action: "connection", data: { agentId: newId, hostname: agent.hostname, user: agent.user } });

    ws.send(JSON.stringify({ type: "registered", agentId: newId }));

    // ── If deepProfile is embedded in the register/hello message, store it ──
    const inlineProfile = msg.deepProfile as AgentDeepProfile | undefined;
    if (inlineProfile && typeof inlineProfile === "object") {
      agentDeepProfiles.set(newId, inlineProfile);
      logger.info(
        { agentId: newId, toolCount: inlineProfile.toolCount },
        "Agent deep profile received (inline with registration)"
      );
    }

    broadcastLiveEvent({
      type: "agent_alert",
      data: {
        title: `🖥️ جهاز متصل: ${agent.hostname}`,
        message: `${agent.user}@${agent.hostname} (${agent.platform}) | قدرات: ${agent.capabilities.join(", ")}`,
        severity: "info",
        ts: Date.now(),
      },
      ts: new Date().toISOString(),
    });
    broadcastEvent("local_agent_status", { connected: true, agents: getConnectedAgentList() });
    return;
  }

  if (!registered) return;
  const agent = connectedAgents.get(agentId);
  if (!agent) return;

  if (type === "command_result" || type === "exec_result") {
    const requestId = msg.requestId as string;
    const resultPayload = {
      id: requestId,
      stdout: (msg.stdout as string) || "",
      stderr: (msg.stderr as string) || "",
      exitCode: (msg.exitCode as number) ?? 0,
      durationMs: (msg.durationMs as number) || 0,
    };

    if (requestId) {
      // Normal path: match by requestId
      const resolve = agent.pendingRequests.get(requestId);
      if (resolve) {
        resolve(resultPayload);
        agent.pendingRequests.delete(requestId);
      }
    } else {
      // ── Fallback for old/simple agents that don't echo requestId ──────────
      // Resolve the OLDEST pending exec request so old agents work seamlessly
      const firstEntry = [...agent.pendingRequests.entries()][0];
      if (firstEntry) {
        const [reqId, resolve] = firstEntry;
        resolve(resultPayload);
        agent.pendingRequests.delete(reqId);
        logger.info({ agentId, reqId }, "exec_result matched by fallback (no requestId from agent)");
      }
    }

    broadcastLiveEvent({
      type: "shell_output",
      data: {
        tool: "local_shell",
        command: `[${agent.hostname}]`,
        output: resultPayload.stdout + (resultPayload.stderr ? `\n[stderr]: ${resultPayload.stderr}` : ""),
        isError: resultPayload.exitCode !== 0,
        durationMs: resultPayload.durationMs,
        ts: Date.now(),
      },
      ts: new Date().toISOString(),
    });
    return;
  }

  // ── Result types — accept all variants including legacy names ────────────
  if (
    type === "fs_result" || type === "fs_read_result" || type === "fs_write_result" || type === "fs_list_result" ||
    type === "processes_result" || type === "screenshot_result" ||
    type === "sysinfo_result" || type === "sys_info_result" ||
    type === "kill_result" || type === "pty_result" || type === "pty_exit" ||
    type === "mouse_result" || type === "keyboard_result" || type === "clipboard_result" ||
    type === "deep_profile_result"
  ) {
    const requestId = msg.requestId as string;

    // deep_profile_result: store the profile then resolve any pending request
    if (type === "deep_profile_result") {
      const profile = msg.profile as AgentDeepProfile;
      if (profile) {
        agentDeepProfiles.set(agentId, profile);
        logger.info({ agentId, toolCount: profile.toolCount }, "Agent deep profile received (via deep_profile_result)");
      }
    }

    if (requestId) {
      const resolve = agent.pendingRequests.get(requestId);
      if (resolve) { resolve(msg); agent.pendingRequests.delete(requestId); }
    }
    return;
  }

  if (type === "pty_output") {
    const { sessionId, data } = msg as { sessionId: string; data: string };
    const sess = ptySessions.get(sessionId);
    if (!sess) return;
    sess.outputBuf.push(data);
    if (sess.outputBuf.length > 500) sess.outputBuf.shift();
    for (const sub of sess.subscribers) { try { sub(data); } catch { sess.subscribers.delete(sub); } }
    return;
  }

  // Streaming exec data — accept both "exec_stream_data" and old "stream_data"
  if (type === "exec_stream_data" || type === "stream_data") {
    const requestId = msg.requestId as string;
    const streamType = (msg.stream as string) || (msg.streamType as string) || "stdout";
    const data = (msg.data as string) || "";
    if (requestId) {
      const cb = streamCallbacks.get(requestId);
      if (cb) { try { cb(streamType, data); } catch { streamCallbacks.delete(requestId); } }
    } else {
      const firstCb = [...streamCallbacks.values()][0];
      if (firstCb) { try { firstCb(streamType, data); } catch { /* ignore */ } }
    }
    return;
  }

  // ── Deep Profile from nova-agent v4 ────────────────────────────────────────
  if (type === "deep_profile") {
    const profile = msg.profile as AgentDeepProfile;
    if (profile) {
      agentDeepProfiles.set(agentId, profile);
      logger.info(
        { agentId, toolCount: profile.toolCount, buildMs: profile.profileBuildMs },
        "Agent deep profile received"
      );
      broadcastLiveEvent({
        type: "agent_alert",
        data: {
          title: `🔍 ملف عميق: ${agent.hostname}`,
          message: `${profile.toolCount || 0} أداة أمنية مكتشفة | شبكة: ${Object.keys(profile.network?.interfaces || {}).length} واجهات | خدمات: ${profile.services?.running?.length || 0} جارية`,
          severity: "info",
          ts: Date.now(),
        },
        ts: new Date().toISOString(),
      });
      broadcastEvent("agent_deep_profile", { agentId, toolCount: profile.toolCount, hostname: agent.hostname });
    }
    return;
  }

  if (type === "heartbeat" || type === "pong") {
    ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
    return;
  }

  // ── Catch-all: any unknown message that contains stdout/stderr ────────────
  // Handles old agents that use non-standard result message types
  if (msg.stdout !== undefined || msg.output !== undefined || msg.result !== undefined) {
    const requestId = (msg.requestId as string) || (msg.id as string) || "";
    const stdout = (msg.stdout as string) || (msg.output as string) || String(msg.result ?? "");
    const stderr = (msg.stderr as string) || "";
    const exitCode = (msg.exitCode as number) ?? (msg.code as number) ?? 0;
    const durationMs = (msg.durationMs as number) || 0;
    const resultPayload = { id: requestId, stdout, stderr, exitCode, durationMs };

    logger.info({ agentId, type, requestId: requestId || "(none)" }, "Agent sent non-standard result — applying catch-all");

    if (requestId) {
      const resolve = agent.pendingRequests.get(requestId);
      if (resolve) { resolve(resultPayload); agent.pendingRequests.delete(requestId); }
    } else {
      const firstEntry = [...agent.pendingRequests.entries()][0];
      if (firstEntry) {
        const [reqId, resolve] = firstEntry;
        resolve(resultPayload);
        agent.pendingRequests.delete(reqId);
      }
    }

    broadcastLiveEvent({
      type: "shell_output",
      data: { tool: "local_shell", command: `[${agent.hostname}]`, output: stdout + (stderr ? `\n[stderr]: ${stderr}` : ""), isError: exitCode !== 0, durationMs, ts: Date.now() },
      ts: new Date().toISOString(),
    });
    return;
  }

  // Log unknown message types for debugging
  logger.info({ agentId, type, keys: Object.keys(msg) }, "Agent sent unknown message type");
}

// ── REST API routes ───────────────────────────────────────────────────────────

router.get("/local-agent/agents", (_req, res) => {
  res.json({ agents: getConnectedAgentList(), count: connectedAgents.size });
});

router.get("/local-agent/status", (_req, res) => {
  res.json({ connected: connectedAgents.size > 0, agents: getConnectedAgentList(), count: connectedAgents.size });
});

router.post("/local-agent/exec", async (req, res) => {
  const { command, agentId: reqAgentId, timeout = 60_000 } = req.body as { command: string; agentId?: string; timeout?: number };
  if (!command) { res.status(400).json({ error: "missing command" }); return; }

  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "no local agent connected", connected: false }); return;
  }

  const requestId = `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  auditLog({ ts: new Date().toISOString(), action: "exec_start", data: { agentId: agent.id, command } });

  const result = await sendToAgent<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>(
    agent.id, { type: "exec", command, timeout }, requestId, (timeout as number) + 10_000,
  );

  if (!result) { res.status(504).json({ error: "timeout or agent disconnected" }); return; }
  auditLog({ ts: new Date().toISOString(), action: "exec_result", data: { agentId: agent.id, command, exitCode: result.exitCode } });
  res.json(result);
});

router.post("/local-agent/pty/create", async (req, res) => {
  const { agentId: reqAgentId, cols = 220, rows = 50, shell = "/bin/bash" } = req.body as {
    agentId?: string; cols?: number; rows?: number; shell?: string;
  };
  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "no local agent connected" }); return;
  }
  const sid = `pty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ptySessions.set(sid, { sessionId: sid, agentId: agent.id, outputBuf: [], subscribers: new Set() });
  const requestId = `pty_create:${sid}`;
  const result = await sendToAgent(agent.id, { type: "pty_create", sessionId: sid, cols, rows, shell }, requestId, 15_000);
  if (!result) { res.status(504).json({ error: "PTY creation timed out" }); return; }
  res.json({ ok: true, sessionId: sid, agentId: agent.id });
});

router.post("/local-agent/pty/:sessionId/input", (req, res) => {
  const { sessionId } = req.params;
  const { data } = req.body as { data: string; agentId?: string };
  const sess = ptySessions.get(sessionId);
  if (!sess) { res.status(404).json({ error: "session not found" }); return; }
  const agent = connectedAgents.get(sess.agentId);
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "agent disconnected" }); return;
  }
  agent.ws.send(JSON.stringify({ type: "pty_input", sessionId, data }));
  res.json({ ok: true });
});

router.post("/local-agent/pty/:sessionId/resize", (req, res) => {
  const { sessionId } = req.params;
  const { cols, rows } = req.body as { cols: number; rows: number };
  const sess = ptySessions.get(sessionId);
  if (!sess) { res.status(404).json({ error: "session not found" }); return; }
  const agent = connectedAgents.get(sess.agentId);
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "agent disconnected" }); return;
  }
  agent.ws.send(JSON.stringify({ type: "pty_resize", sessionId, cols, rows }));
  res.json({ ok: true });
});

router.delete("/local-agent/pty/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const sess = ptySessions.get(sessionId);
  if (!sess) { res.json({ ok: true }); return; }
  const agent = connectedAgents.get(sess.agentId);
  if (agent && agent.ws.readyState === WebSocket.OPEN) {
    agent.ws.send(JSON.stringify({ type: "pty_kill", sessionId }));
  }
  ptySessions.delete(sessionId);
  res.json({ ok: true });
});

router.get("/local-agent/pty/:sessionId/stream", (req, res) => {
  const { sessionId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let sess = ptySessions.get(sessionId);
  if (!sess) {
    const agent = [...connectedAgents.values()][0];
    if (!agent) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "no agent" })}\n\n`);
      res.end();
      return;
    }
    sess = { sessionId, agentId: agent.id, outputBuf: [], subscribers: new Set() };
    ptySessions.set(sessionId, sess);
  }

  for (const chunk of sess.outputBuf) {
    try { res.write(`data: ${JSON.stringify({ type: "output", data: chunk })}\n\n`); } catch { }
  }

  const onOutput = (data: string) => {
    try { res.write(`data: ${JSON.stringify({ type: "output", data })}\n\n`); (res as any).flush?.(); } catch { }
  };
  sess.subscribers.add(onOutput);

  req.on("close", () => {
    ptySessions.get(sessionId)?.subscribers.delete(onOutput);
  });
});

router.get("/local-agent/fs/list", async (req, res) => {
  const { dir = "~", agentId: reqAgentId } = req.query as { dir?: string; agentId?: string };
  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "no local agent connected" }); return;
  }
  const requestId = `fs-list-${Date.now()}`;
  const result = await sendToAgent(agent.id, { type: "fs_list", requestId, dir }, requestId, 15_000);
  if (!result) { res.status(504).json({ error: "timeout" }); return; }
  res.json(result);
});

router.post("/local-agent/fs/read", async (req, res) => {
  const { filePath, agentId: reqAgentId, maxBytes } = req.body as { filePath: string; agentId?: string; maxBytes?: number };
  if (!filePath) { res.status(400).json({ error: "missing filePath" }); return; }
  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "no local agent connected" }); return;
  }
  const requestId = `fs-read-${Date.now()}`;
  const result = await sendToAgent(agent.id, { type: "fs_read", requestId, filePath, maxBytes }, requestId, 30_000);
  if (!result) { res.status(504).json({ error: "timeout" }); return; }
  res.json(result);
});

router.post("/local-agent/fs/write", async (req, res) => {
  const { filePath, content, agentId: reqAgentId, append } = req.body as { filePath: string; content: string; agentId?: string; append?: boolean };
  if (!filePath || content === undefined) { res.status(400).json({ error: "missing filePath or content" }); return; }
  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "no local agent connected" }); return;
  }
  const requestId = `fs-write-${Date.now()}`;
  const result = await sendToAgent(agent.id, { type: "fs_write", requestId, filePath, content, append }, requestId, 15_000);
  if (!result) { res.status(504).json({ error: "timeout" }); return; }
  res.json(result);
});

router.get("/local-agent/processes", async (req, res) => {
  const { agentId: reqAgentId } = req.query as { agentId?: string };
  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "no local agent connected" }); return;
  }
  const requestId = `procs-${Date.now()}`;
  const result = await sendToAgent(agent.id, { type: "processes", requestId }, requestId, 15_000);
  if (!result) { res.status(504).json({ error: "timeout" }); return; }
  res.json(result);
});

router.post("/local-agent/kill-process", async (req, res) => {
  const { pid, signal = "SIGTERM", agentId: reqAgentId } = req.body as { pid: number | string; signal?: string; agentId?: string };
  if (!pid) { res.status(400).json({ error: "missing pid" }); return; }
  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "no local agent connected" }); return;
  }
  const requestId = `kill-${Date.now()}`;
  const result = await sendToAgent(agent.id, { type: "kill_process", requestId, pid, signal }, requestId, 10_000);
  if (!result) { res.status(504).json({ error: "timeout" }); return; }
  res.json(result);
});

router.get("/local-agent/screenshot", async (req, res) => {
  const { agentId: reqAgentId } = req.query as { agentId?: string };
  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ error: "no local agent connected" }); return;
  }
  const requestId = `screenshot-${Date.now()}`;
  const result = await sendToAgent<{ ok: boolean; dataUri?: string; error?: string }>(
    agent.id, { type: "screenshot", requestId }, requestId, 20_000,
  );
  if (!result) { res.status(504).json({ error: "timeout" }); return; }
  res.json(result);
});

router.get("/local-agent/sysinfo", async (req, res) => {
  const { agentId: reqAgentId } = req.query as { agentId?: string };
  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.json({ agents: getConnectedAgentList(), connected: connectedAgents.size > 0 });
    return;
  }
  const requestId = `sysinfo-${Date.now()}`;
  const result = await sendToAgent(agent.id, { type: "sysinfo", requestId }, requestId, 10_000);
  if (!result) { res.json({ agents: getConnectedAgentList(), connected: true }); return; }
  res.json(result);
});

// ── Shared SSE exec handler (GET + POST) ─────────────────────────────────────
async function handleExecStream(
  agentId: string | undefined,
  command: string,
  timeoutMs: number,
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sseWrite = (data: unknown) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); (res as any).flush?.(); } catch { /* closed */ }
  };

  const agent = agentId ? connectedAgents.get(agentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    sseWrite({ type: "error", text: "لا يوجد وكيل كالي متصل — شغّل nova-agent.js على الجهاز المستهدف" });
    res.end();
    return;
  }

  auditLog({ ts: new Date().toISOString(), action: "exec_stream_start", data: { agentId: agent.id, command } });

  let closed = false;
  req.on?.("close", () => { closed = true; });

  const t0 = Date.now();
  const result = await execStreamOnLocalAgent(
    command,
    agent.id,
    timeoutMs,
    (streamType, data) => {
      if (closed) return;
      if (streamType === "stdout") sseWrite({ type: "stdout", text: data });
      else if (streamType === "stderr") sseWrite({ type: "stderr", text: data });
    },
  );

  if (!result) {
    if (!closed) sseWrite({ type: "error", text: "انتهت مهلة الأمر أو انقطع الوكيل — قد يكون الأمر لا يزال يعمل" });
    res.end();
    return;
  }

  if (result.stdout && !closed) sseWrite({ type: "stdout", text: result.stdout });
  if (result.stderr && !closed) sseWrite({ type: "stderr", text: result.stderr });
  if (!closed) sseWrite({ type: "done", exitCode: result.exitCode, durationMs: result.durationMs ?? (Date.now() - t0) });
  res.end();
}

// ── GET /local-agent/exec-stream ── SSE real-time streaming exec on Kali agent
router.get("/local-agent/exec-stream", async (req, res) => {
  const { agentId, command, timeout } = req.query as { agentId?: string; command?: string; timeout?: string };
  if (!command) { res.status(400).json({ error: "command required" }); return; }
  const timeoutMs = timeout ? Math.min(parseInt(timeout, 10), 600_000) : 60_000;
  await handleExecStream(agentId, command, timeoutMs, req, res);
});

// ── POST /local-agent/exec-stream ── same but via POST body (avoids URL limits)
router.post("/local-agent/exec-stream", async (req, res) => {
  const { agentId, command, timeout } = req.body as { agentId?: string; command?: string; timeout?: number };
  if (!command) { res.status(400).json({ error: "command required" }); return; }
  const timeoutMs = timeout ? Math.min(timeout, 600_000) : 60_000;
  await handleExecStream(agentId, command, timeoutMs, req, res);
});

// ── GET /local-agent/screen-stream ── SSE live screen streaming (on-demand) ──
router.get("/local-agent/screen-stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const { agentId: reqAgentId, fps } = req.query as { agentId?: string; fps?: string };
  const intervalMs = Math.max(500, Math.round(1000 / Math.min(parseFloat(fps || "1"), 5)));

  const agent = reqAgentId ? connectedAgents.get(reqAgentId) : [...connectedAgents.values()][0];
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    res.write(`data: ${JSON.stringify({ type: "error", text: "لا يوجد وكيل متصل" })}\n\n`);
    res.end();
    return;
  }

  let closed = false;
  req.on("close", () => { closed = true; });

  const captureFrame = async () => {
    if (closed) return;
    const requestId = `screen-${Date.now()}`;
    const result = await sendToAgent<{ ok: boolean; dataUri?: string; error?: string }>(
      agent.id, { type: "screenshot", requestId }, requestId, 8_000,
    );
    if (closed) return;
    if (result?.ok && result.dataUri) {
      try { res.write(`data: ${JSON.stringify({ type: "frame", dataUri: result.dataUri, ts: Date.now() })}\n\n`); (res as any).flush?.(); } catch { closed = true; }
    } else {
      try { res.write(`data: ${JSON.stringify({ type: "error", text: result?.error ?? "فشل التقاط الشاشة — تأكد من X11 display" })}\n\n`); (res as any).flush?.(); } catch { closed = true; }
    }
  };

  // Capture first frame immediately
  await captureFrame();

  const interval = setInterval(async () => {
    if (closed) { clearInterval(interval); res.end(); return; }
    await captureFrame();
  }, intervalMs);

  req.on("close", () => { clearInterval(interval); });
});

router.get("/local-agent/download-nova-agent", (_req, res) => {
  // The agent used to be looked up in three paths that never existed, so this
  // endpoint (and therefore "connect a computer") always answered 404.
  const agentPaths = [
    path.resolve(process.cwd(), "nova-agent.js"), // portable bundle / panel root
    path.resolve(process.cwd(), "public/nova-agent.js"),
    path.resolve(process.cwd(), "../../nova-agent.js"), // cwd = artifacts/api-server
    path.resolve(process.cwd(), "../nova-agent.js"),
    path.resolve("/opt/cybernova/nova-agent.js"),
    path.resolve("/home/runner/workspace/nova-agent.js"),
  ];
  for (const p of agentPaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf8");
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Content-Disposition", "attachment; filename=nova-agent.js");
        res.setHeader("Content-Length", Buffer.byteLength(content));
        res.send(content);
        return;
      } catch {
        res.status(500).json({ error: "failed to read nova-agent.js" });
        return;
      }
    }
  }
  res.status(404).json({ error: "nova-agent.js not found on server" });
});

router.get("/local-agent/download-agent", (req, res) => {
  const isHttps = req.protocol === "https" || req.get("x-forwarded-proto") === "https";
  const origin = `${isHttps ? "https" : "http"}://${req.get("host")}`;
  // Plain `ws://` on localhost/LAN, `wss://` only behind TLS — otherwise the
  // generated bootstrap silently fails to connect on a local install.
  const wsScheme = isHttps ? "wss" : "ws";
  const wsHost = `${wsScheme}://${req.get("host") || "localhost"}/api/local-agent/ws`;
  const platform = String(req.query.platform || "auto");

  // Windows / PowerShell variant
  if (platform === "windows" || platform === "ps1") {
    const ps = `# CyberNova NOVA-Agent bootstrap (Windows PowerShell)
$ErrorActionPreference = "Stop"
$Server = "${wsHost}"
$AgentFile = Join-Path $env:TEMP "nova-agent.js"
Write-Host "[nova] downloading agent..."
Invoke-WebRequest -UseBasicParsing "${origin}/api/local-agent/download-nova-agent" -OutFile $AgentFile
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[nova] Node.js غير منصّب. نزّله من https://nodejs.org ثم أعد تشغيل السكربت." -ForegroundColor Yellow
  exit 1
}
Write-Host "[nova] connecting to $Server"
node $AgentFile --server $Server $args
`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=nova-agent.ps1");
    res.send(ps);
    return;
  }

  const fallback = `#!/usr/bin/env bash
# CyberNova Nova-Agent bootstrap
set -e
SERVER_URL="${wsHost}"
AGENT_FILE="/tmp/nova-agent.js"
echo "[nova] Downloading nova-agent.js..."
if ! command -v curl >/dev/null 2>&1; then
  echo "[nova] curl غير موجود — نصّبه: apt install -y curl" >&2
  exit 1
fi
curl -fsSL "${origin}/api/local-agent/download-nova-agent" -o "$AGENT_FILE"
if ! head -c 20 "$AGENT_FILE" | grep -q "node"; then
  echo "[nova] فشل تنزيل الوكيل من السيرفر (تحقق من الرابط)" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[nova] Node.js غير منصّب — نصّبه أولاً:" >&2
  echo "        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs" >&2
  exit 1
fi
echo "[nova] Connecting to $SERVER_URL"
exec node "$AGENT_FILE" --server "$SERVER_URL" "$@"
`;
  res.setHeader("Content-Type", "application/x-sh");
  res.setHeader("Content-Disposition", "attachment; filename=kali-agent.sh");
  res.send(fallback);
});

// ── GET /local-agent/download-project-zip ── Download full project as tar.gz ─
router.get("/local-agent/download-project-zip", (req, res) => {
  const { spawn: spawnChild } = require("child_process") as typeof import("child_process");
  const workspaceRoot = "/home/runner/workspace";
  const filename = `cybernova-src-${new Date().toISOString().slice(0, 10)}.tar.gz`;

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.setHeader("X-Accel-Buffering", "no");

  // Exclude node_modules, dist, .git, pino-* internal files
  const tar = spawnChild("tar", [
    "czf", "-",
    "--exclude=*/node_modules",
    "--exclude=*/dist",
    "--exclude=*/.git",
    "--exclude=*/.local",
    "--exclude=*/pino-*",
    "--exclude=*/*.map",
    "-C", workspaceRoot,
    "artifacts/api-server/src",
    "artifacts/cybernova-app/src",
    "nova-agent.js",
    "replit.md",
    "package.json",
    "pnpm-workspace.yaml",
  ], { cwd: workspaceRoot });

  tar.stdout.pipe(res);
  tar.stderr.on("data", (d: Buffer) => logger.warn({ msg: d.toString() }, "tar stderr"));
  tar.on("error", (err: Error) => {
    logger.error({ err }, "tar spawn error");
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
  tar.on("close", (code: number | null) => {
    if (code !== 0) logger.warn({ code }, "tar exited non-zero");
    res.end();
  });
  req.on("close", () => { try { tar.kill(); } catch {} });
});

// ── GET /local-agent/connect-info ── Returns the WSS URL for nova-agent.js ──
router.get("/local-agent/connect-info", (req, res) => {
  const domains = process.env["REPLIT_DOMAINS"];
  const primaryDomain = domains
    ? domains.split(",")[0].trim()
    : req.get("host") || "localhost";

  const isSecure = req.get("x-forwarded-proto") === "https" || primaryDomain !== "localhost";
  const wsUrl = `wss://${primaryDomain}/api/local-agent/ws`;
  // Use the actual download endpoint (not /nova-agent.js which isn't routed)
  const agentUrl = `https://${primaryDomain}/api/local-agent/download-nova-agent`;
  const oneLineBash = `curl -sL "${agentUrl}" -o /tmp/nova-agent.js && node /tmp/nova-agent.js --server "${wsUrl}" --reconnect`;
  const oneLineWget = `wget -q "${agentUrl}" -O /tmp/nova-agent.js && node /tmp/nova-agent.js --server "${wsUrl}" --reconnect`;
  const pm2Cmd = `npm i -g pm2 2>/dev/null; pm2 start /tmp/nova-agent.js -- --server "${wsUrl}" --reconnect && pm2 save`;

  res.json({
    wsUrl,
    agentUrl,
    primaryDomain,
    isSecure,
    agentCount: connectedAgents.size,
    connected: connectedAgents.size > 0,
    agents: getConnectedAgentList(),
    oneLineBash,
    oneLineWget,
    pm2Cmd,
    manualCmd: `node /tmp/nova-agent.js --server "${wsUrl}" --reconnect`,
  });
});

export default router;
