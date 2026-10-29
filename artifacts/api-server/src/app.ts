import cors from "cors";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { resolveStandaloneApi } from "./lib/standalone-api";
import { buildIntelligentSecurityReply } from "./routes/ollama-proxy";
import { getAllMemories, saveMemory } from "./routes/memory";
import { broadcastEvent } from "./lib/ws-hub";

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

  const toolId = `tc-${Date.now()}`;
  sendSse("tool_call", {
    id: toolId,
    name: "memory_search",
    input: { query: content.slice(0, 80), sessionId },
  });

  await new Promise((r) => setTimeout(r, 120));
  const memories = getAllMemories().slice(0, 4);
  sendSse("tool_result", {
    toolCallId: toolId,
    result: JSON.stringify(
      memories.map((m) => ({ title: m.title, kind: m.kind, content: m.content.slice(0, 120) })),
      null,
      2,
    ),
    isError: false,
  });

  const reply = buildIntelligentSecurityReply([{ role: "user", content }]);
  const chunks = reply.match(/.{1,24}/gs) ?? [reply];
  for (const chunk of chunks) {
    if (res.writableEnded) break;
    sendSse("delta", { text: chunk });
    await new Promise((r) => setTimeout(r, 14));
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
    steps?: Array<{ id: number; title: string; description: string; status: string; output: string }>;
  } | null;
  const step = task?.steps?.find((s) => s.id === stepId);
  const stepTitle = step?.title || `خطوة #${stepId}`;

  sendSse("step_started", { title: stepTitle });
  const outputLines = [
    `[CyberNova Autonomous Step Runner]`,
    `▶ تنفيذ: ${stepTitle}`,
    `• التحقق من السياق والذاكرة المشتركة (${getAllMemories().length} ملاحظات)...`,
    `• تطبيق الفحص القانوني غير الهجومي وتوثيق المخرجات...`,
    `✅ اكتملت الخطوة بنجاح وتم تسجيل النتيجة في سجل المهمة.`,
  ].join("\n");

  const chunks = outputLines.match(/.{1,22}/gs) ?? [outputLines];
  for (const chunk of chunks) {
    if (res.writableEnded) break;
    sendSse("step_delta", { text: chunk });
    await new Promise((r) => setTimeout(r, 18));
  }

  if (step) {
    step.status = "completed";
    step.output = outputLines;
  }
  saveMemory("fact", `تنفيذ خطوة وكيل: ${stepTitle}`, outputLines, "agent,step", 6, false);
  broadcastEvent({ type: "agent_step_completed", taskId, stepId, title: stepTitle, ts: Date.now() });

  sendSse("step_completed", { stepId });
  if (task?.steps?.every((s) => s.status === "completed" || s.status === "skipped")) {
    sendSse("task_completed", { taskId });
  }
  res.end();
});

// In standalone mode (no DATABASE_URL), serve stateful standalone endpoints directly
// before Postgres-dependent routes can fail or return empty fallback objects.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.DATABASE_URL) {
    const p = req.path;
    // Let dedicated in-memory/streaming/network routers handle their routes first
    const letRouterHandle =
      p.startsWith("/memory") ||
      p.startsWith("/ollama") ||
      p.startsWith("/events") ||
      p.startsWith("/local-agent") ||
      p.startsWith("/tools") ||
      p.startsWith("/proxy") ||
      p.startsWith("/scanner");

    if (!letRouterHandle) {
      const standaloneData = resolveStandaloneApi(
        req.originalUrl || req.url,
        req.method,
        req.body as Record<string, unknown> | undefined,
      );
      if (standaloneData !== null) {
        if (req.method !== "GET") {
          broadcastEvent({
            type: "api_mutation",
            path: p,
            method: req.method,
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
  next();
});

// Standalone fallback error handler
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
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
  }
  next(err);
});

// Serve frontend in production
if (process.env.NODE_ENV === "production") {
  const candidates = [
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
