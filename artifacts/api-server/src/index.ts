import { config as loadEnv } from "dotenv";
loadEnv({ override: true });
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/cron-scheduler";
import { startWatchdog } from "./lib/watchdog";
import { startKeyManagerLoop } from "./lib/key-manager";
import { startCveMonitor } from "./lib/cve-monitor";
import { runCveMigrations } from "./lib/migrate-cves";
import { runSentinelMigrations } from "./lib/migrate-sentinel";
import { scheduleGC } from "./lib/gc-scheduler";
import { forceOllamaDefault } from "./lib/ai";
import { initLocalAgentWss } from "./routes/local-agent";
import {
  registerHubClient,
  removeHubClient,
  broadcastEvent,
  getHubClientCount,
} from "./lib/ws-hub";
import { getAllMemories, getMemoryCount, saveMemory } from "./routes/memory";
import { broadcastLiveEvent } from "./routes/live-events";
import { buildIntelligentSecurityReply } from "./routes/ollama-proxy";

process.on("unhandledRejection", (reason) => {
  logger.warn({ reason }, "Unhandled promise rejection caught safely (standalone mode)");
});

process.on("uncaughtException", (err) => {
  logger.warn({ err }, "Uncaught exception caught safely (standalone mode)");
});

const rawPort = process.env["PORT"] || "8080";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// ── HTTP server wrapping Express ───────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket server for /api/local-agent/ws (Kali machine agent) ─────────────
const localAgentWss = new WebSocketServer({ noServer: true });
initLocalAgentWss(localAgentWss);

// ── WebSocket server for /api/ws (Internal Platform Hub: Agents, Notes, Studio) ─
const hubWss = new WebSocketServer({ noServer: true });

hubWss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  const urlObj = new URL(req.url ?? "/api/ws", "http://127.0.0.1");
  const sessionId = urlObj.searchParams.get("sessionId") || `ws-${Date.now()}`;
  registerHubClient(ws, sessionId);

  try {
    ws.send(
      JSON.stringify({
        type: "connected",
        sessionId,
        hubClients: getHubClientCount(),
        memoriesCount: getMemoryCount(),
        ts: Date.now(),
      }),
    );
  } catch {
    // ignore
  }

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      const type = String(msg.type || "");

      if (type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        return;
      }

      if (type === "chat_send") {
        const requestId = String(msg.requestId || `req_${Date.now()}`);
        const content = String(msg.content || "");
        const toolCallId = `tc_${Date.now()}`;

        ws.send(
          JSON.stringify({
            type: "chat_tool_call",
            requestId,
            id: toolCallId,
            name: "memory_and_target_sync",
            input: { query: content.slice(0, 120), memoriesLoaded: getMemoryCount() },
          }),
        );

        const memories = getAllMemories().slice(0, 5);
        ws.send(
          JSON.stringify({
            type: "chat_tool_result",
            requestId,
            toolCallId,
            result: JSON.stringify(
              {
                synced: true,
                activeMemories: memories.map((m) => ({ title: m.title, kind: m.kind })),
              },
              null,
              2,
            ),
            isError: false,
          }),
        );

        const reply = buildIntelligentSecurityReply([{ role: "user", content }]);
        const chunks = reply.match(/.{1,24}/gs) ?? [reply];
        for (const chunk of chunks) {
          if (ws.readyState !== WebSocket.OPEN) break;
          ws.send(JSON.stringify({ type: "chat_delta", requestId, text: chunk }));
          await new Promise((r) => setTimeout(r, 14));
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "chat_done", requestId, ts: Date.now() }));
        }
        return;
      }

      // Broadcast and record platform-wide events (BugBountyStudio, Scanners, Notes, Missions)
      if (
        type === "platform_event" ||
        type === "target_selected" ||
        type === "finding_recorded" ||
        type === "code_audit_run" ||
        type === "recon_cmd_executed" ||
        type === "note_added"
      ) {
        const title = String(msg.title || msg.target || type);
        const detail = String(msg.detail || msg.content || JSON.stringify(msg));
        if (msg.saveToMemory !== false) {
          saveMemory(
            String(msg.kind || "project"),
            title,
            detail,
            String(msg.tags || `ws,${type}`),
            Number(msg.importance || 7),
            Boolean(msg.pinned),
          );
        }
        const payload = {
          ...msg,
          type,
          sessionId,
          ts: Date.now(),
        };
        broadcastEvent(payload);
        broadcastLiveEvent({
          type: "thinking",
          data: { message: `[${type}] ${title}: ${detail.slice(0, 140)}`, ts: Date.now() },
          ts: new Date().toISOString(),
        });
        return;
      }

      // Default broadcast for any other custom message
      broadcastEvent({ ...msg, sessionId, ts: Date.now() });
    } catch {
      // ignore malformed ws frame
    }
  });

  ws.on("close", () => {
    removeHubClient(ws);
  });
});

// Route WebSocket upgrade requests by path
server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (url === "/api/local-agent/ws" || url.startsWith("/api/local-agent/ws?")) {
    localAgentWss.handleUpgrade(req, socket, head, (ws) => {
      localAgentWss.emit("connection", ws, req);
    });
  } else if (
    url === "/api/ws" ||
    url.startsWith("/api/ws?") ||
    url === "/ws" ||
    url.startsWith("/ws?")
  ) {
    hubWss.handleUpgrade(req, socket, head, (ws) => {
      hubWss.emit("connection", ws, req);
    });
  } else {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  }
});

server.listen(port, "127.0.0.1", () => {
  logger.info({ port }, "Server listening on 127.0.0.1 (HTTP + /api/ws + /api/local-agent/ws)");

  if (process.env.DATABASE_URL) {
    forceOllamaDefault().catch(e => logger.error({ err: e }, "forceOllamaDefault error"));
    runCveMigrations().catch(e => logger.error({ err: e }, "CVE migrations error"));
    runSentinelMigrations().catch(e => logger.error({ err: e }, "SENTINEL migrations error"));

    try { startScheduler(); } catch (e) { logger.error({ err: e }, "Failed to start cron scheduler"); }
    try { startWatchdog(); } catch (e) { logger.error({ err: e }, "Failed to start watchdog"); }
    try { startKeyManagerLoop(); } catch (e) { logger.error({ err: e }, "Failed to start key manager"); }
    try { startCveMonitor(); } catch (e) { logger.error({ err: e }, "Failed to start CVE monitor"); }
  } else {
    logger.info("Running in standalone mode (no DATABASE_URL configured)");
  }

  scheduleGC();
});

server.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});
