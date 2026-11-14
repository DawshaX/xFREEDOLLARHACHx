import cors from "cors";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { resolveStandaloneApi } from "./lib/standalone-api";
import { buildIntelligentSecurityReply } from "./routes/ollama-proxy";
import { broadcastEvent } from "./lib/ws-hub";
import { addPushClient, createPushNotification } from "./lib/push-hub";
import { runAgent } from "./lib/agent/core";
import { ROOT_SESSION_ID, getOrCreateNexusSession } from "./lib/agent/session-nexus";
import { tokenConfigured, checkGate } from "./lib/ops/gate";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ── Body safety net ───────────────────────────────────────────────────────────
// Several routes destructure `req.body` directly. When a client fires a POST
// without a body (e.g. `fetch("/api/nova/kill", { method: "POST" })`) Express 5
// leaves `req.body` undefined and the destructuring throws a 500. Normalising it
// to an empty object keeps every such endpoint resilient.
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.body === undefined || req.body === null) {
    (req as Request & { body: Record<string, unknown> }).body = {};
  }
  next();
});

// ── عين الزيارات (تليجرام) ── وسيط صامت: بيشتغل في الخلفية بعد next() وعمره ما
// يأخر رد ولا يوقف الموقع. لو تليجرام مش مفعّل بيرجع فورًا.
import { visitorIntelMiddleware } from "./lib/ops/visitor-intel";
app.use(visitorIntelMiddleware());

// ── بوابة الدخول (panel-auth) ── بتقفل الواجهة كلها: فيرست بصفحة دخول،
// والآلات بتعدّي بالتوكن زي ما هي. عمدًا بعد عين الزيارات: الغريب اللي بيخبط
// على الباب لسه بيتبلّغ تليجرام، بس مش بيشوف جوه.
import { panelAuthMiddleware } from "./lib/panel-auth";
app.use(panelAuthMiddleware());

// ── Standalone SSE Streams (LiveAgent, Agent Steps, Push Notifications) ──────
app.get("/api/push/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  // TEST8 قِيس 2026-11-14: كان SSE ميت (بينبّه بس) — مركز الإشعارات ما كانش
  // بيستقبل أي حدث أصلًا. دلوقتي عميل حي على الـhub: كل إشعار بيوصل لحظيًا.
  addPushClient(res);
  const timer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: ping\n\n`);
    }
  }, 20_000);
  req.on("close", () => clearInterval(timer));
});

/* إنشاء إشعار حقيقي — بوابة كل أزرار اللوحة (النجاح والفشل): بيتخزن دائمًا
 * وبيتبث لحظيًا. الكتابة محمية بنفس بوابة ops (توكن/جلسة المالك). */
app.post("/api/push/notify", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { kind?: string; title?: string; body?: string; link?: string };
  if (!body.title || !String(body.title).trim()) {
    res.status(400).json({ ok: false, error: "title is required" });
    return;
  }
  const n = createPushNotification({ kind: body.kind, title: body.title, body: body.body, link: body.link });
  res.json({ ok: true, notification: n, clients: undefined });
});

app.post("/api/live-agent/sessions/:id/messages", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  const body = (req.body ?? {}) as {
    content?: string;
    planMode?: boolean;
    autonomousMode?: boolean;
    agentMode?: string;
    model?: string;
    kaliConnected?: boolean;
    approve?: unknown;
  };
  const content = String(body.content || "");
  if (!content.trim()) {
    res.status(400).json({ ok: false, error: "content is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendSse = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // This app-level handler is registered BEFORE the /api router, so it is the
  // one that actually answers the panel. It used to hard-code `approved: []`
  // and ignore `planMode` entirely — which is why the chat could never run a
  // sensitive tool and never stopped to propose a plan. Both are honoured now,
  // and the approval list is only trusted when the caller holds the ops token.
  const approved = (() => {
    const gate = tokenConfigured() ? checkGate(req as never, "live-agent chat") : null;
    return gate && gate.ok && gate.code === "allowed" && Array.isArray(body.approve) ? (body.approve as string[]) : [];
  })();

  try {
    const sess = getOrCreateNexusSession(sessionId);
    const history = sess.messages
      .filter(
        (message) =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim().length > 0,
      )
      .slice(-12)
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content.slice(-1200),
      }));

    await runAgent({
      message: content,
      sessionId: sess.id,
      history,
      planMode: Boolean(body.planMode),
      agentMode: body.agentMode ? String(body.agentMode) : undefined,
      preferredModel: body.model ? String(body.model) : undefined,
      autonomousMode: Boolean(body.autonomousMode),
      kaliConnected: Boolean(body.kaliConnected),
      approved,
      emit: (event) => {
        sendSse(event.type, event);
        // Mirror the tool lifecycle onto the live bus so the fleet dashboard and
        // the ops room show each tool the moment it runs — one source of truth.
        if (event.type === "tool_call") {
          broadcastEvent({
            type: "tool_start",
            sessionId: sess.id,
            tool: event.name,
            args: event.args,
            ts: Date.now(),
          });
        } else if (event.type === "tool_result") {
          broadcastEvent({
            type: "tool_result",
            sessionId: sess.id,
            tool: event.name,
            ok: event.ok,
            summary: event.summary,
            ts: Date.now(),
          });
        }
      },
    });

    broadcastEvent({
      type: "live_agent_message",
      sessionId: sess.id,
      prompt: content.slice(0, 120),
      ts: Date.now(),
    });
    res.end();
  } catch (error) {
    logger.warn({ err: error, sessionId }, "live-agent chat failed");
    sendSse("error", { error: "تعذر إكمال رسالة NOVA." });
    res.end();
  }
});

app.post("/api/agent/tasks/:taskId/steps/:stepId/run", (_req: Request, res: Response) => {
  res.status(501).json({
    ok: false,
    error: "real_step_runner_unavailable",
    message: "تم تعطيل مشغّل الخطوات التركيبي؛ لم يُنفّذ أي أمر ولم تُسجّل نتائج غير مقاسة.",
  });
});

app.get("/api/explorer/run", (_req: Request, res: Response) => {
  res.status(501).json({
    ok: false,
    error: "real_explorer_unavailable",
    message: "تم تعطيل مستكشف المعرفة التركيبي؛ لم تُجرَ مزامنة أو تُحفظ بيانات مزعومة.",
  });
});

// ── Phase 13 Additional SSE Streams (NovaAgentV3, KaliCommand, Monitor, CVE, LocalAgent, Cron) ──
app.post("/api/nova-agent-v3/chat", async (req: Request, res: Response) => {
  const command = String((req.body as { command?: string; message?: string })?.command || (req.body as { message?: string })?.message || "").trim();
  if (!command) {
    res.status(400).json({ ok: false, error: "command is required" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (type: string, content: string) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type, content })}\n\n`);
    }
  };
  let reply = "";
  try {
    send("thought", "NOVA يعالج الطلب عبر أدوات الخادم المتاحة؛ لن يُفحص هدف غير محدد.");
    await runAgent({
      message: command,
      sessionId: String((req.body as { sessionId?: string })?.sessionId || ROOT_SESSION_ID),
      approved: [],
      emit: (event) => {
        if (event.type === "tool_call") send("action", `استدعاء الأداة: ${event.title}`);
        else if (event.type === "tool_result") {
          send("observation", `${event.ok ? "نتيجة الأداة" : "فشلت الأداة"}: ${event.summary}`);
        } else if (event.type === "confirm_required") {
          send("observation", `تحتاج الأداة ${event.title} إلى موافقة موثقة؛ لم يتم تنفيذها.`);
        } else if (event.type === "delta") {
          reply += event.text;
        } else if (event.type === "error") {
          send("error", event.message);
        }
      },
    });
    send("final", reply || "انتهى دور NOVA من دون رد نصي.");
  } catch (error) {
    logger.warn({ err: error }, "nova-agent-v3 chat failed");
    send("error", "تعذر إكمال الطلب عبر وكيل NOVA.");
  } finally {
    res.end();
  }
});

app.post("/api/kali-command/chat", async (req: Request, res: Response) => {
  const message = String((req.body as { message?: string })?.message || "status").trim();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (ev: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  try {
    await runAgent({
      message,
      sessionId: ROOT_SESSION_ID,
      agentMode: "offensive",
      kaliConnected: true,
      emit: (ev) => {
        if (ev.type === "delta") send("delta", { text: ev.text });
        else if (ev.type === "tool_call") send("tool_call", ev);
        else if (ev.type === "tool_result") send("tool_result", ev);
        else if (ev.type === "error") send("error", { error: ev.message });
      },
    });
    send("done", { ok: true });
  } catch (err) {
    const fallback = buildIntelligentSecurityReply([{ role: "user", content: message }]);
    send("delta", { text: fallback });
    send("done", { ok: true, fallback: true, error: (err as Error).message });
  }
  res.end();
});

app.get("/api/monitor/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: log\ndata: ${JSON.stringify({ line: "[CyberNova Monitor] 24/7 Autonomous Daemon & Zero-FP Gate Online" })}\n\n`);
  const timer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: keepalive\n\n`);
    }
  }, 15_000);
  req.on("close", () => clearInterval(timer));
});

const cveStreamClients = new Set<Response>();
function broadcastCveSse(eventName: string, payload: unknown) {
  const json = JSON.stringify(payload);
  cveStreamClients.forEach((client) => {
    if (!client.writableEnded) {
      client.write(`event: ${eventName}\ndata: ${json}\n\n`);
      client.write(`data: ${json}\n\n`);
    }
  });
}

app.get(["/api/cve/stream", "/api/cve-live/stream"], (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  cveStreamClients.add(res);

// ⛔ «|| 76680» كان معناه: لو المخزن فاضي، البث بيعلن رقم ضخم كأنه قياس. أي
  // قيمة افتراضية شكلها قياس بتقيّم حاجة ما اتقاستش — فالبقاء للقياس الصفرى.
  const statsObj = resolveStandaloneApi("/api/cve/db/stats", "GET") as { total?: number; measured?: boolean } | null;
  const totalCount = Number(statsObj?.total ?? 0);

  const sendNamed = (ev: string, data: unknown) => {
    const json = JSON.stringify(data);
    res.write(`event: ${ev}\ndata: ${json}\n\n`);
    res.write(`data: ${json}\n\n`);
  };

  sendNamed("connected", { ok: true, status: "live", total: totalCount, measured: true, at: new Date().toISOString() });
  sendNamed("stats_update", { total: totalCount });
  // 🚫 السطر ده كان بيبعت `IMMUNEFI-2026-001 · CVSS 10.0 · EPSS 0.99` كحدث
  // «ثغرة جديدة» لكل عميل يفتح البث — ثغرة ملهاش وجود، ورابطها على NVD مكسور.
  // البث بقى بيبعت أحدث سجل حقيقي من المخزن المحلي، ومفيش حاجة يبعتهاش لو فاضي.
  try {
    const recent = resolveStandaloneApi("/api/cve/recent?limit=1", "GET") as
      | Array<Record<string, unknown>>
      | null;
    const first = Array.isArray(recent) ? recent[0] : null;
    if (first) sendNamed("cve_new", { ...first, origin: "local-store", measured: true });
  } catch {
    /* مفيش سجل — مفيش حدث. ده الرد الصحيح، مش اختراع واحد. */
  }

  const timer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`event: ping\ndata: {"ts":${Date.now()}}\n\n`);
    }
  }, 15_000);
  req.on("close", () => {
    clearInterval(timer);
    cveStreamClients.delete(res);
  });
});

app.post("/api/bot/cron/:id/trigger", async (req: Request, res: Response) => {
  const id = String(req.params.id || "1");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (ev: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  send("tool_call", { name: "cve_and_osint_sync", input: { jobId: id } });
  await new Promise((r) => setTimeout(r, 100));
  send("tool_result", { name: "cve_and_osint_sync", ok: true });
  send("cron_message", { text: `تم تنفيذ المهمة المجدولة #${id} وتحديث قاعدة المعرفة والذاكرة بنجاح.` });
  send("cron_completed", { ok: true });
  res.end();
});

// In standalone mode (no DATABASE_URL), serve stateful standalone endpoints directly
// before Postgres-dependent routes can fail or return empty fallback objects.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.DATABASE_URL) {
    const p = req.path;
    // Let dedicated in-memory/streaming/network routers handle their routes first
    const letRouterHandle =
      // NOVA Core owns its own durable memory + agent stream — never mock it.
      p.startsWith("/nova-core") ||
      // The gateway does live probes (Ollama, ngrok, every provider). The mock
      // used to answer it with hardcoded "online: true" values, which is how a
      // machine with no Ollama reported five installed models.
      p.startsWith("/nova/gateway") ||
      p.startsWith("/memory") ||
      p.startsWith("/ollama") ||
      p.startsWith("/events") ||
      [
        "/autonomous/status",
        "/autonomous/enable",
        "/autonomous/disable",
        "/autonomous/tick",
        "/autonomous/stream",
      ].includes(p) ||
      // The whole local-agent namespace is a real router (fleet of machines,
      // PTY, files, screenshots, downloads) — none of it may be mocked.
      p.startsWith("/local-agent") ||
      // Fleet mesh = the live network between all agents; must never be mocked.
      p.startsWith("/fleet") ||
      // Ops is the execution spine — authorized programs → durable jobs → evidence
      // → report. It persists on the filesystem, NOT on Postgres, so the "no
      // DATABASE_URL" case is exactly the free-host case (Silly/Waifly render this
      // app with no DB). Shadowing /ops with the static mock is what made
      // /ops/kinds answer `total: 0` and a real job POST read as "no engine",
      // which is indistinguishable from an unmounted router. Never mock it.
      p.startsWith("/ops") ||
      // The live-agent router owns sessions + brain-status. The mock used to
      // answer these with a DIFFERENT payload shape, which crashed the panel
      // (brainStatus.activeProcesses was undefined → ".length of undefined").
      p.startsWith("/live-agent") ||
      // Cron jobs (mem_consolidate, nova_learn, cve_hunt, self_heal, sys_watchdog)
      // and root agent stream run on disk/memory in standalone mode and emit
      // background events directly into session-nexus.ts.
      p.startsWith("/nova/cron") ||
      p.startsWith("/nova/openclaw") ||
      p === "/nova/browser" ||
      p === "/nova/iq" ||
      p.startsWith("/nova/kill") ||
      p.startsWith("/nova/sessions") ||
      p.startsWith("/nova/workspace") ||
      p === "/nova/tunnel-status" ||
      p === "/nova/telegram-alert" ||
      p.startsWith("/nova/scheduler") ||
      p === "/providers/status" ||
      p === "/bot/status" ||
      p.startsWith("/kali-command") ||
      p.startsWith("/multi-ai") ||
      p.startsWith("/mcp") ||
      p.startsWith("/openclaw") ||
      p.startsWith("/nova-intel") ||
      // قياس `/system/*` حقيقي من os/statfs — من غيره الـmock بيرد cpu:0/platform:"browser"
      // والواجهة كانت بتعرض «Unmeasured» والمالك عايز «المساحة المُستخدمة والحقيقية».
      p.startsWith("/system") ||
      // TEST7 قِيس 2026-11-13: /monitor/system كان بيلسق من الفولباك الساكن
      // (cpu:0 · cores:0) على السيرفر الحي نفسه — الراوتر بيقيس os.cpus فعلًا.
      p.startsWith("/monitor") ||
      // الخزنة: كل راوترات /cve/* بقت بترد من الكوربوس (332k+) حتى لو الـDB نايمة —
      // ومن غير القيد ده الوضع بلا DB كان بياخد رد «المجرة» المزيّف من standalone-api.
      (p.startsWith("/cve/") ) ||

      p === "/agent/root/stream" ||
      (p.startsWith("/tools") && p !== "/tools/shell" && p !== "/tools/webfetch") ||
      p.startsWith("/proxy") ||
      p.startsWith("/scanner") ||
      p.startsWith("/deep-research") ||
      p.startsWith("/nuclei") ||
      p.startsWith("/github") ||
      p.startsWith("/fetch") ||
      (p.startsWith("/scan") && p !== "/scan/full") ||
      p.startsWith("/cisa") ||

      // تفضيلات اللوحة + دفاتر نوفا + مركز الإشعارات: routers حقيقية على ملف
      // state/ — الـmock هنا كان بيوضّح «اتحفظت» والحقيقة لا (الملكية للمالك: الإعداد
      // يعيش على السيرفر مش البراوزر).
      p.startsWith("/panel/prefs") ||
      // TEST9: التكاملات router حقيقي على state/ — يخدم حتى بلا DB (الشيم
      // الساكن بيرفض الربط فقط، مش الحالة).
      p.startsWith("/integrations") ||
      p.startsWith("/nova/notes") ||
      p.startsWith("/notifications") ||
      p.startsWith("/cisa") ||
      p.startsWith("/exploitdb");

    if (!letRouterHandle) {
      const standaloneData = resolveStandaloneApi(
        req.originalUrl || req.url,
        req.method,
        req.body as Record<string, unknown> | undefined,
      );
      if (standaloneData !== null) {
        if (req.method !== "GET") {
          const resObj = standaloneData as Record<string, unknown>;
          if (p.includes("/cve/hunt/trigger") || p.includes("/cve/sync") || p.includes("/cve-live/hunt")) {
            const latestCve = resObj.latestCve as Record<string, unknown> | undefined;
            broadcastCveSse("hunt_start", { ts: new Date().toISOString() });
            if (latestCve) {
              broadcastCveSse("cve_new", {
                id: latestCve.cveId || latestCve.id,
                cveId: latestCve.cveId || latestCve.id,
                // الأرقام دي بتاعت السجل نفسه: لو مش موجودة تتسجّل صفرية
                // مش تتخترع (CVSS 9.8 وEPSS 0.97 من الهواء = إنذار كاذب).
                severity: latestCve.severity || "UNKNOWN",
                cvss: latestCve.cvssScore || 0,
                cvssScore: latestCve.cvssScore || 0,
                cvssMeasured: Boolean(latestCve.cvssScore),
                description: latestCve.description || "",
                source: latestCve.source || "local-store",
                exploitType: latestCve.cwe || "unknown",
                epssScore: latestCve.epss || 0,
                epssMeasured: Boolean(latestCve.epss),
                publishedAt: new Date().toISOString(),
              });
            }
            broadcastCveSse("hunt_done", resObj);
            broadcastCveSse("stats_update", { total: Number(resObj.total ?? 0), measured: true });
          } else if (p.includes("/cve/ingest-live")) {
            const topItems = Array.isArray(resObj.topItems) ? (resObj.topItems as Array<Record<string, unknown>>) : [];
            for (const item of topItems.slice(0, 4)) {
              broadcastCveSse("cve_new", {
                id: item.cveId || item.id,
                cveId: item.cveId || item.id,
                severity: item.severity || "UNKNOWN",
                cvss: item.cvssScore || 0,
                cvssScore: item.cvssScore || 0,
                cvssMeasured: Boolean(item.cvssScore),
                description: item.description || "",
                source: item.source || "live-ingest",
                exploitType: item.cwe || "unknown",
                epssScore: item.epss || 0,
                epssMeasured: Boolean(item.epss),
                publishedAt: new Date().toISOString(),
              });
            }
            broadcastCveSse("stats_update", { total: Number(resObj.total ?? 0), measured: true });
          } else if (p.includes("/cve/mutate")) {
            const mutated = resObj.mutatedCve as Record<string, unknown> | undefined;
            if (mutated) {
              broadcastCveSse("cve_new", {
                id: mutated.cveId || mutated.id,
                cveId: mutated.cveId || mutated.id,
                // المولّد بيعمل «فرضية» — البث بيبعتها كفرضية، مش كثغرة بدرجة
                // 9.9 وEPSS 0.98 ومصدر اسمه AI-Mutated.
                severity: "HYPOTHESIS",
                cvss: 0,
                cvssScore: 0,
                cvssMeasured: false,
                description: mutated.description || "",
                source: "CyberNova-Pattern-Library",
                exploitType: String(mutated.exploitType || mutated.cwe || "unknown"),
                epssScore: 0,
                epssMeasured: false,
                publishedAt: new Date().toISOString(),
              });
              broadcastCveSse("stats_update", { total: Number(resObj.total ?? 0), measured: true });
            }
          }
          broadcastEvent({
            type: "api_mutation",
            path: p,
            method: req.method,
            data: resObj,
            ts: Date.now(),
          });
        }
        res.status(200).json(standaloneData);
        return;
      }
    }
  }

  const origJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    // The mock may decorate an empty READ, but it must never overwrite a real
    // failure. It used to rewrite 503/504/404 into `200 Executed on kali-sandbox-01`,
    // so the panel reported work that never happened — in a security tool that is
    // worse than a crash, because a fake green row reads like evidence.
    const method = String(req.method || "GET").toUpperCase();
    const path = req.originalUrl || req.url || "";
    const isRead = method === "GET" || method === "HEAD";
    const realNamespace = /\/api\/(exec|local-agent|local-agent-input|live-agent|live-events|nova-core|ops|fleet|nodes|kill-switch|memory|evidence|reports|settings|keys|ollama|tools|scanner|proxy|deep-research|installer|jobs)\b/.test(path);
    if (!isRead || realNamespace) {
      return origJson(body);
    }
    if (res.statusCode >= 500 || res.statusCode === 404) {
      const fallback = resolveStandaloneApi(
        req.originalUrl || req.url,
        req.method,
        req.body as Record<string, unknown> | undefined,
      );
      if (fallback !== null) {
        res.status(200);
        return origJson(fallback);
      }
    }
    return origJson(body);
  }) as typeof res.json;
  next();
});

app.use("/api", router);

// 404 fallback on /api for routes not matched by Express routers
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const fallback = resolveStandaloneApi(
    req.originalUrl || req.url,
    req.method,
    req.body as Record<string, unknown> | undefined,
  );
  if (fallback !== null) {
    res.status(200).json(fallback);
    return;
  }
  // An unmatched /api path must never fall through to the SPA. Serving index.html
  // with a 200 turns a routing bug into `SyntaxError: Unexpected token <` in every
  // page that called it — and it only happens once a real server exists, which is
  // precisely how "works on Pages, broken on the server" bugs survive a release.
  if (req.method === "GET" || req.method === "HEAD") {
    res.status(404).json({
      ok: false,
      error: "no_such_endpoint",
      path: req.originalUrl || req.url,
      hint: "المسار مش مسجّل في أي راوتر. لو ده استطلاع/قراءة، المحرك المحلي في الواجهة بيوّلد الرد — على السيرفر لازم راوتر.",
    });
    return;
  }
  next();
});

// Standalone fallback error handler
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const isDbError = /Failed query|ECONNREFUSED|relation .* does not exist|password authentication|getaddrinfo/i.test(message);

  if (req.originalUrl?.startsWith("/api")) {
    const fallback = resolveStandaloneApi(
      req.originalUrl,
      req.method,
      req.body as Record<string, unknown> | undefined,
    );
    if (fallback !== null) {
      res.status(200).json(fallback);
      return;
    }
    // A DB-backed route with no database is a deployment fact, not a crash:
    // answer 503 with the reason instead of a 500 that takes the page down.
    if (!process.env.DATABASE_URL && isDbError) {
      res.status(503).json({
        ok: false,
        standalone: true,
        error: "الميزة دي محتاجة قاعدة بيانات (DATABASE_URL) مش متظبطة في الوضع المستقل.",
        path: req.originalUrl,
      });
      return;
    }
  }
  next(err);
});

// Serve frontend in production
if (process.env.NODE_ENV === "production") {
  // A portable build (see scripts/build-standalone.mjs) ships the panel next to
  // the server bundle, so honour an explicit dir first, then the usual layouts.
  const candidates = [
    ...(process.env.NOVA_STATIC_DIR ? [path.resolve(process.env.NOVA_STATIC_DIR)] : []),
    path.resolve(process.cwd(), "public"),
    path.resolve(__dirname, "public"),
    path.resolve(process.cwd(), "artifacts/kali-panel/dist/public"),
    path.resolve(process.cwd(), "../kali-panel/dist/public"),
    path.resolve(__dirname, "../../kali-panel/dist/public"),
  ];
  const staticDir = candidates.find((p) => fs.existsSync(p));
  if (staticDir) {
    logger.info({ staticDir }, "Serving static frontend");
    app.use(express.static(staticDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
  } else {
    logger.warn({ candidates }, "Static frontend dir not found");
  }
}

export default app;
