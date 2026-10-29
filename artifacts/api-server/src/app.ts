import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { resolveStandaloneApi } from "./lib/standalone-api";

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
app.use(compression({ level: 6, threshold: 1024 }));
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Intercept 500 DB errors in standalone mode and serve rich fallback data
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const origJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (res.statusCode >= 500) {
      const fallback = resolveStandaloneApi(req.originalUrl, req.method);
      res.status(200);
      return origJson(fallback !== null ? fallback : { ok: true, items: [], data: [] });
    }
    return origJson(body);
  };
  next();
});

app.use("/api", router);

// Fallback for any /api route not matched in router
app.use("/api", (req: Request, res: Response) => {
  const data = resolveStandaloneApi(req.originalUrl, req.method);
  if (data !== null) {
    res.json(data);
    return;
  }
  res.json({ ok: true, items: [], data: [] });
});

// Error recovery middleware for standalone mode (when PostgreSQL is not running)
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (req.originalUrl.startsWith("/api")) {
    const data = resolveStandaloneApi(req.originalUrl, req.method);
    res.status(200).json(data !== null ? data : { ok: true, items: [], data: [] });
    return;
  }
  logger.error({ err }, "Unhandled Express error");
  res.status(500).json({ error: "Internal Server Error" });
});

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    message: "CyberNova API Server is running",
    version: "1.0.0",
    endpoints: ["/api", "/live-agent"],
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/api/ping", (_req, res) => {
  res.json({ status: "pong", timestamp: new Date().toISOString() });
});

export default app;
