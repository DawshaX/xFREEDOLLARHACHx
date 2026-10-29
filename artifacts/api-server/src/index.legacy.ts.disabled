import { config as loadEnv } from "dotenv";
loadEnv({ override: true });
import http from "http";
import { WebSocketServer } from "ws";
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

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// ── HTTP server wrapping Express ───────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket server for /api/local-agent/ws (Kali machine agent) ─────────────
const localAgentWss = new WebSocketServer({ noServer: true });
initLocalAgentWss(localAgentWss);

// Route WebSocket upgrade requests by path
server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (url === "/api/local-agent/ws" || url.startsWith("/api/local-agent/ws?")) {
    localAgentWss.handleUpgrade(req, socket, head, (ws) => {
      localAgentWss.emit("connection", ws, req);
    });
  } else {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  }
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");

  forceOllamaDefault().catch(e => logger.error({ err: e }, "forceOllamaDefault error"));
  runCveMigrations().catch(e => logger.error({ err: e }, "CVE migrations error"));
  runSentinelMigrations().catch(e => logger.error({ err: e }, "SENTINEL migrations error"));

  try { startScheduler(); } catch (e) { logger.error({ err: e }, "Failed to start cron scheduler"); }
  try { startWatchdog(); } catch (e) { logger.error({ err: e }, "Failed to start watchdog"); }
  try { startKeyManagerLoop(); } catch (e) { logger.error({ err: e }, "Failed to start key manager"); }
  try { startCveMonitor(); } catch (e) { logger.error({ err: e }, "Failed to start CVE monitor"); }

  scheduleGC();

  logger.info("WebSocket agent endpoint: wss://<domain>/api/local-agent/ws");
});

server.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});
