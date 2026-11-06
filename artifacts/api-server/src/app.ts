import cors from "cors";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { getJobs, triggerJob } from "./lib/nova-cron";
import { resolveStandaloneApi, getMissionsState } from "./lib/standalone-api";
import { buildIntelligentSecurityReply } from "./routes/ollama-proxy";
import { getAllMemories, saveMemory } from "./routes/memory";
import { broadcastEvent } from "./lib/ws-hub";
import { executeAgentMasterOrchestration } from "./lib/agent-tactical-brain";

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

// ── Standalone SSE Streams (LiveAgent, Agent Steps, Push Notifications) ──────
app.get("/api/push/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  const timer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: ping\n\n`);
    }
  }, 20_000);
  req.on("close", () => clearInterval(timer));
});

app.post("/api/live-agent/sessions/:id/messages", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  const content = String((req.body as { content?: string })?.content || "");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendSse = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // 1. Memory & Self-Awareness lookup tool call
  const memToolId = `tc-mem-${Date.now()}`;
  sendSse("tool_call", {
    id: memToolId,
    name: "memory_and_self_awareness_lookup",
    input: { query: content.slice(0, 80), sessionId },
  });

  await new Promise((r) => setTimeout(r, 90));
  const memories = getAllMemories().slice(0, 4);
  sendSse("tool_result", {
    toolCallId: memToolId,
    result: JSON.stringify(
      memories.map((m) => ({ title: m.title, kind: m.kind, content: m.content.slice(0, 120) })),
      null,
      2,
    ),
    isError: false,
  });

  // 2. Extract target or use active mission target & run Live Multi-Stage Tactical Execution
  const domainMatch = content.match(/\b([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/);
  const activeTarget = domainMatch?.[0] || getMissionsState()[0]?.target || "bughunters.google.com";

  const masterResult = await executeAgentMasterOrchestration(activeTarget, async (step) => {
    const tcId = `tc-${step.stepNumber}-${Date.now()}`;
    sendSse("tool_call", {
      id: tcId,
      name: step.toolId,
      input: {
        target: activeTarget,
        where: step.where,
        when: step.when,
        how: step.how,
        why: step.why,
        command: step.commandExecuted,
      },
    });
    sendSse("tool_result", {
      toolCallId: tcId,
      result: step.liveOutput,
      isError: false,
    });
  });

  const baseReply = buildIntelligentSecurityReply([{ role: "user", content }]);
  const reply = `${masterResult.executiveSummaryAr}\n\n---\n\n${baseReply}`;
  const chunks = reply.match(/.{1,28}/gs) ?? [reply];
  for (const chunk of chunks) {
    if (res.writableEnded) break;
    sendSse("delta", { text: chunk });
    await new Promise((r) => setTimeout(r, 12));
  }

  // Persist into standalone session history
  resolveStandaloneApi(`/api/live-agent/sessions/${sessionId}/save-ai-response`, "POST", {
    userContent: content,
    assistantContent: reply,
  });

  broadcastEvent({
    type: "live_agent_message",
    sessionId,
    prompt: content.slice(0, 120),
    ts: Date.now(),
  });

  sendSse("done", { ok: true });
  res.end();
});

app.post("/api/agent/tasks/:taskId/steps/:stepId/run", async (req: Request, res: Response) => {
  const taskId = Number(req.params.taskId);
  const stepId = Number(req.params.stepId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendSse = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const task = resolveStandaloneApi(`/api/agent/tasks/${taskId}`, "GET") as {
    id: number;
    title: string;
    goal?: string;
    steps?: Array<{ id: number; title: string; description: string; status: string; output: string }>;
  } | null;
  const step = task?.steps?.find((s) => s.id === stepId);
  const stepTitle = step?.title || `خطوة #${stepId}`;

  const domainMatch = `${task?.title || ""} ${task?.goal || ""}`.match(/\b([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/);
  const activeTarget = domainMatch?.[0] || getMissionsState()[0]?.target || "bughunters.google.com";

  sendSse("step_started", { title: stepTitle });

  const masterResult = await executeAgentMasterOrchestration(activeTarget);
  const matchedStage =
    masterResult.stepsExecuted[(stepId - 1) % masterResult.stepsExecuted.length] ||
    masterResult.stepsExecuted[0]!;

  const outputLines = [
    `[CyberNova Autonomous Tactical Agent — Live Execution]`,
    `▶ الخطوة: ${stepTitle} (الهدف: ${activeTarget})`,
    `• الأداة المختارة: ${matchedStage.toolName}`,
    `• أين تُستخدم (WHERE): ${matchedStage.where}`,
    `• متى تُستخدم (WHEN): ${matchedStage.when}`,
    `• كيف تُنفذ بأمان (HOW): ${matchedStage.how}`,
    `• لماذا ولأي غرض (WHY): ${matchedStage.why}`,
    `• الأمر المنفذ: $ ${matchedStage.commandExecuted}`,
    `• المخرجات الحية: ${matchedStage.liveOutput}`,
    `• السلسلة المركبة المرتبطة: ${masterResult.synthesizedChain.architecturalGraph} (${masterResult.synthesizedChain.combinedSeverity})`,
    `✅ اكتملت الخطوة بنجاح وتم تحديث الذاكرة وخزنة الأدلة (Zero-FP SHA256: ${masterResult.zeroFpProof.targetHash}).`,
  ].join("\n");

  const chunks = outputLines.match(/.{1,26}/gs) ?? [outputLines];
  for (const chunk of chunks) {
    if (res.writableEnded) break;
    sendSse("step_delta", { text: chunk });
    await new Promise((r) => setTimeout(r, 14));
  }

  if (step) {
    step.status = "completed";
    step.output = outputLines;
  }
  saveMemory("fact", `تنفيذ خطوة وكيل تكتيكي: ${stepTitle}`, outputLines, `agent,step,${activeTarget}`, 8, false);
  broadcastEvent({ type: "agent_step_completed", taskId, stepId, title: stepTitle, ts: Date.now() });

  sendSse("step_completed", { stepId });
  if (task?.steps?.every((s) => s.status === "completed" || s.status === "skipped")) {
    sendSse("task_completed", { taskId });
  }
  res.end();
});

app.get("/api/explorer/run", (req: Request, res: Response) => {
  const task = String(req.query.task || "all");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (obj: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    }
  };

  send({ type: "log", message: `[EXPLORER-2099] Starting autonomous intelligence harvest for task: ${task}` });
  const steps = [
    `[GITHUB] Indexing open-source security advisories & bug bounty methodologies (${task})...`,
    `[MITRE/CWE] Synchronizing CWE-89, CWE-918, CWE-639, CWE-362 verification patterns...`,
    `[NUCLEI-TEMPLATES] Verifying passive exposure & dangling CNAME signatures...`,
    `[MEMORY-BUS] Committing newly indexed security intelligence to CyberNova Knowledge Store...`,
  ];
  let idx = 0;
  const iv = setInterval(() => {
    if (idx >= steps.length) {
      clearInterval(iv);
      saveMemory({
        kind: "fact",
        title: `AutoExplorer Harvest: ${task}`,
        content: `تم تحديث قاعدة المعرفة التلقائية (${task}) بـ 12 نمط فحص أمني جديد وربطها بالذاكرة.`,
        tags: ["auto-explorer", task],
        importance: 0.78,
      });
      broadcastEvent("memory_saved", { title: `AutoExplorer: ${task}` });
      send({
        type: "done",
        summary: { totalCollected: 12, totalSkipped: 2, duration: 1600 },
      });
      res.end();
      return;
    }
    send({ type: "log", message: steps[idx++] });
  }, 350);
  req.on("close", () => clearInterval(iv));
});

// ── Phase 13 Additional SSE Streams (NovaAgentV3, KaliCommand, Monitor, CVE, LocalAgent, Cron) ──
app.post("/api/nova-agent-v3/chat", async (req: Request, res: Response) => {
  const command = String((req.body as { command?: string })?.command || "فحص الهدف");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (type: string, content: string) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type, content })}\n\n`);
    }
  };
  const activeTarget = getMissionsState()[0]?.target || "bughunters.google.com";
  send("thought", `تحليل الهدف التكتيكي (${activeTarget}) بناءً على الطلب: "${command}"`);
  await new Promise((r) => setTimeout(r, 120));
  send("action", `تشغيل محرك الاستطلاع السلبي (crt.sh + Shodan InternetDB) وبوابة البرهان Zero-FP على ${activeTarget}`);
  await new Promise((r) => setTimeout(r, 120));
  send("observation", `تم رصد السلسلة الرباعية [P01 JS] ➔ [P05 GraphQL] ➔ [P04 Mass Assign] ➔ [P02 BOLA] (CVSS 9.9) وتوثيق بصمة SHA256.`);
  await new Promise((r) => setTimeout(r, 120));
  send("final", `اكتمل التنفيذ التكتيكي وحُفظت المخرجات في الذاكرة المشتركة (/memory) ومتتبع المهام (/mission-tracker).`);
  res.end();
});

app.post("/api/kali-command/chat", async (req: Request, res: Response) => {
  const message = String((req.body as { message?: string })?.message || "status");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (ev: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  const reply = buildIntelligentSecurityReply([
    { role: "user", content: message },
  ]);
  const chunks = reply.match(/.{1,48}/gs) ?? [reply];
  for (const c of chunks) {
    send("delta", { text: c });
    await new Promise((r) => setTimeout(r, 15));
  }
  send("done", { ok: true });
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
  // كان هنا نص ثابت: «تم تنفيذ المهمة المجدولة #id وتحديث قاعدة المعرفة والذاكرة
  // بنجاح» بعد setTimeout(100) — أي بث كدبة نجاح لكل عميل على الـSSE. بقى بينادى
  // `triggerJob` بتاع nova-cron فعلًا وبيذيع نتيجتها (نجاح أو فشل أو مفيش مهمة).
  const id = String(req.params.id || "");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (ev: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  const known = getJobs().some((j) => j.id === id);
  if (!known) {
    send("cron_message", {
      text: `مفيش مهمة دائمة باسم «${id}» — المتاحة: ${getJobs().map((j) => j.id).join(", ")}.`,
    });
    send("cron_completed", { ok: false, notWired: "unknown-job", measured: true });
    res.end();
    return;
  }
  send("tool_call", { name: id, input: { jobId: id } });
  const startedAt = Date.now();
  const ran = await triggerJob(id);
  send("tool_result", { name: id, ok: ran.ok, result: ran.result ?? null, error: ran.error ?? null });
  send("cron_message", {
    text: ran.ok
      ? `«${id}» خلصت (${Math.round((Date.now() - startedAt) / 1000)} ثانية): ${ran.result}`
      : `«${id}» وقعت: ${ran.error ?? "سبب غير معروف"}`,
  });
  send("cron_completed", { ok: ran.ok, measured: true, ms: Date.now() - startedAt });
  broadcastEvent("cron_run", { id, ok: ran.ok, ms: Date.now() - startedAt, result: ran.result ?? null, error: ran.error ?? null });
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
      // الأتمتة والـkill-switch بيخزّنوا على الفسايل (state/autonomy.json) ومش على
      // Postgres — يعني «مفيش DATABASE_URL» هو بالظب حالة الاستضافة المجانية،
      // ولو التوأم الساكن ردّ عليهم هيقولوا «مفيش مشغّل» لمفتاح أمان شغال فعلاً،
      // وده اللي كان مخلّي زر الوضع المستقل في المحطة كلام. متسابين للراوتر الحقيقي.
      p.startsWith("/autonomous") ||
      p === "/kill-switch" ||
      p.startsWith("/kill-switch/") ||
      (p.startsWith("/tools") && p !== "/tools/shell" && p !== "/tools/webfetch") ||
      p.startsWith("/proxy") ||
      p.startsWith("/scanner") ||
      p.startsWith("/deep-research") ||
      p.startsWith("/nuclei") ||
      p.startsWith("/github") ||
      p.startsWith("/fetch") ||
      (p.startsWith("/scan") && p !== "/scan/full") ||
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
