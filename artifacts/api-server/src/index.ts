import { config as loadEnv } from "dotenv";
loadEnv({ override: true });
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/cron-scheduler";
import { startCronScheduler } from "./lib/nova-cron";
import { startWatchers } from "./lib/agent/watchers";
import { startWatchdog } from "./lib/watchdog";
import { startKeyManagerLoop } from "./lib/key-manager";
import { startCveMonitor } from "./lib/cve-monitor";
import { runCveMigrations } from "./lib/migrate-cves";
import { runSentinelMigrations } from "./lib/migrate-sentinel";
import { scheduleGC } from "./lib/gc-scheduler";
import { forceOllamaDefault } from "./lib/ai";
import { initLocalAgentWss, registerEmbeddedAgent } from "./routes/local-agent";
import { wsUpgradeAllowed } from "./lib/ops/gate";
import {
  registerHubClient,
  removeHubClient,
  broadcastEvent,
  getHubClientCount,
} from "./lib/ws-hub";
import { getMemoryCount, saveMemory } from "./routes/memory";
import { broadcastLiveEvent } from "./routes/live-events";
import { runAgent } from "./lib/agent/core";
import type { AgentEvent } from "./lib/agent/core";
import { bootToolchainFetch, toolchainStatus } from "./lib/ops/toolchain";
import { startAutonomousBackgroundDaemon } from "./lib/autonomous-daemon";
import { provisionOnBoot } from "./lib/ops/keys-source";
import { provisionCorpus, corpusStatus } from "./lib/ops/vuln-corpus";

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
/**
 * A bad PORT must not take the whole server down.
 *
 * Measured 2026-11-04 on a real bundle: an env file contained the literal text
 * `${PORT:-8080}` (written by a bootstrap script instead of being expanded), the
 * process threw `Invalid PORT value` at import time, and the box answered
 * nothing at all — not even a health check that could have explained it. A
 * hosting panel assigns the port anyway, so the honest behaviour is: use it if
 * it is a number, otherwise fall back to 8080 and say so loudly.
 */
const parsedPort = Number(rawPort);
const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 8080;
const portWasInvalid = port !== parsedPort;

// ── HTTP server wrapping Express ───────────────────────────────────────────────
function provisionDelayMs(): number {
  const raw = Number(process.env.NOVA_PROVISION_DELAY_MS ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : 90_000;
}

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
        if (!content.trim()) {
          ws.send(JSON.stringify({ type: "chat_error", requestId, message: "اكتب رسالة أولاً." }));
          return;
        }
        const sessionId = String(msg.sessionId || `ws-${Date.now()}`);
        const history = Array.isArray(msg.history)
          ? msg.history
              .filter((entry): entry is { role: "user" | "assistant"; content: string } =>
                Boolean(entry) &&
                typeof entry === "object" &&
                ((entry as Record<string, unknown>).role === "user" || (entry as Record<string, unknown>).role === "assistant") &&
                typeof (entry as Record<string, unknown>).content === "string",
              )
              .slice(-8)
              .map((entry) => ({ role: entry.role, content: entry.content.slice(-1200) }))
          : [];
        const sendAgentEvent = (event: AgentEvent) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          switch (event.type) {
            case "delta":
              ws.send(JSON.stringify({ type: "chat_delta", requestId, text: event.text }));
              break;
            case "tool_call":
              ws.send(JSON.stringify({
                type: "chat_tool_call",
                requestId,
                id: event.id,
                name: event.title,
                input: event.args,
                risk: event.risk,
              }));
              break;
            case "tool_result":
              ws.send(JSON.stringify({
                type: "chat_tool_result",
                requestId,
                toolCallId: event.id,
                result: event.summary,
                isError: !event.ok,
              }));
              break;
            case "confirm_required":
              ws.send(JSON.stringify({
                type: "chat_tool_result",
                requestId,
                toolCallId: event.id,
                result: `${event.reason} لم يتم التنفيذ؛ الموافقة غير متاحة من هذه المحادثة حاليًا.`,
                isError: false,
                confirmationRequired: true,
              }));
              break;
            case "error":
              ws.send(JSON.stringify({ type: "chat_error", requestId, message: event.message }));
              break;
            case "done":
              ws.send(JSON.stringify({
                type: "chat_done",
                requestId,
                toolCount: event.toolCount,
                mode: event.mode,
                ts: Date.now(),
              }));
              break;
          }
        };
        try {
          await runAgent({
            message: content,
            sessionId,
            history,
            maxSteps: 5,
            // `approved: []` هو اللي بيقفل الأدوات الحساسة/النشطة من جوّه الشات:
            // مافيش مسار في main بيقبل علم «موافقة» يجي من العميل، فالموافقة
            // المحلّية (`requireApprovalForActive`) مبقاش ليها لازمة — القفل افتراضي.
            approved: [],
            emit: sendAgentEvent,
          });
        } catch (error) {
          logger.error({ err: error, sessionId }, "floating NOVA chat failed");
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "chat_error",
              requestId,
              message: error instanceof Error ? error.message : String(error),
            }));
          }
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
    // Registering an agent hands whoever connects a command channel into the
    // fleet, so the handshake itself must be authenticated.
    const gate = wsUpgradeAllowed(url, req);
    if (!gate.ok) {
      logger.warn({ reason: gate.reason }, "local-agent ws upgrade refused");
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
          `X-NOVA-Reason: ${gate.reason.replace(/[^\x20-\x7e]/g, "")}\r\n` +
          "Connection: close\r\n\r\n",
      );
      socket.destroy();
      return;
    }
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

// ── self-provisioning: keys on our own host + passive scope, then listen ────
// Awaited on purpose: the first /api/nova-core/chat should already see the
// providers the key source supplied. A failure here is non-fatal by design.
await provisionOnBoot();

// The vulnerability corpus: a fresh deploy should be able to answer "which CVEs
// hit nginx 1.24" on the first request, not after someone SSHes in and runs a
// 25-minute ingest. Downloads the published release asset when the disk is empty.
// Non-fatal, and it says out loud which of the three outcomes happened.
void provisionCorpus()
  .then((r) => logger.info({ action: r.action, bytes: r.bytes, total: r.total }, `corpus: ${r.says_ar}`))
  .catch((err) => logger.warn({ err }, "corpus provisioning threw — serving without a corpus"));
// أدوات المحرك نفسها: على الاستضافة المصانة مافيش root ولا apt، فالنسخ الثابتة
// من ProjectDiscovery هي الطريق الوحيد لـ«أدوات حقيقية». على مكنة مُشرَفة ده
// بقى auto افتراضيًا (طلب 2026-11-07: «كل الأدوات اللي هتكون عندنا») — بس بعد ما
// نقيس القرص الحر: ~100MB على حاوية 512MB مع corpus منزّل للتو كان ممكن يقطع
// الظهر، فالحارس في bootToolchainFetch. للطيّ الكامل: NOVA_TOOLCHAIN_FETCH=0.
const toolchainAtBoot = toolchainStatus();
console.log(
  toolchainAtBoot.present.length
    ? `✓ tools: ${toolchainAtBoot.present.join(", ")} @ ${toolchainAtBoot.dir}`
    : `· tools: مافيش في ${toolchainAtBoot.dir} — NOVA_TOOLCHAIN_FETCH=1 بينزّلهم، أو POST /api/ops/tools/provision من الشات`,
);
bootToolchainFetch((m) => logger.info(m));

// ── Embedded self-node (added 2026-11-06) ────────────────────────────────────
// The fleet used to be empty until a human set NOVA_EXEC_TOKEN and ran
// nova-agent.js on a machine. That is correct security, but it left the platform
// with zero execution plane out of the box. Registering the server process
// itself as a node gives the fleet a real machine immediately — measured
// capabilities, real command execution, no new network surface, no gate bypass.
// Disable with NOVA_SELF_NODE=0.
try {
  const selfNodeId = registerEmbeddedAgent();
  if (selfNodeId) {
    console.log(`✓ self-node: ${selfNodeId} registered (fleet has a real execution plane)`);
  } else {
    console.log("· self-node: disabled (NOVA_SELF_NODE=0)");
  }
} catch (e) {
  logger.warn({ e }, "self-node registration failed — fleet stays empty until a remote agent connects");
}

const corpusAtBoot = corpusStatus();
if (corpusAtBoot.measured) {
  console.log(`✓ corpus: ${corpusAtBoot.total} CVEs (${corpusAtBoot.kev} KEV) @ ${corpusAtBoot.at}`);
} else {
  console.log("· corpus: not ingested yet — /api/ops/corpus will say so instead of printing 0 CVEs");
}

if (portWasInvalid) {
  logger.warn(
    { rawPort, port },
    `PORT is not a number ("${rawPort}") — using ${port}. Fix the env file: a literal \${PORT:-8080} means it was written, not expanded.`,
  );
  console.log(`! PORT="${rawPort}" is not a number — falling back to ${port}`);
}

server.listen(port, host, () => {
  logger.info({ port, host }, `Server listening on ${host} (HTTP + /api/ws + /api/local-agent/ws)`);
  // تليجرام: إشعار الإقلاع + تعلّم chat_id من أول /start لو مش محفوظ.
  // معزول بالكامل — لو تليجرام مش مفعّل أو واقِع، السيرفر ما بيحسش.
  void import("./lib/ops/telegram").then(({ ensureChatId, notifyBoot }) => {
    ensureChatId();
    void notifyBoot(String(process.env.NOVA_BUILD_SHA || process.env.KALI_BUILD_SHA || "dev").slice(0, 12));
  }).catch(() => { /* telegram رفاهية */ });
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

  // ── self-update watcher (pull model) ──────────────────────────────────────
  // Enabled by default inside the portable bundle; NOVA_AUTO_UPDATE=0 turns it
  // off. It only ever installs a strictly newer published release.
  void import("./lib/auto-update")
    .then(({ startAutoUpdate, autoUpdateStatus }) => {
      startAutoUpdate();
      const st = autoUpdateStatus();
      logger.info({ enabled: st.enabled, everyMin: st.intervalMinutes }, "NOVA self-update watcher");
    })
    .catch((e) => logger.warn({ err: e }, "self-update watcher failed to start"));

  if (process.env.NOVA_AUTOPULL !== "0") {
    void import("./lib/agent/ollama-manager")
      .then(({ ensureOllamaReady }) => ensureOllamaReady())
      .then((r) => logger.info({ ready: r.ready, model: r.activeModel, pulled: r.pulled, msg: r.message }, "NOVA local model check"))
      .catch((e) => logger.warn({ err: e }, "NOVA local model check failed"));
  }

  // Durable memory first: a free host throws the filesystem away on every
  // deploy, and the agent's memory is the one thing that must survive it. On a
  // supervised box this runs keyless through the nova-state edge function (the
  // service key lives in Supabase, never here); with NOVA_SUPABASE_SERVICE_KEY
  // set it talks to REST directly. Unsupervised with no env → zero calls.
  // Either way the mirror is reconciled at boot: empty disk pulls, empty row
  // pushes, so a box that already remembers something does not wait for its
  // next write to get a copy in the database.
  void import("./lib/agent/memory-store")
    .then(({ hydrateMemoryFromMirror, mirrorStatus }) =>
      hydrateMemoryFromMirror().then((r) => {
        const status = mirrorStatus();
        if (!status.on) return;
        logger.info(
          {
            hydrated: r.hydrated,
            bootstrapped: Boolean(r.bootstrapped),
            records: r.records,
            row: status.row,
            via: status.via,
            state: status.state,
            error: status.error,
          },
          r.hydrated
            ? "memory: restored from the durable mirror (this box had no file)"
            : r.bootstrapped
              ? "memory: the durable row was empty — pushed the local copy up"
              : "memory: mirror already has this copy — writes will keep it fresh",
        );
      }),
    )
    .catch((e) => logger.warn({ err: e }, "memory mirror hydrate failed"));

  // ── إقلاع ما يعتمدش على قاعدة البيانات ─────────────────────────────────────
  // المرحلة 59 أضافت `startCronScheduler()` و`startWatchers()` — وحطّتهم جوه
  // فرع `if (process.env.DATABASE_URL)`. القياس الحيّ على nova.waifly.com (وضع
  // standalone، من غير DATABASE_URL) كشف إن `GET /api/nova-core/watch` بيرجع
  // enabled:false وstartedAt:null: أي إن الصوت الدائم اتكتب وما اشتغلش على المكنة
  // اللي المفروض تعيش عليه. الاتنين ما بيلمسوش Postgres أصلًا — فمكانهم هنا.
  if (process.env.NOVA_CRON_ENABLED !== "0") {
    try { startCronScheduler(); } catch (e) { logger.error({ err: e }, "nova-cron start failed"); }
  } else {
    logger.info("nova-cron: متعطّل بـ NOVA_CRON_ENABLED=0");
  }
  try { startWatchers(); } catch (e) { logger.error({ err: e }, "watchers start failed"); }

  // الأدوات: القياس الحيّ على nova.waifly.com قال `vendor/bin` فاضي و**قابل للكتابة**
  // — أي إن `tools_install` ممكن ينزّل subfinder/httpx/nuclei/katana/dnsx/naabu/ffuf
  // بجد، بس مفيش حد كان بيناديه غير المستخدم في الشات. الإقلاع بقى يطلبها مرة واحدة،
  // متأخر، ودالة `provisionToolchainOnce` نفسها فيها already-present + cooldown + inflight
  // guard فمش هتتكرر. `NOVA_PROVISION_TOOLS=0` يطفّيها.
  if (process.env.NOVA_PROVISION_TOOLS !== "0") {
    setTimeout(() => {
      void import("./lib/ops/toolchain")
        .then(({ provisionToolchainOnce }) => provisionToolchainOnce())
        .then(({ skipped, record, status }) =>
          logger.info(
            {
              skipped: skipped ?? null,
              installed: record?.installed ?? null,
              present: status.present.length,
              missing: status.missing.length,
              refused: record?.refused ?? null,
              freeMB: status.freeMB,
              fetchAllowed: process.env.NOVA_TOOLCHAIN_FETCH === "1",
            },
            record?.refused
              ? `toolchain: provisioning refused at boot — ${record.reasonAr}`
              : record
                ? `toolchain: provisioning ran at boot (${record.installed}/${record.total} أداة)`
                : `toolchain: provisioning skipped at boot (${skipped ?? "بدون سبب"}) — التنزيل نفسه محتاج NOVA_TOOLCHAIN_FETCH=1`,
          ),
        )
        .catch((e) => logger.warn({ err: String(e) }, "toolchain boot provisioning failed"));
    }, provisionDelayMs());
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

  // 2026-11-08: الافتراضي اتقلب بعد طلب المشغّل صراحةً — اللايف أجينت «متصل دايمًا
  // بالخلفية وشغّال دايمًا». الدايمن بيبدأ مع الإقلاع على عمق passive: مراقبة
  // ومصادر عامة (DNS/CT-logs/OSINT) بلا أي لمس للخدمات، وبرامج passive_only
  // متترفعش أبدًا، وكل مرفوض/متخطّى بيتسجّل في دفتر صريح. نبضة كل 3 دقايق —
  // خفيفة على كوتا الـCPU. الإيقاف الكامل: NOVA_AUTONOMOUS_DAEMON=0 في البيئة،
  // أو تقليل العمق لـoff من لوحة التحكم (بيتخزّن في state/autonomy.json).
  if (process.env.NOVA_AUTONOMOUS_DAEMON !== "0") {
    try {
      startAutonomousBackgroundDaemon();
      logger.info("Autonomous background daemon started (default-on · passive depth · NOVA_AUTONOMOUS_DAEMON=0 يعطّله)");
    } catch (e) {
      logger.error({ err: e }, "Failed to start autonomous background daemon");
    }
  } else {
    logger.info("Autonomous background daemon disabled by NOVA_AUTONOMOUS_DAEMON=0");
  }

  scheduleGC();
});

server.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});
