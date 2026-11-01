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
import { startAutonomousBackgroundDaemon } from "./lib/autonomous-daemon";

process.on("unhandledRejection", (reason) => {
  logger.warn({ reason }, "Unhandled promise rejection caught safely (standalone mode)");
});

process.on("uncaughtException", (err) => {
  logger.warn({ err }, "Uncaught exception caught safely (standalone mode)");
});

// PORT first, then the names other free hosts use for the same thing:
// SERVER_PORT (Silly Development / Pterodactyl panels), APP_PORT, WEB_PORT.
const rawPort =
  process.env["PORT"] ||
  process.env["SERVER_PORT"] ||
  process.env["APP_PORT"] ||
  process.env["WEB_PORT"] ||
  "8080";
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

/**
 * One upgrade router shared by every listener, so an extra port behaves
 * exactly like the primary one (some panel proxies forward to a different
 * port than the one the app was told to use).
 */
function routeUpgrade(req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
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
}

// Route WebSocket upgrade requests by path
server.on("upgrade", routeUpgrade);

/**
 * Where to bind.
 *
 * Defaulting to 127.0.0.1 was silently fatal on panel hosts (Pterodactyl /
 * Waifly / Silly): the egg runs `node .` without HOST, the process listened on
 * loopback *inside* the container, and the platform's nginx could not reach it
 * → a permanent 502 Bad Gateway with a perfectly healthy process.
 *
 * Rule: an explicit HOST always wins; otherwise anything that looks like a
 * hosting environment gets 0.0.0.0, and a plain local `pnpm dev` stays private.
 */
const hostingPortVar = ["SERVER_PORT", "APP_PORT", "WEB_PORT"].find((k) => process.env[k]);
const host =
  process.env.HOST?.trim() ||
  (hostingPortVar || process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
if (host === "127.0.0.1" && process.env.PORT && process.env.NODE_ENV !== "production") {
  logger.warn(
    "Binding to 127.0.0.1 — reachable from this machine only. Set HOST=0.0.0.0 to expose it (required on panel hosts).",
  );
}

server.on("error", (err: NodeJS.ErrnoException) => {
  // The most common panel failure: the platform gave us a port we cannot bind.
  logger.error({ err, port, host }, `Cannot listen on ${host}:${port} — ${err.code ?? err.message}`);
  console.error(`\n✗ Cannot listen on ${host}:${port} — ${err.code ?? err.message}\n`);
  process.exit(1);
});

server.listen(port, host, () => {
  logger.info({ port, host }, `Server listening on ${host} (HTTP + /api/ws + /api/local-agent/ws)`);
  // Plain line too: panel consoles (Pterodactyl) sometimes swallow JSON logs,
  // which made a perfectly healthy process look dead.
  console.log(`✓ NOVA listening on http://${host}:${port} — open /self-check`);

  /**
   * Extra listeners.
   *
   * Some panel proxies (Pterodactyl eggs behind a shared nginx, Waifly web
   * proxies) forward to a port different from the one they advertised. Rather
   * than guessing, NOVA_EXTRA_PORTS lets the same app answer on several ports;
   * a port that is taken only produces a warning, never a crash.
   */
  const extraPorts = String(process.env.NOVA_EXTRA_PORTS || "")
    .split(/[,\s]+/)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536 && n !== port);
  for (const extraPort of new Set(extraPorts)) {
    const extraServer = http.createServer(app);
    extraServer.on("upgrade", routeUpgrade);
    extraServer.on("error", (err: NodeJS.ErrnoException) => {
      logger.warn({ port: extraPort, code: err.code }, `extra port ${extraPort} unavailable (${err.code ?? err.message})`);
    });
    extraServer.listen(extraPort, host, () => {
      console.log(`✓ NOVA also listening on http://${host}:${extraPort}`);
    });
  }

  // ── NOVA boot sequence (never blocks the listener) ────────────────────────
  void import("./lib/agent/memory-store")
    .then(({ initMemory, memoryStats }) => {
      initMemory();
      const st = memoryStats();
      logger.info({ total: st.total, file: st.file, bytes: st.bytes }, "NOVA long-term memory loaded");
    })
    .catch((e) => logger.warn({ err: e }, "NOVA memory init failed"));

  if (process.env.NOVA_AUTOPULL !== "0") {
    void import("./lib/agent/ollama-manager")
      .then(({ ensureOllamaReady }) => ensureOllamaReady())
      .then((r) => logger.info({ ready: r.ready, model: r.activeModel, pulled: r.pulled, msg: r.message }, "NOVA local model check"))
      .catch((e) => logger.warn({ err: e }, "NOVA local model check failed"));
  }

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

  try {
    startAutonomousBackgroundDaemon();
    logger.info("24/7 Autonomous Background Daemon & Cloud Brain State initialized");
  } catch (e) {
    logger.error({ err: e }, "Failed to start autonomous background daemon");
  }

  scheduleGC();
});

server.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});
